# PC28全局游戏系统设计

## 架构概述

**核心思想**：后台统一运行一个PC28游戏，所有直播间共享同一期号，主播只需开启/关闭即可参与。

## 数据库设计

### 1. 全局期数表（pc28_global_rounds）
```sql
- id: UUID (主键)
- period_number: TEXT (期号，全局唯一，从API获取)
- status: TEXT (betting/sealed/settled)
- seal_at: TIMESTAMP (封盘时间，从API的opentime计算)
- result: JSONB (开奖结果: {num1, num2, num3, sum})
- settled_at: TIMESTAMP (结算时间)
- total_bet_amount: NUMERIC (全局总下注)
- total_payout: NUMERIC (全局总赔付)
- total_platform_fee: NUMERIC (全局平台抽成)
- created_at: TIMESTAMP
- updated_at: TIMESTAMP
- UNIQUE(period_number)
```

**特点**：
- 不关联room_id，全局唯一
- 所有直播间共享同一期号
- 后台服务自动创建和管理

### 2. 房间开关表（pc28_room_enabled）
```sql
- id: UUID (主键)
- room_id: UUID (关联live_broadcast_rooms)
- anchor_id: UUID (主播ID)
- enabled: BOOLEAN (是否开启PC28)
- enabled_at: TIMESTAMP (开启时间)
- updated_at: TIMESTAMP
- UNIQUE(room_id)
```

**特点**：
- 记录哪些房间开启了PC28
- 主播可以随时开启/关闭
- 开启后，该房间的用户可以参与当前全局期数

### 3. 下注表（pc28_bets）- 修改
```sql
- id: UUID (主键)
- global_round_id: UUID (关联pc28_global_rounds，不再是room_id+period_number)
- room_id: UUID (记录在哪个房间下的注)
- user_id: UUID (用户ID)
- bet_type: TEXT (下注类型)
- bet_value: INT (下注值)
- amount: NUMERIC (下注金额)
- odds: NUMERIC (赔率)
- status: TEXT (pending/settled/cancelled)
  - pending: 待结算
  - settled: 已结算
  - cancelled: 已取消（退回下注）
- is_win: BOOLEAN (取消时为null)
- payout: NUMERIC (取消时为0)
- platform_fee: NUMERIC (取消时为0)
- user_gain: NUMERIC (取消时为0，退款金额记录在amount字段)
- anchor_payout: NUMERIC (该房间主播的抽水，取消时为0)
- refund_amount: NUMERIC (退款金额，取消时等于amount)
- created_at: TIMESTAMP
- settled_at: TIMESTAMP (取消时为null)
- cancelled_at: TIMESTAMP (取消时间)
- CHECK (status IN ('pending', 'settled', 'cancelled'))
```

**变化**：
- `round_id` 改为 `global_round_id`，关联全局期数
- 保留 `room_id` 用于统计和显示
- 结算时，主播抽水按房间统计

## 后台服务设计

### Edge Function: pc28-auto-processor

**功能**：
1. 定时轮询API（每30秒）
2. 获取最新10期数据
3. 自动处理：
   - **开盘**：发现新期号 → 创建全局期数记录（status=betting）
   - **封盘**：根据API的opentime，提前30秒封盘（status=sealed）
   - **结算**：API返回开奖号码后，自动结算（status=settled）

