-- 🚨 清理用户 35991 (numeric_id) 的异常交易记录并清零余额
-- 攻击记录：
-- 1. fake_reward: 1,000,000 抖币 (2026-01-29 07:46:42)
-- 2. test_verification: 88,888 抖币 (2026-01-29 07:50:48)
-- 这些是通过安全漏洞直接插入的伪造交易

-- 临时禁用触发器以执行更新
ALTER TABLE public.profiles DISABLE TRIGGER trigger_protect_sensitive_profile_fields;

DO $$
DECLARE
    v_user_id UUID;
    v_current_balance NUMERIC;
    v_fake_transactions_amount NUMERIC := 0;
    v_legitimate_balance NUMERIC := 0;
    v_final_balance NUMERIC := 0;
BEGIN
    -- 1. 获取用户ID和当前余额
    SELECT id, balance_coins INTO v_user_id, v_current_balance
    FROM public.profiles
    WHERE numeric_id = 35991;
    
    IF v_user_id IS NULL THEN
        RAISE EXCEPTION '找不到 numeric_id = 35991 的用户';
    END IF;
    
    -- 2. 计算伪造交易的总金额
    SELECT COALESCE(SUM(amount), 0) INTO v_fake_transactions_amount
    FROM public.coin_transactions
    WHERE user_id = v_user_id
      AND type IN ('fake_reward', 'test_verification');
    
    -- 3. 计算合法交易的净余额（排除伪造交易）
    SELECT COALESCE(SUM(amount), 0) INTO v_legitimate_balance
    FROM public.coin_transactions
    WHERE user_id = v_user_id
      AND type NOT IN ('fake_reward', 'test_verification');
    
    RAISE NOTICE '用户 35991 信息：';
    RAISE NOTICE '  当前余额: %', v_current_balance;
    RAISE NOTICE '  伪造交易金额: %', v_fake_transactions_amount;
    RAISE NOTICE '  合法交易净余额: %', v_legitimate_balance;
    
    -- 4. 删除伪造的交易记录
    DELETE FROM public.coin_transactions
    WHERE user_id = v_user_id
      AND type IN ('fake_reward', 'test_verification');
    
    RAISE NOTICE '已删除伪造交易记录';
    
    -- 5. 将余额清零
    UPDATE public.profiles
    SET balance_coins = 0
    WHERE id = v_user_id
    RETURNING balance_coins INTO v_final_balance;
    
    -- 6. 记录余额清零操作
    INSERT INTO public.coin_transactions (
        user_id,
        amount,
        balance_after,
        type,
        description,
        related_id
    ) VALUES (
        v_user_id,
        -v_current_balance,
        v_final_balance,
        'adjustment',
        format('[安全修复] 清理伪造交易并清零余额：删除 %s 抖币的伪造交易，原余额 %s 抖币', 
               v_fake_transactions_amount, v_current_balance),
        NULL
    );
    
    RAISE NOTICE '用户 35991 余额已清零：% -> %', v_current_balance, v_final_balance;
    RAISE NOTICE '已记录余额清零操作到交易流水';
END $$;

-- 重新启用触发器
ALTER TABLE public.profiles ENABLE TRIGGER trigger_protect_sensitive_profile_fields;

-- 验证结果
SELECT 
    p.id,
    p.numeric_id,
    p.nickname,
    p.username,
    p.balance_coins,
    p.frozen_coins,
    COUNT(CASE WHEN ct.type IN ('fake_reward', 'test_verification') THEN 1 END) as fake_transaction_count,
    COUNT(ct.id) as total_transaction_count
FROM public.profiles p
LEFT JOIN public.coin_transactions ct ON p.id = ct.user_id
WHERE p.numeric_id = 35991
GROUP BY p.id, p.numeric_id, p.nickname, p.username, p.balance_coins, p.frozen_coins;
