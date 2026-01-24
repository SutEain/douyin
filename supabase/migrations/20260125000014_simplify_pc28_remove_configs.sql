-- 🎯 简化PC28：移除配置表，平台统一规则
-- 1. 删除pc28_game_configs表（不再需要每个直播间自定义规则）
-- 2. 删除upsert_pc28_game_config函数
-- 3. game_name固定为'PC28'
-- 4. 更新open_pc28_round函数，移除game_name参数

-- ============================================================================
-- 1. 删除配置相关的函数
-- ============================================================================
DROP FUNCTION IF EXISTS public.upsert_pc28_game_config(UUID, JSONB, BOOLEAN);
DROP FUNCTION IF EXISTS public.upsert_pc28_game_config(UUID, BOOLEAN, JSONB);

-- ============================================================================
-- 2. 更新open_pc28_round函数，移除game_name参数，固定为'PC28'
-- ============================================================================
CREATE OR REPLACE FUNCTION public.open_pc28_round(
    p_room_id UUID,
    p_period_number TEXT,
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
    
    -- 4. 创建期数记录（game_name固定为'PC28'）
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
        'PC28', -- 固定游戏名称
        'betting',
        p_seal_at
    ) RETURNING id INTO v_round_id;
    
    RETURN json_build_object(
        'success', true,
        'round_id', v_round_id,
        'message', '开盘成功'
    );
END;
$$;

-- ============================================================================
-- 3. 更新settle_pc28_round函数中的game_name引用
-- ============================================================================
-- 在settle_pc28_round函数中，game_name已经使用COALESCE(v_round.game_name, 'PC28')
-- 现在v_round.game_name总是'PC28'，所以这个逻辑仍然有效

-- ============================================================================
-- 4. 删除pc28_game_configs表（如果存在）
-- ============================================================================
-- 注意：由于可能有外键约束，先删除依赖的数据
-- 但为了安全，我们保留表结构，只是不再使用它
-- 如果确定要删除表，可以执行：
-- DROP TABLE IF EXISTS public.pc28_game_configs CASCADE;

-- ============================================================================
-- 5. 更新game_name字段的默认值（如果表已存在）
-- ============================================================================
-- 确保所有现有记录的game_name都是'PC28'
UPDATE public.pc28_game_rounds
SET game_name = 'PC28'
WHERE game_name IS NULL OR game_name != 'PC28';

-- 设置默认值为'PC28'
ALTER TABLE public.pc28_game_rounds
ALTER COLUMN game_name SET DEFAULT 'PC28';

-- 添加NOT NULL约束（如果还没有）
ALTER TABLE public.pc28_game_rounds
ALTER COLUMN game_name SET NOT NULL;

COMMENT ON COLUMN public.pc28_game_rounds.game_name IS '游戏名称，固定为PC28';
