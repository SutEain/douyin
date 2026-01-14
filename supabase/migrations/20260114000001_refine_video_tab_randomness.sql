-- 优化视频 Tab 推荐函数：支持访客 Key、自动过滤已看、增强随机性
CREATE OR REPLACE FUNCTION public.get_video_tab_feed(
  p_user_id UUID DEFAULT NULL, 
  p_exclude_ids UUID[] DEFAULT ARRAY[]::UUID[],
  p_limit INT DEFAULT 20, 
  p_offset INT DEFAULT 0, 
  p_seed DOUBLE PRECISION DEFAULT 0.5,
  p_visitor_key TEXT DEFAULT NULL -- 🎯 增加访客特征 Key
) RETURNS TABLE(
  id UUID, title TEXT, description TEXT, cover_url TEXT, play_url TEXT,
  duration FLOAT, content_type TEXT, tags TEXT[], status TEXT,
  is_adult BOOLEAN, is_sea BOOLEAN, storage_type TEXT, author_id UUID,
  view_count INT, like_count INT, comment_count INT, collect_count INT,
  share_count INT, created_at TIMESTAMPTZ, published_at TIMESTAMPTZ,
  is_recommended BOOLEAN, score FLOAT
) AS $$
DECLARE
    v_mix_seed TEXT;
BEGIN
  -- 🎯 结合种子和访客特征，生成混淆后的随机文本
  v_mix_seed := COALESCE(p_seed::TEXT, '0.5') || '-' || COALESCE(p_visitor_key, 'anon');

  RETURN QUERY
  WITH scored_videos AS (
    SELECT v.id, v.title, v.description, v.cover_url, v.play_url, v.duration, v.content_type, v.tags, v.status, v.is_adult, v.is_sea, v.storage_type, v.author_id, v.view_count, v.like_count, v.comment_count, v.collect_count, v.share_count, v.created_at, v.published_at, v.is_recommended,
      (
        -- 基础权重分
        GREATEST(0.1, 1.0 - EXTRACT(EPOCH FROM (NOW() - COALESCE(v.published_at, v.created_at))) / (14 * 86400)) * 0.3 + -- 新鲜度
        LEAST(1.0, (COALESCE(v.like_count, 0)::FLOAT / 100.0 + COALESCE(v.comment_count, 0)::FLOAT / 20.0 + COALESCE(v.collect_count, 0)::FLOAT / 50.0)) * 0.4 + -- 互动
        CASE WHEN COALESCE(v.view_count, 0) > 10 THEN LEAST(1.0, (COALESCE(v.like_count, 0)::FLOAT + COALESCE(v.comment_count, 0)::FLOAT + COALESCE(v.collect_count, 0)::FLOAT) / NULLIF(v.view_count, 0) * 10) ELSE 0.5 END * 0.2 + -- 质量
        CASE WHEN v.is_recommended = true THEN 0.5 ELSE 0 END -- 人工推荐
      ) as raw_score,
      ROW_NUMBER() OVER (PARTITION BY v.author_id ORDER BY COALESCE(v.published_at, v.created_at) DESC) as author_rank
    FROM public.videos v
    WHERE v.status = 'published' 
      AND v.review_status = 'approved' -- 🎯 必须审核通过
      AND v.is_adult = false 
      AND v.is_private = false 
      AND v.content_type = 'video' 
      AND v.storage_type = 'r2'
      -- 🎯 排除已看 (内部 watch_history)
      AND (p_user_id IS NULL OR NOT EXISTS (
        SELECT 1 FROM public.watch_history wh 
        WHERE wh.user_id = p_user_id AND wh.video_id = v.id
      ))
      -- 🎯 排除外部传入的 ID
      AND (p_exclude_ids IS NULL OR cardinality(p_exclude_ids) = 0 OR NOT (v.id = ANY(p_exclude_ids)))
  )
  SELECT 
    sv.id, sv.title::TEXT, sv.description::TEXT, sv.cover_url::TEXT, sv.play_url::TEXT, sv.duration::FLOAT, sv.content_type::TEXT, sv.tags, sv.status::TEXT, sv.is_adult, sv.is_sea, sv.storage_type::TEXT, sv.author_id, 
    COALESCE(sv.view_count, 0)::INT, COALESCE(sv.like_count, 0)::INT, COALESCE(sv.comment_count, 0)::INT, COALESCE(sv.collect_count, 0)::INT, COALESCE(sv.share_count, 0)::INT, 
    sv.created_at, COALESCE(sv.published_at, sv.created_at), sv.is_recommended,
    -- 🎯 强随机性：结合哈希扰动
    (sv.raw_score * 0.15 + (abs(hashtext(sv.id::text || v_mix_seed))::float / 2147483647.0) * 0.85)::FLOAT as final_score
  FROM scored_videos sv 
  WHERE sv.author_rank <= 2 
  ORDER BY final_score DESC
  LIMIT p_limit OFFSET p_offset;
