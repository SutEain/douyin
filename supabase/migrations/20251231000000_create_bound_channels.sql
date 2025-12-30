-- 1. 创建绑定频道表
CREATE TABLE IF NOT EXISTS public.bound_channels (
    id BIGINT PRIMARY KEY, -- Telegram Chat ID (可能很大，使用 BIGINT)
    user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    title TEXT, -- 频道名称
    username TEXT, -- 频道用户名 (如果有)
    sync_enabled BOOLEAN DEFAULT TRUE, -- 是否开启自动同步
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 2. 启用 RLS
ALTER TABLE public.bound_channels ENABLE ROW LEVEL SECURITY;

-- 3. 创建 RLS 策略
-- 用户可以查看自己的绑定频道
CREATE POLICY "Users can view own bound channels"
    ON public.bound_channels FOR SELECT
    USING (auth.uid() = user_id);

-- 用户可以删除自己的绑定频道
CREATE POLICY "Users can delete own bound channels"
    ON public.bound_channels FOR DELETE
    USING (auth.uid() = user_id);

-- 只有 service_role 可以插入和更新（由 bot 端控制逻辑）
CREATE POLICY "Bot can manage all bound channels"
    ON public.bound_channels FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);

-- 4. 索引
CREATE INDEX IF NOT EXISTS idx_bound_channels_user_id ON public.bound_channels(user_id);

-- 5. 添加更新时间触发器
CREATE OR REPLACE FUNCTION public.handle_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER on_bound_channels_updated
    BEFORE UPDATE ON public.bound_channels
    FOR EACH ROW
    EXECUTE FUNCTION public.handle_updated_at();

