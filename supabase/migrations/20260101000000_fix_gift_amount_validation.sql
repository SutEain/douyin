-- 🎯 安全加固：修复 process_gift_reward 函数，校验金额必须大于 0

CREATE OR REPLACE FUNCTION public.process_gift_reward(
    sender_id UUID,
    receiver_id UUID,
    gift_amount DECIMAL,
    room_or_video_id UUID,
    gift_type TEXT, -- 'live' 或 'video'
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
    -- 🎯 核心安全检查：金额必须大于 0
    IF gift_amount <= 0 THEN
        RETURN json_build_object('success', false, 'message', '打赏金额必须大于 0');
    END IF;

    -- 0. 获取分账比例设置
    SELECT COALESCE(value_int, 50) INTO split_percentage FROM public.system_settings WHERE id = 'gift_split_percentage';

    -- 1. 获取并锁定发送者余额
    SELECT balance_coins INTO current_sender_balance FROM public.profiles WHERE id = sender_id FOR UPDATE;
    
    IF current_sender_balance < gift_amount THEN
        RETURN json_build_object('success', false, 'message', '余额不足');
    END IF;

    -- 2. 计算分成
    receiver_gain := gift_amount * (split_percentage / 100.0);
    platform_commission := gift_amount - receiver_gain;

    -- 3. 扣除发送者抖币
    UPDATE public.profiles 
    SET balance_coins = balance_coins - gift_amount 
    WHERE id = sender_id 
    RETURNING balance_coins INTO final_sender_balance;

    -- 4. 增加接收者抖币
    UPDATE public.profiles 
    SET balance_coins = balance_coins + receiver_gain 
    WHERE id = receiver_id 
    RETURNING balance_coins INTO final_receiver_balance;

    -- 5. 记录发送者流水
    INSERT INTO public.coin_transactions (user_id, amount, balance_after, type, description, related_id)
    VALUES (sender_id, -gift_amount, final_sender_balance, 'gift_out', '打赏礼物: ' || gift_name, room_or_video_id);

    -- 6. 记录接收者流水
    INSERT INTO public.coin_transactions (user_id, amount, balance_after, type, description, related_id)
    VALUES (receiver_id, receiver_gain, final_receiver_balance, 'gift_in', '收到打赏: ' || gift_name, room_or_video_id);

    RETURN json_build_object(
        'success', true, 
        'sender_balance', final_sender_balance,
        'receiver_balance', final_receiver_balance
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 🎯 安全加固：修复 process_withdraw_request 函数，校验提现金额必须大于 0
CREATE OR REPLACE FUNCTION public.process_withdraw_request(
    p_user_id UUID,
    p_amount DECIMAL,
    p_address TEXT,
    p_order_no TEXT
) RETURNS JSON AS $$
DECLARE
    v_balance DECIMAL;
    v_order_id UUID;
BEGIN
    -- 🎯 核心安全检查：金额必须大于 0
    IF p_amount <= 0 THEN
        RETURN json_build_object('success', false, 'message', '提现金额必须大于 0');
    END IF;

    -- 1. 检查并锁定余额
    SELECT balance_coins INTO v_balance FROM public.profiles WHERE id = p_user_id FOR UPDATE;
    
    IF v_balance < p_amount THEN
        RETURN json_build_object('success', false, 'message', '余额不足');
    END IF;

    -- 2. 扣减余额，增加冻结金额
    UPDATE public.profiles 
    SET balance_coins = balance_coins - p_amount,
        frozen_coins = COALESCE(frozen_coins, 0) + p_amount
    WHERE id = p_user_id;

    -- 3. 创建提现订单
    INSERT INTO public.withdraw_orders (user_id, amount, address, order_no, status)
    VALUES (p_user_id, p_amount, p_address, p_order_no, 'pending')
    RETURNING id INTO v_order_id;

    -- 4. 记录流水 (送礼/打赏是 reward, 充值是 recharge, 提现是 withdraw)
    INSERT INTO public.coin_transactions (user_id, amount, balance_after, type, description, related_id)
    VALUES (
        p_user_id, 
        -p_amount, 
        v_balance - p_amount, 
        'withdraw', 
        '提现申请 (单号: ' || p_order_no || ')', 
        v_order_id
    );

    RETURN json_build_object('success', true, 'order_id', v_order_id);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

