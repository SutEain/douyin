-- 🎯 PC28全局游戏系统：适配全局期数的下注和结算函数
-- 1. 修改place_pc28_bet：支持global_round_id
-- 2. 创建settle_global_round：结算全局期数
-- 3. 创建place_pc28_bet_global：新的下注函数（使用global_round_id）

-- ============================================================================
-- 1. 创建新的下注函数：使用global_round_id
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
    
    -- 1. 验证全局期数存在且状态为betting
    SELECT * INTO v_round
    FROM public.pc28_global_rounds
    WHERE id = p_global_round_id;
    
    IF v_round IS NULL THEN
        PERFORM set_config('app.pc28_settlement', 'false', false);
        RETURN json_build_object('success', false, 'message', '期数不存在');
    END IF;
    
    IF v_round.status != 'betting' THEN
        PERFORM set_config('app.pc28_settlement', 'false', false);
        RETURN json_build_object('success', false, 'message', '该期已封盘或已结算');
    END IF;
    
    -- 2. 验证房间是否开启PC28
    SELECT * INTO v_room_enabled
    FROM public.pc28_room_enabled
    WHERE room_id = p_room_id AND enabled = true;
    
    IF v_room_enabled IS NULL THEN
        PERFORM set_config('app.pc28_settlement', 'false', false);
        RETURN json_build_object('success', false, 'message', '该房间未开启PC28游戏');
    END IF;
    
    -- 3. 验证下注金额
    IF p_amount <= 0 THEN
        PERFORM set_config('app.pc28_settlement', 'false', false);
        RETURN json_build_object('success', false, 'message', '下注金额必须大于0');
    END IF;
    
    IF p_amount > 2000 THEN
        PERFORM set_config('app.pc28_settlement', 'false', false);
        RETURN json_build_object('success', false, 'message', '单注下注金额不能超过2000抖币');
    END IF;
    
    -- 4. 获取用户余额
    SELECT balance_coins INTO v_user_balance
    FROM public.profiles
    WHERE id = auth.uid()
    FOR UPDATE;
    
    IF v_user_balance IS NULL OR v_user_balance < p_amount THEN
        PERFORM set_config('app.pc28_settlement', 'false', false);
        RETURN json_build_object('success', false, 'message', '余额不足');
    END IF;
    
    -- 5. 获取赔率
    v_odds := public.get_pc28_platform_odds(p_bet_type, COALESCE(p_bet_value, 0));
    
    IF v_odds IS NULL THEN
        PERFORM set_config('app.pc28_settlement', 'false', false);
        RETURN json_build_object('success', false, 'message', '无效的下注类型');
    END IF;
    
    -- 6. 扣除用户余额
    UPDATE public.profiles
    SET balance_coins = balance_coins - p_amount
    WHERE id = auth.uid()
    RETURNING balance_coins INTO v_final_balance;
    
    -- 7. 记录下注流水
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
    
    -- 8. 创建下注记录
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
    
    -- 9. 更新全局期数总下注金额
    UPDATE public.pc28_global_rounds
    SET total_bet_amount = total_bet_amount + p_amount,
        updated_at = now()
    WHERE id = p_global_round_id;
    
    -- 10. 获取用户昵称
    SELECT nickname INTO v_user_nickname
    FROM public.profiles
    WHERE id = auth.uid();
    
    -- 11. 推送下注消息到该房间
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

COMMENT ON FUNCTION public.place_pc28_bet_global IS 'PC28全局期数下注函数';

-- ============================================================================
-- 2. 创建结算全局期数函数
-- ============================================================================
CREATE OR REPLACE FUNCTION public.settle_global_round(
    p_global_round_id UUID,
    p_num1 INT,
    p_num2 INT,
    p_num3 INT
) RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_round RECORD;
    v_result JSONB;
    v_sum INT;
    v_bet RECORD;
    v_payout NUMERIC;
    v_user_profit NUMERIC;
    v_platform_fee NUMERIC;
    v_user_gain NUMERIC;
    v_anchor_commission NUMERIC;
    v_total_payout NUMERIC := 0;
    v_total_platform_fee NUMERIC := 0;
    v_total_bet_amount NUMERIC := 0;
    v_total_anchor_commission NUMERIC := 0;
    v_user_balance NUMERIC;
    v_final_user_balance NUMERIC;
    v_anchor_balance NUMERIC;
    v_final_anchor_balance NUMERIC;
    v_is_win BOOLEAN;
    v_actual_odds NUMERIC;
    v_message_text TEXT;
    v_message_content JSONB;
    v_is_special_case BOOLEAN;
    v_is_combination_refund BOOLEAN;
    v_room_bet_amount NUMERIC; -- 每个房间的下注总额
    v_room_anchor_id UUID; -- 每个房间的主播ID
