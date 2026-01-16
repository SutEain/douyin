-- 🎯 第五波修复：兼容后台服务 (Service Role) 的业务 RPC 加固
-- 修复：允许 Service Role (Bot/Server) 代表用户执行操作，同时保持普通用户的身份校验。

DO $$
BEGIN

-- -----------------------------------------------------------------------------
-- 1. 修复 资金/红包 RPC
-- -----------------------------------------------------------------------------
-- 打赏
CREATE OR REPLACE FUNCTION public.process_gift_reward(sender_id UUID, receiver_id UUID, gift_amount DECIMAL, room_or_video_id UUID, gift_type TEXT, gift_name TEXT)
RETURNS JSON LANGUAGE plpgsql SECURITY DEFINER AS $func$
DECLARE current_sender_balance DECIMAL; receiver_gain DECIMAL; final_sender_balance DECIMAL; final_receiver_balance DECIMAL; split_percentage INT;
BEGIN
    -- ✅ 修复：允许 service_role 或本人
    IF auth.role() != 'service_role' AND sender_id != auth.uid() THEN RETURN json_build_object('success', false, 'message', '非法操作'); END IF;
    IF gift_amount <= 0 THEN RETURN json_build_object('success', false, 'message', '打赏金额必须大于 0'); END IF;
    SELECT COALESCE(value_int, 50) INTO split_percentage FROM public.system_settings WHERE id = 'gift_split_percentage';
    SELECT balance_coins INTO current_sender_balance FROM public.profiles WHERE id = sender_id FOR UPDATE;
    IF current_sender_balance < gift_amount THEN RETURN json_build_object('success', false, 'message', '余额不足'); END IF;
    receiver_gain := gift_amount * (split_percentage / 100.0);
    UPDATE public.profiles SET balance_coins = balance_coins - gift_amount WHERE id = sender_id RETURNING balance_coins INTO final_sender_balance;
    UPDATE public.profiles SET balance_coins = balance_coins + receiver_gain WHERE id = receiver_id RETURNING balance_coins INTO final_receiver_balance;
    INSERT INTO public.coin_transactions (user_id, amount, balance_after, type, description, related_id) VALUES (sender_id, -gift_amount, final_sender_balance, 'gift_out', '打赏礼物: ' || gift_name, room_or_video_id);
    INSERT INTO public.coin_transactions (user_id, amount, balance_after, type, description, related_id) VALUES (receiver_id, receiver_gain, final_receiver_balance, 'gift_in', '收到打赏: ' || gift_name, room_or_video_id);
    RETURN json_build_object('success', true, 'sender_balance', final_sender_balance, 'receiver_balance', final_receiver_balance);
END; $func$;

-- 直播红包
CREATE OR REPLACE FUNCTION public.send_live_red_packet(p_room_id UUID, p_sender_id UUID, p_total_coins INT, p_total_count INT, p_packet_type TEXT, p_countdown_seconds INT, p_claim_conditions JSONB, p_unlock_at TIMESTAMP WITH TIME ZONE, p_expires_at TIMESTAMP WITH TIME ZONE)
RETURNS JSON LANGUAGE plpgsql SECURITY DEFINER AS $func$
DECLARE v_balance NUMERIC; v_packet_id UUID; v_balance_after NUMERIC;
BEGIN
    IF auth.role() != 'service_role' AND p_sender_id != auth.uid() THEN RETURN json_build_object('success', false, 'message', '非法操作'); END IF;
    SELECT balance_coins INTO v_balance FROM public.profiles WHERE id = p_sender_id FOR UPDATE;
    IF v_balance < p_total_coins THEN RETURN json_build_object('success', false, 'message', '余额不足'); END IF;
    UPDATE public.profiles SET balance_coins = balance_coins - p_total_coins WHERE id = p_sender_id RETURNING balance_coins INTO v_balance_after;
    INSERT INTO public.live_red_packets (room_id, sender_id, total_coins, total_count, packet_type, countdown_seconds, claim_conditions, remaining_coins, remaining_count, status, unlock_at, expires_at) VALUES (p_room_id, p_sender_id, p_total_coins, p_total_count, p_packet_type, p_countdown_seconds, p_claim_conditions, p_total_coins, p_total_count, 'pending', p_unlock_at, p_expires_at) RETURNING id INTO v_packet_id;
    INSERT INTO public.coin_transactions (user_id, amount, balance_after, type, description, related_id) VALUES (p_sender_id, -p_total_coins, v_balance_after, 'red_packet_send', '直播间发放红包', v_packet_id);
    RETURN json_build_object('success', true, 'packet_id', v_packet_id);
