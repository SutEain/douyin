-- Add notification_settings to profiles table
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS notification_settings JSONB DEFAULT '{"like": {"mute_until": 0}, "comment": {"mute_until": 0}, "collect": {"mute_until": 0}, "follow": {"mute_until": 0}}'::jsonb;

