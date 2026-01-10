-- 🎯 修复红包领取函数缺少资金流水记录的问题
-- 问题：claim_group_red_packet 函数更新余额后没有记录 coin_transactions
-- 影响：用户资金流水不完整，无法追溯资金变化过程

CREATE OR REPLACE FUNCTION claim_group_red_packet(
  p_packet_id UUID,
  p_user_id UUID
)
RETURNS TABLE(
  success BOOLEAN,
  message TEXT,
  amount DECIMAL(10,2),
  is_best_luck BOOLEAN
) AS $$
DECLARE
  v_packet RECORD;
  v_claim_amount DECIMAL(10,2);
  v_sender_id UUID;
  v_existing_claim RECORD;
  v_is_best BOOLEAN := false;
  v_balance_after DECIMAL(12,2); -- 🎯 新增：记录变动后余额
BEGIN
  -- 1. 检查红包是否存在且有效
  SELECT * INTO v_packet
  FROM group_red_packets
  WHERE id = p_packet_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN QUERY SELECT false, '红包不存在', 0::DECIMAL(10,2), false;
    RETURN;
  END IF;

  -- 2. 检查红包状态
  IF v_packet.status <> 'active' THEN
    RETURN QUERY SELECT false, '红包已失效或已结束', 0::DECIMAL(10,2), false;
    RETURN;
  END IF;

  -- 3. 检查是否已经领过
  SELECT * INTO v_existing_claim
  FROM group_red_packet_claims
  WHERE packet_id = p_packet_id AND user_id = p_user_id;

  IF FOUND THEN
    RETURN QUERY SELECT false, '你已经领过这个红包了', 0::DECIMAL(10,2), false;
    RETURN;
  END IF;

  -- 3.1 🎯 检查是否是发送者（发送者不能领取自己的红包）
  v_sender_id := v_packet.sender_id;
  IF v_sender_id = p_user_id THEN
    RETURN QUERY SELECT false, '😅 不能领取自己发的红包哦', 0::DECIMAL(10,2), false;
    RETURN;
  END IF;

  -- 3.2 🎯 专属红包权限检查（只有指定用户可以领取）
  IF v_packet.type = 'single' AND v_packet.target_user_id IS NOT NULL AND v_packet.target_user_id <> p_user_id THEN
    RETURN QUERY SELECT false, '❌ 这是给别人的专属红包哦', 0::DECIMAL(10,2), false;
    RETURN;
  END IF;

  -- 4. 检查剩余数量
  IF v_packet.remaining_count <= 0 THEN
    -- 更新状态为已抢完
    UPDATE group_red_packets
    SET status = 'completed', completed_at = NOW()
    WHERE id = p_packet_id;
    
    RETURN QUERY SELECT false, '🎈 来晚了，红包已被抢光', 0::DECIMAL(10,2), false;
    RETURN;
  END IF;

  -- 5. 计算金额
  IF v_packet.type = 'lucky' THEN
    -- 拼手气红包：随机金额
    IF v_packet.remaining_count = 1 THEN
      -- 最后一个，给剩余全部金额
      v_claim_amount := v_packet.remaining_amount;
    ELSE
      -- 随机金额：剩余金额的 1% ~ 剩余平均值的2倍之间
      DECLARE
        v_min_amount DECIMAL(10,2);
        v_max_amount DECIMAL(10,2);
        v_avg_amount DECIMAL(10,2);
      BEGIN
        v_avg_amount := v_packet.remaining_amount / v_packet.remaining_count;
        v_min_amount := GREATEST(0.01, v_packet.remaining_amount * 0.01);
        v_max_amount := LEAST(v_packet.remaining_amount - (v_packet.remaining_count - 1) * 0.01, v_avg_amount * 2);
        v_claim_amount := v_min_amount + (random() * (v_max_amount - v_min_amount));
        v_claim_amount := ROUND(v_claim_amount, 2);
      END;
    END IF;
  ELSE
    -- 普通红包/专属红包：平均分配
    v_claim_amount := ROUND(v_packet.remaining_amount / v_packet.remaining_count, 2);
  END IF;

  -- 确保金额为正
  IF v_claim_amount <= 0 THEN
    v_claim_amount := 0.01;
  END IF;

  -- 确保不超过剩余金额
  IF v_claim_amount > v_packet.remaining_amount THEN
    v_claim_amount := v_packet.remaining_amount;
  END IF;

  -- 6. 创建领取记录
  INSERT INTO group_red_packet_claims (packet_id, user_id, amount, claimed_at)
  VALUES (p_packet_id, p_user_id, v_claim_amount, NOW());

  -- 7. 更新用户余额（🎯 修复：记录变动后余额）
  UPDATE profiles
  SET balance_coins = balance_coins + v_claim_amount
  WHERE id = p_user_id
  RETURNING balance_coins INTO v_balance_after;

  -- 🎯 8. 记录资金流水（修复缺失的流水记录）
  INSERT INTO public.coin_transactions (
    user_id, 
    amount, 
    balance_after, 
    type, 
    description, 
    related_id
  )
  VALUES (
    p_user_id, 
    v_claim_amount, 
    v_balance_after, 
    'hb_in', 
    '群红包领取: 来自 ' || COALESCE((SELECT nickname FROM profiles WHERE id = v_packet.sender_id), '未知用户'), 
    p_packet_id
  );

  -- 9. 更新红包剩余信息
  UPDATE group_red_packets
  SET 
    remaining_count = remaining_count - 1,
    remaining_amount = remaining_amount - v_claim_amount,
    claimed_count = claimed_count + 1,
    status = CASE 
      WHEN remaining_count - 1 <= 0 THEN 'completed'
      ELSE status
    END,
    completed_at = CASE 
      WHEN remaining_count - 1 <= 0 THEN NOW()
      ELSE completed_at
    END
  WHERE id = p_packet_id;

  -- 10. 🎯 更新手气最佳（拼手气红包才有）
  IF v_packet.type = 'lucky' THEN
    -- 检查是否是当前最大金额
    IF v_claim_amount > COALESCE(v_packet.best_claim_amount, 0) THEN
      v_is_best := true;
      
      -- 先清除之前的"手气最佳"标记
      UPDATE group_red_packet_claims AS claims
      SET is_best_luck = false
      WHERE claims.packet_id = p_packet_id AND claims.is_best_luck = true;
      
      -- 标记当前为手气最佳
      UPDATE group_red_packet_claims AS claims
      SET is_best_luck = true
      WHERE claims.packet_id = p_packet_id AND claims.user_id = p_user_id;
      
      -- 更新红包表的最佳记录
      UPDATE group_red_packets
      SET 
        best_claim_amount = v_claim_amount,
        best_claim_user_id = p_user_id
      WHERE id = p_packet_id;
    END IF;
  END IF;

  -- 11. 返回成功
  RETURN QUERY SELECT true, '领取成功', v_claim_amount, v_is_best;
END;
$$ LANGUAGE plpgsql;

-- 添加注释说明修复内容
COMMENT ON FUNCTION claim_group_red_packet IS '领取群红包，支持手气最佳统计。已修复：添加资金流水记录，确保所有余额变动都有完整记录';