**流程**：
```
1. 调用API: https://www.apigx.cn/token/{token}/code/jnd28/rows/10.json
2. 解析返回数据，获取data数组（按时间倒序，最新的在前）
3. 处理最新开奖的期号（data[0]）：
   
   latest_item = data[0]  -- API返回的最新开奖结果
   latest_period = latest_item.expect  -- 例如 "3388334"
   latest_opencode = latest_item.opencode  -- 例如 "1,0,6"
   latest_opentime = latest_item.opentime  -- 例如 "2026-01-25 00:10:00"
   
   -- 检查数据库中是否已有该期号
   existing_round = SELECT * FROM pc28_global_rounds WHERE period_number = latest_period
   
   IF existing_round IS NULL:
     -- 🎯 发现新开奖的期号！
     -- 说明：API返回了这个期号的开奖结果，但数据库中还没有记录
     -- 这意味着上一期已经开奖，需要：
     -- 1. 结算上一期（如果存在未结算的betting/sealed状态）
     -- 2. 创建当前期记录并结算（因为已经开奖了）
     -- 3. 开盘下一期（期号+1）
     
     -- 步骤1：结算上一期（如果存在）
     previous_round = SELECT * FROM pc28_global_rounds 
                      WHERE status IN ('betting', 'sealed') 
                      ORDER BY created_at DESC LIMIT 1
     
     IF previous_round IS NOT NULL:
       -- 上一期未结算，需要结算（可能是系统重启或延迟）
       -- 但此时没有开奖号码，可以：
       -- 方案A：取消上一期，退款给用户
       -- 方案B：等待API返回上一期的开奖结果（如果API会返回）
       -- 这里采用方案A：取消上一期，退款
       CALL cancel_previous_round(previous_round.id)
     
     -- 步骤2：创建当前期记录并结算（因为已经开奖了）
     -- 解析开奖号码
     nums = SPLIT(latest_opencode, ',')
     num1 = INT(nums[0])
     num2 = INT(nums[1])
     num3 = INT(nums[2])
     sum = num1 + num2 + num3
     
     -- 创建期数记录（直接创建为settled状态）
     new_round_id = INSERT INTO pc28_global_rounds (
       period_number,
       status,
       result,
       settled_at,
       created_at
     ) VALUES (
       latest_period,
       'settled',
       JSON_BUILD_OBJECT('num1', num1, 'num2', num2, 'num3', num3, 'sum', sum),
       latest_opentime,
       NOW()
     ) RETURNING id
     
     -- 注意：这里不结算，因为当前期已经开奖，用户应该在下期下注
     -- 如果用户在当前期下注了，需要退款（因为开奖时用户还没下注）
     
     -- 步骤3：开盘下一期（期号+1）
     next_period = INCREMENT_PERIOD(latest_period)  -- "3388334" -> "3388335"
     next_opentime = latest_opentime + 3分钟30秒  -- JND28通常每3-4分钟一期
     next_seal_at = next_opentime - 30秒  -- 提前30秒封盘
     
     -- 检查下一期是否已存在
     next_round_exists = SELECT * FROM pc28_global_rounds WHERE period_number = next_period
     
     IF next_round_exists IS NULL:
       -- 开盘下一期
       INSERT INTO pc28_global_rounds (
         period_number,
         status,
         seal_at,
         created_at
       ) VALUES (
         next_period,
         'betting',
         next_seal_at,
         NOW()
       )
       
       -- 推送开盘消息到所有开启PC28的房间
       FOR EACH enabled_room IN (SELECT room_id FROM pc28_room_enabled WHERE enabled = true):
         INSERT INTO live_broadcast_messages (room_id, msg_type, content)
         VALUES (enabled_room.room_id, 'pc28', 
                 JSON_BUILD_OBJECT('type', 'round_opened', 'period_number', next_period))
   
   ELSE IF existing_round.status = 'betting' OR existing_round.status = 'sealed':
     -- 🎯 期号已存在但未结算，且API返回了开奖结果，需要结算
     -- 解析开奖号码
     nums = SPLIT(latest_opencode, ',')
     num1 = INT(nums[0])
     num2 = INT(nums[1])
     num3 = INT(nums[2])
     
     -- 调用结算函数
     CALL settle_global_round(existing_round.id, num1, num2, num3)
     
     -- 结算后，开盘下一期（期号+1）
     next_period = INCREMENT_PERIOD(latest_period)
     next_opentime = latest_opentime + 3分钟30秒
     next_seal_at = next_opentime - 30秒
     
     next_round_exists = SELECT * FROM pc28_global_rounds WHERE period_number = next_period
     IF next_round_exists IS NULL:
       INSERT INTO pc28_global_rounds (period_number, status, seal_at, created_at)
       VALUES (next_period, 'betting', next_seal_at, NOW())
       
       -- 推送开盘消息
       FOR EACH enabled_room IN (SELECT room_id FROM pc28_room_enabled WHERE enabled = true):
         INSERT INTO live_broadcast_messages (room_id, msg_type, content)
         VALUES (enabled_room.room_id, 'pc28', 
                 JSON_BUILD_OBJECT('type', 'round_opened', 'period_number', next_period))
   
   ELSE IF existing_round.status = 'settled':
     -- 已结算，检查是否需要开盘下一期
     -- 如果当前没有betting状态的期数，开盘下一期
     current_betting = SELECT * FROM pc28_global_rounds WHERE status = 'betting' LIMIT 1
     
     IF current_betting IS NULL:
       -- 没有正在下注的期数，开盘下一期
       next_period = INCREMENT_PERIOD(latest_period)
       next_opentime = latest_opentime + 3分钟30秒
       next_seal_at = next_opentime - 30秒
       
       INSERT INTO pc28_global_rounds (period_number, status, seal_at, created_at)
       VALUES (next_period, 'betting', next_seal_at, NOW())
       
       -- 推送开盘消息
       FOR EACH enabled_room IN (SELECT room_id FROM pc28_room_enabled WHERE enabled = true):
         INSERT INTO live_broadcast_messages (room_id, msg_type, content)
         VALUES (enabled_room.room_id, 'pc28', 
                 JSON_BUILD_OBJECT('type', 'round_opened', 'period_number', next_period))

4. 检查封盘时间（独立于API调用）：
   -- 每10秒检查一次（或每次API调用时检查）
   betting_rounds = SELECT * FROM pc28_global_rounds 
                    WHERE status = 'betting' AND seal_at <= NOW()
   
   FOR EACH round IN betting_rounds:
     UPDATE pc28_global_rounds
     SET status = 'sealed', updated_at = NOW()
     WHERE id = round.id
     
     -- 推送封盘消息
     FOR EACH enabled_room IN (SELECT room_id FROM pc28_room_enabled WHERE enabled = true):
       INSERT INTO live_broadcast_messages (room_id, msg_type, content)
       VALUES (enabled_room.room_id, 'pc28', 
               JSON_BUILD_OBJECT('type', 'round_sealed', 'period_number', round.period_number))

5. 检查超时封盘期数（自动取消）：
   -- 每1分钟检查一次
   timeout_rounds = SELECT * FROM pc28_global_rounds 
                    WHERE status = 'sealed' 
                    AND seal_at < NOW() - INTERVAL '5 minutes'
   
   FOR EACH round IN timeout_rounds:
     -- 自动取消，退回下注
     CALL cancel_global_round(round.id, cancelled_by=NULL)  -- NULL表示自动取消
     
     -- 推送取消消息
     FOR EACH enabled_room IN (SELECT room_id FROM pc28_room_enabled WHERE enabled = true):
       INSERT INTO live_broadcast_messages (room_id, msg_type, content)
       VALUES (enabled_room.room_id, 'pc28', 
               JSON_BUILD_OBJECT('type', 'round_cancelled', 'period_number', round.period_number, 
                                'reason', '超时未开奖，自动取消'))
```

