-- 🎯 PC28 账变/资金流水：description 中展示期数 + 下注内容（大小单双等）
-- APP 直播间账单与后台资金流水可直接显示 description

-- 1. 下注类型转中文标签（用于 description 展示）
CREATE OR REPLACE FUNCTION public.format_pc28_bet_label(p_bet_type TEXT, p_bet_value INT DEFAULT NULL)
RETURNS TEXT
LANGUAGE plpgsql
IMMUTABLE
AS $$
BEGIN
  RETURN CASE p_bet_type
    WHEN 'big' THEN '大'
    WHEN 'small' THEN '小'
    WHEN 'odd' THEN '单'
    WHEN 'even' THEN '双'
    WHEN 'big_odd' THEN '大单'
    WHEN 'big_even' THEN '大双'
    WHEN 'small_odd' THEN '小单'
    WHEN 'small_even' THEN '小双'
    WHEN 'extreme_big' THEN '极大'
    WHEN 'extreme_small' THEN '极小'
    WHEN 'pair' THEN '对子'
    WHEN 'straight' THEN '顺子'
    WHEN 'leopard' THEN '豹子'
    WHEN 'single_point' THEN '单点' || COALESCE(p_bet_value::TEXT, '')
    ELSE COALESCE(p_bet_type, '')
  END;
END;
$$;

COMMENT ON FUNCTION public.format_pc28_bet_label IS 'PC28 下注类型转中文，用于账变/流水 description 展示';

-- 2. place_pc28_bet：资金流水 description 含期数 + 下注内容
CREATE OR REPLACE FUNCTION public.place_pc28_bet(
    p_round_id UUID,
    p_bet_type TEXT,
    p_amount NUMERIC,
    p_bet_value INT DEFAULT NULL
) RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_round RECORD;
    v_config RECORD;
    v_user_balance NUMERIC;
    v_odds NUMERIC;
    v_bet_id UUID;
    v_final_balance NUMERIC;
    v_user_nickname TEXT;
BEGIN
    SELECT * INTO v_round
    FROM public.pc28_game_rounds
    WHERE id = p_round_id
    FOR UPDATE;

    IF v_round IS NULL THEN
        RETURN json_build_object('success', false, 'message', '期数不存在');
    END IF;

    IF v_round.status != 'betting' THEN
        RETURN json_build_object('success', false, 'message', '该期已封盘或已结算');
    END IF;

    IF v_round.seal_at IS NOT NULL AND now() >= v_round.seal_at THEN
        UPDATE public.pc28_game_rounds SET status = 'sealed' WHERE id = p_round_id;
        RETURN json_build_object('success', false, 'message', '该期已封盘');
    END IF;

    IF p_amount IS NULL OR p_amount <= 0 OR p_amount > 2000 THEN
        RETURN json_build_object('success', false, 'message', '下注金额必须在1-2000之间');
    END IF;

    IF p_bet_type = 'single_point' THEN
        IF p_bet_value IS NULL THEN
            RETURN json_build_object('success', false, 'message', '单点下注必须指定点数');
        END IF;
        v_odds := public.get_pc28_platform_odds(p_bet_type, p_bet_value);
    ELSE
        v_odds := public.get_pc28_platform_odds(p_bet_type, 0);
    END IF;

    IF v_odds IS NULL THEN
        RETURN json_build_object('success', false, 'message', '无效的下注类型或点数');
    END IF;

    SELECT balance_coins INTO v_user_balance FROM public.profiles WHERE id = auth.uid() FOR UPDATE;
    IF v_user_balance IS NULL OR v_user_balance < p_amount THEN
        RETURN json_build_object('success', false, 'message', '余额不足');
    END IF;

    UPDATE public.profiles SET balance_coins = balance_coins - p_amount WHERE id = auth.uid()
    RETURNING balance_coins, nickname INTO v_final_balance, v_user_nickname;
    IF v_user_nickname IS NULL OR v_user_nickname = '' THEN v_user_nickname := '用户'; END IF;

    INSERT INTO public.coin_transactions (user_id, amount, balance_after, type, description, related_id)
    VALUES (
        auth.uid(),
        -p_amount,
        v_final_balance,
        'pc28_bet',
        format('PC28下注 %s期 %s %s抖币', v_round.period_number, public.format_pc28_bet_label(p_bet_type, p_bet_value), p_amount),
        p_round_id
    );

    INSERT INTO public.pc28_bets (round_id, room_id, user_id, bet_type, bet_value, amount, odds, status)
    VALUES (p_round_id, v_round.room_id, auth.uid(), p_bet_type, p_bet_value, p_amount, v_odds, 'pending')
    RETURNING id INTO v_bet_id;

    INSERT INTO public.live_broadcast_messages (room_id, user_id, content, msg_type)
    VALUES (v_round.room_id, auth.uid(), json_build_object('text', format('%s 下注了 %s抖币', v_user_nickname, p_amount::TEXT))::text, 'pc28');

    RETURN json_build_object('success', true, 'bet_id', v_bet_id, 'message', '下注成功');
