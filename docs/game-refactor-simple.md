# 游戏系统完全重构方案（简洁版）

## 设计原则

1. **简洁**：删除所有不必要的 cron、触发器
2. **现代**：使用事件驱动，状态最小化
3. **清晰**：每个函数职责单一，易于理解

## 核心设计

### 1. 状态简化

**骰子游戏：**
```
waiting → finished/cancelled
```

**猜拳游戏：**
```
waiting → finished/cancelled
```

**原则：**
- 只有两个状态：`waiting`（进行中）和 `finished`/`cancelled`（终态）
- 删除 `rolling`、`settling`、`playing` 等中间状态
- 超时检查在用户操作时进行，不依赖 cron

### 2. 超时处理

**不再使用 cron：**
- 每次用户操作时检查超时
- 如果超时，立即处理并返回错误
- 简单、直接、可靠

### 3. 结算逻辑

**原子操作：**
- 所有结算在单个 RPC 函数中完成
- 使用数据库事务保证一致性
- 不需要中间状态

## 数据库设计

### 骰子游戏表（简化）

```sql
CREATE TABLE dice_rooms (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_id UUID NOT NULL REFERENCES profiles(id),
    group_id BIGINT NOT NULL,
    bet_amount NUMERIC NOT NULL CHECK (bet_amount >= 5 AND bet_amount <= 10000),
    target_count INT NOT NULL DEFAULT 2 CHECK (target_count >= 2 AND target_count <= 5),
    current_count INT NOT NULL DEFAULT 1,
    status TEXT DEFAULT 'waiting' CHECK (status IN ('waiting', 'finished', 'cancelled')),
    winner_ids UUID[],
    total_prize NUMERIC DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    -- 删除 updated_at, expired_at, status_changed_at 等复杂字段
    -- 只保留 created_at，超时检查基于此
    UNIQUE(group_id, status) WHERE status = 'waiting' -- 一个群组同时只能有一个 waiting 房间
);

CREATE TABLE dice_room_players (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    room_id UUID NOT NULL REFERENCES dice_rooms(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES profiles(id),
    roll_result INT CHECK (roll_result >= 1 AND roll_result <= 6),
    is_winner BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(room_id, user_id)
);
```

### 猜拳游戏表（简化）

```sql
CREATE TABLE rps_rooms (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_id UUID NOT NULL REFERENCES profiles(id),
    opponent_id UUID REFERENCES profiles(id),
    group_id BIGINT NOT NULL,
    bet_amount NUMERIC NOT NULL CHECK (bet_amount >= 5 AND bet_amount <= 10000),
    owner_choice TEXT CHECK (owner_choice IN ('rock', 'paper', 'scissors')),
    opponent_choice TEXT CHECK (opponent_choice IN ('rock', 'paper', 'scissors')),
    winner_id UUID REFERENCES profiles(id),
    status TEXT DEFAULT 'waiting' CHECK (status IN ('waiting', 'finished', 'cancelled')),
    total_prize NUMERIC DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(group_id, status) WHERE status = 'waiting' -- 一个群组同时只能有一个 waiting 房间
);
```

## RPC 函数设计（原子操作）

### 骰子游戏

```sql
-- 1. 创建房间（原子操作）
CREATE OR REPLACE FUNCTION create_dice_room(...)
-- 2. 加入房间（原子操作，如果满员则自动开始游戏）
CREATE OR REPLACE FUNCTION join_dice_room(...)
-- 3. 结算房间（原子操作，包含发送骰子、计算胜负、发放奖励）
CREATE OR REPLACE FUNCTION settle_dice_room(...)
-- 4. 取消房间（原子操作）
CREATE OR REPLACE FUNCTION cancel_dice_room(...)
```

### 猜拳游戏

```sql
-- 1. 创建房间（原子操作）
CREATE OR REPLACE FUNCTION create_rps_room(...)
-- 2. 加入房间（原子操作）
CREATE OR REPLACE FUNCTION join_rps_room(...)
-- 3. 出手（原子操作，如果双方都出手则自动结算）
CREATE OR REPLACE FUNCTION make_rps_choice(...)
-- 4. 取消房间（原子操作）
CREATE OR REPLACE FUNCTION cancel_rps_room(...)
```

## Edge Function 设计（简洁）

### 流程

```
用户操作 → Edge Function → RPC（原子操作）→ 返回结果 → 发送消息
```

### 特点

1. **无状态**：Edge Function 不保存状态，所有状态在数据库
2. **同步处理**：所有操作同步完成，不需要异步队列
3. **错误处理**：如果失败，RPC 自动回滚，Edge Function 发送错误消息

## 超时处理

### 在用户操作时检查

```sql
-- 每次操作前检查超时
IF room.created_at < NOW() - INTERVAL '30 seconds' AND room.status = 'waiting' THEN
    -- 自动取消并退款
    PERFORM cancel_room(...)
    RETURN error('房间已超时')
END IF
```

### 优势

- 不需要 cron
- 不需要定时任务
- 简单、可靠

## 删除的内容

1. **所有 cron 任务**：
   - `refund-expired-dice-rooms-job`
   - `check-rps-timeout-job`
   - `refund-expired-red-packets-job`

2. **所有超时检查函数**：
   - `check_and_refund_expired_dice_rooms()`
   - `refund_expired_dice_rooms()`
   - `check_rps_timeout()`

3. **所有中间状态**：
   - `rolling`
   - `settling`
   - `playing`

4. **所有复杂的状态转换函数**

## 实施步骤

1. 创建新的数据库表结构
2. 创建新的 RPC 函数（原子操作）
3. 重构 Edge Function 代码
4. 迁移数据（如果需要）
5. 删除旧代码和 cron 任务
