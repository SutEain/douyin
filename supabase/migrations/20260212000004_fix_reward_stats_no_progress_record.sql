-- 🎯 修复：get_author_reward_stats 函数在没有进度记录时返回 null 的问题
-- 问题：当用户在 user_incentive_progress 表中没有记录时，pending_count 和 next_reward_distance 返回 null
-- 原因：SELECT INTO 没有找到记录时，变量不会被更新，导致计算异常
-- 解决：使用 COALESCE 确保变量有默认值，并修复整数除法问题

CREATE OR REPLACE FUNCTION public.get_author_reward_stats(p_user_id UUID)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_views_rule RECORD;
    v_likes_rule RECORD;
    v_current_total_views BIGINT := 0;
    v_current_total_likes BIGINT := 0;
    v_last_rewarded_views INT := 0;
    v_last_rewarded_likes INT := 0;
    v_views_pending_count INT := 0;
    v_likes_pending_count INT := 0;
    v_views_next_distance INT := 0;
    v_likes_next_distance INT := 0;
    v_remaining_views INT := 0;
    v_remaining_likes INT := 0;
BEGIN
    -- 🎯 获取播放奖励规则（只获取激活状态的）
    SELECT id, threshold, reward_usdt INTO v_views_rule
    FROM public.incentive_rules 
    WHERE code = 'author_views_reward' AND is_active = TRUE
    LIMIT 1;

    -- 🎯 获取获赞奖励规则（只获取激活状态的）
    SELECT id, threshold, reward_usdt INTO v_likes_rule
    FROM public.incentive_rules 
    WHERE code = 'author_likes_reward' AND is_active = TRUE
    LIMIT 1;

    -- 计算作者名下所有已发布作品的总播放量
    SELECT COALESCE(SUM(view_count), 0) INTO v_current_total_views 
    FROM public.videos 
    WHERE author_id = p_user_id AND status = 'published';

    -- 计算作者名下所有已发布作品的总获赞数
    SELECT COALESCE(SUM(like_count), 0) INTO v_current_total_likes 
    FROM public.videos 
    WHERE author_id = p_user_id AND status = 'published';

    -- 🎯 处理播放奖励统计（如果规则存在且激活）
    IF v_views_rule.id IS NOT NULL THEN
        -- 🚨 修复：使用 COALESCE 确保即使没有记录也能得到默认值 0
        SELECT COALESCE(progress_value, 0) INTO v_last_rewarded_views 
        FROM public.user_incentive_progress 
        WHERE user_id = p_user_id AND rule_id = v_views_rule.id;
        
        -- 如果没有找到记录，v_last_rewarded_views 保持初始值 0（这是正确的）
        -- 但为了安全起见，再次确保值不为 NULL
        v_last_rewarded_views := COALESCE(v_last_rewarded_views, 0);

        -- 🚨 修复：如果进度值超过当前总播放量，重置为当前总播放量
        -- 这通常发生在视频被删除或播放量减少的情况下
        IF v_last_rewarded_views > v_current_total_views THEN
            -- 自动修复进度值（如果记录存在）
            UPDATE public.user_incentive_progress
            SET progress_value = v_current_total_views
            WHERE user_id = p_user_id AND rule_id = v_views_rule.id;
            
            -- 更新本地变量
            v_last_rewarded_views := v_current_total_views;
        END IF;

        -- 计算剩余播放量
        v_remaining_views := v_current_total_views - v_last_rewarded_views;
        
        -- 计算待领取份数（使用整数除法）
        IF v_remaining_views > 0 THEN
            v_views_pending_count := v_remaining_views / v_views_rule.threshold;
        ELSE
            v_views_pending_count := 0;
        END IF;

        -- 计算下一份还差多少
        IF v_remaining_views > 0 THEN
            v_views_next_distance := v_views_rule.threshold - (v_remaining_views % v_views_rule.threshold);
            -- 如果正好达到阈值，下一份距离为 0
            IF v_views_next_distance = v_views_rule.threshold THEN
                v_views_next_distance := 0;
            END IF;
        ELSE
            v_views_next_distance := v_views_rule.threshold;
        END IF;
    END IF;

    -- 🎯 处理获赞奖励统计（如果规则存在且激活）
    IF v_likes_rule.id IS NOT NULL THEN
        -- 🚨 修复：使用 COALESCE 确保即使没有记录也能得到默认值 0
        SELECT COALESCE(progress_value, 0) INTO v_last_rewarded_likes 
        FROM public.user_incentive_progress 
        WHERE user_id = p_user_id AND rule_id = v_likes_rule.id;
        
        -- 如果没有找到记录，v_last_rewarded_likes 保持初始值 0（这是正确的）
        -- 但为了安全起见，再次确保值不为 NULL
        v_last_rewarded_likes := COALESCE(v_last_rewarded_likes, 0);

        -- 🚨 修复：如果进度值超过当前总获赞数，重置为当前总获赞数
        IF v_last_rewarded_likes > v_current_total_likes THEN
            -- 自动修复进度值（如果记录存在）
            UPDATE public.user_incentive_progress
            SET progress_value = v_current_total_likes
            WHERE user_id = p_user_id AND rule_id = v_likes_rule.id;
            
            -- 更新本地变量
            v_last_rewarded_likes := v_current_total_likes;
        END IF;

        -- 计算剩余获赞数
        v_remaining_likes := v_current_total_likes - v_last_rewarded_likes;
        
        -- 计算待领取份数（使用整数除法）
        IF v_remaining_likes > 0 THEN
            v_likes_pending_count := v_remaining_likes / v_likes_rule.threshold;
        ELSE
            v_likes_pending_count := 0;
        END IF;

        -- 计算下一份还差多少
        IF v_remaining_likes > 0 THEN
            v_likes_next_distance := v_likes_rule.threshold - (v_remaining_likes % v_likes_rule.threshold);
            -- 如果正好达到阈值，下一份距离为 0
            IF v_likes_next_distance = v_likes_rule.threshold THEN
                v_likes_next_distance := 0;
            END IF;
        ELSE
            v_likes_next_distance := v_likes_rule.threshold;
        END IF;
    END IF;

    -- 🎯 返回符合 Bot 端期望的数据结构
    RETURN json_build_object(
        'views_stats', CASE 
            WHEN v_views_rule.id IS NOT NULL THEN
                json_build_object(
                    'threshold', v_views_rule.threshold,
                    'reward_amount', v_views_rule.reward_usdt,
                    'current_total', v_current_total_views,
                    'pending_count', v_views_pending_count,
                    'next_reward_distance', v_views_next_distance
                )
            ELSE NULL
        END,
        'likes_stats', CASE 
            WHEN v_likes_rule.id IS NOT NULL THEN
                json_build_object(
                    'threshold', v_likes_rule.threshold,
                    'reward_amount', v_likes_rule.reward_usdt,
                    'current_total', v_current_total_likes,
                    'pending_count', v_likes_pending_count,
                    'next_reward_distance', v_likes_next_distance
                )
            ELSE NULL
        END
    );
END;
$$;

-- 授权
GRANT EXECUTE ON FUNCTION public.get_author_reward_stats(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_author_reward_stats(UUID) TO service_role;

COMMENT ON FUNCTION public.get_author_reward_stats(UUID) IS 
    '获取作者奖励统计数据（供 Bot 界面展示）。只返回 is_active = TRUE 的任务规则。如果任务被关闭，对应的 stats 将返回 NULL。自动修复进度值超过当前总数的情况。修复了没有进度记录时返回 null 的问题。';
