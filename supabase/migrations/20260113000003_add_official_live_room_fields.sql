-- 🎯 为官方直播间添加自定义人数显示字段

-- 添加自定义观看人数字段（如果为NULL，则使用真实的viewer_count）
ALTER TABLE public.live_broadcast_rooms
ADD COLUMN IF NOT EXISTS custom_viewer_count INTEGER DEFAULT NULL;

-- 添加注释
COMMENT ON COLUMN public.live_broadcast_rooms.custom_viewer_count IS '自定义观看人数（用于官方直播间显示，NULL表示使用真实人数）';

-- 创建索引以便快速查询官方直播间
CREATE INDEX IF NOT EXISTS idx_live_broadcast_rooms_custom_viewer_count 
ON public.live_broadcast_rooms(custom_viewer_count) 
WHERE custom_viewer_count IS NOT NULL;

