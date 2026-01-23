-- 1. 修复顺子和对子的判断逻辑（确保正确）
-- 对子：有两个数字相同（但不是豹子）
-- 顺子：三个数字连续（排序后）
-- 杂六：既不是对子也不是顺子也不是豹子

-- 检查逻辑已经在check_pc28_win函数中正确实现，无需修改

-- 2. 创建close_pc28_game函数（结束游戏并退款）
CREATE OR REPLACE FUNCTION public.close_pc28_game(
    p_room_id UUID
) RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_config RECORD;
    v_round RECORD;
    v_bet RECORD;
    v_refund_count INT := 0;
    v_total_refund NUMERIC := 0;
    v_user_balance NUMERIC;
    v_final_user_balance NUMERIC;
    v_message_text TEXT;
BEGIN
    -- 1. 验证房间存在且用户是主播
    SELECT * INTO v_config
    FROM public.pc28_game_configs
    WHERE room_id = p_room_id;
    
    IF v_config IS NULL THEN
        RETURN json_build_object('success', false, 'message', '游戏配置不存在');
    END IF;
    
    -- 检查是否是主播
    IF v_config.anchor_id != auth.uid() THEN
        RETURN json_build_object('success', false, 'message', '只有主播可以结束游戏');
    END IF;
    
    -- 2. 查找所有未结算的round（betting或sealed状态）
    FOR v_round IN 
        SELECT * FROM public.pc28_game_rounds
        WHERE room_id = p_room_id 
        AND status IN ('betting', 'sealed')
        ORDER BY created_at DESC
    LOOP
        -- 3. 退款所有pending状态的bets
        FOR v_bet IN 
            SELECT * FROM public.pc28_bets
            WHERE round_id = v_round.id 
            AND status = 'pending'
        LOOP
            -- 获取用户当前余额
            SELECT balance_coins INTO v_user_balance
            FROM public.profiles
            WHERE id = v_bet.user_id;
            
            IF v_user_balance IS NULL THEN
                v_user_balance := 0;
            END IF;
            
            -- 退款给用户
            UPDATE public.profiles
            SET balance_coins = balance_coins + v_bet.amount
            WHERE id = v_bet.user_id
            RETURNING balance_coins INTO v_final_user_balance;
            
            -- 记录退款流水
            INSERT INTO public.coin_transactions (
                user_id, amount, balance_after, type, description, related_id
            ) VALUES (
                v_bet.user_id,
                v_bet.amount,
                v_final_user_balance,
                'pc28_refund',
                format('PC28游戏结束退款：%s期', v_round.period_number),
                v_bet.id
            );
            
            -- 更新bet状态为settled（退款）
            UPDATE public.pc28_bets SET
                status = 'settled',
                is_win = true,
                payout = v_bet.amount,
                user_gain = 0,
                platform_fee = 0,
                anchor_payout = 0,
                settled_at = now()
            WHERE id = v_bet.id;
            
            v_refund_count := v_refund_count + 1;
            v_total_refund := v_total_refund + v_bet.amount;
        END LOOP;
        
        -- 4. 更新round状态为settled
        UPDATE public.pc28_game_rounds SET
            status = 'settled',
            settled_at = now(),
            updated_at = now()
        WHERE id = v_round.id;
        
        -- 5. 推送消息到直播间
        v_message_text := format('游戏已结束，%s期已退款', v_round.period_number);
        INSERT INTO public.live_broadcast_messages (
            room_id, user_id, content, msg_type
        ) VALUES (
            p_room_id,
            v_config.anchor_id,
            json_build_object('text', v_message_text)::text,
            'pc28'
        );
    END LOOP;
    
    -- 6. 关闭游戏配置
    UPDATE public.pc28_game_configs SET
        is_enabled = false,
        updated_at = now()
    WHERE room_id = p_room_id;
    
    -- 7. 返回结果
    IF v_refund_count > 0 THEN
        RETURN json_build_object(
            'success', true,
            'message', format('游戏已结束，已退还 %s 抖币给 %s 位用户', v_total_refund, v_refund_count),
            'refund_count', v_refund_count,
            'total_refund', v_total_refund
        );
    ELSE
        RETURN json_build_object(
            'success', true,
            'message', '游戏已结束',
            'refund_count', 0,
            'total_refund', 0
        );
    END IF;
END;
$$;

-- 授权
GRANT EXECUTE ON FUNCTION public.close_pc28_game(UUID) TO authenticated;
