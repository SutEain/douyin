-- 🎯 修复 cancel_pc28_bet 函数的 FOR UPDATE 错误
-- 问题：在 LEFT JOIN 的可空端使用 FOR UPDATE 导致错误
-- 解决方案：先查询 bet 记录，再单独查询 round 信息

CREATE OR REPLACE FUNCTION public.cancel_pc28_bet(
    p_bet_id UUID
) RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_bet RECORD;
    v_round RECORD;
    v_period_number TEXT;
    v_user_balance NUMERIC;
    v_final_balance NUMERIC;
BEGIN
    -- 🎯 1. 先获取下注记录（不使用 JOIN，避免 FOR UPDATE 问题）
    SELECT * INTO v_bet
    FROM public.pc28_bets
    WHERE id = p_bet_id AND user_id = auth.uid();
    
    IF v_bet IS NULL THEN
        RETURN json_build_object('success', false, 'message', '下注记录不存在');
    END IF;
    
    -- 🎯 2. 检查状态
    IF v_bet.status != 'pending' THEN
        RETURN json_build_object('success', false, 'message', '该下注已结算，无法取消');
    END IF;
    
    -- 🎯 3. 检查期数状态（优先使用全局期数）
    IF v_bet.global_round_id IS NOT NULL THEN
        -- 使用全局期数表
        SELECT * INTO v_round
        FROM public.pc28_global_rounds
        WHERE id = v_bet.global_round_id
        FOR UPDATE;
        
        IF v_round IS NULL THEN
            RETURN json_build_object('success', false, 'message', '期数不存在');
        END IF;
        
        v_period_number := v_round.period_number;
        
        IF v_round.status != 'betting' THEN
            RETURN json_build_object('success', false, 'message', '该期已封盘或已结算，无法取消下注');
        END IF;
    ELSIF v_bet.round_id IS NOT NULL THEN
        -- 兼容旧系统：使用房间期数表
        SELECT * INTO v_round
        FROM public.pc28_game_rounds
        WHERE id = v_bet.round_id
        FOR UPDATE;
        
        IF v_round IS NULL THEN
            RETURN json_build_object('success', false, 'message', '期数不存在');
        END IF;
        
        v_period_number := v_round.period_number;
        
        IF v_round.status != 'betting' THEN
            RETURN json_build_object('success', false, 'message', '该期已封盘或已结算，无法取消下注');
        END IF;
    ELSE
        RETURN json_build_object('success', false, 'message', '下注记录缺少期数信息');
    END IF;
    
    -- 🎯 4. 退还用户余额
    SELECT balance_coins INTO v_user_balance
    FROM public.profiles
    WHERE id = auth.uid()
    FOR UPDATE;
    
    UPDATE public.profiles
    SET balance_coins = balance_coins + v_bet.amount
    WHERE id = auth.uid()
    RETURNING balance_coins INTO v_final_balance;
    
    IF v_final_balance IS NULL THEN
        RETURN json_build_object('success', false, 'message', '无法更新用户余额');
    END IF;
    
    -- 🎯 5. 记录退款流水
    INSERT INTO public.coin_transactions (
        user_id, amount, balance_after, type, description, related_id
    ) VALUES (
        auth.uid(),
        v_bet.amount,
        v_final_balance,
        'pc28_refund',
        format('PC28游戏取消下注退款：%s期', v_period_number),
        p_bet_id
    );
    
    -- 🎯 6. 更新下注记录状态为 cancelled（不再删除记录，保留历史）
    UPDATE public.pc28_bets SET
        status = 'cancelled',
        refund_amount = v_bet.amount,
        cancelled_at = now()
    WHERE id = p_bet_id;
    
    -- 🎯 7. 推送消息到直播间
    INSERT INTO public.live_broadcast_messages (
        room_id, user_id, content, msg_type
    ) VALUES (
        v_bet.room_id,
        auth.uid(),
        json_build_object('text', format('取消下注 %s期', v_period_number))::text,
        'pc28'
    );
    
    RETURN json_build_object('success', true, 'message', '取消下注成功');
END;
$$;

COMMENT ON FUNCTION public.cancel_pc28_bet IS '取消PC28下注：支持全局期数系统，兼容旧系统。修复了 FOR UPDATE 在 LEFT JOIN 中的错误。';

-- 授权
GRANT EXECUTE ON FUNCTION public.cancel_pc28_bet(UUID) TO authenticated;
