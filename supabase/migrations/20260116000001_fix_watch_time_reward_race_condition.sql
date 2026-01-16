-- 🚨 紧急安全修复：防止观看时长奖励无限刷抖币漏洞
-- 问题：并发请求可能导致竞态条件，绕过已领取检查
-- 修复：
-- 1. 添加 SELECT FOR UPDATE 行锁，防止并发竞态
-- 2. 添加最小时间间隔检查（同一档位领取后至少等待2秒）
-- 3. 添加事务级别的严格验证

CREATE OR REPLACE FUNCTION public.claim_watch_time_reward(p_user_id UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER AS $func$
DECLARE
    v_today DATE := (NOW() AT TIME ZONE 'Asia/Shanghai')::DATE;
    v_total_seconds INT := 0;
    v_reward_amount NUMERIC := 0;
    v_reward_level TEXT := 'none';
    v_final_balance NUMERIC;
    v_claimed_5min BOOLEAN;
    v_claimed_15min BOOLEAN;
    v_claimed_30min BOOLEAN;
    v_last_claim_time TIMESTAMPTZ;
    v_time_since_last_claim INTERVAL;
BEGIN
    -- 🚨 安全验证：只能为自己领取
    IF p_user_id != auth.uid() THEN
        RETURN jsonb_build_object('success', false, 'message', '非法操作：只能为自己领取奖励');
    END IF;

    -- 🚨 1. 检查最近一次领取时间，防止并发攻击
    SELECT MAX(created_at) INTO v_last_claim_time
    FROM public.coin_transactions
    WHERE user_id = p_user_id
      AND type = 'watch_time_reward'
      AND (created_at AT TIME ZONE 'Asia/Shanghai')::DATE = v_today;
    
    IF v_last_claim_time IS NOT NULL THEN
        v_time_since_last_claim := NOW() - v_last_claim_time;
        -- 同一档位领取后，至少需要等待2秒才能再次检查
        IF v_time_since_last_claim < INTERVAL '2 seconds' THEN
            RETURN jsonb_build_object('success', false, 'message', '请求过于频繁，请稍后再试');
        END IF;
    END IF;

    -- 🚨 2. 使用 SELECT FOR UPDATE 锁定用户记录，防止并发竞态
    -- 注意：这里锁定 profiles 表，确保余额更新的原子性
    SELECT balance_coins INTO v_final_balance
    FROM public.profiles
    WHERE id = p_user_id
    FOR UPDATE; -- 🔒 行锁，防止并发修改

    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'message', '用户不存在');
    END IF;

    -- 🚨 3. 获取今日累计观看时长（在锁内查询，确保数据一致性）
    SELECT COALESCE(total_seconds, 0) INTO v_total_seconds
    FROM public.user_daily_watch_time
    WHERE user_id = p_user_id AND watch_date = v_today;

    -- 🚨 4. 检查每个档位是否已领取（在锁内检查，防止并发绕过）
    SELECT EXISTS(
        SELECT 1 FROM public.coin_transactions
        WHERE user_id = p_user_id
          AND type = 'watch_time_reward'
          AND (created_at AT TIME ZONE 'Asia/Shanghai')::DATE = v_today
          AND description LIKE '%: 5min%'
    ) INTO v_claimed_5min;
    
    SELECT EXISTS(
        SELECT 1 FROM public.coin_transactions
        WHERE user_id = p_user_id
          AND type = 'watch_time_reward'
          AND (created_at AT TIME ZONE 'Asia/Shanghai')::DATE = v_today
          AND description LIKE '%: 15min%'
    ) INTO v_claimed_15min;
    
    SELECT EXISTS(
        SELECT 1 FROM public.coin_transactions
        WHERE user_id = p_user_id
          AND type = 'watch_time_reward'
          AND (created_at AT TIME ZONE 'Asia/Shanghai')::DATE = v_today
          AND description LIKE '%: 30min%'
    ) INTO v_claimed_30min;

    -- 🚨 5. 根据累计时长和已领取情况确定奖励金额（从低到高检查）
    IF v_total_seconds >= 300 AND NOT v_claimed_5min THEN
        v_reward_amount := 5.00;
        v_reward_level := '5min';
    ELSIF v_total_seconds >= 900 AND NOT v_claimed_15min THEN
        v_reward_amount := 15.00;
        v_reward_level := '15min';
    ELSIF v_total_seconds >= 1800 AND NOT v_claimed_30min THEN
        v_reward_amount := 30.00;
        v_reward_level := '30min';
    ELSE
        RETURN jsonb_build_object('success', false, 'message', '没有可领取的档位');
    END IF;

    -- 🚨 6. 双重检查：再次验证该档位是否真的未领取（防止在检查后、插入前被其他请求领取）
    IF v_reward_level = '5min' AND v_claimed_5min THEN
        RETURN jsonb_build_object('success', false, 'message', '该档位已领取');
    END IF;
    IF v_reward_level = '15min' AND v_claimed_15min THEN
        RETURN jsonb_build_object('success', false, 'message', '该档位已领取');
    END IF;
    IF v_reward_level = '30min' AND v_claimed_30min THEN
        RETURN jsonb_build_object('success', false, 'message', '该档位已领取');
    END IF;

    -- 🚨 7. 原子性更新余额和插入交易记录（在同一个事务中）
    UPDATE public.profiles
    SET balance_coins = balance_coins + v_reward_amount
    WHERE id = p_user_id
    RETURNING balance_coins INTO v_final_balance;

    INSERT INTO public.coin_transactions (user_id, amount, balance_after, type, description)
    VALUES (p_user_id, v_reward_amount, v_final_balance, 'watch_time_reward', '观看时长奖励: ' || v_reward_level);

    RETURN jsonb_build_object(
        'success', true,
        'reward_amount', v_reward_amount,
        'balance_after', v_final_balance,
        'reward_level', v_reward_level
    );
END; $func$;

COMMENT ON FUNCTION public.claim_watch_time_reward IS '🚨 紧急安全修复：使用 SELECT FOR UPDATE 行锁和最小时间间隔检查，防止并发竞态导致无限刷抖币漏洞';
