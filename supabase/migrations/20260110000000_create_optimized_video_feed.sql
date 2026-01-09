-- 🎯 创建优化的视频推荐流函数
-- 用于首页推荐流，排除用户已观看的视频
-- 支持推荐/普通/成人内容混合

CREATE OR REPLACE FUNCTION public.get_optimized_video_feed(
  p_user_id UUID,
  p_type TEXT DEFAULT 'recommend', -- 'recommend' | 'adult' | 'sea'
  p_limit INT DEFAULT 10,
  p_history_limit INT DEFAULT 300  -- 排除最近 N 条观看历史
)
RETURNS SETOF videos
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_recommend_count INT;
  v_normal_count INT;
  v_rec_fetched INT := 0;
BEGIN
  -- 🎯 根据类型决定推荐/普通视频比例
  IF p_type = 'recommend' THEN
    -- 首页推荐流：7 推荐 + 3 普通
    v_recommend_count := LEAST(CEIL(p_limit * 0.7), p_limit);
    v_normal_count := p_limit - v_recommend_count;
    
    -- 1. 获取推荐视频（排除成人、东南亚、已观看）
    RETURN QUERY
    SELECT v.* FROM videos v
    WHERE v.status = 'published'
      AND v.is_adult = false
      AND v.is_sea = false
      AND v.is_recommended = true
      AND (
        p_user_id IS NULL
        OR v.id NOT IN (
          SELECT video_id FROM watch_history 
          WHERE user_id = p_user_id
          ORDER BY updated_at DESC
          LIMIT p_history_limit
        )
      )
    ORDER BY random()
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
        OR v.id NOT IN (
          SELECT video_id FROM watch_history 
          WHERE user_id = p_user_id
          ORDER BY updated_at DESC
          LIMIT p_history_limit
        )
      )
    ORDER BY random()
    LIMIT (v_normal_count + GREATEST(0, v_recommend_count - v_rec_fetched));
    
  ELSIF p_type = 'adult' THEN
    -- 成人内容流：只返回成人内容（排除已观看）
    RETURN QUERY
    SELECT v.* FROM videos v
    WHERE v.status = 'published'
      AND v.is_adult = true
      AND (
        p_user_id IS NULL
        OR v.id NOT IN (
          SELECT video_id FROM watch_history 
          WHERE user_id = p_user_id
          ORDER BY updated_at DESC
          LIMIT p_history_limit
        )
      )
    ORDER BY random()
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
        OR v.id NOT IN (
          SELECT video_id FROM watch_history 
          WHERE user_id = p_user_id
          ORDER BY updated_at DESC
          LIMIT p_history_limit
        )
      )
    ORDER BY random()
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
        OR v.id NOT IN (
          SELECT video_id FROM watch_history 
          WHERE user_id = p_user_id
          ORDER BY updated_at DESC
          LIMIT p_history_limit
        )
      )
    ORDER BY random()
    LIMIT p_limit;
  END IF;
  
  RETURN;
END;
$$;

-- 🔐 授予权限
GRANT EXECUTE ON FUNCTION public.get_optimized_video_feed(UUID, TEXT, INT, INT) TO anon;
GRANT EXECUTE ON FUNCTION public.get_optimized_video_feed(UUID, TEXT, INT, INT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_optimized_video_feed(UUID, TEXT, INT, INT) TO service_role;

-- 📝 添加函数注释
COMMENT ON FUNCTION public.get_optimized_video_feed IS '优化的视频推荐流，支持排除观看历史和多种内容类型';

