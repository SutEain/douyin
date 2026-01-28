-- 🎯 修复PC28封盘后仍可下注的问题
-- 问题：下注函数没有检查seal_at时间，且没有使用FOR UPDATE锁定期数记录，导致竞态条件
-- 修复：1. 使用FOR UPDATE锁定期数记录 2. 检查seal_at时间 3. 在锁定后再次检查状态

-- ============================================================================
-- 1. 修复房间级别PC28下注函数
-- ============================================================================
CREATE OR REPLACE FUNCTION public.place_pc28_bet(
    p_round_id UUID,
    p_bet_type TEXT,
    p_amount NUMERIC,
    p_bet_value INT DEFAULT NULL
) RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_round RECORD;
    v_config RECORD;
    v_user_balance NUMERIC;
    v_odds NUMERIC;
    v_bet_id UUID;
    v_final_balance NUMERIC;
    v_user_nickname TEXT;
BEGIN
    -- 1. 🔒 锁定期数记录，确保原子性检查
    SELECT * INTO v_round
    FROM public.pc28_game_rounds
    WHERE id = p_round_id
    FOR UPDATE;
    
    IF v_round IS NULL THEN
        RETURN json_build_object('success', false, 'message', '期数不存在');
    END IF;
    
    -- 2. 检查状态（锁定后再次检查，确保状态未改变）
    IF v_round.status != 'betting' THEN
        RETURN json_build_object('success', false, 'message', '该期已封盘或已结算');
    END IF;
    
    -- 3. 🎯 检查封盘时间（关键修复：防止封盘后下注）
    IF v_round.seal_at IS NOT NULL AND now() >= v_round.seal_at THEN
        -- 如果已到封盘时间，自动更新状态为sealed
        UPDATE public.pc28_game_rounds 
        SET status = 'sealed' 
        WHERE id = p_round_id;
        RETURN json_build_object('success', false, 'message', '该期已封盘');
    END IF;
    
    -- 4. 验证下注金额
    IF p_amount IS NULL OR p_amount <= 0 OR p_amount > 2000 THEN
        RETURN json_build_object('success', false, 'message', '下注金额必须在1-2000之间');
    END IF;
    
    -- 5. 获取平台统一赔率（不再使用主播配置）
    IF p_bet_type = 'single_point' THEN
        IF p_bet_value IS NULL THEN
            RETURN json_build_object('success', false, 'message', '单点下注必须指定点数');
        END IF;
        v_odds := public.get_pc28_platform_odds(p_bet_type, p_bet_value);
    ELSE
        v_odds := public.get_pc28_platform_odds(p_bet_type, 0); -- 非单点类型传入0
    END IF;
    
    IF v_odds IS NULL THEN
        RETURN json_build_object('success', false, 'message', '无效的下注类型或点数');
    END IF;
    
    -- 6. 检查用户余额
    SELECT balance_coins INTO v_user_balance
    FROM public.profiles
    WHERE id = auth.uid()
    FOR UPDATE;
    
    IF v_user_balance IS NULL OR v_user_balance < p_amount THEN
        RETURN json_build_object('success', false, 'message', '余额不足');
    END IF;
    
    -- 7. 扣除用户余额并获取用户昵称
    UPDATE public.profiles
    SET balance_coins = balance_coins - p_amount
    WHERE id = auth.uid()
    RETURNING balance_coins, nickname INTO v_final_balance, v_user_nickname;
    
    -- 如果没有昵称，使用默认值
    IF v_user_nickname IS NULL OR v_user_nickname = '' THEN
        v_user_nickname := '用户';
    END IF;
    
    -- 8. 记录资金流水（下注支出）
    INSERT INTO public.coin_transactions (
        user_id, amount, balance_after, type, description, related_id
    ) VALUES (
        auth.uid(),
        -p_amount,
        v_final_balance,
        'pc28_bet',
        'PC28游戏下注',
        p_round_id
    );
    
    -- 9. 创建下注记录
    INSERT INTO public.pc28_bets (
        round_id,
        room_id,
        user_id,
        bet_type,
        bet_value,
        amount,
        odds,
        status
    ) VALUES (
        p_round_id,
        v_round.room_id,
        auth.uid(),
        p_bet_type,
        p_bet_value,
        p_amount,
        v_odds,
        'pending'
    ) RETURNING id INTO v_bet_id;
    
    -- 10. 推送消息到直播间（显示用户名和下注金额）
    INSERT INTO public.live_broadcast_messages (
        room_id, user_id, content, msg_type
    ) VALUES (
        v_round.room_id,
        auth.uid(),
        json_build_object('text', format('%s 下注了 %s抖币', v_user_nickname, p_amount::TEXT))::text,
        'pc28'
    );
    
    RETURN json_build_object(
        'success', true,
        'bet_id', v_bet_id,
        'message', '下注成功'
    );
END;
$$;

COMMENT ON FUNCTION public.place_pc28_bet IS 'PC28房间级别下注函数（已修复封盘检查）';

-- ============================================================================
-- 2. 修复全局PC28下注函数
-- ============================================================================
CREATE OR REPLACE FUNCTION public.place_pc28_bet_global(
    p_global_round_id UUID,
    p_room_id UUID,
    p_bet_type TEXT,
    p_amount NUMERIC,
    p_bet_value INT DEFAULT NULL
) RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_round RECORD;
    v_room_enabled RECORD;
    v_user_balance NUMERIC;
    v_odds NUMERIC;
    v_bet_id UUID;
    v_final_balance NUMERIC;
    v_user_nickname TEXT;
