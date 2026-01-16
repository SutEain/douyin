-- 🎯 第三波加固：封死游戏、红包、社交类 RPC 函数的身份注入漏洞
-- 修复：
-- 1. RPS (猜拳): 强制所有玩家操作必须为当前登录用户
-- 2. Dice (骰子): 强制所有玩家操作必须为当前登录用户
-- 3. Red Packet (群红包): 强制发红包和抢红包必须为当前登录用户
-- 4. Collection (收藏夹): 强制操作者必须为当前登录用户

DO $$
BEGIN

-- -----------------------------------------------------------------------------
-- 1. 修复 RPS 游戏 (猜拳)
-- -----------------------------------------------------------------------------
-- 创建 RPS
DROP FUNCTION IF EXISTS public.create_rps_room(UUID, BIGINT, DECIMAL);
CREATE OR REPLACE FUNCTION public.create_rps_room(p_owner_id UUID, p_group_id BIGINT, p_bet_amount DECIMAL)
RETURNS JSON LANGUAGE plpgsql SECURITY DEFINER AS $func$
DECLARE v_owner_balance DECIMAL; v_room_id UUID; v_active_room_count INT;
BEGIN
    IF p_owner_id != auth.uid() THEN RETURN json_build_object('success', false, 'message', '非法操作'); END IF;
    IF p_bet_amount < 5 OR p_bet_amount > 10000 THEN RETURN json_build_object('success', false, 'message', '投注金额限制为 5 - 10000'); END IF;
    SELECT COUNT(*) INTO v_active_room_count FROM rps_rooms WHERE group_id = p_group_id AND status IN ('waiting', 'playing');
    IF v_active_room_count > 0 THEN RETURN json_build_object('success', false, 'message', '本群已有进行中的游戏'); END IF;
    SELECT balance_coins INTO v_owner_balance FROM profiles WHERE id = p_owner_id FOR UPDATE;
    IF v_owner_balance < p_bet_amount THEN RETURN json_build_object('success', false, 'message', '余额不足'); END IF;
    UPDATE profiles SET balance_coins = balance_coins - p_bet_amount, updated_at = NOW() WHERE id = p_owner_id;
    INSERT INTO rps_rooms (owner_id, group_id, bet_amount, status) VALUES (p_owner_id, p_group_id, p_bet_amount, 'waiting') RETURNING id INTO v_room_id;
    RETURN json_build_object('success', true, 'room_id', v_room_id);
END; $func$;

-- 加入 RPS
DROP FUNCTION IF EXISTS public.join_rps_room(UUID, UUID);
CREATE OR REPLACE FUNCTION public.join_rps_room(p_room_id UUID, p_user_id UUID)
RETURNS JSON LANGUAGE plpgsql SECURITY DEFINER AS $func$
DECLARE v_room RECORD; v_user_balance DECIMAL;
BEGIN
    IF p_user_id != auth.uid() THEN RETURN json_build_object('success', false, 'message', '非法操作'); END IF;
    SELECT * INTO v_room FROM rps_rooms WHERE id = p_room_id FOR UPDATE;
    IF NOT FOUND THEN RETURN json_build_object('success', false, 'message', '房间不存在'); END IF;
    IF v_room.status != 'waiting' THEN RETURN json_build_object('success', false, 'message', '游戏已开始或已结束'); END IF;
    IF v_room.owner_id = p_user_id THEN RETURN json_build_object('success', false, 'message', '不能和自己玩'); END IF;
    IF v_room.opponent_id IS NOT NULL THEN RETURN json_build_object('success', false, 'message', '房间已满'); END IF;
    SELECT balance_coins INTO v_user_balance FROM profiles WHERE id = p_user_id FOR UPDATE;
    IF v_user_balance < v_room.bet_amount THEN RETURN json_build_object('success', false, 'message', '余额不足'); END IF;
    UPDATE profiles SET balance_coins = balance_coins - v_room.bet_amount, updated_at = NOW() WHERE id = p_user_id;
    UPDATE rps_rooms SET opponent_id = p_user_id, status = 'playing' WHERE id = p_room_id;
    RETURN json_build_object('success', true, 'message', '成功加入游戏');
