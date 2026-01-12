-- 🎯 创建审核员系统
-- 1. 添加 is_reviewer 字段到 profiles 表
-- 2. 创建审核员账号（shenhe1, shenhe2, shenhe3）
-- 3. 添加必要的 RLS 策略

-- 1. 添加 is_reviewer 字段
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS is_reviewer BOOLEAN DEFAULT FALSE;

-- 2. 创建审核员统一判定函数
CREATE OR REPLACE FUNCTION public.check_is_reviewer()
RETURNS BOOLEAN AS $$
BEGIN
    RETURN EXISTS (
        SELECT 1 FROM public.profiles 
        WHERE id = auth.uid() AND (is_reviewer = TRUE OR is_admin = TRUE)
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 3. 创建审核员账号的辅助函数
-- 由于 auth.users 表的限制，我们创建一个辅助函数来安全地创建审核员
CREATE OR REPLACE FUNCTION create_reviewer_account(
    p_email TEXT,
    p_password TEXT,
    p_username TEXT,
    p_nickname TEXT
) RETURNS UUID AS $$
DECLARE
    v_user_id UUID;
    v_existing_user_id UUID;
BEGIN
    -- 检查用户是否已存在
    SELECT id INTO v_existing_user_id 
    FROM auth.users 
    WHERE email = p_email;
    
    IF v_existing_user_id IS NOT NULL THEN
        -- 用户已存在，更新 profile
        UPDATE public.profiles 
        SET is_reviewer = TRUE,
            nickname = COALESCE(nickname, p_nickname),
            username = COALESCE(username, p_username)
        WHERE id = v_existing_user_id;
        
        RAISE NOTICE '用户 % 已存在，已更新为审核员', p_email;
        RETURN v_existing_user_id;
    END IF;
    
    -- 创建新用户（使用 Supabase 内部方法）
    v_user_id := gen_random_uuid();
    
    INSERT INTO auth.users (
        instance_id,
        id,
        aud,
        role,
        email,
        encrypted_password,
        email_confirmed_at,
        confirmation_sent_at,
        recovery_sent_at,
        email_change_sent_at,
        created_at,
        updated_at,
        raw_app_meta_data,
        raw_user_meta_data,
        is_super_admin,
        confirmation_token,
        email_change,
        email_change_token_new,
        recovery_token
    ) VALUES (
        '00000000-0000-0000-0000-000000000000',
        v_user_id,
        'authenticated',
        'authenticated',
        p_email,
        crypt(p_password, gen_salt('bf')),
        NOW(),
        NOW(),
        NOW(),
        NOW(),
        NOW(),
        NOW(),
        jsonb_build_object('provider', 'email', 'providers', jsonb_build_array('email')),
        jsonb_build_object('username', p_username),
        false,
        '',
        '',
        '',
        ''
    );
    
    -- 创建 profile
    INSERT INTO public.profiles (
        id,
        username,
        nickname,
        is_reviewer,
        created_at,
        updated_at
    ) VALUES (
        v_user_id,
        p_username,
        p_nickname,
        TRUE,
        NOW(),
        NOW()
    );
    
    RAISE NOTICE '创建审核员账号: % (ID: %)', p_email, v_user_id;
    RETURN v_user_id;
    
EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE '创建审核员失败: % (错误: %)', p_email, SQLERRM;
    RETURN NULL;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 4. 调用函数创建三个审核员账号
DO $$
BEGIN
    PERFORM create_reviewer_account('shenhe1@review.local', 'shenhe1', 'shenhe1', '审核员1');
    PERFORM create_reviewer_account('shenhe2@review.local', 'shenhe2', 'shenhe2', '审核员2');
    PERFORM create_reviewer_account('shenhe3@review.local', 'shenhe3', 'shenhe3', '审核员3');
END $$;

-- 5. 清理辅助函数（可选，如果不想保留）
-- DROP FUNCTION IF EXISTS create_reviewer_account(TEXT, TEXT, TEXT, TEXT);

-- 6. 添加审核员访问权限的 RLS 策略
-- 审核员可以查看所有视频
DROP POLICY IF EXISTS "Reviewers can view all videos" ON public.videos;
CREATE POLICY "Reviewers can view all videos" ON public.videos
    FOR SELECT TO authenticated 
    USING (public.check_is_reviewer());

-- 审核员可以更新视频状态（仅限 review_status, is_adult 字段）
DROP POLICY IF EXISTS "Reviewers can update video review status" ON public.videos;
CREATE POLICY "Reviewers can update video review status" ON public.videos
    FOR UPDATE TO authenticated 
    USING (public.check_is_reviewer())
    WITH CHECK (public.check_is_reviewer());

-- 审核员可以查看所有用户
DROP POLICY IF EXISTS "Reviewers can view all profiles" ON public.profiles;
CREATE POLICY "Reviewers can view all profiles" ON public.profiles
    FOR SELECT TO authenticated 
    USING (public.check_is_reviewer());

-- 审核员可以更新用户封禁状态
DROP POLICY IF EXISTS "Reviewers can update user ban status" ON public.profiles;
CREATE POLICY "Reviewers can update user ban status" ON public.profiles
    FOR UPDATE TO authenticated 
    USING (public.check_is_reviewer())
    WITH CHECK (public.check_is_reviewer());

-- 审核员可以查看所有资金流水
DROP POLICY IF EXISTS "Reviewers can view all transactions" ON public.coin_transactions;
CREATE POLICY "Reviewers can view all transactions" ON public.coin_transactions
    FOR SELECT TO authenticated 
    USING (public.check_is_reviewer());

COMMENT ON COLUMN public.profiles.is_reviewer IS '是否为审核员（可以审核视频、管理用户、查看资金流水）';
COMMENT ON FUNCTION public.check_is_reviewer() IS '检查当前用户是否为审核员或管理员';

