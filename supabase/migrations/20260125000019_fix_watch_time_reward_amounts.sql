-- 🎯 修复观看时长奖励金额：确保与任务设定一致
-- 问题：任务设定每天总共可以领30（里程碑 5、10、15），但实际领取的是 5、15、30
-- 修复：强制更新任务配置表中的奖励金额为正确的值

-- 更新观看时长任务配置的奖励金额
UPDATE public.incentive_rules
SET 
    reward_usdt = CASE 
        WHEN code = 'watch_time_5min' THEN 5.00
        WHEN code = 'watch_time_15min' THEN 10.00
        WHEN code = 'watch_time_30min' THEN 15.00
        ELSE reward_usdt
    END,
    description = CASE 
        WHEN code = 'watch_time_5min' THEN '累计观看 5 分钟即可获得 5 抖币'
        WHEN code = 'watch_time_15min' THEN '累计观看 15 分钟即可获得 10 抖币'
        WHEN code = 'watch_time_30min' THEN '累计观看 30 分钟即可获得 15 抖币'
        ELSE description
    END,
    updated_at = NOW()
WHERE rule_type = 'watch_time'
  AND code IN ('watch_time_5min', 'watch_time_15min', 'watch_time_30min');

-- 验证更新结果
DO $$
DECLARE
    v_5min NUMERIC;
    v_15min NUMERIC;
    v_30min NUMERIC;
    v_total NUMERIC;
BEGIN
    -- 检查更新后的奖励金额
    SELECT reward_usdt INTO v_5min FROM public.incentive_rules WHERE code = 'watch_time_5min';
    SELECT reward_usdt INTO v_15min FROM public.incentive_rules WHERE code = 'watch_time_15min';
    SELECT reward_usdt INTO v_30min FROM public.incentive_rules WHERE code = 'watch_time_30min';
    
    v_total := COALESCE(v_5min, 0) + COALESCE(v_15min, 0) + COALESCE(v_30min, 0);
    
    -- 如果总和不等于30，抛出错误
    IF v_total != 30.00 THEN
        RAISE EXCEPTION '观看时长奖励金额配置错误：5分钟=%, 15分钟=%, 30分钟=%, 总计=% (应为30)', 
            v_5min, v_15min, v_30min, v_total;
    END IF;
    
    RAISE NOTICE '观看时长奖励金额已修复：5分钟=%, 15分钟=%, 30分钟=%, 总计=%', 
        v_5min, v_15min, v_30min, v_total;
END $$;

COMMENT ON TABLE public.incentive_rules IS '🎯 任务配置表：观看时长任务配置已修复为 5、10、15（总计30抖币）';
