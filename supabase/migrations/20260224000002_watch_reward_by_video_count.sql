-- 🎯 观看时长奖励改为「观看视频数量」：一个视频看满10秒以上计1个
-- 1. 新增按视频上报 RPC（只写 user_video_watch_time）
-- 2. get_watch_time_reward_status / claim_watch_time_reward 改为按达标视频数
-- 3. 更新 incentive_rules：threshold 改为视频个数（3/10/20）

-- 1. 新增：按视频累加观看秒数（仅写 user_video_watch_time，按 user+video 限频）
CREATE OR REPLACE FUNCTION public.increment_video_watch_seconds(
    p_user_id UUID,
    p_video_id UUID,
    p_seconds INT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_today DATE := (NOW() AT TIME ZONE 'Asia/Shanghai')::DATE;
    v_last_updated_at TIMESTAMPTZ;
    v_time_since_last INTERVAL;
    v_new_total INT;
BEGIN
    -- 🚨 安全：只能为自己上报
    IF p_user_id != auth.uid() THEN
        RETURN jsonb_build_object('success', false, 'message', '非法操作');
    END IF;

    -- 🚨 单次上限 1～20 秒
    IF p_seconds IS NULL OR p_seconds <= 0 OR p_seconds > 20 THEN
        RETURN jsonb_build_object('success', false, 'message', '无效的秒数');
    END IF;

    -- 🚨 视频必须存在
    IF NOT EXISTS (SELECT 1 FROM public.videos WHERE id = p_video_id) THEN
        RETURN jsonb_build_object('success', false, 'message', '视频不存在');
    END IF;

    -- 🚨 按 (user_id, video_id) 限频：同一视频两次调用间隔至少 10 秒
    SELECT last_updated_at INTO v_last_updated_at
    FROM public.user_video_watch_time
    WHERE user_id = p_user_id AND video_id = p_video_id AND watch_date = v_today
    FOR UPDATE;

    IF v_last_updated_at IS NOT NULL THEN
        v_time_since_last := NOW() - v_last_updated_at;
        IF v_time_since_last < INTERVAL '10 seconds' THEN
            RETURN jsonb_build_object('success', false, 'message', '上报过于频繁');
        END IF;
    END IF;

    INSERT INTO public.user_video_watch_time (
        user_id, video_id, watch_date, total_seconds, last_updated_at
    )
    VALUES (p_user_id, p_video_id, v_today, p_seconds, NOW())
    ON CONFLICT (user_id, video_id, watch_date)
    DO UPDATE SET
        total_seconds = COALESCE(user_video_watch_time.total_seconds, 0) + p_seconds,
        last_updated_at = NOW()
    RETURNING total_seconds INTO v_new_total;

    RETURN jsonb_build_object(
        'success', true,
        'video_id', p_video_id,
        'watch_date', v_today,
        'total_seconds', v_new_total
    );
END;
$$;

COMMENT ON FUNCTION public.increment_video_watch_seconds IS '🎯 按视频上报观看秒数：仅写 user_video_watch_time，同一视频 10 秒内只能上报一次，单次 1～20 秒';

-- 2. 修改 get_watch_time_reward_status：用「当日达标视频数」替代累计秒数
CREATE OR REPLACE FUNCTION public.get_watch_time_reward_status(p_user_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_today DATE := (NOW() AT TIME ZONE 'Asia/Shanghai')::DATE;
    v_video_count INT := 0;  -- 当日达标视频数（total_seconds >= 10）
    v_claimed_reward NUMERIC := 0;
    v_available_reward NUMERIC := 0;
    v_reward_level TEXT := 'none';
    v_reward_code TEXT := NULL;
    v_task_rule RECORD;
    v_claimed BOOLEAN;
BEGIN
    -- 1. 获取今日达标视频数（一个视频看满 10 秒以上计 1 个）
    SELECT COUNT(*)::INT INTO v_video_count
    FROM public.user_video_watch_time
    WHERE user_id = p_user_id
      AND watch_date = v_today
      AND total_seconds >= 10;

    -- 2. 今日已领取奖励总额
    SELECT COALESCE(SUM(amount), 0) INTO v_claimed_reward
    FROM public.coin_transactions
    WHERE user_id = p_user_id
      AND type = 'watch_time_reward'
      AND (created_at AT TIME ZONE 'Asia/Shanghai')::DATE = v_today;

    -- 3. 从任务表查询观看视频数任务（threshold 现为视频个数）
    FOR v_task_rule IN
        SELECT code, name, threshold, reward_usdt
        FROM public.incentive_rules
        WHERE rule_type = 'watch_time'
          AND is_active = TRUE
          AND (start_at IS NULL OR start_at <= NOW())
          AND (end_at IS NULL OR end_at >= NOW())
        ORDER BY threshold ASC
    LOOP
        SELECT EXISTS(
            SELECT 1 FROM public.coin_transactions
            WHERE user_id = p_user_id
              AND type = 'watch_time_reward'
              AND (created_at AT TIME ZONE 'Asia/Shanghai')::DATE = v_today
              AND description LIKE '%' || v_task_rule.code || '%'
        ) INTO v_claimed;

        IF v_video_count >= v_task_rule.threshold AND NOT v_claimed THEN
            v_available_reward := v_task_rule.reward_usdt;
            v_reward_level := v_task_rule.name;
            v_reward_code := v_task_rule.code;
            EXIT;
        END IF;
    END LOOP;

    -- 返回 total_seconds 存达标视频数，便于前端兼容展示
    RETURN jsonb_build_object(
        'total_seconds', v_video_count,
        'total_minutes', v_video_count,
        'claimed_reward', v_claimed_reward,
        'available_reward', v_available_reward,
        'reward_level', v_reward_level,
        'reward_code', v_reward_code,
        'watch_date', v_today,
        'can_claim', v_available_reward > 0
    );
END;
$$;

COMMENT ON FUNCTION public.get_watch_time_reward_status IS '🎯 观看视频数奖励状态：达标视频数 = 当日 total_seconds>=10 的视频个数';

-- 3. 修改 claim_watch_time_reward：用达标视频数判断档位
CREATE OR REPLACE FUNCTION public.claim_watch_time_reward(p_user_id UUID, p_ip_address TEXT DEFAULT NULL)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_today DATE := (NOW() AT TIME ZONE 'Asia/Shanghai')::DATE;
    v_video_count INT := 0;
    v_reward_amount NUMERIC := 0;
    v_reward_level TEXT := 'none';
    v_reward_code TEXT := NULL;
    v_final_balance NUMERIC;
    v_today_total_claimed NUMERIC := 0;
    v_task_rule RECORD;
    v_claimed BOOLEAN;
    v_last_claim_time TIMESTAMPTZ;
    v_time_since_last_claim INTERVAL;
    v_ip_check_result JSONB;
BEGIN
    IF p_user_id != auth.uid() THEN
        RETURN jsonb_build_object('success', false, 'message', '非法操作：只能为自己领取奖励');
    END IF;

    IF p_ip_address IS NOT NULL THEN
        SELECT public.check_ip_watch_time_reward_limit(p_user_id, p_ip_address) INTO v_ip_check_result;
        IF v_ip_check_result->>'allowed' = 'false' THEN
            RETURN jsonb_build_object(
                'success', false,
                'message', COALESCE(v_ip_check_result->>'message', 'IP限制：该IP今日已有3个账号领取过奖励')
            );
        END IF;
    END IF;

    SELECT MAX(created_at) INTO v_last_claim_time
    FROM public.coin_transactions
    WHERE user_id = p_user_id
      AND type = 'watch_time_reward'
      AND (created_at AT TIME ZONE 'Asia/Shanghai')::DATE = v_today;

    IF v_last_claim_time IS NOT NULL THEN
        v_time_since_last_claim := NOW() - v_last_claim_time;
        IF v_time_since_last_claim < INTERVAL '2 seconds' THEN
            RETURN jsonb_build_object('success', false, 'message', '请求过于频繁，请稍后再试');
        END IF;
    END IF;

    SELECT balance_coins INTO v_final_balance
    FROM public.profiles
    WHERE id = p_user_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'message', '用户不存在');
    END IF;

    -- 当日达标视频数（在锁内查询）
    SELECT COUNT(*)::INT INTO v_video_count
    FROM public.user_video_watch_time
    WHERE user_id = p_user_id
      AND watch_date = v_today
      AND total_seconds >= 10;

    SELECT COALESCE(SUM(amount), 0) INTO v_today_total_claimed
    FROM public.coin_transactions
    WHERE user_id = p_user_id
      AND type = 'watch_time_reward'
      AND (created_at AT TIME ZONE 'Asia/Shanghai')::DATE = v_today;

    FOR v_task_rule IN
        SELECT code, name, threshold, reward_usdt
        FROM public.incentive_rules
        WHERE rule_type = 'watch_time'
          AND is_active = TRUE
          AND (start_at IS NULL OR start_at <= NOW())
          AND (end_at IS NULL OR end_at >= NOW())
        ORDER BY threshold ASC
    LOOP
        SELECT EXISTS(
            SELECT 1 FROM public.coin_transactions
            WHERE user_id = p_user_id
              AND type = 'watch_time_reward'
              AND (created_at AT TIME ZONE 'Asia/Shanghai')::DATE = v_today
              AND description LIKE '%' || v_task_rule.code || '%'
        ) INTO v_claimed;

        IF v_video_count >= v_task_rule.threshold AND NOT v_claimed THEN
            v_reward_amount := v_task_rule.reward_usdt;
            v_reward_level := v_task_rule.name;
            v_reward_code := v_task_rule.code;
            EXIT;
        END IF;
    END LOOP;

    IF v_reward_amount = 0 OR v_reward_code IS NULL THEN
        RETURN jsonb_build_object(
            'success', false,
            'message', '当前没有可领取的奖励档位',
            'current_seconds', v_video_count
        );
    END IF;

    SELECT EXISTS(
        SELECT 1 FROM public.coin_transactions
        WHERE user_id = p_user_id
          AND type = 'watch_time_reward'
          AND (created_at AT TIME ZONE 'Asia/Shanghai')::DATE = v_today
          AND description LIKE '%' || v_reward_code || '%'
    ) INTO v_claimed;

    IF v_claimed THEN
        RETURN jsonb_build_object('success', false, 'message', '该档位已领取');
    END IF;

    UPDATE public.profiles
    SET balance_coins = balance_coins + v_reward_amount
    WHERE id = p_user_id
    RETURNING balance_coins INTO v_final_balance;

    INSERT INTO public.coin_transactions (user_id, amount, balance_after, type, description)
    VALUES (
        p_user_id,
        v_reward_amount,
        v_final_balance,
        'watch_time_reward',
        '观看视频奖励: ' || v_reward_level || ' (' || v_reward_code || ', ' || v_video_count || '个视频)'
    );

    IF p_ip_address IS NOT NULL THEN
        INSERT INTO public.watch_time_reward_ips (user_id, ip_address, reward_date)
        VALUES (p_user_id, p_ip_address, v_today)
        ON CONFLICT (user_id, ip_address, reward_date) DO NOTHING;
    END IF;

    RETURN jsonb_build_object(
        'success', true,
        'reward_amount', v_reward_amount,
        'reward_level', v_reward_level,
        'reward_code', v_reward_code,
        'total_seconds', v_video_count,
        'balance_after', v_final_balance,
        'today_total_claimed', v_today_total_claimed + v_reward_amount
    );
END;
$$;

COMMENT ON FUNCTION public.claim_watch_time_reward IS '🎯 领取观看视频数奖励：按达标视频数（≥10秒）判断档位，IP限制不变';

-- 4. 更新 incentive_rules：threshold 改为视频个数（20/50/100），name/description 改为「观看 N 个视频」
UPDATE public.incentive_rules
SET
    name = CASE code
        WHEN 'watch_time_5min' THEN '观看20个视频'
        WHEN 'watch_time_15min' THEN '观看50个视频'
        WHEN 'watch_time_30min' THEN '观看100个视频'
        ELSE name
    END,
    description = CASE code
        WHEN 'watch_time_5min' THEN '观看满10秒的视频达 20 个即可获得 5 抖币'
        WHEN 'watch_time_15min' THEN '观看满10秒的视频达 50 个即可获得 10 抖币'
        WHEN 'watch_time_30min' THEN '观看满10秒的视频达 100 个即可获得 15 抖币'
        ELSE description
    END,
    metric = 'watch_video_count',
    threshold = CASE code
        WHEN 'watch_time_5min' THEN 20
        WHEN 'watch_time_15min' THEN 50
        WHEN 'watch_time_30min' THEN 100
        ELSE threshold
    END,
    updated_at = NOW()
WHERE rule_type = 'watch_time'
  AND code IN ('watch_time_5min', 'watch_time_15min', 'watch_time_30min');
