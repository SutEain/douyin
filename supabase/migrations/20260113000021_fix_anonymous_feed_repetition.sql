-- 优化推荐流函数：增强随机性、对齐审核状态、优化匿名用户体验
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
DECLARE
    v_seed_text TEXT;
BEGIN
  -- 🎯 增强随机性：如果种子是默认值或用户未登录，混入动态因素
  IF p_user_id IS NULL AND (p_seed = 0.5 OR p_seed IS NULL) THEN
    v_seed_text := (EXTRACT(EPOCH FROM NOW())::TEXT); -- 使用当前时间戳作为扰动
  ELSE
    v_seed_text := p_seed::TEXT;
  END IF;

  RETURN QUERY
  WITH scored_videos AS (
    SELECT v.id, v.title, v.description, v.cover_url, v.play_url, v.duration, v.content_type, v.tags, v.status, v.is_adult, v.is_sea, v.storage_type, v.author_id, v.view_count, v.like_count, v.comment_count, v.collect_count, v.share_count, v.created_at, v.published_at, v.is_recommended,
      (
        -- 基础分算法
        GREATEST(0.1, 1.0 - EXTRACT(EPOCH FROM (NOW() - COALESCE(v.published_at, v.created_at))) / (14 * 86400)) * 0.3 + -- 新鲜度（拉长到14天）
        LEAST(1.0, (COALESCE(v.like_count, 0)::FLOAT / 100.0 + COALESCE(v.comment_count, 0)::FLOAT / 20.0 + COALESCE(v.collect_count, 0)::FLOAT / 50.0)) * 0.4 + -- 互动量
        CASE WHEN COALESCE(v.view_count, 0) > 10 THEN LEAST(1.0, (COALESCE(v.like_count, 0)::FLOAT + COALESCE(v.comment_count, 0)::FLOAT + COALESCE(v.collect_count, 0)::FLOAT) / NULLIF(v.view_count, 0) * 10) ELSE 0.5 END * 0.2 + -- 转化率
        CASE WHEN v.is_recommended = true THEN 0.5 ELSE 0 END -- 人工推荐权重
      ) as raw_score,
      ROW_NUMBER() OVER (PARTITION BY v.author_id ORDER BY COALESCE(v.published_at, v.created_at) DESC) as author_rank
    FROM public.videos v
    WHERE v.status = 'published' 
      AND v.review_status = 'approved' -- 🎯 必须通过审核，对齐 RLS 策略
      AND v.is_adult = false 
      AND v.is_private = false 
      AND v.content_type = 'video' 
      AND v.storage_type = 'r2'
      -- 🎯 登录用户排除已观看历史
      AND (p_user_id IS NULL OR NOT EXISTS (
        SELECT 1 FROM public.watch_history wh 
        WHERE wh.user_id = p_user_id AND wh.video_id = v.id
      ))
  )
  SELECT 
    sv.id, sv.title::TEXT, sv.description::TEXT, sv.cover_url::TEXT, sv.play_url::TEXT, sv.duration::FLOAT, sv.content_type::TEXT, sv.tags, sv.status::TEXT, sv.is_adult, sv.is_sea, sv.storage_type::TEXT, sv.author_id, 
    COALESCE(sv.view_count, 0)::INT, COALESCE(sv.like_count, 0)::INT, COALESCE(sv.comment_count, 0)::INT, COALESCE(sv.collect_count, 0)::INT, COALESCE(sv.share_count, 0)::INT, 
    sv.created_at, COALESCE(sv.published_at, sv.created_at), sv.is_recommended,
    -- 🎯 最终随机分：增加扰动强度，确保匿名用户每次打开都不一样
    (sv.raw_score * 0.15 + (abs(hashtext(sv.id::text || v_seed_text))::float / 2147483647.0) * 0.85)::FLOAT as final_score
  FROM scored_videos sv 
  WHERE sv.author_rank <= 2 
  ORDER BY final_score DESC
  LIMIT p_limit OFFSET p_offset;
END; $$ LANGUAGE plpgsql STABLE;
