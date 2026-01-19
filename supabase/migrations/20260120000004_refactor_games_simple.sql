-- 🎯 游戏系统完全重构：简洁、现代、清晰
-- 原则：删除所有 cron、触发器，简化状态，超时检查在用户操作时进行

-- ============================================================================
-- 第一部分：删除旧的 cron 任务和复杂函数
-- ============================================================================

-- 1. 删除所有游戏相关的 cron 任务
DO $$
DECLARE
    v_job_id BIGINT;
BEGIN
    -- 删除骰子游戏超时检查任务
    SELECT jobid INTO v_job_id FROM cron.job WHERE jobname = 'refund-expired-dice-rooms-job';
    IF v_job_id IS NOT NULL THEN
        PERFORM cron.unschedule(v_job_id);
    END IF;
    
    -- 删除猜拳游戏超时检查任务
    SELECT jobid INTO v_job_id FROM cron.job WHERE jobname = 'check-rps-timeout-job';
    IF v_job_id IS NOT NULL THEN
        PERFORM cron.unschedule(v_job_id);
    END IF;
END $$;

-- 2. 删除旧的超时检查函数（不再需要）
DROP FUNCTION IF EXISTS public.check_and_refund_expired_dice_rooms();
DROP FUNCTION IF EXISTS public.refund_expired_dice_rooms();
DROP FUNCTION IF EXISTS public.check_rps_timeout();

-- ============================================================================
-- 第二部分：创建新的简化表结构
-- ============================================================================

-- 3. 创建新的骰子游戏表（简化版）
DROP TABLE IF EXISTS public.dice_rooms_new CASCADE;
CREATE TABLE public.dice_rooms_new (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_id UUID NOT NULL REFERENCES public.profiles(id),
    group_id BIGINT NOT NULL,
    bet_amount NUMERIC NOT NULL CHECK (bet_amount >= 5 AND bet_amount <= 10000),
    target_count INT NOT NULL DEFAULT 2 CHECK (target_count >= 2 AND target_count <= 5),
    current_count INT NOT NULL DEFAULT 1,
    status TEXT DEFAULT 'waiting' CHECK (status IN ('waiting', 'finished', 'cancelled')),
    winner_ids UUID[],
    total_prize NUMERIC DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW()
    -- 🎯 简化：只保留 created_at，超时检查基于此
    -- 🎯 约束：一个群组同时只能有一个 waiting 房间（通过函数逻辑保证）
);

