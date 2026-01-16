-- 🚨 优化观看时长上报接口：添加安全验证
-- 1. 每次只能接受小于等于20秒的数值
-- 2. 距离上次上报还要相隔大于20秒

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
    -- 🎯 关键修复：统一使用北京时间
    v_today DATE := (NOW() AT TIME ZONE 'Asia/Shanghai')::DATE;
    v_new_total_seconds INT;
    v_last_updated_at TIMESTAMPTZ;
    v_time_since_last_update INTERVAL;
BEGIN
    -- 🚨 安全验证 1: 每次只能接受小于等于20秒的数值
    IF p_seconds <= 0 OR p_seconds > 20 THEN
        RETURN jsonb_build_object('success', false);
    END IF;

    -- 🚨 安全验证 2: 检查距离上次上报是否相隔大于20秒
    SELECT last_updated_at INTO v_last_updated_at
    FROM public.user_daily_watch_time
    WHERE user_id = p_user_id
      AND watch_date = v_today
    ORDER BY last_updated_at DESC
    LIMIT 1;
    
    IF v_last_updated_at IS NOT NULL THEN
        v_time_since_last_update := NOW() - v_last_updated_at;
        -- 距离上次上报必须相隔大于20秒
        IF v_time_since_last_update < INTERVAL '20 seconds' THEN
            RETURN jsonb_build_object('success', false);
        END IF;
    END IF;

    -- 🎯 如果提供了 video_id，且视频确实存在，才记录到 user_video_watch_time 表
    IF p_video_id IS NOT NULL AND EXISTS (SELECT 1 FROM public.videos WHERE id = p_video_id) THEN
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
            total_seconds = COALESCE(user_video_watch_time.total_seconds, 0) + p_seconds,
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
        total_seconds = COALESCE(user_daily_watch_time.total_seconds, 0) + p_seconds,
        last_updated_at = NOW()
    RETURNING total_seconds INTO v_new_total_seconds;

    RETURN jsonb_build_object(
        'success', true,
        'total_seconds', v_new_total_seconds,
        'watch_date', v_today
    );
END;
$$;

COMMENT ON FUNCTION public.increment_daily_watch_time IS '🚨 优化观看时长上报接口：每次最多20秒，距离上次上报必须相隔大于20秒';
