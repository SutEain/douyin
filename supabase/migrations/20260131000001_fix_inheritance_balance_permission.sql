-- 🎯 修复资产继承功能：允许 admin_execute_inheritance 函数修改余额
-- 问题：protect_sensitive_profile_fields 触发器阻止了资产继承时修改余额
-- 修复：在触发器中添加对资产继承操作的检查，允许通过会话变量标识的资产继承操作

CREATE OR REPLACE FUNCTION public.protect_sensitive_profile_fields()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
    v_is_pc28_settlement BOOLEAN := false;
    v_is_inheritance BOOLEAN := false;
BEGIN
    -- 🎯 service_role: 完全允许
    IF current_user = 'service_role' THEN
        RETURN NEW;
    END IF;
    
    -- 🎯 postgres用户（SECURITY DEFINER函数）: 检查是否是PC28结算或资产继承操作
    IF current_user = 'postgres' THEN
        -- 🎯 检查是否是 PC28 结算操作
        BEGIN
            v_is_pc28_settlement := current_setting('app.pc28_settlement', true)::boolean;
        EXCEPTION
            WHEN OTHERS THEN
                v_is_pc28_settlement := false;
        END;
        
        -- 🎯 检查是否是资产继承操作
        BEGIN
            v_is_inheritance := current_setting('app.inheritance_operation', true)::boolean;
        EXCEPTION
            WHEN OTHERS THEN
                v_is_inheritance := false;
        END;
        
        -- 如果是 PC28 结算操作，允许修改余额，但不允许修改 is_admin
        IF v_is_pc28_settlement THEN
            -- 🛑 即使PC28结算，也不允许修改 is_admin
            IF NEW.is_admin IS DISTINCT FROM OLD.is_admin THEN
                NEW.is_admin := OLD.is_admin;
            END IF;
            RETURN NEW;
        END IF;
        
        -- 🎯 如果是资产继承操作，允许修改余额，但不允许修改 is_admin
        IF v_is_inheritance THEN
            -- 🛑 即使资产继承，也不允许修改 is_admin
            IF NEW.is_admin IS DISTINCT FROM OLD.is_admin THEN
                NEW.is_admin := OLD.is_admin;
            END IF;
            RETURN NEW;
        END IF;
        
        -- 🎯 非 PC28 结算且非资产继承：只允许修改自己的余额，但不允许修改 is_admin
        -- 检查是否在修改资产字段
        IF (NEW.balance_coins IS DISTINCT FROM OLD.balance_coins) OR
           (NEW.frozen_coins IS DISTINCT FROM OLD.frozen_coins) THEN
            -- 🛑 关键安全检查：只能修改自己的余额
            IF NEW.id != auth.uid() THEN
                -- 恢复原值，阻止修改
                NEW.balance_coins := OLD.balance_coins;
                NEW.frozen_coins := OLD.frozen_coins;
            END IF;
        END IF;
        
        -- 🛑 关键修复：is_admin 字段不允许任何人修改（包括自己）
        -- 即使是修改自己的记录，也不允许修改 is_admin
        IF NEW.is_admin IS DISTINCT FROM OLD.is_admin THEN
            NEW.is_admin := OLD.is_admin;
        END IF;
        
        -- 其他字段的修改也需要检查
        IF NEW.id != auth.uid() THEN
            -- 如果不是修改自己的记录，锁定其他敏感字段
            NEW.auto_approve := OLD.auto_approve;
            NEW.numeric_id := OLD.numeric_id;
            NEW.tg_user_id := OLD.tg_user_id;
        END IF;
        RETURN NEW;
    END IF;
    
    -- 🎯 其他授权用户（管理员等）- 但这里也不应该允许修改 is_admin
    -- 注意：即使是管理员，也不应该通过普通UPDATE修改 is_admin，应该通过专门的函数
    IF current_user IN ('supabase_admin', 'dashboard_user') OR 
       EXISTS (
           SELECT 1 FROM auth.users 
           WHERE id = auth.uid() 
           AND email = 'hyf847510938@gmail.com'
       ) THEN
        -- 🛑 即使是授权用户，也不允许修改 is_admin（应该通过专门的管理函数）
        IF NEW.is_admin IS DISTINCT FROM OLD.is_admin THEN
            NEW.is_admin := OLD.is_admin;
        END IF;
        RETURN NEW;
    END IF;
    
    -- 🛑 默认情况：锁定所有敏感字段（包括 is_admin）
    NEW.is_admin := OLD.is_admin;
    NEW.auto_approve := OLD.auto_approve;
    NEW.balance_coins := OLD.balance_coins;
    NEW.frozen_coins := OLD.frozen_coins;
    NEW.numeric_id := OLD.numeric_id;
    NEW.tg_user_id := OLD.tg_user_id;
    NEW.id := OLD.id;
    
    RETURN NEW;
