-- 🔍 完整检查审核员账号的认证状态

-- 1. 检查 auth.users 表的完整信息
SELECT 
    id,
    email,
    encrypted_password IS NOT NULL as has_password,
    email_confirmed_at,
    confirmed_at,
    banned_until,
    deleted_at,
    is_super_admin,
    aud,
    role,
    created_at,
    updated_at,
    last_sign_in_at
FROM auth.users 
WHERE email = 'shenhe1@review.local';

-- 2. 检查 profiles 记录
SELECT 
    p.*,
    u.email
FROM public.profiles p
JOIN auth.users u ON p.id = u.id
WHERE u.email = 'shenhe1@review.local';

-- 3. 尝试手动验证密码（测试加密是否正确）
SELECT 
    email,
    encrypted_password = crypt('shenhe1', encrypted_password) as password_matches
FROM auth.users 
WHERE email = 'shenhe1@review.local';

