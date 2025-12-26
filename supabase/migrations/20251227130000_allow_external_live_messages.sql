-- 1. 移除直播消息对自建直播间表的硬性关联，以支持转播直播间的互动消息
ALTER TABLE public.live_broadcast_messages DROP CONSTRAINT IF EXISTS live_broadcast_messages_room_id_fkey;

-- 2. 虽然移除了外键，但建议保留索引以维持性能
-- （索引已经在之前的迁移中创建过，这里只是确保存在）
CREATE INDEX IF NOT EXISTS idx_live_broadcast_messages_room_id ON public.live_broadcast_messages(room_id);

