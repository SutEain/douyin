-- 给 profiles 表添加自动审核字段
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS auto_approve BOOLEAN DEFAULT false;

-- 添加注释
COMMENT ON COLUMN profiles.auto_approve IS '是否自动通过审核：true=自动通过，false=需要人工审核（新用户第一个视频通过后自动设为true）';

