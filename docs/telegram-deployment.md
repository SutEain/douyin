# Telegram 登录 - 部署和测试指南

## ✅ 已完成的工作

### 1. Edge Functions（后端）
- ✅ `_shared/cors.ts` - CORS 配置
- ✅ `_shared/response.ts` - 统一响应格式
- ✅ `_shared/telegram.ts` - TG 签名验证
- ✅ `server/index.ts` - TG 登录主逻辑

### 2. 前端集成
- ✅ `src/utils/supabase.ts` - Supabase 客户端
- ✅ `src/api/auth.ts` - 认证 API
- ✅ `src/pages/login/TelegramLogin.vue` - 登录页面

## 🚀 部署步骤

### 步骤 1: 安装依赖

```bash
# 安装 Supabase JS 客户端
npm install @supabase/supabase-js
```

### 步骤 2: 配置环境变量

#### 2.1 本地开发 (.env.local)

创建 `.env.local` 文件：

```env
VITE_SUPABASE_URL=https://zhlkanxfucnsatafeqdp.supabase.co
VITE_SUPABASE_ANON_KEY=<从 Dashboard 获取>
VITE_TG_BOT_USERNAME=dydy
VITE_TG_BOT_NAME=@dydy
```

**获取 ANON_KEY:**
1. 访问 https://supabase.com/dashboard/project/zhlkanxfucnsatafeqdp/settings/api
2. 复制 "anon" "public" key

#### 2.2 Supabase Edge Functions

在 Supabase Dashboard 配置环境变量：

1. 访问 https://supabase.com/dashboard/project/zhlkanxfucnsatafeqdp/settings/functions
2. 添加环境变量：

```
TG_BOT_TOKEN=8165687613:AAGPhuzFIwq2PRfxaLPlBnoGspLMBJjL-k8
```

### 步骤 3: 部署 Edge Functions

```bash
# 安装 Supabase CLI（如果还没有）
npm install -g supabase

# 登录
npx supabase login

# 链接项目
npx supabase link --project-ref zhlkanxfucnsatafeqdp

# 部署 Edge Functions
npx supabase functions deploy server
```

### 步骤 4: 添加路由

在 `src/router/index.ts` 中添加登录路由：

```typescript
{
  path: '/login/telegram',
  name: 'TelegramLogin',
  component: () => import('@/pages/login/TelegramLogin.vue')
}
```

### 步骤 5: 配置 Telegram Bot

#### 5.1 设置 Menu Button

与 @BotFather 对话：

```
/setmenubutton
选择 @dydy
选择 "Configure menu button"
输入按钮文字: 打开应用
输入 Web App URL: https://your-app.vercel.app/login/telegram
```

#### 5.2 设置 Commands

```
/setcommands
选择 @dydy

start - 启动应用
help - 帮助信息
```

### 步骤 6: 部署到 Vercel

#### 6.1 配置环境变量

在 Vercel Dashboard 中添加：

```
VITE_SUPABASE_URL=https://zhlkanxfucnsatafeqdp.supabase.co
VITE_SUPABASE_ANON_KEY=<your_anon_key>
VITE_TG_BOT_USERNAME=dydy
VITE_TG_BOT_NAME=@dydy
```

#### 6.2 部署

```bash
# 安装 Vercel CLI
npm install -g vercel

# 部署
vercel --prod
```

## 🧪 测试流程

### 本地测试（使用 ngrok）

```bash
# 1. 启动本地开发服务器
npm run dev

# 2. 在另一个终端启动 ngrok
ngrok http 5173

# 3. 将 ngrok 提供的 HTTPS URL 配置到 Telegram Bot
# 例如: https://abc123.ngrok.io/login/telegram

# 4. 在 Telegram 中打开 @dydy
# 5. 点击 Menu Button 测试登录
```

### 生产环境测试

