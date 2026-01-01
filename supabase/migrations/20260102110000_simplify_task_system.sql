-- 1. 清理并初始化任务规则 (按用户要求简化：仅保留基础任务，移除邀请关联)
DELETE FROM public.incentive_rules WHERE code IN ('video_like_3_reward', 'invite_success_reward', 'invitee_publish_reward');

-- 2. 插入“总浏览”循环任务
INSERT INTO public.incentive_rules (code, name, description, rule_type, scope, metric, threshold, reward_usdt, cap_count, cap_window, is_active, sort_order)
VALUES (
    'total_views_reward', 
    '累计浏览奖励', 
    '累计浏览 50 次作品即可获得 5 抖币（无限循环任务）', 
    'total_views', 
    'user', 
    'view_count', 
    50, 
    5.00, 
    NULL, -- 无限次领取
    'lifetime', 
    TRUE, 
    10
);

-- 3. 创建原子性的任务进度处理函数
CREATE OR REPLACE FUNCTION public.increment_task_progress(
    p_user_id UUID,
    p_task_code TEXT,
    p_increment INT DEFAULT 1
) RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_rule RECORD;
    v_progress RECORD;
    v_reward_count INT := 0;
    v_total_reward NUMERIC := 0;
    v_final_balance NUMERIC;
    v_new_progress INT;
BEGIN
    -- 1. 获取任务规则
    SELECT * INTO v_rule FROM public.incentive_rules WHERE code = p_task_code AND is_active = TRUE;
    IF NOT FOUND THEN
        RETURN json_build_object('success', false, 'message', '任务规则不存在或未启用');
    END IF;

    -- 2. 锁定并获取用户进度
    -- 使用 upsert 模式处理
    INSERT INTO public.user_incentive_progress (user_id, rule_id, progress_value, cap_used)
    VALUES (p_user_id, v_rule.id, 0, 0)
    ON CONFLICT (user_id, rule_id) DO NOTHING;

    SELECT * INTO v_progress FROM public.user_incentive_progress 
    WHERE user_id = p_user_id AND rule_id = v_rule.id FOR UPDATE;

    -- 3. 更新进度
    v_new_progress := v_progress.progress_value + p_increment;

    -- 4. 检查是否达到阈值
    IF v_new_progress >= v_rule.threshold THEN
        v_reward_count := v_new_progress / v_rule.threshold;
        v_total_reward := v_reward_count * v_rule.reward_usdt;
        v_new_progress := v_new_progress % v_rule.threshold;

        -- 5. 发放奖励
        UPDATE public.profiles
        SET balance_coins = balance_coins + v_total_reward
        WHERE id = p_user_id
        RETURNING balance_coins INTO v_final_balance;

        -- 6. 记录流水
        INSERT INTO public.coin_transactions (user_id, amount, balance_after, type, description, related_id)
        VALUES (
            p_user_id, 
            v_total_reward, 
            v_final_balance, 
            'task_reward', 
            '任务奖励: ' || v_rule.name || ' (完成 ' || v_reward_count || ' 次)', 
            v_progress.id
        );

        -- 7. 更新领取次数
        UPDATE public.user_incentive_progress
        SET progress_value = v_new_progress,
            cap_used = cap_used + v_reward_count,
            updated_at = NOW()
        WHERE id = v_progress.id;

        RETURN json_build_object(
            'success', true, 
            'completed', true, 
            'reward_amount', v_total_reward, 
            'new_progress', v_new_progress,
            'total_claims', v_progress.cap_used + v_reward_count
        );
    ELSE
        -- 仅更新进度
        UPDATE public.user_incentive_progress
        SET progress_value = v_new_progress,
            updated_at = NOW()
        WHERE id = v_progress.id;

        RETURN json_build_object(
            'success', true, 
            'completed', false, 
            'new_progress', v_new_progress
        );
    END IF;
END;
$$;

-- 4. 确保 user_incentive_progress 有唯一约束 (user_id, rule_id)
-- 如果没有，我们需要添加它以支持上面的 logic
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint 
        WHERE conname = 'user_incentive_progress_user_id_rule_id_key'
    ) THEN
        ALTER TABLE public.user_incentive_progress 
        ADD CONSTRAINT user_incentive_progress_user_id_rule_id_key UNIQUE (user_id, rule_id);
    END IF;
END $$;

-- 授予执行权限
GRANT EXECUTE ON FUNCTION public.increment_task_progress(UUID, TEXT, INT) TO anon;
GRANT EXECUTE ON FUNCTION public.increment_task_progress(UUID, TEXT, INT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.increment_task_progress(UUID, TEXT, INT) TO service_role;

