-- 取消 videos.description 的长度限制
-- 之前的 chk_description_length (char_length(description) <= 500) 会导致转发相册（文案很长）上传失败：
-- new row for relation "videos" violates check constraint "chk_description_length"

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'chk_description_length'
      AND conrelid = 'public.videos'::regclass
  ) THEN
    ALTER TABLE public.videos DROP CONSTRAINT chk_description_length;
  END IF;
END $$;


