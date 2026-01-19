-- 🎯 修改观看时长奖励：从任务表读取配置
-- 目标：让观看时长奖励的金额和阈值可以从任务表配置，便于后台管理

-- 1. 修改获取观看时长奖励状态函数（从任务表读取配置）
CREATE OR REPLACE FUNCTION public.get_watch_time_reward_status(p_user_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_today DATE := (NOW() AT TIME ZONE 'Asia/Shanghai')::DATE; -- 🎯 使用北京时间
    v_total_seconds INT := 0;
    v_claimed_reward NUMERIC := 0;
    v_available_reward NUMERIC := 0;
    v_reward_level TEXT := 'none';
    v_reward_code TEXT := NULL;
    v_task_rule RECORD;
    v_claimed BOOLEAN;
BEGIN
    -- 1. 获取今日累计观看时长
    SELECT COALESCE(total_seconds, 0) INTO v_total_seconds
    FROM public.user_daily_watch_time
    WHERE user_id = p_user_id AND watch_date = v_today;

    -- 2. 检查今日已领取的奖励总额（使用北京时间判断）
    SELECT COALESCE(SUM(amount), 0) INTO v_claimed_reward
    FROM public.coin_transactions
    WHERE user_id = p_user_id
      AND type = 'watch_time_reward'
      AND (created_at AT TIME ZONE 'Asia/Shanghai')::DATE = v_today; -- 🎯 使用北京时间
    
    -- 3. 🎯 从任务表查询所有观看时长任务（按阈值从低到高排序）
    FOR v_task_rule IN 
        SELECT code, name, threshold, reward_usdt
        FROM public.incentive_rules
        WHERE rule_type = 'watch_time'
          AND is_active = TRUE
          AND (start_at IS NULL OR start_at <= NOW())
          AND (end_at IS NULL OR end_at >= NOW())
        ORDER BY threshold ASC
    LOOP
        -- 检查该档位是否已领取（通过 description 中的 code 匹配）
        SELECT EXISTS(
            SELECT 1 FROM public.coin_transactions
            WHERE user_id = p_user_id
              AND type = 'watch_time_reward'
              AND (created_at AT TIME ZONE 'Asia/Shanghai')::DATE = v_today
              AND description LIKE '%' || v_task_rule.code || '%'
        ) INTO v_claimed;
        
        -- 如果达到阈值且未领取，则返回该档位
        IF v_total_seconds >= v_task_rule.threshold AND NOT v_claimed THEN
            v_available_reward := v_task_rule.reward_usdt;
            v_reward_level := v_task_rule.name;
            v_reward_code := v_task_rule.code;
            EXIT; -- 找到第一个可领取的档位就退出
        END IF;
    END LOOP;

    RETURN jsonb_build_object(
        'total_seconds', v_total_seconds,
        'total_minutes', ROUND(v_total_seconds / 60.0, 1),
        'claimed_reward', v_claimed_reward,
        'available_reward', v_available_reward,
        'reward_level', v_reward_level,
        'reward_code', v_reward_code,
        'watch_date', v_today,
        'can_claim', v_available_reward > 0
    );
END;
$$;

-- 2. 修改领取观看时长奖励函数（从任务表读取配置）
CREATE OR REPLACE FUNCTION public.claim_watch_time_reward(p_user_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_today DATE := (NOW() AT TIME ZONE 'Asia/Shanghai')::DATE;
    v_total_seconds INT := 0;
    v_reward_amount NUMERIC := 0;
    v_reward_level TEXT := 'none';
    v_reward_code TEXT := NULL;
    v_final_balance NUMERIC;
    v_today_total_claimed NUMERIC := 0;
    v_task_rule RECORD;
    v_claimed BOOLEAN;
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

    -- 1.5. 获取今日累计已领金额（使用北京时间）
    SELECT COALESCE(SUM(amount), 0) INTO v_today_total_claimed
    FROM public.coin_transactions
    WHERE user_id = p_user_id
      AND type = 'watch_time_reward'
      AND (created_at AT TIME ZONE 'Asia/Shanghai')::DATE = v_today;

    -- 🎯 4. 从任务表查询所有观看时长任务（按阈值从低到高排序）
    FOR v_task_rule IN 
        SELECT code, name, threshold, reward_usdt
        FROM public.incentive_rules
        WHERE rule_type = 'watch_time'
          AND is_active = TRUE
          AND (start_at IS NULL OR start_at <= NOW())
          AND (end_at IS NULL OR end_at >= NOW())
        ORDER BY threshold ASC
    LOOP
        -- 检查该档位是否已领取（通过 description 中的 code 匹配）
        SELECT EXISTS(
            SELECT 1 FROM public.coin_transactions
            WHERE user_id = p_user_id
              AND type = 'watch_time_reward'
              AND (created_at AT TIME ZONE 'Asia/Shanghai')::DATE = v_today
              AND description LIKE '%' || v_task_rule.code || '%'
        ) INTO v_claimed;
        
        -- 如果达到阈值且未领取，则使用该档位
        IF v_total_seconds >= v_task_rule.threshold AND NOT v_claimed THEN
            v_reward_amount := v_task_rule.reward_usdt;
            v_reward_level := v_task_rule.name;
            v_reward_code := v_task_rule.code;
            EXIT; -- 找到第一个可领取的档位就退出
        END IF;
    END LOOP;

    -- 🚨 5. 如果没有找到可领取的档位
    IF v_reward_amount = 0 OR v_reward_code IS NULL THEN
        RETURN jsonb_build_object(
            'success', false,
            'message', '当前没有可领取的奖励档位',
            'current_seconds', v_total_seconds
        );
    END IF;

    -- 🚨 6. 双重检查：再次验证该档位是否真的未领取（防止在检查后、插入前被其他请求领取）
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

    -- 🚨 7. 原子性更新余额和插入交易记录（在同一个事务中）
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
        '观看时长奖励: ' || v_reward_level || ' (' || v_reward_code || ', ' || ROUND(v_total_seconds / 60.0, 1) || '分钟)'
    );

    RETURN jsonb_build_object(
        'success', true,
        'reward_amount', v_reward_amount,
        'reward_level', v_reward_level,
        'reward_code', v_reward_code,
        'total_seconds', v_total_seconds,
        'balance_after', v_final_balance,
        'today_total_claimed', v_today_total_claimed + v_reward_amount
    );
END;
$$;

COMMENT ON FUNCTION public.claim_watch_time_reward IS '🎯 从任务表读取观看时长奖励配置，支持后台动态调整奖励金额和阈值';
COMMENT ON FUNCTION public.get_watch_time_reward_status IS '🎯 从任务表读取观看时长奖励配置，支持后台动态调整奖励金额和阈值';
