# 磁盘清理定时任务设置指南

## 概述

本指南说明如何设置定时任务，让 `cleanup_disk.sh` 脚本每小时自动执行一次。

## 快速安装

### 方式1：使用自动安装脚本（推荐）

```bash
# 1. 上传脚本到服务器
# cleanup_disk.sh 和 setup_cron_cleanup.sh 都需要上传

# 2. 执行安装脚本
chmod +x setup_cron_cleanup.sh
bash setup_cron_cleanup.sh
```

### 方式2：手动设置

```bash
# 1. 确保脚本有执行权限
chmod +x cleanup_disk.sh

# 2. 获取脚本的绝对路径
SCRIPT_PATH=$(cd "$(dirname "$0")" && pwd)/cleanup_disk.sh
echo "脚本路径: $SCRIPT_PATH"

# 3. 编辑 crontab
crontab -e

# 4. 添加以下行（每小时的第0分钟执行）
0 * * * * /path/to/cleanup_disk.sh >> /var/log/telegram-bot-api-cleanup.log 2>&1

# 注意：将 /path/to/cleanup_disk.sh 替换为实际的脚本路径
```

## Cron 时间格式说明

```
0 * * * * 命令
│ │ │ │ │
│ │ │ │ └─── 星期几 (0-7, 0和7都表示星期日)
│ │ │ └───── 月份 (1-12)
│ │ └─────── 日期 (1-31)
│ └───────── 小时 (0-23)
└─────────── 分钟 (0-59)
```

**示例：**
- `0 * * * *` - 每小时的第0分钟执行（每小时执行一次）
- `*/30 * * * *` - 每30分钟执行一次
- `0 */2 * * *` - 每2小时执行一次
- `0 0 * * *` - 每天午夜执行一次

## 验证设置

### 查看 cron 任务列表

```bash
crontab -l
```

### 查看日志

```bash
# 实时查看日志
tail -f /var/log/telegram-bot-api-cleanup.log

# 查看最近的日志
tail -100 /var/log/telegram-bot-api-cleanup.log

# 查看今天的日志
grep "$(date '+%Y-%m-%d')" /var/log/telegram-bot-api-cleanup.log
```

### 手动测试执行

```bash
# 手动执行脚本，验证是否正常工作
bash cleanup_disk.sh

# 或者使用绝对路径
/path/to/cleanup_disk.sh
```

## 管理定时任务

### 编辑 cron 任务

```bash
crontab -e
```

### 删除所有 cron 任务

```bash
crontab -r
```

### 删除特定任务

```bash
# 编辑 crontab，删除对应行
crontab -e

# 或者使用命令删除（删除包含 cleanup_disk.sh 的行）
crontab -l | grep -v cleanup_disk.sh | crontab -
```

## 日志管理

### 日志文件位置

- 日志文件: `/var/log/telegram-bot-api-cleanup.log`
- 日志格式: `[YYYY-MM-DD HH:MM:SS] 消息内容`

### 日志轮转（可选）

如果日志文件过大，可以设置日志轮转：

```bash
# 创建 logrotate 配置
sudo tee /etc/logrotate.d/telegram-bot-api-cleanup > /dev/null <<EOF
/var/log/telegram-bot-api-cleanup.log {
    daily
    rotate 7
    compress
    delaycompress
    missingok
    notifempty
    create 0644 root root
}
EOF
```

## 故障排查

### 问题1：脚本没有执行

**检查：**
1. 确认 cron 服务是否运行：`systemctl status cron` 或 `service cron status`
2. 检查脚本路径是否正确：`ls -l /path/to/cleanup_disk.sh`
3. 检查脚本权限：`chmod +x cleanup_disk.sh`
4. 查看系统日志：`grep CRON /var/log/syslog`

### 问题2：权限不足

**解决：**
```bash
# 确保脚本有执行权限
chmod +x cleanup_disk.sh

# 如果日志目录权限不足
sudo mkdir -p /var/log
sudo chmod 755 /var/log
```

### 问题3：找不到脚本路径

**解决：**
- 使用绝对路径而不是相对路径
- 在 cron 任务中使用完整路径：`/full/path/to/cleanup_disk.sh`

## 注意事项

1. **脚本路径**：cron 任务必须使用绝对路径
2. **环境变量**：cron 执行时环境变量可能不同，建议在脚本中设置完整路径
3. **日志轮转**：定期清理日志文件，避免占用过多磁盘空间
4. **测试**：设置定时任务前，先手动执行脚本验证功能正常

## 相关文件

- `cleanup_disk.sh` - 磁盘清理脚本
- `setup_cron_cleanup.sh` - 自动安装脚本
- `/var/log/telegram-bot-api-cleanup.log` - 执行日志