-- 4. 创建新的骰子游戏玩家表（简化版）
DROP TABLE IF EXISTS public.dice_room_players_new CASCADE;
CREATE TABLE public.dice_room_players_new (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    room_id UUID NOT NULL REFERENCES public.dice_rooms_new(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES public.profiles(id),
    roll_result INT CHECK (roll_result >= 1 AND roll_result <= 6),
    is_winner BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(room_id, user_id)
);

-- 5. 创建新的猜拳游戏表（简化版）
DROP TABLE IF EXISTS public.rps_rooms_new CASCADE;
CREATE TABLE public.rps_rooms_new (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_id UUID NOT NULL REFERENCES public.profiles(id),
    opponent_id UUID REFERENCES public.profiles(id),
    group_id BIGINT NOT NULL,
    bet_amount NUMERIC NOT NULL CHECK (bet_amount >= 5 AND bet_amount <= 10000),
    owner_choice TEXT CHECK (owner_choice IN ('rock', 'paper', 'scissors')),
    opponent_choice TEXT CHECK (opponent_choice IN ('rock', 'paper', 'scissors')),
    winner_id UUID REFERENCES public.profiles(id),
    status TEXT DEFAULT 'waiting' CHECK (status IN ('waiting', 'finished', 'cancelled')),
    total_prize NUMERIC DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW()
    -- 🎯 约束：一个群组同时只能有一个 waiting 房间（通过函数逻辑保证）
);

-- 6. 创建索引
CREATE INDEX IF NOT EXISTS idx_dice_rooms_new_group_status ON public.dice_rooms_new(group_id, status);
CREATE INDEX IF NOT EXISTS idx_dice_rooms_new_status ON public.dice_rooms_new(status);
CREATE INDEX IF NOT EXISTS idx_dice_room_players_new_room ON public.dice_room_players_new(room_id);
CREATE INDEX IF NOT EXISTS idx_rps_rooms_new_group_status ON public.rps_rooms_new(group_id, status);
CREATE INDEX IF NOT EXISTS idx_rps_rooms_new_status ON public.rps_rooms_new(status);

-- 🎯 部分唯一索引：一个群组同时只能有一个 waiting 房间
CREATE UNIQUE INDEX IF NOT EXISTS idx_dice_rooms_new_unique_waiting 
ON public.dice_rooms_new(group_id) 
WHERE status = 'waiting';

CREATE UNIQUE INDEX IF NOT EXISTS idx_rps_rooms_new_unique_waiting 
ON public.rps_rooms_new(group_id) 
WHERE status = 'waiting';

-- ============================================================================
-- 第三部分：创建新的 RPC 函数（原子操作，简洁清晰）
-- ============================================================================

-- 7. 骰子游戏：创建房间（原子操作）
CREATE OR REPLACE FUNCTION public.create_dice_room_v2(
    p_owner_id UUID,
    p_group_id BIGINT,
    p_bet_amount NUMERIC,
    p_target_count INT
) RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_current_balance NUMERIC;
    v_room_id UUID;
    v_final_balance NUMERIC;
    v_existing_room UUID;
BEGIN
    -- 🎯 超时检查：检查是否有超时的 waiting 房间
    SELECT id INTO v_existing_room
    FROM public.dice_rooms_new
    WHERE group_id = p_group_id 
      AND status = 'waiting'
      AND created_at < NOW() - INTERVAL '30 seconds'
    FOR UPDATE SKIP LOCKED
    LIMIT 1;
    
    IF v_existing_room IS NOT NULL THEN
        -- 自动取消超时房间
        PERFORM public.cancel_dice_room_v2(v_existing_room, NULL);
    END IF;
    
    -- 🎯 检查是否有活跃房间
    SELECT id INTO v_existing_room
    FROM public.dice_rooms_new
    WHERE group_id = p_group_id AND status = 'waiting'
    FOR UPDATE SKIP LOCKED
    LIMIT 1;
    
    IF v_existing_room IS NOT NULL THEN
        RETURN json_build_object('success', false, 'message', '当前已有正在进行的对局，请等待结束后再开新局');
    END IF;
    
    -- 🎯 检查余额
    SELECT balance_coins INTO v_current_balance 
    FROM public.profiles 
    WHERE id = p_owner_id FOR UPDATE;
    
    IF v_current_balance < p_bet_amount THEN
        RETURN json_build_object('success', false, 'message', '余额不足');
    END IF;
    
    -- 🎯 创建房间（使用 DEFERRABLE 约束，允许在同一事务中创建）
    INSERT INTO public.dice_rooms_new (owner_id, group_id, bet_amount, target_count, current_count, status)
    VALUES (p_owner_id, p_group_id, p_bet_amount, p_target_count, 1, 'waiting')
    RETURNING id INTO v_room_id;
    
    -- 🎯 加入参与者
    INSERT INTO public.dice_room_players_new (room_id, user_id)
    VALUES (v_room_id, p_owner_id);
    
    -- 🎯 扣费
    UPDATE public.profiles 
    SET balance_coins = balance_coins - p_bet_amount 
    WHERE id = p_owner_id
    RETURNING balance_coins INTO v_final_balance;
    
    -- 🎯 记录交易
    INSERT INTO public.coin_transactions (user_id, amount, balance_after, type, description, related_id)
    VALUES (p_owner_id, -p_bet_amount, v_final_balance, 'dice_bet', '发起骰子比大小', v_room_id);
    
    RETURN json_build_object('success', true, 'room_id', v_room_id);
END;
$$;

-- 8. 骰子游戏：加入房间（原子操作，如果满员则自动开始）
CREATE OR REPLACE FUNCTION public.join_dice_room_v2(
    p_room_id UUID,
    p_user_id UUID
) RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_room RECORD;
    v_current_balance NUMERIC;
    v_final_balance NUMERIC;
    v_is_full BOOLEAN;
BEGIN
    -- 🎯 锁定并获取房间信息
    SELECT * INTO v_room
    FROM public.dice_rooms_new
    WHERE id = p_room_id FOR UPDATE;
    
    IF NOT FOUND THEN
        RETURN json_build_object('success', false, 'message', '房间不存在');
    END IF;
    
    -- 🎯 超时检查
    IF v_room.status = 'waiting' AND v_room.created_at < NOW() - INTERVAL '30 seconds' THEN
        PERFORM public.cancel_dice_room_v2(p_room_id, NULL);
        RETURN json_build_object('success', false, 'message', '房间已超时');
    END IF;
    
    -- 🎯 状态检查
    IF v_room.status != 'waiting' THEN
        RETURN json_build_object('success', false, 'message', '房间已满或已开始');
    END IF;
    
    -- 🎯 检查是否已在房间内
    IF EXISTS (SELECT 1 FROM public.dice_room_players_new WHERE room_id = p_room_id AND user_id = p_user_id) THEN
        RETURN json_build_object('success', false, 'message', '你已经在房间里了');
    END IF;
    
    -- 🎯 检查余额
    SELECT balance_coins INTO v_current_balance 
    FROM public.profiles 
    WHERE id = p_user_id FOR UPDATE;
    
    IF v_current_balance < v_room.bet_amount THEN
        RETURN json_build_object('success', false, 'message', '余额不足');
    END IF;
    
    -- 🎯 扣费
    UPDATE public.profiles 
    SET balance_coins = balance_coins - v_room.bet_amount 
    WHERE id = p_user_id
    RETURNING balance_coins INTO v_final_balance;
    
    -- 🎯 加入参与者
    INSERT INTO public.dice_room_players_new (room_id, user_id)
    VALUES (p_room_id, p_user_id);
    
    -- 🎯 更新房间人数
    UPDATE public.dice_rooms_new 
    SET current_count = current_count + 1
    WHERE id = p_room_id
    RETURNING (current_count >= target_count) INTO v_is_full;
    
    -- 🎯 记录交易
    INSERT INTO public.coin_transactions (user_id, amount, balance_after, type, description, related_id)
    VALUES (p_user_id, -v_room.bet_amount, v_final_balance, 'dice_bet', '参与骰子比大小', p_room_id);
    
    RETURN json_build_object('success', true, 'is_full', v_is_full);
END;
$$;

-- 9. 骰子游戏：结算房间（原子操作，包含发送骰子、计算胜负、发放奖励）
CREATE OR REPLACE FUNCTION public.settle_dice_room_v2(
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
BEGIN
    -- 🎯 解析 JSON 字符串
    v_roll_results_jsonb := p_roll_results::JSONB;
    
    -- 🎯 锁定并获取房间信息
    SELECT * INTO v_room
    FROM public.dice_rooms_new
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
        UPDATE public.dice_room_players_new
        SET roll_result = (v_result->>'value')::INT
        WHERE room_id = p_room_id 
          AND user_id = (v_result->>'user_id')::UUID;
        
        IF (v_result->>'value')::INT > v_max_value THEN
            v_max_value := (v_result->>'value')::INT;
        END IF;
    END LOOP;
    
    -- 🎯 重新获取最大值（确保准确）
    SELECT MAX(roll_result) INTO v_max_value
    FROM public.dice_room_players_new
    WHERE room_id = p_room_id;
    
    -- 🎯 找出所有赢家
    SELECT ARRAY_AGG(user_id) INTO v_winners
    FROM public.dice_room_players_new
    WHERE room_id = p_room_id AND roll_result = v_max_value;
    
    -- 🎯 计算奖金
    v_total_prize := v_room.bet_amount * v_room.target_count;
    v_commission := FLOOR(v_total_prize * 0.02 * 100) / 100;
    v_net_prize := v_total_prize - v_commission;
    v_per_winner_prize := FLOOR((v_net_prize / array_length(v_winners, 1)) * 100) / 100;
    
    -- 🎯 发放奖励给赢家
    FOR v_player IN SELECT user_id FROM public.dice_room_players_new WHERE room_id = p_room_id AND user_id = ANY(v_winners)
    LOOP
        UPDATE public.profiles
        SET balance_coins = balance_coins + v_per_winner_prize
        WHERE id = v_player.user_id
        RETURNING balance_coins INTO v_final_balance;
        
        UPDATE public.dice_room_players_new
        SET is_winner = TRUE
        WHERE room_id = p_room_id AND user_id = v_player.user_id;
        
        INSERT INTO public.coin_transactions (user_id, amount, balance_after, type, description, related_id)
        VALUES (v_player.user_id, v_per_winner_prize, v_final_balance, 'dice_reward', '骰子游戏获胜', p_room_id);
    END LOOP;
    
    -- 🎯 更新房间状态
    UPDATE public.dice_rooms_new
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
        'per_winner_prize', v_per_winner_prize
    );
END;
$$;

-- 10. 骰子游戏：取消房间（原子操作）
CREATE OR REPLACE FUNCTION public.cancel_dice_room_v2(
    p_room_id UUID,
    p_user_id UUID DEFAULT NULL -- NULL 表示系统取消（超时）
) RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_room RECORD;
    v_player RECORD;
    v_final_balance NUMERIC;
BEGIN
    -- 🎯 锁定并获取房间信息
    SELECT * INTO v_room
    FROM public.dice_rooms_new
    WHERE id = p_room_id FOR UPDATE;
    
    IF NOT FOUND THEN
        RETURN json_build_object('success', false, 'message', '房间不存在');
    END IF;
    
    IF v_room.status != 'waiting' THEN
        RETURN json_build_object('success', false, 'message', '游戏已开始，无法取消');
    END IF;
    
    -- 🎯 权限检查（如果不是系统取消）
    IF p_user_id IS NOT NULL AND v_room.owner_id != p_user_id THEN
        RETURN json_build_object('success', false, 'message', '只有房主才能取消');
    END IF;
    
    -- 🎯 退还所有玩家的本金
    FOR v_player IN SELECT user_id FROM public.dice_room_players_new WHERE room_id = p_room_id
    LOOP
        UPDATE public.profiles
        SET balance_coins = balance_coins + v_room.bet_amount
        WHERE id = v_player.user_id
        RETURNING balance_coins INTO v_final_balance;
        
        INSERT INTO public.coin_transactions (user_id, amount, balance_after, type, description, related_id)
        VALUES (v_player.user_id, v_room.bet_amount, v_final_balance, 'dice_refund', '骰子游戏取消退款', p_room_id);
    END LOOP;
    
    -- 🎯 更新房间状态
    UPDATE public.dice_rooms_new
    SET status = 'cancelled'
    WHERE id = p_room_id;
    
    RETURN json_build_object('success', true, 'message', '房间已取消');
END;
$$;

-- 11. 猜拳游戏：创建房间（原子操作）
CREATE OR REPLACE FUNCTION public.create_rps_room_v2(
    p_owner_id UUID,
    p_group_id BIGINT,
    p_bet_amount NUMERIC
) RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_current_balance NUMERIC;
    v_room_id UUID;
    v_final_balance NUMERIC;
    v_existing_room UUID;
BEGIN
    -- 🎯 超时检查：检查是否有超时的 waiting 房间
    SELECT id INTO v_existing_room
    FROM public.rps_rooms_new
    WHERE group_id = p_group_id 
      AND status = 'waiting'
      AND created_at < NOW() - INTERVAL '30 seconds'
    FOR UPDATE SKIP LOCKED
    LIMIT 1;
    
    IF v_existing_room IS NOT NULL THEN
        PERFORM public.cancel_rps_room_v2(v_existing_room, NULL);
    END IF;
    
    -- 🎯 检查是否有活跃房间
    SELECT id INTO v_existing_room
    FROM public.rps_rooms_new
    WHERE group_id = p_group_id AND status = 'waiting'
    FOR UPDATE SKIP LOCKED
    LIMIT 1;
    
    IF v_existing_room IS NOT NULL THEN
        RETURN json_build_object('success', false, 'message', '本群已有进行中的猜拳游戏，请等待结束后再开新局');
    END IF;
    
    -- 🎯 检查余额
    SELECT balance_coins INTO v_current_balance 
    FROM public.profiles 
    WHERE id = p_owner_id FOR UPDATE;
    
    IF v_current_balance < p_bet_amount THEN
        RETURN json_build_object('success', false, 'message', '余额不足');
    END IF;
    
    -- 🎯 创建房间
    INSERT INTO public.rps_rooms_new (owner_id, group_id, bet_amount, status)
    VALUES (p_owner_id, p_group_id, p_bet_amount, 'waiting')
    RETURNING id INTO v_room_id;
    
    -- 🎯 扣费
    UPDATE public.profiles 
    SET balance_coins = balance_coins - p_bet_amount 
    WHERE id = p_owner_id
    RETURNING balance_coins INTO v_final_balance;
    
    -- 🎯 记录交易
    INSERT INTO public.coin_transactions (user_id, amount, balance_after, type, description, related_id)
    VALUES (p_owner_id, -p_bet_amount, v_final_balance, 'rps_bet', '发起猜拳游戏', v_room_id);
    
    RETURN json_build_object('success', true, 'room_id', v_room_id);
END;
$$;

-- 12. 猜拳游戏：加入房间（原子操作）
CREATE OR REPLACE FUNCTION public.join_rps_room_v2(
    p_room_id UUID,
    p_user_id UUID
) RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_room RECORD;
    v_current_balance NUMERIC;
    v_final_balance NUMERIC;
BEGIN
    -- 🎯 锁定并获取房间信息
    SELECT * INTO v_room
    FROM public.rps_rooms_new
    WHERE id = p_room_id FOR UPDATE;
    
    IF NOT FOUND THEN
        RETURN json_build_object('success', false, 'message', '房间不存在');
    END IF;
    
    -- 🎯 超时检查
    IF v_room.status = 'waiting' AND v_room.created_at < NOW() - INTERVAL '30 seconds' THEN
        PERFORM public.cancel_rps_room_v2(p_room_id, NULL);
        RETURN json_build_object('success', false, 'message', '房间已超时');
    END IF;
    
    -- 🎯 状态检查
    IF v_room.status != 'waiting' THEN
        RETURN json_build_object('success', false, 'message', '游戏已开始或已结束');
    END IF;
    
    -- 🎯 检查是否是房主自己
    IF v_room.owner_id = p_user_id THEN
        RETURN json_build_object('success', false, 'message', '不能和自己玩');
    END IF;
    
    -- 🎯 检查是否已满员
    IF v_room.opponent_id IS NOT NULL THEN
        RETURN json_build_object('success', false, 'message', '房间已满');
    END IF;
    
    -- 🎯 检查余额
    SELECT balance_coins INTO v_current_balance 
    FROM public.profiles 
    WHERE id = p_user_id FOR UPDATE;
    
    IF v_current_balance < v_room.bet_amount THEN
        RETURN json_build_object('success', false, 'message', '余额不足');
    END IF;
    
    -- 🎯 扣费
    UPDATE public.profiles 
    SET balance_coins = balance_coins - v_room.bet_amount 
    WHERE id = p_user_id
    RETURNING balance_coins INTO v_final_balance;
    
    -- 🎯 加入房间
    UPDATE public.rps_rooms_new
    SET opponent_id = p_user_id
    WHERE id = p_room_id;
    
    -- 🎯 记录交易
    INSERT INTO public.coin_transactions (user_id, amount, balance_after, type, description, related_id)
    VALUES (p_user_id, -v_room.bet_amount, v_final_balance, 'rps_bet', '参与猜拳游戏', p_room_id);
    
    RETURN json_build_object('success', true, 'message', '成功加入游戏');
END;
$$;

-- 13. 猜拳游戏：出手（原子操作，如果双方都出手则自动结算）
CREATE OR REPLACE FUNCTION public.make_rps_choice_v2(
    p_room_id UUID,
    p_user_id UUID,
    p_choice TEXT
) RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_room RECORD;
    v_is_owner BOOLEAN;
    v_both_chosen BOOLEAN;
    v_result TEXT;
    v_total_prize NUMERIC;
    v_commission NUMERIC;
    v_winner_prize NUMERIC;
    v_winner_id UUID;
    v_final_balance NUMERIC;
BEGIN
    -- 🎯 锁定并获取房间信息
    SELECT * INTO v_room
    FROM public.rps_rooms_new
    WHERE id = p_room_id FOR UPDATE;
    
    IF NOT FOUND THEN
        RETURN json_build_object('success', false, 'message', '房间不存在');
    END IF;
    
    -- 🎯 超时检查
    IF v_room.status = 'waiting' AND v_room.created_at < NOW() - INTERVAL '30 seconds' THEN
        PERFORM public.cancel_rps_room_v2(p_room_id, NULL);
        RETURN json_build_object('success', false, 'message', '房间已超时');
    END IF;
    
    -- 🎯 状态检查（允许 waiting 状态，因为对手加入后状态还是 waiting）
    IF v_room.status NOT IN ('waiting', 'finished', 'cancelled') THEN
        RETURN json_build_object('success', false, 'message', '房间状态不正确');
    END IF;
    
    IF v_room.status IN ('finished', 'cancelled') THEN
        RETURN json_build_object('success', false, 'message', '游戏已结束');
    END IF;
    
    -- 🎯 验证玩家身份
    IF v_room.owner_id = p_user_id THEN
        v_is_owner := TRUE;
        IF v_room.owner_choice IS NOT NULL THEN
            RETURN json_build_object('success', false, 'message', '你已经出过手了');
        END IF;
    ELSIF v_room.opponent_id = p_user_id THEN
        v_is_owner := FALSE;
        IF v_room.opponent_choice IS NOT NULL THEN
            RETURN json_build_object('success', false, 'message', '你已经出过手了');
        END IF;
    ELSE
        RETURN json_build_object('success', false, 'message', '你不是对局玩家');
    END IF;
    
    -- 🎯 保存选择
    IF v_is_owner THEN
        UPDATE public.rps_rooms_new
        SET owner_choice = p_choice
        WHERE id = p_room_id;
    ELSE
        UPDATE public.rps_rooms_new
        SET opponent_choice = p_choice
        WHERE id = p_room_id;
    END IF;
    
    -- 🎯 重新获取房间信息（获取最新选择）
    SELECT * INTO v_room
    FROM public.rps_rooms_new
    WHERE id = p_room_id;
    
    -- 🎯 检查是否双方都出手了
    v_both_chosen := v_room.owner_choice IS NOT NULL AND v_room.opponent_choice IS NOT NULL;
    
    IF NOT v_both_chosen THEN
        RETURN json_build_object('success', true, 'both_chosen', false, 'message', '出手成功，等待对手');
    END IF;
    
    -- 🎯 双方都出手了，自动结算
    v_total_prize := v_room.bet_amount * 2;
    
    -- 🎯 判断胜负
    IF v_room.owner_choice = v_room.opponent_choice THEN
        v_result := 'draw';
    ELSIF (v_room.owner_choice = 'rock' AND v_room.opponent_choice = 'scissors')
       OR (v_room.owner_choice = 'scissors' AND v_room.opponent_choice = 'paper')
       OR (v_room.owner_choice = 'paper' AND v_room.opponent_choice = 'rock') THEN
        v_result := 'owner_win';
        v_winner_id := v_room.owner_id;
    ELSE
        v_result := 'opponent_win';
        v_winner_id := v_room.opponent_id;
    END IF;
    
    -- 🎯 结算
    IF v_result = 'draw' THEN
        -- 平局：退回本金，不抽水
        UPDATE public.profiles
        SET balance_coins = balance_coins + v_room.bet_amount
        WHERE id = v_room.owner_id
        RETURNING balance_coins INTO v_final_balance;
        
        INSERT INTO public.coin_transactions (user_id, amount, balance_after, type, description, related_id)
        VALUES (v_room.owner_id, v_room.bet_amount, v_final_balance, 'rps_refund', '猜拳游戏平局退款', p_room_id);
        
        UPDATE public.profiles
        SET balance_coins = balance_coins + v_room.bet_amount
        WHERE id = v_room.opponent_id
        RETURNING balance_coins INTO v_final_balance;
        
        INSERT INTO public.coin_transactions (user_id, amount, balance_after, type, description, related_id)
        VALUES (v_room.opponent_id, v_room.bet_amount, v_final_balance, 'rps_refund', '猜拳游戏平局退款', p_room_id);
        
        UPDATE public.rps_rooms_new
        SET status = 'finished',
            total_prize = v_total_prize
        WHERE id = p_room_id;
        
        RETURN json_build_object('success', true, 'both_chosen', true, 'result', 'draw', 'message', '平局，本金已退回');
    ELSE
        -- 有赢家：抽水 2%
        v_commission := FLOOR(v_total_prize * 0.02 * 100) / 100;
        v_winner_prize := v_total_prize - v_commission;
        
        UPDATE public.profiles
        SET balance_coins = balance_coins + v_winner_prize
        WHERE id = v_winner_id
        RETURNING balance_coins INTO v_final_balance;
        
        INSERT INTO public.coin_transactions (user_id, amount, balance_after, type, description, related_id)
        VALUES (v_winner_id, v_winner_prize, v_final_balance, 'rps_reward', '猜拳游戏获胜', p_room_id);
        
        UPDATE public.rps_rooms_new
        SET status = 'finished',
            winner_id = v_winner_id,
            total_prize = v_total_prize
        WHERE id = p_room_id;
        
        RETURN json_build_object(
            'success', true,
            'both_chosen', true,
            'result', v_result,
            'winner_id', v_winner_id,
            'winner_prize', v_winner_prize,
            'commission', v_commission,
            'message', CASE WHEN v_result = 'owner_win' THEN '房主获胜' ELSE '挑战者获胜' END
        );
    END IF;
END;
$$;

-- 14. 猜拳游戏：取消房间（原子操作）
CREATE OR REPLACE FUNCTION public.cancel_rps_room_v2(
    p_room_id UUID,
    p_user_id UUID DEFAULT NULL -- NULL 表示系统取消（超时）
) RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_room RECORD;
    v_final_balance NUMERIC;
BEGIN
    -- 🎯 锁定并获取房间信息
    SELECT * INTO v_room
    FROM public.rps_rooms_new
    WHERE id = p_room_id FOR UPDATE;
    
    IF NOT FOUND THEN
        RETURN json_build_object('success', false, 'message', '房间不存在');
    END IF;
    
    IF v_room.status != 'waiting' THEN
        RETURN json_build_object('success', false, 'message', '游戏已开始，无法取消');
    END IF;
    
    -- 🎯 权限检查（如果不是系统取消）
    IF p_user_id IS NOT NULL AND v_room.owner_id != p_user_id THEN
        RETURN json_build_object('success', false, 'message', '只有房主才能取消');
    END IF;
    
    -- 🎯 退还房主本金
    UPDATE public.profiles
    SET balance_coins = balance_coins + v_room.bet_amount
    WHERE id = v_room.owner_id
    RETURNING balance_coins INTO v_final_balance;
    
    INSERT INTO public.coin_transactions (user_id, amount, balance_after, type, description, related_id)
    VALUES (v_room.owner_id, v_room.bet_amount, v_final_balance, 'rps_refund', '猜拳游戏取消退款', p_room_id);
    
    -- 🎯 如果对手已加入，也退还
    IF v_room.opponent_id IS NOT NULL THEN
        UPDATE public.profiles
        SET balance_coins = balance_coins + v_room.bet_amount
        WHERE id = v_room.opponent_id
        RETURNING balance_coins INTO v_final_balance;
        
        INSERT INTO public.coin_transactions (user_id, amount, balance_after, type, description, related_id)
        VALUES (v_room.opponent_id, v_room.bet_amount, v_final_balance, 'rps_refund', '猜拳游戏取消退款', p_room_id);
    END IF;
    
    -- 🎯 更新房间状态
    UPDATE public.rps_rooms_new
    SET status = 'cancelled'
    WHERE id = p_room_id;
    
    RETURN json_build_object('success', true, 'message', '房间已取消');
END;
$$;

-- ============================================================================
-- 第四部分：授权
-- ============================================================================

GRANT EXECUTE ON FUNCTION public.create_dice_room_v2(UUID, BIGINT, NUMERIC, INT) TO service_role;
GRANT EXECUTE ON FUNCTION public.join_dice_room_v2(UUID, UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.settle_dice_room_v2(UUID, JSONB) TO service_role;
GRANT EXECUTE ON FUNCTION public.cancel_dice_room_v2(UUID, UUID) TO service_role;

GRANT EXECUTE ON FUNCTION public.create_rps_room_v2(UUID, BIGINT, NUMERIC) TO service_role;
GRANT EXECUTE ON FUNCTION public.join_rps_room_v2(UUID, UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.make_rps_choice_v2(UUID, UUID, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.cancel_rps_room_v2(UUID, UUID) TO service_role;

-- ============================================================================
-- 第五部分：RLS 策略
-- ============================================================================

ALTER TABLE public.dice_rooms_new ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dice_room_players_new ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rps_rooms_new ENABLE ROW LEVEL SECURITY;

CREATE POLICY "所有人可查看游戏房间" ON public.dice_rooms_new FOR SELECT USING (true);
CREATE POLICY "所有人可查看游戏玩家" ON public.dice_room_players_new FOR SELECT USING (true);
CREATE POLICY "所有人可查看猜拳房间" ON public.rps_rooms_new FOR SELECT USING (true);