END; $$ LANGUAGE plpgsql STABLE;

-- 优化东南亚板块推荐函数
CREATE OR REPLACE FUNCTION public.get_sea_feed(
  p_user_id UUID DEFAULT NULL, 
  p_exclude_ids UUID[] DEFAULT ARRAY[]::UUID[],
  p_limit INT DEFAULT 20, 
  p_offset INT DEFAULT 0, 
  p_seed DOUBLE PRECISION DEFAULT 0.5,
  p_visitor_key TEXT DEFAULT NULL -- 🎯 增加访客特征 Key
) RETURNS TABLE(
  id UUID, title TEXT, description TEXT, cover_url TEXT, play_url TEXT,
  duration FLOAT, content_type TEXT, tags TEXT[], status TEXT,
  is_adult BOOLEAN, is_sea BOOLEAN, storage_type TEXT, author_id UUID,
  view_count INT, like_count INT, comment_count INT, collect_count INT,
  share_count INT, created_at TIMESTAMPTZ, published_at TIMESTAMPTZ,
  score FLOAT
) AS $$
DECLARE
    v_mix_seed TEXT;
BEGIN
  v_mix_seed := COALESCE(p_seed::TEXT, '0.5') || '-' || COALESCE(p_visitor_key, 'anon');

  RETURN QUERY
  WITH scored_videos AS (
    SELECT v.id, v.title, v.description, v.cover_url, v.play_url, v.duration, v.content_type, v.tags, v.status, v.is_adult, v.is_sea, v.storage_type, v.author_id, v.view_count, v.like_count, v.comment_count, v.collect_count, v.share_count, v.created_at, v.published_at,
      (
        GREATEST(0.1, 1.0 - EXTRACT(EPOCH FROM (NOW() - COALESCE(v.published_at, v.created_at))) / (14 * 86400)) * 0.3 +
        LEAST(1.0, (COALESCE(v.like_count, 0)::FLOAT / 100.0 + COALESCE(v.comment_count, 0)::FLOAT / 20.0 + COALESCE(v.collect_count, 0)::FLOAT / 50.0)) * 0.5 +
        CASE WHEN COALESCE(v.view_count, 0) > 10 THEN LEAST(1.0, (COALESCE(v.like_count, 0)::FLOAT + COALESCE(v.comment_count, 0)::FLOAT + COALESCE(v.collect_count, 0)::FLOAT) / NULLIF(v.view_count, 0) * 10) ELSE 0.5 END * 0.2
      ) as raw_score,
      ROW_NUMBER() OVER (PARTITION BY v.author_id ORDER BY COALESCE(v.published_at, v.created_at) DESC) as author_rank
    FROM public.videos v
    WHERE v.status = 'published' 
      AND v.review_status = 'approved'
      AND v.is_adult = false 
      AND v.is_sea = true 
      AND v.is_private = false 
      AND v.content_type = 'video' 
      AND v.storage_type = 'r2' 
      AND (p_user_id IS NULL OR NOT EXISTS (
        SELECT 1 FROM public.watch_history wh 
        WHERE wh.user_id = p_user_id AND wh.video_id = v.id
      ))
      AND (p_exclude_ids IS NULL OR cardinality(p_exclude_ids) = 0 OR NOT (v.id = ANY(p_exclude_ids)))
  )
  SELECT sv.id, sv.title::TEXT, sv.description::TEXT, sv.cover_url::TEXT, sv.play_url::TEXT, sv.duration::FLOAT, sv.content_type::TEXT, sv.tags, sv.status::TEXT, sv.is_adult, sv.is_sea, sv.storage_type::TEXT, sv.author_id, COALESCE(sv.view_count, 0)::INT, COALESCE(sv.like_count, 0)::INT, COALESCE(sv.comment_count, 0)::INT, COALESCE(sv.collect_count, 0)::INT, COALESCE(sv.share_count, 0)::INT, sv.created_at, COALESCE(sv.published_at, sv.created_at),
    (sv.raw_score * 0.15 + (abs(hashtext(sv.id::text || v_mix_seed))::float / 2147483647.0) * 0.85)::FLOAT as final_score
  FROM scored_videos sv WHERE sv.author_rank <= 2
  ORDER BY final_score DESC
  LIMIT p_limit OFFSET p_offset;
