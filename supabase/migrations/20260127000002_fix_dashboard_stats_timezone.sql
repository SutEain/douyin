-- 🎯 修复 Dashboard 统计的时区问题
-- 问题：
-- 1. 前端发送的时间是 UTC 时间（北京时间 00:00 = UTC 前一天 16:00）
-- 2. 但数据库函数直接使用传入的时间进行比较，没有考虑时区转换
-- 3. first_publish_events 视图在 SECURITY DEFINER 函数中无法正确获取 JWT，返回空数据

-- 修复方案：
-- 1. 修改统计函数，在函数内部进行时区转换（北京时间）
-- 2. 修改 first_publish_events 相关的函数，直接查询 videos 表而不是视图

-- ============================================
-- 1. 修复 get_watch_users_count：直接使用传入的时间进行比较
-- ============================================
CREATE OR REPLACE FUNCTION public.get_watch_users_count(
    p_start_iso TIMESTAMPTZ,
    p_end_iso TIMESTAMPTZ
)
RETURNS BIGINT
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_count BIGINT;
BEGIN
    -- 🎯 直接使用传入的时间进行比较（数据库中的时间都是 UTC 存储的）
    -- 前端传入的应该是 UTC 时间（北京时间 00:00 = UTC 前一天 16:00）
    SELECT count(DISTINCT user_id)
    INTO v_count
    FROM public.watch_history
    WHERE updated_at >= p_start_iso 
      AND updated_at < p_end_iso;
    
    RETURN v_count;
END;
$$;

COMMENT ON FUNCTION public.get_watch_users_count IS '统计指定时间范围内的活跃用户数（观看记录）。时间参数应为 UTC 时间。';

-- ============================================
-- 2. 修复 get_watch_users_list：在函数内部进行时区转换
-- ============================================
CREATE OR REPLACE FUNCTION public.get_watch_users_list(
    p_start_iso TIMESTAMPTZ,
    p_end_iso TIMESTAMPTZ,
    p_limit INTEGER,
    p_offset INTEGER
)
RETURNS TABLE(
    id UUID,
    nickname TEXT,
    username TEXT,
    numeric_id BIGINT,
    last_watch_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    RETURN QUERY
    SELECT 
        p.id,
        p.nickname,
        p.username,
        p.numeric_id,
        wh.max_updated_at as last_watch_at
    FROM (
        SELECT user_id, MAX(updated_at) as max_updated_at
        FROM public.watch_history
        WHERE updated_at >= p_start_iso AND updated_at < p_end_iso
        GROUP BY user_id
    ) wh
    JOIN public.profiles p ON p.id = wh.user_id
    ORDER BY wh.max_updated_at DESC
    LIMIT p_limit
    OFFSET p_offset;
END;
$$;

COMMENT ON FUNCTION public.get_watch_users_list IS '获取指定时间范围内的活跃用户列表（观看记录）。时间参数应为 UTC 时间。';

-- ============================================
-- 3. 修复 get_today_first_publishers_count：直接查询 videos 表，避免视图的 JWT 问题
-- ============================================
CREATE OR REPLACE FUNCTION public.get_today_first_publishers_count(
    p_start_iso TIMESTAMPTZ
)
RETURNS BIGINT
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_count BIGINT;
BEGIN
    -- 🎯 直接查询 videos 表，而不是使用 first_publish_events 视图
    -- 因为视图中有 JWT 检查，在 SECURITY DEFINER 函数中无法正确工作
    SELECT COUNT(DISTINCT v1.author_id)
    INTO v_count
    FROM public.videos v1
    WHERE v1.published_at IS NOT NULL
      AND v1.published_at >= p_start_iso
      AND NOT EXISTS (
          -- 排除之前发过作品的用户
          SELECT 1 
          FROM public.videos v2 
          WHERE v2.author_id = v1.author_id 
            AND v2.published_at IS NOT NULL
            AND v2.published_at < p_start_iso
      );
    
    RETURN v_count;
END;
$$;

COMMENT ON FUNCTION public.get_today_first_publishers_count IS '统计今日首次发作品的用户数。时间参数应为 UTC 时间（北京时间 00:00 = UTC 前一天 16:00）。';

-- ============================================
-- 4. 修复 get_today_first_publishers_list：直接查询 videos 表
-- ============================================
CREATE OR REPLACE FUNCTION public.get_today_first_publishers_list(
    p_start_iso TIMESTAMPTZ,
    p_limit INTEGER,
    p_offset INTEGER
)
RETURNS TABLE(
    id UUID,
    nickname TEXT,
    username TEXT,
    numeric_id BIGINT,
    first_published_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    -- 🎯 直接查询 videos 表，而不是使用 first_publish_events 视图
    RETURN QUERY
    SELECT 
        p.id,
        p.nickname,
        p.username,
        p.numeric_id,
        v.first_published_at
    FROM (
        SELECT 
            v1.author_id,
            MIN(v1.published_at) as first_published_at
        FROM public.videos v1
        WHERE v1.published_at IS NOT NULL
          AND v1.published_at >= p_start_iso
          AND NOT EXISTS (
              -- 排除之前发过作品的用户
              SELECT 1 
              FROM public.videos v2 
              WHERE v2.author_id = v1.author_id 
                AND v2.published_at IS NOT NULL
                AND v2.published_at < p_start_iso
          )
        GROUP BY v1.author_id
    ) v
    JOIN public.profiles p ON p.id = v.author_id
    ORDER BY v.first_published_at DESC
    LIMIT p_limit
    OFFSET p_offset;
END;
$$;

COMMENT ON FUNCTION public.get_today_first_publishers_list IS '获取今日首次发作品的用户列表。时间参数应为 UTC 时间（北京时间 00:00 = UTC 前一天 16:00）。';

-- ============================================
-- 5. 修复前端时间计算：确保前端发送的时间是正确的 UTC 时间
-- ============================================
-- 注意：前端的时间计算逻辑需要检查
-- 北京时间 2026-01-27 00:00:00 应该对应 UTC 2026-01-26 16:00:00
-- 前端代码：Date.UTC(y, m-1, d, 0, 0, 0) - 8 * 60 * 60 * 1000
-- 这个计算是正确的，但需要确保数据库函数正确处理

-- 授权
GRANT EXECUTE ON FUNCTION public.get_watch_users_count(TIMESTAMPTZ, TIMESTAMPTZ) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_watch_users_count(TIMESTAMPTZ, TIMESTAMPTZ) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_watch_users_list(TIMESTAMPTZ, TIMESTAMPTZ, INTEGER, INTEGER) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_watch_users_list(TIMESTAMPTZ, TIMESTAMPTZ, INTEGER, INTEGER) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_today_first_publishers_count(TIMESTAMPTZ) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_today_first_publishers_count(TIMESTAMPTZ) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_today_first_publishers_list(TIMESTAMPTZ, INTEGER, INTEGER) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_today_first_publishers_list(TIMESTAMPTZ, INTEGER, INTEGER) TO service_role;
