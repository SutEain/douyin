-- 1. 骰子房间主表
CREATE TABLE IF NOT EXISTS public.dice_rooms (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_id UUID NOT NULL REFERENCES public.profiles(id),
    group_id BIGINT NOT NULL,
    bet_amount NUMERIC NOT NULL CHECK (bet_amount >= 5 AND bet_amount <= 10000),
    target_count INT NOT NULL DEFAULT 2 CHECK (target_count >= 2 AND target_count <= 5),
    current_count INT NOT NULL DEFAULT 0,
    status TEXT DEFAULT 'waiting' CHECK (status IN ('waiting', 'rolling', 'finished', 'cancelled')),
    winner_ids UUID[] DEFAULT NULL, -- 可能有多个赢家（平局）
    total_prize NUMERIC DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    expired_at TIMESTAMPTZ DEFAULT (NOW() + INTERVAL '10 minutes')
);

-- 2. 房间参与者表
CREATE TABLE IF NOT EXISTS public.dice_room_players (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    room_id UUID NOT NULL REFERENCES public.dice_rooms(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES public.profiles(id),
    roll_result INT DEFAULT NULL CHECK (roll_result >= 1 AND roll_result <= 6),
    is_winner BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(room_id, user_id)
);

-- 3. 索引优化
CREATE INDEX IF NOT EXISTS idx_dice_rooms_status ON public.dice_rooms(status);
CREATE INDEX IF NOT EXISTS idx_dice_room_players_room ON public.dice_room_players(room_id);

-- 4. RPC: 创建并加入房间 (原子操作)
CREATE OR REPLACE FUNCTION public.create_dice_room(
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
    v_active_room_exists BOOLEAN;
BEGIN
    -- 0. 检查群组内是否已有活跃房间 (waiting 或 rolling)
    SELECT EXISTS (
        SELECT 1 FROM public.dice_rooms 
        WHERE group_id = p_group_id AND status IN ('waiting', 'rolling')
    ) INTO v_active_room_exists;

    IF v_active_room_exists THEN
        RETURN json_build_object('success', false, 'message', '当前已有正在进行的对局，请等待结束后再开新局');
    END IF;

    -- 1. 检查余额
    SELECT balance_coins INTO v_current_balance FROM public.profiles WHERE id = p_owner_id FOR UPDATE;
    IF v_current_balance < p_bet_amount THEN
        RETURN json_build_object('success', false, 'message', '余额不足');
    END IF;

    -- 2. 创建房间
    INSERT INTO public.dice_rooms (owner_id, group_id, bet_amount, target_count, current_count, status)
    VALUES (p_owner_id, p_group_id, p_bet_amount, p_target_count, 1, 'waiting')
    RETURNING id INTO v_room_id;

    -- 3. 加入参与者表
    INSERT INTO public.dice_room_players (room_id, user_id)
    VALUES (v_room_id, p_owner_id);

    -- 4. 扣费
    UPDATE public.profiles 
    SET balance_coins = balance_coins - p_bet_amount 
    WHERE id = p_owner_id
    RETURNING balance_coins INTO v_final_balance;

    -- 5. 记录交易
    INSERT INTO public.coin_transactions (user_id, amount, balance_after, type, description, related_id)
    VALUES (p_owner_id, -p_bet_amount, v_final_balance, 'dice_bet', '发起骰子比大小: 房ID ' || v_room_id, v_room_id);

    RETURN json_build_object('success', true, 'room_id', v_room_id);
END;
$$;

-- 5. RPC: 加入已有房间 (原子操作)
CREATE OR REPLACE FUNCTION public.join_dice_room(
    p_room_id UUID,
    p_user_id UUID
) RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_room_status TEXT;
    v_bet_amount NUMERIC;
    v_target_count INT;
    v_current_count INT;
    v_current_balance NUMERIC;
    v_final_balance NUMERIC;
BEGIN
    -- 1. 锁定并获取房间信息
    SELECT status, bet_amount, target_count, current_count 
    INTO v_room_status, v_bet_amount, v_target_count, v_current_count
    FROM public.dice_rooms 
    WHERE id = p_room_id FOR UPDATE;

    -- 2. 校验房间状态
    IF v_room_status != 'waiting' THEN
        RETURN json_build_object('success', false, 'message', '房间已满或已开始');
    END IF;

    -- 3. 校验是否已在房间内
    IF EXISTS (SELECT 1 FROM public.dice_room_players WHERE room_id = p_room_id AND user_id = p_user_id) THEN
        RETURN json_build_object('success', false, 'message', '你已经在房间里了');
    END IF;

    -- 4. 校验余额
    SELECT balance_coins INTO v_current_balance FROM public.profiles WHERE id = p_user_id FOR UPDATE;
    IF v_current_balance < v_bet_amount THEN
        RETURN json_build_object('success', false, 'message', '余额不足');
    END IF;

    -- 5. 扣费
    UPDATE public.profiles 
    SET balance_coins = balance_coins - v_bet_amount 
    WHERE id = p_user_id
    RETURNING balance_coins INTO v_final_balance;

    -- 6. 加入参与者
    INSERT INTO public.dice_room_players (room_id, user_id) VALUES (p_room_id, p_user_id);

    -- 7. 更新房间人数
    UPDATE public.dice_rooms 
    SET current_count = current_count + 1,
        status = CASE WHEN (current_count + 1) >= v_target_count THEN 'rolling' ELSE 'waiting' END,
        updated_at = NOW()
    WHERE id = p_room_id;

    -- 8. 记录交易
    INSERT INTO public.coin_transactions (user_id, amount, balance_after, type, description, related_id)
    VALUES (p_user_id, -v_bet_amount, v_final_balance, 'dice_bet', '参与骰子比大小: 房ID ' || p_room_id, p_room_id);

    RETURN json_build_object('success', true, 'is_full', (v_current_count + 1) >= v_target_count);
END;
$$;

-- 6. RPC: 自动清理过期房间
CREATE OR REPLACE FUNCTION public.refund_expired_dice_rooms() RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    r RECORD;
    p RECORD;
BEGIN
    FOR r IN (
        SELECT id, bet_amount 
        FROM public.dice_rooms 
        WHERE status = 'waiting' AND expired_at < NOW()
    ) LOOP
        -- 更新房间状态
        UPDATE public.dice_rooms SET status = 'cancelled' WHERE id = r.id;
        
        -- 退还所有已加入玩家的钱
        FOR p IN (SELECT user_id FROM public.dice_room_players WHERE room_id = r.id) LOOP
            UPDATE public.profiles 
            SET balance_coins = balance_coins + r.bet_amount 
            WHERE id = p.user_id;
            
            INSERT INTO public.coin_transactions (user_id, amount, balance_after, type, description, related_id)
            SELECT p.user_id, r.bet_amount, balance_coins, 'dice_refund', '房间过期退款: 房ID ' || r.id, r.id
            FROM public.profiles WHERE id = p.user_id;
        END LOOP;
    END LOOP;
END;
$$;

-- 7. 配置定时任务 (pg_cron)
SELECT cron.schedule(
    'refund-expired-dice-rooms-job',
    '*/5 * * * *',
    $$ SELECT public.refund_expired_dice_rooms() $$
);
