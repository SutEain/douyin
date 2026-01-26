-- 🚨 紧急修复：claim_author_views_reward 函数安全漏洞
-- 问题：函数没有频率限制，用户可以频繁调用刷奖励
-- 修复：
-- 1. 添加频率限制（防止频繁调用）
-- 2. 添加单次奖励上限（防止异常情况）
-- 3. 添加播放量增长验证（防止异常增长）

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
    v_last_claim_time TIMESTAMPTZ;
    v_time_since_last_claim INTERVAL;
    v_last_total_views BIGINT;
    v_views_growth BIGINT;
BEGIN
    -- 🚨 安全验证 1: 只能为自己操作
    IF p_user_id != auth.uid() THEN
        RETURN json_build_object('success', false, 'message', '非法操作：只能为自己领取奖励');
    END IF;

    -- 🚨 安全验证 2: 频率限制（防止频繁调用）
    -- 检查最近一次领取时间
    SELECT MAX(created_at) INTO v_last_claim_time
    FROM public.coin_transactions
    WHERE user_id = p_user_id
      AND type = 'task_reward'
      AND description LIKE '%作品播放奖励%'
      AND created_at > NOW() - INTERVAL '1 hour';
    
    IF v_last_claim_time IS NOT NULL THEN
        v_time_since_last_claim := NOW() - v_last_claim_time;
        -- 1小时内只能领取一次
        IF v_time_since_last_claim < INTERVAL '1 hour' THEN
            RETURN json_build_object('success', false, 'message', '请求过于频繁，请稍后再试（1小时内只能领取一次）');
        END IF;
    END IF;

    -- 获取规则
    SELECT * INTO v_rule 
    FROM public.incentive_rules 
    WHERE code = 'author_views_reward' AND is_active = TRUE;
    
    IF NOT FOUND THEN 
        RETURN json_build_object('success', false, 'message', '奖励规则未启用');
    END IF;

    -- 计算当前总播放量
    SELECT COALESCE(SUM(view_count), 0) INTO v_current_total_views 
    FROM public.videos 
    WHERE author_id = p_user_id AND status = 'published';

    -- 🚨 安全验证 3: 播放量增长验证（防止异常增长）
    -- 获取上次领取时的总播放量（从进度记录中获取）
    INSERT INTO public.user_incentive_progress (user_id, rule_id, progress_value, cap_used)
    VALUES (p_user_id, v_rule.id, 0, 0)
    ON CONFLICT (user_id, rule_id) DO NOTHING;

    SELECT * INTO v_progress 
    FROM public.user_incentive_progress 
    WHERE user_id = p_user_id AND rule_id = v_rule.id 
    FOR UPDATE;
    
    v_last_rewarded_views := v_progress.progress_value;
    
    -- 计算播放量增长
    v_views_growth := v_current_total_views - v_last_rewarded_views;
    
    -- 🚨 安全验证 4: 单次增长不能超过10000次（防止异常刷播放量）
    IF v_views_growth > 10000 THEN
        RAISE WARNING '[SECURITY] User % attempted to claim reward with excessive views growth: %', p_user_id, v_views_growth;
        RETURN json_build_object('success', false, 'message', '播放量增长异常，请联系管理员');
    END IF;

    -- 计算本次可领取的份数 (每 50 次 1 份)
    v_new_claims := v_views_growth / v_rule.threshold;

    IF v_new_claims <= 0 THEN
        RETURN json_build_object(
            'success', false, 
            'message', '新增播放量不足 50 次，暂不可领取', 
            'current_total_views', v_current_total_views,
            'rewarded_views', v_last_rewarded_views,
            'next_target', v_last_rewarded_views + v_rule.threshold
        );
    END IF;

    -- 🚨 安全验证 5: 单次领取不能超过200份（防止异常情况）
    IF v_new_claims > 200 THEN
        RAISE WARNING '[SECURITY] User % attempted to claim excessive reward: % claims', p_user_id, v_new_claims;
        RETURN json_build_object('success', false, 'message', '单次领取数量异常，请联系管理员');
    END IF;

    -- 计算奖励金额并更新余额
    v_total_reward_coins := v_new_claims * v_rule.reward_usdt;
    
    -- 🚨 安全验证 6: 单次奖励不能超过1000抖币（防止异常情况）
    IF v_total_reward_coins > 1000 THEN
        RAISE WARNING '[SECURITY] User % attempted to claim excessive reward amount: %', p_user_id, v_total_reward_coins;
        RETURN json_build_object('success', false, 'message', '奖励金额异常，请联系管理员');
    END IF;
    
    UPDATE public.profiles
    SET balance_coins = balance_coins + v_total_reward_coins
    WHERE id = p_user_id
    RETURNING balance_coins INTO v_final_balance;

    -- 写入资金流水记录
    INSERT INTO public.coin_transactions (user_id, amount, balance_after, type, description, related_id)
    VALUES (
        p_user_id, 
        v_total_reward_coins, 
        v_final_balance, 
        'task_reward', 
        '作品播放奖励: 总播放量达到 ' || v_current_total_views || ' (本次领取 ' || v_new_claims || ' 份，共 ' || v_total_reward_coins || ' 抖币)', 
        v_progress.id
    );

    -- 更新领取水位线，防止重复领取
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

COMMENT ON FUNCTION public.claim_author_views_reward IS '🚨 修复安全漏洞：添加频率限制（1小时1次）、播放量增长验证、单次奖励上限，防止刷奖励';
