-- 🎯 修复：admin_execute_inheritance 函数中 balance_before 和 admin_id 字段不存在的问题
-- 问题：coin_transactions 表没有 balance_before 和 admin_id 字段，但函数中尝试插入这些字段
-- 修复：移除所有 balance_before 和 admin_id 字段引用，将管理员信息放入 description 字段

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
    v_target_final_balance NUMERIC;
BEGIN
    -- 🚨 安全验证 1: 权限检查
    IF NOT public.check_is_admin() THEN
        RAISE EXCEPTION '您没有权限执行此操作。';
    END IF;

    -- 🚨 安全验证 2: 获取管理员 ID
    SELECT id INTO v_admin_id FROM public.profiles WHERE id = auth.uid() AND is_admin = true;
    IF v_admin_id IS NULL THEN
        RAISE EXCEPTION '管理员身份验证失败。';
    END IF;

    -- 🚨 安全验证 3: 获取源账户和目标账户信息
    SELECT id, balance_coins, video_count, nickname 
    INTO v_source_profile_id, v_source_balance, v_source_video_count, v_source_nickname
    FROM public.profiles 
    WHERE numeric_id = p_from_numeric_id;
    
    IF v_source_profile_id IS NULL THEN
        RAISE EXCEPTION '源账户不存在（numeric_id: %)', p_from_numeric_id;
    END IF;

    SELECT id, nickname 
    INTO v_target_profile_id, v_target_nickname
    FROM public.profiles 
    WHERE numeric_id = p_to_numeric_id;
    
    IF v_target_profile_id IS NULL THEN
        RAISE EXCEPTION '目标账户不存在（numeric_id: %)', p_to_numeric_id;
    END IF;

    IF v_source_profile_id = v_target_profile_id THEN
        RAISE EXCEPTION '源账户和目标账户不能相同。';
    END IF;

    -- 🎯 设置会话变量，允许资产继承操作和统计字段更新
    PERFORM set_config('app.inheritance_operation', 'true', false);
    PERFORM set_config('app.allow_statistics_update', 'true', false);

    -- 迁移余额（即使余额为0也要执行，确保记录转移）
    IF v_source_balance > 0 THEN
        -- 从源账户扣除余额
        UPDATE public.profiles 
        SET balance_coins = balance_coins - v_source_balance 
        WHERE id = v_source_profile_id
        RETURNING balance_coins INTO v_target_final_balance;

        -- 记录转出交易（已移除 balance_before 和 admin_id 字段）
        INSERT INTO public.coin_transactions (
            user_id, type, amount, balance_after, description
        ) VALUES (
            v_source_profile_id,
            'inheritance_out',
            -v_source_balance,
            0,
            format('资产继承转出到账户 %s (%s)', p_to_numeric_id, COALESCE(v_target_nickname, '')) ||
            CASE WHEN v_admin_id IS NOT NULL THEN ' (操作员: ' || v_admin_id::TEXT || ')' ELSE '' END
        ) RETURNING id INTO v_transaction_id;

        -- 增加到目标账户
        UPDATE public.profiles 
        SET balance_coins = balance_coins + v_source_balance 
        WHERE id = v_target_profile_id
        RETURNING balance_coins INTO v_target_final_balance;

        -- 记录转入交易（已移除 balance_before 和 admin_id 字段）
        INSERT INTO public.coin_transactions (
            user_id, type, amount, balance_after, description
        ) VALUES (
            v_target_profile_id,
            'inheritance_in',
            v_source_balance,
            v_target_final_balance,
            format('资产继承转入自账户 %s (%s)', p_from_numeric_id, COALESCE(v_source_nickname, '')) ||
            CASE WHEN v_admin_id IS NOT NULL THEN ' (操作员: ' || v_admin_id::TEXT || ')' ELSE '' END
        );
    ELSE
        -- 即使余额为0，也记录一次转出操作（余额为0）
        UPDATE public.profiles 
        SET balance_coins = 0 
        WHERE id = v_source_profile_id;

        INSERT INTO public.coin_transactions (
            user_id, type, amount, balance_after, description
        ) VALUES (
            v_source_profile_id,
            'inheritance_out',
            0,
            0,
            format('资产继承转出到账户 %s (%s)，余额为0', p_to_numeric_id, COALESCE(v_target_nickname, '')) ||
            CASE WHEN v_admin_id IS NOT NULL THEN ' (操作员: ' || v_admin_id::TEXT || ')' ELSE '' END
        );

        -- 目标账户也记录一次（即使余额不变）
        SELECT balance_coins INTO v_target_final_balance FROM public.profiles WHERE id = v_target_profile_id;
        INSERT INTO public.coin_transactions (
            user_id, type, amount, balance_after, description
        ) VALUES (
            v_target_profile_id,
            'inheritance_in',
            0,
            v_target_final_balance,
            format('资产继承转入自账户 %s (%s)，余额为0', p_from_numeric_id, COALESCE(v_source_nickname, '')) ||
            CASE WHEN v_admin_id IS NOT NULL THEN ' (操作员: ' || v_admin_id::TEXT || ')' ELSE '' END
        );
    END IF;

    -- 迁移激励任务进度（修复：使用正确的表名 user_incentive_progress 和字段名）
    FOR v_prog IN 
        SELECT * FROM public.user_incentive_progress WHERE user_id = v_source_profile_id
    LOOP
        INSERT INTO public.user_incentive_progress (
            user_id, rule_id, progress_value, cap_used
        )
        VALUES (
            v_target_profile_id, 
            v_prog.rule_id, 
            v_prog.progress_value, 
            v_prog.cap_used
        )
        ON CONFLICT (user_id, rule_id) 
        DO UPDATE SET
            progress_value = public.user_incentive_progress.progress_value + EXCLUDED.progress_value,
            cap_used = public.user_incentive_progress.cap_used + EXCLUDED.cap_used,
            updated_at = NOW();

        DELETE FROM public.user_incentive_progress 
        WHERE user_id = v_source_profile_id AND rule_id = v_prog.rule_id;
    END LOOP;

    -- 迁移视频
    UPDATE public.videos SET author_id = v_target_profile_id WHERE author_id = v_source_profile_id;

    -- 🎯 更新统计字段（已设置 app.allow_statistics_update，允许更新）
    UPDATE public.profiles SET video_count = 0 WHERE id = v_source_profile_id;
    UPDATE public.profiles 
    SET video_count = (SELECT COUNT(*)::bigint FROM public.videos WHERE author_id = v_target_profile_id) 
    WHERE id = v_target_profile_id;

    -- 🎯 重置会话变量
    PERFORM set_config('app.inheritance_operation', 'false', false);
    PERFORM set_config('app.allow_statistics_update', 'false', false);

    RETURN jsonb_build_object(
        'success', true,
        'message', '资产及任务进度继承成功',
        'transferred_balance', v_source_balance,
        'transferred_videos', v_source_video_count
    );
EXCEPTION
    WHEN OTHERS THEN
        -- 🎯 确保异常时也重置会话变量
        PERFORM set_config('app.inheritance_operation', 'false', false);
        PERFORM set_config('app.allow_statistics_update', 'false', false);
        RAISE;
END; $func$;

COMMENT ON FUNCTION public.admin_execute_inheritance IS '🚨 修复：移除 balance_before 和 admin_id 字段引用，修复"转移资产"功能报错问题';
