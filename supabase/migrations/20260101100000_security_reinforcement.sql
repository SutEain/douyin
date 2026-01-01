-- 🎯 1. 创建/更新提现订单的管理员处理函数 (带锁，确保并发安全)
CREATE OR REPLACE FUNCTION public.admin_process_withdraw(
    p_order_id UUID,
    p_admin_id UUID,
    p_action TEXT, -- 'approve' or 'reject'
    p_remark TEXT DEFAULT NULL,
    p_tx_hash TEXT DEFAULT NULL -- 🎯 新增：支持传入交易哈希
) RETURNS JSON 
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_order RECORD;
    v_final_balance NUMERIC;
    v_final_frozen NUMERIC;
    v_is_admin BOOLEAN;
BEGIN
    -- 关键加固：再次校验 p_admin_id 是否真的是管理员
    SELECT is_admin INTO v_is_admin FROM public.profiles WHERE id = p_admin_id;
    IF NOT COALESCE(v_is_admin, FALSE) THEN
        RETURN json_build_object('success', false, 'message', '权限不足：只有管理员可以处理提现');
    END IF;

    -- 锁定订单行
    SELECT * INTO v_order FROM public.withdraw_orders WHERE id = p_order_id FOR UPDATE;
    
    IF NOT FOUND THEN
        RETURN json_build_object('success', false, 'message', '订单不存在');
    END IF;
    
    IF v_order.status != 'pending' THEN
        RETURN json_build_object('success', false, 'message', '订单不是待审核状态');
    END IF;

    IF p_action = 'approve' THEN
        -- 审核通过：扣减冻结金额
        UPDATE public.profiles 
        SET frozen_coins = GREATEST(COALESCE(frozen_coins, 0) - v_order.amount, 0)
        WHERE id = v_order.user_id 
        RETURNING balance_coins, frozen_coins INTO v_final_balance, v_final_frozen;

        UPDATE public.withdraw_orders 
        SET status = 'completed', 
            processed_at = NOW(), 
            processed_by = p_admin_id,
            tx_hash = COALESCE(p_tx_hash, tx_hash), -- ✅ 更新哈希
            remark = COALESCE(p_remark, '管理员已确认打款')
        WHERE id = p_order_id;

    ELSIF p_action = 'reject' THEN
        -- 审核拒绝：退回余额，扣减冻结金额
        UPDATE public.profiles 
        SET balance_coins = balance_coins + v_order.amount,
            frozen_coins = GREATEST(COALESCE(frozen_coins, 0) - v_order.amount, 0)
        WHERE id = v_order.user_id 
        RETURNING balance_coins, frozen_coins INTO v_final_balance, v_final_frozen;

        UPDATE public.withdraw_orders 
        SET status = 'rejected', 
            processed_at = NOW(), 
            processed_by = p_admin_id,
            remark = COALESCE(p_remark, '申请被拒绝，资金已退回')
        WHERE id = p_order_id;

        -- 记录退回流水
        INSERT INTO public.coin_transactions (user_id, amount, balance_after, type, description, related_id)
        VALUES (v_order.user_id, v_order.amount, v_final_balance, 'adjustment', '提现拒绝退回: ' || COALESCE(v_order.order_no, ''), v_order.id);
    ELSE
        RETURN json_build_object('success', false, 'message', '无效的操作类型');
    END IF;

    RETURN json_build_object(
        'success', true, 
        'final_balance', v_final_balance,
        'final_frozen', v_final_frozen
    );
END;
$$;

-- 🎯 2. 创建红包原子发放函数
CREATE OR REPLACE FUNCTION public.send_live_red_packet(
    p_room_id UUID,
    p_sender_id UUID,
    p_total_coins INT,
    p_total_count INT,
    p_packet_type TEXT,
    p_countdown_seconds INT,
    p_claim_conditions JSONB,
    p_unlock_at TIMESTAMP WITH TIME ZONE,
    p_expires_at TIMESTAMP WITH TIME ZONE
) RETURNS JSON 
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_balance NUMERIC;
    v_packet_id UUID;
    v_balance_after NUMERIC;
