-- 🎯 修改骰子游戏结算逻辑：2人平局时不抽水
-- 当只有2个玩家且平局时，不扣除抽水，全额退回

CREATE OR REPLACE FUNCTION public.settle_dice_room(
    p_room_id UUID,
    p_roll_results TEXT -- JSON 字符串，格式: [{"user_id": "...", "value": 5}, ...]
) RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_room RECORD;
    v_player RECORD;
    v_max_value INT := 0;
    v_winners UUID[] := ARRAY[]::UUID[];
    v_total_prize NUMERIC;
    v_commission NUMERIC;
    v_net_prize NUMERIC;
    v_per_winner_prize NUMERIC;
    v_final_balance NUMERIC;
    v_result JSONB;
    v_roll_results_jsonb JSONB;
    v_winner_count INT;
BEGIN
    -- 🎯 解析 JSON 字符串
    v_roll_results_jsonb := p_roll_results::JSONB;
    
    -- 🎯 锁定并获取房间信息
    SELECT * INTO v_room
    FROM public.dice_rooms
    WHERE id = p_room_id FOR UPDATE;
    
    IF NOT FOUND THEN
        RETURN json_build_object('success', false, 'message', '房间不存在');
    END IF;
    
    IF v_room.status != 'waiting' THEN
        RETURN json_build_object('success', false, 'message', '房间状态不正确');
    END IF;
    
    -- 🎯 更新玩家结果并找出最大值
    FOR v_result IN SELECT * FROM jsonb_array_elements(v_roll_results_jsonb)
    LOOP
        UPDATE public.dice_room_players
        SET roll_result = (v_result->>'value')::INT
        WHERE room_id = p_room_id 
          AND user_id = (v_result->>'user_id')::UUID;
        
        IF (v_result->>'value')::INT > v_max_value THEN
            v_max_value := (v_result->>'value')::INT;
        END IF;
    END LOOP;
    
    -- 🎯 重新获取最大值（确保准确）
    SELECT MAX(roll_result) INTO v_max_value
    FROM public.dice_room_players
    WHERE room_id = p_room_id;
    
    -- 🎯 找出所有赢家
    SELECT ARRAY_AGG(user_id) INTO v_winners
    FROM public.dice_room_players
    WHERE room_id = p_room_id AND roll_result = v_max_value;
    
    -- 🎯 计算赢家数量
    v_winner_count := array_length(v_winners, 1);
    
    -- 🎯 计算奖金
    v_total_prize := v_room.bet_amount * v_room.target_count;
    
    -- 🎯 🔥 2人平局时不抽水，其他情况抽水2%
    IF v_winner_count = 2 AND v_room.target_count = 2 THEN
        -- 2人平局：不抽水，全额退回
        v_commission := 0;
        v_net_prize := v_total_prize;
    ELSE
        -- 其他情况：抽水2%
        v_commission := FLOOR(v_total_prize * 0.02 * 100) / 100;
        v_net_prize := v_total_prize - v_commission;
    END IF;
    
    v_per_winner_prize := FLOOR((v_net_prize / v_winner_count) * 100) / 100;
    
    -- 🎯 发放奖励给赢家
    FOR v_player IN SELECT user_id FROM public.dice_room_players WHERE room_id = p_room_id AND user_id = ANY(v_winners)
    LOOP
        UPDATE public.profiles
        SET balance_coins = balance_coins + v_per_winner_prize
        WHERE id = v_player.user_id
        RETURNING balance_coins INTO v_final_balance;
        
        UPDATE public.dice_room_players
        SET is_winner = TRUE
        WHERE room_id = p_room_id AND user_id = v_player.user_id;
        
        INSERT INTO public.coin_transactions (user_id, amount, balance_after, type, description, related_id)
        VALUES (v_player.user_id, v_per_winner_prize, v_final_balance, 'dice_reward', '骰子游戏获胜', p_room_id);
    END LOOP;
    
    -- 🎯 更新房间状态
    UPDATE public.dice_rooms
    SET status = 'finished',
        winner_ids = v_winners,
        total_prize = v_total_prize
    WHERE id = p_room_id;
    
    RETURN json_build_object(
        'success', true,
        'winners', v_winners,
        'max_value', v_max_value,
        'total_prize', v_total_prize,
        'commission', v_commission,
        'per_winner_prize', v_per_winner_prize,
        'is_draw_no_commission', (v_winner_count = 2 AND v_room.target_count = 2) -- 🔥 标记是否为2人平局不抽水
    );
END;
$$;
