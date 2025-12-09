# 抖音管理后台

基于 Refine + Ant Design + Supabase 构建的管理后台。

## 快速开始

### 1. 安装依赖

```bash
cd admin
npm install
```

### 2. 配置环境变量

创建 `.env.local` 文件：

```bash
cp .env.example .env.local
```

编辑 `.env.local`，填入 Supabase 配置：

```env
VITE_SUPABASE_URL=https://你的项目ID.supabase.co
VITE_SUPABASE_ANON_KEY=你的anon密钥
```

### 3. 启动开发服务器

```bash
npm run dev
```

访问 http://localhost:5174

### 4. 登录

使用 Supabase 的管理员账号登录。

## 功能模块

- ✅ 视频管理（列表、详情、编辑、审核）
- ✅ 用户管理（列表、详情、编辑）
- 🚧 推荐池管理（即将上线）
- 🚧 评论管理（即将上线）
- 🚧 数据统计（即将上线）

## 技术栈

- **前端框架**: React 18
- **UI 库**: Ant Design 5
- **状态管理**: Refine Core
- **路由**: React Router v6
- **数据源**: Supabase
- **构建工具**: Vite
- **语言**: TypeScript

## 部署

```bash
npm run build
```

构建产物在 `dist/` 目录，可以部署到 Vercel / Cloudflare Pages。

