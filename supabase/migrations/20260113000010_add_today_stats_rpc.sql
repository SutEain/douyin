-- 🎯 创建统计今日系统发放抖币奖励的 RPC 函数
-- 使用 SECURITY DEFINER 绕过 RLS 限制，直接使用 SQL SUM 聚合函数

CREATE OR REPLACE FUNCTION public.get_today_system_rewards(p_start_iso TIMESTAMPTZ, p_end_iso TIMESTAMPTZ)
RETURNS DECIMAL(12, 2)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_total DECIMAL(12, 2);
BEGIN
    -- 统计今日系统发放的抖币奖励：
    -- 包括：reward, task_reward, watch_time_reward, author_views_reward
    -- 只统计正数金额（正向奖励）
    SELECT COALESCE(SUM(amount), 0) INTO v_total
    FROM public.coin_transactions
    WHERE created_at >= p_start_iso
      AND created_at < p_end_iso
      AND type IN ('reward', 'task_reward', 'watch_time_reward', 'author_views_reward')
      AND amount > 0;
    
    RETURN v_total;
END;
$$;

-- 🎯 创建统计今日打赏/直播礼物抽水的 RPC 函数
CREATE OR REPLACE FUNCTION public.get_today_gift_commission(p_start_iso TIMESTAMPTZ, p_end_iso TIMESTAMPTZ)
RETURNS DECIMAL(12, 2)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_gift_out_total DECIMAL(12, 2);
    v_gift_in_total DECIMAL(12, 2);
BEGIN
    -- 统计打赏/直播礼物抽水：gift_out总额 - gift_in总额（差额就是平台抽水）
    SELECT 
        COALESCE(SUM(CASE WHEN type = 'gift_out' THEN ABS(amount) ELSE 0 END), 0),
        COALESCE(SUM(CASE WHEN type = 'gift_in' THEN amount ELSE 0 END), 0)
    INTO v_gift_out_total, v_gift_in_total
    FROM public.coin_transactions
    WHERE created_at >= p_start_iso
      AND created_at < p_end_iso
      AND type IN ('gift_out', 'gift_in');
    
    -- 抽水 = 打赏总额 - 用户收到的（差额就是平台抽水）
    RETURN v_gift_out_total - v_gift_in_total;
END;
$$;

-- 授权给已登录用户调用
GRANT EXECUTE ON FUNCTION public.get_today_system_rewards(TIMESTAMPTZ, TIMESTAMPTZ) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_today_system_rewards(TIMESTAMPTZ, TIMESTAMPTZ) TO service_role;

GRANT EXECUTE ON FUNCTION public.get_today_gift_commission(TIMESTAMPTZ, TIMESTAMPTZ) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_today_gift_commission(TIMESTAMPTZ, TIMESTAMPTZ) TO service_role;

COMMENT ON FUNCTION public.get_today_system_rewards(TIMESTAMPTZ, TIMESTAMPTZ) IS 
    '统计今日系统发放的抖币奖励（北京时间）。统计type为reward/task_reward/watch_time_reward/author_views_reward且amount>0的交易记录总和。使用 SECURITY DEFINER 绕过 RLS 限制。';

COMMENT ON FUNCTION public.get_today_gift_commission(TIMESTAMPTZ, TIMESTAMPTZ) IS 
    '统计今日打赏/直播礼物抽水（北京时间）。计算gift_out总额与gift_in总额的差额（平台抽水）。使用 SECURITY DEFINER 绕过 RLS 限制。';

