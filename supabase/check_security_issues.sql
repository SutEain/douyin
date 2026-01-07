-- 🎯 检查 Supabase Security Advisor 报告的所有安全问题
-- 在 Supabase Dashboard 的 SQL Editor 中运行此查询

-- ============================================
-- 1. 检查所有视图（查找 Security Definer Views）
-- ============================================
SELECT 
    schemaname,
    viewname,
    viewowner,
    definition
FROM pg_views 
WHERE schemaname = 'public'
ORDER BY viewname;

-- ============================================
-- 2. 检查 first_publish_events 视图（如果存在）
-- ============================================
SELECT 
    schemaname,
    viewname,
    viewowner,
    definition
FROM pg_views 
WHERE schemaname = 'public' 
  AND viewname = 'first_publish_events';

-- ============================================
-- 3. 检查所有表的 RLS 状态
-- ============================================
SELECT 
    schemaname,
    tablename,
    rowsecurity as rls_enabled
FROM pg_tables 
WHERE schemaname = 'public'
ORDER BY tablename;

-- ============================================
-- 4. 检查 dice_rooms 和 dice_room_players 的 RLS 状态
-- ============================================
SELECT 
    schemaname,
    tablename,
    rowsecurity as rls_enabled
FROM pg_tables 
WHERE schemaname = 'public' 
  AND tablename IN ('dice_rooms', 'dice_room_players');

-- ============================================
-- 5. 检查所有表的 RLS 策略
-- ============================================
SELECT 
    schemaname,
    tablename,
    policyname,
    permissive,
    roles,
    cmd,
    qual,
    with_check
FROM pg_policies 
WHERE schemaname = 'public'
ORDER BY tablename, policyname;

-- ============================================
-- 6. 检查 dice_rooms 和 dice_room_players 的 RLS 策略
-- ============================================
SELECT 
    schemaname,
    tablename,
    policyname,
    permissive,
    roles,
    cmd,
    qual,
    with_check
FROM pg_policies 
WHERE schemaname = 'public' 
  AND tablename IN ('dice_rooms', 'dice_room_players');

-- ============================================
-- 7. 检查所有使用 SECURITY DEFINER 的函数
-- ============================================
SELECT 
    n.nspname as schema_name,
    p.proname as function_name,
    pg_get_functiondef(p.oid) as definition
FROM pg_proc p
JOIN pg_namespace n ON p.pronamespace = n.oid
WHERE n.nspname = 'public'
  AND p.prosecdef = true  -- SECURITY DEFINER
ORDER BY p.proname;

-- ============================================
-- 8. 检查所有视图的定义（查找使用 auth.jwt() 的视图）
-- ============================================
SELECT 
    viewname,
    definition
FROM pg_views 
WHERE schemaname = 'public'
  AND definition LIKE '%auth.jwt()%'
ORDER BY viewname;
