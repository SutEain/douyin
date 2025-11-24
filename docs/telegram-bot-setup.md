# Telegram Bot 配置指南

## 🤖 你的 Bot 信息

- **Bot Username**: @tg_douyin_bot
- **Bot Token**: `8165687613:AAGPhuzFIwq2PRfxaLPlBnoGspLMBJjL-k8`
- **本地开发 URL**: https://fcf5027c3e4b.ngrok-free.app
- **登录页面**: https://fcf5027c3e4b.ngrok-free.app/login/telegram

## ✅ 已完成

- ✅ Edge Function 已部署到 Supabase
- ✅ 前端路由已添加 `/login/telegram`
- ✅ ngrok 隧道已启动

## 📋 现在需要做的事情

### 1. 配置 Telegram Bot Menu Button

与 @BotFather 对话，执行以下步骤：

```
1. 打开 Telegram，搜索 @BotFather
2. 发送 /setmenubutton
3. 选择 @tg_douyin_bot
4. 选择 "Configure menu button"
5. 输入按钮文字: 打开应用
6. 输入 Web App URL: https://fcf5027c3e4b.ngrok-free.app/login/telegram
```

### 2. 设置 Bot Commands（可选）

```
1. 与 @BotFather 对话
2. 发送 /setcommands
3. 选择 @tg_douyin_bot
4. 输入以下命令:

start - 启动应用
help - 帮助信息
```

### 3. 设置 Bot 描述（可选）

```
1. 与 @BotFather 对话
2. 发送 /setdescription
3. 选择 @tg_douyin_bot
4. 输入: 欢迎使用 Douyin 短视频平台！在这里发现精彩视频，分享你的生活。
```

### 4. 设置 Bot 简短描述（可选）

```
1. 与 @BotFather 对话
2. 发送 /setabouttext
3. 选择 @tg_douyin_bot
4. 输入: 短视频分享平台
```

## 🧪 测试步骤

### 步骤 1: 验证 Edge Function

在浏览器中访问：
```
https://zhlkanxfucnsatafeqdp.supabase.co/functions/v1/auth-tg-login
```

应该看到 CORS 错误或 400 错误（这是正常的，说明 Function 在运行）

### 步骤 2: 测试登录流程

1. **打开 Telegram**
   - 搜索 @tg_douyin_bot
   - 点击 "Start" 或直接打开对话

2. **点击 Menu Button**
   - 点击左下角的 Menu 按钮（或输入框左侧的按钮）
   - 应该会打开你的 Web App

3. **观察登录过程**
   - 页面应该自动开始登录
   - 查看浏览器控制台是否有错误
   - 成功后应该跳转到 /home

### 步骤 3: 验证数据库

登录成功后，在 Supabase Dashboard 中检查：

```sql
-- 查看新创建的用户
SELECT * FROM auth.users ORDER BY created_at DESC LIMIT 1;

-- 查看 profile
SELECT id, username, nickname, tg_user_id, tg_username, auth_provider 
FROM profiles 
WHERE auth_provider = 'tg' 
ORDER BY created_at DESC 
LIMIT 1;
```

## 🐛 调试技巧

### 查看 Edge Function 日志

访问: https://supabase.com/dashboard/project/zhlkanxfucnsatafeqdp/functions/auth-tg-login

点击 "Logs" 标签查看实时日志

### 查看浏览器控制台

在 Telegram WebApp 中：
1. 打开应用
2. 长按屏幕（iOS）或右键（Android/Desktop）
3. 选择 "Inspect" 或 "检查"
4. 查看 Console 和 Network 标签

### 常见问题

#### 1. "请在 Telegram 中打开此应用"

**原因**: 不在 Telegram WebApp 环境中

**解决**: 
- 确保通过 Telegram Bot 的 Menu Button 打开
- 不要直接在浏览器中访问

#### 2. "Invalid Telegram data"

**原因**: 
- initData 签名验证失败
- Bot Token 不正确

**解决**:
- 检查 Supabase Edge Function 环境变量中的 `TG_BOT_TOKEN`
- 确保 Token 正确无误

#### 3. CORS 错误

**原因**: Edge Function CORS 配置问题

**解决**: 已在代码中配置，应该不会出现此问题

#### 4. 登录后没有跳转

**原因**: 路由配置问题

**解决**: 
- 检查 `/home` 路由是否存在
- 查看浏览器控制台错误

## 📱 使用 Telegram Desktop 测试

如果你使用 Telegram Desktop，可以：

1. 打开 Telegram Desktop
2. 搜索 @tg_douyin_bot
3. 点击 Menu Button
4. 应用会在内置浏览器中打开
5. 可以打开开发者工具调试

## 🔧 ngrok 注意事项

### ngrok URL 会变化

每次重启 ngrok，URL 都会变化。如果 URL 变了：

1. 更新 Telegram Bot Menu Button URL
2. 重新配置 @BotFather

### 保持 ngrok 稳定

```bash
# 使用固定域名（需要 ngrok 付费账户）
ngrok http 5173 --domain=your-domain.ngrok-free.app
```

## ✨ 下一步

配置完成后，你可以：

1. ✅ 测试完整的登录流程
2. ✅ 查看数据库中的用户数据
3. ✅ 开始开发其他功能（视频上传、推荐等）
4. ✅ 准备部署到 Vercel（生产环境）

## 🚀 部署到生产环境

当准备好部署时：

1. **部署到 Vercel**
   ```bash
   vercel --prod
   ```

2. **更新 Telegram Bot URL**
   - 将 Menu Button URL 改为 Vercel 的生产 URL
   - 例如: https://douyin.vercel.app/login/telegram

3. **配置 Vercel 环境变量**
   - 在 Vercel Dashboard 中添加所有环境变量
   - 同 `.env.local` 的内容

## 📞 需要帮助？

如果遇到问题：

1. 查看 Edge Function 日志
2. 查看浏览器控制台
3. 检查数据库表
4. 验证环境变量配置

---

**当前状态**: 
- ✅ Edge Function 已部署
- ✅ 路由已配置
- ⏳ 等待配置 Telegram Bot Menu Button
