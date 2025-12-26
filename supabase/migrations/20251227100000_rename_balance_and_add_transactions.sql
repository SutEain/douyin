-- 1. 重命名余额字段
ALTER TABLE public.profiles RENAME COLUMN balance_usdt TO balance_coins;
ALTER TABLE public.profiles RENAME COLUMN frozen_usdt TO frozen_coins;

-- 2. 创建抖币账单流水表
CREATE TABLE IF NOT EXISTS public.coin_transactions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES public.profiles(id) NOT NULL,
    amount DECIMAL(12, 2) NOT NULL, -- 变动金额，正数为入账，负数为支出
    balance_after DECIMAL(12, 2) NOT NULL, -- 变动后余额
    type TEXT NOT NULL, -- recharge(充值), reward(奖励), gift_out(打赏支出), gift_in(打赏收入), withdraw(提现)
    description TEXT, -- 备注信息
    related_id UUID, -- 关联 ID (如直播间 ID 或视频 ID)
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 3. 开启 RLS
ALTER TABLE public.coin_transactions ENABLE ROW LEVEL SECURITY;

-- 4. 只有用户自己能看自己的流水
CREATE POLICY "Users view own transactions" ON public.coin_transactions
    FOR SELECT USING (auth.uid() = user_id);

-- 5. 开启实时监听
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
        ALTER PUBLICATION supabase_realtime ADD TABLE public.coin_transactions;
    END IF;
END $$;

-- 6. 创建专门处理打赏的函数（存储过程），保证原子性
CREATE OR REPLACE FUNCTION process_gift_reward(
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

