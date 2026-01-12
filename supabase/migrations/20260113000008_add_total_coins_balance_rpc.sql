-- 🎯 创建统计平台抖币总余额的 RPC 函数
-- 使用 SECURITY DEFINER 绕过 RLS 限制，直接使用 SQL SUM 聚合函数

CREATE OR REPLACE FUNCTION public.get_total_coins_balance()
RETURNS DECIMAL(12, 2)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_total DECIMAL(12, 2);
BEGIN
    -- 直接使用 SQL SUM 聚合函数，不受 RLS 限制
    SELECT COALESCE(SUM(balance_coins), 0) INTO v_total
    FROM public.profiles
    WHERE deleted_at IS NULL;
    
    RETURN v_total;
END;
$$;

-- 授权给已登录用户调用（内部有 SECURITY DEFINER 且逻辑简单）
GRANT EXECUTE ON FUNCTION public.get_total_coins_balance() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_total_coins_balance() TO service_role;

COMMENT ON FUNCTION public.get_total_coins_balance() IS 
    '统计平台抖币总余额（所有用户剩余抖币之和）。使用 SECURITY DEFINER 绕过 RLS 限制。';