END;
$$;

-- 3. place_pc28_bet_global：资金流水 description 含期数 + 下注内容
CREATE OR REPLACE FUNCTION public.place_pc28_bet_global(
    p_global_round_id UUID,
    p_room_id UUID,
    p_bet_type TEXT,
    p_amount NUMERIC,
    p_bet_value INT DEFAULT NULL
) RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_round RECORD;
    v_room_enabled RECORD;
    v_user_balance NUMERIC;
    v_odds NUMERIC;
    v_bet_id UUID;
    v_final_balance NUMERIC;
    v_user_nickname TEXT;
BEGIN
    PERFORM set_config('app.pc28_settlement', 'true', false);

    SELECT * INTO v_round FROM public.pc28_global_rounds WHERE id = p_global_round_id FOR UPDATE;
    IF v_round IS NULL THEN
        PERFORM set_config('app.pc28_settlement', 'false', false);
        RETURN json_build_object('success', false, 'message', '期数不存在');
    END IF;

    IF v_round.status != 'betting' THEN
        PERFORM set_config('app.pc28_settlement', 'false', false);
        RETURN json_build_object('success', false, 'message', '该期已封盘或已结算');
    END IF;

    IF v_round.seal_at IS NOT NULL AND now() >= v_round.seal_at THEN
        UPDATE public.pc28_global_rounds SET status = 'sealed' WHERE id = p_global_round_id;
        PERFORM set_config('app.pc28_settlement', 'false', false);
        RETURN json_build_object('success', false, 'message', '该期已封盘');
    END IF;

    SELECT * INTO v_room_enabled FROM public.pc28_room_enabled WHERE room_id = p_room_id AND enabled = true;
    IF v_room_enabled IS NULL THEN
        PERFORM set_config('app.pc28_settlement', 'false', false);
        RETURN json_build_object('success', false, 'message', '该房间未开启PC28游戏');
    END IF;

    IF p_amount <= 0 THEN
        PERFORM set_config('app.pc28_settlement', 'false', false);
        RETURN json_build_object('success', false, 'message', '下注金额必须大于0');
    END IF;
    IF p_amount > 2000 THEN
        PERFORM set_config('app.pc28_settlement', 'false', false);
        RETURN json_build_object('success', false, 'message', '单注下注金额不能超过2000抖币');
    END IF;

    SELECT balance_coins INTO v_user_balance FROM public.profiles WHERE id = auth.uid() FOR UPDATE;
    IF v_user_balance IS NULL OR v_user_balance < p_amount THEN
        PERFORM set_config('app.pc28_settlement', 'false', false);
        RETURN json_build_object('success', false, 'message', '余额不足');
    END IF;

    v_odds := public.get_pc28_platform_odds(p_bet_type, COALESCE(p_bet_value, 0));
    IF v_odds IS NULL THEN
        PERFORM set_config('app.pc28_settlement', 'false', false);
        RETURN json_build_object('success', false, 'message', '无效的下注类型');
    END IF;

    UPDATE public.profiles SET balance_coins = balance_coins - p_amount WHERE id = auth.uid()
    RETURNING balance_coins INTO v_final_balance;

    INSERT INTO public.coin_transactions (user_id, amount, balance_after, type, description, related_id)
    VALUES (
        auth.uid(),
        -p_amount,
        v_final_balance,
        'pc28_bet',
        format('PC28下注 %s期 %s %s抖币', v_round.period_number, public.format_pc28_bet_label(p_bet_type, p_bet_value), p_amount),
        NULL
    );

    INSERT INTO public.pc28_bets (global_round_id, room_id, user_id, bet_type, bet_value, amount, odds, status)
    VALUES (p_global_round_id, p_room_id, auth.uid(), p_bet_type, p_bet_value, p_amount, v_odds, 'pending')
    RETURNING id INTO v_bet_id;

    UPDATE public.pc28_global_rounds SET total_bet_amount = total_bet_amount + p_amount, updated_at = now() WHERE id = p_global_round_id;

    SELECT nickname INTO v_user_nickname FROM public.profiles WHERE id = auth.uid();
    INSERT INTO public.live_broadcast_messages (room_id, user_id, msg_type, content)
    VALUES (
        p_room_id, auth.uid(), 'pc28',
        json_build_object('type', 'bet', 'user_nickname', COALESCE(v_user_nickname, '用户'), 'bet_type', p_bet_type, 'bet_value', p_bet_value, 'amount', p_amount, 'period_number', v_round.period_number)::TEXT
    );

    PERFORM set_config('app.pc28_settlement', 'false', false);
    RETURN json_build_object('success', true, 'message', '下注成功', 'bet_id', v_bet_id);
