-- 🎯 视频tab优化：热度+时间混合排序
-- 目标：让优质内容更容易被发现，同时给新内容曝光机会

CREATE OR REPLACE FUNCTION get_video_tab_feed(
  p_user_id UUID DEFAULT NULL,
  p_exclude_ids UUID[] DEFAULT ARRAY[]::UUID[],
  p_limit INT DEFAULT 20,
  p_offset INT DEFAULT 0
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
      -- 🎯 计算推荐分数
      (
        GREATEST(0.1, 1.0 - EXTRACT(EPOCH FROM (NOW() - COALESCE(v.published_at, v.created_at))) / (7 * 86400)) * 0.3 +
        LEAST(1.0, (
          COALESCE(v.like_count, 0)::FLOAT / 100.0 +
          COALESCE(v.comment_count, 0)::FLOAT / 20.0 +
          COALESCE(v.collect_count, 0)::FLOAT / 50.0
        )) * 0.5 +
        CASE 
          WHEN COALESCE(v.view_count, 0) > 10 THEN
            LEAST(1.0, (
              COALESCE(v.like_count, 0)::FLOAT + 
              COALESCE(v.comment_count, 0)::FLOAT + 
              COALESCE(v.collect_count, 0)::FLOAT
            ) / NULLIF(v.view_count, 0) * 10)
          ELSE 
            0.5
        END * 0.2 +
        CASE 
          WHEN v.is_recommended = true THEN 0.5
          ELSE 0
        END
      ) as score,
      -- 🎯 作者分散：每个作者在同一批次中的排名
      ROW_NUMBER() OVER (PARTITION BY v.author_id ORDER BY 
        COALESCE(v.published_at, v.created_at) DESC
      ) as author_rank
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
    sv.score::FLOAT
  FROM scored_videos sv
  WHERE sv.author_rank <= 3  -- 🎯 每个作者最多3个视频参与排序
  ORDER BY sv.score DESC, sv.published_at DESC, sv.id DESC
  LIMIT p_limit
  OFFSET p_offset;
END;
$$ LANGUAGE plpgsql STABLE;

-- 🎯 添加复合索引优化查询性能
CREATE INDEX IF NOT EXISTS idx_videos_tab_feed_optimized 
ON videos(status, is_adult, content_type, storage_type, published_at DESC, id DESC)
WHERE status = 'published' AND is_adult = false AND content_type = 'video' AND storage_type = 'r2';

-- 🎯 添加统计字段索引（用于分数计算）
CREATE INDEX IF NOT EXISTS idx_videos_engagement_stats 
ON videos(view_count, like_count, comment_count, collect_count, share_count)
WHERE status = 'published' AND is_adult = false;

-- 🎯 注释说明
COMMENT ON FUNCTION get_video_tab_feed IS '视频tab推荐算法：时间(30%) + 互动数(50%) + 互动率(20%) + 推荐加权(+0.5)，运营推荐的视频会优先展示';

-- ========================================
-- 🔞 成人内容优化排序
-- ========================================

-- 先删除所有可能存在的旧函数版本
DO $$ 
BEGIN
  -- 删除所有名为 get_adult_feed 的函数
  DROP FUNCTION IF EXISTS public.get_adult_feed(uuid, text, integer) CASCADE;
  DROP FUNCTION IF EXISTS public.get_adult_feed(uuid, uuid[], integer, integer) CASCADE;
  -- 可能还有其他参数列表的版本，用通配删除
  EXECUTE (
    SELECT string_agg('DROP FUNCTION IF EXISTS ' || oid::regprocedure || ' CASCADE;', E'\n')
    FROM pg_proc
    WHERE proname = 'get_adult_feed'
  );
EXCEPTION
  WHEN OTHERS THEN
    -- 忽略错误，继续执行
    NULL;
END $$;

CREATE OR REPLACE FUNCTION get_adult_feed(
  p_user_id UUID DEFAULT NULL,
  p_exclude_ids UUID[] DEFAULT ARRAY[]::UUID[],
  p_limit INT DEFAULT 20,
  p_offset INT DEFAULT 0
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
      -- 🎯 计算推荐分数（成人内容没有推荐加权）
      (
        GREATEST(0.1, 1.0 - EXTRACT(EPOCH FROM (NOW() - COALESCE(v.published_at, v.created_at))) / (7 * 86400)) * 0.3 +
        LEAST(1.0, (
          COALESCE(v.like_count, 0)::FLOAT / 100.0 +
          COALESCE(v.comment_count, 0)::FLOAT / 20.0 +
          COALESCE(v.collect_count, 0)::FLOAT / 50.0
        )) * 0.5 +
        CASE 
          WHEN COALESCE(v.view_count, 0) > 10 THEN
            LEAST(1.0, (
              COALESCE(v.like_count, 0)::FLOAT + 
              COALESCE(v.comment_count, 0)::FLOAT + 
              COALESCE(v.collect_count, 0)::FLOAT
            ) / NULLIF(v.view_count, 0) * 10)
          ELSE 
            0.5
        END * 0.2
      ) as score,
      -- 🎯 作者分散：每个作者在同一批次中的排名
      ROW_NUMBER() OVER (PARTITION BY v.author_id ORDER BY 
        COALESCE(v.published_at, v.created_at) DESC
      ) as author_rank
    FROM videos v
    WHERE v.status = 'published'
      AND v.is_adult = true
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
    sv.score::FLOAT
  FROM scored_videos sv
  WHERE sv.author_rank <= 3  -- 🎯 每个作者最多3个视频参与排序
  ORDER BY sv.score DESC, sv.published_at DESC, sv.id DESC
  LIMIT p_limit
  OFFSET p_offset;
END;
$$ LANGUAGE plpgsql STABLE;

-- 🎯 添加索引优化成人内容查询
CREATE INDEX IF NOT EXISTS idx_videos_adult_feed_optimized 
ON videos(status, is_adult, content_type, storage_type, published_at DESC, id DESC)
WHERE status = 'published' AND is_adult = true AND content_type = 'video' AND storage_type = 'r2';

COMMENT ON FUNCTION get_adult_feed IS '成人内容推荐算法：时间(30%) + 互动数(50%) + 互动率(20%)混合排序，优质内容优先';

-- ========================================
-- 🌏 东南亚内容优化排序
-- ========================================

-- 先删除旧函数
DO $$ 
BEGIN
  EXECUTE (
    SELECT string_agg('DROP FUNCTION IF EXISTS ' || oid::regprocedure || ' CASCADE;', E'\n')
    FROM pg_proc
    WHERE proname = 'get_sea_feed'
  );
EXCEPTION
  WHEN OTHERS THEN NULL;
END $$;

CREATE OR REPLACE FUNCTION get_sea_feed(
  p_user_id UUID DEFAULT NULL,
  p_exclude_ids UUID[] DEFAULT ARRAY[]::UUID[],
  p_limit INT DEFAULT 20,
  p_offset INT DEFAULT 0
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
      -- 🎯 计算推荐分数（东南亚内容没有推荐加权）
      (
        GREATEST(0.1, 1.0 - EXTRACT(EPOCH FROM (NOW() - COALESCE(v.published_at, v.created_at))) / (7 * 86400)) * 0.3 +
        LEAST(1.0, (
          COALESCE(v.like_count, 0)::FLOAT / 100.0 +
          COALESCE(v.comment_count, 0)::FLOAT / 20.0 +
          COALESCE(v.collect_count, 0)::FLOAT / 50.0
        )) * 0.5 +
        CASE 
          WHEN COALESCE(v.view_count, 0) > 10 THEN
            LEAST(1.0, (
              COALESCE(v.like_count, 0)::FLOAT + 
              COALESCE(v.comment_count, 0)::FLOAT + 
              COALESCE(v.collect_count, 0)::FLOAT
            ) / NULLIF(v.view_count, 0) * 10)
          ELSE 
            0.5
        END * 0.2
      ) as score,
      -- 🎯 作者分散：每个作者在同一批次中的排名
      ROW_NUMBER() OVER (PARTITION BY v.author_id ORDER BY 
        COALESCE(v.published_at, v.created_at) DESC
      ) as author_rank
    FROM videos v
    WHERE v.status = 'published'
      AND v.is_adult = false
      AND v.is_sea = true
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
    sv.score::FLOAT
  FROM scored_videos sv
  WHERE sv.author_rank <= 3  -- 🎯 每个作者最多3个视频参与排序
  ORDER BY sv.score DESC, sv.published_at DESC, sv.id DESC
  LIMIT p_limit
  OFFSET p_offset;
END;
$$ LANGUAGE plpgsql STABLE;

-- 🎯 添加索引优化东南亚内容查询
CREATE INDEX IF NOT EXISTS idx_videos_sea_feed_optimized 
ON videos(status, is_adult, is_sea, storage_type, published_at DESC, id DESC)
WHERE status = 'published' AND is_adult = false AND is_sea = true AND storage_type = 'r2';

COMMENT ON FUNCTION get_sea_feed IS '东南亚内容推荐算法：时间(30%) + 互动数(50%) + 互动率(20%)混合排序，优质内容优先';

