-- 🎯 简化观看时长追踪：使用 Realtime Presence 自动追踪
-- 直接利用现有的 user_daily_watch_time 表，无需创建新表

-- 🎯 创建函数：基于 Presence 事件更新观看时长
-- 当用户上线时，记录开始时间到 last_updated_at
-- 当用户下线时，计算时长差并累加到 total_seconds
CREATE OR REPLACE FUNCTION public.update_watch_time_from_presence(
    p_user_id UUID,
    p_event_type TEXT -- 'online' 或 'offline'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_today DATE := (NOW() AT TIME ZONE 'Asia/Shanghai')::DATE;
    v_last_updated_at TIMESTAMPTZ;
    v_duration_seconds INTEGER;
    v_new_total_seconds INTEGER;
BEGIN
    -- 获取或创建今日记录
    SELECT last_updated_at INTO v_last_updated_at
    FROM public.user_daily_watch_time
    WHERE user_id = p_user_id
      AND watch_date = v_today
    FOR UPDATE; -- 锁定记录，防止并发
    
    IF p_event_type = 'online' THEN
        -- 用户上线：更新 last_updated_at 为当前时间
        INSERT INTO public.user_daily_watch_time (
            user_id,
            watch_date,
            total_seconds,
            last_updated_at
        )
        VALUES (
            p_user_id,
            v_today,
            0,
            NOW()
        )
        ON CONFLICT (user_id, watch_date)
        DO UPDATE SET
            last_updated_at = NOW();
        
        RETURN jsonb_build_object(
            'success', true,
            'event', 'online',
            'timestamp', NOW()
        );
        
    ELSIF p_event_type = 'offline' THEN
        -- 用户下线：计算时长差并累加
        IF v_last_updated_at IS NULL THEN
            -- 没有上线记录，可能是异常情况，直接返回
            RETURN jsonb_build_object(
                'success', false,
                'message', 'No online record found'
            );
        END IF;
        
        -- 计算时长差（秒）
        v_duration_seconds := EXTRACT(EPOCH FROM (NOW() - v_last_updated_at))::INTEGER;
        
        -- 限制单次时长不超过1小时（防止异常情况）
        IF v_duration_seconds > 3600 THEN
            v_duration_seconds := 3600;
        END IF;
        
        -- 累加到总时长
        INSERT INTO public.user_daily_watch_time (
            user_id,
            watch_date,
            total_seconds,
            last_updated_at
        )
        VALUES (
            p_user_id,
            v_today,
            v_duration_seconds,
            NOW()
        )
        ON CONFLICT (user_id, watch_date)
        DO UPDATE SET
            total_seconds = COALESCE(user_daily_watch_time.total_seconds, 0) + v_duration_seconds,
            last_updated_at = NOW()
        RETURNING total_seconds INTO v_new_total_seconds;
        
        RETURN jsonb_build_object(
            'success', true,
            'event', 'offline',
            'duration_seconds', v_duration_seconds,
            'total_seconds', v_new_total_seconds,
            'timestamp', NOW()
        );
    ELSE
        RETURN jsonb_build_object(
            'success', false,
            'message', 'Invalid event_type'
        );
    END IF;
END;
$$;

COMMENT ON FUNCTION public.update_watch_time_from_presence IS '基于 Presence 事件更新观看时长：上线时记录时间，下线时计算时长并累加';

-- 🎯 创建函数：定期同步在线用户的观看时长（处理异常断开）
-- 每分钟调用一次，计算在线用户的时长并累加
CREATE OR REPLACE FUNCTION public.sync_online_watch_time()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_record RECORD;
    v_duration_seconds INTEGER;
    v_updated_count INTEGER := 0;
    v_today DATE := (NOW() AT TIME ZONE 'Asia/Shanghai')::DATE;
BEGIN
    -- 查找所有 last_updated_at 超过1分钟但小于1小时的记录（可能还在线）
    FOR v_record IN
        SELECT user_id, last_updated_at, total_seconds
        FROM public.user_daily_watch_time
        WHERE watch_date = v_today
          AND last_updated_at < NOW() - INTERVAL '1 minute'
          AND last_updated_at > NOW() - INTERVAL '1 hour'
        LIMIT 100 -- 每次最多处理100个
    LOOP
        -- 计算时长差（从上次更新到现在）
        v_duration_seconds := EXTRACT(EPOCH FROM (NOW() - v_record.last_updated_at))::INTEGER;
        
        -- 限制单次时长不超过5分钟（防止异常）
        IF v_duration_seconds > 300 THEN
            v_duration_seconds := 300;
        END IF;
        
        -- 累加时长并更新 last_updated_at
        UPDATE public.user_daily_watch_time
        SET 
            total_seconds = COALESCE(total_seconds, 0) + v_duration_seconds,
            last_updated_at = NOW()
        WHERE user_id = v_record.user_id
          AND watch_date = v_today;
        
        v_updated_count := v_updated_count + 1;
    END LOOP;
    
    RETURN v_updated_count;
END;
$$;

COMMENT ON FUNCTION public.sync_online_watch_time IS '定期同步在线用户的观看时长，处理异常断开的情况';

-- 授予 service_role 执行权限
GRANT EXECUTE ON FUNCTION public.update_watch_time_from_presence(UUID, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.sync_online_watch_time() TO service_role;
