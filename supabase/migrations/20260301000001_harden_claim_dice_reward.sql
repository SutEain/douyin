-- 🎯 防止骰子奖励异常金额（如 1000万、1亿）：对 claim_dice_reward 做金额上限与幂等校验
-- 主流程已改为只用 settle_dice_room，此函数仅保留给兼容/备用，必须校验

CREATE OR REPLACE FUNCTION public.claim_dice_reward(
    p_user_id UUID,
    p_amount NUMERIC,
    p_room_id UUID
) RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_room RECORD;
    v_max_prize NUMERIC;
    v_final_balance NUMERIC;
BEGIN
    -- 1. 房间必须存在且为 waiting 或 rolling（未结算）
    SELECT * INTO v_room
    FROM public.dice_rooms
    WHERE id = p_room_id FOR UPDATE;

    IF NOT FOUND THEN
        RETURN json_build_object('success', false, 'message', '房间不存在');
    END IF;

    IF v_room.status NOT IN ('waiting', 'rolling') THEN
        RETURN json_build_object('success', false, 'message', '房间已结算或已取消，无法发放奖励');
    END IF;

    -- 2. 金额上限：单笔奖励不能超过「本金×人数」（防止传入余额等异常大数）
    v_max_prize := v_room.bet_amount * v_room.target_count;
    IF p_amount IS NULL OR p_amount <= 0 THEN
        RETURN json_build_object('success', false, 'message', '奖励金额必须大于 0');
    END IF;
    IF p_amount > v_max_prize THEN
        RETURN json_build_object('success', false, 'message', format('奖励金额不得超过本局奖金池 %s', v_max_prize));
    END IF;

    -- 3. 幂等：该用户在本房间未已标记为赢家
    IF EXISTS (
        SELECT 1 FROM public.dice_room_players
        WHERE room_id = p_room_id AND user_id = p_user_id AND is_winner = TRUE
    ) THEN
        RETURN json_build_object('success', false, 'message', '该用户已领取过本局奖励');
    END IF;

    -- 4. 必须是本房间玩家
    IF NOT EXISTS (
        SELECT 1 FROM public.dice_room_players
        WHERE room_id = p_room_id AND user_id = p_user_id
    ) THEN
        RETURN json_build_object('success', false, 'message', '该用户未参与本局');
    END IF;

    -- 5. 发奖
    UPDATE public.profiles
    SET balance_coins = balance_coins + p_amount
    WHERE id = p_user_id
    RETURNING balance_coins INTO v_final_balance;

    INSERT INTO public.coin_transactions (user_id, amount, balance_after, type, description, related_id)
    VALUES (p_user_id, p_amount, v_final_balance, 'dice_reward', '骰子赢家奖励: 房ID ' || p_room_id, p_room_id);

    UPDATE public.dice_room_players
    SET is_winner = TRUE
    WHERE room_id = p_room_id AND user_id = p_user_id;

    RETURN json_build_object('success', true, 'final_balance', v_final_balance);
END;
$$;

COMMENT ON FUNCTION public.claim_dice_reward(UUID, NUMERIC, UUID) IS '骰子赢家发奖（备用）；已做金额上限与幂等校验，推荐统一使用 settle_dice_room';
