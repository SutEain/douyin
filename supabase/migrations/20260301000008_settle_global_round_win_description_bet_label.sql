-- 🎯 结算流水 description 增加下注内容：中奖/回本时展示期数+大小单双等
-- 依赖 20260301000007 的 format_pc28_bet_label

CREATE OR REPLACE FUNCTION public.settle_global_round(
    p_global_round_id UUID,
    p_num1 INT,
    p_num2 INT,
    p_num3 INT
) RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_round RECORD;
    v_result JSONB;
    v_sum INT;
    v_bet RECORD;
    v_payout NUMERIC;
    v_platform_fee NUMERIC;
    v_user_gain NUMERIC;
    v_anchor_payout NUMERIC;
    v_total_payout NUMERIC := 0;
    v_total_platform_fee NUMERIC := 0;
    v_total_bet_amount NUMERIC := 0;
    v_user_balance NUMERIC;
    v_final_user_balance NUMERIC;
    v_anchor_balance NUMERIC;
    v_final_anchor_balance NUMERIC;
    v_is_win BOOLEAN;
    v_actual_odds NUMERIC;
    v_message_text TEXT;
    v_message_content JSONB;
    v_is_special_case BOOLEAN;
    v_is_combination_refund BOOLEAN;
    v_user_profit NUMERIC;
    v_room_bet_totals JSONB := '{}'::JSONB;
    v_room_reward RECORD;
