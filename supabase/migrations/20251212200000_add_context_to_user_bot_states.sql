-- 为 bot 增加统一的状态上下文字段（用于已发布搜索/分页等）
alter table public.user_bot_states
  add column if not exists context jsonb default '{}'::jsonb;


