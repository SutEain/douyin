-- Live rooms (admin-managed)
-- 用于“直播”Tab 展示直播间列表（后台维护平台/房间号/封面等）

CREATE TABLE IF NOT EXISTS public.live_rooms (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  platform TEXT NOT NULL,
  room_type TEXT NOT NULL DEFAULT 'rid', -- 平台内的标识类型：rid/uid/room 等（先给默认）
  room_id TEXT NOT NULL,
  title TEXT,
  cover_url TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT live_rooms_platform_chk CHECK (platform IN ('douyin', 'douyu', 'huya', 'bilibili', 'yy')),
  CONSTRAINT live_rooms_room_id_chk CHECK (char_length(room_id) > 0),
  CONSTRAINT live_rooms_cover_url_chk CHECK (cover_url IS NULL OR cover_url ~* '^https?://')
);

-- updated_at 自动维护
CREATE OR REPLACE FUNCTION public.live_rooms_set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_live_rooms_set_updated_at ON public.live_rooms;
CREATE TRIGGER trg_live_rooms_set_updated_at
BEFORE UPDATE ON public.live_rooms
FOR EACH ROW
EXECUTE FUNCTION public.live_rooms_set_updated_at();

-- RLS：仅 admin 账号在后台维护
ALTER TABLE public.live_rooms ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "live_rooms_admin_select" ON public.live_rooms;
CREATE POLICY "live_rooms_admin_select"
ON public.live_rooms
FOR SELECT
TO authenticated
USING ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');

DROP POLICY IF EXISTS "live_rooms_admin_insert" ON public.live_rooms;
CREATE POLICY "live_rooms_admin_insert"
ON public.live_rooms
FOR INSERT
TO authenticated
WITH CHECK ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');

DROP POLICY IF EXISTS "live_rooms_admin_update" ON public.live_rooms;
CREATE POLICY "live_rooms_admin_update"
ON public.live_rooms
FOR UPDATE
TO authenticated
USING ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin')
WITH CHECK ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');

DROP POLICY IF EXISTS "live_rooms_admin_delete" ON public.live_rooms;
CREATE POLICY "live_rooms_admin_delete"
ON public.live_rooms
FOR DELETE
TO authenticated
USING ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');


