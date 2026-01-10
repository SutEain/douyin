-- ========================================
-- 🎯 推荐算法 3.0：基于 Session 种子与加权随机抽样 (WRS)
-- ========================================

-- 1️⃣ 视频 Tab 推荐函数
DROP FUNCTION IF EXISTS get_video_tab_feed(UUID, UUID[], INT, INT);
CREATE OR REPLACE FUNCTION get_video_tab_feed(
  p_user_id UUID DEFAULT NULL,
  p_exclude_ids UUID[] DEFAULT ARRAY[]::UUID[],
  p_limit INT DEFAULT 20,
  p_offset INT DEFAULT 0,
  p_seed FLOAT DEFAULT 0.5  -- 🎯 引入随机种子
)
RETURNS TABLE(
  id UUID,
  title TEXT,
  description TEXT,
  cover_url TEXT,
  play_url TEXT,
  duration FLOAT,
  content_type TEXT,
  tags TEXT[],
  status TEXT,
  is_adult BOOLEAN,
  is_sea BOOLEAN,
  storage_type TEXT,
  author_id UUID,
  view_count INT,
  like_count INT,
  comment_count INT,
  collect_count INT,
  share_count INT,
  created_at TIMESTAMPTZ,
  published_at TIMESTAMPTZ,
  score FLOAT
) AS $$
BEGIN
  -- 设置随机种子，保证同一 Session 分页一致
  PERFORM setseed(p_seed);

  RETURN QUERY
  WITH scored_videos AS (
    SELECT 
      v.id,
      v.title,
      v.description,
      v.cover_url,
      v.play_url,
      v.duration,
      v.content_type,
      v.tags,
      v.status,
      v.is_adult,
      v.is_sea,
      v.storage_type,
      v.author_id,
      v.view_count,
      v.like_count,
      v.comment_count,
      v.collect_count,
      v.share_count,
      v.created_at,
      v.published_at,
      -- 🎯 核心评分逻辑 (保持不变)
      (
        GREATEST(0.1, 1.0 - EXTRACT(EPOCH FROM (NOW() - COALESCE(v.published_at, v.created_at))) / (7 * 86400)) * 0.3 +
        LEAST(1.0, (COALESCE(v.like_count, 0)::FLOAT / 100.0 + COALESCE(v.comment_count, 0)::FLOAT / 20.0 + COALESCE(v.collect_count, 0)::FLOAT / 50.0)) * 0.5 +
        CASE WHEN COALESCE(v.view_count, 0) > 10 THEN LEAST(1.0, (COALESCE(v.like_count, 0)::FLOAT + COALESCE(v.comment_count, 0)::FLOAT + COALESCE(v.collect_count, 0)::FLOAT) / NULLIF(v.view_count, 0) * 10) ELSE 0.5 END * 0.2 +
        CASE WHEN v.is_recommended = true THEN 0.5 ELSE 0 END
      ) as raw_score,
      ROW_NUMBER() OVER (PARTITION BY v.author_id ORDER BY COALESCE(v.published_at, v.created_at) DESC) as author_rank
    FROM videos v
    WHERE v.status = 'published'
      AND v.is_adult = false
      AND v.content_type = 'video'
      AND v.storage_type = 'r2'
      AND (p_exclude_ids IS NULL OR cardinality(p_exclude_ids) = 0 OR NOT (v.id = ANY(p_exclude_ids)))
  )
  SELECT 
    sv.id,
    sv.title::TEXT,
    sv.description::TEXT,
    sv.cover_url::TEXT,
    sv.play_url::TEXT,
    sv.duration::FLOAT,
    sv.content_type::TEXT,
    sv.tags,
    sv.status::TEXT,
    sv.is_adult,
    sv.is_sea,
    sv.storage_type::TEXT,
    sv.author_id,
    COALESCE(sv.view_count, 0)::INT,
    COALESCE(sv.like_count, 0)::INT,
    COALESCE(sv.comment_count, 0)::INT,
    COALESCE(sv.collect_count, 0)::INT,
    COALESCE(sv.share_count, 0)::INT,
    sv.created_at,
    COALESCE(sv.published_at, sv.created_at),
    sv.raw_score::FLOAT
  FROM scored_videos sv
  WHERE sv.author_rank <= 2  -- 🎯 每个作者只取2个
  -- 🎯 强力随机算法：降低分数权重(30%)，提高随机权重(70%)
  -- 这样即使分数差距大，低分视频也有很大概率排到前面
  ORDER BY (sv.raw_score * 0.3 + RANDOM() * 0.7) DESC
  LIMIT p_limit
  OFFSET p_offset;
END;
$$ LANGUAGE plpgsql VOLATILE;

