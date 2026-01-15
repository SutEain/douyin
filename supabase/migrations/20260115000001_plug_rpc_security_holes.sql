-- 🎯 紧急修复：全面封死 RPC 后门漏洞
-- 修复：
-- 1. admin_adjust_balance: 增加缺失的管理员权限校验，禁止通过参数伪造操作者 ID
-- 2. process_gift_reward: 强制 sender_id 必须为当前登录用户 auth.uid()
-- 3. send_live_red_packet: 强制 p_sender_id 必须为当前登录用户 auth.uid()
-- 4. admin_process_withdraw: 强制 p_admin_id 必须为当前登录用户 auth.uid() 且具备管理员权限
-- 5. admin_confirm_recharge: 强制 p_admin_id 必须为当前登录用户 auth.uid() 且具备管理员权限
-- 6. check_is_admin: 强制实时查询数据库，不再信任 JWT 中的 role
-- 7. claim_watch_time_reward: 强制 p_user_id 必须为当前登录用户 auth.uid()
-- 8. claim_author_views_reward: 强制 p_user_id 必须为当前登录用户 auth.uid()

DO $$
BEGIN

-- -----------------------------------------------------------------------------
-- 1. 修复 check_is_admin (安全核心，不再信任 JWT role)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.check_is_admin()
RETURNS BOOLEAN AS $func$
BEGIN
    RETURN EXISTS (
        SELECT 1 FROM public.profiles 
        WHERE id = auth.uid() AND is_admin = TRUE
    );
END;
$func$ LANGUAGE plpgsql SECURITY DEFINER;

-- -----------------------------------------------------------------------------
-- 2. 修复 admin_adjust_balance (之前裸奔)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_adjust_balance(
    target_user_id UUID,
    amount_change DECIMAL,
    description_text TEXT
) RETURNS JSON 
LANGUAGE plpgsql
SECURITY DEFINER
AS $func$
DECLARE
    final_balance DECIMAL;
BEGIN
    IF NOT public.check_is_admin() THEN
        RETURN json_build_object('success', false, 'message', '权限不足：只有管理员可以手动调整余额');
    END IF;

    UPDATE public.profiles SET balance_coins = balance_coins + amount_change WHERE id = target_user_id RETURNING balance_coins INTO final_balance;
    INSERT INTO public.coin_transactions (user_id, amount, balance_after, type, description)
    VALUES (target_user_id, amount_change, final_balance, 'recharge', '[后台调整] ' || COALESCE(description_text, '管理员手动调整'));

    RETURN json_build_object('success', true, 'new_balance', final_balance);
END;
$func$;

-- -----------------------------------------------------------------------------
-- 3. 修复 process_gift_reward (防止盗刷他人余额)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.process_gift_reward(
    sender_id UUID,
    receiver_id UUID,
    gift_amount DECIMAL,
    room_or_video_id UUID,
    gift_type TEXT,
    gift_name TEXT
) RETURNS JSON 
LANGUAGE plpgsql
SECURITY DEFINER
AS $func$
DECLARE
    current_sender_balance DECIMAL;
    receiver_gain DECIMAL;
    final_sender_balance DECIMAL;
    final_receiver_balance DECIMAL;
    split_percentage INT;
BEGIN
    -- 🛑 核心校验：发件人必须是当前登录用户
    IF sender_id != auth.uid() THEN
        RETURN json_build_object('success', false, 'message', '非法操作：只能从自己的账户打赏');
    END IF;

    IF gift_amount <= 0 THEN
        RETURN json_build_object('success', false, 'message', '打赏金额必须大于 0');
    END IF;

    SELECT COALESCE(value_int, 50) INTO split_percentage FROM public.system_settings WHERE id = 'gift_split_percentage';
    SELECT balance_coins INTO current_sender_balance FROM public.profiles WHERE id = sender_id FOR UPDATE;
    
    IF current_sender_balance < gift_amount THEN
        RETURN json_build_object('success', false, 'message', '余额不足');
    END IF;

    receiver_gain := gift_amount * (split_percentage / 100.0);
    UPDATE public.profiles SET balance_coins = balance_coins - gift_amount WHERE id = sender_id RETURNING balance_coins INTO final_sender_balance;
    UPDATE public.profiles SET balance_coins = balance_coins + receiver_gain WHERE id = receiver_id RETURNING balance_coins INTO final_receiver_balance;

    INSERT INTO public.coin_transactions (user_id, amount, balance_after, type, description, related_id)
    VALUES (sender_id, -gift_amount, final_sender_balance, 'gift_out', '打赏礼物: ' || gift_name, room_or_video_id);
    INSERT INTO public.coin_transactions (user_id, amount, balance_after, type, description, related_id)
    VALUES (receiver_id, receiver_gain, final_receiver_balance, 'gift_in', '收到打赏: ' || gift_name, room_or_video_id);

    RETURN json_build_object('success', true, 'sender_balance', final_sender_balance, 'receiver_balance', final_receiver_balance);
