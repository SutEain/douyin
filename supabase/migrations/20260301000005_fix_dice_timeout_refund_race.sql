-- 🎯 修复骰子超时退款与结算的竞态：已结算的房间不能再被超时任务退款
-- 问题：超时任务 SELECT 时房间是 rolling，结算在之后把房间改为 finished 并发奖；
--       任务循环里仍按 id 更新并退款，导致「先发奖再退款」重复入账。
-- 修复：更新房间状态时加上条件 status IN ('waiting','rolling')，只有仍为未结束时才更新并退款。

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
SET search_path TO 'public'
AS $$
DECLARE
  r RECORD;
  p RECORD;
  v_owner_nickname TEXT;
  v_bet_amount NUMERIC;
  v_updated_id UUID;  -- 仅当成功把房间从 waiting/rolling 改为 cancelled 时才非空
BEGIN
  FOR r IN (
    SELECT dr.id, dr.group_id, dr.current_count, dr.owner_id, dr.bet_amount
    FROM dice_rooms dr
    WHERE dr.status NOT IN ('finished', 'cancelled')
      AND dr.created_at < NOW() - INTERVAL '3 minutes'
    FOR UPDATE SKIP LOCKED
  ) LOOP
    v_bet_amount := r.bet_amount;

    -- 🎯 关键：仅当房间仍为 waiting/rolling 时才更新为 cancelled；已 finished 的跳过（避免重复退款）
    UPDATE dice_rooms
    SET status = 'cancelled',
        updated_at = NOW()
    WHERE id = r.id
      AND status IN ('waiting', 'rolling')
    RETURNING id INTO v_updated_id;

    IF v_updated_id IS NULL THEN
      -- 房间已被结算或已取消，跳过退款，不返回该房间
      CONTINUE;
    END IF;

    SELECT nickname INTO v_owner_nickname
    FROM profiles
    WHERE id = r.owner_id;

    FOR p IN (
      SELECT drp.user_id
      FROM dice_room_players drp
      WHERE drp.room_id = r.id
    ) LOOP
      UPDATE profiles
      SET balance_coins = balance_coins + v_bet_amount,
          updated_at = NOW()
      WHERE id = p.user_id;

      INSERT INTO coin_transactions (
        user_id, amount, balance_after, type, description, related_id
      )
      SELECT
        p.user_id,
        v_bet_amount,
        balance_coins,
        'dice_refund',
        '游戏超时自动退款（3分钟）: 房ID ' || r.id,
        r.id
      FROM profiles
      WHERE id = p.user_id;
    END LOOP;

    room_id := r.id;
    group_id := r.group_id;
    message_id := NULL;
    current_count := r.current_count;
    owner_nickname := v_owner_nickname;
    RETURN NEXT;
  END LOOP;
END;
$$;

COMMENT ON FUNCTION public.check_and_refund_expired_dice_rooms() IS '检查并处理过期骰子房间；仅对仍为 waiting/rolling 的房间退款，避免与结算竞态导致重复入账';

-- 同步修复定时任务调用的 refund_expired_dice_rooms()
CREATE OR REPLACE FUNCTION public.refund_expired_dice_rooms()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  r RECORD;
  p RECORD;
  v_bet_amount NUMERIC;
  v_updated_id UUID;
BEGIN
  FOR r IN (
    SELECT dr.id, dr.bet_amount
    FROM dice_rooms dr
    WHERE dr.status NOT IN ('finished', 'cancelled')
      AND dr.created_at < NOW() - INTERVAL '3 minutes'
    FOR UPDATE SKIP LOCKED
  ) LOOP
    v_bet_amount := r.bet_amount;

    UPDATE dice_rooms
    SET status = 'cancelled',
        updated_at = NOW()
    WHERE id = r.id
      AND status IN ('waiting', 'rolling')
    RETURNING id INTO v_updated_id;

    IF v_updated_id IS NULL THEN
      CONTINUE;
    END IF;

    FOR p IN (
      SELECT drp.user_id FROM dice_room_players drp WHERE drp.room_id = r.id
    ) LOOP
      UPDATE profiles
      SET balance_coins = balance_coins + v_bet_amount, updated_at = NOW()
      WHERE id = p.user_id;

      INSERT INTO coin_transactions (user_id, amount, balance_after, type, description, related_id)
      SELECT p.user_id, v_bet_amount, balance_coins, 'dice_refund',
             '游戏超时自动退款（3分钟）: 房ID ' || r.id, r.id
      FROM profiles WHERE id = p.user_id;
    END LOOP;
  END LOOP;
END;
$function$;

COMMENT ON FUNCTION public.refund_expired_dice_rooms() IS '定时任务调用；仅对仍为 waiting/rolling 的房间退款，避免与结算竞态导致重复入账';
