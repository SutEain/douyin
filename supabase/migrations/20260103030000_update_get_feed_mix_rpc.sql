-- 🛠️ 优化推荐 Feed RPC 函数
-- 1. 增加 is_adult = false 和 is_sea = false 过滤
-- 2. 真正使用 p_history_limit 参数，仅排除最近 N 条观看历史，提高 Feed 丰度
-- 3. 优化随机逻辑，提高大表性能 (可选，目前 1000 行 random 还可以)

CREATE OR REPLACE FUNCTION public.get_feed_mix(
    p_user_id UUID, 
    p_recommend_count INTEGER DEFAULT 7, 
    p_normal_count INTEGER DEFAULT 3, 
    p_history_limit INTEGER DEFAULT 300
)
RETURNS SETOF videos
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_total_needed INT := p_recommend_count + p_normal_count;
    v_rec_count INT;
BEGIN
    -- 1. 获取推荐视频 (过滤成人和东南亚，排除最近历史)
    RETURN QUERY
    SELECT v.* FROM videos v
    WHERE v.status = 'published'
      AND v.is_adult = false
      AND v.is_sea = false
      AND v.is_recommended = true
      AND v.id NOT IN (
        SELECT video_id FROM watch_history 
        WHERE user_id = p_user_id
        ORDER BY updated_at DESC
        LIMIT p_history_limit
      )
    ORDER BY random()
    LIMIT p_recommend_count;

    GET DIAGNOSTICS v_rec_count = ROW_COUNT;

    -- 2. 获取普通视频 (补足剩余差额)
    RETURN QUERY
    SELECT v.* FROM videos v
    WHERE v.status = 'published'
      AND v.is_adult = false
      AND v.is_sea = false
      AND v.is_recommended = false
      AND v.id NOT IN (
        SELECT video_id FROM watch_history 
        WHERE user_id = p_user_id
        ORDER BY updated_at DESC
        LIMIT p_history_limit
      )
    ORDER BY random()
    LIMIT (v_total_needed - v_rec_count);

    RETURN;
END;
$$;
