-- 加拿大PC28游戏系统
-- 对赌机制：主播和玩家对赌，平台抽取1%奖金利润

-- 1. 游戏配置表（每个直播间一个配置）
CREATE TABLE IF NOT EXISTS public.pc28_game_configs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    room_id UUID REFERENCES public.live_broadcast_rooms(id) ON DELETE CASCADE,
    anchor_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
    
    -- 游戏开关
    is_enabled BOOLEAN DEFAULT false,
    
    -- 玩法开关和赔率配置（JSONB）
    -- 示例结构：
    -- {
    --   "big_small": {"enabled": true, "big": 1.99, "small": 1.99},
    --   "odd_even": {"enabled": true, "odd": 1.99, "even": 1.99},
    --   "combinations": {"enabled": true, "big_odd": 4.2, "big_even": 4.6, "small_odd": 4.6, "small_even": 4.2},
    --   "extreme": {"enabled": true, "extreme_big": 15, "extreme_small": 15},
    --   "patterns": {"enabled": true, "pair": 3.5, "straight": 15, "leopard": 88},
    --   "single_point": {"enabled": true, "odds": {0: 888, 1: 280, ..., 27: 888}}
    -- }
    game_settings JSONB DEFAULT '{
        "big_small": {"enabled": true, "big": 1.99, "small": 1.99},
        "odd_even": {"enabled": true, "odd": 1.99, "even": 1.99},
        "combinations": {"enabled": true, "big_odd": 4.2, "big_even": 4.6, "small_odd": 4.6, "small_even": 4.2},
        "extreme": {"enabled": true, "extreme_big": 15, "extreme_small": 15},
        "patterns": {"enabled": true, "pair": 3.5, "straight": 15, "leopard": 88},
        "single_point": {"enabled": true, "odds": {"0": 488, "27": 488, "1": 128, "26": 128, "2": 88, "25": 88, "3": 58, "24": 58, "4": 48, "23": 48, "5": 38, "22": 38, "6": 28, "21": 28, "7": 18, "20": 18, "8": 15, "19": 15, "9": 15, "18": 15, "10": 14, "17": 14, "11": 13, "16": 13, "12": 12, "15": 12, "13": 11, "14": 11}}
    }',
    
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
    
    UNIQUE(room_id)
);

-- 2. 游戏期数表（每个直播间每期一个记录）
CREATE TABLE IF NOT EXISTS public.pc28_game_rounds (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    room_id UUID REFERENCES public.live_broadcast_rooms(id) ON DELETE CASCADE,
    anchor_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
    
    -- 期号（不是全局唯一，同一期号可以在多个直播间开盘）
    period_number TEXT NOT NULL,
    
    -- 状态：betting(下注中), sealed(已封盘), settled(已结算)
    status TEXT DEFAULT 'betting' CHECK (status IN ('betting', 'sealed', 'settled')),
    
    -- 封盘时间（可选，主播可以随时手动封盘）
    seal_at TIMESTAMP WITH TIME ZONE,
    
    -- 开奖结果（3个0-9的数字）
    -- 格式：{"num1": 9, "num2": 3, "num3": 9, "sum": 21}
    result JSONB,
    
    -- 结算时间
    settled_at TIMESTAMP WITH TIME ZONE,
    
    -- 统计信息（结算时计算）
    total_bet_amount NUMERIC(12, 2) DEFAULT 0, -- 总下注金额
    total_payout NUMERIC(12, 2) DEFAULT 0,     -- 总赔付金额
    total_platform_fee NUMERIC(12, 2) DEFAULT 0, -- 平台抽成
    
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
    
    -- 同一直播间同一期号只能有一个记录
    UNIQUE(room_id, period_number)
);

-- 3. 下注记录表
CREATE TABLE IF NOT EXISTS public.pc28_bets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    round_id UUID REFERENCES public.pc28_game_rounds(id) ON DELETE CASCADE,
    room_id UUID REFERENCES public.live_broadcast_rooms(id) ON DELETE CASCADE,
    user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
    
    -- 下注类型：big, small, odd, even, big_odd, big_even, small_odd, small_even, 
    --           extreme_big, extreme_small, pair, straight, leopard, single_point
    bet_type TEXT NOT NULL CHECK (bet_type IN (
        'big', 'small', 'odd', 'even',
        'big_odd', 'big_even', 'small_odd', 'small_even',
        'extreme_big', 'extreme_small',
        'pair', 'straight', 'leopard',
        'single_point'
    )),
    
    -- 下注值（对于single_point，就是具体的点数0-27）
    bet_value INT,
    
    -- 下注金额
    amount NUMERIC(12, 2) NOT NULL CHECK (amount > 0),
    
    -- 赔率（下注时的赔率，防止结算时赔率变化）
    odds NUMERIC(8, 2) NOT NULL CHECK (odds > 0),
    
    -- 状态：pending(待结算), settled(已结算)
    status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'settled')),
    
    -- 是否中奖
    is_win BOOLEAN,
    
    -- 结算金额（中奖时的奖金，未中奖为0）
    payout NUMERIC(12, 2) DEFAULT 0,
    
    -- 平台抽成（从奖金中抽取1%）
    platform_fee NUMERIC(12, 2) DEFAULT 0,
    
    -- 用户实际获得金额（奖金 - 平台抽成）
    user_gain NUMERIC(12, 2) DEFAULT 0,
    
    -- 主播实际支付金额（奖金）
    anchor_payout NUMERIC(12, 2) DEFAULT 0,
    
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
    settled_at TIMESTAMP WITH TIME ZONE
);

