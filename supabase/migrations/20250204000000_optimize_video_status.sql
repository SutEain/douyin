-- 优化视频状态管理
-- 1. 添加 file_size 字段
-- 2. 优化状态定义
-- 3. 添加索引

-- 添加 file_size 字段（如果不存在）
ALTER TABLE public.videos
ADD COLUMN IF NOT EXISTS file_size BIGINT DEFAULT 0;

-- 允许 play_url 为空（处理中的大文件还没有播放 URL）
ALTER TABLE public.videos
ALTER COLUMN play_url DROP NOT NULL;

-- 允许 cover_url 为空（处理中的大文件还没有封面 URL）
ALTER TABLE public.videos
ALTER COLUMN cover_url DROP NOT NULL;

-- 更新 status 约束，支持新的状态值
ALTER TABLE public.videos
DROP CONSTRAINT IF EXISTS chk_status;

ALTER TABLE public.videos
ADD CONSTRAINT chk_status CHECK (
  status IN ('draft', 'processing', 'ready', 'published', 'failed')
);

-- 添加字段注释
COMMENT ON COLUMN public.videos.file_size IS '视频文件大小（字节）';

-- 更新 status 字段的注释，明确各状态含义
COMMENT ON COLUMN public.videos.status IS '视频状态：
  draft - 草稿（小文件，已接收，可编辑）
  processing - 处理中（大文件，正在下载/上传到R2）
  ready - 就绪（大文件处理完成，可编辑）
  published - 已发布（显示在首页）
  failed - 处理失败';

-- 添加索引：优化查询 processing 状态的视频
CREATE INDEX IF NOT EXISTS idx_videos_processing 
ON public.videos(status, created_at DESC) 
WHERE status = 'processing';

-- 添加索引：优化查询 ready 状态的视频（大文件处理完成）
CREATE INDEX IF NOT EXISTS idx_videos_ready
ON public.videos(tg_user_id, status, created_at DESC)
WHERE status = 'ready';

-- 优化已发布视频的索引
DROP INDEX IF EXISTS idx_videos_published;
CREATE INDEX idx_videos_published 
ON public.videos(status, published_at DESC NULLS LAST) 
WHERE status = 'published';

-- 添加索引：优化"我的视频"页面查询（按用户ID和状态）
CREATE INDEX IF NOT EXISTS idx_videos_user_status
ON public.videos(tg_user_id, status, created_at DESC);

