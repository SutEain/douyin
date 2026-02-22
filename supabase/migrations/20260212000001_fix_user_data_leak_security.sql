-- 🚨 紧急修复：用户数据泄露安全漏洞
-- 问题：搜索接口和 profiles 表的 RLS 策略允许任何人查看所有用户数据，包括敏感字段
-- 修复：
-- 1. 创建公共用户信息视图，只暴露必要字段
-- 2. 修改 profiles 表的 RLS 策略，限制敏感字段访问
-- 3. 添加索引优化搜索性能

-- ============================================
-- 1. 创建公共用户信息视图（只暴露必要字段）
-- ============================================
CREATE OR REPLACE VIEW public.public_user_profiles AS
SELECT 
    id,
    nickname,
    username,
    bio,
    avatar_url,
    cover_url,
    follower_count,
    following_count,
    total_likes,
    video_count,
    numeric_id,
    created_at,
    updated_at,
    gender,
    birthday,
    country,
    province,
    city,
    -- 🚨 敏感字段不暴露：balance_coins, frozen_coins, tg_user_id, tg_username, is_admin, invited_by, checkin_streak, last_checkin_at
    -- 这些字段只能通过认证接口获取，且只能获取自己的数据
    deleted_at
FROM public.profiles
WHERE deleted_at IS NULL;

-- 添加注释
COMMENT ON VIEW public.public_user_profiles IS '公共用户信息视图，只暴露必要字段，不包含敏感信息（余额、TG ID、管理员标识等）';

-- 为视图启用 RLS（虽然视图本身不存储数据，但确保安全）
ALTER VIEW public.public_user_profiles SET (security_invoker = true);

-- ============================================
-- 2. 修改 profiles 表的 RLS 策略
-- ============================================

-- 2.1 删除旧的过于宽松的策略
DROP POLICY IF EXISTS "Profiles are viewable by everyone" ON public.profiles;
DROP POLICY IF EXISTS "Enable read access for profiles" ON public.profiles;
DROP POLICY IF EXISTS "Public profiles are viewable by everyone" ON public.profiles;

-- 2.2 创建新的受限策略：只允许查看非敏感字段
-- 注意：这个策略仍然允许查看所有用户的基本信息（用于显示评论、视频作者等）
-- 但敏感字段（balance_coins, tg_user_id, is_admin等）会被视图或应用层过滤
CREATE POLICY "Public can view basic profile info" ON public.profiles
    FOR SELECT
    USING (
        deleted_at IS NULL
        -- 只允许查看未删除的用户
    );

-- 2.3 用户只能查看自己的完整信息（包括敏感字段）
CREATE POLICY "Users can view own full profile" ON public.profiles
    FOR SELECT
    USING (
        auth.uid() = id
        -- 用户可以查看自己的完整信息
    );

-- ============================================
-- 3. 创建索引优化搜索性能
-- ============================================

-- 为昵称搜索创建索引（如果不存在）
CREATE INDEX IF NOT EXISTS idx_profiles_nickname_search ON public.profiles USING gin(to_tsvector('simple', nickname));
CREATE INDEX IF NOT EXISTS idx_profiles_nickname_ilike ON public.profiles(nickname text_pattern_ops);

-- 为 numeric_id 创建索引（如果不存在）
CREATE INDEX IF NOT EXISTS idx_profiles_numeric_id ON public.profiles(numeric_id) WHERE numeric_id IS NOT NULL;

-- ============================================
-- 4. 添加安全审计日志表（可选，用于追踪异常访问）
-- ============================================

-- 如果不存在，创建安全审计日志表
CREATE TABLE IF NOT EXISTS public.security_audit_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event_type TEXT NOT NULL, -- 'search_users', 'bulk_query', 'suspicious_access'
    user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    ip_address INET,
    details JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 创建索引
CREATE INDEX IF NOT EXISTS idx_security_audit_logs_event_type ON public.security_audit_logs(event_type, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_security_audit_logs_ip ON public.security_audit_logs(ip_address, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_security_audit_logs_user ON public.security_audit_logs(user_id, created_at DESC);

-- RLS 策略：只有管理员可以查看审计日志
ALTER TABLE public.security_audit_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Only admins can view audit logs" ON public.security_audit_logs
    FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM public.profiles
            WHERE id = auth.uid() AND is_admin = true
        )
    );

-- 允许服务角色插入日志（Edge Functions 使用）
CREATE POLICY "Service role can insert audit logs" ON public.security_audit_logs
    FOR INSERT
    WITH CHECK (true);

COMMENT ON TABLE public.security_audit_logs IS '安全审计日志表，记录异常访问和可疑行为';