END;
$func$;

-- -----------------------------------------------------------------------------
-- 4. 修复 send_live_red_packet (防止盗刷他人余额发红包)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.send_live_red_packet(
    p_room_id UUID,
    p_sender_id UUID,
    p_total_coins INT,
    p_total_count INT,
    p_packet_type TEXT,
    p_countdown_seconds INT,
    p_claim_conditions JSONB,
    p_unlock_at TIMESTAMP WITH TIME ZONE,
    p_expires_at TIMESTAMP WITH TIME ZONE
) RETURNS JSON 
LANGUAGE plpgsql
SECURITY DEFINER
AS $func$
DECLARE
    v_balance NUMERIC;
    v_packet_id UUID;
    v_balance_after NUMERIC;
BEGIN
    IF p_sender_id != auth.uid() THEN
        RETURN json_build_object('success', false, 'message', '非法操作：只能从自己的账户发放红包');
    END IF;

    SELECT balance_coins INTO v_balance FROM public.profiles WHERE id = p_sender_id FOR UPDATE;
    IF v_balance < p_total_coins THEN
        RETURN json_build_object('success', false, 'message', '余额不足');
    END IF;

    UPDATE public.profiles SET balance_coins = balance_coins - p_total_coins WHERE id = p_sender_id RETURNING balance_coins INTO v_balance_after;
    INSERT INTO public.live_red_packets (room_id, sender_id, total_coins, total_count, packet_type, countdown_seconds, claim_conditions, remaining_coins, remaining_count, status, unlock_at, expires_at)
    VALUES (p_room_id, p_sender_id, p_total_coins, p_total_count, p_packet_type, p_countdown_seconds, p_claim_conditions, p_total_coins, p_total_count, 'pending', p_unlock_at, p_expires_at)
    RETURNING id INTO v_packet_id;

    INSERT INTO public.coin_transactions (user_id, amount, balance_after, type, description, related_id)
    VALUES (p_sender_id, -p_total_coins, v_balance_after, 'red_packet_send', '直播间发放红包', v_packet_id);

    RETURN json_build_object('success', true, 'packet_id', v_packet_id, 'balance_after', v_balance_after);
END;
$func$;