END; $func$;

-- RPS 出手
DROP FUNCTION IF EXISTS public.save_rps_choice(UUID, UUID, TEXT);
CREATE OR REPLACE FUNCTION public.save_rps_choice(p_room_id UUID, p_user_id UUID, p_choice TEXT)
RETURNS JSON LANGUAGE plpgsql SECURITY DEFINER AS $func$
DECLARE v_room RECORD; v_is_owner BOOLEAN;
BEGIN
    IF p_user_id != auth.uid() THEN RETURN json_build_object('success', false, 'message', '非法操作'); END IF;
    SELECT * INTO v_room FROM rps_rooms WHERE id = p_room_id FOR UPDATE;
    IF NOT FOUND THEN RETURN json_build_object('success', false, 'message', '房间不存在'); END IF;
    IF v_room.status != 'playing' THEN RETURN json_build_object('success', false, 'message', '游戏未开始或已结束'); END IF;
    IF v_room.owner_id = p_user_id THEN v_is_owner := true; ELSIF v_room.opponent_id = p_user_id THEN v_is_owner := false; ELSE RETURN json_build_object('success', false, 'message', '你不是玩家'); END IF;
    IF v_is_owner AND v_room.owner_choice IS NOT NULL THEN RETURN json_build_object('success', false, 'message', '不能更改选择'); END IF;
    IF NOT v_is_owner AND v_room.opponent_choice IS NOT NULL THEN RETURN json_build_object('success', false, 'message', '不能更改选择'); END IF;
    IF v_is_owner THEN UPDATE rps_rooms SET owner_choice = p_choice WHERE id = p_room_id; ELSE UPDATE rps_rooms SET opponent_choice = p_choice WHERE id = p_room_id; END IF;
    RETURN json_build_object('success', true, 'message', '出手成功');
END; $func$;

-- 取消 RPS
DROP FUNCTION IF EXISTS public.cancel_rps_room(UUID, UUID);
CREATE OR REPLACE FUNCTION public.cancel_rps_room(p_room_id UUID, p_user_id UUID)
RETURNS JSON LANGUAGE plpgsql SECURITY DEFINER AS $func$
DECLARE v_room RECORD;
BEGIN
    IF p_user_id != auth.uid() THEN RETURN json_build_object('success', false, 'message', '非法操作'); END IF;
    SELECT * INTO v_room FROM rps_rooms WHERE id = p_room_id FOR UPDATE;
    IF NOT FOUND THEN RETURN json_build_object('success', false, 'message', '房间不存在'); END IF;
    IF v_room.owner_id != p_user_id THEN RETURN json_build_object('success', false, 'message', '只有房主能取消'); END IF;
    IF v_room.status != 'waiting' THEN RETURN json_build_object('success', false, 'message', '游戏已开始'); END IF;
    UPDATE profiles SET balance_coins = balance_coins + v_room.bet_amount, updated_at = NOW() WHERE id = v_room.owner_id;
    UPDATE rps_rooms SET status = 'cancelled', finished_at = NOW() WHERE id = p_room_id;
    RETURN json_build_object('success', true, 'message', '房间已取消');
END; $func$;