END; $$ LANGUAGE plpgsql STABLE;

-- 优化成人内容推荐函数
CREATE OR REPLACE FUNCTION public.get_adult_feed(
  p_user_id UUID DEFAULT NULL, 
  p_exclude_ids UUID[] DEFAULT ARRAY[]::UUID[],
  p_limit INT DEFAULT 20, 
  p_offset INT DEFAULT 0, 
  p_seed DOUBLE PRECISION DEFAULT 0.5,
  p_visitor_key TEXT DEFAULT NULL -- 🎯 增加访客特征 Key
) RETURNS TABLE(
  id UUID, title TEXT, description TEXT, cover_url TEXT, play_url TEXT,
  duration FLOAT, content_type TEXT, tags TEXT[], status TEXT,
  is_adult BOOLEAN, is_sea BOOLEAN, storage_type TEXT, author_id UUID,
  view_count INT, like_count INT, comment_count INT, collect_count INT,
  share_count INT, created_at TIMESTAMPTZ, published_at TIMESTAMPTZ,
  score FLOAT
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
      ROW_NUMBER() OVER (PARTITION BY v.author_id ORDER BY COALESCE(v.published_at, v.created_at) DESC) as author_rank
    FROM public.videos v
    WHERE v.status = 'published' 
      AND v.review_status = 'approved'
      AND v.is_adult = true 
      AND v.is_private = false 
      AND v.content_type = 'video' 
      AND v.storage_type = 'r2' 
      AND (p_user_id IS NULL OR NOT EXISTS (
        SELECT 1 FROM public.watch_history wh 
        WHERE wh.user_id = p_user_id AND wh.video_id = v.id
      ))
      AND (p_exclude_ids IS NULL OR cardinality(p_exclude_ids) = 0 OR NOT (v.id = ANY(p_exclude_ids)))
  )
  SELECT sv.id, sv.title::TEXT, sv.description::TEXT, sv.cover_url::TEXT, sv.play_url::TEXT, sv.duration::FLOAT, sv.content_type::TEXT, sv.tags, sv.status::TEXT, sv.is_adult, sv.is_sea, sv.storage_type::TEXT, sv.author_id, COALESCE(sv.view_count, 0)::INT, COALESCE(sv.like_count, 0)::INT, COALESCE(sv.comment_count, 0)::INT, COALESCE(sv.collect_count, 0)::INT, COALESCE(sv.share_count, 0)::INT, sv.created_at, COALESCE(sv.published_at, sv.created_at),
    (sv.raw_score * 0.15 + (abs(hashtext(sv.id::text || v_mix_seed))::float / 2147483647.0) * 0.85)::FLOAT as final_score
  FROM scored_videos sv WHERE sv.author_rank <= 2
  ORDER BY final_score DESC
  LIMIT p_limit OFFSET p_offset;
END; $$ LANGUAGE plpgsql STABLE;

