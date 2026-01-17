-- 🎯 优化打赏备注：添加打赏对象信息
-- 1. 修改 process_gift_reward 函数，在记录交易时设置 counterparty_id 并更新 description
-- 2. 更新历史数据，通过匹配 gift_out 和 gift_in 的 related_id 和时间来推断 counterparty_id

-- -----------------------------------------------------------------------------
-- 1. 修改 process_gift_reward 函数，添加 counterparty_id 和更详细的 description
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.process_gift_reward(
    sender_id UUID,
    receiver_id UUID,
    gift_amount DECIMAL,
    room_or_video_id UUID,
    gift_type TEXT,
    gift_name TEXT
)
RETURNS JSON LANGUAGE plpgsql SECURITY DEFINER AS $func$
DECLARE
    current_sender_balance DECIMAL;
    receiver_gain DECIMAL;
    final_sender_balance DECIMAL;
    final_receiver_balance DECIMAL;
    split_percentage INT;
    v_last_gift_time TIMESTAMPTZ;
    v_time_since_last_gift INTERVAL;
    v_today_total DECIMAL;
    v_today DATE;
    v_receiver_nickname TEXT;
    v_sender_nickname TEXT;
BEGIN
    -- 🚨 安全验证 1: 用户身份验证
    IF auth.role() != 'service_role' AND sender_id != auth.uid() THEN
        RETURN json_build_object('success', false, 'message', '非法操作');
    END IF;

    -- 🚨 安全验证 2: 金额必须大于 0
    IF gift_amount <= 0 THEN
        RETURN json_build_object('success', false, 'message', '打赏金额必须大于 0');
    END IF;

    -- 🚨 安全验证 2.5: 最小金额限制（防止精度漏洞：极小值如 1e-12 会被数据库四舍五入为 0）
    -- 最小打赏金额为 0.01 抖币
    IF gift_amount < 0.01 THEN
        RETURN json_build_object('success', false);
    END IF;

    -- 🚨 安全验证 3: 单次打赏最大金额限制（2000抖币）
    IF gift_amount > 2000 THEN
        RETURN json_build_object('success', false);
    END IF;

    -- 🚨 安全验证 4: 检查最近一次打赏时间，防止并发攻击
    SELECT MAX(created_at) INTO v_last_gift_time
    FROM public.coin_transactions
    WHERE user_id = sender_id
      AND type = 'gift_out';
    
    IF v_last_gift_time IS NOT NULL THEN
        v_time_since_last_gift := NOW() - v_last_gift_time;
        -- 两次打赏之间至少间隔10秒（防止并发竞态）
        IF v_time_since_last_gift < INTERVAL '10 seconds' THEN
            RETURN json_build_object('success', false);
        END IF;
    END IF;

    -- 🚨 安全验证 5: 检查今日打赏总额（不超过10000抖币）
    v_today := (NOW() AT TIME ZONE 'Asia/Shanghai')::DATE;
    SELECT COALESCE(SUM(ABS(amount)), 0) INTO v_today_total
    FROM public.coin_transactions
    WHERE user_id = sender_id
      AND type = 'gift_out'
      AND (created_at AT TIME ZONE 'Asia/Shanghai')::DATE = v_today;
    
    IF v_today_total + gift_amount > 10000 THEN
        RETURN json_build_object('success', false);
    END IF;

    -- 获取分账比例设置
    SELECT COALESCE(value_int, 50) INTO split_percentage FROM public.system_settings WHERE id = 'gift_split_percentage';

    -- 🎯 获取接收者和发送者的昵称，用于备注
    SELECT nickname INTO v_receiver_nickname FROM public.profiles WHERE id = receiver_id;
    SELECT nickname INTO v_sender_nickname FROM public.profiles WHERE id = sender_id;

    -- 🚨 使用 SELECT FOR UPDATE 锁定发送者余额，防止并发竞态
    SELECT balance_coins INTO current_sender_balance FROM public.profiles WHERE id = sender_id FOR UPDATE;
    
    -- 🚨 双重检查：再次验证余额（防止在检查后、扣款前余额被其他操作消耗）
    IF current_sender_balance < gift_amount THEN
        RETURN json_build_object('success', false, 'message', '余额不足');
    END IF;

    -- 计算分成
    receiver_gain := gift_amount * (split_percentage / 100.0);

    -- 扣除发送者抖币
    UPDATE public.profiles 
    SET balance_coins = balance_coins - gift_amount 
    WHERE id = sender_id 
    RETURNING balance_coins INTO final_sender_balance;

    -- 增加接收者抖币
    UPDATE public.profiles 
    SET balance_coins = balance_coins + receiver_gain 
    WHERE id = receiver_id 
    RETURNING balance_coins INTO final_receiver_balance;

    -- 🎯 记录发送者流水（添加 counterparty_id 和更详细的 description）
    INSERT INTO public.coin_transactions (
        user_id, 
        amount, 
        balance_after, 
        type, 
        description, 
        related_id,
        counterparty_id
    )
    VALUES (
        sender_id, 
        -gift_amount, 
        final_sender_balance, 
        'gift_out', 
        CASE 
            WHEN gift_type = 'video' THEN '视频打赏: ' || COALESCE(gift_name, '礼物') || ' 打赏给 ' || COALESCE(v_receiver_nickname, '用户')
            ELSE '礼物打赏: ' || COALESCE(gift_name, '礼物') || ' 打赏给 ' || COALESCE(v_receiver_nickname, '用户')
        END, 
        room_or_video_id,
        receiver_id
    );

    -- 🎯 记录接收者流水（添加 counterparty_id 和更详细的 description）
    INSERT INTO public.coin_transactions (
        user_id, 
        amount, 
        balance_after, 
        type, 
        description, 
        related_id,
        counterparty_id
    )
    VALUES (
        receiver_id, 
        receiver_gain, 
        final_receiver_balance, 
        'gift_in', 
        CASE 
            WHEN gift_type = 'video' THEN '视频打赏: ' || COALESCE(gift_name, '礼物') || ' 收到 ' || COALESCE(v_sender_nickname, '用户') || ' 的打赏'
            ELSE '礼物打赏: ' || COALESCE(gift_name, '礼物') || ' 收到 ' || COALESCE(v_sender_nickname, '用户') || ' 的打赏'
        END, 
        room_or_video_id,
        sender_id
    );

    RETURN json_build_object(
        'success', true,
        'sender_balance', final_sender_balance,
        'receiver_balance', final_receiver_balance
    );
