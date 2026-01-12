-- 石头剪刀布游戏表
CREATE TABLE IF NOT EXISTS public.rps_rooms (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  owner_id UUID NOT NULL REFERENCES profiles(id),
  opponent_id UUID REFERENCES profiles(id),
  group_id BIGINT NOT NULL,
  bet_amount DECIMAL NOT NULL CHECK (bet_amount >= 5 AND bet_amount <= 10000),
  owner_choice TEXT CHECK (owner_choice IN ('rock', 'paper', 'scissors')),
  opponent_choice TEXT CHECK (opponent_choice IN ('rock', 'paper', 'scissors')),
  winner_id UUID REFERENCES profiles(id),
  status TEXT DEFAULT 'waiting' CHECK (status IN ('waiting', 'playing', 'finished', 'cancelled')),
  total_prize DECIMAL,
  message_id BIGINT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  finished_at TIMESTAMPTZ
);

-- 索引优化
CREATE INDEX IF NOT EXISTS idx_rps_rooms_group_status ON rps_rooms(group_id, status);
CREATE INDEX IF NOT EXISTS idx_rps_rooms_owner ON rps_rooms(owner_id);
CREATE INDEX IF NOT EXISTS idx_rps_rooms_created_at ON rps_rooms(created_at DESC);

-- RLS 策略
ALTER TABLE public.rps_rooms ENABLE ROW LEVEL SECURITY;

CREATE POLICY "允许所有人查看猜拳房间" ON public.rps_rooms
  FOR SELECT USING (true);

CREATE POLICY "允许系统角色操作猜拳房间" ON public.rps_rooms
  FOR ALL USING (auth.role() = 'service_role');

