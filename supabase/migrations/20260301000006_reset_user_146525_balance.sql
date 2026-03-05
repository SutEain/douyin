-- 🚨 用户 146525（招财猫（24小时承兑商））抖币余额清零
-- 原因：骰子奖励+超时退款重复入账后人工清零

ALTER TABLE public.profiles DISABLE TRIGGER trigger_protect_sensitive_profile_fields;

DO $$
DECLARE
    v_user_id UUID;
    v_old_balance NUMERIC;
    v_new_balance NUMERIC := 0;
BEGIN
    SELECT id, COALESCE(balance_coins, 0) INTO v_user_id, v_old_balance
    FROM public.profiles
    WHERE numeric_id = 146525;

    IF v_user_id IS NULL THEN
        RAISE EXCEPTION '用户 numeric_id 146525 不存在';
    END IF;

    IF v_old_balance = 0 THEN
        RAISE NOTICE '用户 146525 余额已是 0，无需操作';
        RETURN;
    END IF;

    UPDATE public.profiles
    SET balance_coins = 0
    WHERE id = v_user_id
    RETURNING balance_coins INTO v_new_balance;

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
        format('[系统操作] 余额清零：原余额 %s 抖币（用户 146525）', v_old_balance),
        NULL
    );

    RAISE NOTICE '用户 146525 余额已清零：% -> 0', v_old_balance;
END $$;

ALTER TABLE public.profiles ENABLE TRIGGER trigger_protect_sensitive_profile_fields;
