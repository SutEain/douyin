-- 修复观看时长任务的时区问题：使用北京时间（UTC+8）而不是UTC

-- 1. 修改获取观看时长奖励状态函数（使用北京时间）
CREATE OR REPLACE FUNCTION public.get_watch_time_reward_status(p_user_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_today DATE := (NOW() AT TIME ZONE 'Asia/Shanghai')::DATE; -- 🎯 使用北京时间
    v_total_seconds INT := 0;
    v_claimed_5min BOOLEAN := FALSE;
    v_claimed_15min BOOLEAN := FALSE;
    v_claimed_30min BOOLEAN := FALSE;
    v_claimed_reward NUMERIC := 0;
    v_available_reward NUMERIC := 0;
    v_reward_level TEXT := 'none';
BEGIN
    -- 1. 获取今日累计观看时长
    SELECT COALESCE(total_seconds, 0) INTO v_total_seconds
    FROM public.user_daily_watch_time
    WHERE user_id = p_user_id AND watch_date = v_today;

    -- 2. 检查今日已领取的奖励档位（使用北京时间判断）
    SELECT COALESCE(SUM(amount), 0) INTO v_claimed_reward
    FROM public.coin_transactions
    WHERE user_id = p_user_id
      AND type = 'watch_time_reward'
      AND (created_at AT TIME ZONE 'Asia/Shanghai')::DATE = v_today; -- 🎯 使用北京时间
    
    -- 🎯 检查每个档位是否已领取
    SELECT EXISTS(
        SELECT 1 FROM public.coin_transactions
        WHERE user_id = p_user_id
          AND type = 'watch_time_reward'
          AND (created_at AT TIME ZONE 'Asia/Shanghai')::DATE = v_today -- 🎯 使用北京时间
          AND description LIKE '%5min%'
    ) INTO v_claimed_5min;
    
    SELECT EXISTS(
        SELECT 1 FROM public.coin_transactions
        WHERE user_id = p_user_id
          AND type = 'watch_time_reward'
          AND (created_at AT TIME ZONE 'Asia/Shanghai')::DATE = v_today -- 🎯 使用北京时间
          AND description LIKE '%15min%'
    ) INTO v_claimed_15min;
    
    SELECT EXISTS(
        SELECT 1 FROM public.coin_transactions
        WHERE user_id = p_user_id
          AND type = 'watch_time_reward'
          AND (created_at AT TIME ZONE 'Asia/Shanghai')::DATE = v_today -- 🎯 使用北京时间
          AND description LIKE '%30min%'
    ) INTO v_claimed_30min;

    -- 3. 根据累计时长和已领取情况确定可领取的奖励档位
    IF v_total_seconds >= 1800 AND NOT v_claimed_30min THEN
        v_available_reward := 50.00;
        v_reward_level := '30min';
    ELSIF v_total_seconds >= 900 AND NOT v_claimed_15min THEN
        v_available_reward := 20.00;
        v_reward_level := '15min';
    ELSIF v_total_seconds >= 300 AND NOT v_claimed_5min THEN
        v_available_reward := 5.00;
        v_reward_level := '5min';
    END IF;

    RETURN jsonb_build_object(
        'total_seconds', v_total_seconds,
        'total_minutes', ROUND(v_total_seconds / 60.0, 1),
        'claimed_reward', v_claimed_reward,
        'available_reward', v_available_reward,
        'reward_level', v_reward_level,
        'watch_date', v_today,
        'can_claim', v_available_reward > 0
    );
END;
$$;

-- 2. 修改领取观看时长奖励函数（使用北京时间）
CREATE OR REPLACE FUNCTION public.claim_watch_time_reward(p_user_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_today DATE := (NOW() AT TIME ZONE 'Asia/Shanghai')::DATE; -- 🎯 使用北京时间
    v_total_seconds INT := 0;
    v_claimed_5min BOOLEAN := FALSE;
    v_claimed_15min BOOLEAN := FALSE;
    v_claimed_30min BOOLEAN := FALSE;
    v_reward_amount NUMERIC := 0;
    v_reward_level TEXT := 'none';
    v_final_balance NUMERIC;
    v_today_total_claimed NUMERIC := 0;
BEGIN
    -- 1. 获取今日累计观看时长
    SELECT COALESCE(total_seconds, 0) INTO v_total_seconds
    FROM public.user_daily_watch_time
    WHERE user_id = p_user_id AND watch_date = v_today;

    -- 1.5. 获取今日累计已领金额（使用北京时间）
    SELECT COALESCE(SUM(amount), 0) INTO v_today_total_claimed
    FROM public.coin_transactions
    WHERE user_id = p_user_id
      AND type = 'watch_time_reward'
      AND (created_at AT TIME ZONE 'Asia/Shanghai')::DATE = v_today; -- 🎯 使用北京时间

    -- 2. 检查每个档位是否已领取（使用北京时间）
    SELECT EXISTS(
        SELECT 1 FROM public.coin_transactions
        WHERE user_id = p_user_id
          AND type = 'watch_time_reward'
          AND (created_at AT TIME ZONE 'Asia/Shanghai')::DATE = v_today -- 🎯 使用北京时间
          AND description LIKE '%5min%'
    ) INTO v_claimed_5min;
    
    SELECT EXISTS(
        SELECT 1 FROM public.coin_transactions
        WHERE user_id = p_user_id
          AND type = 'watch_time_reward'
          AND (created_at AT TIME ZONE 'Asia/Shanghai')::DATE = v_today -- 🎯 使用北京时间
          AND description LIKE '%15min%'
    ) INTO v_claimed_15min;
    
    SELECT EXISTS(
        SELECT 1 FROM public.coin_transactions
        WHERE user_id = p_user_id
          AND type = 'watch_time_reward'
          AND (created_at AT TIME ZONE 'Asia/Shanghai')::DATE = v_today -- 🎯 使用北京时间
          AND description LIKE '%30min%'
    ) INTO v_claimed_30min;

    -- 3. 根据累计时长和已领取情况确定奖励金额
    IF v_total_seconds >= 1800 AND NOT v_claimed_30min THEN
        v_reward_amount := 50.00;
        v_reward_level := '30min';
    ELSIF v_total_seconds >= 900 AND NOT v_claimed_15min THEN
        v_reward_amount := 20.00;
        v_reward_level := '15min';
    ELSIF v_total_seconds >= 300 AND NOT v_claimed_5min THEN
        v_reward_amount := 5.00;
        v_reward_level := '5min';
    ELSE
        RETURN jsonb_build_object(
            'success', false,
            'message', '当前没有可领取的奖励档位',
            'current_seconds', v_total_seconds,
            'claimed_5min', v_claimed_5min,
            'claimed_15min', v_claimed_15min,
            'claimed_30min', v_claimed_30min
        );
    END IF;

    -- 4. 发放奖励
    UPDATE public.profiles
    SET balance_coins = balance_coins + v_reward_amount
    WHERE id = p_user_id
    RETURNING balance_coins INTO v_final_balance;

    -- 5. 记录流水
    INSERT INTO public.coin_transactions (user_id, amount, balance_after, type, description)
    VALUES (
        p_user_id,
        v_reward_amount,
        v_final_balance,
        'watch_time_reward',
        '观看时长奖励: ' || v_reward_level || ' (' || ROUND(v_total_seconds / 60.0, 1) || '分钟)'
    );

    RETURN jsonb_build_object(
        'success', true,
        'reward_amount', v_reward_amount,
        'reward_level', v_reward_level,
        'total_seconds', v_total_seconds,
        'balance_after', v_final_balance,
        'today_total_claimed', v_today_total_claimed + v_reward_amount
    );
END;
$$;

-- 3. 修改记录观看时长函数（使用北京时间）
CREATE OR REPLACE FUNCTION public.record_watch_time(
    p_user_id UUID,
    p_seconds INT
) RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_today DATE := (NOW() AT TIME ZONE 'Asia/Shanghai')::DATE; -- 🎯 使用北京时间
BEGIN
    -- 插入或更新今日观看时长
    INSERT INTO public.user_daily_watch_time (user_id, watch_date, total_seconds)
    VALUES (p_user_id, v_today, p_seconds)
    ON CONFLICT (user_id, watch_date)
    DO UPDATE SET total_seconds = user_daily_watch_time.total_seconds + EXCLUDED.total_seconds;
END;
$$;