BEGIN
    -- 🎯 设置会话变量，允许修改用户余额
    PERFORM set_config('app.pc28_settlement', 'true', false);
    
    -- 1. 验证期数存在且状态为betting或sealed
    SELECT * INTO v_round
    FROM public.pc28_global_rounds
    WHERE id = p_global_round_id
    FOR UPDATE;
    
    IF v_round IS NULL THEN
        PERFORM set_config('app.pc28_settlement', 'false', false);
        RETURN json_build_object('success', false, 'message', '期数不存在');
    END IF;
    
    IF v_round.status NOT IN ('betting', 'sealed') THEN
        PERFORM set_config('app.pc28_settlement', 'false', false);
        RETURN json_build_object('success', false, 'message', '该期已结算');
    END IF;
    
    -- 2. 验证数字范围
    IF p_num1 < 0 OR p_num1 > 9 OR p_num2 < 0 OR p_num2 > 9 OR p_num3 < 0 OR p_num3 > 9 THEN
        PERFORM set_config('app.pc28_settlement', 'false', false);
        RETURN json_build_object('success', false, 'message', '数字必须在0-9之间');
    END IF;
    
    -- 3. 计算和值
    v_sum := p_num1 + p_num2 + p_num3;
    
    -- 4. 构建结果JSON
    v_result := json_build_object(
        'num1', p_num1,
        'num2', p_num2,
        'num3', p_num3,
        'sum', v_sum
    );
    
    -- 5. 判断是否是特殊情况（13/14）
    v_is_special_case := (v_sum = 13 OR v_sum = 14);
    
    -- 6. 遍历所有下注记录，按房间分组结算
    FOR v_bet IN 
        SELECT b.*, r.anchor_id as room_anchor_id
        FROM public.pc28_bets b
        JOIN public.live_broadcast_rooms r ON r.id = b.room_id
        WHERE b.global_round_id = p_global_round_id AND b.status = 'pending'
        FOR UPDATE
    LOOP
        v_total_bet_amount := v_total_bet_amount + v_bet.amount;
        
        -- 判断是否中奖
        v_is_win := public.check_pc28_win(v_result, v_bet.bet_type, v_bet.bet_value);
        
        -- 初始化实际赔率
        v_actual_odds := v_bet.odds;
        v_is_combination_refund := false;
        
        -- 🎯 特殊规则1：遇13/14，大小单双中奖赔1.6倍
        IF v_is_special_case AND v_is_win THEN
            IF v_bet.bet_type IN ('big', 'small', 'odd', 'even') THEN
                v_actual_odds := 1.6;
            END IF;
        END IF;
        
        -- 🎯 特殊规则2：组合小单大双遇13/14回本
        IF v_is_special_case THEN
            IF v_sum = 13 AND v_bet.bet_type = 'small_odd' THEN
                v_is_win := true;
                v_actual_odds := 1.0;
                v_is_combination_refund := true;
            ELSIF v_sum = 14 AND v_bet.bet_type = 'big_even' THEN
                v_is_win := true;
                v_actual_odds := 1.0;
                v_is_combination_refund := true;
            ELSIF v_bet.bet_type IN ('big_odd', 'big_even', 'small_odd', 'small_even') THEN
                v_is_win := false;
            END IF;
        END IF;
        
        IF v_is_win THEN
            -- 计算奖金（使用实际赔率）
            v_payout := v_bet.amount * v_actual_odds;
            
            -- 🎯 新抽水规则：平台抽用户盈利的1%
            v_user_profit := v_payout - v_bet.amount;
            v_platform_fee := GREATEST(v_user_profit * 0.01, 0);
            v_user_gain := v_payout - v_platform_fee;
            
            v_total_payout := v_total_payout + v_payout;
            v_total_platform_fee := v_total_platform_fee + v_platform_fee;
            
            -- 增加用户余额（平台支付奖金，扣除平台抽成）
            SELECT balance_coins INTO v_user_balance
            FROM public.profiles
            WHERE id = v_bet.user_id;
            
            UPDATE public.profiles
            SET balance_coins = balance_coins + v_user_gain
            WHERE id = v_bet.user_id
            RETURNING balance_coins INTO v_final_user_balance;
            
            IF v_final_user_balance IS NULL THEN
                PERFORM set_config('app.pc28_settlement', 'false', false);
                RAISE EXCEPTION '无法更新用户余额，用户ID: %', v_bet.user_id;
            END IF;
            
            -- 记录用户资金流水（中奖）
            INSERT INTO public.coin_transactions (
                user_id, amount, balance_after, type, description, related_id
            ) VALUES (
                v_bet.user_id,
                v_user_gain,
                v_final_user_balance,
                'pc28_win',
                format('PC28游戏中奖：%s期', v_round.period_number),
                v_bet.id
            );
            
            -- 更新下注记录
            UPDATE public.pc28_bets SET
                status = 'settled',
                is_win = true,
                payout = v_payout,
                platform_fee = v_platform_fee,
                user_gain = v_user_gain,
                anchor_payout = 0,
                settled_at = now()
            WHERE id = v_bet.id;
        ELSE
            -- 未中奖：平台获得下注金额（用户下注时已扣除）
            UPDATE public.pc28_bets SET
                status = 'settled',
                is_win = false,
                payout = 0,
                platform_fee = 0,
                user_gain = 0,
                anchor_payout = 0,
                settled_at = now()
            WHERE id = v_bet.id;
        END IF;
    END LOOP;
    
    -- 7. 🎯 按房间分组，给每个房间的主播支付抽水（下注额的1%）
    FOR v_room_anchor_id, v_room_bet_amount IN
        SELECT r.anchor_id, COALESCE(SUM(b.amount), 0)
        FROM public.pc28_bets b
        JOIN public.live_broadcast_rooms r ON r.id = b.room_id
        WHERE b.global_round_id = p_global_round_id
        GROUP BY r.anchor_id
    LOOP
        IF v_room_bet_amount > 0 THEN
            v_anchor_commission := v_room_bet_amount * 0.01;
            v_total_anchor_commission := v_total_anchor_commission + v_anchor_commission;
            
            UPDATE public.profiles
            SET balance_coins = balance_coins + v_anchor_commission
            WHERE id = v_room_anchor_id
            RETURNING balance_coins INTO v_final_anchor_balance;
            
            -- 记录主播资金流水（平台支付的抽水）
            INSERT INTO public.coin_transactions (
                user_id, amount, balance_after, type, description, related_id
            ) VALUES (
                v_room_anchor_id,
                v_anchor_commission,
                v_final_anchor_balance,
                'pc28_bet_income',
                format('PC28游戏抽水：%s期（下注额1%%）', v_round.period_number),
                p_global_round_id
            );
        END IF;
    END LOOP;
    
    -- 8. 更新期数记录
    UPDATE public.pc28_global_rounds SET
        status = 'settled',
        result = v_result,
        total_bet_amount = v_total_bet_amount,
        total_payout = v_total_payout,
        total_platform_fee = v_total_platform_fee,
        settled_at = now(),
        updated_at = now()
    WHERE id = p_global_round_id;
    
    -- 9. 🎯 推送开奖结果消息到所有开启PC28的房间
    v_message_text := public.format_pc28_result(p_num1, p_num2, p_num3, v_sum);
    
    v_message_content := json_build_object(
        'text', v_message_text,
        'game_name', 'PC28',
        'period_number', v_round.period_number,
        'result', v_result
    );
    
    INSERT INTO public.live_broadcast_messages (
        room_id,
        msg_type,
        content
    )
    SELECT 
        re.room_id,
        'pc28',
        v_message_content::TEXT
    FROM public.pc28_room_enabled re
    WHERE re.enabled = true;
    
    -- 🎯 重置会话变量
    PERFORM set_config('app.pc28_settlement', 'false', false);
    
    RETURN json_build_object(
        'success', true,
        'message', '结算成功',
        'total_bet_amount', v_total_bet_amount,
        'total_payout', v_total_payout,
        'total_platform_fee', v_total_platform_fee,
        'total_anchor_commission', v_total_anchor_commission
    );
EXCEPTION
    WHEN OTHERS THEN
        PERFORM set_config('app.pc28_settlement', 'false', false);
        RAISE;
END;
$$;

COMMENT ON FUNCTION public.settle_global_round IS '结算全局期数：按房间分组，每个房间主播获得该房间下注额的1%';
