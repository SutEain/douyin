-- 🎯 PC28新规则：用户和平台对赌，平台统一管理赔率
-- 1. 用户和平台对赌（不再是和主播对赌）
-- 2. 平台抽用户盈利的1%
-- 3. 主播抽下注额的1%（平台支付给主播）
-- 4. 实现特殊规则：13/14时大小单双赔1.6倍，组合小单大双回本
-- 5. 更新赔率配置：组合4.6倍，点杀倍数更新

-- ============================================================================
-- 1. 创建平台统一赔率配置函数（替代主播配置）
-- ============================================================================
CREATE OR REPLACE FUNCTION public.get_pc28_platform_odds(
    p_bet_type TEXT,
    p_bet_value INT DEFAULT 0
) RETURNS NUMERIC
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
    v_odds NUMERIC;
BEGIN
    -- 平台统一赔率配置
    IF p_bet_type = 'big' OR p_bet_type = 'small' THEN
        v_odds := 2.0;
    ELSIF p_bet_type = 'odd' OR p_bet_type = 'even' THEN
        v_odds := 2.0;
    ELSIF p_bet_type = 'big_odd' OR p_bet_type = 'big_even' OR 
          p_bet_type = 'small_odd' OR p_bet_type = 'small_even' THEN
        v_odds := 4.6; -- 所有组合都是4.6倍
    ELSIF p_bet_type = 'extreme_big' OR p_bet_type = 'extreme_small' THEN
        v_odds := 15.0;
    ELSIF p_bet_type = 'pair' THEN
        v_odds := 3.4;
    ELSIF p_bet_type = 'straight' THEN
        v_odds := 15.0;
    ELSIF p_bet_type = 'leopard' THEN
        v_odds := 80.0;
    ELSIF p_bet_type = 'single_point' THEN
        -- 点杀倍数
        CASE p_bet_value
            WHEN 0, 27 THEN v_odds := 888.0;
            WHEN 1, 26 THEN v_odds := 222.0;
            WHEN 2, 25 THEN v_odds := 123.0;
            WHEN 3, 24 THEN v_odds := 80.0;
            WHEN 4, 23 THEN v_odds := 48.0;
            WHEN 5, 22 THEN v_odds := 38.0;
            WHEN 6, 21 THEN v_odds := 28.0;
            WHEN 7, 20 THEN v_odds := 22.0;
            WHEN 8, 19 THEN v_odds := 18.0;
            WHEN 9, 18 THEN v_odds := 15.0;
            WHEN 10, 17 THEN v_odds := 14.0;
            WHEN 11, 16 THEN v_odds := 13.0;
            WHEN 12, 15 THEN v_odds := 12.0;
            WHEN 13, 14 THEN v_odds := 11.0;
            ELSE v_odds := NULL;
        END CASE;
    ELSE
        v_odds := NULL;
    END IF;
    
    RETURN v_odds;
END;
$$;

COMMENT ON FUNCTION public.get_pc28_platform_odds IS '平台统一PC28赔率配置函数';

-- ============================================================================
-- 2. 修改下注函数：使用平台统一赔率
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
    
    -- 2. 验证下注金额
    IF p_amount IS NULL OR p_amount <= 0 OR p_amount > 2000 THEN
        RETURN json_build_object('success', false, 'message', '下注金额必须在1-2000之间');
    END IF;
    
    -- 3. 获取平台统一赔率（不再使用主播配置）
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

-- ============================================================================
-- 3. 修改结算函数：实现新规则和抽水逻辑
-- ============================================================================
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
    v_user_profit NUMERIC; -- 用户盈利
    v_platform_fee NUMERIC; -- 平台抽成（用户盈利的1%）
    v_user_gain NUMERIC; -- 用户实际获得
    v_anchor_commission NUMERIC; -- 主播抽水（下注额的1%）
    v_total_payout NUMERIC := 0;
    v_total_platform_fee NUMERIC := 0;
    v_total_bet_amount NUMERIC := 0;
    v_total_anchor_commission NUMERIC := 0;
    v_user_balance NUMERIC;
    v_final_user_balance NUMERIC;
    v_anchor_balance NUMERIC;
    v_final_anchor_balance NUMERIC;
    v_is_win BOOLEAN;
    v_actual_odds NUMERIC; -- 实际赔率（考虑特殊规则）
    v_message_text TEXT;
    v_message_content JSONB;
    v_is_special_case BOOLEAN; -- 是否是13/14特殊情况
    v_is_combination_refund BOOLEAN; -- 是否是组合回本情况
