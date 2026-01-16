-- 骰子游戏取消和退款函数

-- 1. 取消骰子房间（仅房主，仅waiting状态）
CREATE OR REPLACE FUNCTION public.cancel_dice_room(
  p_room_id UUID,
  p_user_id UUID
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_room RECORD;
  v_player RECORD;
BEGIN
  -- 锁定并获取房间信息
  SELECT * INTO v_room
  FROM dice_rooms
  WHERE id = p_room_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN json_build_object('success', false, 'message', '房间不存在');
  END IF;

  -- 权限检查：只有房主能取消
  IF v_room.owner_id != p_user_id THEN
    RETURN json_build_object('success', false, 'message', '只有房主才能取消');
  END IF;

  -- 状态检查：只能取消waiting状态的房间
  IF v_room.status != 'waiting' THEN
    RETURN json_build_object('success', false, 'message', '游戏已开始，无法取消');
  END IF;

  -- 退还所有已加入玩家的本金
  FOR v_player IN
    SELECT user_id FROM dice_room_players WHERE room_id = p_room_id
  LOOP
    UPDATE profiles
    SET balance_coins = balance_coins + v_room.bet_amount,
        updated_at = NOW()
    WHERE id = v_player.user_id;

    -- 记录退款交易
    INSERT INTO coin_transactions (user_id, amount, balance_after, type, description, related_id)
    SELECT
      v_player.user_id,
      v_room.bet_amount,
      balance_coins,
      'dice_refund',
      '骰子游戏取消退款: 房ID ' || p_room_id,
      p_room_id
    FROM profiles
    WHERE id = v_player.user_id;
  END LOOP;

  -- 标记房间为已取消
  UPDATE dice_rooms
  SET status = 'cancelled',
      finished_at = NOW()
  WHERE id = p_room_id;

  RETURN json_build_object(
    'success', true,
    'message', '房间已取消',
    'current_count', v_room.current_count,
    'group_id', v_room.group_id,
    'message_id', v_room.message_id
  );
END;
$$;

-- 2. 退款骰子房间（用于结算失败等情况）
CREATE OR REPLACE FUNCTION public.refund_dice_room(
  p_room_id UUID
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_room RECORD;
  v_player RECORD;
BEGIN
  -- 锁定并获取房间信息
  SELECT * INTO v_room
  FROM dice_rooms
  WHERE id = p_room_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN json_build_object('success', false, 'message', '房间不存在');
  END IF;

  -- 如果已经退款过（状态为cancelled），直接返回
  IF v_room.status = 'cancelled' THEN
    RETURN json_build_object('success', true, 'message', '房间已退款');
  END IF;

  -- 退还所有已加入玩家的本金
  FOR v_player IN
    SELECT user_id FROM dice_room_players WHERE room_id = p_room_id
  LOOP
    UPDATE profiles
    SET balance_coins = balance_coins + v_room.bet_amount,
        updated_at = NOW()
    WHERE id = v_player.user_id;

    -- 记录退款交易
    INSERT INTO coin_transactions (user_id, amount, balance_after, type, description, related_id)
    SELECT
      v_player.user_id,
      v_room.bet_amount,
      balance_coins,
      'dice_refund',
      '骰子游戏退款: 房ID ' || p_room_id,
      p_room_id
    FROM profiles
    WHERE id = v_player.user_id;
  END LOOP;

  -- 标记房间为已取消
  UPDATE dice_rooms
  SET status = 'cancelled',
      finished_at = NOW()
  WHERE id = p_room_id;

  RETURN json_build_object(
    'success', true,
    'message', '退款成功',
    'current_count', v_room.current_count,
    'group_id', v_room.group_id,
    'message_id', v_room.message_id
  );
END;
$$;

-- 授予权限
GRANT EXECUTE ON FUNCTION public.cancel_dice_room(UUID, UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.refund_dice_room(UUID) TO service_role;

-- 3. 创建新函数：检查并处理过期房间，返回需要发送消息的房间信息（供 Edge Function 调用）
-- 注意：原有的 refund_expired_dice_rooms() 函数保留不变（供 pg_cron 使用，返回 VOID）
CREATE OR REPLACE FUNCTION public.check_and_refund_expired_dice_rooms()
RETURNS TABLE (
  room_id UUID,
  group_id BIGINT,
  message_id BIGINT,
  current_count INT,
  owner_nickname TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  r RECORD;
  p RECORD;
  v_owner_nickname TEXT;
  v_bet_amount NUMERIC;
BEGIN
  FOR r IN (
    SELECT dr.id, dr.group_id, dr.message_id, dr.current_count, dr.owner_id, dr.bet_amount
    FROM dice_rooms dr
    WHERE dr.status = 'waiting' AND dr.expired_at < NOW()
    FOR UPDATE SKIP LOCKED
  ) LOOP
    v_bet_amount := r.bet_amount;
    
    -- 获取房主昵称
    SELECT nickname INTO v_owner_nickname
    FROM profiles
    WHERE id = r.owner_id;
    
    -- 更新房间状态
    UPDATE dice_rooms SET status = 'cancelled' WHERE id = r.id;
    
    -- 退还所有已加入玩家的钱
    FOR p IN (SELECT user_id FROM dice_room_players WHERE room_id = r.id) LOOP
      UPDATE profiles 
      SET balance_coins = balance_coins + v_bet_amount
      WHERE id = p.user_id;
      
      INSERT INTO coin_transactions (user_id, amount, balance_after, type, description, related_id)
      SELECT 
        p.user_id, 
        v_bet_amount,
        balance_coins, 
        'dice_refund', 
        '房间过期退款: 房ID ' || r.id, 
        r.id
      FROM profiles WHERE id = p.user_id;
    END LOOP;
    
    -- 返回房间信息用于发送消息
    room_id := r.id;
    group_id := r.group_id;
    message_id := r.message_id;
    current_count := r.current_count;
    owner_nickname := v_owner_nickname;
    RETURN NEXT;
  END LOOP;
END;
$$;

-- 授予权限
GRANT EXECUTE ON FUNCTION public.check_and_refund_expired_dice_rooms() TO service_role;

-- 注释
COMMENT ON FUNCTION public.cancel_dice_room(UUID, UUID) IS '取消骰子房间（仅房主，仅waiting状态），退还所有玩家本金';
COMMENT ON FUNCTION public.refund_dice_room(UUID) IS '退款骰子房间（用于结算失败等情况），退还所有玩家本金';
COMMENT ON FUNCTION public.check_and_refund_expired_dice_rooms() IS '检查并处理过期骰子房间，返回需要发送消息的房间信息（供 Edge Function 调用）';