END; $func$;

-- -----------------------------------------------------------------------------
-- 2. 修复 游戏/群红包 RPC
-- -----------------------------------------------------------------------------
-- RPS 创建
CREATE OR REPLACE FUNCTION public.create_rps_room(p_owner_id UUID, p_group_id BIGINT, p_bet_amount DECIMAL)
RETURNS JSON LANGUAGE plpgsql SECURITY DEFINER AS $func$
DECLARE v_owner_balance DECIMAL; v_room_id UUID; v_active_room_count INT;
BEGIN
    IF auth.role() != 'service_role' AND p_owner_id != auth.uid() THEN RETURN json_build_object('success', false, 'message', '非法操作'); END IF;
    SELECT COUNT(*) INTO v_active_room_count FROM rps_rooms WHERE group_id = p_group_id AND status IN ('waiting', 'playing');
    IF v_active_room_count > 0 THEN RETURN json_build_object('success', false, 'message', '本群已有进行中的游戏'); END IF;
    SELECT balance_coins INTO v_owner_balance FROM profiles WHERE id = p_owner_id FOR UPDATE;
    IF v_owner_balance < p_bet_amount THEN RETURN json_build_object('success', false, 'message', '余额不足'); END IF;
    UPDATE profiles SET balance_coins = balance_coins - p_bet_amount, updated_at = NOW() WHERE id = p_owner_id;
    INSERT INTO rps_rooms (owner_id, group_id, bet_amount, status) VALUES (p_owner_id, p_group_id, p_bet_amount, 'waiting') RETURNING id INTO v_room_id;
    RETURN json_build_object('success', true, 'room_id', v_room_id);
END; $func$;

-- RPS 加入
CREATE OR REPLACE FUNCTION public.join_rps_room(p_room_id UUID, p_user_id UUID)
RETURNS JSON LANGUAGE plpgsql SECURITY DEFINER AS $func$
DECLARE v_room RECORD; v_user_balance DECIMAL;
BEGIN
    IF auth.role() != 'service_role' AND p_user_id != auth.uid() THEN RETURN json_build_object('success', false, 'message', '非法操作'); END IF;
    SELECT * INTO v_room FROM rps_rooms WHERE id = p_room_id FOR UPDATE;
    IF NOT FOUND THEN RETURN json_build_object('success', false, 'message', '房间不存在'); END IF;
    IF v_room.status != 'waiting' THEN RETURN json_build_object('success', false, 'message', '游戏已开始或已结束'); END IF;
    SELECT balance_coins INTO v_user_balance FROM profiles WHERE id = p_user_id FOR UPDATE;
    IF v_user_balance < v_room.bet_amount THEN RETURN json_build_object('success', false, 'message', '余额不足'); END IF;
    UPDATE profiles SET balance_coins = balance_coins - v_room.bet_amount, updated_at = NOW() WHERE id = p_user_id;
    UPDATE rps_rooms SET opponent_id = p_user_id, status = 'playing' WHERE id = p_room_id;
    RETURN json_build_object('success', true, 'message', '成功加入游戏');
END; $func$;

