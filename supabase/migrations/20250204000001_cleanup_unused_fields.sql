-- 清理不需要的字段
-- 删除多语言、软删除、转码相关字段

-- 1. 先删除依赖 deleted_at 的策略
DROP POLICY IF EXISTS "Approved public videos are viewable by everyone" ON public.videos;

-- 2. 重新创建策略（不检查 deleted_at，因为我们真删除）
CREATE POLICY "Approved public videos are viewable by everyone"
ON public.videos FOR SELECT
USING (
  ((review_status = 'approved' AND is_private = false) OR (author_id = auth.uid()))
);

-- 3. 删除转码相关约束
ALTER TABLE public.videos
DROP CONSTRAINT IF EXISTS valid_transcode_status;

-- 4. 删除不需要的字段
ALTER TABLE public.videos
DROP COLUMN IF EXISTS title_i18n,           -- 多语言标题（不需要）
DROP COLUMN IF EXISTS description_i18n,     -- 多语言描述（不需要）
DROP COLUMN IF EXISTS deleted_at,           -- 软删除（改为真删除）
DROP COLUMN IF EXISTS transcode_status,     -- 转码状态（不需要转码）
DROP COLUMN IF EXISTS transfer_attempts,    -- 传输重试（Railway 自己处理）
DROP COLUMN IF EXISTS transfer_error;       -- 传输错误（Railway 自己处理）

-- 保留 review_status 用于内容审核
COMMENT ON COLUMN public.videos.review_status IS '内容审核状态：pending, auto_approved, manual_review, approved, rejected, appealing';

