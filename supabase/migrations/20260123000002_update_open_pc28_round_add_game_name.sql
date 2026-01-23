-- 更新 open_pc28_round 函数，添加游戏名称参数

CREATE OR REPLACE FUNCTION public.open_pc28_round(
    p_room_id UUID,
    p_period_number TEXT,
    p_game_name TEXT DEFAULT 'PC28',
    p_seal_at TIMESTAMP WITH TIME ZONE DEFAULT NULL::TIMESTAMP WITH TIME ZONE
) RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_room RECORD;
    v_anchor_balance NUMERIC;
    v_round_id UUID;
BEGIN
    -- 1. 验证房间存在且用户是主播
    SELECT r.* INTO v_room
    FROM public.live_broadcast_rooms r
    WHERE r.id = p_room_id;
    
    IF v_room IS NULL THEN
        RETURN json_build_object('success', false, 'message', '直播间不存在');
    END IF;
    
    IF v_room.anchor_id != auth.uid() THEN
        RETURN json_build_object('success', false, 'message', '只有主播可以开盘');
    END IF;
    
    -- 2. 检查主播余额（必须>=5000）
    SELECT balance_coins INTO v_anchor_balance
    FROM public.profiles
    WHERE id = v_room.anchor_id;
    
    IF v_anchor_balance IS NULL OR v_anchor_balance < 5000 THEN
        RETURN json_build_object('success', false, 'message', '主播余额不足5000，无法开盘');
    END IF;
    
    -- 3. 检查是否已有该期号的记录
    IF EXISTS (
        SELECT 1 FROM public.pc28_game_rounds
        WHERE room_id = p_room_id AND period_number = p_period_number
    ) THEN
        RETURN json_build_object('success', false, 'message', '该期号已存在');
    END IF;
    
    -- 4. 创建期数记录（包含游戏名称）
    INSERT INTO public.pc28_game_rounds (
        room_id,
        anchor_id,
        period_number,
        game_name,
        status,
        seal_at
    ) VALUES (
        p_room_id,
        v_room.anchor_id,
        p_period_number,
        COALESCE(p_game_name, 'PC28'),
        'betting',
        p_seal_at
    ) RETURNING id INTO v_round_id;
    
    -- 5. 推送开盘消息到直播间
    INSERT INTO public.live_broadcast_messages (
        room_id,
        user_id,
        content,
        msg_type
    ) VALUES (
        p_room_id,
        v_room.anchor_id,
        json_build_object(
            'text', p_game_name || ' ' || p_period_number || '期 已开盘',
            'game_name', p_game_name,
            'period_number', p_period_number
        )::text,
        'pc28'
    );
    
    RETURN json_build_object(
        'success', true,
        'round_id', v_round_id,
        'message', '开盘成功'
    );
END;
$$;

-- 重新授权
GRANT EXECUTE ON FUNCTION public.open_pc28_round(UUID, TEXT, TEXT, TIMESTAMP WITH TIME ZONE) TO authenticated;
