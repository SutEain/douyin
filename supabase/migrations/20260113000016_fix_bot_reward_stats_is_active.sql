-- 🎯 修复 Bot 端任务奖励统计函数，只返回激活状态的任务
-- 问题：获赞任务关闭后，Bot 端仍然显示该任务
-- 解决：在 get_author_reward_stats 函数中添加 is_active 检查

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
        -- 获取该用户上次领取的进度水位线
        SELECT COALESCE(progress_value, 0) INTO v_last_rewarded_views 
        FROM public.user_incentive_progress 
        WHERE user_id = p_user_id AND rule_id = v_views_rule.id;

        -- 计算待领取份数
        v_views_pending_count := (v_current_total_views - v_last_rewarded_views) / v_views_rule.threshold;
        IF v_views_pending_count < 0 THEN
            v_views_pending_count := 0;
        END IF;

        -- 计算下一份还差多少
        v_views_next_distance := v_views_rule.threshold - ((v_current_total_views - v_last_rewarded_views) % v_views_rule.threshold);
        IF v_views_next_distance = v_views_rule.threshold THEN
            v_views_next_distance := 0;
        END IF;
    END IF;

    -- 🎯 处理获赞奖励统计（如果规则存在且激活）
    IF v_likes_rule.id IS NOT NULL THEN
        -- 获取该用户上次领取的进度水位线
        SELECT COALESCE(progress_value, 0) INTO v_last_rewarded_likes 
        FROM public.user_incentive_progress 
        WHERE user_id = p_user_id AND rule_id = v_likes_rule.id;

        -- 计算待领取份数
        v_likes_pending_count := (v_current_total_likes - v_last_rewarded_likes) / v_likes_rule.threshold;
        IF v_likes_pending_count < 0 THEN
            v_likes_pending_count := 0;
        END IF;

        -- 计算下一份还差多少
        v_likes_next_distance := v_likes_rule.threshold - ((v_current_total_likes - v_last_rewarded_likes) % v_likes_rule.threshold);
        IF v_likes_next_distance = v_likes_rule.threshold THEN
            v_likes_next_distance := 0;
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
    '获取作者奖励统计数据（供 Bot 界面展示）。只返回 is_active = TRUE 的任务规则。如果任务被关闭，对应的 stats 将返回 NULL。';

