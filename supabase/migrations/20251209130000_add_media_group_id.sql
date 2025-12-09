ALTER TABLE videos ADD COLUMN IF NOT EXISTS media_group_id text;
CREATE INDEX IF NOT EXISTS idx_videos_media_group_id ON videos(media_group_id);

