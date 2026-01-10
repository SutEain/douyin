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
  SELECT 
    v.id,
    v.title::TEXT,
    v.description::TEXT,
    v.cover_url::TEXT,
    v.play_url::TEXT,
    v.duration::FLOAT,
    v.content_type::TEXT,
    v.tags,
    v.status::TEXT,
    v.is_adult,
    v.is_sea,
    v.storage_type::TEXT,
    v.author_id,
    v.view_count,
    v.like_count,
    v.comment_count,
    v.collect_count,
    v.share_count,
    v.created_at,
    v.published_at,
    -- 🎯 计算推荐分数
    -- 公式：时间分(30%) + 互动分(50%) + 互动率(20%)
    (
      -- 1️⃣ 时间分：最近7天满分1.0，之后逐渐衰减到0.1
      GREATEST(0.1, 1.0 - EXTRACT(EPOCH FROM (NOW() - COALESCE(v.published_at, v.created_at))) / (7 * 86400)) * 0.3 +
      
      -- 2️⃣ 互动分：点赞、评论、收藏的绝对数量
      -- 每100赞=1分，每20评论=1分，每50收藏=1分，封顶1.0
      LEAST(1.0, (
        COALESCE(v.like_count, 0)::FLOAT / 100.0 +
        COALESCE(v.comment_count, 0)::FLOAT / 20.0 +
        COALESCE(v.collect_count, 0)::FLOAT / 50.0
      )) * 0.5 +
      
      -- 3️⃣ 互动率：互动数/观看数，反映内容质量
      CASE 
        WHEN COALESCE(v.view_count, 0) > 10 THEN
          -- 有足够观看数据，计算互动率
          LEAST(1.0, (
            COALESCE(v.like_count, 0)::FLOAT + 
            COALESCE(v.comment_count, 0)::FLOAT + 
            COALESCE(v.collect_count, 0)::FLOAT
          ) / NULLIF(v.view_count, 0) * 10) -- 10%互动率 = 满分
        ELSE 
          -- 新视频给默认0.5分，避免冷启动问题
          0.5
      END * 0.2
    ) as score
  FROM videos v
  WHERE v.status = 'published'
    AND v.is_adult = false
    AND v.content_type = 'video'
    AND v.storage_type = 'r2'
    AND (p_exclude_ids IS NULL OR cardinality(p_exclude_ids) = 0 OR NOT (v.id = ANY(p_exclude_ids)))
  ORDER BY score DESC, v.published_at DESC, v.id DESC  -- 三级排序确保稳定性
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
COMMENT ON FUNCTION get_video_tab_feed IS '视频tab推荐算法：时间(30%) + 互动数(50%) + 互动率(20%)混合排序，解决纯时间倒序导致优质老内容无法被发现的问题';

