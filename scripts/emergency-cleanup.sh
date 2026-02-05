#!/bin/bash
# 🚨 紧急清理脚本：磁盘满时立即执行
# 功能：激进清理所有可清理的文件

LOG_FILE="/var/log/telegram-bot-api-cleanup.log"
BOT_TOKEN="8165687613:AAEiBn4rBmg_KIHTlK9xXK2i-3k1ZSpjcBk"

# 构建 BOT_DIR 路径
BOT_DIR="/var/lib/telegram-bot-api/${BOT_TOKEN}"

# 如果新 token 目录不存在，尝试查找旧 token 目录
if [ ! -d "$BOT_DIR" ]; then
    OLD_DIR=$(find /var/lib/telegram-bot-api -maxdepth 1 -type d -name "8165687613:*" 2>/dev/null | head -1)
    if [ -n "$OLD_DIR" ]; then
        BOT_DIR="$OLD_DIR"
    fi
fi

echo "[$(date '+%Y-%m-%d %H:%M:%S')] 🚨 ===== 紧急清理开始 =====" >> "$LOG_FILE"
echo "[$(date '+%Y-%m-%d %H:%M:%S')] BOT_DIR: $BOT_DIR" >> "$LOG_FILE"

# 获取当前磁盘使用率
DISK_USAGE=$(df / | awk 'NR==2 {print $5}' | sed 's/%//')
DISK_AVAIL=$(df -h / | awk 'NR==2 {print $4}')
echo "[$(date '+%Y-%m-%d %H:%M:%S')] 当前磁盘使用率: ${DISK_USAGE}% (可用: ${DISK_AVAIL})" >> "$LOG_FILE"

# 1. 清理所有 temp 文件（超过15分钟）
if [ -d "$BOT_DIR/temp" ]; then
    TEMP_BEFORE=$(du -sh "$BOT_DIR/temp" 2>/dev/null | cut -f1)
    find "$BOT_DIR/temp" -type f -mmin +15 -delete 2>/dev/null
    TEMP_AFTER=$(du -sh "$BOT_DIR/temp" 2>/dev/null | cut -f1)
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] temp目录: 清理超过15分钟的文件 (清理前: ${TEMP_BEFORE}, 清理后: ${TEMP_AFTER})" >> "$LOG_FILE"
fi

# 2. 清理所有 HLS 目录（超过30分钟）
if [ -d "$BOT_DIR/videos" ]; then
    VIDEOS_BEFORE=$(du -sh "$BOT_DIR/videos" 2>/dev/null | cut -f1)
    HLS_DIRS_BEFORE=$(find "$BOT_DIR/videos" -type d -name "*_hls" 2>/dev/null | wc -l)
    
    # 激进清理：删除所有超过30分钟的 HLS 目录
    find "$BOT_DIR/videos" -type d -name "*_hls" -mmin +30 -exec rm -rf {} \; 2>/dev/null
    
    VIDEOS_AFTER=$(du -sh "$BOT_DIR/videos" 2>/dev/null | cut -f1)
    HLS_DIRS_AFTER=$(find "$BOT_DIR/videos" -type d -name "*_hls" 2>/dev/null | wc -l)
    HLS_DIRS_DELETED=$((HLS_DIRS_BEFORE - HLS_DIRS_AFTER))
    
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] videos目录: 删除 ${HLS_DIRS_DELETED} 个 HLS 目录 (清理前: ${VIDEOS_BEFORE}, 清理后: ${VIDEOS_AFTER})" >> "$LOG_FILE"
fi

# 获取清理后的磁盘使用率
DISK_USAGE_AFTER=$(df / | awk 'NR==2 {print $5}' | sed 's/%//')
DISK_AVAIL_AFTER=$(df -h / | awk 'NR==2 {print $4}')
echo "[$(date '+%Y-%m-%d %H:%M:%S')] 紧急清理完成，磁盘使用率: ${DISK_USAGE_AFTER}% (可用: ${DISK_AVAIL_AFTER})" >> "$LOG_FILE"
echo "[$(date '+%Y-%m-%d %H:%M:%S')] ===== 紧急清理结束 =====" >> "$LOG_FILE"
