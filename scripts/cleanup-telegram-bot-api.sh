#!/bin/bash
# 🎯 Telegram Bot API 清理脚本 - 修复版
# 功能：清理 telegram-bot-api 产生的临时文件和 HLS 视频分片
# 策略：根据磁盘使用率动态调整清理时间阈值

LOG_FILE="/var/log/telegram-bot-api-cleanup.log"
BOT_TOKEN="8165687613:AAEiBn4rBmg_KIHTlK9xXK2i-3k1ZSpjcBk"

# 构建 BOT_DIR 路径
BOT_DIR="/var/lib/telegram-bot-api/${BOT_TOKEN}"

# 如果新 token 目录不存在，尝试查找旧 token 目录
if [ ! -d "$BOT_DIR" ]; then
    OLD_DIR=$(find /var/lib/telegram-bot-api -maxdepth 1 -type d -name "8165687613:*" 2>/dev/null | head -1)
    if [ -n "$OLD_DIR" ]; then
        BOT_DIR="$OLD_DIR"
        echo "[$(date '+%Y-%m-%d %H:%M:%S')] 使用找到的目录: $BOT_DIR" >> "$LOG_FILE"
    fi
fi

# 记录开始时间
echo "[$(date '+%Y-%m-%d %H:%M:%S')] ===== 开始清理任务 =====" >> "$LOG_FILE"
echo "[$(date '+%Y-%m-%d %H:%M:%S')] BOT_DIR: $BOT_DIR" >> "$LOG_FILE"

# 检查目录是否存在
if [ ! -d "$BOT_DIR" ]; then
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] 错误: BOT_DIR 不存在: $BOT_DIR" >> "$LOG_FILE"
    exit 1
fi

# 获取当前磁盘使用率
DISK_USAGE=$(df / | awk 'NR==2 {print $5}' | sed 's/%//')
DISK_AVAIL=$(df -h / | awk 'NR==2 {print $4}')
echo "[$(date '+%Y-%m-%d %H:%M:%S')] 当前磁盘使用率: ${DISK_USAGE}% (可用: ${DISK_AVAIL})" >> "$LOG_FILE"

# ===== 1. 清理 temp 目录（根据磁盘使用率动态调整）=====
if [ -d "$BOT_DIR/temp" ]; then
    TEMP_BEFORE=$(du -sh "$BOT_DIR/temp" 2>/dev/null | cut -f1)
    TEMP_COUNT_BEFORE=$(find "$BOT_DIR/temp" -type f 2>/dev/null | wc -l)
    
    # 根据磁盘使用率决定清理策略
    if [ "$DISK_USAGE" -ge 95 ]; then
        # 磁盘使用率 >= 95%，清理超过30分钟的文件
        find "$BOT_DIR/temp" -type f -mmin +30 -delete 2>/dev/null
    else
        # 磁盘使用率 < 95%，清理超过1小时的文件
        find "$BOT_DIR/temp" -type f -mmin +60 -delete 2>/dev/null
    fi
    
    TEMP_AFTER=$(du -sh "$BOT_DIR/temp" 2>/dev/null | cut -f1)
    TEMP_COUNT_AFTER=$(find "$BOT_DIR/temp" -type f 2>/dev/null | wc -l)
    TEMP_DELETED=$((TEMP_COUNT_BEFORE - TEMP_COUNT_AFTER))
    
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] temp目录: 删除 ${TEMP_DELETED} 个文件 (清理前: ${TEMP_BEFORE}, 清理后: ${TEMP_AFTER})" >> "$LOG_FILE"
fi

