-- 添加今日累计已领金额到观看时长奖励返回值
-- 用户领取奖励时，显示"今日已领XX抖币"

CREATE OR REPLACE FUNCTION public.claim_watch_time_reward(p_user_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_today DATE := CURRENT_DATE;
    v_total_seconds INT := 0;
    v_claimed_5min BOOLEAN := FALSE;
    v_claimed_15min BOOLEAN := FALSE;
    v_claimed_30min BOOLEAN := FALSE;
    v_reward_amount NUMERIC := 0;
    v_reward_level TEXT := 'none';
    v_final_balance NUMERIC;
    v_today_total_claimed NUMERIC := 0; -- 🎯 今日累计已领金额
BEGIN
    -- 1. 获取今日累计观看时长
    SELECT COALESCE(total_seconds, 0) INTO v_total_seconds
    FROM public.user_daily_watch_time
    WHERE user_id = p_user_id AND watch_date = v_today;

    -- 🎯 1.5. 获取今日累计已领金额（在领取前）
    SELECT COALESCE(SUM(amount), 0) INTO v_today_total_claimed
    FROM public.coin_transactions
    WHERE user_id = p_user_id
      AND type = 'watch_time_reward'
      AND DATE(created_at) = v_today;

    -- 2. 检查每个档位是否已领取
    SELECT EXISTS(
        SELECT 1 FROM public.coin_transactions
        WHERE user_id = p_user_id
          AND type = 'watch_time_reward'
          AND DATE(created_at) = v_today
          AND description LIKE '%5min%'
    ) INTO v_claimed_5min;
    
    SELECT EXISTS(
        SELECT 1 FROM public.coin_transactions
        WHERE user_id = p_user_id
          AND type = 'watch_time_reward'
          AND DATE(created_at) = v_today
          AND description LIKE '%15min%'
    ) INTO v_claimed_15min;
    
    SELECT EXISTS(
        SELECT 1 FROM public.coin_transactions
        WHERE user_id = p_user_id
          AND type = 'watch_time_reward'
          AND DATE(created_at) = v_today
          AND description LIKE '%30min%'
    ) INTO v_claimed_30min;

    -- 3. 根据累计时长和已领取情况确定奖励金额（从高到低检查）
    IF v_total_seconds >= 1800 AND NOT v_claimed_30min THEN -- 30分钟，未领取
        v_reward_amount := 50.00;
        v_reward_level := '30min';
    ELSIF v_total_seconds >= 900 AND NOT v_claimed_15min THEN -- 15分钟，未领取
        v_reward_amount := 20.00;
        v_reward_level := '15min';
    ELSIF v_total_seconds >= 300 AND NOT v_claimed_5min THEN -- 5分钟，未领取
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
        'today_total_claimed', v_today_total_claimed + v_reward_amount -- 🎯 今日累计已领（包含本次）
    );
END;
$$;

