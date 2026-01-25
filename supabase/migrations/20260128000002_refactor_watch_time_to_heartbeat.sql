-- 🎯 重构观看时长系统：改为简单的心跳机制
-- 1. 打开app就开始计时
-- 2. 1分钟发送1次心跳
-- 3. 每次心跳累加60秒
-- 4. 移除Presence相关函数

-- 1. 创建简单的心跳累加函数（每次累加60秒）
CREATE OR REPLACE FUNCTION public.increment_watch_time_heartbeat(
    p_user_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_today DATE := (NOW() AT TIME ZONE 'Asia/Shanghai')::DATE;
    v_new_total_seconds INT;
    v_last_heartbeat_at TIMESTAMPTZ;
    v_time_since_last_heartbeat INTERVAL;
BEGIN
    -- 🚨 安全验证：检查距离上次心跳是否至少50秒（允许1分钟±10秒的误差）
    SELECT last_updated_at INTO v_last_heartbeat_at
    FROM public.user_daily_watch_time
    WHERE user_id = p_user_id
      AND watch_date = v_today
    ORDER BY last_updated_at DESC
    LIMIT 1
    FOR UPDATE SKIP LOCKED; -- 锁定记录，防止并发
    
    IF v_last_heartbeat_at IS NOT NULL THEN
        v_time_since_last_heartbeat := NOW() - v_last_heartbeat_at;
        -- 距离上次心跳必须至少50秒（允许1分钟±10秒的误差，防止过快请求）
        IF v_time_since_last_heartbeat < INTERVAL '50 seconds' THEN
            RETURN jsonb_build_object(
                'success', false,
                'message', '心跳过于频繁',
                'time_since_last', EXTRACT(EPOCH FROM v_time_since_last_heartbeat)::INTEGER
            );
        END IF;
    END IF;

    -- 🎯 累加60秒观看时长
    INSERT INTO public.user_daily_watch_time (
        user_id, 
        watch_date, 
        total_seconds, 
        last_updated_at
    )
    VALUES (p_user_id, v_today, 60, NOW())
    ON CONFLICT (user_id, watch_date)
    DO UPDATE SET 
        total_seconds = COALESCE(user_daily_watch_time.total_seconds, 0) + 60,
        last_updated_at = NOW()
    RETURNING total_seconds INTO v_new_total_seconds;

    RETURN jsonb_build_object(
        'success', true,
        'total_seconds', v_new_total_seconds,
        'watch_date', v_today,
        'added_seconds', 60
    );
END;
$$;

COMMENT ON FUNCTION public.increment_watch_time_heartbeat IS '🎯 观看时长心跳：每次累加60秒，距离上次心跳至少50秒（允许1分钟±10秒误差）';

-- 2. 创建IP和用户关系表（用于记录领取奖励时的IP）
CREATE TABLE IF NOT EXISTS public.watch_time_reward_ips (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    ip_address TEXT NOT NULL,
    reward_date DATE NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(user_id, ip_address, reward_date)
);

CREATE INDEX IF NOT EXISTS idx_watch_time_reward_ips_ip_date ON public.watch_time_reward_ips(ip_address, reward_date);
CREATE INDEX IF NOT EXISTS idx_watch_time_reward_ips_user_date ON public.watch_time_reward_ips(user_id, reward_date);

COMMENT ON TABLE public.watch_time_reward_ips IS '记录观看时长奖励领取时的IP地址，用于IP限制（1个IP最多3个账号）';

-- 启用RLS
ALTER TABLE public.watch_time_reward_ips ENABLE ROW LEVEL SECURITY;

-- RLS策略：允许service_role操作
CREATE POLICY "Service role can manage watch time reward IPs" 
ON public.watch_time_reward_ips 
FOR ALL 
USING (current_user = 'service_role' OR current_user = 'postgres')
WITH CHECK (current_user = 'service_role' OR current_user = 'postgres');

-- 3. 添加IP限制函数：检查1个IP最多3个账号领取时长奖励
CREATE OR REPLACE FUNCTION public.check_ip_watch_time_reward_limit(
    p_user_id UUID,
    p_ip_address TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_today DATE := (NOW() AT TIME ZONE 'Asia/Shanghai')::DATE;
    v_ip_account_count INTEGER;
    v_user_already_claimed BOOLEAN;
BEGIN
    -- 检查该IP今日已领取奖励的不同账号数量
    SELECT COUNT(DISTINCT user_id) INTO v_ip_account_count
    FROM public.watch_time_reward_ips
    WHERE ip_address = p_ip_address
      AND reward_date = v_today;
    
    -- 检查当前用户是否已经领取过（如果已领取，允许继续领取其他档位）
    SELECT EXISTS(
        SELECT 1 FROM public.coin_transactions
        WHERE user_id = p_user_id
          AND type = 'watch_time_reward'
          AND (created_at AT TIME ZONE 'Asia/Shanghai')::DATE = v_today
    ) INTO v_user_already_claimed;
    
    -- 如果该IP已经有3个不同账号领取过，且当前用户未领取过，则拒绝
    IF v_ip_account_count >= 3 AND NOT v_user_already_claimed THEN
        RETURN jsonb_build_object(
            'success', false,
            'allowed', false,
            'message', '该IP今日已有3个账号领取过奖励',
            'ip_account_count', v_ip_account_count
        );
    END IF;
    
    RETURN jsonb_build_object(
        'success', true,
        'allowed', true,
        'ip_account_count', v_ip_account_count
    );
END;
$$;

COMMENT ON FUNCTION public.check_ip_watch_time_reward_limit IS '🚨 IP限制：检查1个IP最多3个账号领取时长奖励';

-- 3. 更新 claim_watch_time_reward 函数，添加IP限制检查
CREATE OR REPLACE FUNCTION public.claim_watch_time_reward(p_user_id UUID, p_ip_address TEXT DEFAULT NULL)
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
    v_ip_check_result JSONB;
BEGIN
    -- 🚨 安全验证：只能为自己领取
    IF p_user_id != auth.uid() THEN
        RETURN jsonb_build_object('success', false, 'message', '非法操作：只能为自己领取奖励');
    END IF;

    -- 🚨 IP限制检查：1个IP最多3个账号领取
    IF p_ip_address IS NOT NULL THEN
        SELECT public.check_ip_watch_time_reward_limit(p_user_id, p_ip_address) INTO v_ip_check_result;
        IF v_ip_check_result->>'allowed' = 'false' THEN
            RETURN jsonb_build_object(
                'success', false,
                'message', COALESCE(v_ip_check_result->>'message', 'IP限制：该IP今日已有3个账号领取过奖励')
            );
        END IF;
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

    -- 🚨 记录IP和用户关系（用于IP限制）
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
        'total_seconds', v_total_seconds,
        'balance_after', v_final_balance,
        'today_total_claimed', v_today_total_claimed + v_reward_amount
    );
END;
$$;

COMMENT ON FUNCTION public.claim_watch_time_reward IS '🎯 领取观看时长奖励：添加IP限制（1个IP最多3个账号）';
