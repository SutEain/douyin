-- 🎯 完整修复猜拳游戏超时机制
-- 问题：
-- 1. 超时检查没有自动触发（没有定时任务）
-- 2. playing 状态超时检查基于 created_at，应该基于进入 playing 状态的时间
-- 3. 需要添加 updated_at 字段来记录状态变更时间
-- 修复：
-- 1. 添加 updated_at 字段（如果不存在）
-- 2. 改进超时检查逻辑，基于 updated_at 而不是 created_at
-- 3. 添加定时任务自动执行超时检查

-- -----------------------------------------------------------------------------
-- 1. 添加 updated_at 字段（如果不存在）
-- -----------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' 
      AND table_name = 'rps_rooms' 
      AND column_name = 'updated_at'
  ) THEN
    ALTER TABLE public.rps_rooms ADD COLUMN updated_at TIMESTAMPTZ DEFAULT NOW();
    CREATE INDEX IF NOT EXISTS idx_rps_rooms_updated_at ON rps_rooms(updated_at);
  END IF;
END $$;

-- -----------------------------------------------------------------------------
-- 2. 改进超时检查函数
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.check_rps_timeout()
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_timeout_waiting TIMESTAMP := NOW() - INTERVAL '30 seconds';
  v_timeout_playing TIMESTAMP := NOW() - INTERVAL '60 seconds';
  v_timeout_long_playing TIMESTAMP := NOW() - INTERVAL '5 minutes';
  v_room RECORD;
  v_cancelled_count INT := 0;
  v_refunded_rooms JSONB[] := ARRAY[]::JSONB[];
BEGIN
  -- 1. 处理等待加入阶段超时（30秒）- 基于 created_at
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
        finished_at = NOW(),
        updated_at = NOW()
    WHERE id = v_room.id;

    v_cancelled_count := v_cancelled_count + 1;
    v_refunded_rooms := array_append(v_refunded_rooms, jsonb_build_object(
      'room_id', v_room.id,
      'reason', 'waiting',
      'group_id', v_room.group_id,
      'message_id', v_room.message_id
    ));

    RAISE NOTICE '猜拳房间超时解散: room_id=%, owner_id=%, bet_amount=%, reason=等待加入超时',
      v_room.id, v_room.owner_id, v_room.bet_amount;
  END LOOP;

  -- 2. 处理出手阶段超时（60秒）- 🎯 修复：基于 updated_at（进入 playing 状态的时间）
  FOR v_room IN
    SELECT * FROM rps_rooms
    WHERE status = 'playing'
      AND COALESCE(updated_at, created_at) < v_timeout_playing  -- 🎯 使用 updated_at，如果为空则使用 created_at
    FOR UPDATE SKIP LOCKED
  LOOP
    -- 退回双方本金
    UPDATE profiles
    SET balance_coins = balance_coins + v_room.bet_amount,
        updated_at = NOW()
    WHERE id = v_room.owner_id;

    IF v_room.opponent_id IS NOT NULL THEN
      UPDATE profiles
      SET balance_coins = balance_coins + v_room.bet_amount,
          updated_at = NOW()
      WHERE id = v_room.opponent_id;
    END IF;

    -- 标记为已取消
    UPDATE rps_rooms
    SET status = 'cancelled',
        finished_at = NOW(),
        updated_at = NOW()
    WHERE id = v_room.id;

    v_cancelled_count := v_cancelled_count + 1;
    v_refunded_rooms := array_append(v_refunded_rooms, jsonb_build_object(
      'room_id', v_room.id,
      'reason', 'playing_timeout',  -- 🎯 统一 reason 值
      'group_id', v_room.group_id,
      'message_id', v_room.message_id,
      'owner_choice', v_room.owner_choice,  -- 🎯 添加选择信息，方便 Edge Function 判断
      'opponent_choice', v_room.opponent_choice
    ));

    RAISE NOTICE '猜拳房间超时解散: room_id=%, owner_id=%, opponent_id=%, bet_amount=%, reason=出手超时',
      v_room.id, v_room.owner_id, v_room.opponent_id, v_room.bet_amount;
  END LOOP;

  -- 3. 处理长时间残留的 playing 状态房间（超过5分钟）
  FOR v_room IN
    SELECT * FROM rps_rooms
    WHERE status = 'playing'
      AND COALESCE(updated_at, created_at) < v_timeout_long_playing  -- 🎯 使用 updated_at，如果为空则使用 created_at
      AND COALESCE(updated_at, created_at) >= v_timeout_playing  -- 避免重复处理上面的情况
    FOR UPDATE SKIP LOCKED
  LOOP
    -- 退回双方本金
    UPDATE profiles
    SET balance_coins = balance_coins + v_room.bet_amount,
        updated_at = NOW()
    WHERE id = v_room.owner_id;

    IF v_room.opponent_id IS NOT NULL THEN
      UPDATE profiles
      SET balance_coins = balance_coins + v_room.bet_amount,
          updated_at = NOW()
      WHERE id = v_room.opponent_id;
    END IF;

    -- 标记为已取消
    UPDATE rps_rooms
    SET status = 'cancelled',
        finished_at = NOW(),
        updated_at = NOW()
    WHERE id = v_room.id;

    v_cancelled_count := v_cancelled_count + 1;
    v_refunded_rooms := array_append(v_refunded_rooms, jsonb_build_object(
      'room_id', v_room.id,
      'reason', 'long_playing_timeout',
      'group_id', v_room.group_id,
      'message_id', v_room.message_id,
      'owner_choice', v_room.owner_choice,  -- 🎯 添加选择信息
      'opponent_choice', v_room.opponent_choice
    ));

    RAISE NOTICE '猜拳房间超时解散: room_id=%, owner_id=%, opponent_id=%, bet_amount=%, reason=长时间残留清理',
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

