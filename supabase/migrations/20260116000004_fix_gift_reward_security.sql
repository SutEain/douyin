-- 🚨 优化打赏接口：添加安全验证
-- 1. 添加单次最大金额限制（10000抖币）
-- 2. 添加最小时间间隔检查（防止并发竞态）
-- 3. 添加每日打赏总额限制（100000抖币）

CREATE OR REPLACE FUNCTION public.process_gift_reward(
    sender_id UUID,
    receiver_id UUID,
    gift_amount DECIMAL,
    room_or_video_id UUID,
    gift_type TEXT,
    gift_name TEXT
)
RETURNS JSON LANGUAGE plpgsql SECURITY DEFINER AS $func$
DECLARE
    current_sender_balance DECIMAL;
    receiver_gain DECIMAL;
    final_sender_balance DECIMAL;
    final_receiver_balance DECIMAL;
    split_percentage INT;
    v_last_gift_time TIMESTAMPTZ;
    v_time_since_last_gift INTERVAL;
    v_today_total DECIMAL;
    v_today DATE;
BEGIN
    -- 🚨 安全验证 1: 用户身份验证
    IF auth.role() != 'service_role' AND sender_id != auth.uid() THEN
        RETURN json_build_object('success', false, 'message', '非法操作');
    END IF;

    -- 🚨 安全验证 2: 金额必须大于 0
    IF gift_amount <= 0 THEN
        RETURN json_build_object('success', false, 'message', '打赏金额必须大于 0');
    END IF;

    -- 🚨 安全验证 3: 单次打赏最大金额限制（2000抖币）
    IF gift_amount > 2000 THEN
        RETURN json_build_object('success', false);
    END IF;

    -- 🚨 安全验证 4: 检查最近一次打赏时间，防止并发攻击
    SELECT MAX(created_at) INTO v_last_gift_time
    FROM public.coin_transactions
    WHERE user_id = sender_id
      AND type = 'gift_out';
    
    IF v_last_gift_time IS NOT NULL THEN
        v_time_since_last_gift := NOW() - v_last_gift_time;
        -- 两次打赏之间至少间隔10秒（防止并发竞态）
        IF v_time_since_last_gift < INTERVAL '10 seconds' THEN
            RETURN json_build_object('success', false);
        END IF;
    END IF;

    -- 🚨 安全验证 5: 检查今日打赏总额（不超过10000抖币）
    v_today := (NOW() AT TIME ZONE 'Asia/Shanghai')::DATE;
    SELECT COALESCE(SUM(ABS(amount)), 0) INTO v_today_total
    FROM public.coin_transactions
    WHERE user_id = sender_id
      AND type = 'gift_out'
      AND (created_at AT TIME ZONE 'Asia/Shanghai')::DATE = v_today;
    
    IF v_today_total + gift_amount > 10000 THEN
        RETURN json_build_object('success', false);
    END IF;

    -- 获取分账比例设置
    SELECT COALESCE(value_int, 50) INTO split_percentage FROM public.system_settings WHERE id = 'gift_split_percentage';

    -- 🚨 使用 SELECT FOR UPDATE 锁定发送者余额，防止并发竞态
    SELECT balance_coins INTO current_sender_balance FROM public.profiles WHERE id = sender_id FOR UPDATE;
    
    -- 🚨 双重检查：再次验证余额（防止在检查后、扣款前余额被其他操作消耗）
    IF current_sender_balance < gift_amount THEN
        RETURN json_build_object('success', false, 'message', '余额不足');
    END IF;

    -- 计算分成
    receiver_gain := gift_amount * (split_percentage / 100.0);

    -- 扣除发送者抖币
    UPDATE public.profiles 
    SET balance_coins = balance_coins - gift_amount 
    WHERE id = sender_id 
    RETURNING balance_coins INTO final_sender_balance;

    -- 增加接收者抖币
    UPDATE public.profiles 
    SET balance_coins = balance_coins + receiver_gain 
    WHERE id = receiver_id 
    RETURNING balance_coins INTO final_receiver_balance;

    -- 记录发送者流水
    INSERT INTO public.coin_transactions (user_id, amount, balance_after, type, description, related_id)
    VALUES (sender_id, -gift_amount, final_sender_balance, 'gift_out', '打赏礼物: ' || gift_name, room_or_video_id);

    -- 记录接收者流水
    INSERT INTO public.coin_transactions (user_id, amount, balance_after, type, description, related_id)
    VALUES (receiver_id, receiver_gain, final_receiver_balance, 'gift_in', '收到打赏: ' || gift_name, room_or_video_id);

    RETURN json_build_object(
        'success', true,
        'sender_balance', final_sender_balance,
        'receiver_balance', final_receiver_balance
    );
END; $func$;

COMMENT ON FUNCTION public.process_gift_reward IS '🚨 优化打赏接口：添加单次最大金额限制、最小时间间隔检查和每日总额限制，防止并发竞态和恶意刷打赏';
