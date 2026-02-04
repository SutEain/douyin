-- 🎯 修复：保护统计字段（粉丝数、获赞数等）不被非法修改
-- 问题：触发器函数没有保护 follower_count, following_count, total_likes, video_count 等统计字段
-- 修复：在触发器函数中添加对这些字段的保护，只允许通过触发器自动更新，禁止手动修改

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
    v_is_trigger_update BOOLEAN := false;
BEGIN
    -- 🎯 service_role: 完全允许（但统计字段仍需要通过触发器更新）
    IF current_user = 'service_role' THEN
        -- 🛑 即使是service_role，也不允许直接修改统计字段（必须通过触发器）
        -- 检查是否是触发器触发的更新（通过检查调用栈或会话变量）
        BEGIN
            v_is_trigger_update := current_setting('app.allow_statistics_update', true)::boolean;
        EXCEPTION
            WHEN OTHERS THEN
                v_is_trigger_update := false;
        END;
        
        -- 如果不是触发器更新，锁定统计字段
        IF NOT v_is_trigger_update THEN
            NEW.follower_count := OLD.follower_count;
            NEW.following_count := OLD.following_count;
            NEW.total_likes := OLD.total_likes;
            NEW.video_count := OLD.video_count;
        END IF;
        
        RETURN NEW;
    END IF;
    
    -- 🎯 检查是否是管理员（允许管理员修改auto_approve等字段，但不允许修改统计字段）
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
        
        -- 🎯 如果是资产继承操作，直接允许修改余额，但不允许修改 is_admin 和统计字段
        IF v_is_inheritance THEN
            -- 🛑 即使资产继承，也不允许修改 is_admin 和统计字段
            IF NEW.is_admin IS DISTINCT FROM OLD.is_admin THEN
                NEW.is_admin := OLD.is_admin;
            END IF;
            -- 🛑 资产继承时，统计字段应该通过专门的逻辑更新，不允许直接修改
            NEW.follower_count := OLD.follower_count;
            NEW.following_count := OLD.following_count;
            NEW.total_likes := OLD.total_likes;
            NEW.video_count := OLD.video_count;
            RETURN NEW;
        END IF;
        
        -- 🎯 检查是否是 PC28 结算操作
        BEGIN
            v_is_pc28_settlement := current_setting('app.pc28_settlement', true)::boolean;
        EXCEPTION
            WHEN OTHERS THEN
                v_is_pc28_settlement := false;
        END;
        
        -- 如果是 PC28 结算操作，允许修改余额，但不允许修改 is_admin 和统计字段
        IF v_is_pc28_settlement THEN
            -- 🛑 即使PC28结算，也不允许修改 is_admin 和统计字段
            IF NEW.is_admin IS DISTINCT FROM OLD.is_admin THEN
                NEW.is_admin := OLD.is_admin;
            END IF;
            NEW.follower_count := OLD.follower_count;
            NEW.following_count := OLD.following_count;
            NEW.total_likes := OLD.total_likes;
            NEW.video_count := OLD.video_count;
            RETURN NEW;
        END IF;
        
        -- 🎯 检查是否是触发器更新（允许触发器更新统计字段）
        BEGIN
            v_is_trigger_update := current_setting('app.allow_statistics_update', true)::boolean;
        EXCEPTION
            WHEN OTHERS THEN
                v_is_trigger_update := false;
        END;
        
        -- 🎯 非 PC28 结算且非资产继承：只允许修改自己的余额，但不允许修改 is_admin 和统计字段
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
        
        -- 🛑 保护统计字段：只允许通过触发器更新，禁止手动修改
        IF NOT v_is_trigger_update THEN
            NEW.follower_count := OLD.follower_count;
            NEW.following_count := OLD.following_count;
            NEW.total_likes := OLD.total_likes;
            NEW.video_count := OLD.video_count;
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
    
    -- 🎯 其他授权用户（管理员等）- 但这里也不应该允许修改 is_admin 和统计字段
    -- 注意：即使是管理员，也不应该通过普通UPDATE修改 is_admin 和统计字段
    IF current_user IN ('supabase_admin', 'dashboard_user') OR 
       EXISTS (
           SELECT 1 FROM auth.users 
           WHERE id = auth.uid() 
           AND email = 'hyf847510938@gmail.com'
       ) OR v_is_admin THEN
        -- 🛑 即使是授权用户，也不允许修改 is_admin 和统计字段
        IF NEW.is_admin IS DISTINCT FROM OLD.is_admin THEN
            NEW.is_admin := OLD.is_admin;
        END IF;
        -- 🛑 管理员也不允许直接修改统计字段（必须通过触发器或专门函数）
        NEW.follower_count := OLD.follower_count;
        NEW.following_count := OLD.following_count;
        NEW.total_likes := OLD.total_likes;
        NEW.video_count := OLD.video_count;
        -- 🎯 允许管理员修改auto_approve字段
        RETURN NEW;
    END IF;
    
    -- 🛑 默认情况：锁定所有敏感字段（包括 is_admin、统计字段）
    -- 🎯 但如果用户是管理员，允许修改auto_approve
    IF v_is_admin THEN
        -- 管理员可以修改auto_approve，但不能修改is_admin、统计字段和其他敏感字段
        IF NEW.is_admin IS DISTINCT FROM OLD.is_admin THEN
            NEW.is_admin := OLD.is_admin;
        END IF;
        -- 🛑 管理员也不允许直接修改统计字段
        NEW.follower_count := OLD.follower_count;
        NEW.following_count := OLD.following_count;
        NEW.total_likes := OLD.total_likes;
        NEW.video_count := OLD.video_count;
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
    
    -- 🛑 非管理员：锁定所有敏感字段（包括 is_admin、auto_approve 和统计字段）
    NEW.is_admin := OLD.is_admin;
    NEW.auto_approve := OLD.auto_approve;
    NEW.balance_coins := OLD.balance_coins;
    NEW.frozen_coins := OLD.frozen_coins;
    NEW.numeric_id := OLD.numeric_id;
    NEW.tg_user_id := OLD.tg_user_id;
    NEW.follower_count := OLD.follower_count;
    NEW.following_count := OLD.following_count;
    NEW.total_likes := OLD.total_likes;
    NEW.video_count := OLD.video_count;
    NEW.id := OLD.id;
    
    RETURN NEW;
END;
$function$;

COMMENT ON FUNCTION public.protect_sensitive_profile_fields IS '🚨 修复：保护统计字段（follower_count, following_count, total_likes, video_count）不被非法修改，只允许通过触发器自动更新';
