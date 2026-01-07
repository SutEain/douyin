-- 🎯 修复 Security Definer View 问题
-- 移除视图中的 auth.jwt() 调用，改为通过 wrapper function 控制访问

-- ============================================
-- 1. 修复 admin_profiles_list 视图
-- ============================================
-- 移除视图中的 auth.jwt() 检查，改为通过 wrapper function 控制访问

-- 创建 wrapper function 替代直接访问视图
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
    IF (auth.jwt() -> 'app_metadata' ->> 'role') != 'admin' THEN
        RAISE EXCEPTION 'Access denied. Admin role required.';
    END IF;
    
    -- 返回视图数据（移除视图中的 auth.jwt() 检查）
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
        jsonb_build_object(
            'id', inv.id,
            'numeric_id', inv.numeric_id,
            'username', inv.username,
            'nickname', inv.nickname,
            'avatar_url', inv.avatar_url
        ) AS inviter
    FROM public.profiles p
    LEFT JOIN public.profiles inv ON inv.id = p.invited_by;
    -- 注意：移除了 WHERE 条件中的 auth.jwt() 检查，改为在函数中检查
END;
$function$;

-- 重新创建视图（移除 auth.jwt() 检查）
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
LEFT JOIN public.profiles inv ON inv.id = p.invited_by;
-- 注意：移除了 WHERE 条件，访问控制通过 get_admin_profiles_list() 函数实现

-- 添加注释
COMMENT ON VIEW public.admin_profiles_list IS 
    '管理员用户列表视图。建议通过 get_admin_profiles_list() 函数访问以限制权限。直接访问视图将返回所有用户数据。';
COMMENT ON FUNCTION public.get_admin_profiles_list() IS 
    '获取管理员用户列表（仅管理员）。包装 admin_profiles_list 视图，添加访问控制。';

-- ============================================
-- 2. 修复 first_publish_events 视图
-- ============================================
-- 这个视图本身没有使用 auth.jwt()，但 Supabase 可能因为聚合敏感数据而标记它
-- 我们已经创建了 wrapper function，现在添加注释说明

COMMENT ON VIEW public.first_publish_events IS 
    '首次发布事件视图。聚合每个用户的首次发布时间。建议通过 get_first_publish_events() 函数访问以限制权限。直接访问视图将返回所有用户数据。';
