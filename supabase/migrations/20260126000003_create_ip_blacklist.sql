-- 🎯 创建 IP 黑名单表
-- 用于封禁恶意 IP，防止攻击

CREATE TABLE IF NOT EXISTS public.ip_blacklist (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    ip_address TEXT NOT NULL UNIQUE,
    reason TEXT,
    banned_by UUID REFERENCES public.profiles(id),
    banned_at TIMESTAMPTZ DEFAULT NOW(),
    expires_at TIMESTAMPTZ, -- NULL 表示永久封禁
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 创建索引
CREATE INDEX IF NOT EXISTS idx_ip_blacklist_ip ON public.ip_blacklist(ip_address);
CREATE INDEX IF NOT EXISTS idx_ip_blacklist_active ON public.ip_blacklist(is_active) WHERE is_active = TRUE;
CREATE INDEX IF NOT EXISTS idx_ip_blacklist_expires ON public.ip_blacklist(expires_at) WHERE expires_at IS NOT NULL;

-- 添加注释
COMMENT ON TABLE public.ip_blacklist IS 'IP 黑名单表，用于封禁恶意 IP';
COMMENT ON COLUMN public.ip_blacklist.ip_address IS '被封禁的 IP 地址';
COMMENT ON COLUMN public.ip_blacklist.reason IS '封禁原因';
COMMENT ON COLUMN public.ip_blacklist.banned_by IS '执行封禁的管理员 ID';
COMMENT ON COLUMN public.ip_blacklist.expires_at IS '封禁过期时间，NULL 表示永久封禁';
COMMENT ON COLUMN public.ip_blacklist.is_active IS '是否激活（可以临时禁用而不删除记录）';

-- RLS 策略：只有管理员可以查看和管理
ALTER TABLE public.ip_blacklist ENABLE ROW LEVEL SECURITY;

-- 所有人可以查看（用于检查）
CREATE POLICY "所有人可查看 IP 黑名单" ON public.ip_blacklist
    FOR SELECT
    USING (true);

-- 只有管理员可以插入
CREATE POLICY "管理员可添加 IP 黑名单" ON public.ip_blacklist
    FOR INSERT
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM public.profiles
            WHERE id = auth.uid() AND is_admin = TRUE
        )
    );

-- 只有管理员可以更新
CREATE POLICY "管理员可更新 IP 黑名单" ON public.ip_blacklist
    FOR UPDATE
    USING (
        EXISTS (
            SELECT 1 FROM public.profiles
            WHERE id = auth.uid() AND is_admin = TRUE
        )
    );

-- 只有管理员可以删除
CREATE POLICY "管理员可删除 IP 黑名单" ON public.ip_blacklist
    FOR DELETE
    USING (
        EXISTS (
            SELECT 1 FROM public.profiles
            WHERE id = auth.uid() AND is_admin = TRUE
        )
    );

-- 🔥 创建检查 IP 是否被封禁的函数
CREATE OR REPLACE FUNCTION public.is_ip_banned(p_ip_address TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_banned RECORD;
BEGIN
    -- 检查是否有活跃的封禁记录
    SELECT * INTO v_banned
    FROM public.ip_blacklist
    WHERE ip_address = p_ip_address
      AND is_active = TRUE
      AND (expires_at IS NULL OR expires_at > NOW())
    LIMIT 1;

    RETURN v_banned IS NOT NULL;
END;
$$;

COMMENT ON FUNCTION public.is_ip_banned IS '检查 IP 是否被封禁';

-- 🔥 创建自动清理过期封禁的函数
CREATE OR REPLACE FUNCTION public.cleanup_expired_ip_bans()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_count INTEGER;
BEGIN
    -- 将过期的封禁标记为非激活
    UPDATE public.ip_blacklist
    SET is_active = FALSE,
        updated_at = NOW()
    WHERE is_active = TRUE
      AND expires_at IS NOT NULL
      AND expires_at <= NOW();

    GET DIAGNOSTICS v_count = ROW_COUNT;
    RETURN v_count;
END;
$$;

COMMENT ON FUNCTION public.cleanup_expired_ip_bans IS '自动清理过期的 IP 封禁';

-- 授予 service_role 执行权限
GRANT EXECUTE ON FUNCTION public.is_ip_banned(TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.cleanup_expired_ip_bans() TO service_role;
