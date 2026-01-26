-- 🚨 紧急修复：移除increment_view_count函数的anon权限
-- 问题：increment_view_count函数有anon权限，脚本可以直接调用刷播放量
-- 修复：移除anon权限，只允许service_role调用（内部使用）

-- 移除anon和PUBLIC权限
REVOKE EXECUTE ON FUNCTION public.increment_view_count(UUID) FROM anon;
REVOKE EXECUTE ON FUNCTION public.increment_view_count(UUID) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.increment_view_count(UUID) FROM authenticated;

-- 只允许service_role调用（内部使用）
GRANT EXECUTE ON FUNCTION public.increment_view_count(UUID) TO service_role;

COMMENT ON FUNCTION public.increment_view_count IS '🚨 修复安全漏洞：移除anon和authenticated权限，只允许service_role调用，防止脚本直接调用刷播放量';
