-- 增加管理员统计相关的 RPC 函数

-- 1. 统计累计活跃用户数（在 watch_history 中出现过的去重用户数）
CREATE OR REPLACE FUNCTION public.get_active_user_count()
RETURNS BIGINT
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_count BIGINT;
BEGIN
    SELECT count(DISTINCT user_id) INTO v_count FROM public.watch_history;
    RETURN v_count;
END;
$$;

-- 2. 授权给已登录用户调用（内部有 SECURITY DEFINER 且逻辑简单，也可进一步限制仅管理员可见，但目前 bot 端已有权限校验）
GRANT EXECUTE ON FUNCTION public.get_active_user_count() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_active_user_count() TO service_role;

