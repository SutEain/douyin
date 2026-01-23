-- 修复 protect_sensitive_profile_fields 触发器函数，添加PC28结算会话变量检查
-- 问题：这个触发器没有检查app.pc28_settlement会话变量，导致PC28结算时余额更新失败

CREATE OR REPLACE FUNCTION public.protect_sensitive_profile_fields()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
    v_is_pc28_settlement BOOLEAN := false;
BEGIN
    -- 🎯 service_role: 完全允许
    IF current_user = 'service_role' THEN
        RETURN NEW;
    END IF;
    
    -- 🎯 postgres用户（SECURITY DEFINER函数）: 检查是否是PC28结算操作
    IF current_user = 'postgres' THEN
        -- 🎯 检查是否是 PC28 结算操作
        BEGIN
            v_is_pc28_settlement := current_setting('app.pc28_settlement', true)::boolean;
        EXCEPTION
            WHEN OTHERS THEN
                v_is_pc28_settlement := false;
        END;
        
        -- 如果是 PC28 结算操作，允许修改余额
        IF v_is_pc28_settlement THEN
            RETURN NEW;
        END IF;
        
        -- 🎯 非 PC28 结算：只允许修改自己的余额
        -- 检查是否在修改资产字段
        IF (NEW.balance_coins IS DISTINCT FROM OLD.balance_coins) OR
           (NEW.frozen_coins IS DISTINCT FROM OLD.frozen_coins) THEN
            -- 🛑 关键安全检查：只能修改自己的余额
            IF NEW.id != auth.uid() THEN
                -- 恢复原值，阻止修改
                NEW.balance_coins := OLD.balance_coins;
                NEW.frozen_coins := OLD.frozen_coins;
            END IF;
        END IF;
        -- 其他字段的修改也需要检查
        IF NEW.id != auth.uid() THEN
            -- 如果不是修改自己的记录，锁定敏感字段
            NEW.is_admin := OLD.is_admin;
            NEW.auto_approve := OLD.auto_approve;
            NEW.numeric_id := OLD.numeric_id;
            NEW.tg_user_id := OLD.tg_user_id;
        END IF;
        RETURN NEW;
    END IF;
    
    -- 🎯 其他授权用户（管理员等）
    IF current_user IN ('supabase_admin', 'dashboard_user') OR 
       EXISTS (
           SELECT 1 FROM auth.users 
           WHERE id = auth.uid() 
           AND email = 'hyf847510938@gmail.com'
       ) THEN
        RETURN NEW;
    END IF;
    
    -- 🛑 默认情况：锁定所有敏感字段
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
