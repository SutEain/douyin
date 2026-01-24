# PC28 轮询脚本使用说明

## 安装依赖

确保已安装 Node.js (v18+) 和 pm2：

```bash
npm install pm2 -g
```

## 配置环境变量

在项目根目录创建 `.env` 文件（如果还没有），不需要额外配置，脚本会直接调用 Supabase Edge Function。

## 启动服务

### 方式1: 使用 PM2 配置文件（推荐）

```bash
pm2 start ecosystem.config.cjs
```

### 方式2: 直接使用 PM2 命令

```bash
pm2 start scripts/pc28-polling.js --name pc28-polling
```

## PM2 常用命令

```bash
# 查看状态
pm2 status

# 查看日志
pm2 logs pc28-polling

# 查看实时日志（最后100行）
pm2 logs pc28-polling --lines 100

# 重启服务
pm2 restart pc28-polling

# 停止服务
pm2 stop pc28-polling

# 删除服务
pm2 delete pc28-polling

# 保存当前 PM2 进程列表（开机自启）
pm2 save
pm2 startup  # 按照提示执行命令
```

## 日志位置

- 标准输出: `./logs/pc28-polling-out.log`
- 错误输出: `./logs/pc28-polling-error.log`

## 注意事项

1. 脚本每5秒执行一次，调用 Supabase Edge Function
2. 如果连续10次失败，脚本会自动退出（需要手动重启）
3. 单次请求超时时间为30秒
4. 网络错误会自动重试3次
5. 确保服务器有网络访问权限访问 Supabase Edge Function

## 监控

可以使用 PM2 的监控功能：

```bash
pm2 monit
```
