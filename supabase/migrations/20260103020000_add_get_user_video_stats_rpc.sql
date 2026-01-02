-- 🎬 创建函数：获取用户视频统计数据 (播放、点赞、评论总和)
CREATE OR REPLACE FUNCTION public.get_user_video_stats(p_user_id BIGINT)
RETURNS TABLE(total_views BIGINT, total_likes BIGINT, total_comments BIGINT)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    RETURN QUERY
    SELECT 
        COALESCE(SUM(view_count), 0)::BIGINT,
        COALESCE(SUM(like_count), 0)::BIGINT,
        COALESCE(SUM(comment_count), 0)::BIGINT
    FROM public.videos
    WHERE tg_user_id = p_user_id AND status = 'published';
END;
$$;
