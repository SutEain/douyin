-- 修复 get_room_pc28_status 函数：如果没有进行中的期数，返回最近一个已结算的期数
-- 这样挂件可以正确显示期数，即使当前没有进行中的期数

CREATE OR REPLACE FUNCTION public.get_room_pc28_status(
    p_room_id UUID
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_enabled RECORD;
    v_current_round RECORD;
    v_settled_round RECORD;
    v_result JSONB;
BEGIN
    -- 1. 获取房间开关状态
    SELECT * INTO v_enabled
    FROM public.pc28_room_enabled
    WHERE room_id = p_room_id;
    
    -- 2. 优先获取当前进行中的全局期数（betting 或 sealed），按期号降序排列
    SELECT * INTO v_current_round
    FROM public.pc28_global_rounds
    WHERE status IN ('betting', 'sealed')
    ORDER BY period_number::bigint DESC
    LIMIT 1;
    
    -- 3. 如果没有进行中的期数，获取最近一个已结算的期数，按期号降序排列
    IF v_current_round.id IS NULL THEN
        SELECT * INTO v_settled_round
        FROM public.pc28_global_rounds
        WHERE status = 'settled'
        ORDER BY period_number::bigint DESC
        LIMIT 1;
        
        -- 使用已结算的期数作为当前期数
        v_current_round := v_settled_round;
    END IF;
    
    -- 4. 构建返回结果
    v_result := json_build_object(
        'enabled', COALESCE(v_enabled.enabled, false),
        'current_round', CASE 
            WHEN v_current_round.id IS NOT NULL THEN
                json_build_object(
                    'id', v_current_round.id,
                    'period_number', v_current_round.period_number,
                    'status', v_current_round.status,
                    'seal_at', v_current_round.seal_at,
                    'result', v_current_round.result,
                    'settled_at', v_current_round.settled_at,
                    'created_at', v_current_round.created_at,
                    'total_bet_amount', v_current_round.total_bet_amount,
                    'total_payout', v_current_round.total_payout,
                    'total_platform_fee', v_current_round.total_platform_fee,
                    'updated_at', v_current_round.updated_at
                )
            ELSE NULL
        END
    );
    
    RETURN json_build_object('success', true, 'data', v_result);
END;
$$;

COMMENT ON FUNCTION public.get_room_pc28_status IS '获取房间PC28状态和当前全局期数（优先返回进行中的期数，否则返回最近一个已结算的期数）';
