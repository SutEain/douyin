-- 简化观看时长累计逻辑：去掉 video_id 去重，因为前端已经做了去重
-- 前端用 Set 记录已累计过的视频ID，防止重复播放累计

CREATE OR REPLACE FUNCTION public.increment_daily_watch_time(
    p_user_id UUID,
    p_seconds INTEGER DEFAULT 1,
    p_video_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_today DATE := CURRENT_DATE;
    v_new_total_seconds INT;
BEGIN
    -- 🎯 如果提供了 video_id，记录到 user_video_watch_time 表（用于统计，但不做去重）
    IF p_video_id IS NOT NULL THEN
        INSERT INTO public.user_video_watch_time (
            user_id, 
            video_id, 
            watch_date, 
            total_seconds, 
            last_updated_at
        )
        VALUES (p_user_id, p_video_id, v_today, p_seconds, NOW())
        ON CONFLICT (user_id, video_id, watch_date)
        DO UPDATE SET 
            total_seconds = user_video_watch_time.total_seconds + p_seconds,
            last_updated_at = NOW();
    END IF;

    -- 🎯 更新用户每日总观看时长
    INSERT INTO public.user_daily_watch_time (
        user_id, 
        watch_date, 
        total_seconds, 
        last_updated_at
    )
    VALUES (p_user_id, v_today, p_seconds, NOW())
    ON CONFLICT (user_id, watch_date)
    DO UPDATE SET 
        total_seconds = user_daily_watch_time.total_seconds + p_seconds,
        last_updated_at = NOW()
    RETURNING total_seconds INTO v_new_total_seconds;

    RETURN jsonb_build_object(
        'success', true,
        'total_seconds', v_new_total_seconds,
        'watch_date', v_today
    );
END;
$$;
