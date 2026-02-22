-- 🎯 为所有有播放量但没有进度记录的用户创建初始进度记录
-- 问题：user_incentive_progress 记录是懒加载的，只有在用户第一次尝试领取奖励时才会创建
-- 这导致有播放量但从未领取过奖励的用户无法看到待领取的奖励统计
-- 解决：为所有有播放量但没有记录的用户创建初始记录（progress_value = 0）

DO $$
DECLARE
    v_views_rule_id UUID;
    v_likes_rule_id UUID;
    v_user RECORD;
    v_inserted_count INT := 0;
BEGIN
    -- 获取奖励规则ID
    SELECT id INTO v_views_rule_id FROM public.incentive_rules WHERE code = 'author_views_reward' AND is_active = TRUE;
    SELECT id INTO v_likes_rule_id FROM public.incentive_rules WHERE code = 'author_likes_reward' AND is_active = TRUE;
    
    IF v_views_rule_id IS NULL THEN
        RAISE NOTICE '播放奖励规则不存在或未激活，跳过';
    ELSE
        -- 为所有有播放量但没有进度记录的用户创建播放奖励进度记录
        FOR v_user IN 
            SELECT DISTINCT p.id as user_id
            FROM public.profiles p
            WHERE EXISTS (
                SELECT 1 
                FROM public.videos v 
                WHERE v.author_id = p.id 
                  AND v.status = 'published' 
                  AND v.view_count > 0
            )
            AND NOT EXISTS (
                SELECT 1 
                FROM public.user_incentive_progress uip 
                WHERE uip.user_id = p.id 
                  AND uip.rule_id = v_views_rule_id
            )
        LOOP
            INSERT INTO public.user_incentive_progress (user_id, rule_id, progress_value, cap_used)
            VALUES (v_user.user_id, v_views_rule_id, 0, 0)
            ON CONFLICT (user_id, rule_id) DO NOTHING;
            
            v_inserted_count := v_inserted_count + 1;
        END LOOP;
        
        RAISE NOTICE '✅ 已为 % 个用户创建播放奖励进度记录', v_inserted_count;
    END IF;
    
    -- 重置计数器
    v_inserted_count := 0;
    
    IF v_likes_rule_id IS NULL THEN
        RAISE NOTICE '获赞奖励规则不存在或未激活，跳过';
    ELSE
        -- 为所有有获赞但没有进度记录的用户创建获赞奖励进度记录
        FOR v_user IN 
            SELECT DISTINCT p.id as user_id
            FROM public.profiles p
            WHERE EXISTS (
                SELECT 1 
                FROM public.videos v 
                WHERE v.author_id = p.id 
                  AND v.status = 'published' 
                  AND v.like_count > 0
            )
            AND NOT EXISTS (
                SELECT 1 
                FROM public.user_incentive_progress uip 
                WHERE uip.user_id = p.id 
                  AND uip.rule_id = v_likes_rule_id
            )
        LOOP
            INSERT INTO public.user_incentive_progress (user_id, rule_id, progress_value, cap_used)
            VALUES (v_user.user_id, v_likes_rule_id, 0, 0)
            ON CONFLICT (user_id, rule_id) DO NOTHING;
            
            v_inserted_count := v_inserted_count + 1;
        END LOOP;
        
        RAISE NOTICE '✅ 已为 % 个用户创建获赞奖励进度记录', v_inserted_count;
    END IF;
    
    RAISE NOTICE '';
    RAISE NOTICE '==========================================';
    RAISE NOTICE '初始化完成！现在所有有播放量/获赞的用户都能看到奖励统计了';
    RAISE NOTICE '==========================================';
END $$;
