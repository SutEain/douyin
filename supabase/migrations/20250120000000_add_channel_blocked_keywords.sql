-- 添加频道屏蔽词功能
-- 为 bound_channels 表添加 blocked_keywords 字段（文本数组）

ALTER TABLE public.bound_channels
ADD COLUMN IF NOT EXISTS blocked_keywords TEXT[] DEFAULT ARRAY[]::TEXT[];

-- 添加注释
COMMENT ON COLUMN public.bound_channels.blocked_keywords IS '频道屏蔽词列表，包含这些词的消息将不会被搬运';

-- 创建索引（用于快速查询有屏蔽词的频道）
CREATE INDEX IF NOT EXISTS idx_bound_channels_has_blocked_keywords 
ON public.bound_channels(id) 
WHERE array_length(blocked_keywords, 1) > 0;
