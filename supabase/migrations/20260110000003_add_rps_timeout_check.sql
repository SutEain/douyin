-- 猜拳游戏超时自动解散机制
-- 1. 等待加入阶段：30秒无人加入 → 自动解散，退款
-- 2. 出手阶段：60秒内双方必须出手，超时则自动解散，退款

-- 创建检查并处理超时房间的函数
CREATE OR REPLACE FUNCTION public.check_rps_timeout()
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_timeout_waiting TIMESTAMP := NOW() - INTERVAL '30 seconds';
  v_timeout_playing TIMESTAMP := NOW() - INTERVAL '60 seconds';
  v_room RECORD;
  v_cancelled_count INT := 0;
  v_refunded_rooms JSONB[] := ARRAY[]::JSONB[];
BEGIN
  -- 1. 处理等待加入阶段超时（30秒）
  FOR v_room IN
    SELECT * FROM rps_rooms
    WHERE status = 'waiting'
      AND created_at < v_timeout_waiting
    FOR UPDATE SKIP LOCKED
  LOOP
    -- 退回房主本金
    UPDATE profiles
    SET balance_coins = balance_coins + v_room.bet_amount,
        updated_at = NOW()
    WHERE id = v_room.owner_id;

    -- 标记为已取消
    UPDATE rps_rooms
    SET status = 'cancelled',
        finished_at = NOW()
    WHERE id = v_room.id;

    v_cancelled_count := v_cancelled_count + 1;
    v_refunded_rooms := array_append(v_refunded_rooms, jsonb_build_object(
      'room_id', v_room.id,
      'reason', 'waiting',
      'group_id', v_room.group_id,
      'message_id', v_room.message_id
    ));

    -- 记录日志
    RAISE NOTICE '猜拳房间超时解散: room_id=%, owner_id=%, bet_amount=%, reason=等待加入超时',
      v_room.id, v_room.owner_id, v_room.bet_amount;
  END LOOP;

  -- 2. 处理出手阶段超时（60秒）
  FOR v_room IN
    SELECT * FROM rps_rooms
    WHERE status = 'playing'
      AND created_at < v_timeout_playing
    FOR UPDATE SKIP LOCKED
  LOOP
    -- 退回双方本金
    UPDATE profiles
    SET balance_coins = balance_coins + v_room.bet_amount,
        updated_at = NOW()
    WHERE id = v_room.owner_id;

    UPDATE profiles
    SET balance_coins = balance_coins + v_room.bet_amount,
        updated_at = NOW()
    WHERE id = v_room.opponent_id;

    -- 标记为已取消
    UPDATE rps_rooms
    SET status = 'cancelled',
        finished_at = NOW()
    WHERE id = v_room.id;

    v_cancelled_count := v_cancelled_count + 1;
    v_refunded_rooms := array_append(v_refunded_rooms, jsonb_build_object(
      'room_id', v_room.id,
      'reason', 'playing',
      'group_id', v_room.group_id,
      'message_id', v_room.message_id
    ));

    -- 记录日志
    RAISE NOTICE '猜拳房间超时解散: room_id=%, owner_id=%, opponent_id=%, bet_amount=%, reason=出手超时',
      v_room.id, v_room.owner_id, v_room.opponent_id, v_room.bet_amount;
  END LOOP;

  RETURN json_build_object(
    'success', true,
    'cancelled_count', v_cancelled_count,
    'refunded_rooms', v_refunded_rooms,
    'checked_at', NOW()
  );
END;
$$;

-- 授予权限
GRANT EXECUTE ON FUNCTION public.check_rps_timeout() TO service_role;

-- 注释
COMMENT ON FUNCTION public.check_rps_timeout() IS '检查并处理超时的猜拳房间：等待加入30秒超时，出手阶段60秒超时';

