# 游戏状态管理重构方案

## 一、当前问题分析

### 1. 骰子游戏状态问题

**当前状态流转：**
```
waiting → rolling → finished/cancelled
```

**问题：**
1. **rolling 状态容易卡住**：
   - `startRolling` 函数在 Edge Function 中执行，如果超时或失败，状态会卡在 `rolling`
   - 需要等待所有玩家发送骰子，如果某个玩家失败，会使用 fallback 值，但状态可能还是 rolling
   - 超时检查混乱：有些用 `created_at`，有些用 `updated_at`

2. **状态转换没有验证**：
   - 可以从任何状态转换到任何状态，没有状态机验证
   - 缺少状态转换日志

3. **错误处理不完善**：
   - 如果 `startRolling` 失败，房间状态可能卡在 `rolling`
   - 没有自动恢复机制

### 2. 猜拳游戏状态问题

**当前状态流转：**
```
waiting → playing → finished/cancelled
```

**问题：**
1. **playing 状态容易卡住**：
   - 需要等待双方都出手，如果一方不出手会卡住
   - 超时检查基于 `created_at` 或 `updated_at`，逻辑混乱

2. **状态转换不清晰**：
   - `join_rps_room` 直接将状态改为 `playing`，但此时双方都还没出手
   - 应该有一个中间状态表示"等待出手"

### 3. 超时处理问题

**当前超时检查：**
- 骰子游戏：`waiting` 状态检查 `expired_at`，`rolling` 状态检查 `created_at`（5分钟）
- 猜拳游戏：`waiting` 状态检查 `created_at`（30秒），`playing` 状态检查 `updated_at`（60秒）

**问题：**
- 超时检查逻辑分散，不统一
- 时间判断混乱（created_at vs updated_at）
- 没有统一的状态超时字段

## 二、重构方案

### 1. 统一状态机设计

#### 骰子游戏状态机
```
waiting → rolling → settling → finished
         ↓           ↓
      cancelled   cancelled
```

**状态说明：**
- `waiting`: 等待玩家加入
- `rolling`: 正在发送骰子（可中断）
- `settling`: 正在结算（原子操作，不可中断）
- `finished`: 已完成
- `cancelled`: 已取消

#### 猜拳游戏状态机
```
waiting → playing → settling → finished
         ↓           ↓
      cancelled   cancelled
```

**状态说明：**
- `waiting`: 等待对手加入
- `playing`: 等待双方出手
- `settling`: 正在结算（原子操作，不可中断）
- `finished`: 已完成
- `cancelled`: 已取消

### 2. 数据库改进

#### 新增字段
```sql
-- 统一的状态超时字段
ALTER TABLE dice_rooms ADD COLUMN status_changed_at TIMESTAMPTZ DEFAULT NOW();
ALTER TABLE rps_rooms ADD COLUMN status_changed_at TIMESTAMPTZ DEFAULT NOW();

-- 状态转换日志表（可选，用于调试）
CREATE TABLE game_state_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    game_type TEXT NOT NULL, -- 'dice' or 'rps'
    room_id UUID NOT NULL,
    old_status TEXT,
    new_status TEXT NOT NULL,
    changed_by TEXT, -- 'system', 'user', 'timeout'
    reason TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);
```

### 3. 状态转换函数

#### 统一的状态转换函数
```sql
-- 骰子游戏状态转换
CREATE OR REPLACE FUNCTION transition_dice_room_status(
    p_room_id UUID,
    p_new_status TEXT,
    p_changed_by TEXT DEFAULT 'system',
    p_reason TEXT DEFAULT NULL
) RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_current_status TEXT;
    v_valid_transition BOOLEAN := FALSE;
BEGIN
    -- 1. 获取当前状态
    SELECT status INTO v_current_status
    FROM dice_rooms
    WHERE id = p_room_id
    FOR UPDATE;
    
    IF NOT FOUND THEN
        RETURN FALSE;
    END IF;
    
    -- 2. 验证状态转换是否合法
    -- waiting → rolling, cancelled
    -- rolling → settling, cancelled
    -- settling → finished, cancelled
    -- finished → (不允许转换)
    -- cancelled → (不允许转换)
    
    IF v_current_status = 'waiting' AND p_new_status IN ('rolling', 'cancelled') THEN
        v_valid_transition := TRUE;
    ELSIF v_current_status = 'rolling' AND p_new_status IN ('settling', 'cancelled') THEN
        v_valid_transition := TRUE;
    ELSIF v_current_status = 'settling' AND p_new_status IN ('finished', 'cancelled') THEN
        v_valid_transition := TRUE;
    ELSIF v_current_status IN ('finished', 'cancelled') THEN
        -- 不允许从终态转换
        RETURN FALSE;
    END IF;
    
    IF NOT v_valid_transition THEN
        RAISE EXCEPTION 'Invalid status transition: % → %', v_current_status, p_new_status;
    END IF;
    
    -- 3. 更新状态
    UPDATE dice_rooms
    SET status = p_new_status,
        status_changed_at = NOW(),
        updated_at = NOW()
    WHERE id = p_room_id;
    
    -- 4. 记录状态转换日志（可选）
    INSERT INTO game_state_logs (game_type, room_id, old_status, new_status, changed_by, reason)
    VALUES ('dice', p_room_id, v_current_status, p_new_status, p_changed_by, p_reason);
    
    RETURN TRUE;
END;
$$;
```

