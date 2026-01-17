-- 🎯 修复骰子游戏 rolling 状态超时检查问题
-- 问题：
-- 1. rolling 状态的超时检查使用 updated_at，但 startRolling 过程中会更新 updated_at
-- 2. 如果 startRolling 执行时间很长，updated_at 被更新，超时检查无法捕获
-- 3. 如果 startRolling 过程中出错，refund_dice_room 调用失败，房间会卡在 rolling 状态
-- 修复：
-- 1. 改进超时检查逻辑，对 rolling 状态使用 created_at 判断（从房间创建开始计算）
-- 2. 增加对长时间残留 rolling 状态的检查（超过5分钟）
-- 3. 确保超时检查能捕获所有异常情况

-- -----------------------------------------------------------------------------
-- 1. 改进 check_and_refund_expired_dice_rooms() 函数
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
  -- 🎯 修复：改进超时检查逻辑
  -- 1. waiting 状态：检查 expired_at（30秒过期）
  -- 2. rolling 状态：检查 created_at（从房间创建开始，超过5分钟视为超时）
  --    使用 created_at 而不是 updated_at，因为 startRolling 过程中会更新 updated_at
  FOR r IN (
    SELECT dr.id, dr.group_id, dr.current_count, dr.owner_id, dr.bet_amount
    FROM dice_rooms dr
    WHERE (dr.status = 'waiting' AND dr.expired_at < NOW())
       OR (dr.status = 'rolling' AND dr.created_at < NOW() - INTERVAL '5 minutes')
    FOR UPDATE SKIP LOCKED
  ) LOOP
    v_bet_amount := r.bet_amount;
    
    -- 获取房主昵称
    SELECT nickname INTO v_owner_nickname
    FROM profiles
    WHERE id = r.owner_id;
    
    -- 更新房间状态（dice_rooms 表没有 finished_at 字段）
    UPDATE dice_rooms 
    SET status = 'cancelled', 
        updated_at = NOW()
    WHERE id = r.id;
    
    -- 退还所有已加入玩家的钱（使用表别名避免变量名冲突）
    FOR p IN (SELECT drp.user_id FROM dice_room_players drp WHERE drp.room_id = r.id) LOOP
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
    message_id := NULL; -- dice_rooms 表没有 message_id 字段
    current_count := r.current_count;
    owner_nickname := v_owner_nickname;
    RETURN NEXT;
  END LOOP;
END;
$$;

-- -----------------------------------------------------------------------------
-- 2. 改进 refund_expired_dice_rooms() 函数（定时任务调用）
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
    -- 🎯 修复：使用相同的超时检查逻辑
    FOR r IN (
        SELECT dr.id, dr.bet_amount, dr.group_id, dr.current_count, dr.owner_id
        FROM dice_rooms dr
        WHERE (dr.status = 'waiting' AND dr.expired_at < NOW())
           OR (dr.status = 'rolling' AND dr.created_at < NOW() - INTERVAL '5 minutes')
        FOR UPDATE SKIP LOCKED
    ) LOOP
        v_bet_amount := r.bet_amount;
        
        -- 更新房间状态（dice_rooms 表没有 finished_at 字段）
        UPDATE dice_rooms SET status = 'cancelled' WHERE id = r.id;
        
        -- 退还所有已加入玩家的钱（使用表别名避免变量名冲突）
        FOR p IN (SELECT drp.user_id FROM dice_room_players drp WHERE drp.room_id = r.id) LOOP
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

-- 授予权限
GRANT EXECUTE ON FUNCTION public.check_and_refund_expired_dice_rooms() TO service_role;
GRANT EXECUTE ON FUNCTION public.refund_expired_dice_rooms() TO service_role;

-- 注释
COMMENT ON FUNCTION public.check_and_refund_expired_dice_rooms() IS '检查并处理过期骰子房间，返回需要发送消息的房间信息（供 Edge Function 调用，会发送消息）。修复：rolling 状态使用 created_at 判断超时（5分钟）';
COMMENT ON FUNCTION public.refund_expired_dice_rooms() IS '自动清理过期骰子房间并退款（定时任务调用，不发送消息）。修复：rolling 状态使用 created_at 判断超时（5分钟）';
