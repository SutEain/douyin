-- 🎯 修复猜拳游戏 RPC 权限问题
-- 问题：20260115000005_fix_all_rpcs_for_service_role.sql 修改了 create_rps_room 函数
--       但没有重新授予权限，可能导致 Edge Function 调用失败
-- 修复：确保 service_role 有执行权限

-- 重新授予权限（即使已经存在也不会报错）
GRANT EXECUTE ON FUNCTION public.create_rps_room(UUID, BIGINT, DECIMAL) TO service_role;
GRANT EXECUTE ON FUNCTION public.join_rps_room(UUID, UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.save_rps_choice(UUID, UUID, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.settle_rps_room(UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.cancel_rps_room(UUID, UUID) TO service_role;