-- 群红包创建
CREATE OR REPLACE FUNCTION public.create_group_red_packet(p_sender_id UUID, p_group_id BIGINT, p_type TEXT, p_total_amount NUMERIC, p_total_count INT, p_target_user_id UUID DEFAULT NULL)
RETURNS JSON LANGUAGE plpgsql SECURITY DEFINER AS $func$
DECLARE v_current_balance NUMERIC; v_final_balance NUMERIC; v_packet_id UUID;
BEGIN
    IF auth.role() != 'service_role' AND p_sender_id != auth.uid() THEN RETURN json_build_object('success', false, 'message', '非法操作'); END IF;
    SELECT balance_coins INTO v_current_balance FROM public.profiles WHERE id = p_sender_id FOR UPDATE;
    IF v_current_balance < p_total_amount THEN RETURN json_build_object('success', false, 'message', '余额不足'); END IF;
    UPDATE public.profiles SET balance_coins = balance_coins - p_total_amount WHERE id = p_sender_id RETURNING balance_coins INTO v_final_balance;
    INSERT INTO public.group_red_packets (sender_id, group_id, type, total_amount, total_count, remaining_amount, remaining_count, target_user_id) VALUES (p_sender_id, p_group_id, p_type, p_total_amount, p_total_count, p_total_amount, p_total_count, p_target_user_id) RETURNING id INTO v_packet_id;
    INSERT INTO public.coin_transactions (user_id, amount, balance_after, type, description, related_id) VALUES (p_sender_id, -p_total_amount, v_final_balance, 'hb_out', '群红包发出', v_packet_id);
    RETURN json_build_object('success', true, 'packet_id', v_packet_id);
END; $func$;

-- 抢群红包
CREATE OR REPLACE FUNCTION public.claim_group_red_packet(p_packet_id UUID, p_user_id UUID)
RETURNS JSON LANGUAGE plpgsql SECURITY DEFINER AS $func$
DECLARE v_packet RECORD; v_claim_amount NUMERIC; v_final_balance NUMERIC;
BEGIN
    IF auth.role() != 'service_role' AND p_user_id != auth.uid() THEN RETURN json_build_object('success', false, 'message', '非法操作'); END IF;
    SELECT * INTO v_packet FROM public.group_red_packets WHERE id = p_packet_id FOR UPDATE;
    IF NOT FOUND THEN RETURN json_build_object('success', false, 'message', '红包不存在'); END IF;
    IF v_packet.status <> 'active' OR v_packet.remaining_count <= 0 THEN RETURN json_build_object('success', false, 'message', '红包已结束'); END IF;
    IF EXISTS (SELECT 1 FROM public.group_red_packet_claims WHERE packet_id = p_packet_id AND user_id = p_user_id) THEN RETURN json_build_object('success', false, 'message', '已领过'); END IF;
    v_claim_amount := CASE WHEN v_packet.remaining_count = 1 THEN v_packet.remaining_amount ELSE ROUND(v_packet.total_amount / v_packet.total_count, 2) END;
    UPDATE public.group_red_packets SET remaining_amount = remaining_amount - v_claim_amount, remaining_count = remaining_count - 1, status = CASE WHEN remaining_count - 1 = 0 THEN 'completed' ELSE 'active' END, updated_at = NOW() WHERE id = p_packet_id;
    INSERT INTO public.group_red_packet_claims (packet_id, user_id, amount) VALUES (p_packet_id, p_user_id, v_claim_amount);
    UPDATE public.profiles SET balance_coins = balance_coins + v_claim_amount WHERE id = p_user_id RETURNING balance_coins INTO v_final_balance;
    RETURN json_build_object('success', true, 'amount', v_claim_amount);
END; $func$;

-- -----------------------------------------------------------------------------
-- 3. 修复 领奖类 RPC
-- -----------------------------------------------------------------------------
-- 观看奖励
CREATE OR REPLACE FUNCTION public.claim_watch_time_reward(p_user_id UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER AS $func$
DECLARE v_today DATE := (NOW() AT TIME ZONE 'Asia/Shanghai')::DATE; v_total_seconds INT := 0; v_reward_amount NUMERIC := 0; v_final_balance NUMERIC; v_claimed_5min BOOLEAN;
BEGIN
    IF auth.role() != 'service_role' AND p_user_id != auth.uid() THEN RETURN jsonb_build_object('success', false, 'message', '非法操作'); END IF;
    SELECT COALESCE(total_seconds, 0) INTO v_total_seconds FROM public.user_daily_watch_time WHERE user_id = p_user_id AND watch_date = v_today;
    IF v_total_seconds < 300 THEN RETURN jsonb_build_object('success', false, 'message', '时长不足'); END IF;
    UPDATE public.profiles SET balance_coins = balance_coins + 5.00 WHERE id = p_user_id RETURNING balance_coins INTO v_final_balance;
    RETURN jsonb_build_object('success', true, 'reward_amount', 5.00, 'balance_after', v_final_balance);
END; $func$;

    RAISE NOTICE 'All business RPCs fixed for service_role compatibility.';
END $$;
