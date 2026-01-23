-- 加拿大PC28游戏 RPC 函数

-- 1. 开盘函数（主播开盘）
CREATE OR REPLACE FUNCTION public.open_pc28_round(
    p_room_id UUID,
    p_period_number TEXT,
    p_seal_at TIMESTAMP WITH TIME ZONE DEFAULT NULL::TIMESTAMP WITH TIME ZONE
) RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_room RECORD;
    v_anchor_balance NUMERIC;
    v_round_id UUID;
BEGIN
    -- 1. 验证房间存在且用户是主播
    SELECT r.*, r.anchor_id INTO v_room
    FROM public.live_broadcast_rooms r
    WHERE r.id = p_room_id;
    
    IF v_room IS NULL THEN
        RETURN json_build_object('success', false, 'message', '直播间不存在');
    END IF;
    
    IF v_room.anchor_id != auth.uid() THEN
        RETURN json_build_object('success', false, 'message', '只有主播可以开盘');
    END IF;
    
    -- 2. 检查主播余额（必须>=5000）
    SELECT balance_coins INTO v_anchor_balance
    FROM public.profiles
    WHERE id = v_room.anchor_id;
    
    IF v_anchor_balance IS NULL OR v_anchor_balance < 5000 THEN
        RETURN json_build_object('success', false, 'message', '主播余额不足5000，无法开盘');
    END IF;
    
    -- 3. 检查是否已有该期号的记录
    IF EXISTS (
        SELECT 1 FROM public.pc28_game_rounds
        WHERE room_id = p_room_id AND period_number = p_period_number
    ) THEN
        RETURN json_build_object('success', false, 'message', '该期号已存在');
    END IF;
    
    -- 4. 创建期数记录
    INSERT INTO public.pc28_game_rounds (
        room_id,
        anchor_id,
        period_number,
        status,
        seal_at
    ) VALUES (
        p_room_id,
        v_room.anchor_id,
        p_period_number,
        'betting',
        p_seal_at
    ) RETURNING id INTO v_round_id;
    
    RETURN json_build_object(
        'success', true,
        'round_id', v_round_id,
        'message', '开盘成功'
    );
END;
$$;

-- 2. 下注函数（玩家下注）
CREATE OR REPLACE FUNCTION public.place_pc28_bet(
    p_round_id UUID,
    p_bet_type TEXT,
    p_amount NUMERIC,
    p_bet_value INT DEFAULT NULL
) RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_round RECORD;
    v_config RECORD;
    v_user_balance NUMERIC;
    v_odds NUMERIC;
    v_bet_id UUID;
    v_final_balance NUMERIC;
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
    
    -- 5. 扣除用户余额
    UPDATE public.profiles
    SET balance_coins = balance_coins - p_amount
    WHERE id = auth.uid()
    RETURNING balance_coins INTO v_final_balance;
    
    -- 6. 记录资金流水（下注支出）
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
    
    RETURN json_build_object(
        'success', true,
        'bet_id', v_bet_id,
        'message', '下注成功'
    );
END;
$$;

-- 3. 辅助函数：判断是否中奖
CREATE OR REPLACE FUNCTION public.check_pc28_win(
    p_result JSONB,
    p_bet_type TEXT,
    p_bet_value INT DEFAULT NULL
) RETURNS BOOLEAN
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
    v_num1 INT;
    v_num2 INT;
    v_num3 INT;
    v_sum INT;
    v_sorted_nums INT[];
