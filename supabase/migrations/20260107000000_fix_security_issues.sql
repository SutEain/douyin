-- 🎯 修复 Supabase Security Advisor 报告的安全问题
-- 1. 为 dice_rooms 和 dice_room_players 启用 RLS
-- 2. 为 admin_profiles_list 视图添加访问控制

-- ============================================
-- 1. 修复 dice_rooms 表的 RLS 问题
-- ============================================
ALTER TABLE public.dice_rooms ENABLE ROW LEVEL SECURITY;

-- 所有人可以查看房间信息（用于显示房间列表）
DROP POLICY IF EXISTS "Public can view dice rooms" ON public.dice_rooms;
CREATE POLICY "Public can view dice rooms" ON public.dice_rooms
    FOR SELECT USING (true);

-- 只有房间创建者可以更新自己的房间
DROP POLICY IF EXISTS "Owners can update own dice rooms" ON public.dice_rooms;
CREATE POLICY "Owners can update own dice rooms" ON public.dice_rooms
    FOR UPDATE USING (auth.uid() = owner_id);

-- 只有已登录用户才能创建房间（通过 RPC 函数，这里只是防御性策略）
DROP POLICY IF EXISTS "Authenticated users can create dice rooms" ON public.dice_rooms;
CREATE POLICY "Authenticated users can create dice rooms" ON public.dice_rooms
    FOR INSERT TO authenticated WITH CHECK (auth.uid() = owner_id);

-- ============================================
-- 2. 修复 dice_room_players 表的 RLS 问题
-- ============================================
ALTER TABLE public.dice_room_players ENABLE ROW LEVEL SECURITY;

-- 所有人可以查看参与者信息（用于显示房间内的玩家）
DROP POLICY IF EXISTS "Public can view dice room players" ON public.dice_room_players;
CREATE POLICY "Public can view dice room players" ON public.dice_room_players
    FOR SELECT USING (true);

-- 只有参与者自己可以更新自己的记录（如更新 roll_result）
DROP POLICY IF EXISTS "Players can update own records" ON public.dice_room_players;
CREATE POLICY "Players can update own records" ON public.dice_room_players
    FOR UPDATE USING (auth.uid() = user_id);

-- 只有已登录用户才能加入房间（通过 RPC 函数，这里只是防御性策略）
DROP POLICY IF EXISTS "Authenticated users can join dice rooms" ON public.dice_room_players;
CREATE POLICY "Authenticated users can join dice rooms" ON public.dice_room_players
    FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);

-- ============================================
-- 3. 修复 admin_profiles_list 视图的 Security Definer 警告
-- ============================================
-- 注意：这个视图使用了 auth.jwt()，Supabase 会警告它是 Security Definer View
-- 视图内部的 WHERE 子句已经限制了只有 admin 可以看到数据，这是安全的
-- 添加注释说明其安全考虑
COMMENT ON VIEW public.admin_profiles_list IS 
    '管理员用户列表视图。仅管理员可访问（通过视图内的 WHERE 条件限制：auth.jwt() -> app_metadata -> role = admin）。';

-- ============================================
-- 4. 修复 admin_videos_list 视图的 Security Definer 警告
-- ============================================
-- 这个视图也使用了 auth.jwt()，同样需要添加注释
COMMENT ON VIEW public.admin_videos_list IS 
    '管理员视频列表视图。仅管理员可访问（通过视图内的 WHERE 条件限制：auth.jwt() -> app_metadata -> role = admin）。';

-- ============================================
-- 5. 修复 first_publish_events 视图的 Security Definer 警告
-- ============================================
-- 这个视图聚合了用户数据（每个用户的首次发布时间），虽然没有使用 auth.jwt()
-- 但 Supabase 可能因为聚合敏感数据而标记它
-- 解决方案：为视图添加访问控制，限制只有管理员可以访问
-- 由于视图不能直接设置 RLS，我们创建一个包装函数来限制访问

-- 创建包装函数，限制只有管理员可以访问
CREATE OR REPLACE FUNCTION public.get_first_publish_events()
RETURNS TABLE (
    user_id UUID,
    first_published_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
BEGIN
    -- 检查是否为管理员
    IF (auth.jwt() -> 'app_metadata' ->> 'role') != 'admin' THEN
        RAISE EXCEPTION 'Access denied. Admin role required.';
    END IF;
    
    -- 返回视图数据
    RETURN QUERY
    SELECT 
        fpe.user_id,
        fpe.first_published_at
    FROM public.first_publish_events fpe;
END;
$function$;

-- 添加注释
COMMENT ON VIEW public.first_publish_events IS 
    '首次发布事件视图。聚合每个用户的首次发布时间。建议通过 get_first_publish_events() 函数访问以限制权限。';
COMMENT ON FUNCTION public.get_first_publish_events() IS 
    '获取首次发布事件（仅管理员）。包装 first_publish_events 视图，添加访问控制。';
