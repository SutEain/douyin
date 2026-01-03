-- 1. 创建通知历史表（用于去重和冷却）
CREATE TABLE IF NOT EXISTS notification_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sender_id UUID REFERENCES profiles(id),
  receiver_id UUID REFERENCES profiles(id),
  type TEXT NOT NULL, -- 'like', 'follow', 'collect', 'comment', etc.
  related_id TEXT, -- 关联 ID (如 video_id)
  created_at TIMESTAMPTZ DEFAULT now()
);

-- 为查询加速创建索引
CREATE INDEX IF NOT EXISTS idx_notif_history_dedupe 
ON notification_history (sender_id, receiver_id, type, created_at DESC);

-- 2. 创建一个简单的频率检查函数（可选，也可以在代码里查）
-- 这里我们直接在代码里用 Supabase 查询更灵活
