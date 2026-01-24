-- 🚨 将用户 T (numeric_id: 42718) 的抖币余额归零
-- 操作：将 balance_coins 设置为 0，并记录到交易流水

-- 临时禁用触发器以执行更新
ALTER TABLE public.profiles DISABLE TRIGGER trigger_protect_sensitive_profile_fields;

DO $$
DECLARE
    v_user_id UUID;
    v_old_balance NUMERIC;
    v_new_balance NUMERIC := 0;
BEGIN
    -- 获取用户ID和当前余额
    SELECT id, balance_coins INTO v_user_id, v_old_balance
    FROM public.profiles
    WHERE numeric_id = 42718;
    
    IF v_user_id IS NULL THEN
        RAISE EXCEPTION '找不到 numeric_id = 42718 的用户';
    END IF;
    
    -- 如果余额已经是0，不需要操作
    IF v_old_balance = 0 THEN
        RAISE NOTICE '用户 T (numeric_id: 42718) 余额已经是0，无需操作';
        RETURN;
    END IF;
    
    -- 更新余额为0
    UPDATE public.profiles
    SET balance_coins = 0
    WHERE id = v_user_id
    RETURNING balance_coins INTO v_new_balance;
    
    -- 记录交易流水（余额清零）
    INSERT INTO public.coin_transactions (
        user_id,
        amount,
        balance_after,
        type,
        description,
        related_id
    ) VALUES (
        v_user_id,
        -v_old_balance,
        v_new_balance,
        'adjustment',
        format('[系统操作] 余额清零：原余额 %s 抖币', v_old_balance),
        NULL
    );
    
    RAISE NOTICE '用户 T (numeric_id: 42718, ID: %) 余额已清零：% -> %', v_user_id, v_old_balance, v_new_balance;
END $$;

-- 重新启用触发器
ALTER TABLE public.profiles ENABLE TRIGGER trigger_protect_sensitive_profile_fields;

-- 验证结果
SELECT 
    id,
    numeric_id,
    nickname,
    username,
    balance_coins,
    frozen_coins
FROM public.profiles
WHERE numeric_id = 42718;
