-- 🎯 修复：移除 record_video_view_v2 函数中对 deleted_at 字段的引用
-- 问题：videos 表的 deleted_at 字段已被删除（改为真删除），但函数中仍在使用该字段
-- 修复：移除对 deleted_at 的检查，因为现在使用真删除（物理删除）

CREATE OR REPLACE FUNCTION public.record_video_view_v2(
    p_user_id UUID,
    p_video_id UUID,
    p_progress INT DEFAULT 0,
    p_completed BOOLEAN DEFAULT FALSE
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_is_first_view BOOLEAN := FALSE;
    v_task_result JSONB;
    v_last_call_time TIMESTAMPTZ;
    v_time_since_last_call INTERVAL;
    v_video_exists BOOLEAN;
    v_current_view_count INT;
    v_author_id UUID;
BEGIN
    -- 🚨 安全验证 1: 只能为自己操作
    IF p_user_id != auth.uid() THEN
        RAISE WARNING '[SECURITY] User % attempted to record view for user %', auth.uid(), p_user_id;
        RETURN jsonb_build_object('success', false, 'error', '非法操作：只能记录自己的观看记录');
    END IF;

    -- 🚨 安全验证 2: 验证视频是否存在（已移除 deleted_at 检查）
    SELECT EXISTS(SELECT 1 FROM public.videos WHERE id = p_video_id) INTO v_video_exists;
    IF NOT v_video_exists THEN
        RETURN jsonb_build_object('success', false, 'error', '视频不存在或已删除');
    END IF;

    -- 🚨 安全验证 3: 获取视频作者和当前播放量（用于异常检测）
    SELECT author_id, COALESCE(view_count, 0) INTO v_author_id, v_current_view_count
    FROM public.videos
    WHERE id = p_video_id;

    -- 🚨 安全验证 4: 更严格的频率限制（同一用户对同一视频，1分钟内只能调用1次）
    SELECT MAX(updated_at) INTO v_last_call_time
    FROM public.watch_history
    WHERE user_id = p_user_id AND video_id = p_video_id;
    
    IF v_last_call_time IS NOT NULL THEN
        v_time_since_last_call := NOW() - v_last_call_time;
        -- 同一视频，1分钟内只能调用一次（更严格）
        IF v_time_since_last_call < INTERVAL '1 minute' THEN
            RAISE WARNING '[SECURITY] User % attempted to record view too frequently for video %', p_user_id, p_video_id;
            RETURN jsonb_build_object('success', false, 'error', '请求过于频繁，请稍后再试');
        END IF;
    END IF;

    -- 🚨 安全验证 5: 限制progress范围（0-100）
    IF p_progress < 0 OR p_progress > 100 THEN
        RETURN jsonb_build_object('success', false, 'error', '无效的进度值：必须在0-100之间');
    END IF;

    -- 🚨 安全验证 6: 异常检测（如果视频播放量异常高，记录警告）
    IF v_current_view_count > 10000 THEN
        RAISE WARNING '[SECURITY] Video % has abnormally high view count: % (author: %)', p_video_id, v_current_view_count, v_author_id;
    END IF;

    -- 1. 使用 INSERT ... ON CONFLICT 插入或更新 watch_history
    -- 先检查是否存在（使用行锁避免并发问题）
    SELECT NOT EXISTS (
        SELECT 1 FROM public.watch_history 
        WHERE user_id = p_user_id AND video_id = p_video_id
        FOR UPDATE
    ) INTO v_is_first_view;

    -- 插入或更新 watch_history（使用 ON CONFLICT 处理唯一约束冲突）
    INSERT INTO public.watch_history (user_id, video_id, progress, completed, updated_at)
    VALUES (p_user_id, p_video_id, p_progress, p_completed, NOW())
    ON CONFLICT (user_id, video_id)
    DO UPDATE SET
        progress = GREATEST(watch_history.progress, EXCLUDED.progress),
        completed = watch_history.completed OR EXCLUDED.completed,
        updated_at = NOW();

    -- 2. 如果是首次观看，增加视频 view_count
    IF v_is_first_view THEN
        UPDATE public.videos
        SET view_count = view_count + 1
        WHERE id = p_video_id;
    END IF;

    -- 3. 如果完播，触发任务进度更新
    IF p_completed THEN
        SELECT public.increment_task_progress(p_user_id, 'total_views_reward', 1) INTO v_task_result;
    ELSE
        v_task_result := NULL;
    END IF;

    -- 4. 返回结果
    RETURN jsonb_build_object(
        'success', TRUE,
        'is_first_view', v_is_first_view,
        'progress', p_progress,
        'completed', p_completed,
        'task_result', v_task_result
    );
EXCEPTION
    WHEN OTHERS THEN
        -- 记录错误但不阻止操作
        RAISE WARNING 'record_video_view_v2 failed for user %, video %: %', p_user_id, p_video_id, SQLERRM;
        RETURN jsonb_build_object(
            'success', FALSE,
            'error', SQLERRM
        );
END;
$$;

COMMENT ON FUNCTION public.record_video_view_v2 IS '🚨 修复安全漏洞：移除anon权限、加强频率限制（1分钟1次）、添加异常检测，防止脚本刷播放量。已移除 deleted_at 字段引用。';
