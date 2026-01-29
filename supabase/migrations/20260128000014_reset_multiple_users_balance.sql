-- 🚨 批量清空多个用户的抖币余额
-- 用户 numeric_id: 42877, 81532, 46371, 42716, 44691, 37016
-- 操作：将 balance_coins 设置为 0，并记录到交易流水

-- 临时禁用触发器以执行更新
ALTER TABLE public.profiles DISABLE TRIGGER trigger_protect_sensitive_profile_fields;

DO $$
DECLARE
    v_user_record RECORD;
    v_user_id UUID;
    v_old_balance NUMERIC;
    v_new_balance NUMERIC := 0;
    v_processed_count INT := 0;
    v_not_found_ids TEXT[] := ARRAY[]::TEXT[];
BEGIN
    -- 遍历所有需要清空余额的用户
    FOR v_user_record IN 
        SELECT id, numeric_id, nickname, username, balance_coins
        FROM public.profiles
        WHERE numeric_id IN (42877, 81532, 46371, 42716, 44691, 37016)
    LOOP
        v_user_id := v_user_record.id;
        v_old_balance := COALESCE(v_user_record.balance_coins, 0);
        
        -- 如果余额已经是0，跳过
        IF v_old_balance = 0 THEN
            RAISE NOTICE '用户 numeric_id: %, nickname: % 余额已经是0，跳过', 
                v_user_record.numeric_id, v_user_record.nickname;
            CONTINUE;
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
        
        v_processed_count := v_processed_count + 1;
        RAISE NOTICE '用户 numeric_id: %, nickname: %, ID: % 余额已清零：% -> %', 
            v_user_record.numeric_id, 
            v_user_record.nickname, 
            v_user_id, 
            v_old_balance, 
            v_new_balance;
    END LOOP;
    
    -- 检查是否有未找到的用户
    SELECT ARRAY_AGG(numeric_id::TEXT) INTO v_not_found_ids
    FROM (VALUES (42877), (81532), (46371), (42716), (44691), (37016)) AS t(numeric_id)
    WHERE numeric_id NOT IN (
        SELECT numeric_id FROM public.profiles WHERE numeric_id IN (42877, 81532, 46371, 42716, 44691, 37016)
    );
    
    IF array_length(v_not_found_ids, 1) > 0 THEN
        RAISE WARNING '以下 numeric_id 未找到用户：%', array_to_string(v_not_found_ids, ', ');
    END IF;
    
    RAISE NOTICE '批量清空余额完成，共处理 % 个用户', v_processed_count;
END $$;

-- 重新启用触发器
ALTER TABLE public.profiles ENABLE TRIGGER trigger_protect_sensitive_profile_fields;

-- 验证结果：显示所有相关用户的余额信息
SELECT 
    id,
    numeric_id,
    nickname,
    username,
    balance_coins,
    frozen_coins,
    CASE 
        WHEN balance_coins = 0 THEN '✅ 已清零'
        ELSE '⚠️ 仍有余额'
    END as status
FROM public.profiles
WHERE numeric_id IN (42877, 81532, 46371, 42716, 44691, 37016)
ORDER BY numeric_id;
