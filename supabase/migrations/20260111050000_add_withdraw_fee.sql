-- 提现规则调整：增加50抖币手续费
-- 1. 最低提现：1000抖币
-- 2. 手续费：50抖币
-- 3. 实际到账：(提现金额 - 50) / 100 USDT
-- 例如：提现1000抖币 → 扣除50手续费 → 950抖币 → 9.5 USDT到账

-- 修改 withdraw_orders 表，添加手续费字段
ALTER TABLE public.withdraw_orders
ADD COLUMN IF NOT EXISTS fee_amount DECIMAL(12, 2) DEFAULT 50,
ADD COLUMN IF NOT EXISTS actual_amount DECIMAL(12, 2);

-- 更新现有订单的手续费和实际到账金额（给旧订单补0手续费）
UPDATE public.withdraw_orders
SET fee_amount = 0,
    actual_amount = amount / 100
WHERE fee_amount IS NULL;

-- 重新创建提现处理函数，增加手续费逻辑
CREATE OR REPLACE FUNCTION public.process_withdraw_request(
    p_user_id UUID,
    p_amount DECIMAL,
    p_address TEXT,
    p_order_no TEXT
) RETURNS JSON AS $$
DECLARE
    v_balance DECIMAL;
    v_order_id UUID;
    v_fee_amount DECIMAL := 50; -- 固定手续费50抖币
    v_after_fee_amount DECIMAL;
    v_actual_usdt DECIMAL;
BEGIN
    -- 🎯 1. 最低提现金额检查：1000抖币
    IF p_amount < 1000 THEN
        RETURN json_build_object('success', false, 'message', '最低提现金额为1000抖币');
    END IF;

    -- 🎯 2. 金额必须大于0
    IF p_amount <= 0 THEN
        RETURN json_build_object('success', false, 'message', '提现金额必须大于0');
    END IF;

    -- 🎯 3. 计算扣除手续费后的金额和实际到账USDT
    v_after_fee_amount := p_amount - v_fee_amount;
    v_actual_usdt := v_after_fee_amount / 100; -- 100抖币 = 1 USDT

    -- 4. 检查并锁定余额（需要扣除申请的全额，包括手续费）
    SELECT balance_coins INTO v_balance FROM public.profiles WHERE id = p_user_id FOR UPDATE;
    
    IF v_balance < p_amount THEN
        RETURN json_build_object('success', false, 'message', '余额不足');
    END IF;

    -- 5. 扣减余额，增加冻结金额
    UPDATE public.profiles 
    SET balance_coins = balance_coins - p_amount,
        frozen_coins = COALESCE(frozen_coins, 0) + p_amount
    WHERE id = p_user_id;

    -- 6. 创建提现订单（记录申请金额、手续费、实际到账金额）
    INSERT INTO public.withdraw_orders (
        user_id, 
        amount, 
        fee_amount, 
        actual_amount, 
        address, 
        order_no, 
        status
    )
    VALUES (
        p_user_id, 
        p_amount, 
        v_fee_amount, 
        v_actual_usdt, 
        p_address, 
        p_order_no, 
        'pending'
    )
    RETURNING id INTO v_order_id;

    -- 7. 记录流水（扣除全额，包括手续费）
    INSERT INTO public.coin_transactions (user_id, amount, balance_after, type, description, related_id)
    VALUES (
        p_user_id, 
        -p_amount, 
        v_balance - p_amount, 
        'withdraw', 
        '提现申请 (单号: ' || p_order_no || ', 手续费: ' || v_fee_amount || '抖币)', 
        v_order_id
    );

    RETURN json_build_object(
        'success', true, 
        'order_id', v_order_id,
        'amount', p_amount,
        'fee', v_fee_amount,
        'actual_usdt', v_actual_usdt
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 添加注释
COMMENT ON COLUMN public.withdraw_orders.fee_amount IS '手续费（抖币），固定50抖币';
COMMENT ON COLUMN public.withdraw_orders.actual_amount IS '实际到账金额（USDT）= (申请金额 - 手续费) / 100';
COMMENT ON FUNCTION public.process_withdraw_request IS '提现申请处理：最低1000抖币，手续费50抖币，实际到账=(金额-50)/100 USDT';