EXCEPTION WHEN OTHERS THEN
    PERFORM set_config('app.pc28_settlement', 'false', false);
    RAISE;
END;
$$;

-- 4. cancel_pc28_bet：退款流水 description 含期数 + 下注内容
CREATE OR REPLACE FUNCTION public.cancel_pc28_bet(p_bet_id UUID) RETURNS JSON
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
    v_bet RECORD;
    v_round RECORD;
    v_period_number TEXT;
    v_user_balance NUMERIC;
    v_final_balance NUMERIC;
BEGIN
    SELECT * INTO v_bet FROM public.pc28_bets WHERE id = p_bet_id AND user_id = auth.uid();
    IF v_bet IS NULL THEN
        RETURN json_build_object('success', false, 'message', '下注记录不存在');
    END IF;

    IF v_bet.status != 'pending' THEN
        RETURN json_build_object('success', false, 'message', '该下注已结算，无法取消');
    END IF;

    IF v_bet.global_round_id IS NOT NULL THEN
        SELECT * INTO v_round FROM public.pc28_global_rounds WHERE id = v_bet.global_round_id FOR UPDATE;
        IF v_round IS NULL THEN RETURN json_build_object('success', false, 'message', '期数不存在'); END IF;
        v_period_number := v_round.period_number;
        IF v_round.status != 'betting' THEN
            RETURN json_build_object('success', false, 'message', '该期已封盘或已结算，无法取消下注');
        END IF;
    ELSIF v_bet.round_id IS NOT NULL THEN
        SELECT * INTO v_round FROM public.pc28_game_rounds WHERE id = v_bet.round_id FOR UPDATE;
        IF v_round IS NULL THEN RETURN json_build_object('success', false, 'message', '期数不存在'); END IF;
        v_period_number := v_round.period_number;
        IF v_round.status != 'betting' THEN
            RETURN json_build_object('success', false, 'message', '该期已封盘或已结算，无法取消下注');
        END IF;
    ELSE
        RETURN json_build_object('success', false, 'message', '下注记录缺少期数信息');
    END IF;

    SELECT balance_coins INTO v_user_balance FROM public.profiles WHERE id = auth.uid() FOR UPDATE;
    UPDATE public.profiles SET balance_coins = balance_coins + v_bet.amount WHERE id = auth.uid()
    RETURNING balance_coins INTO v_final_balance;
    IF v_final_balance IS NULL THEN
        RETURN json_build_object('success', false, 'message', '无法更新用户余额');
    END IF;

    INSERT INTO public.coin_transactions (user_id, amount, balance_after, type, description, related_id)
    VALUES (
        auth.uid(),
        v_bet.amount,
        v_final_balance,
        'pc28_refund',
        format('PC28取消下注退款 %s期 %s', v_period_number, public.format_pc28_bet_label(v_bet.bet_type, v_bet.bet_value)),
        p_bet_id
    );

    UPDATE public.pc28_bets SET status = 'cancelled', refund_amount = v_bet.amount, cancelled_at = now() WHERE id = p_bet_id;

    INSERT INTO public.live_broadcast_messages (room_id, user_id, content, msg_type)
    VALUES (v_bet.room_id, auth.uid(), json_build_object('text', format('取消下注 %s期', v_period_number))::text, 'pc28');

    RETURN json_build_object('success', true, 'message', '取消下注成功');
END;
$$;

COMMENT ON FUNCTION public.cancel_pc28_bet IS '取消PC28下注：支持全局期数系统，兼容旧系统。退款流水含期数+下注内容。';
GRANT EXECUTE ON FUNCTION public.cancel_pc28_bet(UUID) TO authenticated;
