# Vercel Cron 配置说明

## 概述

使用 Vercel Cron Jobs 实现每3秒轮询一次 Supabase Edge Function，这是最简单的方案。

## 已完成的配置

### 1. API 路由文件
- `api/pc28-polling.ts` - Vercel API 路由，调用 Supabase Edge Function

### 2. Vercel 配置
- `vercel.json` - 已添加 cron 配置：
  ```json
  {
    "crons": [
      {
        "path": "/api/pc28-polling",
        "schedule": "*/3 * * * * *"
      }
    ]
  }
  ```

### 3. 数据库清理
- 已清理所有 Supabase pg_cron 任务（不再需要）

## 部署步骤

### 1. 推送到 Git 仓库

```bash
git add api/pc28-polling.ts vercel.json
git commit -m "feat: 添加 Vercel Cron 每3秒轮询 PC28"
git push
```

### 2. Vercel 自动部署

Vercel 会自动检测到 `vercel.json` 中的 cron 配置，并创建 cron job。

### 3. 验证 Cron Job

1. 登录 [Vercel Dashboard](https://vercel.com/dashboard)
2. 选择你的项目
3. 进入 **Settings** → **Cron Jobs**
4. 应该看到 `pc28-polling` cron job，每3秒执行一次

### 4. 查看日志

在 Vercel Dashboard → **Deployments** → 选择最新部署 → **Functions** → `/api/pc28-polling` → **Logs**

## Cron 表达式说明

`*/3 * * * * *` 表示：
- 每3秒执行一次
- 格式：`秒 分 时 日 月 周`

## 工作原理

1. Vercel Cron 每3秒调用 `/api/pc28-polling`
2. API 路由调用 Supabase Edge Function
3. Edge Function 处理 PC28 游戏逻辑（开盘、封盘、结算等）

## 成本

- **Vercel 免费版**：每月 100,000 次函数调用
- **每3秒执行**：每天约 28,800 次，每月约 864,000 次
- ⚠️ **超出免费额度**，需要升级到 Pro 计划（$20/月）

或者可以调整频率为每10秒执行一次（`*/10 * * * * *`），每月约 259,200 次，在免费额度内。

## 故障排查

### 问题：Cron Job 没有执行

1. 检查 `vercel.json` 配置是否正确
2. 检查 Vercel Dashboard 中是否显示了 cron job
3. 查看 Vercel 日志

### 问题：API 返回错误

1. 检查 Supabase Edge Function 是否正常运行
2. 查看 Edge Function 日志
3. 检查网络连接

## 优势

✅ **简单**：只需一个 API 文件和配置文件  
✅ **自动**：Vercel 自动管理 cron job  
✅ **可靠**：Vercel 的 cron 服务稳定  
✅ **秒级**：支持秒级调度（Supabase pg_cron 不支持）
