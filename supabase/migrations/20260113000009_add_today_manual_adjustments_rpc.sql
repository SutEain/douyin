-- 🎯 创建统计今日手动调整抖币的 RPC 函数
-- 使用 SECURITY DEFINER 绕过 RLS 限制，直接使用 SQL SUM 聚合函数

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
    -- type='recharge' 且 description 包含 '[后台调整]'
    -- 手动调整可能是正数（增加）或负数（减少），统计所有调整的绝对值总和
    SELECT COALESCE(SUM(ABS(amount)), 0) INTO v_total
    FROM public.coin_transactions
    WHERE created_at >= p_start_iso
      AND created_at < p_end_iso
      AND type = 'recharge'
      AND description ILIKE '%[后台调整]%';
    
    RETURN v_total;
END;
$$;

-- 授权给已登录用户调用（内部有 SECURITY DEFINER 且逻辑简单）
GRANT EXECUTE ON FUNCTION public.get_today_manual_adjustments(TIMESTAMPTZ, TIMESTAMPTZ) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_today_manual_adjustments(TIMESTAMPTZ, TIMESTAMPTZ) TO service_role;

COMMENT ON FUNCTION public.get_today_manual_adjustments(TIMESTAMPTZ, TIMESTAMPTZ) IS 
    '统计今日手动调整的抖币（北京时间）。统计type=recharge且description包含[后台调整]的交易记录的绝对值总和。使用 SECURITY DEFINER 绕过 RLS 限制。';