BEGIN
    -- 提取结果
    v_num1 := (p_result->>'num1')::int;
    v_num2 := (p_result->>'num2')::int;
    v_num3 := (p_result->>'num3')::int;
    v_sum := (p_result->>'sum')::int;
    
    -- 排序后的数字（用于判断顺子）
    v_sorted_nums := ARRAY[v_num1, v_num2, v_num3];
    SELECT ARRAY(SELECT unnest(v_sorted_nums) ORDER BY 1) INTO v_sorted_nums;
    
    -- 判断各种玩法
    IF p_bet_type = 'big' THEN
        RETURN v_sum >= 14;
    ELSIF p_bet_type = 'small' THEN
        RETURN v_sum <= 13;
    ELSIF p_bet_type = 'odd' THEN
        RETURN v_sum % 2 = 1;
    ELSIF p_bet_type = 'even' THEN
        RETURN v_sum % 2 = 0;
    ELSIF p_bet_type = 'big_odd' THEN
        RETURN v_sum >= 14 AND v_sum % 2 = 1;
    ELSIF p_bet_type = 'big_even' THEN
        RETURN v_sum >= 14 AND v_sum % 2 = 0;
    ELSIF p_bet_type = 'small_odd' THEN
        RETURN v_sum <= 13 AND v_sum % 2 = 1;
    ELSIF p_bet_type = 'small_even' THEN
        RETURN v_sum <= 13 AND v_sum % 2 = 0;
    ELSIF p_bet_type = 'extreme_big' THEN
        RETURN v_sum >= 22;
    ELSIF p_bet_type = 'extreme_small' THEN
        RETURN v_sum <= 5;
    ELSIF p_bet_type = 'leopard' THEN
        RETURN v_num1 = v_num2 AND v_num2 = v_num3;
    ELSIF p_bet_type = 'pair' THEN
        -- 对子：有两个数字相同（但不是豹子）
        RETURN (v_num1 = v_num2 OR v_num1 = v_num3 OR v_num2 = v_num3) 
               AND NOT (v_num1 = v_num2 AND v_num2 = v_num3);
    ELSIF p_bet_type = 'straight' THEN
        -- 顺子：三个数字连续（如123, 234等）
        RETURN (v_sorted_nums[2] = v_sorted_nums[1] + 1 AND v_sorted_nums[3] = v_sorted_nums[2] + 1);
    ELSIF p_bet_type = 'single_point' THEN
        RETURN v_sum = p_bet_value;
    END IF;
    
    RETURN false;
END;
$$;

-- 4. 结算函数（主播输入结果后结算）
CREATE OR REPLACE FUNCTION public.settle_pc28_round(
    p_round_id UUID,
    p_num1 INT,
    p_num2 INT,
    p_num3 INT
) RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
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
BEGIN
    -- 1. 验证期数存在且状态为betting或sealed
    SELECT * INTO v_round
    FROM public.pc28_game_rounds
    WHERE id = p_round_id
    FOR UPDATE;
    
    IF v_round IS NULL THEN
        RETURN json_build_object('success', false, 'message', '期数不存在');
    END IF;
    
    IF v_round.status = 'settled' THEN
        RETURN json_build_object('success', false, 'message', '该期已结算');
    END IF;
    
    -- 验证用户是主播
    IF v_round.anchor_id != auth.uid() THEN
        RETURN json_build_object('success', false, 'message', '只有主播可以结算');
    END IF;
    
    -- 2. 验证结果有效性
    IF p_num1 < 0 OR p_num1 > 9 OR p_num2 < 0 OR p_num2 > 9 OR p_num3 < 0 OR p_num3 > 9 THEN
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
            -- 计算奖金
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
            
            -- 增加用户余额
            UPDATE public.profiles
            SET balance_coins = balance_coins + v_user_gain
            WHERE id = v_bet.user_id
            RETURNING balance_coins INTO v_final_user_balance;
            
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
    
    RETURN json_build_object(
        'success', true,
        'message', '结算成功',
        'total_bet_amount', v_total_bet_amount,
        'total_payout', v_total_payout,
        'total_platform_fee', v_total_platform_fee
    );
END;
$$;

-- 5. 授权
GRANT EXECUTE ON FUNCTION public.open_pc28_round(UUID, TEXT, TIMESTAMP WITH TIME ZONE) TO authenticated;
GRANT EXECUTE ON FUNCTION public.place_pc28_bet(UUID, TEXT, INT, NUMERIC) TO authenticated;
GRANT EXECUTE ON FUNCTION public.settle_pc28_round(UUID, INT, INT, INT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.check_pc28_win(JSONB, TEXT, INT) TO authenticated;
