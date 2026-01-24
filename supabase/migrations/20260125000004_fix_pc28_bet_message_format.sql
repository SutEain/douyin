-- 修复PC28下注推送消息格式，显示用户名和下注金额

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
    -- 1. 验证期数存在且状态为betting
    SELECT * INTO v_round
    FROM public.pc28_game_rounds
    WHERE id = p_round_id;
    
    IF v_round IS NULL THEN
        RETURN json_build_object('success', false, 'message', '期数不存在');
    END IF;
    
    IF v_round.status != 'betting' THEN
        RETURN json_build_object('success', false, 'message', '该期已封盘或已结算');
    END IF;
    
    -- 检查是否已封盘
    IF v_round.seal_at IS NOT NULL AND now() >= v_round.seal_at THEN
        -- 自动更新状态为sealed
        UPDATE public.pc28_game_rounds SET status = 'sealed' WHERE id = p_round_id;
        RETURN json_build_object('success', false, 'message', '该期已封盘');
    END IF;
    
    -- 2. 获取游戏配置
    SELECT * INTO v_config
    FROM public.pc28_game_configs
    WHERE room_id = v_round.room_id;
    
    IF v_config IS NULL OR NOT v_config.is_enabled THEN
        RETURN json_build_object('success', false, 'message', '游戏未开启');
    END IF;
    
    -- 3. 验证下注类型和获取赔率
    v_odds := NULL;
    
    IF p_bet_type = 'big' THEN
        IF NOT (v_config.game_settings->'big_small'->>'enabled')::boolean THEN
            RETURN json_build_object('success', false, 'message', '该玩法已关闭');
        END IF;
        v_odds := (v_config.game_settings->'big_small'->>'big')::numeric;
    ELSIF p_bet_type = 'small' THEN
        IF NOT (v_config.game_settings->'big_small'->>'enabled')::boolean THEN
            RETURN json_build_object('success', false, 'message', '该玩法已关闭');
        END IF;
        v_odds := (v_config.game_settings->'big_small'->>'small')::numeric;
    ELSIF p_bet_type = 'odd' THEN
        IF NOT (v_config.game_settings->'odd_even'->>'enabled')::boolean THEN
            RETURN json_build_object('success', false, 'message', '该玩法已关闭');
        END IF;
        v_odds := (v_config.game_settings->'odd_even'->>'odd')::numeric;
    ELSIF p_bet_type = 'even' THEN
        IF NOT (v_config.game_settings->'odd_even'->>'enabled')::boolean THEN
            RETURN json_build_object('success', false, 'message', '该玩法已关闭');
        END IF;
        v_odds := (v_config.game_settings->'odd_even'->>'even')::numeric;
    ELSIF p_bet_type = 'big_odd' THEN
        IF NOT (v_config.game_settings->'combinations'->>'enabled')::boolean THEN
            RETURN json_build_object('success', false, 'message', '该玩法已关闭');
        END IF;
        v_odds := (v_config.game_settings->'combinations'->>'big_odd')::numeric;
    ELSIF p_bet_type = 'big_even' THEN
        IF NOT (v_config.game_settings->'combinations'->>'enabled')::boolean THEN
            RETURN json_build_object('success', false, 'message', '该玩法已关闭');
        END IF;
        v_odds := (v_config.game_settings->'combinations'->>'big_even')::numeric;
    ELSIF p_bet_type = 'small_odd' THEN
        IF NOT (v_config.game_settings->'combinations'->>'enabled')::boolean THEN
            RETURN json_build_object('success', false, 'message', '该玩法已关闭');
        END IF;
        v_odds := (v_config.game_settings->'combinations'->>'small_odd')::numeric;
    ELSIF p_bet_type = 'small_even' THEN
        IF NOT (v_config.game_settings->'combinations'->>'enabled')::boolean THEN
            RETURN json_build_object('success', false, 'message', '该玩法已关闭');
        END IF;
        v_odds := (v_config.game_settings->'combinations'->>'small_even')::numeric;
    ELSIF p_bet_type = 'extreme_big' THEN
        IF NOT (v_config.game_settings->'extreme'->>'enabled')::boolean THEN
            RETURN json_build_object('success', false, 'message', '该玩法已关闭');
        END IF;
        v_odds := (v_config.game_settings->'extreme'->>'extreme_big')::numeric;
    ELSIF p_bet_type = 'extreme_small' THEN
        IF NOT (v_config.game_settings->'extreme'->>'enabled')::boolean THEN
            RETURN json_build_object('success', false, 'message', '该玩法已关闭');
        END IF;
        v_odds := (v_config.game_settings->'extreme'->>'extreme_small')::numeric;
    ELSIF p_bet_type = 'pair' THEN
        IF NOT (v_config.game_settings->'patterns'->>'enabled')::boolean THEN
            RETURN json_build_object('success', false, 'message', '该玩法已关闭');
        END IF;
        v_odds := (v_config.game_settings->'patterns'->>'pair')::numeric;
    ELSIF p_bet_type = 'straight' THEN
        IF NOT (v_config.game_settings->'patterns'->>'enabled')::boolean THEN
            RETURN json_build_object('success', false, 'message', '该玩法已关闭');
        END IF;
        v_odds := (v_config.game_settings->'patterns'->>'straight')::numeric;
    ELSIF p_bet_type = 'leopard' THEN
        IF NOT (v_config.game_settings->'patterns'->>'enabled')::boolean THEN
            RETURN json_build_object('success', false, 'message', '该玩法已关闭');
        END IF;
        v_odds := (v_config.game_settings->'patterns'->>'leopard')::numeric;
    ELSIF p_bet_type = 'single_point' THEN
        IF NOT (v_config.game_settings->'single_point'->>'enabled')::boolean THEN
            RETURN json_build_object('success', false, 'message', '该玩法已关闭');
        END IF;
        IF p_bet_value IS NULL OR p_bet_value < 0 OR p_bet_value > 27 THEN
            RETURN json_build_object('success', false, 'message', '点数必须在0-27之间');
        END IF;
        v_odds := (v_config.game_settings->'single_point'->'odds'->>p_bet_value::text)::numeric;
        IF v_odds IS NULL THEN
            RETURN json_build_object('success', false, 'message', '该点数未配置赔率');
        END IF;
    ELSE
        RETURN json_build_object('success', false, 'message', '无效的下注类型');
    END IF;
    
    IF v_odds IS NULL THEN
        RETURN json_build_object('success', false, 'message', '赔率配置错误');
    END IF;
    
    -- 4. 检查用户余额
    SELECT balance_coins INTO v_user_balance
    FROM public.profiles
    WHERE id = auth.uid()
    FOR UPDATE;
    
    IF v_user_balance IS NULL OR v_user_balance < p_amount THEN
        RETURN json_build_object('success', false, 'message', '余额不足');
    END IF;
    
    -- 5. 扣除用户余额并获取用户昵称
    UPDATE public.profiles
    SET balance_coins = balance_coins - p_amount
    WHERE id = auth.uid()
    RETURNING balance_coins, nickname INTO v_final_balance, v_user_nickname;
    
    -- 如果没有昵称，使用默认值
    IF v_user_nickname IS NULL OR v_user_nickname = '' THEN
        v_user_nickname := '用户';
    END IF;
    
    -- 6. 记录资金流水（下注支出）- 添加期号
    INSERT INTO public.coin_transactions (
        user_id, amount, balance_after, type, description, related_id
    ) VALUES (
        auth.uid(),
        -p_amount,
        v_final_balance,
        'pc28_bet',
        format('PC28游戏下注：%s期', v_round.period_number),
        p_round_id
    );
    
    -- 7. 创建下注记录
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
    
    -- 8. 推送消息到直播间（显示用户名和下注金额）
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

GRANT EXECUTE ON FUNCTION public.place_pc28_bet(UUID, TEXT, NUMERIC, INT) TO authenticated;
