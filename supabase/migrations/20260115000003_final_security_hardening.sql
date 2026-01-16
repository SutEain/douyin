-- 🎯 第四波加固：封死提现、任务进度、统计接口及权限模型统一
-- 修复：
-- 1. process_withdraw_request: 强制校验提现人身份
-- 2. increment_task_progress: 强制校验操作人身份
-- 3. get_total_coins_balance / get_today_system_rewards / get_today_gift_commission: 限制仅管理员可调用
-- 4. get_admin_profiles_list: 统一使用数据库实时权限检查
-- 5. get_user_video_stats: 增加所有权校验

DO $$
BEGIN

-- -----------------------------------------------------------------------------
-- 1. 修复提现申请 RPC (防盗刷)
-- -----------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.process_withdraw_request(UUID, DECIMAL, TEXT, TEXT);
CREATE OR REPLACE FUNCTION public.process_withdraw_request(
    p_user_id UUID,
    p_amount DECIMAL,
    p_address TEXT,
    p_order_no TEXT
) RETURNS JSON LANGUAGE plpgsql SECURITY DEFINER AS $func$
DECLARE v_balance DECIMAL; v_order_id UUID; v_fee_amount DECIMAL := 50; v_actual_usdt DECIMAL;
BEGIN
    -- 🛑 核心校验：只能为自己申请提现
    IF p_user_id != auth.uid() THEN
        RETURN json_build_object('success', false, 'message', '非法操作：只能从自己的账户提现');
    END IF;

    IF p_amount < 1000 THEN RETURN json_build_object('success', false, 'message', '最低提现金额为1000'); END IF;
    IF p_amount <= 0 THEN RETURN json_build_object('success', false, 'message', '金额必须大于0'); END IF;

    SELECT balance_coins INTO v_balance FROM public.profiles WHERE id = p_user_id FOR UPDATE;
    IF v_balance < p_amount THEN RETURN json_build_object('success', false, 'message', '余额不足'); END IF;

    UPDATE public.profiles SET balance_coins = balance_coins - p_amount, frozen_coins = COALESCE(frozen_coins, 0) + p_amount WHERE id = p_user_id;
    INSERT INTO public.withdraw_orders (user_id, amount, fee_amount, actual_amount, address, order_no, status)
    VALUES (p_user_id, p_amount, v_fee_amount, (p_amount - v_fee_amount)/100, p_address, p_order_no, 'pending') RETURNING id INTO v_order_id;

    INSERT INTO public.coin_transactions (user_id, amount, balance_after, type, description, related_id)
    VALUES (p_user_id, -p_amount, v_balance - p_amount, 'withdraw', '提现申请: ' || p_order_no, v_order_id);

    RETURN json_build_object('success', true, 'order_id', v_order_id);
END; $func$;

-- -----------------------------------------------------------------------------
-- 2. 修复任务进度 RPC (防越权)
-- -----------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.increment_task_progress(UUID, TEXT, INT);
CREATE OR REPLACE FUNCTION public.increment_task_progress(p_user_id UUID, p_task_code TEXT, p_increment INT DEFAULT 1)
RETURNS JSON LANGUAGE plpgsql SECURITY DEFINER AS $func$
DECLARE v_rule RECORD; v_progress RECORD; v_total_reward NUMERIC; v_final_balance NUMERIC; v_new_progress INT; v_reward_count INT;
BEGIN
    -- 🛑 核心校验
    IF p_user_id != auth.uid() THEN
        RETURN json_build_object('success', false, 'message', '非法操作');
    END IF;

    SELECT * INTO v_rule FROM public.incentive_rules WHERE code = p_task_code AND is_active = TRUE;
    IF NOT FOUND THEN RETURN json_build_object('success', false, 'message', '任务不存在'); END IF;

    INSERT INTO public.user_incentive_progress (user_id, rule_id, progress_value, cap_used)
    VALUES (p_user_id, v_rule.id, 0, 0) ON CONFLICT (user_id, rule_id) DO NOTHING;
    SELECT * INTO v_progress FROM public.user_incentive_progress WHERE user_id = p_user_id AND rule_id = v_rule.id FOR UPDATE;

    v_new_progress := v_progress.progress_value + p_increment;
    IF v_new_progress >= v_rule.threshold THEN
        v_reward_count := v_new_progress / v_rule.threshold;
        v_total_reward := v_reward_count * v_rule.reward_usdt;
        v_new_progress := v_new_progress % v_rule.threshold;
        UPDATE public.profiles SET balance_coins = balance_coins + v_total_reward WHERE id = p_user_id RETURNING balance_coins INTO v_final_balance;
        INSERT INTO public.coin_transactions (user_id, amount, balance_after, type, description, related_id)
        VALUES (p_user_id, v_total_reward, v_final_balance, 'task_reward', '任务奖励: ' || v_rule.name, v_progress.id);
        UPDATE public.user_incentive_progress SET progress_value = v_new_progress, cap_used = cap_used + v_reward_count, updated_at = NOW() WHERE id = v_progress.id;
        RETURN json_build_object('success', true, 'completed', true, 'reward', v_total_reward);
    ELSE
        UPDATE public.user_incentive_progress SET progress_value = v_new_progress, updated_at = NOW() WHERE id = v_progress.id;
        RETURN json_build_object('success', true, 'completed', false, 'new_progress', v_new_progress);
    END IF;
