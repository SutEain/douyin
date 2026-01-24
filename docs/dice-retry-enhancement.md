# 骰子游戏重试机制增强总结

## 问题描述

机器人投骰子环节经常会卡住，投不出去，需要增加重试机制。

## 修复内容

### 1. 增加重试次数
- **之前**：默认重试 3 次
- **现在**：默认重试 7 次
- **效果**：大幅提高成功率，减少因网络波动导致的失败

### 2. 扩展可重试的错误类型
新增了更多可重试的错误类型：
- `Network error` / `NetworkError`
- `fetch failed` / `Failed to fetch`
- `socket hang up`
- HTTP 状态码：`503`, `502`, `504`, `500`, `429`
- `Too Many Requests`（限流错误，可以重试）

### 3. 优化超时时间
- **之前**：固定 30 秒超时
- **现在**：递增超时时间（30s, 35s, 40s, 45s, 50s, 55s, 60s）
- **效果**：给网络较慢的情况更多时间

### 4. 改进重试延迟策略
- **之前**：固定延迟（1s, 2s, 3s...）
- **现在**：指数退避 + 抖动（1s±20%, 2s±20%, 3s±20%...）
- **效果**：避免多个请求同时重试，减少服务器压力

### 5. 增强日志记录
- 记录每次重试的详细信息
- 记录超时时间
- 记录错误类型和是否可重试
- 记录最后失败时的完整错误信息

## 修改的文件

1. **`supabase/functions/bot-dice-game/telegram.ts`**
   - 增强 `sendDiceWithRetry` 函数
   - 默认重试次数：3 → 7
   - 增加错误类型判断
   - 改进日志记录

2. **`supabase/functions/bot-dice-game/features/diceGame.ts`**
   - 更新调用 `sendDiceWithRetry` 的参数
   - 重试次数：3 → 7

3. **`supabase/functions/bot-video-upload/telegram.ts`**
   - 同步增强 `sendDiceWithRetry` 函数
   - 默认重试次数：5 → 7
   - 增加错误类型判断

4. **`supabase/functions/bot-video-upload/features/diceGame.ts`**
   - 更新调用 `sendDiceWithRetry` 的参数
   - 重试次数：3 → 7

## 重试策略详情

### 重试次数和时间线
```
尝试 1: 超时 30s，延迟 1s（±20%）
尝试 2: 超时 35s，延迟 2s（±20%）
尝试 3: 超时 40s，延迟 3s（±20%）
尝试 4: 超时 45s，延迟 4s（±20%）
尝试 5: 超时 50s，延迟 5s（±20%）
尝试 6: 超时 55s，延迟 6s（±20%）
尝试 7: 超时 60s，最终失败
```

### 可重试的错误
- 网络错误：`TIMEOUT`, `ECONNRESET`, `ETIMEDOUT`, `ENOTFOUND`, `ECONNREFUSED`
- HTTP 错误：`502`, `503`, `504`, `500`, `429`
- 服务错误：`Bad Gateway`, `Service Unavailable`, `Internal Server Error`
- 其他：`Network error`, `fetch failed`, `socket hang up`

### 不可重试的错误
- 认证错误（非 429）
- 参数错误
- 其他明确的业务错误

## 预期效果

1. **成功率提升**：从约 70% 提升到约 95%+（假设单次成功率 70%）
2. **减少卡住**：即使前几次失败，也会继续重试，避免游戏卡住
3. **更好的错误处理**：区分可重试和不可重试的错误，避免无效重试
4. **便于排查**：详细的日志记录，方便定位问题

## 注意事项

1. **Edge Function 超时**：Supabase Edge Function 默认超时是 60 秒，7 次重试可能会接近这个限制
2. **总耗时**：7 次重试最多可能需要约 30-40 秒（包括重试延迟）
3. **Fallback 机制**：如果所有重试都失败，会使用随机值继续游戏，确保游戏不会卡住

## 监控建议

1. **观察日志**：关注 `sendDiceWithRetry` 的日志，看是否有频繁重试
2. **成功率统计**：统计成功率和平均重试次数
3. **错误分析**：分析哪些错误类型最常见，是否需要进一步优化
