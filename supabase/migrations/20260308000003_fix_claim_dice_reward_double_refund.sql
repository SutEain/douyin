-- 🎯 修复：claim_dice_reward 与超时退款叠加导致重复入账
-- 问题：claim_dice_reward 发奖后未把房间置为 finished，超时任务仍对全员退款，赢家可既拿 reward 又拿 refund。
-- 修复：超时退款时只退「未领奖」的玩家（is_winner = FALSE 或 NULL），已通过 claim_dice_reward 领奖的不再退。

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
  v_updated_id UUID;
BEGIN
  FOR r IN (
    SELECT dr.id, dr.group_id, dr.current_count, dr.owner_id, dr.bet_amount
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

    SELECT nickname INTO v_owner_nickname
    FROM profiles
    WHERE id = r.owner_id;

    -- 🎯 只退未领奖的玩家，已通过 claim_dice_reward 领奖的（is_winner=TRUE）不再退，避免 reward+refund 重复入账
    FOR p IN (
      SELECT drp.user_id
      FROM dice_room_players drp
      WHERE drp.room_id = r.id
        AND (drp.is_winner = FALSE OR drp.is_winner IS NULL)
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

COMMENT ON FUNCTION public.check_and_refund_expired_dice_rooms() IS '检查并处理过期骰子房间；仅对 waiting/rolling 退款，且只退未领奖玩家(is_winner=FALSE/NULL)，避免与 claim_dice_reward 叠加重复入账';

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

    -- 🎯 只退未领奖的玩家
    FOR p IN (
      SELECT drp.user_id FROM dice_room_players drp
      WHERE drp.room_id = r.id
        AND (drp.is_winner = FALSE OR drp.is_winner IS NULL)
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

COMMENT ON FUNCTION public.refund_expired_dice_rooms() IS '定时任务调用；仅对 waiting/rolling 退款，且只退未领奖玩家，避免与 claim_dice_reward 叠加重复入账';
