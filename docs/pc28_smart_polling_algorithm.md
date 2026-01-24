# PC28 智能轮询算法方案

## 需求分析

- **每期间隔**：3分30秒（210秒）
- **封盘时间**：开盘后3分钟（180秒）
- **缓冲时间**：前后各15秒
- **当前问题**：API轮询1分钟太长了，导致期数更新延迟

## 时间线设计

```
时间轴（以开盘为0秒）：
0秒      ──────────> 开盘（betting状态）
         │
         │ 下注阶段（180秒）
         │
180秒    ──────────> 封盘（sealed状态）
         │
         │ 等待开奖（15秒）
         │
195秒    ──────────> 开奖（settled状态）
         │
         │ 缓冲期（15秒）
         │
210秒    ──────────> 下一期开盘
```

## 智能轮询策略

### 方案1：多频率Deno.cron（推荐）

在Edge Function内部使用Deno.cron实现多个调度任务：

```typescript
// 主任务：每30秒执行一次（基础轮询）
Deno.cron("PC28 Main Poller", "*/30 * * * * *", async () => {
  await processPC28Round()
})

// 快速任务：每15秒执行一次（仅在活跃期数时生效）
Deno.cron("PC28 Fast Poller", "*/15 * * * * *", async () => {
  const hasActiveRound = await checkActiveRound()
  if (hasActiveRound) {
    await processPC28Round()
  }
})

// 冲刺任务：每10秒执行一次（接近封盘时）
Deno.cron("PC28 Critical Poller", "*/10 * * * * *", async () => {
  const nearSealTime = await checkNearSealTime() // 距离封盘<30秒
  if (nearSealTime) {
    await processPC28Round()
  }
})
```

**优点**：
- ✅ 频率可调（10秒、15秒、30秒）
- ✅ 根据状态动态调整
- ✅ 不需要外部服务

**缺点**：
- ⚠️ Deno.cron最小间隔可能有限制（需要测试）

### 方案2：状态驱动的智能轮询（最佳）

根据当前期数状态动态调整轮询频率：

```typescript
async function getPollingInterval(): Promise<number> {
  const currentRound = await getCurrentGlobalRound()
  
  if (!currentRound) {
    return 30000 // 30秒：没有活跃期数
  }
  
  if (currentRound.status === 'sealed') {
    return 15000 // 15秒：已封盘，等待开奖
  }
  
  if (currentRound.status === 'betting') {
    const now = Date.now()
    const sealAt = new Date(currentRound.seal_at).getTime()
    const timeUntilSeal = sealAt - now
    
    if (timeUntilSeal > 60000) {
      return 30000 // 30秒：距离封盘>1分钟
    } else if (timeUntilSeal > 30000) {
      return 15000 // 15秒：距离封盘30-60秒
    } else {
      return 10000 // 10秒：距离封盘<30秒（冲刺阶段）
    }
  }
  
  return 30000 // 默认30秒
}
```

**实现方式**：
- Edge Function内部使用`setTimeout`递归调用
- 每次执行后根据状态计算下次执行时间
- 避免固定频率的浪费

### 方案3：混合方案（推荐实施）

结合Deno.cron和状态驱动：

1. **基础轮询**：Deno.cron每30秒执行一次
2. **快速检查**：Edge Function内部根据状态决定是否额外调用API
3. **封盘检查**：数据库触发器或函数在封盘时间自动更新状态

## 实施建议

### 阶段1：优化Edge Function逻辑（立即）

1. 添加状态检查函数
2. 根据期数状态决定是否调用API
3. 减少不必要的API调用

### 阶段2：实现智能轮询（短期）

1. 使用Deno.cron实现多频率调度
2. 或使用递归setTimeout实现动态间隔
3. 测试不同频率下的性能

### 阶段3：前端优化（可选）

1. 前端实时计算倒计时（不依赖后端）
2. 前端在接近封盘时主动刷新数据
3. 使用WebSocket实时推送（未来升级）

## 时间计算函数

```typescript
// 计算下一期的封盘时间
function calculateNextSealAt(currentTime: Date): Date {
  // 开盘后3分钟封盘
  return new Date(currentTime.getTime() + 3 * 60 * 1000)
}

// 计算下一期的开奖时间
function calculateNextOpentime(currentTime: Date): Date {
  // 封盘后15秒开奖
  return new Date(currentTime.getTime() + 3 * 60 * 1000 + 15 * 1000)
}

// 计算下一期的开盘时间
function calculateNextRoundStart(currentTime: Date): Date {
  // 开奖后15秒开盘下一期（总共3分30秒）
  return new Date(currentTime.getTime() + 3.5 * 60 * 1000)
}
```

## 性能考虑

- **API调用频率**：从60秒降低到10-30秒
- **数据库查询**：增加状态缓存，减少查询
- **Edge Function执行时间**：优化逻辑，避免超时

## 下一步

1. 先实现方案2（状态驱动的智能轮询）
2. 测试不同状态下的轮询频率
3. 根据实际效果调整参数
