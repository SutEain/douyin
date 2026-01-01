-- 1. 扩展任务规则类型约束，允许“作者播放量奖励”类型
ALTER TABLE public.incentive_rules DROP CONSTRAINT IF EXISTS incentive_rules_rule_type_check;
ALTER TABLE public.incentive_rules ADD CONSTRAINT incentive_rules_rule_type_check 
CHECK (rule_type = ANY (ARRAY[
    'video_like_threshold'::text, 
    'invite_success'::text, 
    'invitee_publish'::text, 
    'total_views'::text, 
    'author_views'::text
]));

-- 2. 插入作者播放量奖励规则
INSERT INTO public.incentive_rules (code, name, description, rule_type, scope, metric, threshold, reward_usdt, is_active, sort_order)
VALUES (
    'author_views_reward', 
    '作品播放奖励', 
    '作品每获得 50 次播放，可领取 5 抖币（无限循环）', 
    'author_views', 
    'user', 
    'total_view_count', 
    50, 
    5.00, 
    TRUE,
    20
)
ON CONFLICT (code) DO UPDATE SET 
    name = EXCLUDED.name,
    description = EXCLUDED.description,
    threshold = EXCLUDED.threshold,
    reward_usdt = EXCLUDED.reward_usdt;

-- 3. 创建函数：获取作者奖励统计数据 (供 Bot 界面展示)
CREATE OR REPLACE FUNCTION public.get_author_reward_stats(p_user_id UUID)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_current_total_views BIGINT;
    v_last_rewarded_views INT := 0;
    v_rule_id UUID;
    v_threshold INT;
BEGIN
    -- 获取规则 ID 和阈值
    SELECT id, threshold INTO v_rule_id, v_threshold 
    FROM public.incentive_rules 
    WHERE code = 'author_views_reward';

    -- 计算作者名下所有已发布作品的总播放量
    SELECT COALESCE(SUM(view_count), 0) INTO v_current_total_views 
    FROM public.videos 
    WHERE author_id = p_user_id AND status = 'published';

    -- 获取该用户上次领取的进度水位线
    SELECT COALESCE(progress_value, 0) INTO v_last_rewarded_views 
    FROM public.user_incentive_progress 
    WHERE user_id = p_user_id AND rule_id = v_rule_id;

    RETURN json_build_object(
        'current_total_views', v_current_total_views,
        'last_rewarded_views', v_last_rewarded_views,
        'next_reward_distance', v_threshold - ((v_current_total_views - v_last_rewarded_views) % v_threshold)
    );
END;
$$;

-- 4. 创建核心领取函数：执行核算、发放奖励及记录流水
CREATE OR REPLACE FUNCTION public.claim_author_views_reward(p_user_id UUID)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_rule RECORD;
    v_progress RECORD;
    v_current_total_views BIGINT;
    v_last_rewarded_views INT := 0;
    v_new_claims INT;
    v_total_reward_coins NUMERIC;
    v_final_balance NUMERIC;
BEGIN
    -- 1. 获取规则
    SELECT * INTO v_rule FROM public.incentive_rules WHERE code = 'author_views_reward' AND is_active = TRUE;
    IF NOT FOUND THEN
        RETURN json_build_object('success', false, 'message', '奖励规则未启用');
    END IF;

    -- 2. 计算当前总播放量
    SELECT COALESCE(SUM(view_count), 0) INTO v_current_total_views 
    FROM public.videos 
    WHERE author_id = p_user_id AND status = 'published';

    -- 3. 获取或初始化进度记录
    INSERT INTO public.user_incentive_progress (user_id, rule_id, progress_value, cap_used)
    VALUES (p_user_id, v_rule.id, 0, 0)
    ON CONFLICT (user_id, rule_id) DO NOTHING;

    SELECT * INTO v_progress FROM public.user_incentive_progress 
    WHERE user_id = p_user_id AND rule_id = v_rule.id FOR UPDATE;
    
    v_last_rewarded_views := v_progress.progress_value;

    -- 4. 计算本次可领取的份数 (每 50 次 1 份)
    v_new_claims := (v_current_total_views - v_last_rewarded_views) / v_rule.threshold;

    IF v_new_claims <= 0 THEN
        RETURN json_build_object(
            'success', false, 
            'message', '新增播放量不足 50 次，暂不可领取', 
            'current_total_views', v_current_total_views,
            'rewarded_views', v_last_rewarded_views,
            'next_target', v_last_rewarded_views + v_rule.threshold
        );
    END IF;

    -- 5. 计算奖励金额并更新余额
    v_total_reward_coins := v_new_claims * v_rule.reward_usdt;
    
    UPDATE public.profiles
    SET balance_coins = balance_coins + v_total_reward_coins
    WHERE id = p_user_id
    RETURNING balance_coins INTO v_final_balance;

    -- 6. 写入资金流水记录
    INSERT INTO public.coin_transactions (user_id, amount, balance_after, type, description, related_id)
    VALUES (
        p_user_id, 
        v_total_reward_coins, 
        v_final_balance, 
        'task_reward', 
        '作品播放奖励: 总播放量达到 ' || v_current_total_views || ' (本次领取 ' || v_new_claims || ' 份，共 ' || v_total_reward_coins || ' 抖币)', 
        v_progress.id
    );

    -- 7. 更新领取水位线，防止重复领取
    UPDATE public.user_incentive_progress
    SET progress_value = v_last_rewarded_views + (v_new_claims * v_rule.threshold),
        cap_used = cap_used + v_new_claims,
        updated_at = NOW()
    WHERE id = v_progress.id;

    RETURN json_build_object(
        'success', true, 
        'reward_coins', v_total_reward_coins, 
        'claims_count', v_new_claims,
        'current_total_views', v_current_total_views,
        'balance_after', v_final_balance
    );
END;
$$;

-- 5. 授予执行权限
GRANT EXECUTE ON FUNCTION public.get_author_reward_stats(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_author_reward_stats(UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.claim_author_views_reward(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.claim_author_views_reward(UUID) TO service_role;

