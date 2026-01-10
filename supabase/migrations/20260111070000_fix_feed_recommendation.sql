-- 🎯 修复首页推荐算法：添加随机种子 + 优化排除观看历史
-- 问题：
-- 1. random() 没有使用 seed，导致每次返回相同顺序
-- 2. 需要混合新鲜度和随机性

CREATE OR REPLACE FUNCTION public.get_optimized_video_feed(
  p_user_id UUID,
  p_type TEXT DEFAULT 'recommend', -- 'recommend' | 'adult' | 'sea'
  p_limit INT DEFAULT 10,
  p_seed DOUBLE PRECISION DEFAULT 0.5 -- 新增：随机种子
)
RETURNS SETOF videos
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_recommend_count INT;
  v_normal_count INT;
  v_rec_fetched INT := 0;
  v_history_limit INT := 500; -- 排除最近 500 条观看历史
BEGIN
  -- 🎯 设置随机种子（基于传入的 seed + 当前时间微秒，确保每次都不同）
  PERFORM setseed((p_seed + EXTRACT(EPOCH FROM clock_timestamp()))::DOUBLE PRECISION - FLOOR((p_seed + EXTRACT(EPOCH FROM clock_timestamp()))::DOUBLE PRECISION));
  
  -- 🎯 根据类型决定推荐/普通视频比例
  IF p_type = 'recommend' THEN
    -- 首页推荐流：7 推荐 + 3 普通
    v_recommend_count := LEAST(CEIL(p_limit * 0.7), p_limit);
    v_normal_count := p_limit - v_recommend_count;
    
    -- 1. 获取推荐视频（排除成人、东南亚、已观看）
    -- 🎯 混合权重：70% 随机 + 30% 新鲜度
    RETURN QUERY
    SELECT v.* FROM videos v
    WHERE v.status = 'published'
      AND v.is_adult = false
      AND v.is_sea = false
      AND v.is_recommended = true
      AND (
        p_user_id IS NULL
        OR NOT EXISTS (
          SELECT 1 FROM watch_history wh
          WHERE wh.user_id = p_user_id
            AND wh.video_id = v.id
          ORDER BY wh.updated_at DESC
          LIMIT v_history_limit
        )
      )
    ORDER BY 
      -- 混合排序：随机 + 发布时间（越新越好）
      (random() * 0.7 + EXTRACT(EPOCH FROM (NOW() - v.published_at)) / 86400.0 * 0.3)
    LIMIT v_recommend_count;
    
    GET DIAGNOSTICS v_rec_fetched = ROW_COUNT;
    
    -- 2. 获取普通视频补充（排除成人、东南亚、已观看）
    RETURN QUERY
    SELECT v.* FROM videos v
    WHERE v.status = 'published'
      AND v.is_adult = false
      AND v.is_sea = false
      AND v.is_recommended = false
      AND (
        p_user_id IS NULL
        OR NOT EXISTS (
          SELECT 1 FROM watch_history wh
          WHERE wh.user_id = p_user_id
            AND wh.video_id = v.id
          ORDER BY wh.updated_at DESC
          LIMIT v_history_limit
        )
      )
    ORDER BY 
      -- 混合排序：随机 + 发布时间
      (random() * 0.7 + EXTRACT(EPOCH FROM (NOW() - v.published_at)) / 86400.0 * 0.3)
    LIMIT (v_normal_count + GREATEST(0, v_recommend_count - v_rec_fetched));
    
  ELSIF p_type = 'adult' THEN
    -- 成人内容流：只返回成人内容（排除已观看）
    RETURN QUERY
    SELECT v.* FROM videos v
    WHERE v.status = 'published'
      AND v.is_adult = true
      AND (
        p_user_id IS NULL
        OR NOT EXISTS (
          SELECT 1 FROM watch_history wh
          WHERE wh.user_id = p_user_id
            AND wh.video_id = v.id
          ORDER BY wh.updated_at DESC
          LIMIT v_history_limit
        )
      )
    ORDER BY (random() * 0.7 + EXTRACT(EPOCH FROM (NOW() - v.published_at)) / 86400.0 * 0.3)
    LIMIT p_limit;
    
  ELSIF p_type = 'sea' THEN
    -- 东南亚内容流：只返回东南亚内容（排除成人、已观看）
    RETURN QUERY
    SELECT v.* FROM videos v
    WHERE v.status = 'published'
      AND v.is_adult = false
      AND v.is_sea = true
      AND (
        p_user_id IS NULL
        OR NOT EXISTS (
          SELECT 1 FROM watch_history wh
          WHERE wh.user_id = p_user_id
            AND wh.video_id = v.id
          ORDER BY wh.updated_at DESC
          LIMIT v_history_limit
        )
      )
    ORDER BY (random() * 0.7 + EXTRACT(EPOCH FROM (NOW() - v.published_at)) / 86400.0 * 0.3)
    LIMIT p_limit;
    
  ELSE
    -- 默认：普通视频流（排除成人、东南亚、已观看）
    RETURN QUERY
    SELECT v.* FROM videos v
    WHERE v.status = 'published'
      AND v.is_adult = false
      AND v.is_sea = false
      AND (
        p_user_id IS NULL
        OR NOT EXISTS (
          SELECT 1 FROM watch_history wh
          WHERE wh.user_id = p_user_id
            AND wh.video_id = v.id
          ORDER BY wh.updated_at DESC
          LIMIT v_history_limit
        )
      )
    ORDER BY (random() * 0.7 + EXTRACT(EPOCH FROM (NOW() - v.published_at)) / 86400.0 * 0.3)
    LIMIT p_limit;
  END IF;
  
  RETURN;
END;
$$;

-- 🔐 重新授予权限（参数数量变了）
DROP FUNCTION IF EXISTS public.get_optimized_video_feed(UUID, TEXT, INT, INT);
GRANT EXECUTE ON FUNCTION public.get_optimized_video_feed(UUID, TEXT, INT, DOUBLE PRECISION) TO anon;
GRANT EXECUTE ON FUNCTION public.get_optimized_video_feed(UUID, TEXT, INT, DOUBLE PRECISION) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_optimized_video_feed(UUID, TEXT, INT, DOUBLE PRECISION) TO service_role;

-- 📝 更新函数注释
COMMENT ON FUNCTION public.get_optimized_video_feed IS '优化的视频推荐流，支持随机种子、排除观看历史和多种内容类型。排序混合随机性和新鲜度。';