### 4. 超时处理统一化

#### 统一超时检查函数
```sql
-- 骰子游戏超时检查（统一逻辑）
CREATE OR REPLACE FUNCTION check_dice_room_timeout()
RETURNS TABLE (
    room_id UUID,
    group_id BIGINT,
    reason TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_room RECORD;
BEGIN
    -- 1. waiting 状态超时（30秒）
    FOR v_room IN
        SELECT id, group_id
        FROM dice_rooms
        WHERE status = 'waiting'
          AND status_changed_at < NOW() - INTERVAL '30 seconds'
        FOR UPDATE SKIP LOCKED
    LOOP
        -- 转换状态为 cancelled
        PERFORM transition_dice_room_status(v_room.id, 'cancelled', 'system', 'waiting_timeout');
        -- 退款逻辑...
        room_id := v_room.id;
        group_id := v_room.group_id;
        reason := 'waiting_timeout';
        RETURN NEXT;
    END LOOP;
    
    -- 2. rolling 状态超时（2分钟）
    FOR v_room IN
        SELECT id, group_id
        FROM dice_rooms
        WHERE status = 'rolling'
          AND status_changed_at < NOW() - INTERVAL '2 minutes'
        FOR UPDATE SKIP LOCKED
    LOOP
        -- 转换状态为 cancelled
        PERFORM transition_dice_room_status(v_room.id, 'cancelled', 'system', 'rolling_timeout');
        -- 退款逻辑...
        room_id := v_room.id;
        group_id := v_room.group_id;
        reason := 'rolling_timeout';
        RETURN NEXT;
    END LOOP;
    
    -- 3. settling 状态超时（30秒，不应该发生）
    FOR v_room IN
        SELECT id, group_id
        FROM dice_rooms
        WHERE status = 'settling'
          AND status_changed_at < NOW() - INTERVAL '30 seconds'
        FOR UPDATE SKIP LOCKED
    LOOP
        -- 这是异常情况，记录日志并强制完成
        PERFORM transition_dice_room_status(v_room.id, 'finished', 'system', 'settling_timeout_force');
        room_id := v_room.id;
        group_id := v_room.group_id;
        reason := 'settling_timeout_force';
        RETURN NEXT;
    END LOOP;
END;
$$;
```

### 5. 代码重构

#### 改进 startRolling 函数
```typescript
async function startRolling(chatId: number, roomId: string) {
  try {
    // 1. 转换状态为 rolling（带验证）
    const { error: statusError } = await supabase.rpc('transition_dice_room_status', {
      p_room_id: roomId,
      p_new_status: 'rolling',
      p_changed_by: 'system',
      p_reason: 'start_rolling'
    })
    
    if (statusError) {
      throw new Error(`状态转换失败: ${statusError.message}`)
    }
    
    // 2. 发送骰子（如果失败，状态会自动超时处理）
    // ... 发送骰子逻辑 ...
    
    // 3. 转换状态为 settling（开始结算）
    await supabase.rpc('transition_dice_room_status', {
      p_room_id: roomId,
      p_new_status: 'settling',
      p_changed_by: 'system',
      p_reason: 'start_settling'
    })
    
    // 4. 结算（原子操作）
    // ... 结算逻辑 ...
    
    // 5. 转换状态为 finished
    await supabase.rpc('transition_dice_room_status', {
      p_room_id: roomId,
      p_new_status: 'finished',
      p_changed_by: 'system',
      p_reason: 'settlement_complete'
    })
    
  } catch (error) {
    // 如果失败，转换状态为 cancelled
    await supabase.rpc('transition_dice_room_status', {
      p_room_id: roomId,
      p_new_status: 'cancelled',
      p_changed_by: 'system',
      p_reason: `error: ${error.message}`
    })
    throw error
  }
}
```

## 三、实施步骤

### 阶段一：数据库改进（1-2天）
1. 添加 `status_changed_at` 字段
2. 创建状态转换函数
3. 创建统一超时检查函数
4. 创建状态日志表（可选）

### 阶段二：代码重构（2-3天）
1. 重构骰子游戏状态管理
2. 重构猜拳游戏状态管理
3. 统一错误处理
4. 添加状态转换日志

### 阶段三：测试和优化（1-2天）
1. 测试各种状态转换场景
2. 测试超时处理
3. 测试错误恢复
4. 性能优化

## 四、优势

1. **状态转换清晰**：有明确的状态机，不允许非法转换
2. **超时处理统一**：所有超时检查都基于 `status_changed_at`
3. **错误恢复**：如果状态卡住，超时检查会自动处理
4. **可追溯性**：状态转换日志可以追踪问题
5. **可维护性**：代码结构清晰，易于维护

## 五、风险评估

**低风险：**
- 数据库字段添加（向后兼容）
- 状态转换函数（不影响现有功能）

**中风险：**
- 代码重构（需要充分测试）
- 状态转换验证（可能影响现有流程）

**建议：**
- 先添加新字段和函数
- 逐步迁移现有代码
- 保留旧代码作为备份