END; $func$;

-- -----------------------------------------------------------------------------
-- 3. 修复统计类 RPC (限制仅管理员访问)
-- -----------------------------------------------------------------------------
-- 统计总余额
CREATE OR REPLACE FUNCTION public.get_total_coins_balance()
RETURNS DECIMAL(12, 2) LANGUAGE plpgsql SECURITY DEFINER AS $func$
BEGIN
    IF NOT public.check_is_admin() THEN RAISE EXCEPTION 'Access denied'; END IF;
    RETURN (SELECT COALESCE(SUM(balance_coins), 0) FROM public.profiles WHERE deleted_at IS NULL);
END; $func$;

-- 统计系统奖励
CREATE OR REPLACE FUNCTION public.get_today_system_rewards(p_start_iso TIMESTAMPTZ, p_end_iso TIMESTAMPTZ)
RETURNS DECIMAL(12, 2) LANGUAGE plpgsql SECURITY DEFINER AS $func$
BEGIN
    IF NOT public.check_is_admin() THEN RAISE EXCEPTION 'Access denied'; END IF;
    RETURN (SELECT COALESCE(SUM(amount), 0) FROM public.coin_transactions WHERE created_at >= p_start_iso AND created_at < p_end_iso AND type IN ('reward', 'task_reward', 'watch_time_reward', 'author_views_reward') AND amount > 0);
END; $func$;

-- 统计平台抽水
CREATE OR REPLACE FUNCTION public.get_today_gift_commission(p_start_iso TIMESTAMPTZ, p_end_iso TIMESTAMPTZ)
RETURNS DECIMAL(12, 2) LANGUAGE plpgsql SECURITY DEFINER AS $func$
DECLARE v_out NUMERIC; v_in NUMERIC;
BEGIN
    IF NOT public.check_is_admin() THEN RAISE EXCEPTION 'Access denied'; END IF;
    SELECT COALESCE(SUM(ABS(amount)), 0) INTO v_out FROM public.coin_transactions WHERE created_at >= p_start_iso AND created_at < p_end_iso AND type = 'gift_out';
    SELECT COALESCE(SUM(amount), 0) INTO v_in FROM public.coin_transactions WHERE created_at >= p_start_iso AND created_at < p_end_iso AND type = 'gift_in';
    RETURN v_out - v_in;
END; $func$;

-- -----------------------------------------------------------------------------
-- 4. 修复管理列表 RPC (统一权限模型)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_admin_profiles_list()
RETURNS TABLE (LIKE public.profiles) LANGUAGE plpgsql SECURITY DEFINER AS $func$
BEGIN
    -- 🛑 核心修复：弃用 JWT role 检查，改用实时数据库校验
    IF NOT public.check_is_admin() THEN
        RAISE EXCEPTION 'Access denied. Admin role required.';
    END IF;
    RETURN QUERY SELECT * FROM public.profiles;
END; $func$;

-- -----------------------------------------------------------------------------
-- 5. 修复视频统计 RPC (防止查看他人隐私数据)
-- -----------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.get_user_video_stats(BIGINT);
CREATE OR REPLACE FUNCTION public.get_user_video_stats(p_tg_user_id BIGINT)
RETURNS JSON LANGUAGE plpgsql SECURITY DEFINER AS $func$
BEGIN
    -- 🛑 核心校验：只能查看自己的统计，或者是管理员
    IF (SELECT id FROM public.profiles WHERE tg_user_id = p_tg_user_id) != auth.uid() AND NOT public.check_is_admin() THEN
        RETURN json_build_object('success', false, 'message', '权限不足');
    END IF;

    RETURN (
        SELECT json_build_object(
            'total_videos', count(*),
            'total_views', sum(view_count),
            'total_likes', sum(like_count),
            'total_comments', sum(comment_count)
        ) FROM public.videos WHERE tg_user_id = p_tg_user_id AND deleted_at IS NULL
    );
END; $func$;

    RAISE NOTICE 'Final security reinforcement complete.';
END $$;
