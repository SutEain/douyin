-- 🚨 紧急修复：cancel_pc28_bet 函数重复退款漏洞
-- 问题：并发请求可以导致同一个 bet_id 被退款多次
-- 原因：
--   1. 获取下注记录时没有使用 FOR UPDATE 锁定
--   2. 状态更新时没有使用 WHERE status = 'pending' 条件
--   3. 多个请求可以同时通过状态检查并执行退款
--
-- 修复方案：
--   1. 使用 FOR UPDATE 锁定下注记录
--   2. 使用原子更新操作：UPDATE ... WHERE status = 'pending'
--   3. 检查更新影响的行数，如果为0说明已被其他请求处理

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
    v_user_balance NUMERIC;
    v_final_balance NUMERIC;
    v_update_count INTEGER;
BEGIN
    -- 🎯 1. 获取并锁定下注记录（使用 FOR UPDATE 防止并发）
    SELECT b.*, COALESCE(gr.period_number, r.period_number) as period_number INTO v_bet
    FROM public.pc28_bets b
    LEFT JOIN public.pc28_global_rounds gr ON b.global_round_id = gr.id
    LEFT JOIN public.pc28_game_rounds r ON b.round_id = r.id
    WHERE b.id = p_bet_id AND b.user_id = auth.uid()
    FOR UPDATE; -- 🔒 锁定记录，防止并发
    
    IF v_bet IS NULL THEN
        RETURN json_build_object('success', false, 'message', '下注记录不存在');
    END IF;
    
    -- 🎯 2. 检查状态（在锁定后检查）
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
        
        IF v_round.status != 'betting' THEN
            RETURN json_build_object('success', false, 'message', '该期已封盘或已结算，无法取消下注');
        END IF;
    ELSE
        RETURN json_build_object('success', false, 'message', '下注记录缺少期数信息');
    END IF;
    
    -- 🎯 4. 原子更新：使用 WHERE status = 'pending' 确保只处理一次
    -- 这是关键修复：即使多个请求同时到达，只有一个能成功更新
    UPDATE public.pc28_bets SET
        status = 'cancelled',
        refund_amount = amount,
        cancelled_at = now()
    WHERE id = p_bet_id 
      AND status = 'pending' -- 🔒 关键：只有 pending 状态才能更新
      AND user_id = auth.uid();
    
    -- 🎯 5. 检查更新是否成功（防止重复退款）
    GET DIAGNOSTICS v_update_count = ROW_COUNT;
    
    IF v_update_count = 0 THEN
        -- 更新失败，说明已经被其他请求处理过了
        RETURN json_build_object('success', false, 'message', '该下注已被取消或已结算');
    END IF;
    
    -- 🎯 6. 重新获取更新后的记录（确保使用最新的金额）
    SELECT amount INTO v_bet.amount
    FROM public.pc28_bets
    WHERE id = p_bet_id;
    
    -- 🎯 7. 退还用户余额
    SELECT balance_coins INTO v_user_balance
    FROM public.profiles
    WHERE id = auth.uid()
    FOR UPDATE;
    
    UPDATE public.profiles
    SET balance_coins = balance_coins + v_bet.amount
    WHERE id = auth.uid()
    RETURNING balance_coins INTO v_final_balance;
    
    IF v_final_balance IS NULL THEN
        -- 如果余额更新失败，回滚下注状态
        UPDATE public.pc28_bets SET
            status = 'pending',
            refund_amount = NULL,
            cancelled_at = NULL
        WHERE id = p_bet_id;
        RETURN json_build_object('success', false, 'message', '无法更新用户余额');
    END IF;
    
    -- 🎯 8. 记录退款流水
    INSERT INTO public.coin_transactions (
        user_id, amount, balance_after, type, description, related_id
    ) VALUES (
        auth.uid(),
        v_bet.amount,
        v_final_balance,
        'pc28_refund',
        format('PC28游戏取消下注退款：%s期', v_bet.period_number),
        p_bet_id
    );
    
    -- 🎯 9. 推送消息到直播间
    INSERT INTO public.live_broadcast_messages (
        room_id, user_id, content, msg_type
    ) VALUES (
        v_bet.room_id,
        auth.uid(),
        json_build_object('text', format('取消下注 %s期', v_bet.period_number))::text,
        'pc28'
    );
    
    RETURN json_build_object('success', true, 'message', '取消下注成功');
END;
$$;

COMMENT ON FUNCTION public.cancel_pc28_bet IS '取消PC28下注：支持全局期数系统，兼容旧系统。已修复并发重复退款漏洞，使用 FOR UPDATE 和原子更新确保只处理一次。';

-- 授权
GRANT EXECUTE ON FUNCTION public.cancel_pc28_bet(UUID) TO authenticated;
