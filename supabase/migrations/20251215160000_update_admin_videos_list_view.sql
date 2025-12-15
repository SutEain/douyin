-- 修复：后台视频列表视图排序 & 作者搜索
-- 1) draft 永远放最后（即便 review_status = pending 也不应排在“待审核”前）
-- 2) 新增 author_search 字段，避免前端使用 dataProvider 的 OR 过滤结构导致报错

CREATE OR REPLACE VIEW public.admin_videos_list AS
SELECT
  v.*,

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
  ) AS author_search
FROM public.videos v
LEFT JOIN public.profiles p ON p.id = v.author_id;