BEGIN
    PERFORM set_config('app.pc28_settlement', 'true', false);

    SELECT * INTO v_round FROM public.pc28_global_rounds WHERE id = p_global_round_id FOR UPDATE;
    IF v_round IS NULL THEN
        PERFORM set_config('app.pc28_settlement', 'false', false);
        RETURN json_build_object('success', false, 'message', '期数不存在');
    END IF;
    IF v_round.status NOT IN ('betting', 'sealed') THEN
        PERFORM set_config('app.pc28_settlement', 'false', false);
        RETURN json_build_object('success', false, 'message', '该期已结算');
    END IF;
    IF p_num1 < 0 OR p_num1 > 9 OR p_num2 < 0 OR p_num2 > 9 OR p_num3 < 0 OR p_num3 > 9 THEN
        PERFORM set_config('app.pc28_settlement', 'false', false);
        RETURN json_build_object('success', false, 'message', '数字必须在0-9之间');
    END IF;

    v_sum := p_num1 + p_num2 + p_num3;
    v_result := json_build_object('num1', p_num1, 'num2', p_num2, 'num3', p_num3, 'sum', v_sum);
    v_is_special_case := (v_sum = 13 OR v_sum = 14);

    FOR v_bet IN
        SELECT b.*, r.anchor_id as room_anchor_id
        FROM public.pc28_bets b
        JOIN public.live_broadcast_rooms r ON r.id = b.room_id
        WHERE b.global_round_id = p_global_round_id AND b.status = 'pending'
        FOR UPDATE
    LOOP
        v_total_bet_amount := v_total_bet_amount + v_bet.amount;
        v_room_bet_totals := jsonb_set(
            v_room_bet_totals,
            ARRAY[v_bet.room_id::text],
            to_jsonb(COALESCE((v_room_bet_totals->>v_bet.room_id::text)::NUMERIC, 0) + v_bet.amount)
        );

        v_is_win := public.check_pc28_win(v_result, v_bet.bet_type, v_bet.bet_value);
        v_actual_odds := v_bet.odds;
        v_is_combination_refund := false;

        IF v_is_special_case AND v_is_win AND v_bet.bet_type IN ('big', 'small', 'odd', 'even') THEN
            v_actual_odds := 1.6;
        END IF;

        IF v_is_special_case AND v_bet.bet_type IN ('big_odd', 'big_even', 'small_odd', 'small_even') THEN
            IF v_bet.bet_type = 'big_odd' THEN v_is_win := (v_sum >= 14 AND v_sum % 2 = 1);
            ELSIF v_bet.bet_type = 'big_even' THEN v_is_win := (v_sum >= 14 AND v_sum % 2 = 0);
            ELSIF v_bet.bet_type = 'small_odd' THEN v_is_win := (v_sum <= 13 AND v_sum % 2 = 1);
            ELSIF v_bet.bet_type = 'small_even' THEN v_is_win := (v_sum <= 13 AND v_sum % 2 = 0);
            END IF;
            IF v_is_win THEN
                v_is_win := false;
                v_actual_odds := 1.0;
                v_is_combination_refund := true;
            ELSE
                v_is_win := false;
                v_is_combination_refund := false;
            END IF;
        END IF;

        IF v_is_win OR v_is_combination_refund THEN
            v_payout := v_bet.amount * v_actual_odds;
            IF v_is_win THEN
                v_user_profit := v_payout - v_bet.amount;
                v_platform_fee := GREATEST(v_user_profit * 0.01, 0);
                v_user_gain := v_payout - v_platform_fee;
                v_total_payout := v_total_payout + v_payout;
                v_total_platform_fee := v_total_platform_fee + v_platform_fee;
            ELSE
                v_user_gain := v_payout;
                v_platform_fee := 0;
            END IF;

            SELECT balance_coins INTO v_user_balance FROM public.profiles WHERE id = v_bet.user_id;
            UPDATE public.profiles SET balance_coins = balance_coins + v_user_gain WHERE id = v_bet.user_id
            RETURNING balance_coins INTO v_final_user_balance;
            IF v_final_user_balance IS NULL THEN
                PERFORM set_config('app.pc28_settlement', 'false', false);
                RAISE EXCEPTION '无法更新用户余额，用户ID: %', v_bet.user_id;
            END IF;

            IF v_is_win THEN
                INSERT INTO public.coin_transactions (user_id, amount, balance_after, type, description, related_id)
                VALUES (
                    v_bet.user_id, v_user_gain, v_final_user_balance, 'pc28_win',
                    format('PC28中奖 %s期 %s', v_round.period_number, public.format_pc28_bet_label(v_bet.bet_type, v_bet.bet_value)),
                    v_bet.id
                );
            ELSE
                INSERT INTO public.coin_transactions (user_id, amount, balance_after, type, description, related_id)
                VALUES (
                    v_bet.user_id, v_user_gain, v_final_user_balance, 'pc28_refund',
                    format('PC28组合回本 %s期 %s（13/14）', v_round.period_number, public.format_pc28_bet_label(v_bet.bet_type, v_bet.bet_value)),
                    v_bet.id
                );
            END IF;

            UPDATE public.pc28_bets SET status = 'settled', is_win = v_is_win, payout = v_payout,
                platform_fee = v_platform_fee, user_gain = v_user_gain, anchor_payout = 0, settled_at = now()
            WHERE id = v_bet.id;
        ELSE
            UPDATE public.pc28_bets SET status = 'settled', is_win = false, payout = 0,
                platform_fee = 0, user_gain = 0, anchor_payout = 0, settled_at = now()
            WHERE id = v_bet.id;
        END IF;
    END LOOP;

    FOR v_room_reward IN
        SELECT r.anchor_id, r.id as room_id, COALESCE((v_room_bet_totals->>r.id::text)::NUMERIC, 0) as room_total_bet
        FROM public.live_broadcast_rooms r
        WHERE (v_room_bet_totals->>r.id::text)::NUMERIC > 0
    LOOP
        v_anchor_payout := FLOOR(v_room_reward.room_total_bet * 0.01 * 100) / 100;
        IF v_room_reward.anchor_id IS NOT NULL AND v_anchor_payout > 0 THEN
            SELECT balance_coins INTO v_anchor_balance FROM public.profiles WHERE id = v_room_reward.anchor_id;
            UPDATE public.profiles SET balance_coins = balance_coins + v_anchor_payout WHERE id = v_room_reward.anchor_id
            RETURNING balance_coins INTO v_final_anchor_balance;
            IF v_final_anchor_balance IS NULL THEN
                PERFORM set_config('app.pc28_settlement', 'false', false);
                RAISE EXCEPTION '无法更新主播余额，主播ID: %', v_room_reward.anchor_id;
            END IF;
            INSERT INTO public.coin_transactions (user_id, amount, balance_after, type, description, related_id)
            VALUES (
                v_room_reward.anchor_id, v_anchor_payout, v_final_anchor_balance, 'pc28_anchor_reward',
                format('PC28主播奖励：%s期（房间下注总额的1%%）', v_round.period_number),
                v_room_reward.room_id
            );
        END IF;
    END LOOP;

    UPDATE public.pc28_global_rounds SET status = 'settled', result = v_result, settled_at = now(),
        total_bet_amount = v_total_bet_amount, total_payout = v_total_payout, total_platform_fee = v_total_platform_fee, updated_at = now()
    WHERE id = p_global_round_id;

    v_message_text := public.format_pc28_result(p_num1, p_num2, p_num3, v_sum);
    v_message_content := json_build_object(
        'type', 'round_settled', 'period_number', v_round.period_number, 'result', v_result,
        'text', format('PC28 %s期 已开奖：%s', v_round.period_number, v_message_text)
    );
    INSERT INTO public.live_broadcast_messages (room_id, msg_type, content)
    SELECT room_id, 'pc28', v_message_content::text FROM public.pc28_room_enabled WHERE enabled = true;

    PERFORM set_config('app.pc28_settlement', 'false', false);
    RETURN json_build_object('success', true, 'message', format('结算成功：%s期', v_round.period_number),
        'total_bet_amount', v_total_bet_amount, 'total_payout', v_total_payout, 'total_platform_fee', v_total_platform_fee);
EXCEPTION WHEN OTHERS THEN
    PERFORM set_config('app.pc28_settlement', 'false', false);
    RAISE;
END;
$$;

COMMENT ON FUNCTION public.settle_global_round IS '结算全局期数。流水 description 含期数+下注内容（大小单双等）。';
