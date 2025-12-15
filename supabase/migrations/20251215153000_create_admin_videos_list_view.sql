-- Admin 视频列表视图（仅用于后台列表读取）
-- 目标：
-- 1) 业务优先级排序：待审核 > 就绪 > 处理中 > 已发布 > 失败/拒绝 > 草稿
-- 2) 支持后台“搜索用户”：author uuid / numeric_id / username / nickname

CREATE OR REPLACE VIEW public.admin_videos_list AS
SELECT
  v.*,

  -- ✅ 排序优先级（数字越小越靠前）
  CASE
    WHEN v.review_status = 'pending' THEN 10                  -- 待审核
    WHEN v.status = 'ready' THEN 20                           -- 就绪
    WHEN v.status = 'processing' THEN 30                      -- 处理中
    WHEN v.status = 'published' THEN 40                       -- 已发布
    WHEN v.review_status = 'rejected' THEN 80                 -- 已拒绝（不一定都在 failed）
    WHEN v.status = 'failed' THEN 85                          -- 失败
    WHEN v.status = 'draft' THEN 99                           -- 草稿放最后
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
  ) AS profiles
FROM public.videos v
LEFT JOIN public.profiles p ON p.id = v.author_id;


