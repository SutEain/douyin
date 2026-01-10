-- 🎯 红包按钮答题系统
-- 目标：用9个按钮选项替代回复消息，增加答错冷却机制，防止协议号批量点击

-- 1. 创建红包答题错误记录表（用于10秒冷却机制）
CREATE TABLE IF NOT EXISTS red_packet_wrong_attempts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  packet_id UUID NOT NULL REFERENCES group_red_packets(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  tg_user_id BIGINT NOT NULL,
  wrong_at TIMESTAMPTZ DEFAULT NOW(),
  can_retry_at TIMESTAMPTZ DEFAULT (NOW() + INTERVAL '10 seconds'),
  attempt_count INT DEFAULT 1,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(packet_id, user_id)
);

-- 索引优化
CREATE INDEX IF NOT EXISTS idx_wrong_attempts_retry 
ON red_packet_wrong_attempts(packet_id, user_id, can_retry_at);

CREATE INDEX IF NOT EXISTS idx_wrong_attempts_packet 
ON red_packet_wrong_attempts(packet_id, can_retry_at);

-- 2. 创建红包更新队列表（用于批量更新机制，避免TG API速率限制）
CREATE TABLE IF NOT EXISTS red_packet_update_queue (
  packet_id UUID PRIMARY KEY REFERENCES group_red_packets(id) ON DELETE CASCADE,
  needs_update BOOLEAN DEFAULT true,
  last_updated_at TIMESTAMPTZ DEFAULT NOW(),
  remaining_count INT NOT NULL,
  total_count INT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_update_queue_pending 
ON red_packet_update_queue(needs_update, last_updated_at) 
WHERE needs_update = true;

-- 3. 给 group_red_packets 表新增字段
ALTER TABLE group_red_packets
ADD COLUMN IF NOT EXISTS claimed_count INT DEFAULT 0,
ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS best_claim_id UUID REFERENCES group_red_packet_claims(id),
ADD COLUMN IF NOT EXISTS best_claim_amount DECIMAL(10,2) DEFAULT 0,
ADD COLUMN IF NOT EXISTS best_claim_user_id UUID REFERENCES profiles(id);

-- 初始化已有红包的 claimed_count（根据领取记录计算）
UPDATE group_red_packets
SET claimed_count = (
  SELECT COUNT(*) 
  FROM group_red_packet_claims 
  WHERE packet_id = group_red_packets.id
)
WHERE claimed_count = 0;

-- 4. 给 group_red_packet_claims 表新增字段
ALTER TABLE group_red_packet_claims
ADD COLUMN IF NOT EXISTS is_best_luck BOOLEAN DEFAULT false,
ADD COLUMN IF NOT EXISTS claimed_at TIMESTAMPTZ;

-- 初始化已有记录的 claimed_at（使用 created_at 的值）
UPDATE group_red_packet_claims
SET claimed_at = COALESCE(claimed_at, created_at)
WHERE claimed_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_claims_best_luck 
ON group_red_packet_claims(packet_id, is_best_luck) 
WHERE is_best_luck = true;

-- 5. 先删除旧函数，再创建新函数（因为返回类型变了）
DROP FUNCTION IF EXISTS claim_group_red_packet(UUID, UUID);

-- 创建新的 claim_group_red_packet 函数，支持手气最佳统计
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

  IF v_packet.status != 'active' THEN
    IF v_packet.status = 'completed' THEN
      RETURN QUERY SELECT false, '🎈 来晚了，红包已被抢光', 0::DECIMAL(10,2), false;
    ELSIF v_packet.status = 'expired' THEN
      RETURN QUERY SELECT false, '⏰ 红包已过期', 0::DECIMAL(10,2), false;
    ELSIF v_packet.status = 'refunded' THEN
      RETURN QUERY SELECT false, '💰 红包已退款', 0::DECIMAL(10,2), false;
    ELSE
      RETURN QUERY SELECT false, '❌ 红包状态异常', 0::DECIMAL(10,2), false;
    END IF;
    RETURN;
  END IF;

  -- 2. 检查是否已领取过
  SELECT * INTO v_existing_claim
  FROM group_red_packet_claims
  WHERE packet_id = p_packet_id AND user_id = p_user_id;

  IF FOUND THEN
    RETURN QUERY SELECT false, '🎁 您已经领过这个红包啦', v_existing_claim.amount, false;
    RETURN;
  END IF;

  -- 3. 检查是否是发送者（发送者不能领取自己的红包）
  v_sender_id := v_packet.sender_id;
  IF v_sender_id = p_user_id THEN
    RETURN QUERY SELECT false, '😅 不能领取自己发的红包哦', 0::DECIMAL(10,2), false;
    RETURN;
  END IF;

  -- 3.1 🎯 专属红包权限检查（只有指定用户可以领取）
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

  -- 7. 更新用户余额
  UPDATE profiles
  SET balance_coins = balance_coins + v_claim_amount
  WHERE id = p_user_id;

  -- 8. 更新红包剩余信息
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

  -- 9. 🎯 更新手气最佳（拼手气红包才有）
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

  -- 10. 返回成功
  RETURN QUERY SELECT true, '领取成功', v_claim_amount, v_is_best;
END;
$$ LANGUAGE plpgsql;

-- 6. 创建清理过期冷却记录的函数（定期清理，节省空间）
CREATE OR REPLACE FUNCTION cleanup_expired_wrong_attempts()
RETURNS void AS $$
BEGIN
  DELETE FROM red_packet_wrong_attempts
  WHERE can_retry_at < NOW() - INTERVAL '1 hour';
END;
$$ LANGUAGE plpgsql;

-- 7. 创建批量获取需要更新的红包函数
CREATE OR REPLACE FUNCTION get_red_packets_need_update(p_limit INT DEFAULT 10)
RETURNS TABLE(
  packet_id UUID,
  group_id BIGINT,
  origin_message_id INT,
  last_updated_at TIMESTAMPTZ
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    q.packet_id,
    p.group_id,
    p.origin_message_id,
    q.last_updated_at
  FROM red_packet_update_queue q
  JOIN group_red_packets p ON q.packet_id = p.id
  WHERE q.needs_update = true
    AND q.last_updated_at < NOW() - INTERVAL '5 seconds'
    AND p.origin_message_id IS NOT NULL
  ORDER BY q.last_updated_at ASC
  LIMIT p_limit;
END;
$$ LANGUAGE plpgsql;

-- 8. 注释说明
COMMENT ON TABLE red_packet_wrong_attempts IS '红包答题错误记录表，用于实现10秒冷却机制';
COMMENT ON TABLE red_packet_update_queue IS '红包更新队列表，用于批量更新机制，避免TG API速率限制';
COMMENT ON COLUMN group_red_packets.claimed_count IS '已领取的红包数量';
COMMENT ON COLUMN group_red_packets.completed_at IS '红包领取完成的时间';
COMMENT ON COLUMN group_red_packets.best_claim_amount IS '手气最佳的金额（拼手气红包）';
COMMENT ON COLUMN group_red_packets.best_claim_user_id IS '手气最佳的用户ID';
COMMENT ON COLUMN group_red_packet_claims.is_best_luck IS '是否是手气最佳';
COMMENT ON COLUMN group_red_packet_claims.claimed_at IS '领取时间（等同于 created_at）';
COMMENT ON FUNCTION claim_group_red_packet IS '领取群红包，支持手气最佳统计';
COMMENT ON FUNCTION get_red_packets_need_update IS '获取需要更新的红包列表（批量更新机制）';


