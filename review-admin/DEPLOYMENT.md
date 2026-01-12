# 审核后台部署指南

## 快速开始

### 1. 数据库迁移

首先需要运行数据库迁移以创建审核员账号和权限：

```bash
cd /Applications/ServBay/www/douyin
supabase db reset  # 或者 supabase db push
```

这将执行 `supabase/migrations/20260113000012_create_reviewers.sql` 迁移，创建：
- `profiles.is_reviewer` 字段
- `check_is_reviewer()` 权限验证函数
- 3个审核员账号（shenhe1, shenhe2, shenhe3）
- 必要的 RLS 策略

### 2. 安装依赖

```bash
cd review-admin
npm install
```

### 3. 配置环境变量

确保 `.env` 文件存在并配置正确：

```env
VITE_SUPABASE_URL=https://zhlkanxfucnsatafeqdp.supabase.co
VITE_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
```

### 4. 启动开发服务器

```bash
npm run dev
```

访问: http://localhost:5175

## 生产部署

### 方式一：静态文件部署

1. 构建生产版本：
```bash
npm run build
```

2. 将 `dist` 目录部署到静态文件服务器（Nginx、Apache、Vercel、Netlify 等）

3. Nginx 配置示例：
```nginx
server {
    listen 80;
    server_name review-admin.yourdomain.com;
    
    root /path/to/review-admin/dist;
    index index.html;
    
    location / {
        try_files $uri $uri/ /index.html;
    }
}
```

### 方式二：Docker 部署

1. 创建 `Dockerfile`:
```dockerfile
FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
RUN npm run build

FROM nginx:alpine
COPY --from=builder /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
```

2. 构建并运行：
```bash
docker build -t review-admin .
docker run -d -p 5174:80 review-admin
```

### 方式三：PM2 部署（使用 Vite Preview）

1. 安装 PM2：
```bash
npm install -g pm2
```

2. 构建项目：
```bash
npm run build
```

3. 创建 `ecosystem.config.js`:
```javascript
module.exports = {
  apps: [{
    name: 'review-admin',
    script: 'npx',
    args: 'vite preview --port 5174 --host',
    cwd: '/path/to/review-admin',
    instances: 1,
    autorestart: true,
    watch: false,
    max_memory_restart: '1G',
    env: {
      NODE_ENV: 'production'
    }
  }]
}
```

4. 启动服务：
```bash
pm2 start ecosystem.config.js
pm2 save
pm2 startup
```

## 安全配置

### 1. 修改默认密码

生产环境部署后，立即修改审核员密码：

```sql
-- 连接到 Supabase 数据库执行
UPDATE auth.users 
SET encrypted_password = crypt('new_password', gen_salt('bf'))
WHERE email IN ('shenhe1@review.local', 'shenhe2@review.local', 'shenhe3@review.local');
```

### 2. 配置 HTTPS

生产环境必须使用 HTTPS，可以使用：
- Let's Encrypt (免费)
- Cloudflare (免费 CDN + SSL)
- 云服务商提供的 SSL 证书

### 3. 配置 CORS

如果前端和后端在不同域名，需要在 Supabase 中配置 CORS：
1. 登录 Supabase Dashboard
2. 进入 Settings > API
3. 在 "CORS Settings" 中添加审核后台域名

### 4. 环境变量保护

生产环境的 `.env` 文件不应提交到 Git：
```bash
# .gitignore 已包含
.env
.env.local
.env.production
```

## 监控和日志

### 使用 PM2 监控

```bash
# 查看状态
pm2 status

# 查看日志
pm2 logs review-admin

# 查看实时监控
pm2 monit
```

### 使用 Nginx 日志

```nginx
access_log /var/log/nginx/review-admin-access.log;
error_log /var/log/nginx/review-admin-error.log;
```

## 性能优化

### 1. 启用 Gzip 压缩

Nginx 配置：
```nginx
gzip on;
gzip_types text/plain text/css application/json application/javascript text/xml application/xml application/xml+rss text/javascript;
gzip_min_length 1000;
```

### 2. 启用浏览器缓存

```nginx
location ~* \.(js|css|png|jpg|jpeg|gif|ico|svg)$ {
    expires 1y;
    add_header Cache-Control "public, immutable";
}
```

### 3. CDN 加速

建议将静态资源部署到 CDN：
- Cloudflare
- 阿里云 OSS + CDN
- 腾讯云 COS + CDN

## 故障排查

### 问题 1: 登录失败

检查：
1. Supabase URL 和 Anon Key 是否正确
2. 审核员账号是否已创建
3. 数据库迁移是否成功执行

### 问题 2: 权限不足

检查：
1. 用户的 `is_reviewer` 字段是否为 `true`
2. RLS 策略是否正确配置
3. `check_is_reviewer()` 函数是否存在

### 问题 3: 无法加载数据

检查：
1. Supabase 服务是否正常
2. 网络连接是否正常
3. 浏览器控制台是否有错误信息

## 备份和恢复

### 数据库备份

```bash
# 使用 Supabase CLI
supabase db dump -f backup.sql

# 恢复
supabase db reset
psql -h your-db-host -U postgres -d postgres -f backup.sql
```

### 代码备份

```bash
# Git 备份
git add .
git commit -m "backup: review-admin"
git push origin main
```

## 更新和维护

### 更新依赖

```bash
# 检查过时的包
npm outdated

# 更新所有依赖
npm update

# 更新特定包
npm install @refinedev/core@latest
```

### 数据库迁移

添加新迁移后：
```bash
supabase db push
```

## 技术支持

如有问题，请检查：
1. 项目 README.md
2. Supabase 文档: https://supabase.com/docs
3. Refine.js 文档: https://refine.dev/docs
4. Ant Design 文档: https://ant.design/docs/react/introduce-cn

