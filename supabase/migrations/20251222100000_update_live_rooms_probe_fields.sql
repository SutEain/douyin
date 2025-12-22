-- 补齐 live_rooms 的直播地址与探测字段（兼容式：如果已存在则跳过）

ALTER TABLE public.live_rooms
  ADD COLUMN IF NOT EXISTS stream_url TEXT,
  ADD COLUMN IF NOT EXISTS description TEXT,
  ADD COLUMN IF NOT EXISTS category TEXT,
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'unknown',
  ADD COLUMN IF NOT EXISTS last_checked_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS check_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_error TEXT;

-- 给 stream_url 一个基础校验（可选：已有约束则跳过）
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'live_rooms_stream_url_chk'
  ) THEN
    ALTER TABLE public.live_rooms
      ADD CONSTRAINT live_rooms_stream_url_chk
      CHECK (stream_url IS NULL OR stream_url ~* '^https?://');
  END IF;
END$$;

-- 如果历史数据里没有 stream_url，但有平台+room_id，可先留空；后台后续编辑补齐


