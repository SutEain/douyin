-- 1. 修复观看时长记录函数：统一使用北京时间记录日期，解决 00:00-08:00 不计时间的问题
CREATE OR REPLACE FUNCTION public.increment_daily_watch_time(
    p_user_id UUID,
    p_seconds INTEGER DEFAULT 1,
    p_video_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    -- 🎯 关键修复：统一使用北京时间
    v_today DATE := (NOW() AT TIME ZONE 'Asia/Shanghai')::DATE;
    v_new_total_seconds INT;
BEGIN
    -- 🎯 如果提供了 video_id，且视频确实存在，才记录到 user_video_watch_time 表
    IF p_video_id IS NOT NULL AND EXISTS (SELECT 1 FROM public.videos WHERE id = p_video_id) THEN
        INSERT INTO public.user_video_watch_time (
            user_id, 
            video_id, 
            watch_date, 
            total_seconds, 
            last_updated_at
        )
        VALUES (p_user_id, p_video_id, v_today, p_seconds, NOW())
        ON CONFLICT (user_id, video_id, watch_date)
        DO UPDATE SET 
            total_seconds = COALESCE(user_video_watch_time.total_seconds, 0) + p_seconds,
            last_updated_at = NOW();
    END IF;

    -- 🎯 更新用户每日总观看时长
    INSERT INTO public.user_daily_watch_time (
        user_id, 
        watch_date, 
        total_seconds, 
        last_updated_at
    )
    VALUES (p_user_id, v_today, p_seconds, NOW())
    ON CONFLICT (user_id, watch_date)
    DO UPDATE SET 
        total_seconds = COALESCE(user_daily_watch_time.total_seconds, 0) + p_seconds,
        last_updated_at = NOW()
    RETURNING total_seconds INTO v_new_total_seconds;

    RETURN jsonb_build_object(
        'success', true,
        'total_seconds', v_new_total_seconds,
        'watch_date', v_today
    );
END;
$$;

-- 2. 优化推荐算法：在推荐流中排除用户已观看过的视频
CREATE OR REPLACE FUNCTION public.get_optimized_video_feed(
  p_user_id UUID DEFAULT NULL, 
  p_type TEXT DEFAULT 'recommend',
  p_limit INT DEFAULT 10, 
  p_offset INT DEFAULT 0, 
  p_seed DOUBLE PRECISION DEFAULT 0.5
) RETURNS TABLE(
  id UUID, title TEXT, description TEXT, cover_url TEXT, play_url TEXT,
  duration FLOAT, content_type TEXT, tags TEXT[], status TEXT,
  is_adult BOOLEAN, is_sea BOOLEAN, storage_type TEXT, author_id UUID,
  view_count INT, like_count INT, comment_count INT, collect_count INT,
  share_count INT, created_at TIMESTAMPTZ, published_at TIMESTAMPTZ,
  is_recommended BOOLEAN, score FLOAT
) AS $$
BEGIN
  RETURN QUERY
  WITH scored_videos AS (
    SELECT v.id, v.title, v.description, v.cover_url, v.play_url, v.duration, v.content_type, v.tags, v.status, v.is_adult, v.is_sea, v.storage_type, v.author_id, v.view_count, v.like_count, v.comment_count, v.collect_count, v.share_count, v.created_at, v.published_at, v.is_recommended,
      (
        GREATEST(0.1, 1.0 - EXTRACT(EPOCH FROM (NOW() - COALESCE(v.published_at, v.created_at))) / (7 * 86400)) * 0.3 +
        LEAST(1.0, (COALESCE(v.like_count, 0)::FLOAT / 100.0 + COALESCE(v.comment_count, 0)::FLOAT / 20.0 + COALESCE(v.collect_count, 0)::FLOAT / 50.0)) * 0.5 +
        CASE WHEN COALESCE(v.view_count, 0) > 10 THEN LEAST(1.0, (COALESCE(v.like_count, 0)::FLOAT + COALESCE(v.comment_count, 0)::FLOAT + COALESCE(v.collect_count, 0)::FLOAT) / NULLIF(v.view_count, 0) * 10) ELSE 0.5 END * 0.2 +
        CASE WHEN v.is_recommended = true THEN 0.5 ELSE 0 END
      ) as raw_score,
      ROW_NUMBER() OVER (PARTITION BY v.author_id ORDER BY COALESCE(v.published_at, v.created_at) DESC) as author_rank
    FROM public.videos v
    WHERE v.status = 'published' 
      AND v.is_adult = false 
      AND v.is_private = false 
      AND v.content_type = 'video' 
      AND v.storage_type = 'r2'
      -- 🎯 关键修复：排除已观看视频
      AND (p_user_id IS NULL OR NOT EXISTS (
        SELECT 1 FROM public.watch_history wh 
        WHERE wh.user_id = p_user_id AND wh.video_id = v.id
      ))
  )
  SELECT sv.id, sv.title::TEXT, sv.description::TEXT, sv.cover_url::TEXT, sv.play_url::TEXT, sv.duration::FLOAT, sv.content_type::TEXT, sv.tags, sv.status::TEXT, sv.is_adult, sv.is_sea, sv.storage_type::TEXT, sv.author_id, COALESCE(sv.view_count, 0)::INT, COALESCE(sv.like_count, 0)::INT, COALESCE(sv.comment_count, 0)::INT, COALESCE(sv.collect_count, 0)::INT, COALESCE(sv.share_count, 0)::INT, sv.created_at, COALESCE(sv.published_at, sv.created_at), sv.is_recommended, sv.raw_score::FLOAT
  FROM scored_videos sv WHERE sv.author_rank <= 2
  ORDER BY (sv.raw_score * 0.2 + (abs(hashtext(sv.id::text || p_seed::text))::float / 2147483647.0) * 0.8) DESC
  LIMIT p_limit OFFSET p_offset;
END; $$ LANGUAGE plpgsql STABLE;

-- 3. 补全 RLS 权限：允许用户查询自己的观看时长记录
DROP POLICY IF EXISTS "Users can view own daily watch time" ON public.user_daily_watch_time;
CREATE POLICY "Users can view own daily watch time" ON public.user_daily_watch_time FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can view own video watch time" ON public.user_video_watch_time;
CREATE POLICY "Users can view own video watch time" ON public.user_video_watch_time FOR SELECT USING (auth.uid() = user_id);

-- 4. 开放 Profile 基础信息读取权限：解决评论区昵称头像加载问题
DROP POLICY IF EXISTS "Enable read access for profiles" ON public.profiles;
CREATE POLICY "Profiles are viewable by everyone" ON public.profiles FOR SELECT USING (true);