BEGIN
    -- 🎯 设置会话变量，允许修改用户余额
    PERFORM set_config('app.pc28_settlement', 'true', false);
    
    -- 1. 验证期数存在且状态为betting或sealed
    SELECT * INTO v_round
    FROM public.pc28_game_rounds
    WHERE id = p_round_id
    FOR UPDATE;
    
    IF v_round IS NULL THEN
        PERFORM set_config('app.pc28_settlement', 'false', false);
        RETURN json_build_object('success', false, 'message', '期数不存在');
    END IF;
    
    IF v_round.status NOT IN ('betting', 'sealed') THEN
        PERFORM set_config('app.pc28_settlement', 'false', false);
        RETURN json_build_object('success', false, 'message', '该期已结算');
    END IF;
    
    -- 验证用户是主播
    IF v_round.anchor_id != auth.uid() THEN
        PERFORM set_config('app.pc28_settlement', 'false', false);
        RETURN json_build_object('success', false, 'message', '只有主播可以结算');
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
    
    -- 6. 锁定主播余额（用于支付主播抽水）
    SELECT balance_coins INTO v_anchor_balance
    FROM public.profiles
    WHERE id = v_round.anchor_id
    FOR UPDATE;
    
    -- 7. 遍历所有下注记录，结算
    FOR v_bet IN 
        SELECT * FROM public.pc28_bets
        WHERE round_id = p_round_id AND status = 'pending'
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
                -- 13 = 小单，回本（1倍）
                v_is_win := true;
                v_actual_odds := 1.0;
                v_is_combination_refund := true;
            ELSIF v_sum = 14 AND v_bet.bet_type = 'big_even' THEN
                -- 14 = 大双，回本（1倍）
                v_is_win := true;
                v_actual_odds := 1.0;
                v_is_combination_refund := true;
            ELSIF v_bet.bet_type IN ('big_odd', 'big_even', 'small_odd', 'small_even') THEN
                -- 其他组合被吃掉（不中奖）
                v_is_win := false;
            END IF;
        END IF;
        
        IF v_is_win THEN
            -- 计算奖金（使用实际赔率）
            v_payout := v_bet.amount * v_actual_odds;
            
            -- 🎯 新抽水规则：平台抽用户盈利的1%
            -- 用户盈利 = 奖金 - 下注金额
            v_user_profit := v_payout - v_bet.amount;
            v_platform_fee := GREATEST(v_user_profit * 0.01, 0); -- 确保不为负数
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
            
            -- 检查是否成功更新
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
                anchor_payout = 0, -- 主播不再支付奖金
                settled_at = now()
            WHERE id = v_bet.id;
        ELSE
            -- 未中奖：平台获得下注金额（用户下注时已扣除，这里不需要操作）
            -- 更新下注记录
            UPDATE public.pc28_bets SET
                status = 'settled',
                is_win = false,
                payout = 0,
                platform_fee = 0,
                user_gain = 0,
                anchor_payout = 0, -- 主播不再获得未中奖下注
                settled_at = now()
            WHERE id = v_bet.id;
        END IF;
    END LOOP;
    
    -- 8. 🎯 主播抽水：从所有下注金额中抽取1%给主播（平台支付）
    v_total_anchor_commission := v_total_bet_amount * 0.01;
    
    IF v_total_anchor_commission > 0 THEN
        UPDATE public.profiles
        SET balance_coins = balance_coins + v_total_anchor_commission
        WHERE id = v_round.anchor_id
        RETURNING balance_coins INTO v_final_anchor_balance;
        
        -- 记录主播资金流水（平台支付的抽水）
        INSERT INTO public.coin_transactions (
            user_id, amount, balance_after, type, description, related_id
        ) VALUES (
            v_round.anchor_id,
            v_total_anchor_commission,
            v_final_anchor_balance,
            'pc28_bet_income',
            format('PC28游戏抽水：%s期（下注额1%%）', v_round.period_number),
            p_round_id
        );
    END IF;
    
    -- 9. 更新期数记录
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
        'total_platform_fee', v_total_platform_fee,
        'total_anchor_commission', v_total_anchor_commission
    );
EXCEPTION
    WHEN OTHERS THEN
        -- 🎯 确保重置会话变量
        PERFORM set_config('app.pc28_settlement', 'false', false);
        RAISE;
END;
$$;

COMMENT ON FUNCTION public.settle_pc28_round IS '🎯 新规则：用户和平台对赌，平台抽用户盈利1%，主播抽下注额1%';

-- ============================================================================
-- 4. 更新现有配置：组合赔率都改为4.6倍
-- ============================================================================
UPDATE public.pc28_game_configs
SET game_settings = jsonb_set(
    jsonb_set(
        jsonb_set(
            jsonb_set(
                game_settings,
                '{combinations,big_odd}',
                '4.6'::jsonb
            ),
            '{combinations,big_even}',
            '4.6'::jsonb
        ),
        '{combinations,small_odd}',
        '4.6'::jsonb
    ),
    '{combinations,small_even}',
    '4.6'::jsonb
),
updated_at = now()
WHERE game_settings->'combinations'->>'enabled' = 'true';

-- ============================================================================
-- 5. 更新默认配置：组合赔率4.6倍，点杀倍数更新
-- ============================================================================
ALTER TABLE public.pc28_game_configs
ALTER COLUMN game_settings SET DEFAULT '{
    "big_small": {"enabled": true, "big": 2.0, "small": 2.0},
    "odd_even": {"enabled": true, "odd": 2.0, "even": 2.0},
    "combinations": {"enabled": true, "big_odd": 4.6, "big_even": 4.6, "small_odd": 4.6, "small_even": 4.6},
    "extreme": {"enabled": true, "extreme_big": 15, "extreme_small": 15},
    "patterns": {"enabled": true, "pair": 3.4, "straight": 15, "leopard": 80},
    "single_point": {"enabled": true, "odds": {"0": 888, "27": 888, "1": 222, "26": 222, "2": 123, "25": 123, "3": 80, "24": 80, "4": 48, "23": 48, "5": 38, "22": 38, "6": 28, "21": 28, "7": 22, "20": 22, "8": 18, "19": 18, "9": 15, "18": 15, "10": 14, "17": 14, "11": 13, "16": 13, "12": 12, "15": 12, "13": 11, "14": 11}}
}'::jsonb;
