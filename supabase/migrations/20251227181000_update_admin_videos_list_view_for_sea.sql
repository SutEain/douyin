CREATE OR REPLACE VIEW public.admin_videos_list (
  id,
  author_id,
  title,
  description,
  play_url,
  cover_url,
  duration,
  width,
  height,
  file_size,
  view_count,
  like_count,
  comment_count,
  share_count,
  collect_count,
  is_private,
  review_status,
  tags,
  category,
  created_at,
  updated_at,
  location_country,
  location_country_code,
  status,
  published_at,
  tg_file_id,
  tg_unique_id,
  tg_thumbnail_file_id,
  storage_type,
  tg_user_id,
  location_city,
  is_top,
  reject_reason,
  media_group_id,
  content_type,
  images,
  is_recommended,
  recommended_at,
  is_adult,
  admin_sort_rank,
  admin_sort_time,
  author_numeric_id,
  author_username,
  author_nickname,
  author_avatar_url,
  profiles,
  author_search,
  is_sea
) AS
SELECT
  -- ✅ 基础字段（顺序必须与线上 view 一致）
  v.id,
  v.author_id,
  v.title,
  v.description,
  v.play_url,
  v.cover_url,
  v.duration,
  v.width,
  v.height,
  v.file_size,
  v.view_count,
  v.like_count,
  v.comment_count,
  v.share_count,
  v.collect_count,
  v.is_private,
  v.review_status,
  v.tags,
  v.category,
  v.created_at,
  v.updated_at,
  v.location_country,
  v.location_country_code,
  v.status,
  v.published_at,
  v.tg_file_id,
  v.tg_unique_id,
  v.tg_thumbnail_file_id,
  v.storage_type,
  v.tg_user_id,
  v.location_city,
  v.is_top,
  v.reject_reason,
  v.media_group_id,
  v.content_type,
  v.images,
  v.is_recommended,
  v.recommended_at,
  v.is_adult,

  -- ✅ 排序优先级（数字越小越靠前）
  CASE
    WHEN v.status = 'draft' THEN 99                           -- 草稿永远最后
    WHEN v.review_status = 'pending' THEN 10                  -- 待审核
    WHEN v.status = 'ready' THEN 20                           -- 就绪
    WHEN v.status = 'processing' THEN 30                      -- 处理中
    WHEN v.status = 'published' THEN 40                       -- 已发布
    WHEN v.review_status = 'rejected' THEN 80                 -- 已拒绝（不一定都在 failed）
    WHEN v.status = 'failed' THEN 85                          -- 失败
    ELSE 50
  END AS admin_sort_rank,

  -- ✅ 统一时间字段：优先发布时间，否则创建时间
  COALESCE(v.published_at, v.created_at) AS admin_sort_time,

  -- ✅ 作者信息（用于列表展示 + 搜索）
  p.numeric_id AS author_numeric_id,
  p.username AS author_username,
  p.nickname AS author_nickname,
  p.avatar_url AS author_avatar_url,

  -- ✅ 兼容前端现有 record.profiles.nickname / avatar_url 用法
  jsonb_build_object(
    'id', p.id,
    'numeric_id', p.numeric_id,
    'username', p.username,
    'nickname', p.nickname,
    'avatar_url', p.avatar_url
  ) AS profiles,

  -- ✅ 后台作者搜索字段（小写，便于 contains/ilike）
  lower(
    concat_ws(
      ' ',
      p.id::text,
      p.numeric_id::text,
      coalesce(p.username, ''),
      coalesce(p.nickname, '')
    )
  ) AS author_search,

  -- ✅ 末尾：东南亚标记（必须在最后，保持列顺序不变）
  v.is_sea
FROM public.videos v
LEFT JOIN public.profiles p ON p.id = v.author_id
WHERE (auth.jwt() -> 'app_metadata' ->> 'role') = 'admin';

