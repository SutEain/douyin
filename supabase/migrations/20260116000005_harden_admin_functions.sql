-- 🚨 加固 Admin 后台敏感接口
-- 1. admin_adjust_balance: 添加单次最大金额限制（100000抖币）
-- 2. admin_execute_inheritance: 添加并发保护和金额限制
-- 3. 所有 admin 函数添加操作日志记录

-- -----------------------------------------------------------------------------
-- 1. 加固 admin_adjust_balance (添加金额限制和并发保护)
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
    v_admin_id UUID;
BEGIN
    -- 🚨 安全验证 1: 管理员权限检查
    IF NOT public.check_is_admin() THEN
        RETURN json_build_object('success', false, 'message', '权限不足：只有管理员可以手动调整余额');
    END IF;

    -- 🚨 安全验证 2: 单次调整最大金额限制（100000抖币）
    IF ABS(amount_change) > 100000 THEN
        RETURN json_build_object('success', false, 'message', '单次调整金额不能超过100000抖币');
    END IF;

    -- 🚨 安全验证 3: 获取管理员 ID（用于日志）
    v_admin_id := auth.uid();

    -- 🚨 使用 SELECT FOR UPDATE 锁定目标用户记录，防止并发竞态
    SELECT balance_coins INTO final_balance 
    FROM public.profiles 
    WHERE id = target_user_id 
    FOR UPDATE;

    IF NOT FOUND THEN
        RETURN json_build_object('success', false, 'message', '用户不存在');
    END IF;

    -- 更新余额
    UPDATE public.profiles 
    SET balance_coins = balance_coins + amount_change 
    WHERE id = target_user_id 
    RETURNING balance_coins INTO final_balance;

    -- 记录交易流水
    INSERT INTO public.coin_transactions (user_id, amount, balance_after, type, description)
    VALUES (
        target_user_id, 
        amount_change, 
        final_balance, 
        'adjustment', 
        '[后台调整] ' || COALESCE(description_text, '管理员手动调整') || 
        CASE WHEN v_admin_id IS NOT NULL THEN ' (操作员: ' || v_admin_id::TEXT || ')' ELSE '' END
    );

    RETURN json_build_object('success', true, 'new_balance', final_balance);
END; $func$;

