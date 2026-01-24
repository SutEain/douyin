-- 🎯 修改组合玩法规则
-- 1. 遇到13/14时，所有组合玩法（大单、大双、小单、小双）仅回本
-- 2. 遇到对子、顺子、豹子时，组合玩法正常结算（不算特殊情况）

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
    v_platform_fee NUMERIC;
    v_user_gain NUMERIC;
    v_anchor_payout NUMERIC;
    v_total_payout NUMERIC := 0;
    v_total_platform_fee NUMERIC := 0;
    v_total_bet_amount NUMERIC := 0;
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
    v_user_profit NUMERIC; -- 用户盈利（用于计算平台抽成）
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
        
        -- 🎯 特殊规则2：遇13/14，所有组合玩法（大单、大双、小单、小双）仅回本
        IF v_is_special_case AND v_bet.bet_type IN ('big_odd', 'big_even', 'small_odd', 'small_even') THEN
            -- 判断原本是否应该中奖（按大小单双判断）
            IF v_bet.bet_type = 'big_odd' THEN
                v_is_win := (v_sum >= 14 AND v_sum % 2 = 1);
            ELSIF v_bet.bet_type = 'big_even' THEN
                v_is_win := (v_sum >= 14 AND v_sum % 2 = 0);
            ELSIF v_bet.bet_type = 'small_odd' THEN
                v_is_win := (v_sum <= 13 AND v_sum % 2 = 1);
            ELSIF v_bet.bet_type = 'small_even' THEN
                v_is_win := (v_sum <= 13 AND v_sum % 2 = 0);
            END IF;
            
            -- 如果原本应该中，则回本（赔率1.0），不算中奖
            IF v_is_win THEN
                v_is_win := false; -- 不算中奖
                v_actual_odds := 1.0; -- 只回本
                v_is_combination_refund := true;
            ELSE
                -- 如果原本不应该中，则不算中奖（被吃掉）
                v_is_win := false;
                v_is_combination_refund := false;
            END IF;
        END IF;
        
        -- 🎯 注意：对子、顺子、豹子时，组合玩法正常结算，不需要特殊处理
        
        -- 处理中奖或回本
        IF v_is_win OR v_is_combination_refund THEN
            -- 计算奖金（使用实际赔率）
            v_payout := v_bet.amount * v_actual_odds;
            
            IF v_is_win THEN
                -- 🎯 新抽水规则：平台抽用户盈利的1%（只有真正中奖才抽水）
                v_user_profit := v_payout - v_bet.amount;
                v_platform_fee := GREATEST(v_user_profit * 0.01, 0);
                v_user_gain := v_payout - v_platform_fee;
                v_total_payout := v_total_payout + v_payout;
                v_total_platform_fee := v_total_platform_fee + v_platform_fee;
            ELSE
                -- 回本情况：不抽水，直接退回本金
                v_user_gain := v_payout;
                v_platform_fee := 0;
            END IF;
            
            -- 增加用户余额
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
            
            -- 记录用户资金流水
            IF v_is_win THEN
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
            ELSE
                -- 回本情况：记录为退款类型
                INSERT INTO public.coin_transactions (
                    user_id, amount, balance_after, type, description, related_id
                ) VALUES (
                    v_bet.user_id,
                    v_user_gain,
                    v_final_user_balance,
                    'pc28_refund',
                    format('PC28组合玩法回本：%s期（13/14）', v_round.period_number),
                    v_bet.id
                );
            END IF;
            
            -- 更新下注记录
            UPDATE public.pc28_bets SET
                status = 'settled',
                is_win = v_is_win, -- 回本时设为false
                payout = v_payout,
                platform_fee = v_platform_fee,
                user_gain = v_user_gain,
                anchor_payout = 0,
                settled_at = now()
            WHERE id = v_bet.id;
        ELSE
            -- 未中奖：记录流水（平台收入）
            SELECT balance_coins INTO v_user_balance
            FROM public.profiles
            WHERE id = v_bet.user_id;
            
            INSERT INTO public.coin_transactions (
                user_id, amount, balance_after, type, description, related_id
            ) VALUES (
                v_bet.user_id,
                v_bet.amount,
                v_user_balance,
                'pc28_bet_income',
                format('PC28游戏未中奖：%s期', v_round.period_number),
                v_bet.id
            );
            
            -- 更新下注记录
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
    
    -- 8. 更新期数状态
    UPDATE public.pc28_global_rounds SET
        status = 'settled',
        result = v_result,
        settled_at = now(),
        total_bet_amount = v_total_bet_amount,
        total_payout = v_total_payout,
        total_platform_fee = v_total_platform_fee,
        updated_at = now()
    WHERE id = p_global_round_id;
    
    -- 9. 格式化开奖结果消息
    v_message_text := public.format_pc28_result(p_num1, p_num2, p_num3, v_sum);
    
    -- 10. 推送结算消息到所有开启PC28的房间
    v_message_content := json_build_object(
        'type', 'round_settled',
        'period_number', v_round.period_number,
        'result', v_result,
        'text', format('PC28 %s期 已开奖：%s', v_round.period_number, v_message_text)
    );
    
    INSERT INTO public.live_broadcast_messages (
        room_id,
        msg_type,
        content
    )
    SELECT 
        room_id,
        'pc28',
        v_message_content::text
    FROM public.pc28_room_enabled
    WHERE enabled = true;
    
    -- 11. 重置会话变量
    PERFORM set_config('app.pc28_settlement', 'false', false);
    
    RETURN json_build_object(
        'success', true,
        'message', format('结算成功：%s期', v_round.period_number),
        'total_bet_amount', v_total_bet_amount,
        'total_payout', v_total_payout,
        'total_platform_fee', v_total_platform_fee
    );
END;
$$;

COMMENT ON FUNCTION public.settle_global_round IS '结算全局期数：按房间分组，每个房间主播获得该房间下注额的1%。规则：13/14时组合玩法仅回本；对子/顺子/豹子时组合玩法正常结算';