-- 2️⃣ 成人 Tab 推荐函数
DROP FUNCTION IF EXISTS get_adult_feed(UUID, UUID[], INT, INT);
CREATE OR REPLACE FUNCTION get_adult_feed(
  p_user_id UUID DEFAULT NULL,
  p_exclude_ids UUID[] DEFAULT ARRAY[]::UUID[],
  p_limit INT DEFAULT 20,
  p_offset INT DEFAULT 0,
  p_seed FLOAT DEFAULT 0.5
)
RETURNS TABLE(
  id UUID,
  title TEXT,
  description TEXT,
  cover_url TEXT,
  play_url TEXT,
  duration FLOAT,
  content_type TEXT,
  tags TEXT[],
  status TEXT,
  is_adult BOOLEAN,
  is_sea BOOLEAN,
  storage_type TEXT,
  author_id UUID,
  view_count INT,
  like_count INT,
  comment_count INT,
  collect_count INT,
  share_count INT,
  created_at TIMESTAMPTZ,
  published_at TIMESTAMPTZ,
  score FLOAT
) AS $$
BEGIN
  PERFORM setseed(p_seed);

  RETURN QUERY
  WITH scored_videos AS (
    SELECT 
      v.id,
      v.title,
      v.description,
      v.cover_url,
      v.play_url,
      v.duration,
      v.content_type,
      v.tags,
      v.status,
      v.is_adult,
      v.is_sea,
      v.storage_type,
      v.author_id,
      v.view_count,
      v.like_count,
      v.comment_count,
      v.collect_count,
      v.share_count,
      v.created_at,
      v.published_at,
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
      AND (p_exclude_ids IS NULL OR cardinality(p_exclude_ids) = 0 OR NOT (v.id = ANY(p_exclude_ids)))
  )
  SELECT 
    sv.id, sv.title::TEXT, sv.description::TEXT, sv.cover_url::TEXT, sv.play_url::TEXT, sv.duration::FLOAT, sv.content_type::TEXT, sv.tags, sv.status::TEXT, sv.is_adult, sv.is_sea, sv.storage_type::TEXT, sv.author_id, COALESCE(sv.view_count, 0)::INT, COALESCE(sv.like_count, 0)::INT, COALESCE(sv.comment_count, 0)::INT, COALESCE(sv.collect_count, 0)::INT, COALESCE(sv.share_count, 0)::INT, sv.created_at, COALESCE(sv.published_at, sv.created_at), sv.raw_score::FLOAT
  FROM scored_videos sv
  WHERE sv.author_rank <= 2
  ORDER BY POWER(RANDOM(), 1.0 / GREATEST(sv.raw_score, 0.01)) DESC
  LIMIT p_limit
  OFFSET p_offset;
END;
$$ LANGUAGE plpgsql VOLATILE;

-- 3️⃣ 东南亚 Tab 推荐函数
DROP FUNCTION IF EXISTS get_sea_feed(UUID, UUID[], INT, INT);
CREATE OR REPLACE FUNCTION get_sea_feed(
  p_user_id UUID DEFAULT NULL,
  p_exclude_ids UUID[] DEFAULT ARRAY[]::UUID[],
  p_limit INT DEFAULT 20,
  p_offset INT DEFAULT 0,
  p_seed FLOAT DEFAULT 0.5
)
RETURNS TABLE(
  id UUID,
  title TEXT,
  description TEXT,
  cover_url TEXT,
  play_url TEXT,
  duration FLOAT,
  content_type TEXT,
  tags TEXT[],
  status TEXT,
  is_adult BOOLEAN,
  is_sea BOOLEAN,
  storage_type TEXT,
  author_id UUID,
  view_count INT,
  like_count INT,
  comment_count INT,
  collect_count INT,
  share_count INT,
  created_at TIMESTAMPTZ,
  published_at TIMESTAMPTZ,
  score FLOAT
) AS $$
BEGIN
  PERFORM setseed(p_seed);

  RETURN QUERY
  WITH scored_videos AS (
    SELECT 
      v.id,
      v.title,
      v.description,
      v.cover_url,
      v.play_url,
      v.duration,
      v.content_type,
      v.tags,
      v.status,
      v.is_adult,
      v.is_sea,
      v.storage_type,
      v.author_id,
      v.view_count,
      v.like_count,
      v.comment_count,
      v.collect_count,
      v.share_count,
      v.created_at,
      v.published_at,
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
      AND v.storage_type = 'r2'
      AND (p_exclude_ids IS NULL OR cardinality(p_exclude_ids) = 0 OR NOT (v.id = ANY(p_exclude_ids)))
  )
  SELECT 
    sv.id, sv.title::TEXT, sv.description::TEXT, sv.cover_url::TEXT, sv.play_url::TEXT, sv.duration::FLOAT, sv.content_type::TEXT, sv.tags, sv.status::TEXT, sv.is_adult, sv.is_sea, sv.storage_type::TEXT, sv.author_id, COALESCE(sv.view_count, 0)::INT, COALESCE(sv.like_count, 0)::INT, COALESCE(sv.comment_count, 0)::INT, COALESCE(sv.collect_count, 0)::INT, COALESCE(sv.share_count, 0)::INT, sv.created_at, COALESCE(sv.published_at, sv.created_at), sv.raw_score::FLOAT
  FROM scored_videos sv
  WHERE sv.author_rank <= 2
  ORDER BY POWER(RANDOM(), 1.0 / GREATEST(sv.raw_score, 0.01)) DESC
  LIMIT p_limit
  OFFSET p_offset;
END;
$$ LANGUAGE plpgsql VOLATILE;
