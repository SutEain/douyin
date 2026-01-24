-- 🚨 禁用 admin_adjust_balance 函数，防止未授权调用
-- 问题：虽然后台前端已经移除了调整余额功能，但RPC函数仍然可以被调用
-- 修复：撤销所有公开权限，只保留 service_role 权限（用于紧急情况）

-- 1. 撤销所有公开权限
REVOKE EXECUTE ON FUNCTION public.admin_adjust_balance(UUID, NUMERIC, TEXT) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.admin_adjust_balance(UUID, NUMERIC, TEXT) FROM anon;
REVOKE EXECUTE ON FUNCTION public.admin_adjust_balance(UUID, NUMERIC, TEXT) FROM public;

-- 2. 只保留 service_role 权限（用于紧急情况，需要服务端调用）
-- 注意：service_role 默认有所有权限，不需要显式 GRANT

-- 3. 修改函数，添加额外的安全检查，即使被调用也直接拒绝
CREATE OR REPLACE FUNCTION public.admin_adjust_balance(
    target_user_id UUID,
    amount_change DECIMAL,
    description_text TEXT
) RETURNS JSON 
LANGUAGE plpgsql
SECURITY DEFINER
AS $func$
BEGIN
    -- 🛑 直接拒绝所有调用，此功能已禁用
    RETURN json_build_object(
        'success', false, 
        'message', '此功能已禁用，不允许手动调整余额。如需调整，请联系系统管理员。'
    );
END; $func$;

COMMENT ON FUNCTION public.admin_adjust_balance IS '🚨 已禁用：手动调整余额功能已禁用，不允许调用';
