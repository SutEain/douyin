-- 添加数字ID功能和隐私设置字段

-- 1. 添加数字ID字段到 profiles 表
ALTER TABLE public.profiles
ADD COLUMN IF NOT EXISTS numeric_id BIGINT UNIQUE;

-- 2. 创建序列用于自动分配数字ID（从10000开始）
CREATE SEQUENCE IF NOT EXISTS profile_numeric_id_seq
  START WITH 10000
  INCREMENT BY 1
  NO MAXVALUE
  CACHE 1;

-- 3. 添加隐私设置字段
ALTER TABLE public.profiles
ADD COLUMN IF NOT EXISTS show_collect BOOLEAN DEFAULT TRUE,
ADD COLUMN IF NOT EXISTS show_like BOOLEAN DEFAULT TRUE,
ADD COLUMN IF NOT EXISTS show_tg_username BOOLEAN DEFAULT TRUE;

-- 4. 为现有用户分配数字ID（按创建时间顺序）
WITH numbered_profiles AS (
  SELECT 
    id,
    ROW_NUMBER() OVER (ORDER BY created_at) - 1 as row_num
  FROM public.profiles
  WHERE numeric_id IS NULL
)
UPDATE public.profiles
SET numeric_id = 10000 + numbered_profiles.row_num
FROM numbered_profiles
WHERE profiles.id = numbered_profiles.id;

-- 5. 更新序列的当前值（确保下一个分配的ID不会重复）
SELECT setval('profile_numeric_id_seq', (SELECT COALESCE(MAX(numeric_id), 9999) FROM public.profiles));

-- 6. 添加注释
COMMENT ON COLUMN public.profiles.numeric_id IS 'User numeric ID starting from 10000, auto-incremented';
COMMENT ON COLUMN public.profiles.show_collect IS 'Whether to show collect list publicly';
COMMENT ON COLUMN public.profiles.show_like IS 'Whether to show like list publicly';
COMMENT ON COLUMN public.profiles.show_tg_username IS 'Whether to show Telegram username publicly';

-- 7. 创建函数：自动为新用户分配数字ID
CREATE OR REPLACE FUNCTION assign_numeric_id()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.numeric_id IS NULL THEN
    NEW.numeric_id := nextval('profile_numeric_id_seq');
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 8. 创建触发器：在插入新用户时自动分配数字ID
DROP TRIGGER IF EXISTS trigger_assign_numeric_id ON public.profiles;
CREATE TRIGGER trigger_assign_numeric_id
  BEFORE INSERT ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION assign_numeric_id();

-- 9. 创建索引优化查询性能
CREATE INDEX IF NOT EXISTS idx_profiles_numeric_id ON public.profiles(numeric_id);