-- -----------------------------------------------------------------------------
-- 2. 修复 Dice 游戏 (骰子)
-- -----------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.create_dice_room(UUID, BIGINT, NUMERIC, INT);
CREATE OR REPLACE FUNCTION public.create_dice_room(p_owner_id UUID, p_group_id BIGINT, p_bet_amount NUMERIC, p_target_count INT)
RETURNS JSON LANGUAGE plpgsql SECURITY DEFINER AS $func$
DECLARE v_current_balance NUMERIC; v_room_id UUID; v_final_balance NUMERIC; v_active_room_exists BOOLEAN;
BEGIN
    IF p_owner_id != auth.uid() THEN RETURN json_build_object('success', false, 'message', '非法操作'); END IF;
    SELECT EXISTS (SELECT 1 FROM public.dice_rooms WHERE group_id = p_group_id AND status IN ('waiting', 'rolling')) INTO v_active_room_exists;
    IF v_active_room_exists THEN RETURN json_build_object('success', false, 'message', '已有进行中的对局'); END IF;
    SELECT balance_coins INTO v_current_balance FROM public.profiles WHERE id = p_owner_id FOR UPDATE;
    IF v_current_balance < p_bet_amount THEN RETURN json_build_object('success', false, 'message', '余额不足'); END IF;
    INSERT INTO public.dice_rooms (owner_id, group_id, bet_amount, target_count, current_count, status) VALUES (p_owner_id, p_group_id, p_bet_amount, p_target_count, 1, 'waiting') RETURNING id INTO v_room_id;
    INSERT INTO public.dice_room_players (room_id, user_id) VALUES (v_room_id, p_owner_id);
    UPDATE public.profiles SET balance_coins = balance_coins - p_bet_amount WHERE id = p_owner_id RETURNING balance_coins INTO v_final_balance;
    INSERT INTO public.coin_transactions (user_id, amount, balance_after, type, description, related_id) VALUES (p_owner_id, -p_bet_amount, v_final_balance, 'dice_bet', '发起骰子: 房ID ' || v_room_id, v_room_id);
    RETURN json_build_object('success', true, 'room_id', v_room_id);
END; $func$;

DROP FUNCTION IF EXISTS public.join_dice_room(UUID, UUID);
CREATE OR REPLACE FUNCTION public.join_dice_room(p_room_id UUID, p_user_id UUID)
RETURNS JSON LANGUAGE plpgsql SECURITY DEFINER AS $func$
DECLARE v_room_status TEXT; v_bet_amount NUMERIC; v_target_count INT; v_current_count INT; v_current_balance NUMERIC; v_final_balance NUMERIC;
BEGIN
    IF p_user_id != auth.uid() THEN RETURN json_build_object('success', false, 'message', '非法操作'); END IF;
    SELECT status, bet_amount, target_count, current_count INTO v_room_status, v_bet_amount, v_target_count, v_current_count FROM public.dice_rooms WHERE id = p_room_id FOR UPDATE;
    IF v_room_status != 'waiting' THEN RETURN json_build_object('success', false, 'message', '房间已满或已开始'); END IF;
    IF EXISTS (SELECT 1 FROM public.dice_room_players WHERE room_id = p_room_id AND user_id = p_user_id) THEN RETURN json_build_object('success', false, 'message', '你已在房间内'); END IF;
    SELECT balance_coins INTO v_current_balance FROM public.profiles WHERE id = p_user_id FOR UPDATE;
    IF v_current_balance < v_bet_amount THEN RETURN json_build_object('success', false, 'message', '余额不足'); END IF;
    UPDATE public.profiles SET balance_coins = balance_coins - v_bet_amount WHERE id = p_user_id RETURNING balance_coins INTO v_final_balance;
    INSERT INTO public.dice_room_players (room_id, user_id) VALUES (p_room_id, p_user_id);
    UPDATE public.dice_rooms SET current_count = current_count + 1, status = CASE WHEN (current_count + 1) >= v_target_count THEN 'rolling' ELSE 'waiting' END, updated_at = NOW() WHERE id = p_room_id;
    INSERT INTO public.coin_transactions (user_id, amount, balance_after, type, description, related_id) VALUES (p_user_id, -v_bet_amount, v_final_balance, 'dice_bet', '参与骰子: 房ID ' || p_room_id, p_room_id);
    RETURN json_build_object('success', true, 'is_full', (v_current_count + 1) >= v_target_count);
END; $func$;

