-- 修改settle_pc28_round函数，格式化开奖结果消息
-- 格式：4+2+9=15 大 单 杂六

CREATE OR REPLACE FUNCTION public.format_pc28_result(
    p_num1 INT,
    p_num2 INT,
    p_num3 INT,
    p_sum INT
) RETURNS TEXT
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
    v_sorted_nums INT[];
    v_big_small TEXT;
    v_odd_even TEXT;
    v_pattern TEXT;
BEGIN
    -- 排序后的数字（用于判断顺子）
    v_sorted_nums := ARRAY[p_num1, p_num2, p_num3];
    SELECT ARRAY(SELECT unnest(v_sorted_nums) ORDER BY 1) INTO v_sorted_nums;
    
    -- 判断大小
    IF p_sum >= 14 THEN
        v_big_small := '大';
    ELSE
        v_big_small := '小';
    END IF;
    
    -- 判断单双
    IF p_sum % 2 = 1 THEN
        v_odd_even := '单';
    ELSE
        v_odd_even := '双';
    END IF;
    
    -- 判断模式：豹子 > 对子 > 顺子 > 杂六
    IF p_num1 = p_num2 AND p_num2 = p_num3 THEN
        v_pattern := '豹子';
    ELSIF (p_num1 = p_num2 OR p_num1 = p_num3 OR p_num2 = p_num3) 
          AND NOT (p_num1 = p_num2 AND p_num2 = p_num3) THEN
        v_pattern := '对子';
    ELSIF (v_sorted_nums[2] = v_sorted_nums[1] + 1 AND v_sorted_nums[3] = v_sorted_nums[2] + 1) THEN
        v_pattern := '顺子';
    ELSE
        v_pattern := '杂六';
    END IF;
    
    -- 返回格式化结果：4+2+9=15 大 单 杂六
    RETURN format('%s+%s+%s=%s %s %s %s', 
        p_num1, p_num2, p_num3, p_sum, 
        v_big_small, v_odd_even, v_pattern);
END;
$$;

-- 修改settle_pc28_round函数，使用新的格式化函数
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
    -- 1. 验证期数存在且状态为betting或sealed
    SELECT * INTO v_round
    FROM public.pc28_game_rounds
    WHERE id = p_round_id
    FOR UPDATE;
    
    IF v_round IS NULL THEN
        RETURN json_build_object('success', false, 'message', '期数不存在');
    END IF;
    
    IF v_round.status NOT IN ('betting', 'sealed') THEN
        RETURN json_build_object('success', false, 'message', '该期已结算');
    END IF;
    
    -- 2. 验证数字范围
    IF p_num1 < 0 OR p_num1 > 9 OR p_num2 < 0 OR p_num2 > 9 OR p_num3 < 0 OR p_num3 > 9 THEN
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
    
    -- 🎯 设置会话变量，允许修改用户余额
    PERFORM set_config('app.pc28_settlement', 'true', false);
    
    -- 5. 遍历所有下注记录，结算
    FOR v_bet IN 
        SELECT * FROM public.pc28_bets
        WHERE round_id = p_round_id AND status = 'pending'
        FOR UPDATE
    LOOP
        v_total_bet_amount := v_total_bet_amount + v_bet.amount;
        
        -- 判断是否中奖
        v_is_win := public.check_pc28_win(v_result, v_bet.bet_type, v_bet.bet_value);
        
        IF v_is_win THEN
            -- 计算赔付
            v_payout := v_bet.amount * v_bet.odds;
            v_platform_fee := v_payout * 0.01; -- 平台抽成1%
            v_user_gain := v_payout - v_platform_fee;
            v_anchor_payout := v_bet.amount - v_user_gain; -- 主播需要赔付的金额
            
            v_total_payout := v_total_payout + v_user_gain;
            v_total_platform_fee := v_total_platform_fee + v_platform_fee;
            
            -- 获取主播余额
            SELECT balance_coins INTO v_anchor_balance
            FROM public.profiles
            WHERE id = v_round.anchor_id;
            
            -- 检查主播余额是否足够
            IF v_anchor_balance < v_anchor_payout THEN
                -- 🎯 重置会话变量
                PERFORM set_config('app.pc28_settlement', 'false', false);
                RETURN json_build_object(
                    'success', false, 
                    'message', format('主播余额不足，无法结算。需要：%s，当前：%s', v_anchor_payout, v_anchor_balance)
                );
            END IF;
            
            -- 扣除主播余额
            UPDATE public.profiles
            SET balance_coins = balance_coins - v_anchor_payout
            WHERE id = v_round.anchor_id
            RETURNING balance_coins INTO v_final_anchor_balance;
            
            -- 增加用户余额
            SELECT balance_coins INTO v_user_balance
            FROM public.profiles
            WHERE id = v_bet.user_id;
            
            UPDATE public.profiles
            SET balance_coins = balance_coins + v_user_gain
            WHERE id = v_bet.user_id
            RETURNING balance_coins INTO v_final_user_balance;
            
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
            
            -- 记录主播资金流水（赔付）
            INSERT INTO public.coin_transactions (
                user_id, amount, balance_after, type, description, related_id
            ) VALUES (
                v_round.anchor_id,
                -v_anchor_payout,
                v_final_anchor_balance,
                'pc28_payout',
                format('PC28游戏赔付：%s期', v_round.period_number),
                p_round_id
            );
            
            -- 更新下注记录
            UPDATE public.pc28_bets SET
                status = 'settled',
                is_win = true,
                payout = v_user_gain,
                platform_fee = v_platform_fee,
                user_gain = v_user_gain,
                anchor_payout = v_anchor_payout,
                settled_at = now()
            WHERE id = v_bet.id;
        ELSE
            -- 未中奖，主播获得下注金额
            UPDATE public.profiles
            SET balance_coins = balance_coins + v_bet.amount
            WHERE id = v_round.anchor_id
            RETURNING balance_coins INTO v_final_anchor_balance;
            
            -- 记录主播资金流水（获得未中奖下注）
            INSERT INTO public.coin_transactions (
                user_id, amount, balance_after, type, description, related_id
            ) VALUES (
                v_round.anchor_id,
                v_bet.amount,
                v_final_anchor_balance,
                'pc28_bet_income',
                format('PC28游戏未中奖下注收入：%s期', v_round.period_number),
                p_round_id
            );
            
            -- 更新下注记录
            UPDATE public.pc28_bets SET
                status = 'settled',
                is_win = false,
                payout = 0,
                platform_fee = 0,
                user_gain = 0,
                anchor_payout = v_bet.amount,
                settled_at = now()
            WHERE id = v_bet.id;
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
    
    -- 🎯 推送开奖结果消息到评论区（使用新格式）
    v_message_text := public.format_pc28_result(p_num1, p_num2, p_num3, v_sum);
    
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
    PERFORM set_config('app.pc28_settlement', 'false', false);
    
    RETURN json_build_object(
        'success', true,
        'message', '结算成功',
        'total_bet_amount', v_total_bet_amount,
        'total_payout', v_total_payout,
        'total_platform_fee', v_total_platform_fee
    );
EXCEPTION
    WHEN OTHERS THEN
        -- 🎯 确保重置会话变量
        PERFORM set_config('app.pc28_settlement', 'false', false);
        RAISE;
END;
$$;

-- 授权
GRANT EXECUTE ON FUNCTION public.format_pc28_result(INT, INT, INT, INT) TO authenticated;
