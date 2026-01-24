-- 🚨 移除所有异常管理员权限，只保留 hyf847510938@gmail.com 的管理员权限
-- 全系统只有一个管理员：hyf847510938@gmail.com
-- 注意：临时禁用触发器以执行更新

-- 1. 临时禁用触发器
ALTER TABLE public.profiles DISABLE TRIGGER trigger_protect_sensitive_profile_fields;

-- 2. 获取 hyf847510938@gmail.com 的用户ID并执行更新
DO $$
DECLARE
    v_hyf_id UUID;
BEGIN
    -- 获取 hyf847510938@gmail.com 的用户ID
    SELECT id INTO v_hyf_id
    FROM auth.users
    WHERE email = 'hyf847510938@gmail.com';
    
    IF v_hyf_id IS NULL THEN
        RAISE EXCEPTION '找不到 hyf847510938@gmail.com 用户';
    END IF;
    
    -- 先确保 hyf847510938@gmail.com 对应的用户是管理员
    UPDATE public.profiles
    SET is_admin = true
    WHERE id = v_hyf_id
    AND is_admin != true;
    
    -- 移除所有其他用户的管理员权限
    UPDATE public.profiles
    SET is_admin = false
    WHERE is_admin = true
    AND id != v_hyf_id;
    
    RAISE NOTICE '管理员权限清理完成：只有 hyf847510938@gmail.com (%) 是管理员', v_hyf_id;
END $$;

-- 3. 重新启用触发器
ALTER TABLE public.profiles ENABLE TRIGGER trigger_protect_sensitive_profile_fields;

-- 验证结果
DO $$
DECLARE
    v_admin_count INT;
    v_hyf_is_admin BOOLEAN;
    v_hyf_id UUID;
BEGIN
    -- 获取 hyf 的用户ID
    SELECT id INTO v_hyf_id
    FROM auth.users
    WHERE email = 'hyf847510938@gmail.com';
    
    -- 检查管理员数量
    SELECT COUNT(*) INTO v_admin_count
    FROM public.profiles
    WHERE is_admin = true;
    
    -- 检查 hyf 是否是管理员
    SELECT COALESCE(is_admin, false) INTO v_hyf_is_admin
    FROM public.profiles
    WHERE id = v_hyf_id;
    
    IF v_admin_count != 1 THEN
        RAISE EXCEPTION '管理员数量异常：期望1个，实际%个', v_admin_count;
    END IF;
    
    IF NOT v_hyf_is_admin THEN
        RAISE EXCEPTION 'hyf847510938@gmail.com (%) 不是管理员', v_hyf_id;
    END IF;
    
    RAISE NOTICE '验证通过：只有 hyf847510938@gmail.com (%) 是管理员', v_hyf_id;
END $$;

COMMENT ON FUNCTION public.protect_sensitive_profile_fields IS '🚨 已修复：全系统只有一个管理员 hyf847510938@gmail.com';
