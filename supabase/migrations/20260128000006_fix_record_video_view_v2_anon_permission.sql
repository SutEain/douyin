-- 🚨 紧急修复：移除record_video_view_v2函数的anon权限
-- 问题：anon角色有执行权限，脚本可以直接调用RPC函数刷播放量
-- 修复：移除anon权限，只允许authenticated用户通过Edge Function调用

-- 移除anon权限
REVOKE EXECUTE ON FUNCTION public.record_video_view_v2(UUID, UUID, INT, BOOLEAN) FROM anon;

-- 确保只有authenticated和service_role有权限
GRANT EXECUTE ON FUNCTION public.record_video_view_v2(UUID, UUID, INT, BOOLEAN) TO authenticated;
GRANT EXECUTE ON FUNCTION public.record_video_view_v2(UUID, UUID, INT, BOOLEAN) TO service_role;

COMMENT ON FUNCTION public.record_video_view_v2 IS '🚨 修复安全漏洞：移除anon权限，防止脚本直接调用RPC函数刷播放量';
