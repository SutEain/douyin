-- 修复 upsert_pc28_game_config 函数重载歧义问题
-- 删除所有现有版本，创建唯一版本

-- 删除所有可能存在的 upsert_pc28_game_config 函数版本
DROP FUNCTION IF EXISTS public.upsert_pc28_game_config(UUID, JSONB, BOOLEAN);
DROP FUNCTION IF EXISTS public.upsert_pc28_game_config(UUID, BOOLEAN, JSONB);

-- 创建唯一的 upsert_pc28_game_config 函数
-- 参数顺序：p_room_id, p_game_settings, p_is_enabled（与前端调用一致）
CREATE OR REPLACE FUNCTION public.upsert_pc28_game_config(
    p_room_id UUID,
    p_game_settings JSONB DEFAULT NULL,
    p_is_enabled BOOLEAN DEFAULT NULL
) RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_room RECORD;
    v_config_id UUID;
    v_existing_config RECORD;
BEGIN
    -- 1. 验证房间存在且用户是主播
    SELECT r.* INTO v_room
    FROM public.live_broadcast_rooms r
    WHERE r.id = p_room_id;
    
    IF v_room IS NULL THEN
        RETURN json_build_object('success', false, 'message', '直播间不存在');
    END IF;
    
    IF v_room.anchor_id != auth.uid() THEN
        RETURN json_build_object('success', false, 'message', '只有主播可以配置游戏');
    END IF;
    
    -- 2. 检查是否已存在配置
    SELECT * INTO v_existing_config
    FROM public.pc28_game_configs
    WHERE room_id = p_room_id;
    
    -- 3. 创建或更新配置
    IF v_existing_config IS NULL THEN
        -- 创建新配置
        INSERT INTO public.pc28_game_configs (
            room_id,
            anchor_id,
            is_enabled,
            game_settings
        ) VALUES (
            p_room_id,
            v_room.anchor_id,
            COALESCE(p_is_enabled, false),
            COALESCE(p_game_settings, '{}'::jsonb)
        ) RETURNING id INTO v_config_id;
    ELSE
        -- 更新现有配置
        UPDATE public.pc28_game_configs SET
            is_enabled = COALESCE(p_is_enabled, v_existing_config.is_enabled),
            game_settings = COALESCE(p_game_settings, v_existing_config.game_settings),
            updated_at = now()
        WHERE room_id = p_room_id
        RETURNING id INTO v_config_id;
    END IF;
    
    RETURN json_build_object(
        'success', true,
        'message', '配置保存成功',
        'config_id', v_config_id
    );
END;
$$;

-- 授权
GRANT EXECUTE ON FUNCTION public.upsert_pc28_game_config(UUID, JSONB, BOOLEAN) TO authenticated;
