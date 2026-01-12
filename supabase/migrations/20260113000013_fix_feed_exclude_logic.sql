-- 🎯 修复东南亚和成人板块的排除逻辑
-- 确保 exclude_ids 正确排除已观看的视频

-- 1️⃣ 修复 get_sea_feed 函数：优化排除逻辑，确保正确排除
CREATE OR REPLACE FUNCTION get_sea_feed(
  p_user_id UUID DEFAULT NULL, 
  p_exclude_ids UUID[] DEFAULT ARRAY[]::UUID[],
  p_limit INT DEFAULT 20, 
  p_offset INT DEFAULT 0, 
  p_seed FLOAT DEFAULT 0.5
)
RETURNS TABLE(
  id UUID, title TEXT, description TEXT, cover_url TEXT, play_url TEXT,
  duration FLOAT, content_type TEXT, tags TEXT[], status TEXT,
  is_adult BOOLEAN, is_sea BOOLEAN, storage_type TEXT, author_id UUID,
  view_count INT, like_count INT, comment_count INT, collect_count INT,
  share_count INT, created_at TIMESTAMPTZ, published_at TIMESTAMPTZ, score FLOAT
) AS $$
BEGIN
  RETURN QUERY
  WITH scored_videos AS (
    SELECT v.id, v.title, v.description, v.cover_url, v.play_url, v.duration, v.content_type, v.tags, v.status, v.is_adult, v.is_sea, v.storage_type, v.author_id, v.view_count, v.like_count, v.comment_count, v.collect_count, v.share_count, v.created_at, v.published_at,
      (
        GREATEST(0.1, 1.0 - EXTRACT(EPOCH FROM (NOW() - COALESCE(v.published_at, v.created_at))) / (7 * 86400)) * 0.3 +
        LEAST(1.0, (COALESCE(v.like_count, 0)::FLOAT / 100.0 + COALESCE(v.comment_count, 0)::FLOAT / 20.0 + COALESCE(v.collect_count, 0)::FLOAT / 50.0)) * 0.5 +
        CASE WHEN COALESCE(v.view_count, 0) > 10 THEN LEAST(1.0, (COALESCE(v.like_count, 0)::FLOAT + COALESCE(v.comment_count, 0)::FLOAT + COALESCE(v.collect_count, 0)::FLOAT) / NULLIF(v.view_count, 0) * 10) ELSE 0.5 END * 0.2
      ) as raw_score,
      ROW_NUMBER() OVER (PARTITION BY v.author_id ORDER BY COALESCE(v.published_at, v.created_at) DESC) as author_rank
    FROM videos v
    WHERE v.status = 'published' 
      AND v.is_adult = false 
      AND v.is_sea = true 
      AND v.content_type = 'video' 
      AND v.storage_type = 'r2' 
      -- 🎯 修复排除逻辑：如果 exclude_ids 不为空，则排除这些视频
      AND (
        p_exclude_ids IS NULL 
        OR cardinality(p_exclude_ids) = 0 
        OR v.id != ALL(p_exclude_ids)  -- 🎯 使用 != ALL 更清晰
      )
  )
  SELECT sv.id, sv.title::TEXT, sv.description::TEXT, sv.cover_url::TEXT, sv.play_url::TEXT, sv.duration::FLOAT, sv.content_type::TEXT, sv.tags, sv.status::TEXT, sv.is_adult, sv.is_sea, sv.storage_type::TEXT, sv.author_id, COALESCE(sv.view_count, 0)::INT, COALESCE(sv.like_count, 0)::INT, COALESCE(sv.comment_count, 0)::INT, COALESCE(sv.collect_count, 0)::INT, COALESCE(sv.share_count, 0)::INT, sv.created_at, COALESCE(sv.published_at, sv.created_at), sv.raw_score::FLOAT
  FROM scored_videos sv WHERE sv.author_rank <= 2
  ORDER BY (sv.raw_score * 0.2 + (abs(hashtext(sv.id::text || p_seed::text))::float / 2147483647.0) * 0.8) DESC
  LIMIT p_limit OFFSET p_offset;
END; $$ LANGUAGE plpgsql STABLE;

