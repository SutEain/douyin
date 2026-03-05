-- 🎯 封禁/解封漏洞加固：禁止自己给自己解封，并仅允许「已登录管理员」执行
-- 排查结论：个人资料、RLS、触发器、app-server 均无法改 is_banned；可能原因：(1) 刷手曾为 admin (2) 管理员 session 泄露
-- 本迁移：(1) 禁止 p_user_id = auth.uid() 时执行解封 (2) 显式要求 auth.uid() 存在且为管理员，不依赖 service_role 绕过

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
    -- 🚨 必须已登录（禁止 service_role 等无 uid 的调用直接解封任意用户）
    IF auth.uid() IS NULL THEN
        RAISE EXCEPTION '未登录，无法执行封禁/解封操作。';
    END IF;

    -- 🚨 仅允许当前登录用户为管理员（不依赖 check_is_admin 的 service_role 绕过）
    SELECT id INTO v_admin_id FROM public.profiles WHERE id = auth.uid() AND is_admin = true;
    IF v_admin_id IS NULL THEN
        RAISE EXCEPTION '您没有权限执行此操作。';
    END IF;

    -- 🚨 禁止自己给自己解封（防止刷手若曾为 admin 或 session 混淆时自解封）
    IF p_is_banned = false AND p_user_id = auth.uid() THEN
        RAISE EXCEPTION '不能为自己解封，请由其他管理员操作。';
    END IF;

    -- 🚨 检查目标用户是否存在
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
        PERFORM set_config('app.admin_ban_operation', 'false', false);
        RAISE;
END;
$$;

COMMENT ON FUNCTION public.admin_ban_user IS '管理员封号/解封；禁止自己给自己解封，且仅允许已登录管理员执行（不依赖 service_role）';