-- -----------------------------------------------------------------------------
-- 3. 修复群红包
-- -----------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.create_group_red_packet(UUID, BIGINT, TEXT, NUMERIC, INT, UUID);
CREATE OR REPLACE FUNCTION public.create_group_red_packet(p_sender_id UUID, p_group_id BIGINT, p_type TEXT, p_total_amount NUMERIC, p_total_count INT, p_target_user_id UUID DEFAULT NULL)
RETURNS JSON LANGUAGE plpgsql SECURITY DEFINER AS $func$
DECLARE v_current_balance NUMERIC; v_final_balance NUMERIC; v_packet_id UUID;
BEGIN
    IF p_sender_id != auth.uid() THEN RETURN json_build_object('success', false, 'message', '非法操作'); END IF;
    IF (p_total_amount / p_total_count) < 1 THEN RETURN json_build_object('success', false, 'message', '平均每份不能低于 1 抖币'); END IF;
    SELECT balance_coins INTO v_current_balance FROM public.profiles WHERE id = p_sender_id FOR UPDATE;
    IF v_current_balance < p_total_amount THEN RETURN json_build_object('success', false, 'message', '余额不足'); END IF;
    UPDATE public.profiles SET balance_coins = balance_coins - p_total_amount WHERE id = p_sender_id RETURNING balance_coins INTO v_final_balance;
    INSERT INTO public.group_red_packets (sender_id, group_id, type, total_amount, total_count, remaining_amount, remaining_count, target_user_id) VALUES (p_sender_id, p_group_id, p_type, p_total_amount, p_total_count, p_total_amount, p_total_count, p_target_user_id) RETURNING id INTO v_packet_id;
    INSERT INTO public.coin_transactions (user_id, amount, balance_after, type, description, related_id) VALUES (p_sender_id, -p_total_amount, v_final_balance, 'hb_out', '群红包发出: ' || p_type, v_packet_id);
    RETURN json_build_object('success', true, 'packet_id', v_packet_id);
END; $func$;

DROP FUNCTION IF EXISTS public.claim_group_red_packet(UUID, UUID);
CREATE OR REPLACE FUNCTION public.claim_group_red_packet(p_packet_id UUID, p_user_id UUID)
RETURNS JSON LANGUAGE plpgsql SECURITY DEFINER AS $func$
DECLARE v_packet RECORD; v_claim_amount NUMERIC; v_final_balance NUMERIC; v_lucky_max NUMERIC;
BEGIN
    IF p_user_id != auth.uid() THEN RETURN json_build_object('success', false, 'message', '非法操作'); END IF;
    SELECT * INTO v_packet FROM public.group_red_packets WHERE id = p_packet_id FOR UPDATE;
    IF NOT FOUND THEN RETURN json_build_object('success', false, 'message', '红包不存在'); END IF;
    IF v_packet.status <> 'active' OR v_packet.remaining_count <= 0 THEN RETURN json_build_object('success', false, 'message', '红包已结束'); END IF;
    IF v_packet.type = 'single' AND v_packet.target_user_id <> p_user_id THEN RETURN json_build_object('success', false, 'message', '私有红包'); END IF;
    IF EXISTS (SELECT 1 FROM public.group_red_packet_claims WHERE packet_id = p_packet_id AND user_id = p_user_id) THEN RETURN json_build_object('success', false, 'message', '已领过'); END IF;
    IF v_packet.remaining_count = 1 THEN v_claim_amount := v_packet.remaining_amount; ELSIF v_packet.type = 'equal' OR v_packet.type = 'single' THEN v_claim_amount := ROUND(v_packet.total_amount / v_packet.total_count, 2); ELSE v_lucky_max := (v_packet.remaining_amount / v_packet.remaining_count) * 2; v_claim_amount := ROUND(CAST(0.01 + (random() * (v_lucky_max - 0.01)) AS NUMERIC), 2); IF v_claim_amount >= v_packet.remaining_amount THEN v_claim_amount := ROUND(v_packet.remaining_amount - (v_packet.remaining_count - 1) * 0.01, 2); END IF; END IF;
    IF v_claim_amount <= 0 THEN v_claim_amount := 0.01; END IF;
    UPDATE public.group_red_packets SET remaining_amount = remaining_amount - v_claim_amount, remaining_count = remaining_count - 1, status = CASE WHEN remaining_count - 1 = 0 THEN 'completed' ELSE 'active' END, updated_at = NOW() WHERE id = p_packet_id;
    INSERT INTO public.group_red_packet_claims (packet_id, user_id, amount) VALUES (p_packet_id, p_user_id, v_claim_amount);
    UPDATE public.profiles SET balance_coins = balance_coins + v_claim_amount WHERE id = p_user_id RETURNING balance_coins INTO v_final_balance;
    INSERT INTO public.coin_transactions (user_id, amount, balance_after, type, description, related_id) VALUES (p_user_id, v_claim_amount, v_final_balance, 'hb_in', '群红包领取: ' || p_packet_id, p_packet_id);
    RETURN json_build_object('success', true, 'amount', v_claim_amount);
