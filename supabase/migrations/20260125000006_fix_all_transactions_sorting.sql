-- 修复所有资金流水查询的排序问题
-- 确保所有查询都使用 created_at DESC, id DESC 排序

-- 1. 创建通用的资金流水查询函数（所有类型）
CREATE OR REPLACE FUNCTION public.get_user_transactions(
    p_user_id UUID,
    p_limit INT DEFAULT 50,
    p_types TEXT[] DEFAULT NULL -- NULL表示查询所有类型
) RETURNS TABLE (
    id UUID,
    amount NUMERIC,
    balance_after NUMERIC,
    type TEXT,
    description TEXT,
    created_at TIMESTAMPTZ,
    related_id UUID,
    counterparty_id UUID
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    RETURN QUERY
    SELECT 
        t.id,
        t.amount,
        t.balance_after,
        t.type,
        t.description,
        t.created_at,
        t.related_id,
        t.counterparty_id
    FROM public.coin_transactions t
    WHERE t.user_id = p_user_id
      AND (p_types IS NULL OR t.type = ANY(p_types))
    ORDER BY t.created_at DESC, t.id DESC
    LIMIT p_limit;
END;
$$;

-- 2. 授权
GRANT EXECUTE ON FUNCTION public.get_user_transactions(UUID, INT, TEXT[]) TO authenticated;

-- 3. 添加注释
COMMENT ON FUNCTION public.get_user_transactions(UUID, INT, TEXT[]) IS 
'获取用户资金流水记录，按created_at DESC, id DESC排序，确保相同时间戳的记录顺序稳定。p_types为NULL时查询所有类型';
