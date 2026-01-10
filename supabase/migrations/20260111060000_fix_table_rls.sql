-- 修复6个UNRESTRICTED表的RLS安全策略
-- 这些表之前没有启用行级安全（Row Level Security），存在安全风险

-- 1. red_packet_update_queue（红包批量更新队列）
-- 这是内部队列表，只允许 service_role 和系统函数访问
ALTER TABLE public.red_packet_update_queue ENABLE ROW LEVEL SECURITY;

-- 删除可能存在的旧策略
DROP POLICY IF EXISTS "Admins can view all queue" ON public.red_packet_update_queue;
DROP POLICY IF EXISTS "Service role can manage queue" ON public.red_packet_update_queue;

-- 管理员可以查看所有队列
CREATE POLICY "Admins can view all queue" ON public.red_packet_update_queue
  FOR SELECT
  USING (
    auth.jwt() ->> 'role' = 'service_role' OR
    (SELECT is_admin FROM public.profiles WHERE id = auth.uid()) = true
  );

-- 只有 service_role 可以修改队列
CREATE POLICY "Service role can manage queue" ON public.red_packet_update_queue
  FOR ALL
  USING (auth.jwt() ->> 'role' = 'service_role')
  WITH CHECK (auth.jwt() ->> 'role' = 'service_role');

-- 2. red_packet_wrong_attempts（红包答题错误记录）
-- 用户只能查看自己的错误记录
ALTER TABLE public.red_packet_wrong_attempts ENABLE ROW LEVEL SECURITY;

-- 删除可能存在的旧策略
DROP POLICY IF EXISTS "Users can view own wrong attempts" ON public.red_packet_wrong_attempts;
DROP POLICY IF EXISTS "Admins can view all wrong attempts" ON public.red_packet_wrong_attempts;
DROP POLICY IF EXISTS "Service role can manage wrong attempts" ON public.red_packet_wrong_attempts;

-- 用户查看自己的错误记录
CREATE POLICY "Users can view own wrong attempts" ON public.red_packet_wrong_attempts
  FOR SELECT
  USING (user_id = auth.uid());

-- 管理员查看所有记录
CREATE POLICY "Admins can view all wrong attempts" ON public.red_packet_wrong_attempts
  FOR SELECT
  USING ((SELECT is_admin FROM public.profiles WHERE id = auth.uid()) = true);

-- 只有 service_role 可以插入/更新/删除
CREATE POLICY "Service role can manage wrong attempts" ON public.red_packet_wrong_attempts
  FOR ALL
  USING (auth.jwt() ->> 'role' = 'service_role')
  WITH CHECK (auth.jwt() ->> 'role' = 'service_role');

-- 3. user_daily_watch_time（用户每日观看时长）
-- 用户只能查看自己的观看记录
ALTER TABLE public.user_daily_watch_time ENABLE ROW LEVEL SECURITY;

-- 删除可能存在的旧策略
DROP POLICY IF EXISTS "Users can view own daily watch time" ON public.user_daily_watch_time;
DROP POLICY IF EXISTS "Admins can view all daily watch time" ON public.user_daily_watch_time;
DROP POLICY IF EXISTS "Service role can manage daily watch time" ON public.user_daily_watch_time;

-- 用户查看自己的观看时长
CREATE POLICY "Users can view own daily watch time" ON public.user_daily_watch_time
  FOR SELECT
  USING (user_id = auth.uid());

-- 管理员查看所有记录
CREATE POLICY "Admins can view all daily watch time" ON public.user_daily_watch_time
  FOR SELECT
  USING ((SELECT is_admin FROM public.profiles WHERE id = auth.uid()) = true);

-- 只有 service_role 可以插入/更新
CREATE POLICY "Service role can manage daily watch time" ON public.user_daily_watch_time
  FOR ALL
  USING (auth.jwt() ->> 'role' = 'service_role')
  WITH CHECK (auth.jwt() ->> 'role' = 'service_role');

-- 4. user_video_watch_time（用户视频观看时长）
-- 用户只能查看自己的观看记录
ALTER TABLE public.user_video_watch_time ENABLE ROW LEVEL SECURITY;

-- 删除可能存在的旧策略
DROP POLICY IF EXISTS "Users can view own video watch time" ON public.user_video_watch_time;
DROP POLICY IF EXISTS "Admins can view all video watch time" ON public.user_video_watch_time;
DROP POLICY IF EXISTS "Service role can manage video watch time" ON public.user_video_watch_time;

-- 用户查看自己的视频观看时长
CREATE POLICY "Users can view own video watch time" ON public.user_video_watch_time
  FOR SELECT
  USING (user_id = auth.uid());

-- 管理员查看所有记录
CREATE POLICY "Admins can view all video watch time" ON public.user_video_watch_time
  FOR SELECT
  USING ((SELECT is_admin FROM public.profiles WHERE id = auth.uid()) = true);

-- 只有 service_role 可以插入/更新
CREATE POLICY "Service role can manage video watch time" ON public.user_video_watch_time
  FOR ALL
  USING (auth.jwt() ->> 'role' = 'service_role')
  WITH CHECK (auth.jwt() ->> 'role' = 'service_role');

-- 5. admin_profiles_list（管理员用户列表视图）
-- 这是管理员使用的视图，只允许管理员访问
ALTER VIEW public.admin_profiles_list SET (security_invoker = on);

-- 由于是视图，RLS 策略继承自底层表 profiles
-- 但我们需要确保只有管理员能访问这个视图
-- 注：视图的 RLS 通过 security_invoker = on 启用，访问权限由底层表的 RLS 控制

-- 6. first_publish_events（首次发布事件视图）
-- 这是管理员用于统计的视图，只允许管理员和 service_role 访问
ALTER VIEW public.first_publish_events SET (security_invoker = on);

-- 添加注释
COMMENT ON TABLE public.red_packet_update_queue IS '红包批量更新队列（已启用RLS）';
COMMENT ON TABLE public.red_packet_wrong_attempts IS '红包答题错误记录表（已启用RLS）';
COMMENT ON TABLE public.user_daily_watch_time IS '用户每日观看时长累计表（已启用RLS）';
COMMENT ON TABLE public.user_video_watch_time IS '用户每个视频的每日观看时长表（已启用RLS）';

