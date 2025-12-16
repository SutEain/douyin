-- 修复 profiles.invited_by 自关联外键缺失导致 PostgREST 无法做 embed join（PGRST200）
-- 背景：之前迁移使用 `ADD COLUMN IF NOT EXISTS invited_by uuid REFERENCES profiles(id)`
-- 如果 invited_by 在更早就已存在（但没有 FK），上述迁移不会补上 FK 约束。
-- 本迁移将显式补充外键约束（幂等）。

DO $$
DECLARE
  has_fk boolean := false;
BEGIN
  -- invited_by 列不存在则直接跳过（避免报错）
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'profiles'
      AND column_name = 'invited_by'
  ) THEN
    RAISE NOTICE 'profiles.invited_by does not exist, skip FK creation';
    RETURN;
  END IF;

  -- 检测是否已经存在 “profiles(invited_by) -> profiles(id)” 的外键（不关心约束名）
  SELECT EXISTS (
    SELECT 1
    FROM pg_constraint c
    JOIN pg_class rel ON rel.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = rel.relnamespace
    JOIN pg_attribute a ON a.attrelid = rel.oid
    WHERE c.contype = 'f'
      AND n.nspname = 'public'
      AND rel.relname = 'profiles'
      AND a.attname = 'invited_by'
      AND a.attnum = ANY (c.conkey)
      AND c.confrelid = rel.oid  -- self-reference to profiles
  ) INTO has_fk;

  IF has_fk THEN
    RAISE NOTICE 'profiles.invited_by FK already exists, skip';
    RETURN;
  END IF;

  -- 显式创建外键约束（使用默认命名风格，供 PostgREST embed hint 使用）
  ALTER TABLE public.profiles
    ADD CONSTRAINT profiles_invited_by_fkey
    FOREIGN KEY (invited_by)
    REFERENCES public.profiles (id)
    ON DELETE SET NULL;

  RAISE NOTICE 'profiles.invited_by FK created: profiles_invited_by_fkey';
END $$;


