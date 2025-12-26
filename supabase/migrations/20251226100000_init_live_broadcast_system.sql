-- 初始化直播系统：节点管理、用户直播间及互动消息
-- 注意：为了避免与现有的外部流监控表 live_rooms 冲突，新表采用 broadcast 前缀

-- 1. 媒体服务器节点表 (实现可扩展的关键)
CREATE TABLE IF NOT EXISTS public.live_broadcast_nodes (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    ip_address TEXT NOT NULL,
    domain_name TEXT NOT NULL, -- 如 n1.live.reol-dev.com
    region TEXT DEFAULT 'singapore',
    max_streams INTEGER DEFAULT 50, -- 该机器最多支持多少人同时开播
    current_streams INTEGER DEFAULT 0,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. 用户直播间表
CREATE TABLE IF NOT EXISTS public.live_broadcast_rooms (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    anchor_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
    node_id UUID REFERENCES public.live_broadcast_nodes(id), -- 记录该直播间在哪台服务器上
    title TEXT NOT NULL,
    stream_key TEXT UNIQUE NOT NULL, -- 给主播推流的 Key
    status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'live', 'ended')),
    viewer_count INTEGER DEFAULT 0,
    total_likes INTEGER DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    ended_at TIMESTAMPTZ
);

-- 3. 直播互动消息表
CREATE TABLE IF NOT EXISTS public.live_broadcast_messages (
    id BIGINT PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
    room_id UUID REFERENCES public.live_broadcast_rooms(id) ON DELETE CASCADE,
    user_id UUID REFERENCES public.profiles(id),
    content TEXT NOT NULL,
    msg_type TEXT DEFAULT 'chat', -- chat, gift, system
    payload JSONB, -- 存礼物特效 ID 等
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 4. 开启 RLS
ALTER TABLE public.live_broadcast_nodes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.live_broadcast_rooms ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.live_broadcast_messages ENABLE ROW LEVEL SECURITY;

-- 5. 设置 RLS 策略
-- 所有人可读节点信息（仅限激活的）
DROP POLICY IF EXISTS "Public view active nodes" ON public.live_broadcast_nodes;
CREATE POLICY "Public view active nodes" ON public.live_broadcast_nodes FOR SELECT USING (is_active = true);

-- 所有人可看直播中的房间
DROP POLICY IF EXISTS "Public view live rooms" ON public.live_broadcast_rooms;
CREATE POLICY "Public view live rooms" ON public.live_broadcast_rooms FOR SELECT USING (status != 'ended');

-- 只有主播可以管理自己的房间
DROP POLICY IF EXISTS "Anchors manage own rooms" ON public.live_broadcast_rooms;
CREATE POLICY "Anchors manage own rooms" ON public.live_broadcast_rooms FOR ALL USING (auth.uid() = anchor_id);

-- 所有人可读直播间消息
DROP POLICY IF EXISTS "Public view messages" ON public.live_broadcast_messages;
CREATE POLICY "Public view messages" ON public.live_broadcast_messages FOR SELECT USING (true);

-- 登录用户可发送消息
DROP POLICY IF EXISTS "Authenticated users send messages" ON public.live_broadcast_messages;
CREATE POLICY "Authenticated users send messages" ON public.live_broadcast_messages FOR INSERT WITH CHECK (auth.uid() = user_id);

-- 6. 开启实时监听 (Realtime)
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
        -- 确保表在发布中
        BEGIN
            ALTER PUBLICATION supabase_realtime ADD TABLE public.live_broadcast_rooms;
        EXCEPTION WHEN others THEN NULL;
        END;
        BEGIN
            ALTER PUBLICATION supabase_realtime ADD TABLE public.live_broadcast_messages;
        EXCEPTION WHEN others THEN NULL;
        END;
    END IF;
END $$;

-- 7. 索引优化
CREATE INDEX IF NOT EXISTS idx_live_broadcast_rooms_anchor_id ON public.live_broadcast_rooms(anchor_id);
CREATE INDEX IF NOT EXISTS idx_live_broadcast_rooms_status ON public.live_broadcast_rooms(status);
CREATE INDEX IF NOT EXISTS idx_live_broadcast_messages_room_id ON public.live_broadcast_messages(room_id, created_at DESC);