**关键逻辑说明**：

1. **API特点**：
   - API只返回已开奖的历史数据
   - 最新的一条（data[0]）是最近一次开奖结果
   - 包含：expect（期号）、opencode（开奖号码）、opentime（开奖时间）

2. **发现新期号的方法**：
   - 当API返回的期号在数据库中不存在 → 说明这是新开奖的期号
   - 此时需要：
     a. 结算上一期（如果存在未结算的）
     b. 创建当前期记录（已开奖，直接settled）
     c. 开盘下一期（期号+1，根据时间推算）

3. **期号递增规则**：
   ```javascript
   // JND28期号格式：通常是8位数字+3位序号
   // 例如：3388334 -> 3388335
   function incrementPeriod(period) {
     // 简单递增：如果是纯数字，直接+1
     if (/^\d+$/.test(period)) {
       return String(parseInt(period) + 1)
     }
     // 如果有特殊格式，需要根据实际情况处理
     return period
   }
   ```

4. **时间推算**：
   - JND28通常每3-4分钟一期
   - 下一期开奖时间 = 当前期开奖时间 + 3分30秒
   - 封盘时间 = 下一期开奖时间 - 30秒

5. **处理流程总结**：
   ```
   API返回最新开奖 → 检查期号是否存在
   ├─ 不存在 → 新开奖 → 结算上一期 → 创建当前期 → 开盘下一期
   ├─ 存在且未结算 → 结算当前期 → 开盘下一期
   └─ 存在且已结算 → 检查是否需要开盘下一期
   
   同时：定时检查封盘时间 → 自动封盘
   ```

