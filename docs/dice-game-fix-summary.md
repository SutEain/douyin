# 骰子游戏卡住问题修复总结

## 问题描述

1. **骰子游戏经常卡住**：游戏状态卡在 `rolling`，无法正常结算
2. **机器人投骰子环节经常投不出来**：发送骰子失败，导致游戏流程中断

## 根本原因

### 1. 状态不匹配问题
- `join_dice_room` RPC 在玩家满员时将状态从 `waiting` 改为 `rolling`
- 但 `settle_dice_room` RPC 只接受 `waiting` 状态
- `startDiceGame` 函数也只检查 `waiting` 状态
- 导致状态不匹配，结算失败

### 2. 错误处理不完善
- 发送骰子失败时，虽然有 fallback 机制，但日志不够详细
- 缺少关键步骤的日志记录，难以排查问题

## 修复内容

### 1. 修复 `settle_dice_room` RPC（迁移文件：`20260126000001_fix_dice_game_status_check.sql`）
- ✅ 允许 `waiting` 或 `rolling` 状态进行结算
- ✅ 改进错误消息，显示实际状态和期望状态

### 2. 修复 `startDiceGame` 函数（文件：`bot-dice-game/features/diceGame.ts`）
- ✅ 允许 `waiting` 或 `rolling` 状态继续执行游戏流程
- ✅ 改进状态检查逻辑，正确处理各种状态
- ✅ 改进错误处理和日志记录

### 3. 改进日志记录
- ✅ 添加关键步骤的日志（开始游戏、发送骰子、结算成功等）
- ✅ 记录发送骰子失败的原因和使用的 fallback 值
- ✅ 记录结算失败时的详细错误信息

### 4. 创建清理函数（迁移文件：`20260126000002_add_cleanup_stuck_dice_games.sql`）
- ✅ 创建 `cleanup_stuck_dice_games()` 函数
- ✅ 自动清理 `waiting` 状态超过30秒的游戏
- ✅ 自动清理 `rolling` 状态超过5分钟的游戏
- ✅ 自动退款给所有玩家

## 使用方法

### 1. 应用数据库迁移
```bash
# 应用修复迁移
supabase migration up
```

### 2. 检查卡住的游戏
```sql
-- 查看卡住的游戏
SELECT * FROM cleanup_stuck_dice_games();
```

### 3. 手动清理卡住的游戏（如果需要）
```sql
-- 执行清理（会自动退款）
SELECT * FROM cleanup_stuck_dice_games();
```

### 4. 设置定时任务（可选）
如果需要自动清理，可以在 Supabase Dashboard 中设置定时任务：
```sql
-- 每5分钟执行一次清理
SELECT cron.schedule(
  'cleanup-stuck-dice-games',
  '*/5 * * * *',
  $$ SELECT cleanup_stuck_dice_games() $$
);
```

## 检查脚本

使用 `supabase/check_stuck_dice_games.sql` 可以检查：
1. 所有卡住的游戏（waiting 超时30秒或 rolling 超时5分钟）
2. 各状态的游戏统计
3. rolling 状态游戏的详细信息（包括玩家列表）

## 注意事项

1. **状态流转**：
   - `waiting` → `rolling`（玩家满员时）
   - `rolling` → `finished`（结算成功）
   - `waiting`/`rolling` → `cancelled`（超时或取消）

2. **超时时间**：
   - `waiting` 状态：30秒超时
   - `rolling` 状态：5分钟超时（因为发送骰子可能需要时间）

3. **Fallback 机制**：
   - 如果发送骰子失败，会使用随机值（1-6）继续游戏
   - 这确保了游戏不会因为网络问题而卡住

4. **并发控制**：
   - 使用 `runningGames` Set 防止同一房间的并发执行
   - finally 块确保标记被正确清理

## 测试建议

1. **正常流程测试**：
   - 创建游戏 → 玩家加入 → 满员后自动开始 → 发送骰子 → 结算成功

2. **异常情况测试**：
   - 网络超时：模拟 Telegram API 超时
   - 状态异常：模拟状态不匹配的情况
   - 超时清理：测试超时游戏的自动清理

3. **日志检查**：
   - 检查 Edge Function 日志，确认关键步骤都有日志
   - 确认错误信息清晰，便于排查问题

## 后续优化建议

1. **状态机验证**：考虑添加状态机验证函数，确保状态转换合法
2. **重试机制**：可以考虑增加发送骰子的重试次数（当前是3次）
3. **监控告警**：添加监控，当有卡住的游戏时发送告警
4. **性能优化**：如果游戏量大，可以考虑批量处理清理逻辑
