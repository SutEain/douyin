-- 修复所有 deleted_at 字段的引用

-- 1. 删除使用 deleted_at 的索引
DROP INDEX IF EXISTS public.idx_videos_hot;
DROP INDEX IF EXISTS public.idx_videos_review_status;

-- 2. 重新创建索引（不使用 deleted_at）
CREATE INDEX idx_videos_hot 
ON public.videos USING btree (review_status, like_count DESC, view_count DESC, created_at DESC) 
WHERE review_status = 'approved';

CREATE INDEX idx_videos_review_status 
ON public.videos USING btree (review_status, created_at DESC);

-- 3. 修复 update_profile_video_count 函数
CREATE OR REPLACE FUNCTION public.update_profile_video_count()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  -- 插入新视频时，增加视频计数
  IF TG_OP = 'INSERT' THEN
    UPDATE public.profiles SET video_count = video_count + 1 WHERE id = NEW.author_id;
  -- 删除视频时，减少视频计数
  ELSIF TG_OP = 'DELETE' THEN
    UPDATE public.profiles SET video_count = GREATEST(video_count - 1, 0) WHERE id = OLD.author_id;
  END IF;
  RETURN NULL;
END;
$$;

-- 4. 确认 deleted_at 字段已删除（如果还存在的话）
ALTER TABLE public.videos DROP COLUMN IF EXISTS deleted_at;

COMMENT ON FUNCTION public.update_profile_video_count() IS '更新用户视频计数（插入时+1，删除时-1）';