# ===== 2. 清理 videos 目录（HLS 分片文件）- 修复版，使用分钟而不是天数 =====
if [ -d "$BOT_DIR/videos" ]; then
    VIDEOS_BEFORE=$(du -sh "$BOT_DIR/videos" 2>/dev/null | cut -f1)
    VIDEOS_COUNT_BEFORE=$(find "$BOT_DIR/videos" -type f 2>/dev/null | wc -l)
    HLS_DIRS_BEFORE=$(find "$BOT_DIR/videos" -type d -name "*_hls" 2>/dev/null | wc -l)
    
    # 重新获取磁盘使用率（清理 temp 后可能变化）
    DISK_USAGE=$(df / | awk 'NR==2 {print $5}' | sed 's/%//')
    
    # 根据磁盘使用率决定清理策略（使用分钟，更精确，更激进）
    if [ "$DISK_USAGE" -ge 98 ]; then
        # 磁盘使用率 >= 98%，紧急清理：删除所有超过30分钟的 HLS 目录
        echo "[$(date '+%Y-%m-%d %H:%M:%S')] 🚨 紧急：磁盘使用率 >= 98%，清理超过30分钟的 HLS 目录" >> "$LOG_FILE"
        find "$BOT_DIR/videos" -type d -name "*_hls" -mmin +30 -exec rm -rf {} \; 2>/dev/null
        # 同时清理所有超过30分钟的 temp 文件
        find "$BOT_DIR/temp" -type f -mmin +30 -delete 2>/dev/null
    elif [ "$DISK_USAGE" -ge 95 ]; then
        # 磁盘使用率 >= 95%，清理超过1小时的 HLS 目录
        echo "[$(date '+%Y-%m-%d %H:%M:%S')] ⚠️ 警告：磁盘使用率 >= 95%，清理超过1小时的 HLS 目录" >> "$LOG_FILE"
        find "$BOT_DIR/videos" -type d -name "*_hls" -mmin +60 -exec rm -rf {} \; 2>/dev/null
    elif [ "$DISK_USAGE" -ge 90 ]; then
        # 磁盘使用率 >= 90%，清理超过2小时的 HLS 目录
        echo "[$(date '+%Y-%m-%d %H:%M:%S')] 磁盘使用率 >= 90%，清理超过2小时的 HLS 目录" >> "$LOG_FILE"
        find "$BOT_DIR/videos" -type d -name "*_hls" -mmin +120 -exec rm -rf {} \; 2>/dev/null
    elif [ "$DISK_USAGE" -ge 85 ]; then
        # 磁盘使用率 >= 85%，清理超过4小时的 HLS 目录
        echo "[$(date '+%Y-%m-%d %H:%M:%S')] 磁盘使用率 >= 85%，清理超过4小时的 HLS 目录" >> "$LOG_FILE"
        find "$BOT_DIR/videos" -type d -name "*_hls" -mmin +240 -exec rm -rf {} \; 2>/dev/null
    elif [ "$DISK_USAGE" -ge 80 ]; then
        # 磁盘使用率 >= 80%，清理超过6小时的 HLS 目录
        echo "[$(date '+%Y-%m-%d %H:%M:%S')] 磁盘使用率 >= 80%，清理超过6小时的 HLS 目录" >> "$LOG_FILE"
        find "$BOT_DIR/videos" -type d -name "*_hls" -mmin +360 -exec rm -rf {} \; 2>/dev/null
    else
        # 磁盘使用率 < 80%，清理超过12小时的 HLS 目录
        echo "[$(date '+%Y-%m-%d %H:%M:%S')] 磁盘使用率 < 80%，清理超过12小时的 HLS 目录" >> "$LOG_FILE"
        find "$BOT_DIR/videos" -type d -name "*_hls" -mmin +720 -exec rm -rf {} \; 2>/dev/null
    fi
    
    VIDEOS_AFTER=$(du -sh "$BOT_DIR/videos" 2>/dev/null | cut -f1)
    VIDEOS_COUNT_AFTER=$(find "$BOT_DIR/videos" -type f 2>/dev/null | wc -l)
    VIDEOS_DELETED=$((VIDEOS_COUNT_BEFORE - VIDEOS_COUNT_AFTER))
    HLS_DIRS_AFTER=$(find "$BOT_DIR/videos" -type d -name "*_hls" 2>/dev/null | wc -l)
    HLS_DIRS_DELETED=$((HLS_DIRS_BEFORE - HLS_DIRS_AFTER))
    
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] videos目录: 删除 ${VIDEOS_DELETED} 个文件, ${HLS_DIRS_DELETED} 个 HLS 目录 (清理前: ${VIDEOS_BEFORE}, 清理后: ${VIDEOS_AFTER})" >> "$LOG_FILE"
fi

# 获取清理后的磁盘使用率
DISK_USAGE_AFTER=$(df / | awk 'NR==2 {print $5}' | sed 's/%//')
DISK_AVAIL_AFTER=$(df -h / | awk 'NR==2 {print $4}')
echo "[$(date '+%Y-%m-%d %H:%M:%S')] 清理完成，磁盘使用率: ${DISK_USAGE_AFTER}% (可用: ${DISK_AVAIL_AFTER})" >> "$LOG_FILE"
echo "[$(date '+%Y-%m-%d %H:%M:%S')] ===== 清理任务结束 =====" >> "$LOG_FILE"
