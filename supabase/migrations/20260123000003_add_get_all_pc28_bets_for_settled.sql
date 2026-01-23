-- 创建获取已结算期数所有下注记录的RPC函数（所有用户可访问）
CREATE OR REPLACE FUNCTION public.get_all_pc28_bets_for_settled(
    p_round_id UUID
) RETURNS TABLE (
    id UUID,
    round_id UUID,
    room_id UUID,
    user_id UUID,
    bet_type TEXT,
    bet_value INT,
    amount NUMERIC,
    odds NUMERIC,
    status TEXT,
    is_win BOOLEAN,
    payout NUMERIC,
    platform_fee NUMERIC,
    user_gain NUMERIC,
    anchor_payout NUMERIC,
    created_at TIMESTAMP WITH TIME ZONE,
    settled_at TIMESTAMP WITH TIME ZONE
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_round RECORD;
BEGIN
    -- 1. 验证期数存在且已结算
    SELECT r.* INTO v_round
    FROM public.pc28_game_rounds r
    WHERE r.id = p_round_id;
    
    IF v_round IS NULL THEN
        RAISE EXCEPTION '期数不存在';
    END IF;
    
    IF v_round.status != 'settled' THEN
        RAISE EXCEPTION '只有已结算的期数可以查看所有下注记录';
    END IF;
    
    -- 2. 返回所有下注记录（已结算状态下，所有用户都可以查看）
    RETURN QUERY
    SELECT 
        b.id,
        b.round_id,
        b.room_id,
        b.user_id,
        b.bet_type,
        b.bet_value,
        b.amount,
        b.odds,
        b.status,
        b.is_win,
        b.payout,
        b.platform_fee,
        b.user_gain,
        b.anchor_payout,
        b.created_at,
        b.settled_at
    FROM public.pc28_bets b
    WHERE b.round_id = p_round_id
    ORDER BY b.created_at DESC;
END;
$$;

-- 授权
GRANT EXECUTE ON FUNCTION public.get_all_pc28_bets_for_settled(UUID) TO authenticated;
