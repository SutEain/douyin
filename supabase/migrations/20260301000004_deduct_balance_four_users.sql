-- 🚨 批量扣除指定用户抖币
-- 小卡拉米 37189: -3172.32
-- 半入江风半入云 120965: -1490.42
-- 乐乐 71922: -1606.51
-- 0v0 113777: -2432.41

ALTER TABLE public.profiles DISABLE TRIGGER trigger_protect_sensitive_profile_fields;

DO $$
DECLARE
    v_rec RECORD;
    v_user_id UUID;
    v_old_balance NUMERIC;
    v_deduct NUMERIC;
    v_new_balance NUMERIC;
    v_actual_deduct NUMERIC;
BEGIN
    FOR v_rec IN
        SELECT * FROM (VALUES
            (37189::BIGINT, '小卡拉米', 3172.32::NUMERIC),
            (120965::BIGINT, '半入江风半入云', 1490.42::NUMERIC),
            (71922::BIGINT, '乐乐', 1606.51::NUMERIC),
            (113777::BIGINT, '0v0', 2432.41::NUMERIC)
        ) AS t(numeric_id, nickname, deduct_amount)
    LOOP
        SELECT id, COALESCE(balance_coins, 0) INTO v_user_id, v_old_balance
        FROM public.profiles
        WHERE numeric_id = v_rec.numeric_id;

        IF v_user_id IS NULL THEN
            RAISE WARNING '用户 numeric_id % (%) 不存在，跳过', v_rec.numeric_id, v_rec.nickname;
            CONTINUE;
        END IF;

        v_deduct := v_rec.deduct_amount;
        v_actual_deduct := LEAST(v_deduct, v_old_balance);
        v_new_balance := v_old_balance - v_actual_deduct;

        IF v_actual_deduct <= 0 THEN
            RAISE NOTICE '用户 % (%) 余额 % 不足或为 0，跳过扣除 %', v_rec.numeric_id, v_rec.nickname, v_old_balance, v_deduct;
            CONTINUE;
        END IF;

        UPDATE public.profiles
        SET balance_coins = v_new_balance
        WHERE id = v_user_id;

        INSERT INTO public.coin_transactions (
            user_id,
            amount,
            balance_after,
            type,
            description,
            related_id
        ) VALUES (
            v_user_id,
            -v_actual_deduct,
            v_new_balance,
            'adjustment',
            format('[系统操作] 扣除 %s 抖币（用户 %s）', v_actual_deduct, v_rec.numeric_id),
            NULL
        );

        RAISE NOTICE '用户 % (%) 扣除 %，余额 % -> %', v_rec.numeric_id, v_rec.nickname, v_actual_deduct, v_old_balance, v_new_balance;
    END LOOP;
END $$;

ALTER TABLE public.profiles ENABLE TRIGGER trigger_protect_sensitive_profile_fields;
