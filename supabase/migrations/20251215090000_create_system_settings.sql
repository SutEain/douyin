-- System settings (admin-configurable)
-- 🎯 先用于 Bot 上传限制：bot_max_video_size_mb（默认 200）

CREATE TABLE IF NOT EXISTS public.system_settings (
  id TEXT PRIMARY KEY,
  value_int INTEGER,
  value_text TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- updated_at 自动维护（仅本表使用，避免依赖外部函数）
CREATE OR REPLACE FUNCTION public.system_settings_set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_system_settings_set_updated_at ON public.system_settings;
CREATE TRIGGER trg_system_settings_set_updated_at
BEFORE UPDATE ON public.system_settings
FOR EACH ROW
EXECUTE FUNCTION public.system_settings_set_updated_at();

-- RLS
ALTER TABLE public.system_settings ENABLE ROW LEVEL SECURITY;

-- 仅允许 app_metadata.role = 'admin' 的用户在后台读写
DROP POLICY IF EXISTS "system_settings_admin_select" ON public.system_settings;
CREATE POLICY "system_settings_admin_select"
ON public.system_settings
FOR SELECT
TO authenticated
USING ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');

DROP POLICY IF EXISTS "system_settings_admin_insert" ON public.system_settings;
CREATE POLICY "system_settings_admin_insert"
ON public.system_settings
FOR INSERT
TO authenticated
WITH CHECK ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');

DROP POLICY IF EXISTS "system_settings_admin_update" ON public.system_settings;
CREATE POLICY "system_settings_admin_update"
ON public.system_settings
FOR UPDATE
TO authenticated
USING ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin')
WITH CHECK ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');

DROP POLICY IF EXISTS "system_settings_admin_delete" ON public.system_settings;
CREATE POLICY "system_settings_admin_delete"
ON public.system_settings
FOR DELETE
TO authenticated
USING ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');

-- 默认值（幂等）
INSERT INTO public.system_settings (id, value_int, value_text)
VALUES ('bot_max_video_size_mb', 200, 'Bot 单视频最大大小（MiB）')
ON CONFLICT (id) DO NOTHING;


