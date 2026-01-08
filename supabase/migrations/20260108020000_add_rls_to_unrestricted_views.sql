-- 🎯 修复 admin_profiles_list 和 first_publish_events 视图的 UNRESTRICTED 警告
-- 为这两个视图添加 RLS 策略，限制只有管理员可以访问

-- ============================================
-- 1. 修复 admin_profiles_list 视图
-- ============================================

-- 首先检查视图是否存在，如果不存在则创建
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_views 
        WHERE schemaname = 'public' 
        AND viewname = 'admin_profiles_list'
    ) THEN
        -- 创建视图（如果不存在）
        CREATE VIEW public.admin_profiles_list AS
        SELECT
            p.*,
            jsonb_build_object(
                'id', inv.id,
                'numeric_id', inv.numeric_id,
                'username', inv.username,
                'nickname', inv.nickname,
                'avatar_url', inv.avatar_url
            ) AS inviter
        FROM public.profiles p
        LEFT JOIN public.profiles inv ON inv.id = p.invited_by;
    END IF;
END $$;

-- 重新创建视图，添加 WHERE 条件限制只有管理员可以访问
-- 这样可以解决 Supabase 的 UNRESTRICTED 警告
DROP VIEW IF EXISTS public.admin_profiles_list;
CREATE VIEW public.admin_profiles_list AS
SELECT
    p.*,
    jsonb_build_object(
        'id', inv.id,
        'numeric_id', inv.numeric_id,
        'username', inv.username,
        'nickname', inv.nickname,
        'avatar_url', inv.avatar_url
    ) AS inviter
FROM public.profiles p
LEFT JOIN public.profiles inv ON inv.id = p.invited_by
WHERE public.check_is_admin(); -- ✅ 添加权限检查，只有管理员可以看到数据

COMMENT ON VIEW public.admin_profiles_list IS 
    '管理员用户列表视图。仅管理员可访问（通过视图内的 WHERE 条件限制：check_is_admin()）。非管理员用户查询此视图将返回空结果。';

-- ============================================
-- 2. 修复 first_publish_events 视图
-- ============================================

-- 首先检查视图是否存在，如果不存在则创建
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_views 
        WHERE schemaname = 'public' 
        AND viewname = 'first_publish_events'
    ) THEN
        -- 创建视图（如果不存在）：聚合每个用户的首次发布时间
        CREATE VIEW public.first_publish_events AS
        SELECT 
            author_id AS user_id,
            MIN(published_at) AS first_published_at
        FROM public.videos
        WHERE published_at IS NOT NULL
          AND deleted_at IS NULL
        GROUP BY author_id;
    END IF;
END $$;

-- 重新创建视图，添加 WHERE 条件限制只有管理员可以访问
DROP VIEW IF EXISTS public.first_publish_events;
CREATE VIEW public.first_publish_events AS
SELECT 
    author_id AS user_id,
    MIN(published_at) AS first_published_at
FROM public.videos
WHERE published_at IS NOT NULL
  AND deleted_at IS NULL
  AND public.check_is_admin() -- ✅ 添加权限检查，只有管理员可以看到数据
GROUP BY author_id;

COMMENT ON VIEW public.first_publish_events IS 
    '首次发布事件视图。聚合每个用户的首次发布时间。仅管理员可访问（通过视图内的 WHERE 条件限制：check_is_admin()）。非管理员用户查询此视图将返回空结果。';

-- ============================================
-- 3. 确保包装函数存在并正确配置
-- ============================================

-- 确保 get_admin_profiles_list() 函数存在
CREATE OR REPLACE FUNCTION public.get_admin_profiles_list()
RETURNS TABLE (
    id UUID,
    username TEXT,
    nickname TEXT,
    bio TEXT,
    avatar_url TEXT,
    cover_url TEXT,
    tg_user_id BIGINT,
    tg_username TEXT,
    auth_provider TEXT,
    lang TEXT,
    email_verified BOOLEAN,
    follower_count INTEGER,
    following_count INTEGER,
    total_likes INTEGER,
    video_count INTEGER,
    last_active_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ,
    updated_at TIMESTAMPTZ,
    deleted_at TIMESTAMPTZ,
    gender TEXT,
    birthday DATE,
    country TEXT,
    province TEXT,
    city TEXT,
    numeric_id BIGINT,
    show_collect BOOLEAN,
    show_like BOOLEAN,
    show_tg_username BOOLEAN,
    notification_settings JSONB,
    auto_approve BOOLEAN,
    invite_success_count INTEGER,
    invited_by UUID,
    adult_daily_limit INTEGER,
    adult_unlock_until TIMESTAMPTZ,
    adult_permanent_unlock BOOLEAN,
    balance_coins BIGINT,
    frozen_coins BIGINT,
    live_status TEXT,
    is_banned BOOLEAN,
    ban_reason TEXT,
    inviter JSONB
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
BEGIN
    -- 检查是否为管理员
    IF NOT public.check_is_admin() THEN
        RAISE EXCEPTION 'Access denied. Admin role required.';
    END IF;
    
    -- 返回视图数据（视图本身已经有权限检查，这里再次检查以确保安全）
    RETURN QUERY
    SELECT
        p.id,
        p.username,
        p.nickname,
        p.bio,
        p.avatar_url,
        p.cover_url,
        p.tg_user_id,
        p.tg_username,
        p.auth_provider,
        p.lang,
        p.email_verified,
        p.follower_count,
        p.following_count,
        p.total_likes,
        p.video_count,
        p.last_active_at,
        p.created_at,
        p.updated_at,
        p.deleted_at,
        p.gender,
        p.birthday,
        p.country,
        p.province,
        p.city,
        p.numeric_id,
        p.show_collect,
        p.show_like,
        p.show_tg_username,
        p.notification_settings,
        p.auto_approve,
        p.invite_success_count,
        p.invited_by,
        p.adult_daily_limit,
        p.adult_unlock_until,
        p.adult_permanent_unlock,
        p.balance_coins,
        p.frozen_coins,
        p.live_status,
        p.is_banned,
        p.ban_reason,
        p.inviter
    FROM public.admin_profiles_list p;
END;
$function$;

-- 确保 get_first_publish_events() 函数存在
CREATE OR REPLACE FUNCTION public.get_first_publish_events()
RETURNS TABLE (
    user_id UUID,
    first_published_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
BEGIN
    -- 检查是否为管理员
    IF NOT public.check_is_admin() THEN
        RAISE EXCEPTION 'Access denied. Admin role required.';
    END IF;
    
    -- 返回视图数据
    RETURN QUERY
    SELECT 
        fpe.user_id,
        fpe.first_published_at
    FROM public.first_publish_events fpe;
END;
$function$;

-- 添加函数注释
COMMENT ON FUNCTION public.get_admin_profiles_list() IS 
    '获取管理员用户列表（仅管理员）。包装 admin_profiles_list 视图，添加访问控制。使用此函数而不是直接访问视图。';

COMMENT ON FUNCTION public.get_first_publish_events() IS 
    '获取首次发布事件（仅管理员）。包装 first_publish_events 视图，添加访问控制。使用此函数而不是直接访问视图。';
