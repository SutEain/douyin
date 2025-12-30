-- 直播间倒计时红包系统

-- 1. 红包主表
CREATE TABLE IF NOT EXISTS public.live_red_packets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    room_id UUID REFERENCES public.live_broadcast_rooms(id) ON DELETE CASCADE,
    sender_id UUID REFERENCES public.profiles(id),
    
    -- 配置
    total_coins INT NOT NULL CHECK (total_coins > 0),            -- 总金额（抖币）
    total_count INT NOT NULL CHECK (total_count > 0),            -- 总份数
    packet_type TEXT DEFAULT 'lucky' CHECK (packet_type IN ('lucky', 'equal')), -- 'lucky' (拼手气), 'equal' (普通)
    countdown_seconds INT DEFAULT 300,   -- 倒计时时长（秒）
    
    -- 领取条件 (JSON 存储)
    -- 示例: {"follow": true, "keyword": "主播真帅"}
    claim_conditions JSONB DEFAULT '{}', 
    
    -- 运行时状态
    remaining_coins INT NOT NULL,        -- 剩余金额
    remaining_count INT NOT NULL,        -- 剩余份数
    status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'active', 'finished', 'expired')), 
    
    unlock_at TIMESTAMP WITH TIME ZONE,  -- 开启领取的精确时间点
    expires_at TIMESTAMP WITH TIME ZONE, -- 红包失效时间
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- 2. 红包领取记录
CREATE TABLE IF NOT EXISTS public.live_red_packet_claims (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    packet_id UUID REFERENCES public.live_red_packets(id) ON DELETE CASCADE,
    user_id UUID REFERENCES public.profiles(id),
    amount INT NOT NULL CHECK (amount > 0),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
    UNIQUE(packet_id, user_id)
);

-- 3. 开启 RLS
ALTER TABLE public.live_red_packets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.live_red_packet_claims ENABLE ROW LEVEL SECURITY;

-- 4. RLS 策略
-- 所有人可看红包状态
DROP POLICY IF EXISTS "Public view red packets" ON public.live_red_packets;
CREATE POLICY "Public view red packets" ON public.live_red_packets FOR SELECT USING (true);

-- 只有自己能看自己的领取记录
DROP POLICY IF EXISTS "Users view own claims" ON public.live_red_packet_claims;
CREATE POLICY "Users view own claims" ON public.live_red_packet_claims FOR SELECT USING (auth.uid() = user_id);

-- 5. 核心 RPC：抢红包 (带锁，确保并发安全)
CREATE OR REPLACE FUNCTION public.claim_live_red_packet(
    p_packet_id UUID,
    p_user_id UUID
) RETURNS JSON 
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_packet RECORD;
    v_claim_amount INT;
    v_already_claimed BOOLEAN;
    v_now TIMESTAMP WITH TIME ZONE := now();
    v_balance_after NUMERIC;
BEGIN
    -- 1. 检查是否已经领过
    SELECT EXISTS (
        SELECT 1 FROM public.live_red_packet_claims 
        WHERE packet_id = p_packet_id AND user_id = p_user_id
    ) INTO v_already_claimed;

    IF v_already_claimed THEN
        RETURN json_build_object('success', false, 'message', '您已经领过该红包了');
    END IF;

    -- 2. 锁定红包行，防止并发冲突
    SELECT * INTO v_packet FROM public.live_red_packets 
    WHERE id = p_packet_id FOR UPDATE;

    -- 3. 基础检查
    IF v_packet IS NULL THEN
        RETURN json_build_object('success', false, 'message', '红包不存在');
    END IF;

    -- 🎯 自动状态转换：如果已到解锁时间，自动变为 active
    IF v_packet.status = 'pending' AND v_now >= v_packet.unlock_at THEN
        UPDATE public.live_red_packets SET status = 'active' WHERE id = p_packet_id;
        v_packet.status := 'active';
    END IF;

    IF v_packet.status = 'pending' THEN
        RETURN json_build_object('success', false, 'message', '红包还在倒计时中');
    END IF;

    IF v_packet.status != 'active' THEN
        RETURN json_build_object('success', false, 'message', '红包已结束或已失效');
    END IF;
    
    IF v_packet.remaining_count <= 0 THEN
        RETURN json_build_object('success', false, 'message', '手慢了，红包领完了');
    END IF;

    -- 4. 计算领取金额
    IF v_packet.packet_type = 'equal' THEN
        v_claim_amount := floor(v_packet.total_coins / v_packet.total_count);
        -- 处理最后一份可能产生的余数
        IF v_packet.remaining_count = 1 THEN
            v_claim_amount := v_packet.remaining_coins;
        END IF;
    ELSE
        -- 拼手气逻辑：二倍均值算法
        IF v_packet.remaining_count = 1 THEN
            v_claim_amount := v_packet.remaining_coins;
        ELSE
            -- 计算最大可用金额 (均值的2倍)
            -- 预留足够的 1 抖币给剩余的人
            DECLARE
                v_max INT := (v_packet.remaining_coins / v_packet.remaining_count) * 2;
            BEGIN
                v_claim_amount := floor(random() * (v_max - 1) + 1);
                -- 确保不超支
                IF v_claim_amount >= v_packet.remaining_coins THEN
                    v_claim_amount := v_packet.remaining_coins - (v_packet.remaining_count - 1);
                END IF;
            END;
        END IF;
    END IF;

    -- 兜底：至少 1 抖币
    IF v_claim_amount < 1 THEN v_claim_amount := 1; END IF;

    -- 5. 执行更新
    -- a. 扣减红包余额
    UPDATE public.live_red_packets SET 
        remaining_coins = remaining_coins - v_claim_amount,
        remaining_count = remaining_count - 1,
        status = CASE WHEN remaining_count - 1 = 0 THEN 'finished' ELSE 'active' END
    WHERE id = p_packet_id;

    -- b. 插入领取记录
    INSERT INTO public.live_red_packet_claims (packet_id, user_id, amount)
    VALUES (p_packet_id, p_user_id, v_claim_amount);

    -- c. 增加用户余额
    UPDATE public.profiles SET balance_coins = balance_coins + v_claim_amount 
    WHERE id = p_user_id
    RETURNING balance_coins INTO v_balance_after;

    -- d. 记录资金流水
    INSERT INTO public.coin_transactions (user_id, amount, balance_after, type, description, related_id)
    VALUES (p_user_id, v_claim_amount, v_balance_after, 'red_packet_claim', '直播间抢红包', p_packet_id);

    RETURN json_build_object('success', true, 'amount', v_claim_amount);
END;
$$;

-- 6. 加入 Realtime
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
        BEGIN
            ALTER PUBLICATION supabase_realtime ADD TABLE public.live_red_packets;
        EXCEPTION WHEN others THEN NULL;
        END;
    END IF;
END $$;