-- 4. 开启 RLS
ALTER TABLE public.pc28_game_configs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pc28_game_rounds ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pc28_bets ENABLE ROW LEVEL SECURITY;

-- 5. RLS 策略

-- 游戏配置表：所有人可查看，只有主播可以修改
DROP POLICY IF EXISTS "Public view pc28 configs" ON public.pc28_game_configs;
CREATE POLICY "Public view pc28 configs" ON public.pc28_game_configs 
    FOR SELECT USING (true);

DROP POLICY IF EXISTS "Anchors manage own pc28 configs" ON public.pc28_game_configs;
CREATE POLICY "Anchors manage own pc28 configs" ON public.pc28_game_configs 
    FOR ALL USING (auth.uid() = anchor_id);

-- 游戏期数表：所有人可查看，只有主播可以创建/修改
-- 注意：INSERT/UPDATE操作通过SECURITY DEFINER的RPC函数完成，这里只做防御性策略
DROP POLICY IF EXISTS "Public view pc28 rounds" ON public.pc28_game_rounds;
CREATE POLICY "Public view pc28 rounds" ON public.pc28_game_rounds 
    FOR SELECT USING (true);

DROP POLICY IF EXISTS "Anchors create own pc28 rounds" ON public.pc28_game_rounds;
CREATE POLICY "Anchors create own pc28 rounds" ON public.pc28_game_rounds 
    FOR INSERT WITH CHECK (auth.uid() = anchor_id);

DROP POLICY IF EXISTS "Anchors update own pc28 rounds" ON public.pc28_game_rounds;
CREATE POLICY "Anchors update own pc28 rounds" ON public.pc28_game_rounds 
    FOR UPDATE USING (auth.uid() = anchor_id);

-- 下注记录表：用户只能查看自己的下注，只能创建自己的下注
-- 注意：UPDATE和DELETE操作通过SECURITY DEFINER的RPC函数完成，这里只做防御性策略
DROP POLICY IF EXISTS "Users view own pc28 bets" ON public.pc28_bets;
CREATE POLICY "Users view own pc28 bets" ON public.pc28_bets 
    FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users create own pc28 bets" ON public.pc28_bets;
CREATE POLICY "Users create own pc28 bets" ON public.pc28_bets 
    FOR INSERT WITH CHECK (auth.uid() = user_id);

-- 防御性策略：用户不能直接更新或删除下注（必须通过RPC函数）
-- 实际更新操作由SECURITY DEFINER的RPC函数完成

-- 6. 索引优化
CREATE INDEX IF NOT EXISTS idx_pc28_configs_room_id ON public.pc28_game_configs(room_id);
CREATE INDEX IF NOT EXISTS idx_pc28_configs_anchor_id ON public.pc28_game_configs(anchor_id);
CREATE INDEX IF NOT EXISTS idx_pc28_rounds_room_id ON public.pc28_game_rounds(room_id);
CREATE INDEX IF NOT EXISTS idx_pc28_rounds_period_number ON public.pc28_game_rounds(period_number);
CREATE INDEX IF NOT EXISTS idx_pc28_rounds_status ON public.pc28_game_rounds(status);
CREATE INDEX IF NOT EXISTS idx_pc28_bets_round_id ON public.pc28_bets(round_id);
CREATE INDEX IF NOT EXISTS idx_pc28_bets_user_id ON public.pc28_bets(user_id);
CREATE INDEX IF NOT EXISTS idx_pc28_bets_status ON public.pc28_bets(status);

-- 7. 开启实时监听 (Realtime)
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
        BEGIN
            ALTER PUBLICATION supabase_realtime ADD TABLE public.pc28_game_configs;
        EXCEPTION WHEN others THEN NULL;
        END;
        BEGIN
            ALTER PUBLICATION supabase_realtime ADD TABLE public.pc28_game_rounds;
        EXCEPTION WHEN others THEN NULL;
        END;
        BEGIN
            ALTER PUBLICATION supabase_realtime ADD TABLE public.pc28_bets;
        EXCEPTION WHEN others THEN NULL;
        END;
    END IF;
END $$;
