-- 创建 record_video_view_v2 函数
-- 功能：
-- 1. 自动处理并发冲突 (FOR UPDATE 锁定)
-- 2. 自动增加视频 view_count (首次观看时)
-- 3. 自动更新 watch_history (使用 ON CONFLICT 处理唯一约束)
-- 4. 自动触发任务进度 increment_task_progress (完播时)

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
BEGIN
    -- 1. 使用 INSERT ... ON CONFLICT 插入或更新 watch_history
    -- 通过尝试插入来判断是否是首次观看
    -- 如果插入成功（没有冲突），则是首次观看
    -- 如果冲突（已存在），则更新现有记录
    
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

    -- 4. 如果完播，触发任务进度更新
    IF p_completed THEN
        SELECT public.increment_task_progress(p_user_id, 'total_views_reward', 1) INTO v_task_result;
    ELSE
        v_task_result := NULL;
    END IF;

    -- 5. 返回结果
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

-- 授予执行权限
GRANT EXECUTE ON FUNCTION public.record_video_view_v2(UUID, UUID, INT, BOOLEAN) TO anon;
GRANT EXECUTE ON FUNCTION public.record_video_view_v2(UUID, UUID, INT, BOOLEAN) TO authenticated;
GRANT EXECUTE ON FUNCTION public.record_video_view_v2(UUID, UUID, INT, BOOLEAN) TO service_role;