-- 创建猜拳房间
CREATE OR REPLACE FUNCTION public.create_rps_room(
  p_owner_id UUID,
  p_group_id BIGINT,
  p_bet_amount DECIMAL
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_owner_balance DECIMAL;
  v_room_id UUID;
  v_active_room_count INT;
BEGIN
  -- 1. 检查金额范围
  IF p_bet_amount < 5 OR p_bet_amount > 10000 THEN
    RETURN json_build_object('success', false, 'message', '单局投注金额限制为 5 - 10000 抖币');
  END IF;

  -- 2. 检查该群是否已有进行中的猜拳游戏
  SELECT COUNT(*) INTO v_active_room_count
  FROM rps_rooms
  WHERE group_id = p_group_id
    AND status IN ('waiting', 'playing');

  IF v_active_room_count > 0 THEN
    RETURN json_build_object('success', false, 'message', '本群已有进行中的猜拳游戏，请等待结束后再开新局');
  END IF;

  -- 3. 检查余额
  SELECT balance_coins INTO v_owner_balance
  FROM profiles
  WHERE id = p_owner_id
  FOR UPDATE;

  IF v_owner_balance < p_bet_amount THEN
    RETURN json_build_object('success', false, 'message', '余额不足，当前余额: ' || v_owner_balance || ' 抖币');
  END IF;

  -- 4. 扣除本金
  UPDATE profiles
  SET balance_coins = balance_coins - p_bet_amount,
      updated_at = NOW()
  WHERE id = p_owner_id;

  -- 5. 创建房间
  INSERT INTO rps_rooms (owner_id, group_id, bet_amount, status)
  VALUES (p_owner_id, p_group_id, p_bet_amount, 'waiting')
  RETURNING id INTO v_room_id;

  RETURN json_build_object(
    'success', true,
    'room_id', v_room_id,
    'message', '房间创建成功'
  );
END;
$$;

-- 加入猜拳房间
CREATE OR REPLACE FUNCTION public.join_rps_room(
  p_room_id UUID,
  p_user_id UUID
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_room RECORD;
  v_user_balance DECIMAL;
BEGIN
  -- 1. 获取房间信息
  SELECT * INTO v_room
  FROM rps_rooms
  WHERE id = p_room_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN json_build_object('success', false, 'message', '房间不存在');
  END IF;

  IF v_room.status != 'waiting' THEN
    RETURN json_build_object('success', false, 'message', '游戏已开始或已结束');
  END IF;

  -- 2. 检查是否是房主自己
  IF v_room.owner_id = p_user_id THEN
    RETURN json_build_object('success', false, 'message', '不能和自己玩');
  END IF;

  -- 3. 检查是否已满员
  IF v_room.opponent_id IS NOT NULL THEN
    RETURN json_build_object('success', false, 'message', '房间已满，请等待下一局');
  END IF;

  -- 4. 检查余额
  SELECT balance_coins INTO v_user_balance
  FROM profiles
  WHERE id = p_user_id
  FOR UPDATE;

  IF v_user_balance < v_room.bet_amount THEN
    RETURN json_build_object('success', false, 'message', '余额不足，当前余额: ' || v_user_balance || ' 抖币');
  END IF;

  -- 5. 扣除本金
  UPDATE profiles
  SET balance_coins = balance_coins - v_room.bet_amount,
      updated_at = NOW()
  WHERE id = p_user_id;

  -- 6. 加入房间
  UPDATE rps_rooms
  SET opponent_id = p_user_id,
      status = 'playing'
  WHERE id = p_room_id;

  RETURN json_build_object(
    'success', true,
    'message', '成功加入游戏'
  );
END;
$$;

-- 保存出手选择
CREATE OR REPLACE FUNCTION public.save_rps_choice(
  p_room_id UUID,
  p_user_id UUID,
  p_choice TEXT
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_room RECORD;
  v_is_owner BOOLEAN;
  v_both_chosen BOOLEAN := false;
BEGIN
  -- 1. 获取房间信息
  SELECT * INTO v_room
  FROM rps_rooms
  WHERE id = p_room_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN json_build_object('success', false, 'message', '房间不存在');
  END IF;

  IF v_room.status != 'playing' THEN
    RETURN json_build_object('success', false, 'message', '游戏未开始或已结束');
  END IF;

  -- 2. 验证玩家身份
  IF v_room.owner_id = p_user_id THEN
    v_is_owner := true;
  ELSIF v_room.opponent_id = p_user_id THEN
    v_is_owner := false;
  ELSE
    RETURN json_build_object('success', false, 'message', '你不是对局玩家');
  END IF;

  -- 3. 检查是否已出手（防止更改）
  IF v_is_owner AND v_room.owner_choice IS NOT NULL THEN
    RETURN json_build_object('success', false, 'message', '你已经出过手了，不能更改！');
  END IF;

  IF NOT v_is_owner AND v_room.opponent_choice IS NOT NULL THEN
    RETURN json_build_object('success', false, 'message', '你已经出过手了，不能更改！');
  END IF;

  -- 4. 保存选择
  IF v_is_owner THEN
    UPDATE rps_rooms
    SET owner_choice = p_choice
    WHERE id = p_room_id;
    
    -- 检查对手是否已出手
    v_both_chosen := v_room.opponent_choice IS NOT NULL;
  ELSE
    UPDATE rps_rooms
    SET opponent_choice = p_choice
    WHERE id = p_room_id;
    
    -- 检查房主是否已出手
    v_both_chosen := v_room.owner_choice IS NOT NULL;
  END IF;

  RETURN json_build_object(
    'success', true,
    'message', '出手成功',
    'both_chosen', v_both_chosen
  );
END;
$$;

-- 结算猜拳游戏
CREATE OR REPLACE FUNCTION public.settle_rps_room(
  p_room_id UUID
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_room RECORD;
  v_result TEXT; -- 'owner_win', 'opponent_win', 'draw'
  v_total_prize DECIMAL;
  v_commission DECIMAL;
  v_winner_prize DECIMAL;
BEGIN
  -- 1. 获取房间信息
  SELECT * INTO v_room
  FROM rps_rooms
  WHERE id = p_room_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN json_build_object('success', false, 'message', '房间不存在');
  END IF;

  IF v_room.owner_choice IS NULL OR v_room.opponent_choice IS NULL THEN
    RETURN json_build_object('success', false, 'message', '双方尚未出手');
  END IF;

  -- 2. 判断胜负
  IF v_room.owner_choice = v_room.opponent_choice THEN
    v_result := 'draw';
  ELSIF (v_room.owner_choice = 'rock' AND v_room.opponent_choice = 'scissors')
     OR (v_room.owner_choice = 'scissors' AND v_room.opponent_choice = 'paper')
     OR (v_room.owner_choice = 'paper' AND v_room.opponent_choice = 'rock') THEN
    v_result := 'owner_win';
  ELSE
    v_result := 'opponent_win';
  END IF;

  v_total_prize := v_room.bet_amount * 2;

  -- 3. 结算
  IF v_result = 'draw' THEN
    -- 平局：退回本金，不抽水
    UPDATE profiles
    SET balance_coins = balance_coins + v_room.bet_amount,
        updated_at = NOW()
    WHERE id = v_room.owner_id;

    UPDATE profiles
    SET balance_coins = balance_coins + v_room.bet_amount,
        updated_at = NOW()
    WHERE id = v_room.opponent_id;

    -- 更新房间状态
    UPDATE rps_rooms
    SET status = 'finished',
        total_prize = v_total_prize,
        finished_at = NOW()
    WHERE id = p_room_id;

    RETURN json_build_object(
      'success', true,
      'result', 'draw',
      'message', '平局，本金已退回'
    );

  ELSE
    -- 有赢家：抽水 2%
    v_commission := TRUNC(v_total_prize * 0.02, 2);
    v_winner_prize := v_total_prize - v_commission;

    IF v_result = 'owner_win' THEN
      UPDATE profiles
      SET balance_coins = balance_coins + v_winner_prize,
          updated_at = NOW()
      WHERE id = v_room.owner_id;

      UPDATE rps_rooms
      SET status = 'finished',
          winner_id = v_room.owner_id,
          total_prize = v_total_prize,
          finished_at = NOW()
      WHERE id = p_room_id;

      RETURN json_build_object(
        'success', true,
        'result', 'owner_win',
        'winner_id', v_room.owner_id,
        'winner_prize', TRUNC(v_winner_prize, 2),
        'commission', v_commission,
        'message', '房主获胜'
      );

    ELSE
      UPDATE profiles
      SET balance_coins = balance_coins + v_winner_prize,
          updated_at = NOW()
      WHERE id = v_room.opponent_id;

      UPDATE rps_rooms
      SET status = 'finished',
          winner_id = v_room.opponent_id,
          total_prize = v_total_prize,
          finished_at = NOW()
      WHERE id = p_room_id;

      RETURN json_build_object(
        'success', true,
        'result', 'opponent_win',
        'winner_id', v_room.opponent_id,
        'winner_prize', TRUNC(v_winner_prize, 2),
        'commission', v_commission,
        'message', '挑战者获胜'
      );
    END IF;
  END IF;
END;
$$;

-- 取消猜拳房间（仅房主）
CREATE OR REPLACE FUNCTION public.cancel_rps_room(
  p_room_id UUID,
  p_user_id UUID
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_room RECORD;
BEGIN
  SELECT * INTO v_room
  FROM rps_rooms
  WHERE id = p_room_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN json_build_object('success', false, 'message', '房间不存在');
  END IF;

  IF v_room.owner_id != p_user_id THEN
    RETURN json_build_object('success', false, 'message', '只有房主才能取消');
  END IF;

  IF v_room.status != 'waiting' THEN
    RETURN json_build_object('success', false, 'message', '游戏已开始，无法取消');
  END IF;

  -- 退回房主本金
  UPDATE profiles
  SET balance_coins = balance_coins + v_room.bet_amount,
      updated_at = NOW()
  WHERE id = v_room.owner_id;

  -- 标记为已取消
  UPDATE rps_rooms
  SET status = 'cancelled',
      finished_at = NOW()
  WHERE id = p_room_id;

  RETURN json_build_object(
    'success', true,
    'message', '房间已取消，本金已退回'
  );
END;
$$;

-- 授予权限
GRANT SELECT ON public.rps_rooms TO anon;
GRANT SELECT ON public.rps_rooms TO authenticated;
GRANT ALL ON public.rps_rooms TO service_role;

GRANT EXECUTE ON FUNCTION public.create_rps_room(UUID, BIGINT, DECIMAL) TO service_role;
GRANT EXECUTE ON FUNCTION public.join_rps_room(UUID, UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.save_rps_choice(UUID, UUID, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.settle_rps_room(UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.cancel_rps_room(UUID, UUID) TO service_role;

