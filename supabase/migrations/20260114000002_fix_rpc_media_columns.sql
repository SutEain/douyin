-- 🎯 彻底解决 RPC 接口漏掉媒体列的问题

-- 1. 先删除旧函数（因为返回值列数变化，CREATE OR REPLACE 会报错）
DROP FUNCTION IF EXISTS public.get_sea_feed(UUID, UUID[], INT, INT, DOUBLE PRECISION, TEXT);
DROP FUNCTION IF EXISTS public.get_optimized_video_feed(UUID, TEXT, INT, INT, DOUBLE PRECISION, TEXT, UUID[]);

-- 2. 重新创建 get_sea_feed，补全 media_list 和 images
CREATE OR REPLACE FUNCTION public.get_sea_feed(
  p_user_id UUID DEFAULT NULL, 
  p_exclude_ids UUID[] DEFAULT ARRAY[]::UUID[],
  p_limit INT DEFAULT 20, 
  p_offset INT DEFAULT 0, 
  p_seed DOUBLE PRECISION DEFAULT 0.5,
  p_visitor_key TEXT DEFAULT NULL
) RETURNS TABLE(
  id UUID, title TEXT, description TEXT, cover_url TEXT, play_url TEXT,
  duration FLOAT, content_type TEXT, tags TEXT[], status TEXT,
  is_adult BOOLEAN, is_sea BOOLEAN, storage_type TEXT, author_id UUID,
  view_count INT, like_count INT, comment_count INT, collect_count INT,
  share_count INT, created_at TIMESTAMPTZ, published_at TIMESTAMPTZ,
  is_recommended BOOLEAN,
  score FLOAT,
  media_list JSONB, images JSONB -- 🎯 补全媒体列
) AS $$
DECLARE
    v_mix_seed TEXT;
BEGIN
  v_mix_seed := COALESCE(p_seed::TEXT, '0.5') || '-' || COALESCE(p_visitor_key, 'anon');
  RETURN QUERY
  WITH scored_videos AS (
    SELECT v.id, v.title, v.description, v.cover_url, v.play_url, v.duration, v.content_type, v.tags, v.status, v.is_adult, v.is_sea, v.storage_type, v.author_id, v.view_count, v.like_count, v.comment_count, v.collect_count, v.share_count, v.created_at, v.published_at, v.is_recommended,
      (
        GREATEST(0.1, 1.0 - EXTRACT(EPOCH FROM (NOW() - COALESCE(v.published_at, v.created_at))) / (30 * 86400)) * 0.4 + 
        LEAST(1.0, (COALESCE(v.like_count, 0)::FLOAT / 50.0 + COALESCE(v.comment_count, 0)::FLOAT / 10.0)) * 0.3 + 
        CASE WHEN v.is_recommended = true THEN 0.2 ELSE 0 END 
      ) as raw_score,
      v.media_list, v.images
    FROM public.videos v
    WHERE v.status = 'published'
      AND v.is_sea = true
      AND v.is_adult = false
      AND v.is_private = false
      AND v.storage_type = 'r2'
      AND (p_user_id IS NULL OR NOT EXISTS (SELECT 1 FROM public.watch_history wh WHERE wh.user_id = p_user_id AND wh.video_id = v.id))
      AND (p_exclude_ids IS NULL OR cardinality(p_exclude_ids) = 0 OR NOT (v.id = ANY(p_exclude_ids)))
  )
  SELECT sv.id, sv.title::TEXT, sv.description::TEXT, sv.cover_url::TEXT, sv.play_url::TEXT, sv.duration::FLOAT, sv.content_type::TEXT, sv.tags, sv.status::TEXT, sv.is_adult, sv.is_sea, sv.storage_type::TEXT, sv.author_id, COALESCE(sv.view_count, 0)::INT, COALESCE(sv.like_count, 0)::INT, COALESCE(sv.comment_count, 0)::INT, COALESCE(sv.collect_count, 0)::INT, COALESCE(sv.share_count, 0)::INT, sv.created_at, COALESCE(sv.published_at, sv.created_at), sv.is_recommended, (sv.raw_score * 0.1 + (abs(hashtext(sv.id::text || v_mix_seed))::float / 2147483647.0) * 0.9)::FLOAT as final_score,
  sv.media_list, sv.images
  FROM scored_videos sv ORDER BY final_score DESC LIMIT p_limit OFFSET p_offset;
END; $$ LANGUAGE plpgsql STABLE;