## 特殊情况处理

### 官方休息/未开奖处理

**场景**：封盘后，官方休息或延迟开奖，主播需要取消当前期并退回下注

**解决方案**：

1. **手动取消功能**（主播操作）：
   - 主播可以在封盘后、开奖前，手动取消当前期
   - 取消后，退回所有下注给用户
   - 该期状态变为 `cancelled`

2. **自动取消机制**（超时保护）：
   - 如果封盘后超过5分钟还没有开奖，自动取消该期
   - 退回所有下注
   - 避免用户资金长时间冻结

3. **取消逻辑**：
   ```
   - 查找所有关联该global_round_id的下注（status='pending'）
   - 按用户分组，退回下注金额
   - 更新下注状态为 'cancelled'
   - 更新期数状态为 'cancelled'
   - 推送取消消息到所有开启PC28的房间
   ```

## RPC函数设计

### 1. enable_pc28_for_room(room_id)
- 验证用户是主播
- 检查房间是否存在
- 插入/更新pc28_room_enabled表（enabled=true）

### 2. disable_pc28_for_room(room_id)
- 验证用户是主播
- 更新pc28_room_enabled表（enabled=false）
- 注意：不取消当前期的下注，用户仍可参与全局期数

### 3. cancel_global_round(global_round_id)
- 验证：只有开启PC28的房间主播可以取消（或管理员）
- 验证：期数状态必须是 'sealed'（已封盘但未开奖）
- 验证：距离封盘时间不超过30分钟（防止误操作）
- 操作：
  - 查找所有关联该global_round_id的下注（status='pending'）
  - 按用户分组，退回下注金额到用户余额
  - 记录退款流水
  - 更新下注状态为 'cancelled'
  - 更新期数状态为 'cancelled'
  - 推送取消消息到所有开启PC28的房间
- 返回：退款用户数、退款总金额

### 4. auto_cancel_timeout_rounds()
- 后台定时任务调用（每1分钟）
- 查找：status='sealed' 且封盘时间超过5分钟的期数
- 自动取消这些期数，退回下注
- 防止资金长时间冻结

### 3. get_current_global_round()
- 返回当前全局期数（status=betting或sealed）
- 所有房间共享

### 4. get_room_pc28_status(room_id)
- 返回房间是否开启PC28
- 返回当前全局期数信息

### 5. place_pc28_bet - 修改
- 参数：global_round_id, room_id, bet_type, amount, bet_value
- 验证：房间是否开启PC28，期数是否可下注
- 下注：关联global_round_id而非room_id+period_number