END;
$function$;

COMMENT ON FUNCTION public.protect_sensitive_profile_fields IS '🚨 修复：添加资产继承操作检查，允许 admin_execute_inheritance 函数修改余额';

-- 🎯 更新 admin_execute_inheritance 函数，在执行余额迁移前设置会话变量
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
    v_admin_id := auth.uid();
    IF v_admin_id IS NULL AND auth.role() != 'service_role' THEN
        RAISE EXCEPTION '无法获取管理员ID。';
    END IF;

    -- 🚨 安全验证 3: 基本校验
    IF p_from_numeric_id = p_to_numeric_id THEN
        RAISE EXCEPTION '源账号和目标账号不能是同一个。';
    END IF;

    -- 🎯 设置会话变量，标识这是资产继承操作，允许触发器修改余额
    PERFORM set_config('app.inheritance_operation', 'true', false);

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
        -- 🎯 重置会话变量
        PERFORM set_config('app.inheritance_operation', 'false', false);
        RAISE EXCEPTION '源账号 (数字ID: %) 不存在。', p_from_numeric_id;
    END IF;
    IF v_target_profile_id IS NULL THEN
        -- 🎯 重置会话变量
        PERFORM set_config('app.inheritance_operation', 'false', false);
        RAISE EXCEPTION '目标账号 (数字ID: %) 不存在。', p_to_numeric_id;
    END IF;

    -- 🚨 安全验证 4: 单次继承最大金额限制（1000000抖币）
    IF v_source_balance > 1000000 THEN
        -- 🎯 重置会话变量
        PERFORM set_config('app.inheritance_operation', 'false', false);
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

    -- 🎯 修复：迁移余额（无论余额是否为0都执行，因为用户可能只有作品没有余额）
    -- 先清零源账号余额
    UPDATE public.profiles SET balance_coins = 0 WHERE id = v_source_profile_id;
    
    -- 迁移余额到目标账号，并获取最终余额
    UPDATE public.profiles 
    SET balance_coins = balance_coins + v_source_balance 
    WHERE id = v_target_profile_id
    RETURNING balance_coins INTO v_target_final_balance;

    -- 🎯 修复：只有当余额大于0时才记录流水（避免0余额时记录无效流水）
    IF v_source_balance > 0 THEN
        v_transaction_id := gen_random_uuid();
        
        -- 记录源账号流水（转出）
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

        -- 记录目标账号流水（转入），使用更新后的余额
        INSERT INTO public.coin_transactions (
            id, user_id, amount, balance_after, type, description, related_id, counterparty_id
        )
        VALUES (
            gen_random_uuid(), 
            v_target_profile_id, 
            v_source_balance, 
            v_target_final_balance, 
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

    -- 🎯 重置会话变量
    PERFORM set_config('app.inheritance_operation', 'false', false);

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
        RAISE;
END; $func$;

COMMENT ON FUNCTION public.admin_execute_inheritance IS '🚨 修复：添加会话变量标识，允许触发器修改余额';
