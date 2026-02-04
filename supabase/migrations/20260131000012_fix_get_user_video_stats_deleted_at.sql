-- 🎯 修复：移除 get_user_video_stats 函数中对 deleted_at 字段的引用
-- 问题：videos 表的 deleted_at 字段已被删除（改为真删除），但函数中仍在使用该字段
-- 修复：移除对 deleted_at 的检查，因为现在使用真删除（物理删除）

CREATE OR REPLACE FUNCTION public.get_user_video_stats(p_tg_user_id BIGINT)
RETURNS JSON 
LANGUAGE plpgsql 
SECURITY DEFINER 
AS $func$
BEGIN
    -- 🛑 核心校验：只能查看自己的统计，或者是管理员
    IF (SELECT id FROM public.profiles WHERE tg_user_id = p_tg_user_id) != auth.uid() AND NOT public.check_is_admin() THEN
        RETURN json_build_object('success', false, 'message', '权限不足');
    END IF;

    RETURN (
        SELECT json_build_object(
            'total_videos', count(*),
            'total_views', sum(view_count),
            'total_likes', sum(like_count),
            'total_comments', sum(comment_count)
        ) FROM public.videos WHERE tg_user_id = p_tg_user_id
    );
END; 
$func$;

COMMENT ON FUNCTION public.get_user_video_stats IS '获取用户视频统计（已移除 deleted_at 字段引用）';