### 6. settle_global_round - 修改
- 参数：global_round_id, num1, num2, num3
- 结算：所有关联该global_round_id的下注
- 按房间分组，每个房间主播获得该房间下注额的1%

## 前端设计

### 主播控制流程

**首次开启**：
1. 主播点击底部"游戏"按钮
2. 弹出抽屉菜单，显示"PC28游戏"
3. 点击"PC28游戏" → 弹出确认弹窗
4. 弹窗内容：
   ```
   ┌─────────────────────────┐
   │   PC28游戏              │
   ├─────────────────────────┤
   │                         │
   │  开启后，系统将自动：    │
   │  • 同步官方开奖数据      │
   │  • 自动开盘、封盘、结算  │
   │  • 您只需控制开始/停止   │
   │                         │
   │  [取消]  [开始游戏]     │
   │                         │
   └─────────────────────────┘
   ```
5. 点击"开始游戏" → 调用enable_pc28_for_room
6. 弹窗关闭，主播控制挂件出现

**主播控制挂件**（类似下注挂件，固定在右上角）：
```
┌─────────────────────────┐
│  PC28控制  [×]          │
├─────────────────────────┤
│                         │
│  当前期号：3388334      │
│  状态：下注中           │
│  倒计时：02:30          │
│                         │
│  总下注：1,250 抖币     │
│                         │
│  [停止游戏]             │
│                         │
│  (封盘后显示)            │
│  [取消本期并退回]        │
│                         │
└─────────────────────────┘
```

**挂件功能**：
- 显示当前全局期数状态
- 显示倒计时（封盘倒计时）
- 显示总下注金额（该房间的下注）
- "停止游戏"按钮：调用disable_pc28_for_room
- "取消本期并退回"按钮：
  - 仅在status='sealed'时显示
  - 调用cancel_global_round
  - 二次确认："确定要取消本期吗？将退回所有下注。"
- 挂件位置：固定在右上角（类似下注挂件）
- 用户不可见：只有主播能看到

### 用户界面

**用户看到的挂件**（保持不变）：
1. **当前期挂件**（下注中/已封盘）：
   ```
   ┌─────────────────────────┐
   │  PC28 3388334期         │
   │  下注中 倒计时：02:30   │
   └─────────────────────────┘
   ```
   - 点击打开下注面板

2. **已结算挂件**（显示开奖结果）：
   ```
   ┌─────────────────────────┐
   │  PC28 3388333期         │
   │  已结算 1+0+6=7        │
   └─────────────────────────┘
   ```
   - 点击查看下注记录

**用户下注面板**：
- 显示当前全局期数
- 下注逻辑不变，但关联global_round_id
- 显示该房间的下注记录
- 功能保持不变

### UI/UX流程总结

```
主播流程：
1. 点击底部"游戏"按钮
2. 抽屉菜单 → "PC28游戏"
3. 确认弹窗 → "开始游戏"
4. 主播控制挂件出现（右上角）
5. 后续通过挂件控制（停止/取消）

用户流程：
1. 看到当前期挂件（右上角）
2. 点击挂件 → 打开下注面板
3. 下注、查看记录等（功能不变）

关键点：
- 主播控制挂件：只有主播可见
- 用户挂件：所有用户可见
- 首次开启：通过底部游戏按钮
- 后续控制：通过挂件
```

## 优势

1. **统一管理**：所有直播间共享同一期号，数据一致
2. **自动化**：主播只需开启/关闭，无需手动操作
3. **API复用**：一个API服务所有直播间
4. **简化逻辑**：移除大量手动操作代码
5. **实时同步**：所有房间实时看到同一期数状态

## 迁移计划

1. 创建新表：pc28_global_rounds, pc28_room_enabled
2. 修改pc28_bets表：添加global_round_id，保留room_id
3. 创建Edge Function：pc28-auto-processor
4. 创建/修改RPC函数
5. 修改前端组件
6. 数据迁移：将现有room_id+period_number映射到global_round_id
