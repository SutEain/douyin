# 🛠️ 开发登录功能

## 📋 功能说明

用于本地开发时快速登录测试，无需在 Telegram 环境中打开应用。

## 🚀 使用方法

### 1. 部署 app-server 函数

开发登录功能已集成到 `app-server` 中，部署 `app-server` 即可：

```bash
# 部署 app-server 函数到 Supabase
supabase functions deploy app-server
```

**注意**：如果你的 `app-server` 已经部署过，需要重新部署一次以更新代码。

### 2. 获取你的 user_id

有几种方式获取你的 user_id：

**方式 1：从 Supabase Dashboard**
- 打开 Supabase 项目
- 进入 `Table Editor` → `profiles` 表
- 找到你的用户记录，复制 `id` 字段

**方式 2：从浏览器控制台**
- 在 Telegram 中打开应用并登录
- 打开浏览器控制台（F12）
- 执行：`console.log(store.userinfo.uid)` 或查看 Network 请求

### 3. 使用开发登录

访问以下 URL（替换 `your_user_id`）：

```
http://localhost:5173/login/dev?id=your_user_id
```

示例：
```
http://localhost:5173/login/dev?id=43efcb5e-23fa-43fa-a379-c3a8c406ec98
```

### 4. 自动跳转

登录成功后会自动跳转到首页 `/home`，然后就可以正常使用所有功能了。

## 📝 工作流程

```
1. 访问 /login/dev?id=xxx
   ↓
2. 调用 Supabase Edge Function: /dev-login
   ↓
3. 从数据库查询用户数据（不需要 token）
   ↓
4. 设置用户数据到 store.userinfo
   ↓
5. 跳转到 /home
   ↓
6. 正常使用（Mock.js 拦截所有 API 请求）
```

## 🔧 技术实现

### 后端：app-server 路由

**路径**：`supabase/functions/app-server/index.ts`

**功能**：
- 在 `app-server` 中添加 `/dev-login` 路由
- 接收参数：`user_id`
- 使用 Service Role Key 直接查询数据库
- 不需要验证 token（开发专用）
- 返回完整的用户 profile 数据

**API**：
```
GET /app-server/dev-login?user_id=xxx

Response:
{
  "code": 0,
  "msg": "success",
  "data": {
    "id": "...",
    "nickname": "...",
    "avatar_url": "...",
    ...完整的 profile 数据
  }
}
```

### 前端：Vue 路由页面

**路径**：`src/pages/login/DevLogin.vue`

**功能**：
1. 获取 URL 参数 `id`
2. 调用 `/dev-login?user_id=xxx`
3. 设置用户数据到 `store.userinfo`
4. 跳转到 `/home`

## ⚠️ 注意事项

1. **仅用于开发**：此功能只用于本地开发，不要在生产环境使用
2. **安全性**：开发登录函数跳过了所有权限验证
3. **清理**：开发完成后可以删除 `dev-login` 函数
4. **Mock 数据**：登录后的操作（点赞、评论等）会被 Mock.js 拦截

## 🐛 故障排除

### 问题 1：找不到用户

**错误信息**：`用户不存在`

**解决方案**：
- 检查 `user_id` 是否正确
- 确认该用户在 `profiles` 表中存在

### 问题 2：缺少配置

**错误信息**：`缺少 APP_SERVER_URL 配置`

**解决方案**：
检查 `.env` 或环境变量中是否配置了：
```
VITE_APP_SERVER_URL=你的Supabase函数地址
VITE_SUPABASE_ANON_KEY=你的Anon Key
```

### 问题 3：CORS 错误

**解决方案**：
确保 `dev-login` 函数已正确部署到 Supabase，本地 `supabase start` 可能会有 CORS 问题。

## 🗑️ 删除开发登录功能

当不再需要时，可以删除：

### 1. 删除 app-server 中的路由

在 `supabase/functions/app-server/index.ts` 中删除：
```typescript
// 删除路由配置
if (route === '/dev-login' && method === 'GET') {
  return handleDevLogin(req)
}

// 删除函数定义
async function handleDevLogin(req: Request): Promise<Response> {
  // ... 整个函数
}
```

然后重新部署：
```bash
supabase functions deploy app-server
```

### 2. 删除前端文件

```bash
# 删除前端页面
rm src/pages/login/DevLogin.vue

# 删除此说明文档
rm DEV_LOGIN_README.md
```

### 3. 删除路由配置

在 `src/router/routes.ts` 中删除：
```typescript
{
  path: '/login/dev',
  component: () => import('@/pages/login/DevLogin.vue')
},
```

## 📚 相关文件

- `supabase/functions/app-server/index.ts` - 开发登录路由（在 app-server 中）
- `src/pages/login/DevLogin.vue` - 开发登录页面
- `src/router/routes.ts` - 路由配置
- `DEV_LOGIN_README.md` - 本文档

---

**Happy Coding! 🎉**

