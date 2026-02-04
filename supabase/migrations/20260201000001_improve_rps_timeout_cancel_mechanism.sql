-- 🎯 改进猜拳游戏超时取消机制
-- 问题：
-- 1. cancel_rps_room 函数不支持系统自动取消（p_user_id 不能为 NULL）
-- 2. 取消时没有记录退款交易
-- 3. 超时检查只在创建新房间时触发，如果没人创建新房间，超时房间不会被清理
-- 修复：
-- 1. 改进 cancel_rps_room 函数，支持系统自动取消（p_user_id 为 NULL）
-- 2. 取消时记录退款交易
-- 3. 改进 create_rps_room 和 join_rps_room，确保超时检查正常工作
-- 4. 创建自动清理函数，可以手动调用或通过定时任务调用

-- ============================================================================
-- 1. 改进 cancel_rps_room 函数，支持系统自动取消并记录退款交易
-- ============================================================================
CREATE OR REPLACE FUNCTION public.cancel_rps_room(
    p_room_id UUID,
    p_user_id UUID DEFAULT NULL -- NULL 表示系统自动取消（超时）
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
AS $func$
DECLARE
    v_room RECORD;
    v_final_balance NUMERIC;
    v_refund_amount NUMERIC;
BEGIN
    -- 🎯 锁定并获取房间信息
    SELECT * INTO v_room
    FROM public.rps_rooms
    WHERE id = p_room_id
    FOR UPDATE;
    
    IF NOT FOUND THEN
        RETURN json_build_object('success', false, 'message', '房间不存在');
    END IF;
    
    -- 🎯 如果指定了用户ID，验证权限（系统取消时跳过）
    IF p_user_id IS NOT NULL THEN
        IF p_user_id != auth.uid() THEN
            RETURN json_build_object('success', false, 'message', '非法操作');
        END IF;
        
        IF v_room.owner_id != p_user_id THEN
            RETURN json_build_object('success', false, 'message', '只有房主能取消');
        END IF;
    END IF;
    
    -- 🎯 状态检查
    IF v_room.status NOT IN ('waiting', 'playing') THEN
        RETURN json_build_object('success', false, 'message', '游戏已结束');
    END IF;
    
    -- 🎯 退回房主本金
    UPDATE public.profiles
    SET balance_coins = balance_coins + v_room.bet_amount
    WHERE id = v_room.owner_id
    RETURNING balance_coins INTO v_final_balance;
    
    -- 🎯 记录退款交易
    INSERT INTO public.coin_transactions (user_id, amount, balance_after, type, description, related_id)
    VALUES (
        v_room.owner_id,
        v_room.bet_amount,
        v_final_balance,
        'rps_refund',
        CASE 
            WHEN p_user_id IS NULL THEN '猜拳游戏超时取消退款'
            ELSE '猜拳游戏取消退款'
        END,
        p_room_id
    );
    
    -- 🎯 如果有对手，也退回对手本金
    IF v_room.opponent_id IS NOT NULL THEN
        UPDATE public.profiles
        SET balance_coins = balance_coins + v_room.bet_amount
        WHERE id = v_room.opponent_id
        RETURNING balance_coins INTO v_final_balance;
        
        -- 🎯 记录对手退款交易
        INSERT INTO public.coin_transactions (user_id, amount, balance_after, type, description, related_id)
        VALUES (
            v_room.opponent_id,
            v_room.bet_amount,
            v_final_balance,
            'rps_refund',
            CASE 
                WHEN p_user_id IS NULL THEN '猜拳游戏超时取消退款'
                ELSE '猜拳游戏取消退款'
            END,
            p_room_id
        );
    END IF;
    
    -- 🎯 标记为已取消
    UPDATE public.rps_rooms
    SET status = 'cancelled',
        finished_at = NOW()
    WHERE id = p_room_id;
    
    RETURN json_build_object(
        'success', true,
        'message', CASE 
            WHEN p_user_id IS NULL THEN '房间已超时取消，本金已退回'
            ELSE '房间已取消，本金已退回'
        END
    );
END;
$func$;

COMMENT ON FUNCTION public.cancel_rps_room IS '🚨 改进：支持系统自动取消（p_user_id 为 NULL），取消时记录退款交易';

-- ============================================================================
-- 2. 改进 create_rps_room 函数，确保超时检查正常工作
-- ============================================================================
CREATE OR REPLACE FUNCTION public.create_rps_room(
    p_owner_id UUID,
    p_group_id BIGINT,
    p_bet_amount NUMERIC
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
AS $func$
DECLARE
    v_current_balance NUMERIC;
    v_room_id UUID;
    v_final_balance NUMERIC;
    v_existing_room UUID;
BEGIN
    -- 🎯 权限检查
    IF p_owner_id != auth.uid() THEN
        RETURN json_build_object('success', false, 'message', '非法操作');
    END IF;
    
    -- 🎯 金额范围检查
    IF p_bet_amount < 5 OR p_bet_amount > 10000 THEN
        RETURN json_build_object('success', false, 'message', '单局投注金额限制为 5 - 10000 抖币');
    END IF;
    
    -- 🎯 超时检查：检查并取消超时的 waiting 房间
    SELECT id INTO v_existing_room
    FROM public.rps_rooms
    WHERE group_id = p_group_id 
      AND status = 'waiting'
      AND created_at < NOW() - INTERVAL '30 seconds'
    FOR UPDATE SKIP LOCKED
    LIMIT 1;
    
    IF v_existing_room IS NOT NULL THEN
        PERFORM public.cancel_rps_room(v_existing_room, NULL);
    END IF;
    
    -- 🎯 检查是否有活跃房间
    SELECT id INTO v_existing_room
    FROM public.rps_rooms
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
    INSERT INTO public.rps_rooms (owner_id, group_id, bet_amount, status)
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
$func$;

COMMENT ON FUNCTION public.create_rps_room IS '🚨 改进：创建房间时自动检查并取消超时的 waiting 房间';

-- ============================================================================
-- 3. 改进 join_rps_room 函数，加入时也检查超时
-- ============================================================================
CREATE OR REPLACE FUNCTION public.join_rps_room(
    p_room_id UUID,
    p_user_id UUID
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
AS $func$
DECLARE
    v_room RECORD;
    v_user_balance NUMERIC;
    v_final_balance NUMERIC;
BEGIN
    -- 🎯 权限检查
    IF p_user_id != auth.uid() THEN
        RETURN json_build_object('success', false, 'message', '非法操作');
    END IF;
    
    -- 🎯 锁定并获取房间信息
    SELECT * INTO v_room
    FROM public.rps_rooms
    WHERE id = p_room_id
    FOR UPDATE;
    
    IF NOT FOUND THEN
        RETURN json_build_object('success', false, 'message', '房间不存在');
    END IF;
    
    -- 🎯 超时检查
    IF v_room.status = 'waiting' AND v_room.created_at < NOW() - INTERVAL '30 seconds' THEN
        PERFORM public.cancel_rps_room(p_room_id, NULL);
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
    SELECT balance_coins INTO v_user_balance 
    FROM public.profiles 
    WHERE id = p_user_id FOR UPDATE;
    
    IF v_user_balance < v_room.bet_amount THEN
        RETURN json_build_object('success', false, 'message', '余额不足');
    END IF;
    
    -- 🎯 扣费
    UPDATE public.profiles 
    SET balance_coins = balance_coins - v_room.bet_amount
    WHERE id = p_user_id
    RETURNING balance_coins INTO v_final_balance;
    
    -- 🎯 加入房间（注意：新表设计不需要设置 status = 'playing'，保持 'waiting' 状态）
    UPDATE public.rps_rooms
    SET opponent_id = p_user_id
    WHERE id = p_room_id;
    
    -- 🎯 记录交易
    INSERT INTO public.coin_transactions (user_id, amount, balance_after, type, description, related_id)
    VALUES (p_user_id, -v_room.bet_amount, v_final_balance, 'rps_bet', '参与猜拳游戏', p_room_id);
    
    RETURN json_build_object('success', true, 'message', '成功加入游戏');
END;
$func$;

COMMENT ON FUNCTION public.join_rps_room IS '🚨 改进：加入房间时检查超时，超时则自动取消并退款';

-- ============================================================================
-- 4. 创建自动清理超时游戏的函数（可以手动调用或通过定时任务调用）
-- ============================================================================
CREATE OR REPLACE FUNCTION public.auto_cancel_timeout_rps_rooms()
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
AS $func$
DECLARE
    v_room RECORD;
    v_cancelled_count INT := 0;
    v_refunded_amount NUMERIC := 0;
    v_result JSONB;
BEGIN
    -- 🎯 处理所有超时的 waiting 房间（超过30秒）
    FOR v_room IN
        SELECT * FROM public.rps_rooms
        WHERE status = 'waiting'
          AND created_at < NOW() - INTERVAL '30 seconds'
        FOR UPDATE SKIP LOCKED
    LOOP
        -- 调用取消函数（系统自动取消）
        SELECT public.cancel_rps_room(v_room.id, NULL)::JSONB INTO v_result;
        
        IF (v_result->>'success')::BOOLEAN THEN
            v_cancelled_count := v_cancelled_count + 1;
            v_refunded_amount := v_refunded_amount + v_room.bet_amount;
            
            -- 如果有对手，也要退款
            IF v_room.opponent_id IS NOT NULL THEN
                v_refunded_amount := v_refunded_amount + v_room.bet_amount;
            END IF;
        END IF;
    END LOOP;
    
    -- 🎯 处理所有超时的 playing 房间（超过60秒，基于 created_at）
    -- 注意：rps_rooms 表没有 updated_at 字段，使用 created_at
    FOR v_room IN
        SELECT * FROM public.rps_rooms
        WHERE status = 'playing'
          AND created_at < NOW() - INTERVAL '60 seconds'
        FOR UPDATE SKIP LOCKED
    LOOP
        -- 调用取消函数（系统自动取消）
        SELECT public.cancel_rps_room(v_room.id, NULL)::JSONB INTO v_result;
        
        IF (v_result->>'success')::BOOLEAN THEN
            v_cancelled_count := v_cancelled_count + 1;
            v_refunded_amount := v_refunded_amount + (v_room.bet_amount * 2); -- 双方都退款
        END IF;
    END LOOP;
    
    RETURN json_build_object(
        'success', true,
        'cancelled_count', v_cancelled_count,
        'refunded_amount', v_refunded_amount,
        'message', format('已取消 %s 个超时房间，退款 %s 抖币', v_cancelled_count, v_refunded_amount)
    );
END;
$func$;

COMMENT ON FUNCTION public.auto_cancel_timeout_rps_rooms IS '🚨 自动清理超时的猜拳游戏：waiting 状态超过30秒，playing 状态超过60秒';

-- ============================================================================
-- 5. 立即执行一次自动清理，处理所有超时的游戏
-- ============================================================================
SELECT public.auto_cancel_timeout_rps_rooms();
