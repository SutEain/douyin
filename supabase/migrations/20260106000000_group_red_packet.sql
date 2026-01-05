-- 1. 红包主表
CREATE TABLE IF NOT EXISTS public.group_red_packets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    sender_id UUID NOT NULL REFERENCES public.profiles(id),
    group_id BIGINT NOT NULL,
    type TEXT NOT NULL CHECK (type IN ('single', 'equal', 'lucky')),
    total_amount NUMERIC NOT NULL CHECK (total_amount > 0),
    total_count INT NOT NULL DEFAULT 1 CHECK (total_count > 0),
    remaining_amount NUMERIC NOT NULL,
    remaining_count INT NOT NULL,
    target_user_id UUID REFERENCES public.profiles(id), -- 仅用于 type='single'
    status TEXT DEFAULT 'active' CHECK (status IN ('active', 'completed', 'expired')),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    expired_at TIMESTAMPTZ DEFAULT (NOW() + INTERVAL '24 hours')
);

-- 2. 领取记录表
CREATE TABLE IF NOT EXISTS public.group_red_packet_claims (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    packet_id UUID NOT NULL REFERENCES public.group_red_packets(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES public.profiles(id),
    amount NUMERIC NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(packet_id, user_id)
);

-- 3. 创建红包函数
CREATE OR REPLACE FUNCTION public.create_group_red_packet(
    p_sender_id UUID,
    p_group_id BIGINT,
    p_type TEXT,
    p_total_amount NUMERIC,
    p_total_count INT,
    p_target_user_id UUID DEFAULT NULL
) RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_current_balance NUMERIC;
    v_final_balance NUMERIC;
    v_packet_id UUID;
BEGIN
    -- 0. 最小金额限制 (平均每份至少 1 抖币)
    IF (p_total_amount / p_total_count) < 1 THEN
        RETURN json_build_object('success', false, 'message', '发红包失败：平均每份红包金额不能低于 1 抖币');
    END IF;

    -- 1. 锁定并检查余额
    SELECT balance_coins INTO v_current_balance FROM public.profiles WHERE id = p_sender_id FOR UPDATE;
    IF v_current_balance < p_total_amount THEN
        RETURN json_build_object('success', false, 'message', '余额不足');
    END IF;

    -- 2. 扣除余额
    UPDATE public.profiles 
    SET balance_coins = balance_coins - p_total_amount 
    WHERE id = p_sender_id 
    RETURNING balance_coins INTO v_final_balance;

    -- 3. 创建红包记录
    INSERT INTO public.group_red_packets (
        sender_id, group_id, type, total_amount, total_count, 
        remaining_amount, remaining_count, target_user_id
    ) VALUES (
        p_sender_id, p_group_id, p_type, p_total_amount, p_total_count,
        p_total_amount, p_total_count, p_target_user_id
    ) RETURNING id INTO v_packet_id;

    -- 4. 记录流水
    INSERT INTO public.coin_transactions (user_id, amount, balance_after, type, description, related_id)
    VALUES (
        p_sender_id, -p_total_amount, v_final_balance, 'hb_out', 
        '群红包发出: ' || p_type || ' (' || p_total_count || '份)', 
        v_packet_id
    );

    RETURN json_build_object('success', true, 'packet_id', v_packet_id, 'balance_after', v_final_balance);
END;
$$;

-- 4. 抢红包函数
CREATE OR REPLACE FUNCTION public.claim_group_red_packet(
    p_packet_id UUID,
    p_user_id UUID
) RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_packet RECORD;
    v_claim_amount NUMERIC;
    v_final_balance NUMERIC;
    v_lucky_max NUMERIC;
BEGIN
    -- 1. 锁定红包记录
    SELECT * INTO v_packet FROM public.group_red_packets WHERE id = p_packet_id FOR UPDATE;
    
    IF NOT FOUND THEN
        RETURN json_build_object('success', false, 'message', '红包不存在');
    END IF;

    IF v_packet.status <> 'active' OR v_packet.remaining_count <= 0 THEN
        RETURN json_build_object('success', false, 'message', '红包已领完或已失效');
    END IF;

    -- 2. 权限校验
    IF v_packet.type = 'single' AND v_packet.target_user_id <> p_user_id THEN
        RETURN json_build_object('success', false, 'message', '这是给别人的私有红包哦');
    END IF;

    -- 3. 检查是否领过
    IF EXISTS (SELECT 1 FROM public.group_red_packet_claims WHERE packet_id = p_packet_id AND user_id = p_user_id) THEN
        RETURN json_build_object('success', false, 'message', '你已经领过这个红包了');
    END IF;

    -- 4. 计算金额
    IF v_packet.remaining_count = 1 THEN
        -- 最后一个包，全给
        v_claim_amount := v_packet.remaining_amount;
    ELSIF v_packet.type = 'equal' OR v_packet.type = 'single' THEN
        -- 平分或指定
        v_claim_amount := ROUND(v_packet.total_amount / v_packet.total_count, 2);
    ELSE
        -- 拼手气 (二倍均值法)
        -- 剩余金额 / 剩余份数 * 2，且最小 0.01，最大不超过剩余总额 - (剩余份数-1)*0.01
        v_lucky_max := (v_packet.remaining_amount / v_packet.remaining_count) * 2;
        v_claim_amount := ROUND(CAST(0.01 + (random() * (v_lucky_max - 0.01)) AS NUMERIC), 2);
        
        -- 边界安全检查
        IF v_claim_amount >= v_packet.remaining_amount THEN
            v_claim_amount := ROUND(v_packet.remaining_amount - (v_packet.remaining_count - 1) * 0.01, 2);
        END IF;
    END IF;

    -- 再次兜底校验金额
    IF v_claim_amount <= 0 THEN v_claim_amount := 0.01; END IF;

    -- 5. 执行更新
    UPDATE public.group_red_packets 
    SET remaining_amount = remaining_amount - v_claim_amount,
        remaining_count = remaining_count - 1,
        status = CASE WHEN remaining_count - 1 = 0 THEN 'completed' ELSE 'active' END,
        updated_at = NOW()
    WHERE id = p_packet_id;

    INSERT INTO public.group_red_packet_claims (packet_id, user_id, amount)
    VALUES (p_packet_id, p_user_id, v_claim_amount);

    UPDATE public.profiles 
    SET balance_coins = balance_coins + v_claim_amount 
    WHERE id = p_user_id 
    RETURNING balance_coins INTO v_final_balance;

    -- 6. 记录流水
    INSERT INTO public.coin_transactions (user_id, amount, balance_after, type, description, related_id)
    VALUES (
        p_user_id, v_claim_amount, v_final_balance, 'hb_in', 
        '群红包领取: 来自 ' || (SELECT nickname FROM public.profiles WHERE id = v_packet.sender_id), 
        p_packet_id
    );

    RETURN json_build_object(
        'success', true, 
        'amount', v_claim_amount, 
        'remaining_count', v_packet.remaining_count - 1,
        'is_completed', (v_packet.remaining_count - 1 = 0)
    );
END;
$$;

-- 5. 红包过期退回函数
CREATE OR REPLACE FUNCTION public.refund_expired_red_packets()
RETURNS TABLE (packet_id UUID, sender_id UUID, refund_amount NUMERIC)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_packet RECORD;
    v_final_balance NUMERIC;
BEGIN
    FOR v_packet IN 
        SELECT id, sender_id, remaining_amount 
        FROM public.group_red_packets 
        WHERE status = 'active' AND expired_at < NOW() AND remaining_amount > 0
        FOR UPDATE SKIP LOCKED
    LOOP
        -- 1. 更新红包状态
        UPDATE public.group_red_packets SET status = 'expired' WHERE id = v_packet.id;
        
        -- 2. 退回余额给发送者
        UPDATE public.profiles 
        SET balance_coins = balance_coins + v_packet.remaining_amount 
        WHERE id = v_packet.sender_id 
        RETURNING balance_coins INTO v_final_balance;
        
        -- 3. 记录流水
        INSERT INTO public.coin_transactions (user_id, amount, balance_after, type, description, related_id)
        VALUES (
            v_packet.sender_id, v_packet.remaining_amount, v_final_balance, 'hb_refund', 
            '群红包过期退回', v_packet.id
        );
        
        packet_id := v_packet.id;
        sender_id := v_packet.sender_id;
        refund_amount := v_packet.remaining_amount;
        RETURN NEXT;
    END LOOP;
END;
$$;

-- 6. 配置定时任务 (pg_cron)
-- 开启扩展
CREATE EXTENSION IF NOT EXISTS pg_cron;

-- 每 30 分钟自动执行一次退款检查
-- 这种方式完全在数据库内部运行，无需外部脚本
SELECT cron.schedule(
    'refund-expired-red-packets-job', -- 任务名称
    '*/30 * * * *',                  -- 每 30 分钟执行 (Cron 表达式)
    $$ SELECT public.refund_expired_red_packets() $$
);



