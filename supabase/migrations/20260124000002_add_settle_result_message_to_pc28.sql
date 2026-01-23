-- 修改settle_pc28_round函数，添加开奖结果消息推送
CREATE OR REPLACE FUNCTION public.settle_pc28_round(
    p_round_id UUID,
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
    v_platform_fee NUMERIC;
    v_user_gain NUMERIC;
    v_anchor_payout NUMERIC;
    v_total_payout NUMERIC := 0;
    v_total_platform_fee NUMERIC := 0;
    v_total_bet_amount NUMERIC := 0;
    v_anchor_balance NUMERIC;
    v_user_balance NUMERIC;
    v_final_anchor_balance NUMERIC;
    v_final_user_balance NUMERIC;
    v_is_win BOOLEAN;
    v_message_text TEXT;
    v_message_content JSONB;
BEGIN
    -- 🎯 设置会话变量，允许PC28结算操作修改余额
    PERFORM set_config('app.pc28_settlement', 'true', true);
    
    -- 1. 验证期数存在且状态为betting或sealed
    SELECT * INTO v_round
    FROM public.pc28_game_rounds
    WHERE id = p_round_id
    FOR UPDATE;
    
    IF v_round IS NULL THEN
        PERFORM set_config('app.pc28_settlement', 'false', true);
        RETURN json_build_object('success', false, 'message', '期数不存在');
    END IF;
    
    IF v_round.status = 'settled' THEN
        PERFORM set_config('app.pc28_settlement', 'false', true);
        RETURN json_build_object('success', false, 'message', '该期已结算');
    END IF;
    
    -- 验证用户是主播
    IF v_round.anchor_id != auth.uid() THEN
        PERFORM set_config('app.pc28_settlement', 'false', true);
        RETURN json_build_object('success', false, 'message', '只有主播可以结算');
    END IF;
    
    -- 2. 验证结果有效性
    IF p_num1 < 0 OR p_num1 > 9 OR p_num2 < 0 OR p_num2 > 9 OR p_num3 < 0 OR p_num3 > 9 THEN
        PERFORM set_config('app.pc28_settlement', 'false', true);
        RETURN json_build_object('success', false, 'message', '结果无效，每个数字必须在0-9之间');
    END IF;
    
    v_sum := p_num1 + p_num2 + p_num3;
    v_result := json_build_object(
        'num1', p_num1,
        'num2', p_num2,
        'num3', p_num3,
        'sum', v_sum
    );
    
    -- 3. 计算总下注金额
    SELECT COALESCE(SUM(amount), 0) INTO v_total_bet_amount
    FROM public.pc28_bets
    WHERE round_id = p_round_id;
    
    -- 4. 锁定主播余额并检查是否足够支付所有中奖奖金
    SELECT balance_coins INTO v_anchor_balance
    FROM public.profiles
    WHERE id = v_round.anchor_id
    FOR UPDATE;
    
    -- 先计算总赔付金额（估算所有可能中奖的下注）
    SELECT COALESCE(SUM(amount * odds), 0) INTO v_total_payout
    FROM public.pc28_bets
    WHERE round_id = p_round_id
    AND status = 'pending'
    AND public.check_pc28_win(v_result, bet_type, bet_value);
    
    IF v_anchor_balance < v_total_payout THEN
        PERFORM set_config('app.pc28_settlement', 'false', true);
        RETURN json_build_object(
            'success', false,
            'message', '主播余额不足，无法结算。请充值后再结算',
            'required_balance', v_total_payout,
            'current_balance', v_anchor_balance
        );
    END IF;
    
    -- 重置累计变量
    v_total_payout := 0;
    
    -- 5. 遍历所有下注记录进行结算
    FOR v_bet IN 
        SELECT * FROM public.pc28_bets
        WHERE round_id = p_round_id AND status = 'pending'
        FOR UPDATE
    LOOP
        -- 判断是否中奖
        v_is_win := public.check_pc28_win(v_result, v_bet.bet_type, v_bet.bet_value);
        
        IF v_is_win THEN
            -- 计算奖金（包含本金）
            v_payout := v_bet.amount * v_bet.odds;
            -- 平台抽成（从奖金中抽取1%）
            v_platform_fee := v_payout * 0.01;
            -- 用户实际获得（奖金 - 平台抽成）
            v_user_gain := v_payout - v_platform_fee;
            -- 主播实际支付（奖金）
            v_anchor_payout := v_payout;
            
            -- 更新下注记录
            UPDATE public.pc28_bets SET
                status = 'settled',
                is_win = true,
                payout = v_payout,
                platform_fee = v_platform_fee,
                user_gain = v_user_gain,
                anchor_payout = v_anchor_payout,
                settled_at = now()
            WHERE id = v_bet.id;
            
            -- 增加用户余额（会话变量已设置，触发器会允许）
            UPDATE public.profiles
            SET balance_coins = balance_coins + v_user_gain
            WHERE id = v_bet.user_id
            RETURNING balance_coins INTO v_final_user_balance;
            
            -- 检查是否成功更新
            IF v_final_user_balance IS NULL THEN
                PERFORM set_config('app.pc28_settlement', 'false', true);
                RAISE EXCEPTION '无法更新用户余额，用户ID: %', v_bet.user_id;
            END IF;
            
            -- 记录用户资金流水（中奖收入）
            INSERT INTO public.coin_transactions (
                user_id, amount, balance_after, type, description, related_id
            ) VALUES (
                v_bet.user_id,
                v_user_gain,
                v_final_user_balance,
                'pc28_win',
                'PC28游戏中奖',
                p_round_id
            );
            
            -- 扣除主播余额
            UPDATE public.profiles
            SET balance_coins = balance_coins - v_anchor_payout
            WHERE id = v_round.anchor_id
            RETURNING balance_coins INTO v_final_anchor_balance;
            
            -- 检查是否成功更新
            IF v_final_anchor_balance IS NULL THEN
                PERFORM set_config('app.pc28_settlement', 'false', true);
                RAISE EXCEPTION '无法更新主播余额，主播ID: %', v_round.anchor_id;
            END IF;
            
            -- 记录主播资金流水（支付奖金）
            INSERT INTO public.coin_transactions (
                user_id, amount, balance_after, type, description, related_id
            ) VALUES (
                v_round.anchor_id,
                -v_anchor_payout,
                v_final_anchor_balance,
                'pc28_payout',
                'PC28游戏支付奖金',
                p_round_id
            );
            
            -- 累计统计（只统计中奖的）
            v_total_payout := v_total_payout + v_payout;
            v_total_platform_fee := v_total_platform_fee + v_platform_fee;
        ELSE
            -- 未中奖：玩家下注金额归主播
            v_anchor_payout := v_bet.amount;
            
            -- 更新下注记录
            UPDATE public.pc28_bets SET
                status = 'settled',
                is_win = false,
                payout = 0,
                platform_fee = 0,
                user_gain = 0,
                anchor_payout = v_anchor_payout,
                settled_at = now()
            WHERE id = v_bet.id;
            
            -- 增加主播余额（玩家未中奖的下注金额）
            UPDATE public.profiles
            SET balance_coins = balance_coins + v_anchor_payout
            WHERE id = v_round.anchor_id
            RETURNING balance_coins INTO v_final_anchor_balance;
            
            -- 记录主播资金流水（获得未中奖下注）
            INSERT INTO public.coin_transactions (
                user_id, amount, balance_after, type, description, related_id
            ) VALUES (
                v_round.anchor_id,
                v_anchor_payout,
                v_final_anchor_balance,
                'pc28_bet_income',
                'PC28游戏未中奖下注收入',
                p_round_id
            );
        END IF;
    END LOOP;
    
    -- 6. 更新期数记录
    UPDATE public.pc28_game_rounds SET
        status = 'settled',
        result = v_result,
        total_bet_amount = v_total_bet_amount,
        total_payout = v_total_payout,
        total_platform_fee = v_total_platform_fee,
        settled_at = now(),
        updated_at = now()
    WHERE id = p_round_id;
    
    -- 🎯 推送开奖结果消息到评论区
    v_message_text := COALESCE(v_round.game_name, 'PC28') || ' ' || v_round.period_number || '期 开奖结果：' || 
                      p_num1::TEXT || ' ' || p_num2::TEXT || ' ' || p_num3::TEXT || ' 和值' || v_sum::TEXT;
    
    v_message_content := json_build_object(
        'text', v_message_text,
        'game_name', COALESCE(v_round.game_name, 'PC28'),
        'period_number', v_round.period_number,
        'result', v_result
    );
    
    INSERT INTO public.live_broadcast_messages (
        room_id,
        msg_type,
        content
    ) VALUES (
        v_round.room_id,
        'pc28',
        v_message_content::TEXT
    );
    
    -- 🎯 重置会话变量
    PERFORM set_config('app.pc28_settlement', 'false', true);
    
    RETURN json_build_object(
        'success', true,
        'message', '结算成功',
        'total_bet_amount', v_total_bet_amount,
        'total_payout', v_total_payout,
        'total_platform_fee', v_total_platform_fee
    );
EXCEPTION
    WHEN OTHERS THEN
        -- 🎯 确保在异常情况下也重置会话变量
        PERFORM set_config('app.pc28_settlement', 'false', true);
        -- 记录错误并返回
        RAISE EXCEPTION '结算失败: %', SQLERRM;
END;
$$;
