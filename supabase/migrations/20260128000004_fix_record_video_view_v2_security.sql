-- 🚨 紧急修复：record_video_view_v2 函数安全漏洞
-- 问题：函数没有验证用户身份，用户可以刷播放量
-- 修复：
-- 1. 添加用户身份验证（p_user_id 必须是当前登录用户）
-- 2. 添加频率限制（防止频繁调用刷播放量）
-- 3. 添加IP限制（通过Edge Function层实现）

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
BEGIN
    -- 🚨 安全验证 1: 只能为自己操作
    IF p_user_id != auth.uid() THEN
        RAISE WARNING '[SECURITY] User % attempted to record view for user %', auth.uid(), p_user_id;
        RETURN jsonb_build_object('success', false, 'error', '非法操作：只能记录自己的观看记录');
    END IF;

    -- 🚨 安全验证 2: 验证视频是否存在
    SELECT EXISTS(SELECT 1 FROM public.videos WHERE id = p_video_id AND deleted_at IS NULL) INTO v_video_exists;
    IF NOT v_video_exists THEN
        RETURN jsonb_build_object('success', false, 'error', '视频不存在或已删除');
    END IF;

    -- 🚨 安全验证 3: 频率限制（防止频繁调用刷播放量）
    -- 检查最近一次调用时间（同一用户对同一视频）
    SELECT MAX(updated_at) INTO v_last_call_time
    FROM public.watch_history
    WHERE user_id = p_user_id AND video_id = p_video_id;
    
    IF v_last_call_time IS NOT NULL THEN
        v_time_since_last_call := NOW() - v_last_call_time;
        -- 同一视频，5秒内只能调用一次
        IF v_time_since_last_call < INTERVAL '5 seconds' THEN
            RETURN jsonb_build_object('success', false, 'error', '请求过于频繁，请稍后再试');
        END IF;
    END IF;

    -- 🚨 安全验证 4: 限制progress范围（0-100）
    IF p_progress < 0 OR p_progress > 100 THEN
        RETURN jsonb_build_object('success', false, 'error', '无效的进度值：必须在0-100之间');
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

COMMENT ON FUNCTION public.record_video_view_v2 IS '🚨 修复安全漏洞：添加用户身份验证、频率限制、进度值验证，防止刷播放量';
