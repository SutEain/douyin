# 观看时长系统重构总结

## 📋 重构目标
1. **最简单的方式**：打开app就开始计时
2. **心跳机制**：1分钟发送1次心跳，每次累加60秒
3. **移除Realtime**：不再使用Presence追踪
4. **IP限制**：1个IP最多3个账号领取时长奖励

## ✅ 已完成的工作

### 1. 数据库层
- ✅ 创建 `increment_watch_time_heartbeat()` 函数
  - 每次心跳累加60秒
  - 距离上次心跳至少50秒（允许1分钟±10秒误差）
  - 使用 `FOR UPDATE SKIP LOCKED` 防止并发
  
- ✅ 创建 `watch_time_reward_ips` 表
  - 记录IP和用户关系
  - 用于IP限制检查
  
- ✅ 更新 `claim_watch_time_reward()` 函数
  - 添加IP限制检查（1个IP最多3个账号）
  - 记录IP和用户关系

### 2. 后端API层
- ✅ 创建 `/video/watch-time/heartbeat` 接口
  - 接收心跳请求
  - 调用数据库函数累加时长
  
- ✅ 更新 `/video/watch-time/claim` 接口
  - 传递IP地址给数据库函数
  - 执行IP限制检查

### 3. 前端层
- ✅ 创建 `watchTimeHeartbeat.ts` 工具
  - 打开app就开始计时
  - 1分钟发送1次心跳
  - 自动处理用户登录/登出
  
- ✅ 更新 `main.ts`
  - 移除Presence追踪
  - 启动心跳机制

## 🔒 安全措施

### IP限制
- **规则**：1个IP最多3个账号领取时长奖励
- **实现**：通过 `watch_time_reward_ips` 表记录IP和用户关系
- **检查时机**：领取奖励时检查

### 心跳频率限制
- **规则**：距离上次心跳至少50秒（允许1分钟±10秒误差）
- **目的**：防止过快请求，防止刷时长

### 其他安全措施
- 用户只能为自己领取奖励
- 并发控制（SELECT FOR UPDATE）
- 频率限制（领取奖励）

## 📊 数据流程

### 心跳流程
```
用户打开app
  ↓
startWatchTimeHeartbeat() 启动
  ↓
立即发送第一次心跳
  ↓
每1分钟发送一次心跳
  ↓
increment_watch_time_heartbeat() 累加60秒
  ↓
更新 user_daily_watch_time 表
```

### 领取奖励流程
```
用户点击领取
  ↓
handleClaimWatchTimeReward() 接收请求
  ↓
获取用户IP地址
  ↓
check_ip_watch_time_reward_limit() 检查IP限制
  ↓
claim_watch_time_reward() 领取奖励
  ↓
记录IP和用户关系到 watch_time_reward_ips 表
```

## 🗂️ 相关文件

### 数据库迁移
- `supabase/migrations/20260128000001_fix_watch_time_rls_policies.sql` - 修复RLS策略
- `supabase/migrations/20260128000002_refactor_watch_time_to_heartbeat.sql` - 重构为心跳机制

### 后端代码
- `supabase/functions/app-server/routes/video.ts` - 心跳和领取接口
- `supabase/functions/app-server/index.ts` - 路由注册

### 前端代码
- `src/utils/watchTimeHeartbeat.ts` - 心跳工具（新建）
- `src/main.ts` - 启动心跳
- `src/api/videos.ts` - API调用（已更新注释）

## ⚠️ 注意事项

### 已清理的代码
- ✅ `src/utils/presence.ts` - Presence追踪（已删除）
- ✅ `supabase/functions/app-server/routes/presence.ts` - Presence接口（已删除）
- ✅ 相关路由和导入（已清理）

### 保留的代码
- Presence相关的数据库函数和Cron任务（已废弃但保留，不影响功能）
- LivePage.vue 中的 Presence 用于直播间在线用户显示，与观看时长无关，已保留

## 🎯 优势

1. **简单直接**：打开app就开始计时，无需复杂的Presence机制
2. **可靠性高**：心跳机制更稳定，不依赖WebSocket连接
3. **易于排查**：心跳失败有明确的错误信息
4. **防刷机制**：IP限制 + 心跳频率限制双重保护

## 📝 后续优化建议

1. **监控和告警**：添加心跳失败率监控
2. **用户提示**：如果心跳失败，可以提示用户
3. **重试机制**：心跳失败时自动重试
4. **数据清理**：定期清理 `watch_time_reward_ips` 表的旧数据
