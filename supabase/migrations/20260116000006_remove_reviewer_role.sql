-- 🎯 删除审核员角色相关权限
-- 1. 先删除依赖视图
-- 2. 删除 profiles 表的 is_reviewer 字段
-- 3. 重新创建 admin_profiles_list 视图（移除 is_reviewer）
-- 4. 所有审核操作仅限管理员

-- -----------------------------------------------------------------------------
-- 1. 先删除依赖视图
-- -----------------------------------------------------------------------------
DROP VIEW IF EXISTS public.admin_profiles_list CASCADE;

-- -----------------------------------------------------------------------------
-- 2. 删除 profiles 表的 is_reviewer 字段
-- -----------------------------------------------------------------------------
ALTER TABLE public.profiles DROP COLUMN IF EXISTS is_reviewer;

-- -----------------------------------------------------------------------------
-- 3. 重新创建 admin_profiles_list 视图（移除 is_reviewer）
-- -----------------------------------------------------------------------------
CREATE VIEW public.admin_profiles_list AS
SELECT
  p.id,
  p.username,
  p.nickname,
  p.bio,
  p.avatar_url,
  p.cover_url,
  p.tg_user_id,
  p.tg_username,
  p.auth_provider,
  p.lang,
  p.email_verified,
  p.follower_count,
  p.following_count,
  p.total_likes,
  p.video_count,
  p.last_active_at,
  p.created_at,
  p.updated_at,
  p.deleted_at,
  p.gender,
  p.birthday,
  p.country,
  p.province,
  p.city,
  p.numeric_id,
  p.show_collect,
  p.show_like,
  p.show_tg_username,
  p.notification_settings,
  p.auto_approve,
  p.invite_success_count,
  p.invited_by,
  p.adult_daily_limit,
  p.adult_unlock_until,
  p.adult_permanent_unlock,
  p.balance_coins,
  p.frozen_coins,
  p.live_status,
  p.is_admin,
  p.status,
  p.last_checkin_at,
  p.checkin_streak,
  p.invite_rewarded,
  p.is_banned,
  p.ban_reason,
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

COMMENT ON COLUMN public.profiles.is_admin IS '管理员权限（唯一权限角色）';
