-- 🎯 修复：允许管理员修改auto_approve字段
-- 问题：触发器函数阻止了管理员修改其他用户的auto_approve字段
-- 修复：在触发器函数中添加管理员权限检查，允许管理员修改auto_approve字段

CREATE OR REPLACE FUNCTION public.protect_sensitive_profile_fields()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
    v_is_pc28_settlement BOOLEAN := false;
    v_is_inheritance BOOLEAN := false;
    v_is_admin BOOLEAN := false;
BEGIN
    -- 🎯 service_role: 完全允许
    IF current_user = 'service_role' THEN
        RETURN NEW;
    END IF;
    
    -- 🎯 检查是否是管理员（允许管理员修改auto_approve等字段）
    BEGIN
        v_is_admin := public.check_is_admin();
    EXCEPTION
        WHEN OTHERS THEN
            v_is_admin := false;
    END;
    
    -- 🎯 postgres用户（SECURITY DEFINER函数）: 检查是否是PC28结算或资产继承操作
    IF current_user = 'postgres' THEN
        -- 🎯 优先检查是否是资产继承操作（必须在余额检查之前）
        BEGIN
            v_is_inheritance := current_setting('app.inheritance_operation', true)::boolean;
        EXCEPTION
            WHEN OTHERS THEN
                v_is_inheritance := false;
        END;
        
        -- 🎯 如果是资产继承操作，直接允许修改余额，但不允许修改 is_admin
        IF v_is_inheritance THEN
            -- 🛑 即使资产继承，也不允许修改 is_admin
            IF NEW.is_admin IS DISTINCT FROM OLD.is_admin THEN
                NEW.is_admin := OLD.is_admin;
            END IF;
            RETURN NEW;
        END IF;
        
        -- 🎯 检查是否是 PC28 结算操作
        BEGIN
            v_is_pc28_settlement := current_setting('app.pc28_settlement', true)::boolean;
        EXCEPTION
            WHEN OTHERS THEN
                v_is_pc28_settlement := false;
        END;
        
        -- 如果是 PC28 结算操作，允许修改余额，但不允许修改 is_admin
        IF v_is_pc28_settlement THEN
            -- 🛑 即使PC28结算，也不允许修改 is_admin
            IF NEW.is_admin IS DISTINCT FROM OLD.is_admin THEN
                NEW.is_admin := OLD.is_admin;
            END IF;
            RETURN NEW;
        END IF;
        
        -- 🎯 非 PC28 结算且非资产继承：只允许修改自己的余额，但不允许修改 is_admin
        -- 检查是否在修改资产字段
        IF (NEW.balance_coins IS DISTINCT FROM OLD.balance_coins) OR
           (NEW.frozen_coins IS DISTINCT FROM OLD.frozen_coins) THEN
            -- 🛑 关键安全检查：只能修改自己的余额（除非是管理员）
            IF NEW.id != auth.uid() AND NOT v_is_admin THEN
                -- 恢复原值，阻止修改
                NEW.balance_coins := OLD.balance_coins;
                NEW.frozen_coins := OLD.frozen_coins;
            END IF;
        END IF;
        
        -- 🛑 关键修复：is_admin 字段不允许任何人修改（包括自己和管理员）
        -- 即使是修改自己的记录，也不允许修改 is_admin
        IF NEW.is_admin IS DISTINCT FROM OLD.is_admin THEN
            NEW.is_admin := OLD.is_admin;
        END IF;
        
        -- 🎯 其他字段的修改也需要检查（但允许管理员修改auto_approve）
        IF NEW.id != auth.uid() AND NOT v_is_admin THEN
            -- 如果不是修改自己的记录且不是管理员，锁定其他敏感字段
            NEW.auto_approve := OLD.auto_approve;
            NEW.numeric_id := OLD.numeric_id;
            NEW.tg_user_id := OLD.tg_user_id;
        END IF;
        RETURN NEW;
    END IF;
    
    -- 🎯 其他授权用户（管理员等）- 但这里也不应该允许修改 is_admin
    -- 注意：即使是管理员，也不应该通过普通UPDATE修改 is_admin，应该通过专门的函数
    IF current_user IN ('supabase_admin', 'dashboard_user') OR 
       EXISTS (
           SELECT 1 FROM auth.users 
           WHERE id = auth.uid() 
           AND email = 'hyf847510938@gmail.com'
       ) OR v_is_admin THEN
        -- 🛑 即使是授权用户，也不允许修改 is_admin（应该通过专门的管理函数）
        IF NEW.is_admin IS DISTINCT FROM OLD.is_admin THEN
            NEW.is_admin := OLD.is_admin;
        END IF;
        -- 🎯 允许管理员修改auto_approve字段
        RETURN NEW;
    END IF;
    
    -- 🛑 默认情况：锁定所有敏感字段（包括 is_admin）
    -- 🎯 但如果用户是管理员，允许修改auto_approve
    IF v_is_admin THEN
        -- 管理员可以修改auto_approve，但不能修改is_admin和其他敏感字段
        IF NEW.is_admin IS DISTINCT FROM OLD.is_admin THEN
            NEW.is_admin := OLD.is_admin;
        END IF;
        IF (NEW.balance_coins IS DISTINCT FROM OLD.balance_coins) OR
           (NEW.frozen_coins IS DISTINCT FROM OLD.frozen_coins) OR
           (NEW.numeric_id IS DISTINCT FROM OLD.numeric_id) OR
           (NEW.tg_user_id IS DISTINCT FROM OLD.tg_user_id) THEN
            -- 管理员不能直接修改这些字段，需要通过专门的函数
            NEW.balance_coins := OLD.balance_coins;
            NEW.frozen_coins := OLD.frozen_coins;
            NEW.numeric_id := OLD.numeric_id;
            NEW.tg_user_id := OLD.tg_user_id;
        END IF;
        RETURN NEW;
    END IF;
    
    -- 🛑 非管理员：锁定所有敏感字段（包括 is_admin 和 auto_approve）
    NEW.is_admin := OLD.is_admin;
    NEW.auto_approve := OLD.auto_approve;
    NEW.balance_coins := OLD.balance_coins;
    NEW.frozen_coins := OLD.frozen_coins;
    NEW.numeric_id := OLD.numeric_id;
    NEW.tg_user_id := OLD.tg_user_id;
    NEW.id := OLD.id;
    
    RETURN NEW;
END;
$function$;

COMMENT ON FUNCTION public.protect_sensitive_profile_fields IS '🚨 修复：允许管理员修改auto_approve字段，但禁止修改is_admin和其他敏感字段';
