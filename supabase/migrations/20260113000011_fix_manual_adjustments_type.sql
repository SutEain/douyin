-- 🎯 修复统计今日手动调整抖币的 RPC 函数
-- 问题：admin_adjust_balance 函数使用的 type 是 'adjustment'，而不是 'recharge'
-- 需要同时支持两种类型：
--   1. 'adjustment' - admin_adjust_balance 函数使用的类型
--   2. 'recharge' 且 description 包含 '[后台调整]' - 其他手动充值调整

CREATE OR REPLACE FUNCTION public.get_today_manual_adjustments(p_start_iso TIMESTAMPTZ, p_end_iso TIMESTAMPTZ)
RETURNS DECIMAL(12, 2)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_total DECIMAL(12, 2);
BEGIN
    -- 统计今日手动调整的抖币：
    -- 1. type='adjustment' - admin_adjust_balance 函数使用的类型
    -- 2. type='recharge' 且 description 包含 '[后台调整]' - 其他手动充值调整
    -- 手动调整可能是正数（增加）或负数（减少），统计所有调整的绝对值总和
    SELECT COALESCE(SUM(ABS(amount)), 0) INTO v_total
    FROM public.coin_transactions
    WHERE created_at >= p_start_iso
      AND created_at < p_end_iso
      AND (
        type = 'adjustment' 
        OR (type = 'recharge' AND description ILIKE '%[后台调整]%')
      );
    
    RETURN v_total;
END;
$$;

COMMENT ON FUNCTION public.get_today_manual_adjustments(TIMESTAMPTZ, TIMESTAMPTZ) IS 
    '统计今日手动调整的抖币（北京时间）。统计type=adjustment或type=recharge且description包含[后台调整]的交易记录的绝对值总和。使用 SECURITY DEFINER 绕过 RLS 限制。';

