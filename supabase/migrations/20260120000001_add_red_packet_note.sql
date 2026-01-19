-- 🎯 添加红包备注字段，用于记录专属红包发给谁
-- 目标：专属红包自动记录接收者信息到备注，方便查询和追溯

-- 1. 添加备注字段
ALTER TABLE public.group_red_packets
ADD COLUMN IF NOT EXISTS note TEXT;

-- 2. 添加注释
COMMENT ON COLUMN public.group_red_packets.note IS '红包备注，专属红包自动记录接收者信息（格式：发给 @昵称(ID:xxx)）';

-- 3. 删除并重新创建红包创建函数（添加备注参数，专属红包自动记录接收者信息）
-- 删除所有旧版本的函数
DROP FUNCTION IF EXISTS public.create_group_red_packet(UUID, BIGINT, TEXT, NUMERIC, INT, UUID);
DROP FUNCTION IF EXISTS public.create_group_red_packet(UUID, BIGINT, TEXT, NUMERIC, INT, UUID, TEXT, TEXT);

CREATE OR REPLACE FUNCTION public.create_group_red_packet(
    p_sender_id UUID,
    p_group_id BIGINT,
    p_type TEXT,
    p_total_amount NUMERIC,
    p_total_count INT,
    p_target_user_id UUID DEFAULT NULL,
    p_verification_answer TEXT DEFAULT NULL,
    p_verification_question TEXT DEFAULT NULL,
    p_note TEXT DEFAULT NULL
) RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_current_balance NUMERIC;
    v_final_balance NUMERIC;
    v_packet_id UUID;
    v_target_nickname TEXT;
    v_target_numeric_id INT;
    v_final_note TEXT;
BEGIN
    -- 0. 权限检查：允许 service_role 或用户自己调用
    IF auth.role() != 'service_role' AND p_sender_id != auth.uid() THEN
        RETURN json_build_object('success', false, 'message', '非法操作');
    END IF;

    -- 1. 最小金额限制 (平均每份至少 1 抖币)
    IF (p_total_amount / p_total_count) < 1 THEN
        RETURN json_build_object('success', false, 'message', '发红包失败：平均每份红包金额不能低于 1 抖币');
    END IF;

    -- 2. 锁定并检查余额
    SELECT balance_coins INTO v_current_balance FROM public.profiles WHERE id = p_sender_id FOR UPDATE;
    IF v_current_balance < p_total_amount THEN
        RETURN json_build_object('success', false, 'message', '余额不足');
    END IF;

    -- 3. 扣除余额
    UPDATE public.profiles 
    SET balance_coins = balance_coins - p_total_amount 
    WHERE id = p_sender_id 
    RETURNING balance_coins INTO v_final_balance;

    -- 4. 🎯 处理备注：专属红包自动记录接收者信息
    IF p_type = 'single' AND p_target_user_id IS NOT NULL THEN
        -- 查询接收者信息
        SELECT nickname, numeric_id INTO v_target_nickname, v_target_numeric_id
        FROM public.profiles
        WHERE id = p_target_user_id;
        
        -- 如果传入了备注，则使用传入的备注；否则自动生成
        IF p_note IS NOT NULL AND p_note != '' THEN
            v_final_note := p_note;
        ELSE
            -- 自动生成备注：发给 @昵称(ID:xxx)
            v_final_note := '发给 @' || COALESCE(v_target_nickname, '未知') || 
                           '(ID:' || COALESCE(v_target_numeric_id::TEXT, '未知') || ')';
        END IF;
    ELSE
        -- 非专属红包，使用传入的备注（如果有）
        v_final_note := p_note;
    END IF;

    -- 5. 创建红包记录（包含备注）
    INSERT INTO public.group_red_packets (
        sender_id, group_id, type, total_amount, total_count, 
        remaining_amount, remaining_count, target_user_id,
        verification_answer, verification_question, note
    ) VALUES (
        p_sender_id, p_group_id, p_type, p_total_amount, p_total_count,
        p_total_amount, p_total_count, p_target_user_id,
        p_verification_answer, p_verification_question, v_final_note
    ) RETURNING id INTO v_packet_id;

    -- 6. 记录流水（专属红包在描述中包含接收者信息）
    INSERT INTO public.coin_transactions (user_id, amount, balance_after, type, description, related_id)
    VALUES (
        p_sender_id, -p_total_amount, v_final_balance, 'hb_out', 
        CASE 
            WHEN p_type = 'single' AND v_final_note IS NOT NULL THEN
                '群红包发出: ' || p_type || ' (' || p_total_count || '份) - ' || v_final_note
            ELSE
                '群红包发出: ' || p_type || ' (' || p_total_count || '份)'
        END,
        v_packet_id
    );

    RETURN json_build_object('success', true, 'packet_id', v_packet_id, 'balance_after', v_final_balance);
END;
$$;

-- 4. 🎯 补救历史数据：为已有的专属红包更新备注
-- 通过 target_user_id 和领取记录来更新备注
UPDATE public.group_red_packets rp
SET note = '发给 @' || COALESCE(p.nickname, '未知') || 
           '(ID:' || COALESCE(p.numeric_id::TEXT, '未知') || ')'
FROM public.profiles p
WHERE rp.type = 'single' 
  AND rp.target_user_id IS NOT NULL
  AND rp.target_user_id = p.id
  AND (rp.note IS NULL OR rp.note = '');

-- 5. 添加索引（如果需要通过备注查询）
CREATE INDEX IF NOT EXISTS idx_group_red_packets_note 
ON public.group_red_packets(note) 
WHERE note IS NOT NULL;

COMMENT ON FUNCTION public.create_group_red_packet IS '创建群红包，专属红包自动记录接收者信息到备注';
