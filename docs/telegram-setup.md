# Telegram 登录环境配置指南

## 📋 需要配置的环境变量

### 1. 前端环境变量 (.env.local)

创建 `.env.local` 文件（已在 .gitignore 中，不会提交到 Git）：

```env
# Supabase 配置
VITE_SUPABASE_URL=https://zhlkanxfucnsatafeqdp.supabase.co
VITE_SUPABASE_ANON_KEY=<从 Supabase Dashboard 获取>

# Telegram Bot 配置
VITE_TG_BOT_USERNAME=tg_douyin_bot
VITE_TG_BOT_NAME=@tg_douyin_bot
```

**如何获取 SUPABASE_ANON_KEY:**
1. 访问 https://supabase.com/dashboard/project/zhlkanxfucnsatafeqdp/settings/api
2. 复制 "Project API keys" 下的 "anon" "public" key

### 2. Supabase Edge Function 环境变量

在 Supabase Dashboard 中配置：

1. 访问 https://supabase.com/dashboard/project/zhlkanxfucnsatafeqdp/settings/functions
2. 添加环境变量：

```
TG_BOT_TOKEN=8165687613:AAGPhuzFIwq2PRfxaLPlBnoGspLMBJjL-k8
```

⚠️ **重要**: Bot Token 是敏感信息，只在 Supabase 后端使用，不要暴露在前端！

## 🤖 Telegram Bot 配置步骤

### 1. 设置 Bot Commands

与 @BotFather 对话，设置以下命令：

```
/setcommands

start - 启动应用
help - 帮助信息
```

### 2. 配置 Mini App

与 @BotFather 对话：

```
/newapp
选择你的 bot: @tg_douyin_bot
输入 App 名称: Douyin
输入描述: 短视频分享平台
上传图标（可选）
输入 Web App URL: https://your-vercel-app.vercel.app
```

### 3. 设置 Bot 描述

```
/setdescription
选择 @tg_douyin_bot
输入: 欢迎使用 Douyin 短视频平台！
```

### 4. 设置 Bot 头像（可选）

```
/setuserpic
选择 @tg_douyin_bot
上传头像图片
```

## 📱 Telegram Mini App 配置

### 方式 1: 使用 Menu Button（推荐）

```
/setmenubutton
选择 @tg_douyin_bot
选择 "Configure menu button"
输入按钮文字: 打开应用
输入 Web App URL: https://your-vercel-app.vercel.app
```

### 方式 2: 使用 Inline Button

在你的 Bot 代码中添加：

```python
from telegram import InlineKeyboardButton, InlineKeyboardMarkup, WebAppInfo

keyboard = [
    [InlineKeyboardButton("🎬 打开 Douyin", web_app=WebAppInfo(url="https://your-vercel-app.vercel.app"))]
]
reply_markup = InlineKeyboardMarkup(keyboard)
```

## 🚀 Vercel 部署配置

### 1. 环境变量

在 Vercel Dashboard 中添加：

```
VITE_SUPABASE_URL=https://zhlkanxfucnsatafeqdp.supabase.co
VITE_SUPABASE_ANON_KEY=<your_anon_key>
VITE_TG_BOT_USERNAME=tg_douyin_bot
VITE_TG_BOT_NAME=@tg_douyin_bot
```

### 2. 构建配置

确保 `vercel.json` 或项目设置中：

```json
{
  "buildCommand": "npm run build",
  "outputDirectory": "dist",
  "framework": "vite"
}
```

## ✅ 验证清单

配置完成后，检查：

- [ ] `.env.local` 文件已创建（本地开发用）
- [ ] Supabase Dashboard 中已添加 `TG_BOT_TOKEN`
- [ ] Telegram Bot 已配置 Mini App URL
- [ ] Vercel 环境变量已配置
- [ ] 可以访问 `https://api.telegram.org/bot8165687613:AAGPhuzFIwq2PRfxaLPlBnoGspLMBJjL-k8/getMe` 验证 Bot Token

## 🔧 本地开发测试

### 使用 Telegram Web 测试

1. 访问 https://web.telegram.org/
2. 找到 @tg_douyin_bot
3. 点击 Menu Button 或发送 /start
4. 应该能打开你的本地开发服务器（需要使用 ngrok 等工具暴露本地端口）

### 使用 ngrok 暴露本地服务

```bash
# 安装 ngrok
brew install ngrok

# 启动本地开发服务器
npm run dev

# 在另一个终端暴露端口
ngrok http 5173

# 将 ngrok 提供的 HTTPS URL 配置到 Telegram Bot
```

## 📝 下一步

配置完成后，我们将：

1. ✅ 创建 Supabase Edge Functions
2. ✅ 实现前端 Telegram 登录组件
3. ✅ 集成 Supabase Client
4. ✅ 测试完整登录流程
