-- 🚀 优化推荐流性能：解决越刷越卡的问题
-- 问题分析：
-- 1. exclude_ids 数组会无限增长，导致 SQL 查询变慢
-- 2. watch_history 表查询在数据量大时变慢
-- 3. 前端列表数据无限堆积

-- ============================================
-- 1. 优化 get_optimized_video_feed：限制 exclude_ids 数量，优化 watch_history 查询
-- ============================================
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
  media_list JSONB, images JSONB
) AS $$
DECLARE
    v_mix_seed TEXT;
    v_exclude_ids_limited UUID[]; -- 🚀 限制 exclude_ids 数量
    v_watched_video_ids UUID[]; -- 🚀 预加载用户观看历史（最多500条）
BEGIN
  -- 🚀 限制 exclude_ids 数量（最多200个，避免 SQL 查询变慢）
  IF cardinality(p_exclude_ids) > 200 THEN
    v_exclude_ids_limited := p_exclude_ids[1:200];
  ELSE
    v_exclude_ids_limited := p_exclude_ids;
  END IF;

  -- 🚀 预加载用户观看历史（最多500条），避免在 WHERE 子句中重复查询
  IF p_user_id IS NOT NULL THEN
    SELECT ARRAY_AGG(video_id) INTO v_watched_video_ids
    FROM (
      SELECT video_id
      FROM public.watch_history
      WHERE user_id = p_user_id
      ORDER BY updated_at DESC
      LIMIT 500
    ) wh;
  END IF;

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
      -- 🚀 优化：使用预加载的数组，避免 NOT EXISTS 子查询
      AND (v_watched_video_ids IS NULL OR NOT (v.id = ANY(v_watched_video_ids)))
      -- 🚀 限制 exclude_ids 数量
      AND (v_exclude_ids_limited IS NULL OR cardinality(v_exclude_ids_limited) = 0 OR NOT (v.id = ANY(v_exclude_ids_limited)))
  )
  SELECT sv.id, sv.title::TEXT, sv.description::TEXT, sv.cover_url::TEXT, sv.play_url::TEXT, sv.duration::FLOAT, sv.content_type::TEXT, sv.tags, sv.status::TEXT, sv.is_adult, sv.is_sea, sv.storage_type::TEXT, sv.author_id, COALESCE(sv.view_count, 0)::INT, COALESCE(sv.like_count, 0)::INT, COALESCE(sv.comment_count, 0)::INT, COALESCE(sv.collect_count, 0)::INT, COALESCE(sv.share_count, 0)::INT, sv.created_at, COALESCE(sv.published_at, sv.created_at), sv.is_recommended, (sv.raw_score * 0.1 + (abs(hashtext(sv.id::text || v_mix_seed))::float / 2147483647.0) * 0.9)::FLOAT as final_score,
  sv.media_list, sv.images
  FROM scored_videos sv WHERE sv.author_rank <= 2 ORDER BY final_score DESC LIMIT p_limit OFFSET p_offset;
END; $$ LANGUAGE plpgsql STABLE;

COMMENT ON FUNCTION public.get_optimized_video_feed IS '🚀 优化推荐流性能：限制 exclude_ids 数量（最多200），预加载观看历史（最多500），避免重复查询';