```bash
# 1. 部署到 Vercel
vercel --prod

# 2. 获取部署 URL（例如: https://douyin.vercel.app）

# 3. 更新 Telegram Bot Menu Button URL
# 访问 @BotFather，设置为: https://douyin.vercel.app/login/telegram

# 4. 在 Telegram 中测试
```

## 🔍 验证清单

### Edge Function 验证

```bash
# 测试 Edge Function 是否部署成功
curl -X POST https://zhlkanxfucnsatafeqdp.supabase.co/functions/v1/server \
  -H "Content-Type: application/json" \
  -d '{"initData": "test"}'

# 应该返回错误（因为 initData 无效），但证明 Function 在运行
```

### 数据库验证

登录成功后，在 Supabase Dashboard 中检查：

```sql
-- 查看新创建的用户
SELECT * FROM auth.users ORDER BY created_at DESC LIMIT 5;

-- 查看 profiles 表
SELECT * FROM profiles ORDER BY created_at DESC LIMIT 5;

-- 验证 TG 用户信息
SELECT id, username, nickname, tg_user_id, tg_username, auth_provider 
FROM profiles 
WHERE auth_provider = 'tg';
```

### 前端验证

1. **检查 Session**
   ```javascript
   // 在浏览器控制台
   const { data } = await supabase.auth.getSession()
   console.log(data.session)
   ```

2. **检查用户信息**
   ```javascript
   const { data } = await supabase.auth.getUser()
   console.log(data.user)
   ```

## 🐛 常见问题

### 1. "Missing Supabase environment variables"

**解决**: 确保 `.env.local` 文件存在且包含正确的环境变量

### 2. "Invalid Telegram data"

**原因**: 
- TG Bot Token 不正确
- initData 签名验证失败
- initData 已过期（超过 5 分钟）

**解决**: 
- 检查 Supabase Edge Function 环境变量中的 `TG_BOT_TOKEN`
- 确保在 Telegram WebApp 中打开

### 3. "请在 Telegram 中打开此应用"

**原因**: 不在 Telegram WebApp 环境中

**解决**: 
- 通过 Telegram Bot 的 Menu Button 打开
- 或在 Telegram 内置浏览器中打开

### 4. Edge Function 部署失败

**解决**:
```bash
# 查看部署日志
npx supabase functions deploy server --debug

# 检查函数状态
npx supabase functions list
```

### 5. CORS 错误

**解决**: 确保 Edge Function 中的 CORS 配置正确，已经在 `_shared/cors.ts` 中配置

## 📊 监控和日志

### 查看 Edge Function 日志

1. 访问 https://supabase.com/dashboard/project/zhlkanxfucnsatafeqdp/functions
2. 点击 `server`
3. 查看 "Logs" 标签

### 查看认证日志

1. 访问 https://supabase.com/dashboard/project/zhlkanxfucnsatafeqdp/auth/users
2. 查看新注册的用户

## 🎯 下一步

登录功能完成后，可以：

1. ✅ 实现邮箱绑定功能
2. ✅ 添加用户个人资料编辑
3. ✅ 实现视频上传功能
4. ✅ 集成推荐算法
5. ✅ 添加社交功能（关注、点赞、评论）

## 📝 开发提示

### 调试 Telegram InitData

在开发环境中，可以使用以下代码模拟 Telegram 环境：

```javascript
// 仅用于开发测试
window.Telegram = {
  WebApp: {
    initData: 'query_id=test&user={"id":123456,"first_name":"Test","username":"testuser"}&auth_date=' + Math.floor(Date.now() / 1000) + '&hash=test',
    initDataUnsafe: {
      user: {
        id: 123456,
        first_name: 'Test',
        username: 'testuser'
      }
    },
    expand: () => console.log('expand'),
    close: () => console.log('close'),
    ready: () => console.log('ready')
  }
}
```

⚠️ **注意**: 这只能用于 UI 测试，真实登录仍需要有效的 Telegram initData。
