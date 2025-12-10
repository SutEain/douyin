-- 为视频表增加成人内容标记字段
ALTER TABLE public.videos
ADD COLUMN IF NOT EXISTS is_adult BOOLEAN NOT NULL DEFAULT FALSE;

-- 为成人内容过滤添加索引（结合 published 状态，方便前端常用查询）
CREATE INDEX IF NOT EXISTS idx_videos_is_adult_published
ON public.videos (is_adult, status)
WHERE status = 'published';