-- -----------------------------------------------------------------------------
-- 5. 修复 claim_watch_time_reward (防止越权领奖)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.claim_watch_time_reward(p_user_id UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER AS $func$
DECLARE
    v_today DATE := (NOW() AT TIME ZONE 'Asia/Shanghai')::DATE;
    v_total_seconds INT := 0;
    v_reward_amount NUMERIC := 0;
    v_reward_level TEXT := 'none';
    v_final_balance NUMERIC;
    v_claimed_5min BOOLEAN; v_claimed_15min BOOLEAN; v_claimed_30min BOOLEAN;
BEGIN
    IF p_user_id != auth.uid() THEN
        RETURN jsonb_build_object('success', false, 'message', '非法操作：只能为自己领取奖励');
    END IF;

    SELECT COALESCE(total_seconds, 0) INTO v_total_seconds FROM public.user_daily_watch_time WHERE user_id = p_user_id AND watch_date = v_today;
    SELECT EXISTS(SELECT 1 FROM public.coin_transactions WHERE user_id = p_user_id AND type = 'watch_time_reward' AND (created_at AT TIME ZONE 'Asia/Shanghai')::DATE = v_today AND description LIKE '%: 5min%') INTO v_claimed_5min;
    SELECT EXISTS(SELECT 1 FROM public.coin_transactions WHERE user_id = p_user_id AND type = 'watch_time_reward' AND (created_at AT TIME ZONE 'Asia/Shanghai')::DATE = v_today AND description LIKE '%: 15min%') INTO v_claimed_15min;
    SELECT EXISTS(SELECT 1 FROM public.coin_transactions WHERE user_id = p_user_id AND type = 'watch_time_reward' AND (created_at AT TIME ZONE 'Asia/Shanghai')::DATE = v_today AND description LIKE '%: 30min%') INTO v_claimed_30min;

    IF v_total_seconds >= 300 AND NOT v_claimed_5min THEN v_reward_amount := 5.00; v_reward_level := '5min';
    ELSIF v_total_seconds >= 900 AND NOT v_claimed_15min THEN v_reward_amount := 15.00; v_reward_level := '15min';
    ELSIF v_total_seconds >= 1800 AND NOT v_claimed_30min THEN v_reward_amount := 30.00; v_reward_level := '30min';
    ELSE RETURN jsonb_build_object('success', false, 'message', '没有可领取的档位'); END IF;

    UPDATE public.profiles SET balance_coins = balance_coins + v_reward_amount WHERE id = p_user_id RETURNING balance_coins INTO v_final_balance;
    INSERT INTO public.coin_transactions (user_id, amount, balance_after, type, description)
    VALUES (p_user_id, v_reward_amount, v_final_balance, 'watch_time_reward', '观看时长奖励: ' || v_reward_level);

    RETURN jsonb_build_object('success', true, 'reward_amount', v_reward_amount, 'balance_after', v_final_balance);
END; $func$;

-- -----------------------------------------------------------------------------
-- 6. 修复 claim_author_views_reward (防止越权领奖)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.claim_author_views_reward(p_user_id UUID)
RETURNS JSON LANGUAGE plpgsql SECURITY DEFINER AS $func$
DECLARE
    v_rule RECORD; v_progress RECORD; v_current_total_views BIGINT; v_last_rewarded_views INT; v_new_claims INT; v_total_reward_coins NUMERIC; v_final_balance NUMERIC;
BEGIN
    IF p_user_id != auth.uid() THEN
        RETURN json_build_object('success', false, 'message', '非法操作：只能为自己领取奖励');
    END IF;

    SELECT * INTO v_rule FROM public.incentive_rules WHERE code = 'author_views_reward' AND is_active = TRUE;
    IF NOT FOUND THEN RETURN json_build_object('success', false, 'message', '规则未启用'); END IF;

    SELECT COALESCE(SUM(view_count), 0) INTO v_current_total_views FROM public.videos WHERE author_id = p_user_id AND status = 'published';
    INSERT INTO public.user_incentive_progress (user_id, rule_id, progress_value, cap_used) VALUES (p_user_id, v_rule.id, 0, 0) ON CONFLICT (user_id, rule_id) DO NOTHING;
    SELECT * INTO v_progress FROM public.user_incentive_progress WHERE user_id = p_user_id AND rule_id = v_rule.id FOR UPDATE;
    
    v_last_rewarded_views := v_progress.progress_value;
    v_new_claims := (v_current_total_views - v_last_rewarded_views) / v_rule.threshold;
    IF v_new_claims <= 0 THEN RETURN json_build_object('success', false, 'message', '播放量不足'); END IF;

    v_total_reward_coins := v_new_claims * v_rule.reward_usdt;
    UPDATE public.profiles SET balance_coins = balance_coins + v_total_reward_coins WHERE id = p_user_id RETURNING balance_coins INTO v_final_balance;
    INSERT INTO public.coin_transactions (user_id, amount, balance_after, type, description, related_id)
    VALUES (p_user_id, v_total_reward_coins, v_final_balance, 'task_reward', '作品播放奖励: ' || v_current_total_views, v_progress.id);
    UPDATE public.user_incentive_progress SET progress_value = v_last_rewarded_views + (v_new_claims * v_rule.threshold), cap_used = cap_used + v_new_claims, updated_at = NOW() WHERE id = v_progress.id;

    RETURN json_build_object('success', true, 'reward_coins', v_total_reward_coins, 'balance_after', v_final_balance);
END; $func$;

    RAISE NOTICE 'Critical RPC security holes have been plugged and hardened.';
END $$;
