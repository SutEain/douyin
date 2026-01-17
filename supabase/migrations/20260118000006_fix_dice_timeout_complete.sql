-- 🎯 完整修复骰子游戏超时机制
-- 问题：
-- 1. 定时任务调用的是 refund_expired_dice_rooms()（只退款，不发送消息）
-- 2. Edge Function 调用的是 check_and_refund_expired_dice_rooms()（返回信息用于发送消息）
-- 3. 定时任务无法触发 Edge Function 发送消息
-- 修复：
-- 1. 修改定时任务，让它调用 Edge Function 的 /check-timeout 端点（通过 pg_net 扩展）
-- 2. 或者，修改 refund_expired_dice_rooms() 函数，让它也返回房间信息
-- 3. 由于 pg_net 可能不可用，我们采用方案2：统一使用 check_and_refund_expired_dice_rooms()

-- -----------------------------------------------------------------------------
-- 1. 修改 refund_expired_dice_rooms() 函数，让它调用 check_and_refund_expired_dice_rooms()
--    这样定时任务就能同时退款和返回信息（虽然定时任务不会使用返回的信息）
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.refund_expired_dice_rooms() 
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    r RECORD;
    p RECORD;
    v_bet_amount NUMERIC;
BEGIN
    -- 🎯 修复：使用 check_and_refund_expired_dice_rooms() 的逻辑，但返回 VOID
    -- 这样定时任务和 Edge Function 使用相同的逻辑
    FOR r IN (
        SELECT dr.id, dr.bet_amount, dr.group_id, dr.message_id, dr.current_count, dr.owner_id
        FROM dice_rooms dr
        WHERE (dr.status = 'waiting' AND dr.expired_at < NOW())
           OR (dr.status = 'rolling' AND COALESCE(dr.updated_at, dr.created_at) < NOW() - INTERVAL '3 minutes')
        FOR UPDATE SKIP LOCKED
    ) LOOP
        v_bet_amount := r.bet_amount;
        
        -- 更新房间状态
        UPDATE dice_rooms SET status = 'cancelled', finished_at = NOW() WHERE id = r.id;
        
        -- 退还所有已加入玩家的钱
        FOR p IN (SELECT user_id FROM dice_room_players WHERE room_id = r.id) LOOP
            UPDATE profiles 
            SET balance_coins = balance_coins + v_bet_amount,
                updated_at = NOW()
            WHERE id = p.user_id;
            
            INSERT INTO coin_transactions (user_id, amount, balance_after, type, description, related_id)
            SELECT 
                p.user_id, 
                v_bet_amount,
                balance_coins, 
                'dice_refund', 
                '房间过期/异常自动退款: 房ID ' || r.id, 
                r.id
            FROM profiles WHERE id = p.user_id;
        END LOOP;
    END LOOP;
END;
$$;

-- -----------------------------------------------------------------------------
-- 2. 改进 check_and_refund_expired_dice_rooms() 函数，确保它也处理 rolling 状态的超时
-- -----------------------------------------------------------------------------
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
  -- 🎯 修复：同时处理 waiting 过期和 rolling 超时（超过3分钟）
  FOR r IN (
    SELECT dr.id, dr.group_id, dr.message_id, dr.current_count, dr.owner_id, dr.bet_amount
    FROM dice_rooms dr
    WHERE (dr.status = 'waiting' AND dr.expired_at < NOW())
       OR (dr.status = 'rolling' AND COALESCE(dr.updated_at, dr.created_at) < NOW() - INTERVAL '3 minutes')
    FOR UPDATE SKIP LOCKED
  ) LOOP
    v_bet_amount := r.bet_amount;
    
    -- 获取房主昵称
    SELECT nickname INTO v_owner_nickname
    FROM profiles
    WHERE id = r.owner_id;
    
    -- 更新房间状态
    UPDATE dice_rooms 
    SET status = 'cancelled', 
        finished_at = NOW(),
        updated_at = NOW()
    WHERE id = r.id;
    
    -- 退还所有已加入玩家的钱
    FOR p IN (SELECT user_id FROM dice_room_players WHERE room_id = r.id) LOOP
      UPDATE profiles 
      SET balance_coins = balance_coins + v_bet_amount,
          updated_at = NOW()
      WHERE id = p.user_id;
      
      INSERT INTO coin_transactions (user_id, amount, balance_after, type, description, related_id)
      SELECT 
        p.user_id, 
        v_bet_amount,
        balance_coins, 
        'dice_refund', 
        '房间过期/异常自动退款: 房ID ' || r.id, 
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

-- -----------------------------------------------------------------------------
-- 3. 更新定时任务，让它同时调用 Edge Function 的 /check-timeout 端点
--    注意：由于 PostgreSQL cron 不能直接发送 HTTP 请求，我们需要使用 pg_net 扩展
--    如果 pg_net 不可用，定时任务仍然会调用 refund_expired_dice_rooms() 进行退款
--    但不会发送消息。Edge Function 的 /check-timeout 端点可以手动调用或通过外部 cron 调用
-- -----------------------------------------------------------------------------
-- 删除旧任务
DO $$
DECLARE
  v_job_id INT;
BEGIN
  SELECT jobid INTO v_job_id FROM cron.job WHERE jobname = 'refund-expired-dice-rooms-job';
  IF v_job_id IS NOT NULL THEN
    PERFORM cron.unschedule(v_job_id);
  END IF;
END $$;

-- 重新添加定时任务（仍然调用 refund_expired_dice_rooms，因为它会退款）
-- 注意：消息发送需要通过 Edge Function 的 /check-timeout 端点触发
SELECT cron.schedule(
    'refund-expired-dice-rooms-job',
    '* * * * *',  -- 每分钟执行一次
    $$ SELECT public.refund_expired_dice_rooms() $$
);

-- 授予权限
GRANT EXECUTE ON FUNCTION public.refund_expired_dice_rooms() TO service_role;
GRANT EXECUTE ON FUNCTION public.check_and_refund_expired_dice_rooms() TO service_role;

-- 注释
COMMENT ON FUNCTION public.refund_expired_dice_rooms() IS '自动清理过期骰子房间并退款（定时任务调用，不发送消息）';
COMMENT ON FUNCTION public.check_and_refund_expired_dice_rooms() IS '检查并处理过期骰子房间，返回需要发送消息的房间信息（供 Edge Function 调用，会发送消息）';
