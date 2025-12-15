-- 🎯 短剧标记：推荐 feed 不出现短剧；短剧 tab 只看短剧

ALTER TABLE public.videos
ADD COLUMN IF NOT EXISTS is_shortdrama BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN public.videos.is_shortdrama IS '是否短剧：true=短剧内容池；推荐/关注等常规 feed 默认不展示';

-- 索引：短剧 tab 常用查询（已发布短剧，按发布时间倒序）
CREATE INDEX IF NOT EXISTS idx_videos_shortdrama_published
ON public.videos (published_at DESC NULLS LAST, created_at DESC)
WHERE status = 'published' AND is_shortdrama = true AND is_adult = false AND content_type = 'video';


