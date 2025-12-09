-- 添加内容类型字段，支持视频/图片/相册
ALTER TABLE videos ADD COLUMN IF NOT EXISTS content_type VARCHAR(20) 
  DEFAULT 'video' 
  CHECK (content_type IN ('video', 'image', 'album'));

-- 添加图片数组字段（用于单图和相册）
-- 结构: [{ "file_id": "xxx", "width": 1080, "height": 1920, "order": 0 }]
ALTER TABLE videos ADD COLUMN IF NOT EXISTS images JSONB DEFAULT '[]'::jsonb;

-- 更新表注释
COMMENT ON COLUMN videos.content_type IS '内容类型：video=视频，image=单图，album=图片相册';
COMMENT ON COLUMN videos.images IS '图片数组，格式：[{file_id, width, height, order}]';

-- 为现有数据设置默认值（确保所有现有记录都是 video 类型）
UPDATE videos SET content_type = 'video' WHERE content_type IS NULL;