-- 3. 重新创建 get_optimized_video_feed，补全 media_list 和 images
CREATE OR REPLACE FUNCTION public.get_optimized_video_feed(
  p_user_id UUID DEFAULT NULL, 
  p_type TEXT DEFAULT 'recommend',
  p_limit INT DEFAULT 10, 
  p_offset INT DEFAULT 0, 
  p_seed DOUBLE PRECISION DEFAULT 0.5,
  p_visitor_key TEXT DEFAULT NULL,
  p_exclude_ids UUID[] DEFAULT ARRAY[]::UUID[]
) RETURNS TABLE(
  id UUID, title TEXT, description TEXT, cover_url TEXT, play_url TEXT,
  duration FLOAT, content_type TEXT, tags TEXT[], status TEXT,
  is_adult BOOLEAN, is_sea BOOLEAN, storage_type TEXT, author_id UUID,
  view_count INT, like_count INT, comment_count INT, collect_count INT,
  share_count INT, created_at TIMESTAMPTZ, published_at TIMESTAMPTZ,
  is_recommended BOOLEAN,
  score FLOAT,
  media_list JSONB, images JSONB -- 🎯 补全媒体列
) AS $$
DECLARE
    v_mix_seed TEXT;
BEGIN
  v_mix_seed := COALESCE(p_seed::TEXT, '0.5') || '-' || COALESCE(p_visitor_key, 'anon');
  RETURN QUERY
  WITH scored_videos AS (
    SELECT v.id, v.title, v.description, v.cover_url, v.play_url, v.duration, v.content_type, v.tags, v.status, v.is_adult, v.is_sea, v.storage_type, v.author_id, v.view_count, v.like_count, v.comment_count, v.collect_count, v.share_count, v.created_at, v.published_at, v.is_recommended,
      (
        GREATEST(0.1, 1.0 - EXTRACT(EPOCH FROM (NOW() - COALESCE(v.published_at, v.created_at))) / (14 * 86400)) * 0.3 + 
        LEAST(1.0, (COALESCE(v.like_count, 0)::FLOAT / 100.0 + COALESCE(v.comment_count, 0)::FLOAT / 20.0 + COALESCE(v.collect_count, 0)::FLOAT / 50.0)) * 0.4 + 
        CASE WHEN COALESCE(v.view_count, 0) > 10 THEN LEAST(1.0, (COALESCE(v.like_count, 0)::FLOAT + COALESCE(v.comment_count, 0)::FLOAT + COALESCE(v.collect_count, 0)::FLOAT) / NULLIF(v.view_count, 0) * 10) ELSE 0.5 END * 0.2 + 
        CASE WHEN v.is_recommended = true THEN 0.3 ELSE 0 END 
      ) as raw_score,
      ROW_NUMBER() OVER (PARTITION BY v.author_id ORDER BY COALESCE(v.published_at, v.created_at) DESC) as author_rank,
      v.media_list, v.images
    FROM public.videos v
    WHERE v.status = 'published'
      AND v.is_adult = false
      AND v.is_private = false
      AND v.content_type = 'video'
      AND v.storage_type = 'r2'
      AND (p_user_id IS NULL OR NOT EXISTS (SELECT 1 FROM public.watch_history wh WHERE wh.user_id = p_user_id AND wh.video_id = v.id))
      AND (p_exclude_ids IS NULL OR cardinality(p_exclude_ids) = 0 OR NOT (v.id = ANY(p_exclude_ids)))
  )
  SELECT sv.id, sv.title::TEXT, sv.description::TEXT, sv.cover_url::TEXT, sv.play_url::TEXT, sv.duration::FLOAT, sv.content_type::TEXT, sv.tags, sv.status::TEXT, sv.is_adult, sv.is_sea, sv.storage_type::TEXT, sv.author_id, COALESCE(sv.view_count, 0)::INT, COALESCE(sv.like_count, 0)::INT, COALESCE(sv.comment_count, 0)::INT, COALESCE(sv.collect_count, 0)::INT, COALESCE(sv.share_count, 0)::INT, sv.created_at, COALESCE(sv.published_at, sv.created_at), sv.is_recommended, (sv.raw_score * 0.1 + (abs(hashtext(sv.id::text || v_mix_seed))::float / 2147483647.0) * 0.9)::FLOAT as final_score,
  sv.media_list, sv.images
  FROM scored_videos sv WHERE sv.author_rank <= 2 ORDER BY final_score DESC LIMIT p_limit OFFSET p_offset;
END; $$ LANGUAGE plpgsql STABLE;

