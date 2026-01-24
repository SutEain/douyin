-- 修复资金流水排序问题：确保相同时间戳的记录按id排序
-- 创建索引以优化排序性能

-- 1. 创建复合索引，优化按created_at和id排序的查询
CREATE INDEX IF NOT EXISTS idx_coin_transactions_created_at_id 
ON public.coin_transactions (created_at DESC, id DESC);

-- 2. 创建函数，返回正确排序的PC28交易记录
CREATE OR REPLACE FUNCTION public.get_pc28_transactions(
    p_user_id UUID,
    p_limit INT DEFAULT 50
) RETURNS TABLE (
    id UUID,
    amount NUMERIC,
    balance_after NUMERIC,
    type TEXT,
    description TEXT,
    created_at TIMESTAMPTZ,
    related_id UUID
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
        t.related_id
    FROM public.coin_transactions t
    WHERE t.user_id = p_user_id
      AND t.type IN ('pc28_bet', 'pc28_win', 'pc28_refund', 'pc28_bet_income', 'pc28_payout')
    ORDER BY t.created_at DESC, t.id DESC
    LIMIT p_limit;
END;
$$;

-- 3. 授权
GRANT EXECUTE ON FUNCTION public.get_pc28_transactions(UUID, INT) TO authenticated;

-- 4. 添加注释
COMMENT ON FUNCTION public.get_pc28_transactions(UUID, INT) IS 
'获取PC28相关的资金流水记录，按created_at DESC, id DESC排序，确保相同时间戳的记录顺序稳定';
