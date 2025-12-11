-- 为 profiles 表增加邀请与成人内容解锁相关字段

ALTER TABLE public.profiles
ADD COLUMN IF NOT EXISTS invite_success_count integer NOT NULL DEFAULT 0,
ADD COLUMN IF NOT EXISTS invited_by uuid REFERENCES public.profiles (id) ON DELETE SET NULL,
ADD COLUMN IF NOT EXISTS adult_daily_limit integer NOT NULL DEFAULT 5,
ADD COLUMN IF NOT EXISTS adult_unlock_until timestamptz,
ADD COLUMN IF NOT EXISTS adult_permanent_unlock boolean NOT NULL DEFAULT false;


