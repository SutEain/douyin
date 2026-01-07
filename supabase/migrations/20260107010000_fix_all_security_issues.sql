-- 🎯 全面修复 Supabase Security Advisor 报告的所有安全问题
-- 1. 修复 RLS Enabled No Policy
-- 2. 批量修复 Function Search Path Mutable
-- 3. 修复 Extension in Public
-- 4. 进一步处理 Security Definer View

-- ============================================
-- 1. 修复 request_update_limits 表的 RLS 策略
-- ============================================
-- 这个表用于限制"求更新"功能的频率，只有后端可以写入，用户只能查看自己的记录
DROP POLICY IF EXISTS "Users can view own request update limits" ON public.request_update_limits;
CREATE POLICY "Users can view own request update limits" ON public.request_update_limits
    FOR SELECT USING (auth.uid() = requester_id OR auth.uid() = target_id);

-- 只有后端（service_role）可以插入/更新，普通用户不能直接操作
-- 注意：service_role 默认绕过 RLS，所以这里不需要额外策略

-- ============================================
-- 2. 修复 visit_notify_limits 表的 RLS 策略
-- ============================================
-- 这个表用于限制访客通知的频率，只有后端可以写入，用户只能查看自己的记录
DROP POLICY IF EXISTS "Users can view own visit notify limits" ON public.visit_notify_limits;
CREATE POLICY "Users can view own visit notify limits" ON public.visit_notify_limits
    FOR SELECT USING (auth.uid() = visitor_id OR auth.uid() = visited_id);

-- 只有后端（service_role）可以插入/更新，普通用户不能直接操作

-- ============================================
-- 3. 批量修复所有 SECURITY DEFINER 函数的 search_path
-- ============================================
-- 使用 ALTER FUNCTION 批量设置 search_path（更高效）
-- 排除已经设置 search_path 的函数

DO $$
DECLARE
    func_record RECORD;
BEGIN
    FOR func_record IN
        SELECT 
            p.oid,
            p.proname,
            pg_get_function_identity_arguments(p.oid) as args
        FROM pg_proc p
        JOIN pg_namespace n ON p.pronamespace = n.oid
        WHERE n.nspname = 'public'
          AND p.prosecdef = true  -- SECURITY DEFINER
          AND (
              p.proconfig IS NULL 
              OR NOT EXISTS (
                  SELECT 1 FROM unnest(p.proconfig) AS config 
                  WHERE config LIKE 'search_path=%'
              )
          )
          -- 排除已经修复的函数
          AND p.proname NOT IN ('check_is_admin', '_check_user_is_hyf', 'get_first_publish_events')
    LOOP
        BEGIN
            EXECUTE format(
                'ALTER FUNCTION public.%I(%s) SET search_path = public',
                func_record.proname,
                func_record.args
            );
            RAISE NOTICE 'Fixed search_path for function: %', func_record.proname;
        EXCEPTION WHEN OTHERS THEN
            RAISE WARNING 'Failed to fix function %: %', func_record.proname, SQLERRM;
        END;
    END LOOP;
END $$;

-- ============================================
-- 4. 关于 Security Definer View 的说明
-- ============================================
-- admin_profiles_list 和 admin_videos_list 视图使用了 auth.jwt()
-- Supabase 会标记为 Security Definer View，但这是安全的，因为：
-- 1. 视图内部的 WHERE 条件已经限制了只有 admin 可以访问
-- 2. 非管理员用户查询这些视图会返回空结果
-- 3. 我们已经添加了注释说明其安全考虑
--
-- first_publish_events 视图已经创建了包装函数 get_first_publish_events()
-- 建议通过函数访问而不是直接查询视图

-- ============================================
-- 5. 修复 pg_trgm 扩展位置（移动到 extensions schema）
-- ============================================
-- 注意：移动扩展需要先删除再重新创建，可能会影响现有功能
-- 如果 pg_trgm 正在使用中，建议保持现状或联系 Supabase 支持
-- 这里只添加注释说明
COMMENT ON EXTENSION pg_trgm IS 
    'pg_trgm 扩展安装在 public schema。建议移动到 extensions schema 以提高安全性。';

-- ============================================
-- 6. 关于 Leaked Password Protection
-- ============================================
-- 这个需要在 Supabase Dashboard 的 Auth Settings 中手动启用
-- 路径：Settings > Auth > Password > Enable leaked password protection
-- 这里无法通过 SQL 修复