END; $func$;

COMMENT ON FUNCTION public.process_gift_reward IS '🎯 优化打赏接口：添加打赏对象信息到备注和counterparty_id字段';

-- -----------------------------------------------------------------------------
-- 2. 更新历史数据：通过匹配 gift_out 和 gift_in 的 related_id 和时间来推断 counterparty_id
-- -----------------------------------------------------------------------------
DO $$
DECLARE
    v_gift_out RECORD;
    v_gift_in RECORD;
    v_receiver_nickname TEXT;
    v_sender_nickname TEXT;
    v_gift_name TEXT;
    v_is_video_tip BOOLEAN;
    v_updated_count INT := 0;
BEGIN
    -- 遍历所有没有 counterparty_id 的 gift_out 记录
    FOR v_gift_out IN 
        SELECT ct.id, ct.user_id, ct.related_id, ct.created_at, ct.description
        FROM public.coin_transactions ct
        WHERE ct.type = 'gift_out' 
          AND ct.counterparty_id IS NULL
          AND ct.related_id IS NOT NULL
        ORDER BY ct.created_at
    LOOP
        -- 查找对应的 gift_in 记录（相同的 related_id，时间相近，在 gift_out 之后）
        SELECT ct.id, ct.user_id, ct.description INTO v_gift_in
        FROM public.coin_transactions ct
        WHERE ct.type = 'gift_in'
          AND ct.related_id = v_gift_out.related_id
          AND ct.counterparty_id IS NULL
          AND ct.created_at >= v_gift_out.created_at
          AND ct.created_at <= v_gift_out.created_at + INTERVAL '5 seconds'
        ORDER BY ct.created_at
        LIMIT 1;

        -- 如果找到了对应的 gift_in 记录
        IF v_gift_in.id IS NOT NULL THEN
            -- 获取接收者和发送者的昵称
            SELECT nickname INTO v_receiver_nickname FROM public.profiles WHERE id = v_gift_in.user_id;
            SELECT nickname INTO v_sender_nickname FROM public.profiles WHERE id = v_gift_out.user_id;

            -- 🎯 提取礼物名称（从 description 中提取）
            -- gift_out 格式: "打赏礼物: 视频打赏" 或 "打赏礼物: 棒棒糖"
            -- gift_in 格式: "收到打赏: 视频打赏" 或 "收到打赏: 棒棒糖"
            v_gift_name := REGEXP_REPLACE(v_gift_out.description, '.*打赏礼物:?\s*', '');
            IF v_gift_name = '' OR v_gift_name = v_gift_out.description THEN
                v_gift_name := REGEXP_REPLACE(v_gift_in.description, '.*收到打赏:?\s*', '');
            END IF;
            IF v_gift_name = '' OR v_gift_name = v_gift_in.description THEN
                v_gift_name := '礼物';
            END IF;

            -- 🎯 判断是否是视频打赏：
            -- 1. 如果 related_id 在 videos 表中，则是视频打赏
            -- 2. 如果 description 中包含"视频打赏"且礼物名称是"视频打赏"，也可能是视频打赏
            v_is_video_tip := EXISTS (
                SELECT 1 FROM public.videos WHERE id = v_gift_out.related_id
            );
            -- 如果 related_id 不在 videos 表中，但 description 明确包含"视频打赏"且礼物名称是"视频打赏"，也认为是视频打赏
            IF NOT v_is_video_tip AND (v_gift_name = '视频打赏' OR v_gift_out.description LIKE '%视频打赏%' OR v_gift_in.description LIKE '%视频打赏%') THEN
                v_is_video_tip := TRUE;
            END IF;

            -- 更新 gift_out 记录
            UPDATE public.coin_transactions
            SET 
                counterparty_id = v_gift_in.user_id,
                description = CASE 
                    WHEN v_is_video_tip THEN 
                        '视频打赏: ' || v_gift_name || ' 打赏给 ' || COALESCE(v_receiver_nickname, '用户')
                    ELSE 
                        '礼物打赏: ' || v_gift_name || ' 打赏给 ' || COALESCE(v_receiver_nickname, '用户')
                END
            WHERE id = v_gift_out.id;

            -- 更新 gift_in 记录
            UPDATE public.coin_transactions
            SET 
                counterparty_id = v_gift_out.user_id,
                description = CASE 
                    WHEN v_is_video_tip THEN 
                        '视频打赏: ' || v_gift_name || ' 收到 ' || COALESCE(v_sender_nickname, '用户') || ' 的打赏'
                    ELSE 
                        '礼物打赏: ' || v_gift_name || ' 收到 ' || COALESCE(v_sender_nickname, '用户') || ' 的打赏'
                END
            WHERE id = v_gift_in.id;

            v_updated_count := v_updated_count + 1;
        END IF;
    END LOOP;

    RAISE NOTICE '已更新 % 条打赏记录', v_updated_count;
END $$;