END; $func$;

-- -----------------------------------------------------------------------------
-- 4. 修复收藏夹 (Collection)
-- -----------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.append_collection_media(BIGINT, TEXT, JSONB, UUID, TEXT, TEXT[], TEXT, BOOLEAN, BOOLEAN, BOOLEAN);
CREATE OR REPLACE FUNCTION public.append_collection_media(p_chat_id BIGINT, p_media_group_id TEXT, p_new_item JSONB, p_author_id UUID, p_caption TEXT DEFAULT NULL, p_tags TEXT[] DEFAULT NULL, p_content_type TEXT DEFAULT 'album', p_is_auto_sync BOOLEAN DEFAULT FALSE, p_is_adult BOOLEAN DEFAULT FALSE, p_is_sea BOOLEAN DEFAULT FALSE)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER AS $func$
DECLARE v_video_id UUID; v_media_list JSONB; v_is_new BOOLEAN := FALSE; v_current_content_type TEXT; v_profile_auto_approve BOOLEAN;
BEGIN
    IF p_author_id != auth.uid() THEN RETURN jsonb_build_object('success', false, 'message', '非法操作'); END IF;
    SELECT auto_approve INTO v_profile_auto_approve FROM profiles WHERE id = p_author_id;
    SELECT id, media_list, content_type INTO v_video_id, v_media_list, v_current_content_type FROM videos WHERE media_group_id = p_media_group_id AND author_id = p_author_id LIMIT 1;
    IF v_video_id IS NULL THEN
        v_is_new := TRUE; v_media_list := jsonb_build_array(p_new_item);
        INSERT INTO videos (tg_user_id, author_id, media_group_id, media_list, images, title, description, tags, content_type, status, storage_type, review_status, is_auto_sync, is_adult, is_sea) VALUES (p_chat_id, p_author_id, p_media_group_id, v_media_list, v_media_list, CASE WHEN p_content_type = 'collection' THEN '未命名合集' ELSE '未命名相册' END, p_caption, p_tags, p_content_type, 'processing', 'r2_pending', CASE WHEN v_profile_auto_approve THEN 'auto_approved' ELSE 'pending' END, p_is_auto_sync, p_is_adult, p_is_sea) RETURNING id INTO v_video_id;
    ELSE
        v_media_list := COALESCE(v_media_list, '[]'::jsonb) || jsonb_build_array(p_new_item);
        IF p_content_type = 'collection' OR v_current_content_type = 'collection' THEN v_current_content_type := 'collection'; ELSE v_current_content_type := 'album'; END IF;
        UPDATE videos SET media_list = v_media_list, images = v_media_list, content_type = v_current_content_type, is_auto_sync = CASE WHEN p_is_auto_sync = TRUE THEN TRUE ELSE is_auto_sync END, is_adult = CASE WHEN p_is_adult = TRUE THEN TRUE ELSE is_adult END, is_sea = CASE WHEN p_is_sea = TRUE THEN TRUE ELSE is_sea END, updated_at = NOW() WHERE id = v_video_id;
    END IF;
    RETURN jsonb_build_object('id', v_video_id, 'is_new', v_is_new);
END; $func$;

    RAISE NOTICE 'Game and social RPCs have been hardened against ID injection.';
END $$;
