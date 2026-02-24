-- 🎯 修复「今日达标」误计历史数据：只统计今日（北京时间）有更新的记录
-- 原因：user_video_watch_time 可能含历史脏数据（旧代码用 UTC 写 watch_date 等），导致未刷也显示有达标数

-- 1. get_watch_time_reward_status：只计 last_updated_at 为今日北京时间的行
CREATE OR REPLACE FUNCTION public.get_watch_time_reward_status(p_user_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_today DATE := (NOW() AT TIME ZONE 'Asia/Shanghai')::DATE;
    v_video_count INT := 0;
    v_claimed_reward NUMERIC := 0;
    v_available_reward NUMERIC := 0;
    v_reward_level TEXT := 'none';
    v_reward_code TEXT := NULL;
    v_task_rule RECORD;
    v_claimed BOOLEAN;
BEGIN
    -- 只统计 watch_date = 今日 且 last_updated_at 为今日（北京时间），避免历史脏数据被计入
    SELECT COUNT(*)::INT INTO v_video_count
    FROM public.user_video_watch_time
    WHERE user_id = p_user_id
      AND watch_date = v_today
      AND total_seconds >= 10
      AND (last_updated_at AT TIME ZONE 'Asia/Shanghai')::DATE = v_today;

    SELECT COALESCE(SUM(amount), 0) INTO v_claimed_reward
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
            v_available_reward := v_task_rule.reward_usdt;
            v_reward_level := v_task_rule.name;
            v_reward_code := v_task_rule.code;
            EXIT;
        END IF;
    END LOOP;

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

COMMENT ON FUNCTION public.get_watch_time_reward_status IS '🎯 观看视频数奖励状态：仅统计今日（北京时间）有更新的达标记录，避免历史脏数据';

-- 2. claim_watch_time_reward：同样只计今日有更新的行
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

    -- 只统计今日（北京时间）有更新的达标视频数
    SELECT COUNT(*)::INT INTO v_video_count
    FROM public.user_video_watch_time
    WHERE user_id = p_user_id
      AND watch_date = v_today
      AND total_seconds >= 10
      AND (last_updated_at AT TIME ZONE 'Asia/Shanghai')::DATE = v_today;

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

COMMENT ON FUNCTION public.claim_watch_time_reward IS '🎯 领取观看视频数奖励：仅统计今日（北京时间）有更新的达标记录';
