-- 🎯 初始化观看时长任务配置
-- 确保任务配置表中的观看时长任务配置存在，且奖励金额与领取逻辑一致

-- 1. 删除可能存在的旧配置（如果存在）
DELETE FROM public.incentive_rules 
WHERE rule_type = 'watch_time' 
  AND code IN ('watch_time_5min', 'watch_time_15min', 'watch_time_30min');

-- 2. 插入观看时长任务配置（5分钟、15分钟、30分钟）
INSERT INTO public.incentive_rules (
    code, 
    name, 
    description, 
    rule_type, 
    scope, 
    metric, 
    threshold, 
    reward_usdt, 
    is_active, 
    sort_order
) VALUES
    (
        'watch_time_5min',
        '观看5分钟',
        '累计观看 5 分钟即可获得 5 抖币',
        'watch_time',
        'user',
        'watch_seconds',
        300, -- 5分钟 = 300秒
        5.00,
        TRUE,
        1
    ),
    (
        'watch_time_15min',
        '观看15分钟',
        '累计观看 15 分钟即可获得 10 抖币',
        'watch_time',
        'user',
        'watch_seconds',
        900, -- 15分钟 = 900秒
        10.00,
        TRUE,
        2
    ),
    (
        'watch_time_30min',
        '观看30分钟',
        '累计观看 30 分钟即可获得 15 抖币',
        'watch_time',
        'user',
        'watch_seconds',
        1800, -- 30分钟 = 1800秒
        15.00,
        TRUE,
        3
    )
ON CONFLICT (code) DO UPDATE
SET
    name = EXCLUDED.name,
    description = EXCLUDED.description,
    threshold = EXCLUDED.threshold,
    reward_usdt = EXCLUDED.reward_usdt,
    is_active = EXCLUDED.is_active,
    sort_order = EXCLUDED.sort_order,
    updated_at = NOW();

COMMENT ON TABLE public.incentive_rules IS '🎯 任务配置表：观看时长任务从该表读取配置，支持后台动态调整奖励金额和阈值';
