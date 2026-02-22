-- 修复PC28期数排序问题
-- 问题：使用created_at或settled_at排序时，历史期数补结算会导致返回旧的期数
-- 解决：按期数数字排序（period_number::bigint），确保返回真正最新的期数

-- 1. 修复 get_current_global_round 函数：按期数数字排序
CREATE OR REPLACE FUNCTION public.get_current_global_round()
RETURNS TABLE (
    id UUID,
    period_number TEXT,
    status TEXT,
    seal_at TIMESTAMP WITH TIME ZONE,
    result JSONB,
    settled_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    RETURN QUERY
    SELECT 
        r.id,
        r.period_number,
        r.status,
        r.seal_at,
        r.result,
        r.settled_at,
        r.created_at
    FROM public.pc28_global_rounds r
    WHERE r.status IN ('betting', 'sealed')
    ORDER BY r.period_number::bigint DESC
    LIMIT 1;
END;
$$;

COMMENT ON FUNCTION public.get_current_global_round IS '获取当前全局期数（下注中或已封盘），按期数数字降序排序';