BEGIN
    -- 🎯 设置会话变量，允许修改用户余额
    PERFORM set_config('app.pc28_settlement', 'true', false);
    
    -- 1. 🔒 锁定全局期数记录，确保原子性检查
    SELECT * INTO v_round
    FROM public.pc28_global_rounds
    WHERE id = p_global_round_id
    FOR UPDATE;
    
    IF v_round IS NULL THEN
        PERFORM set_config('app.pc28_settlement', 'false', false);
        RETURN json_build_object('success', false, 'message', '期数不存在');
    END IF;
    
    -- 2. 检查状态（锁定后再次检查，确保状态未改变）
    IF v_round.status != 'betting' THEN
        PERFORM set_config('app.pc28_settlement', 'false', false);
        RETURN json_build_object('success', false, 'message', '该期已封盘或已结算');
    END IF;
    
    -- 3. 🎯 检查封盘时间（关键修复：防止封盘后下注）
    IF v_round.seal_at IS NOT NULL AND now() >= v_round.seal_at THEN
        -- 如果已到封盘时间，自动更新状态为sealed
        UPDATE public.pc28_global_rounds 
        SET status = 'sealed' 
        WHERE id = p_global_round_id;
        PERFORM set_config('app.pc28_settlement', 'false', false);
        RETURN json_build_object('success', false, 'message', '该期已封盘');
    END IF;
    
    -- 4. 验证房间是否开启PC28
    SELECT * INTO v_room_enabled
    FROM public.pc28_room_enabled
    WHERE room_id = p_room_id AND enabled = true;
    
    IF v_room_enabled IS NULL THEN
        PERFORM set_config('app.pc28_settlement', 'false', false);
        RETURN json_build_object('success', false, 'message', '该房间未开启PC28游戏');
    END IF;
    
    -- 5. 验证下注金额
    IF p_amount <= 0 THEN
        PERFORM set_config('app.pc28_settlement', 'false', false);
        RETURN json_build_object('success', false, 'message', '下注金额必须大于0');
    END IF;
    
    IF p_amount > 2000 THEN
        PERFORM set_config('app.pc28_settlement', 'false', false);
        RETURN json_build_object('success', false, 'message', '单注下注金额不能超过2000抖币');
    END IF;
    
    -- 6. 获取用户余额
    SELECT balance_coins INTO v_user_balance
    FROM public.profiles
    WHERE id = auth.uid()
    FOR UPDATE;
    
    IF v_user_balance IS NULL OR v_user_balance < p_amount THEN
        PERFORM set_config('app.pc28_settlement', 'false', false);
        RETURN json_build_object('success', false, 'message', '余额不足');
    END IF;
    
    -- 7. 获取赔率
    v_odds := public.get_pc28_platform_odds(p_bet_type, COALESCE(p_bet_value, 0));
    
    IF v_odds IS NULL THEN
        PERFORM set_config('app.pc28_settlement', 'false', false);
        RETURN json_build_object('success', false, 'message', '无效的下注类型');
    END IF;
    
    -- 8. 扣除用户余额
    UPDATE public.profiles
    SET balance_coins = balance_coins - p_amount
    WHERE id = auth.uid()
    RETURNING balance_coins INTO v_final_balance;
    
    -- 9. 记录下注流水
    INSERT INTO public.coin_transactions (
        user_id, amount, balance_after, type, description, related_id
    ) VALUES (
        auth.uid(),
        -p_amount,
        v_final_balance,
        'pc28_bet',
        format('PC28游戏下注：%s期', v_round.period_number),
        NULL
    );
    
    -- 10. 创建下注记录
    INSERT INTO public.pc28_bets (
        global_round_id,
        room_id,
        user_id,
        bet_type,
        bet_value,
        amount,
        odds,
        status
    ) VALUES (
        p_global_round_id,
        p_room_id,
        auth.uid(),
        p_bet_type,
        p_bet_value,
        p_amount,
        v_odds,
        'pending'
    ) RETURNING id INTO v_bet_id;
    
    -- 11. 更新全局期数总下注金额
    UPDATE public.pc28_global_rounds
    SET total_bet_amount = total_bet_amount + p_amount,
        updated_at = now()
    WHERE id = p_global_round_id;
    
    -- 12. 获取用户昵称
    SELECT nickname INTO v_user_nickname
    FROM public.profiles
    WHERE id = auth.uid();
    
    -- 13. 推送下注消息到该房间
    INSERT INTO public.live_broadcast_messages (
        room_id,
        user_id,
        msg_type,
        content
    ) VALUES (
        p_room_id,
        auth.uid(),
        'pc28',
        json_build_object(
            'type', 'bet',
            'user_nickname', COALESCE(v_user_nickname, '用户'),
            'bet_type', p_bet_type,
            'bet_value', p_bet_value,
            'amount', p_amount,
            'period_number', v_round.period_number
        )::TEXT
    );
    
    PERFORM set_config('app.pc28_settlement', 'false', false);
    
    RETURN json_build_object(
        'success', true,
        'message', '下注成功',
        'bet_id', v_bet_id
    );
EXCEPTION
    WHEN OTHERS THEN
        PERFORM set_config('app.pc28_settlement', 'false', false);
        RAISE;
END;
$$;

COMMENT ON FUNCTION public.place_pc28_bet_global IS 'PC28全局期数下注函数（已修复封盘检查）';