-- -----------------------------------------------------------------------------
-- 3. 更新 join_rps_room 函数，确保在状态变为 playing 时更新 updated_at
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.join_rps_room(
  p_room_id UUID,
  p_user_id UUID
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_room RECORD;
  v_user_balance DECIMAL;
BEGIN
  -- ✅ 修复：允许 service_role 或本人
  IF auth.role() != 'service_role' AND p_user_id != auth.uid() THEN 
    RETURN json_build_object('success', false, 'message', '非法操作'); 
  END IF;
  
  -- 1. 获取房间信息
  SELECT * INTO v_room
  FROM rps_rooms
  WHERE id = p_room_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN json_build_object('success', false, 'message', '房间不存在');
  END IF;

  IF v_room.status != 'waiting' THEN
    RETURN json_build_object('success', false, 'message', '游戏已开始或已结束');
  END IF;

  -- 2. 检查是否是房主自己
  IF v_room.owner_id = p_user_id THEN
    RETURN json_build_object('success', false, 'message', '不能和自己玩');
  END IF;

  -- 3. 检查是否已满员
  IF v_room.opponent_id IS NOT NULL THEN
    RETURN json_build_object('success', false, 'message', '房间已满，请等待下一局');
  END IF;

  -- 4. 检查余额
  SELECT balance_coins INTO v_user_balance
  FROM profiles
  WHERE id = p_user_id
  FOR UPDATE;

  IF v_user_balance < v_room.bet_amount THEN
    RETURN json_build_object('success', false, 'message', '余额不足，当前余额: ' || v_user_balance || ' 抖币');
  END IF;

  -- 5. 扣除本金
  UPDATE profiles
  SET balance_coins = balance_coins - v_room.bet_amount,
      updated_at = NOW()
  WHERE id = p_user_id;

  -- 6. 加入房间，状态变为 playing，同时更新 updated_at（🎯 关键修复）
  UPDATE rps_rooms
  SET opponent_id = p_user_id,
      status = 'playing',
      updated_at = NOW()  -- 🎯 记录进入 playing 状态的时间
  WHERE id = p_room_id;

  RETURN json_build_object(
    'success', true,
    'message', '成功加入游戏'
  );
END;
$$;

-- -----------------------------------------------------------------------------
-- 4. 添加定时任务自动执行超时检查（每30秒执行一次）
-- -----------------------------------------------------------------------------
-- 注意：需要先确保 pg_cron 扩展已启用
CREATE EXTENSION IF NOT EXISTS pg_cron;

-- 删除可能存在的旧任务
SELECT cron.unschedule(jobid) FROM cron.job WHERE jobname = 'check-rps-timeout-job';

-- 添加新的定时任务（每分钟执行一次）
-- 注意：PostgreSQL cron 不支持秒级调度，使用每分钟执行一次
DO $$
DECLARE
  v_job_id INT;
BEGIN
  -- 删除可能存在的旧任务
  SELECT jobid INTO v_job_id FROM cron.job WHERE jobname = 'check-rps-timeout-job';
  IF v_job_id IS NOT NULL THEN
    PERFORM cron.unschedule(v_job_id);
  END IF;
  
  -- 添加新的定时任务（每分钟执行一次）
  PERFORM cron.schedule(
      'check-rps-timeout-job',
      '* * * * *',  -- 每分钟执行一次
      $$ SELECT public.check_rps_timeout() $$
  );
END $$;

-- 授予权限
GRANT EXECUTE ON FUNCTION public.check_rps_timeout() TO service_role;

-- 注释
COMMENT ON FUNCTION public.check_rps_timeout() IS '检查并处理超时的猜拳房间：等待加入30秒超时（基于created_at），出手阶段60秒超时（基于updated_at），长时间残留5分钟超时（基于updated_at）';
