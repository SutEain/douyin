-- 🎯 更新封号相关函数：在更新封号字段前设置会话变量
-- 问题：protect_sensitive_profile_fields 触发器会阻止封号字段的更新
-- 修复：在封号函数中设置 app.admin_ban_operation 会话变量，允许更新

-- 1. 更新批量封禁函数（如果存在）
-- 注意：这个函数在 20260129000002_batch_ban_users.sql 中定义，但它是 DO 块，不是函数
-- 我们需要创建一个可重用的封号函数

-- 创建管理员封号/解封函数
CREATE OR REPLACE FUNCTION public.admin_ban_user(
    p_user_id UUID,
    p_is_banned BOOLEAN,
    p_ban_reason TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
    v_admin_id UUID;
    v_user_nickname TEXT;
BEGIN
    -- 🚨 安全验证：权限检查
    IF NOT public.check_is_admin() THEN
        RAISE EXCEPTION '您没有权限执行此操作。';
    END IF;

    -- 🚨 安全验证：获取管理员 ID
    SELECT id INTO v_admin_id FROM public.profiles WHERE id = auth.uid() AND is_admin = true;
    IF v_admin_id IS NULL THEN
        RAISE EXCEPTION '管理员身份验证失败。';
    END IF;

    -- 🚨 安全验证：检查用户是否存在
    SELECT nickname INTO v_user_nickname FROM public.profiles WHERE id = p_user_id;
    IF v_user_nickname IS NULL THEN
        RAISE EXCEPTION '用户不存在（ID: %)', p_user_id;
    END IF;

    -- 🎯 设置会话变量，允许更新封号字段
    PERFORM set_config('app.admin_ban_operation', 'true', false);

    -- 更新封号状态
    UPDATE public.profiles
    SET is_banned = p_is_banned,
        ban_reason = CASE 
            WHEN p_is_banned THEN COALESCE(p_ban_reason, '管理员封禁')
            ELSE NULL
        END,
        updated_at = now()
    WHERE id = p_user_id;

    -- 🎯 重置会话变量
    PERFORM set_config('app.admin_ban_operation', 'false', false);

    RETURN jsonb_build_object(
        'success', true,
        'message', CASE 
            WHEN p_is_banned THEN format('用户 %s 已封禁', COALESCE(v_user_nickname, p_user_id::TEXT))
            ELSE format('用户 %s 已解封', COALESCE(v_user_nickname, p_user_id::TEXT))
        END,
        'user_id', p_user_id,
        'is_banned', p_is_banned,
        'ban_reason', CASE WHEN p_is_banned THEN COALESCE(p_ban_reason, '管理员封禁') ELSE NULL END
    );
EXCEPTION
    WHEN OTHERS THEN
        -- 🎯 确保异常时也重置会话变量
        PERFORM set_config('app.admin_ban_operation', 'false', false);
        RAISE;
END;
$$;

COMMENT ON FUNCTION public.admin_ban_user IS '管理员封号/解封用户函数，已添加封号字段保护支持';

-- 2. 创建批量封号函数（基于 numeric_id）
CREATE OR REPLACE FUNCTION public.admin_batch_ban_users(
    p_numeric_ids BIGINT[],
    p_ban_reason TEXT DEFAULT '批量封禁'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
    v_user_record RECORD;
    v_processed_count INT := 0;
    v_skipped_count INT := 0;
    v_not_found_ids BIGINT[] := ARRAY[]::BIGINT[];
    v_admin_id UUID;
BEGIN
    -- 🚨 安全验证：权限检查
    IF NOT public.check_is_admin() THEN
        RAISE EXCEPTION '您没有权限执行此操作。';
    END IF;

    -- 🚨 安全验证：获取管理员 ID
    SELECT id INTO v_admin_id FROM public.profiles WHERE id = auth.uid() AND is_admin = true;
    IF v_admin_id IS NULL THEN
        RAISE EXCEPTION '管理员身份验证失败。';
    END IF;

    -- 🎯 设置会话变量，允许更新封号字段
    PERFORM set_config('app.admin_ban_operation', 'true', false);

    -- 遍历所有需要封禁的用户
    FOR v_user_record IN 
        SELECT id, numeric_id, nickname, username, is_banned
        FROM public.profiles
        WHERE numeric_id = ANY(p_numeric_ids)
    LOOP
        -- 如果已经是封禁状态，跳过
        IF v_user_record.is_banned = true THEN
            v_skipped_count := v_skipped_count + 1;
            CONTINUE;
        END IF;
        
        -- 封禁用户
        UPDATE public.profiles
        SET is_banned = true,
            ban_reason = p_ban_reason,
            updated_at = now()
        WHERE id = v_user_record.id;
        
        v_processed_count := v_processed_count + 1;
    END LOOP;
    
    -- 检查是否有未找到的用户
    SELECT ARRAY_AGG(numeric_id) INTO v_not_found_ids
    FROM unnest(p_numeric_ids) AS t(numeric_id)
    WHERE numeric_id NOT IN (
        SELECT numeric_id FROM public.profiles WHERE numeric_id = ANY(p_numeric_ids)
    );

    -- 🎯 重置会话变量
    PERFORM set_config('app.admin_ban_operation', 'false', false);

    RETURN jsonb_build_object(
        'success', true,
        'message', format('批量封禁完成，共处理 %s 个用户，跳过 %s 个已封禁用户', v_processed_count, v_skipped_count),
        'processed_count', v_processed_count,
        'skipped_count', v_skipped_count,
        'not_found_ids', v_not_found_ids
    );
EXCEPTION
    WHEN OTHERS THEN
        -- 🎯 确保异常时也重置会话变量
        PERFORM set_config('app.admin_ban_operation', 'false', false);
        RAISE;
END;
$$;

COMMENT ON FUNCTION public.admin_batch_ban_users IS '管理员批量封号函数，已添加封号字段保护支持';