-- 4. 重新创建 get_adult_feed，补全 media_list 和 images，并支持图文内容
DROP FUNCTION IF EXISTS public.get_adult_feed(UUID, UUID[], INT, INT, DOUBLE PRECISION, TEXT);

CREATE OR REPLACE FUNCTION public.get_adult_feed(
  p_user_id UUID DEFAULT NULL, 
  p_exclude_ids UUID[] DEFAULT ARRAY[]::UUID[],
  p_limit INT DEFAULT 20, 
  p_offset INT DEFAULT 0, 
  p_seed DOUBLE PRECISION DEFAULT 0.5,
  p_visitor_key TEXT DEFAULT NULL
) RETURNS TABLE(
  id UUID, title TEXT, description TEXT, cover_url TEXT, play_url TEXT,
  duration FLOAT, content_type TEXT, tags TEXT[], status TEXT,
  is_adult BOOLEAN, is_sea BOOLEAN, storage_type TEXT, author_id UUID,
  view_count INT, like_count INT, comment_count INT, collect_count INT,
  share_count INT, created_at TIMESTAMPTZ, published_at TIMESTAMPTZ,
  score FLOAT,
  media_list JSONB, images JSONB -- 🎯 补全媒体列
) AS $$
DECLARE
    v_mix_seed TEXT;
BEGIN
  v_mix_seed := COALESCE(p_seed::TEXT, '0.5') || '-' || COALESCE(p_visitor_key, 'anon');

  RETURN QUERY
  WITH scored_videos AS (
    SELECT v.id, v.title, v.description, v.cover_url, v.play_url, v.duration, v.content_type, v.tags, v.status, v.is_adult, v.is_sea, v.storage_type, v.author_id, v.view_count, v.like_count, v.comment_count, v.collect_count, v.share_count, v.created_at, v.published_at,
      (
        GREATEST(0.1, 1.0 - EXTRACT(EPOCH FROM (NOW() - COALESCE(v.published_at, v.created_at))) / (7 * 86400)) * 0.3 +
        LEAST(1.0, (COALESCE(v.like_count, 0)::FLOAT / 100.0 + COALESCE(v.comment_count, 0)::FLOAT / 20.0 + COALESCE(v.collect_count, 0)::FLOAT / 50.0)) * 0.5 +
        CASE WHEN COALESCE(v.view_count, 0) > 10 THEN LEAST(1.0, (COALESCE(v.like_count, 0)::FLOAT + COALESCE(v.comment_count, 0)::FLOAT + COALESCE(v.collect_count, 0)::FLOAT) / NULLIF(v.view_count, 0) * 10) ELSE 0.5 END * 0.2
      ) as raw_score,
      ROW_NUMBER() OVER (PARTITION BY v.author_id ORDER BY COALESCE(v.published_at, v.created_at) DESC) as author_rank,
      v.media_list, v.images
    FROM public.videos v
    WHERE v.status = 'published' 
      AND v.review_status = 'approved'
      AND v.is_adult = true 
      AND v.is_private = false 
      AND v.storage_type = 'r2' 
      AND (p_user_id IS NULL OR NOT EXISTS (
        SELECT 1 FROM public.watch_history wh 
        WHERE wh.user_id = p_user_id AND wh.video_id = v.id
      ))
      AND (p_exclude_ids IS NULL OR cardinality(p_exclude_ids) = 0 OR NOT (v.id = ANY(p_exclude_ids)))
  )
  SELECT sv.id, sv.title::TEXT, sv.description::TEXT, sv.cover_url::TEXT, sv.play_url::TEXT, sv.duration::FLOAT, sv.content_type::TEXT, sv.tags, sv.status::TEXT, sv.is_adult, sv.is_sea, sv.storage_type::TEXT, sv.author_id, COALESCE(sv.view_count, 0)::INT, COALESCE(sv.like_count, 0)::INT, COALESCE(sv.comment_count, 0)::INT, COALESCE(sv.collect_count, 0)::INT, COALESCE(sv.share_count, 0)::INT, sv.created_at, COALESCE(sv.published_at, sv.created_at),
    (sv.raw_score * 0.15 + (abs(hashtext(sv.id::text || v_mix_seed))::float / 2147483647.0) * 0.85)::FLOAT as final_score,
    sv.media_list, sv.images
  FROM scored_videos sv WHERE sv.author_rank <= 2
  ORDER BY final_score DESC
  LIMIT p_limit OFFSET p_offset;
END; $$ LANGUAGE plpgsql STABLE;
