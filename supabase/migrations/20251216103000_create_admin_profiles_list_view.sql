-- Admin 用户列表视图：直接 JOIN 邀请人，避免 PostgREST 自关联 embed 的 schema cache / hint 问题（PGRST200）
-- 目标：
-- 1) 后台列表直接拿到“该用户被谁邀请”（profiles.invited_by -> profiles.id）
-- 2) 仅 admin 可读（view 内基于 JWT role 过滤；非 admin 返回空）

CREATE OR REPLACE VIEW public.admin_profiles_list AS
SELECT
  p.*,

  -- ✅ 邀请人基础信息（对象结构，方便前端直接 record.inviter.nickname）
  jsonb_build_object(
    'id', inv.id,
    'numeric_id', inv.numeric_id,
    'username', inv.username,
    'nickname', inv.nickname,
    'avatar_url', inv.avatar_url
  ) AS inviter
FROM public.profiles p
LEFT JOIN public.profiles inv ON inv.id = p.invited_by
WHERE (auth.jwt() -> 'app_metadata' ->> 'role') = 'admin';


