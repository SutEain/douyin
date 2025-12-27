-- 1. 重命名列 is_shortdrama 为 is_sea
ALTER TABLE public.videos RENAME COLUMN is_shortdrama TO is_sea;

-- 2. 更新列注释
COMMENT ON COLUMN public.videos.is_sea IS '是否东南亚板块：true=东南亚内容池；推荐/关注等常规 feed 默认不展示';

-- 3. 重命名索引
DROP INDEX IF EXISTS idx_videos_shortdrama_published;
CREATE INDEX IF NOT EXISTS idx_videos_sea_published
ON public.videos (published_at DESC NULLS LAST, created_at DESC)
WHERE status = 'published' AND is_sea = true AND is_adult = false AND content_type = 'video';

