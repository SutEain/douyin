-- 添加红包验证码字段

-- 1. 添加验证码相关字段和消息ID字段
ALTER TABLE public.group_red_packets
ADD COLUMN IF NOT EXISTS verification_question TEXT,
ADD COLUMN IF NOT EXISTS verification_answer TEXT,
ADD COLUMN IF NOT EXISTS origin_message_id BIGINT;

-- 2. 删除并重新创建红包创建函数（添加验证码参数）
DROP FUNCTION IF EXISTS public.create_group_red_packet(UUID, BIGINT, TEXT, NUMERIC, INT, UUID);

CREATE OR REPLACE FUNCTION public.create_group_red_packet(
    p_sender_id UUID,
    p_group_id BIGINT,
    p_type TEXT,
    p_total_amount NUMERIC,
    p_total_count INT,
    p_target_user_id UUID DEFAULT NULL,
    p_verification_answer TEXT DEFAULT NULL,
    p_verification_question TEXT DEFAULT NULL
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

    -- 3. 创建红包记录（包含验证码）
    INSERT INTO public.group_red_packets (
        sender_id, group_id, type, total_amount, total_count, 
        remaining_amount, remaining_count, target_user_id,
        verification_answer, verification_question
    ) VALUES (
        p_sender_id, p_group_id, p_type, p_total_amount, p_total_count,
        p_total_amount, p_total_count, p_target_user_id,
        p_verification_answer, p_verification_question
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