BEGIN
    -- 1. 检查参数
    IF p_total_coins < 10 THEN
        RETURN json_build_object('success', false, 'message', '红包总金额不能低于 10 抖币');
    END IF;
    IF p_total_count < 1 THEN
        RETURN json_build_object('success', false, 'message', '红包个数至少为 1');
    END IF;

    -- 2. 锁定并检查余额
    SELECT balance_coins INTO v_balance FROM public.profiles WHERE id = p_sender_id FOR UPDATE;
    
    IF v_balance < p_total_coins THEN
        RETURN json_build_object('success', false, 'message', '余额不足');
    END IF;

    -- 3. 扣除余额
    UPDATE public.profiles SET balance_coins = balance_coins - p_total_coins 
    WHERE id = p_sender_id 
    RETURNING balance_coins INTO v_balance_after;

    -- 4. 创建红包记录
    INSERT INTO public.live_red_packets (
        room_id, sender_id, total_coins, total_count, packet_type, 
        countdown_seconds, claim_conditions, remaining_coins, 
        remaining_count, status, unlock_at, expires_at
    )
    VALUES (
        p_room_id, p_sender_id, p_total_coins, p_total_count, p_packet_type,
        p_countdown_seconds, p_claim_conditions, p_total_coins,
        p_total_count, 'pending', p_unlock_at, p_expires_at
    )
    RETURNING id INTO v_packet_id;

    -- 5. 记录资金流水
    INSERT INTO public.coin_transactions (user_id, amount, balance_after, type, description, related_id)
    VALUES (p_sender_id, -p_total_coins, v_balance_after, 'red_packet_send', '直播间发放红包', v_packet_id);

    RETURN json_build_object('success', true, 'packet_id', v_packet_id, 'balance_after', v_balance_after);
END;
$$;

-- 🎯 3. 修改 process_gift_reward 以支持更好的金额锁定
CREATE OR REPLACE FUNCTION public.process_gift_reward(
    sender_id UUID,
    receiver_id UUID,
    gift_amount DECIMAL,
    room_or_video_id UUID,
    gift_type TEXT,
    gift_name TEXT
) RETURNS JSON AS $$
DECLARE
    current_sender_balance DECIMAL;
    receiver_gain DECIMAL;
    platform_commission DECIMAL;
    final_sender_balance DECIMAL;
    final_receiver_balance DECIMAL;
    split_percentage INT;
BEGIN
    IF gift_amount <= 0 THEN
        RETURN json_build_object('success', false, 'message', '打赏金额必须大于 0');
    END IF;

    SELECT COALESCE(value_int, 50) INTO split_percentage FROM public.system_settings WHERE id = 'gift_split_percentage';

    -- 🎯 关键加固：锁定发送者
    SELECT balance_coins INTO current_sender_balance FROM public.profiles WHERE id = sender_id FOR UPDATE;
    
    IF current_sender_balance < gift_amount THEN
        RETURN json_build_object('success', false, 'message', '余额不足');
    END IF;

    receiver_gain := gift_amount * (split_percentage / 100.0);
    platform_commission := gift_amount - receiver_gain;

    UPDATE public.profiles 
    SET balance_coins = balance_coins - gift_amount 
    WHERE id = sender_id 
    RETURNING balance_coins INTO final_sender_balance;

    UPDATE public.profiles 
    SET balance_coins = balance_coins + receiver_gain 
    WHERE id = receiver_id 
    RETURNING balance_coins INTO final_receiver_balance;

    INSERT INTO public.coin_transactions (user_id, amount, balance_after, type, description, related_id)
    VALUES (sender_id, -gift_amount, final_sender_balance, 'gift_out', '打赏礼物: ' || gift_name, room_or_video_id);

    INSERT INTO public.coin_transactions (user_id, amount, balance_after, type, description, related_id)
    VALUES (receiver_id, receiver_gain, final_receiver_balance, 'gift_in', '收到打赏: ' || gift_name, room_or_video_id);

    RETURN json_build_object(
        'success', true, 
        'sender_balance', final_sender_balance,
        'receiver_balance', final_receiver_balance
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