-- 2️⃣ 修复 get_adult_feed 函数：优化排除逻辑，确保正确排除
CREATE OR REPLACE FUNCTION get_adult_feed(
  p_user_id UUID DEFAULT NULL, 
  p_exclude_ids UUID[] DEFAULT ARRAY[]::UUID[],
  p_limit INT DEFAULT 20, 
  p_offset INT DEFAULT 0, 
  p_seed FLOAT DEFAULT 0.5
)
RETURNS TABLE(
  id UUID, title TEXT, description TEXT, cover_url TEXT, play_url TEXT,
  duration FLOAT, content_type TEXT, tags TEXT[], status TEXT,
  is_adult BOOLEAN, is_sea BOOLEAN, storage_type TEXT, author_id UUID,
  view_count INT, like_count INT, comment_count INT, collect_count INT,
  share_count INT, created_at TIMESTAMPTZ, published_at TIMESTAMPTZ, score FLOAT
) AS $$
BEGIN
  RETURN QUERY
  WITH scored_videos AS (
    SELECT v.id, v.title, v.description, v.cover_url, v.play_url, v.duration, v.content_type, v.tags, v.status, v.is_adult, v.is_sea, v.storage_type, v.author_id, v.view_count, v.like_count, v.comment_count, v.collect_count, v.share_count, v.created_at, v.published_at,
      (
        GREATEST(0.1, 1.0 - EXTRACT(EPOCH FROM (NOW() - COALESCE(v.published_at, v.created_at))) / (7 * 86400)) * 0.3 +
        LEAST(1.0, (COALESCE(v.like_count, 0)::FLOAT / 100.0 + COALESCE(v.comment_count, 0)::FLOAT / 20.0 + COALESCE(v.collect_count, 0)::FLOAT / 50.0)) * 0.5 +
        CASE WHEN COALESCE(v.view_count, 0) > 10 THEN LEAST(1.0, (COALESCE(v.like_count, 0)::FLOAT + COALESCE(v.comment_count, 0)::FLOAT + COALESCE(v.collect_count, 0)::FLOAT) / NULLIF(v.view_count, 0) * 10) ELSE 0.5 END * 0.2
      ) as raw_score,
      ROW_NUMBER() OVER (PARTITION BY v.author_id ORDER BY COALESCE(v.published_at, v.created_at) DESC) as author_rank
    FROM videos v
    WHERE v.status = 'published' 
      AND v.is_adult = true 
      AND v.content_type = 'video' 
      AND v.storage_type = 'r2' 
      -- 🎯 修复排除逻辑：如果 exclude_ids 不为空，则排除这些视频
      AND (
        p_exclude_ids IS NULL 
        OR cardinality(p_exclude_ids) = 0 
        OR v.id != ALL(p_exclude_ids)  -- 🎯 使用 != ALL 更清晰
      )
  )
  SELECT sv.id, sv.title::TEXT, sv.description::TEXT, sv.cover_url::TEXT, sv.play_url::TEXT, sv.duration::FLOAT, sv.content_type::TEXT, sv.tags, sv.status::TEXT, sv.is_adult, sv.is_sea, sv.storage_type::TEXT, sv.author_id, COALESCE(sv.view_count, 0)::INT, COALESCE(sv.like_count, 0)::INT, COALESCE(sv.comment_count, 0)::INT, COALESCE(sv.collect_count, 0)::INT, COALESCE(sv.share_count, 0)::INT, sv.created_at, COALESCE(sv.published_at, sv.created_at), sv.raw_score::FLOAT
  FROM scored_videos sv WHERE sv.author_rank <= 2
  ORDER BY (sv.raw_score * 0.2 + (abs(hashtext(sv.id::text || p_seed::text))::float / 2147483647.0) * 0.8) DESC
  LIMIT p_limit OFFSET p_offset;
END; $$ LANGUAGE plpgsql STABLE;

COMMENT ON FUNCTION get_sea_feed IS '东南亚板块推荐函数，支持排除已观看视频（通过 p_exclude_ids 参数）';
COMMENT ON FUNCTION get_adult_feed IS '成人板块推荐函数，支持排除已观看视频（通过 p_exclude_ids 参数）';

