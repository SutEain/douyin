-- 为 bot 的“我的视频”单面板模式保存面板消息ID
alter table public.user_bot_states
  add column if not exists dashboard_message_id bigint;