-- -----------------------------------------------------------------------------
-- 2. 加固 admin_execute_inheritance (添加并发保护和金额限制)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_execute_inheritance(
    p_from_numeric_id BIGINT,
    p_to_numeric_id BIGINT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $func$
DECLARE
    v_source_profile_id UUID;
    v_target_profile_id UUID;
    v_source_balance NUMERIC;
    v_source_video_count BIGINT;
    v_admin_id UUID;
    v_transaction_id UUID;
    v_prog RECORD;
    v_source_nickname TEXT;
    v_target_nickname TEXT;
BEGIN
    -- 🚨 安全验证 1: 权限检查
    IF NOT public.check_is_admin() THEN
        RAISE EXCEPTION '您没有权限执行此操作。';
    END IF;

    -- 🚨 安全验证 2: 获取管理员 ID
    v_admin_id := auth.uid();
    IF v_admin_id IS NULL AND auth.role() != 'service_role' THEN
        RAISE EXCEPTION '无法获取管理员ID。';
    END IF;

    -- 🚨 安全验证 3: 基本校验
    IF p_from_numeric_id = p_to_numeric_id THEN
        RAISE EXCEPTION '源账号和目标账号不能是同一个。';
    END IF;

    -- 🚨 使用 SELECT FOR UPDATE 锁定源和目标账号，防止并发竞态
    SELECT id, balance_coins, video_count, nickname 
    INTO v_source_profile_id, v_source_balance, v_source_video_count, v_source_nickname
    FROM public.profiles 
    WHERE numeric_id = p_from_numeric_id 
    FOR UPDATE;

    SELECT id, nickname 
    INTO v_target_profile_id, v_target_nickname
    FROM public.profiles 
    WHERE numeric_id = p_to_numeric_id 
    FOR UPDATE;

    IF v_source_profile_id IS NULL THEN
        RAISE EXCEPTION '源账号 (数字ID: %) 不存在。', p_from_numeric_id;
    END IF;
    IF v_target_profile_id IS NULL THEN
        RAISE EXCEPTION '目标账号 (数字ID: %) 不存在。', p_to_numeric_id;
    END IF;

    -- 🚨 安全验证 4: 单次继承最大金额限制（1000000抖币）
    IF v_source_balance > 1000000 THEN
        RAISE EXCEPTION '单次继承金额不能超过1000000抖币，当前金额: %', v_source_balance;
    END IF;

    -- 迁移任务进度
    FOR v_prog IN SELECT * FROM public.user_incentive_progress WHERE user_id = v_source_profile_id LOOP
        INSERT INTO public.user_incentive_progress (user_id, rule_id, progress_value, cap_used)
        VALUES (v_target_profile_id, v_prog.rule_id, v_prog.progress_value, v_prog.cap_used)
        ON CONFLICT (user_id, rule_id) DO UPDATE
        SET progress_value = public.user_incentive_progress.progress_value + EXCLUDED.progress_value,
            cap_used = public.user_incentive_progress.cap_used + EXCLUDED.cap_used,
            updated_at = NOW();
    END LOOP;
    DELETE FROM public.user_incentive_progress WHERE user_id = v_source_profile_id;

    -- 迁移余额
    IF v_source_balance > 0 THEN
        UPDATE public.profiles SET balance_coins = 0 WHERE id = v_source_profile_id;
        UPDATE public.profiles SET balance_coins = balance_coins + v_source_balance WHERE id = v_target_profile_id;

        v_transaction_id := gen_random_uuid();
        INSERT INTO public.coin_transactions (
            id, user_id, amount, balance_after, type, description, related_id, counterparty_id
        )
        VALUES (
            v_transaction_id, 
            v_source_profile_id, 
            -v_source_balance, 
            0, 
            'inheritance_out',
            '资产迁移至 ' || v_target_nickname || ' (ID: ' || p_to_numeric_id || ')' ||
            CASE WHEN v_admin_id IS NOT NULL THEN ' (操作员: ' || v_admin_id::TEXT || ')' ELSE '' END,
            v_transaction_id, 
            v_target_profile_id
        );

        INSERT INTO public.coin_transactions (
            id, user_id, amount, balance_after, type, description, related_id, counterparty_id
        )
        VALUES (
            gen_random_uuid(), 
            v_target_profile_id, 
            v_source_balance, 
            (SELECT balance_coins FROM public.profiles WHERE id = v_target_profile_id), 
            'inheritance_in',
            '继承自 ' || v_source_nickname || ' (ID: ' || p_from_numeric_id || ')' ||
            CASE WHEN v_admin_id IS NOT NULL THEN ' (操作员: ' || v_admin_id::TEXT || ')' ELSE '' END,
            v_transaction_id, 
            v_source_profile_id
        );
    END IF;

    -- 迁移视频
    UPDATE public.videos SET author_id = v_target_profile_id WHERE author_id = v_source_profile_id;

    -- 更新统计
    UPDATE public.profiles SET video_count = 0 WHERE id = v_source_profile_id;
    UPDATE public.profiles 
    SET video_count = (SELECT COUNT(*)::bigint FROM public.videos WHERE author_id = v_target_profile_id) 
    WHERE id = v_target_profile_id;

    RETURN jsonb_build_object(
        'success', true,
        'message', '资产及任务进度继承成功',
        'transferred_balance', v_source_balance,
        'transferred_videos', v_source_video_count
    );
END; $func$;

COMMENT ON FUNCTION public.admin_adjust_balance IS '🚨 加固：添加单次最大金额限制（100000抖币）和并发保护';
COMMENT ON FUNCTION public.admin_execute_inheritance IS '🚨 加固：添加单次最大金额限制（1000000抖币）和并发保护';
