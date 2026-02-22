#!/bin/bash

# 磁盘清理脚本 - 全部清理模式
# 清理所有 telegram-bot-api 临时文件和 HLS 目录
# 
# 设置每小时自动执行：
# crontab -e
# 添加：0 * * * * /path/to/cleanup_disk.sh >> /var/log/telegram-bot-api-cleanup.log 2>&1

# 设置日志文件路径
LOG_DIR="/var/log"
LOG_FILE="$LOG_DIR/telegram-bot-api-cleanup.log"
TIMESTAMP=$(date '+%Y-%m-%d %H:%M:%S')

# 日志函数
log() {
    echo "[$TIMESTAMP] $1" | tee -a "$LOG_FILE"
}

# 开始执行
log "=========================================="
log "开始执行磁盘清理任务"
log "=========================================="

# 1. 检查当前磁盘使用情况
log "=== 清理前磁盘使用情况 ==="
df -h / | grep "/$" | tee -a "$LOG_FILE"

# 2. 设置 BOT_DIR 变量（优先使用固定路径，如果不存在则查找）
BOT_DIR="/var/lib/telegram-bot-api/8165687613:AAE3ZEYOwG7nEY2oyaBgRIJ5TVBeMXdyI6c"

# 3. 如果目录不存在，查找旧token目录
if [ ! -d "$BOT_DIR" ]; then
    OLD_DIR=$(find /var/lib/telegram-bot-api -maxdepth 1 -type d -name "8165687613:*" 2>/dev/null | head -1)
    if [ -n "$OLD_DIR" ]; then
        BOT_DIR="$OLD_DIR"
        log "使用找到的目录: $BOT_DIR"
    fi
fi

# 4. 检查目录是否存在
if [ ! -d "$BOT_DIR" ]; then
    log "错误: 找不到 telegram-bot-api 目录"
    exit 1
fi

log "BOT目录: $BOT_DIR"
ls -ld "$BOT_DIR" | tee -a "$LOG_FILE"

# 5. 显示清理前状态
log ""
log "=== 清理前状态 ==="
du -sh "$BOT_DIR/temp" 2>/dev/null | tee -a "$LOG_FILE" || log "temp目录不存在"
du -sh "$BOT_DIR/videos" 2>/dev/null | tee -a "$LOG_FILE" || log "videos目录不存在"
log ""
log "HLS目录数量: $(find "$BOT_DIR/videos" -type d -name "*_hls" 2>/dev/null | wc -l)"
log "temp文件数量: $(find "$BOT_DIR/temp" -type f 2>/dev/null | wc -l)"
log ""
log "videos目录下文件类型统计:"
find "$BOT_DIR/videos" -maxdepth 1 -type f 2>/dev/null | wc -l | xargs -I {} log "  文件数: {}"
find "$BOT_DIR/videos" -maxdepth 1 -type d ! -path "$BOT_DIR/videos" 2>/dev/null | wc -l | xargs -I {} log "  目录数: {}"
log ""
log "videos目录下前10个最大文件/目录:"
du -sh "$BOT_DIR/videos"/* 2>/dev/null | sort -rh | head -10 | tee -a "$LOG_FILE"

# 6. 清理所有 temp 文件
log ""
log "=== 清理所有 temp 文件 ==="
find "$BOT_DIR/temp" -type f -delete 2>/dev/null
du -sh "$BOT_DIR/temp" 2>/dev/null | tee -a "$LOG_FILE" || log "temp目录已清空"

# 7. 清理所有 HLS 目录
log ""
log "=== 清理所有 HLS 目录 ==="
find "$BOT_DIR/videos" -type d -name "*_hls" -exec rm -rf {} \; 2>/dev/null
log "所有 HLS 目录已删除"

# 8. 清理 videos 目录下的所有文件（保留目录结构）
log ""
log "=== 清理 videos 目录下的所有文件 ==="
find "$BOT_DIR/videos" -type f -delete 2>/dev/null
log "videos 目录下的所有文件已删除"

# 9. 清理 videos 目录下的所有空目录（除了 videos 本身）
log ""
log "=== 清理 videos 目录下的空目录 ==="
find "$BOT_DIR/videos" -mindepth 1 -type d -empty -delete 2>/dev/null
log "空目录已清理"

# 10. 显示清理后状态
log ""
log "=== 清理后状态 ==="
du -sh "$BOT_DIR/temp" 2>/dev/null | tee -a "$LOG_FILE" || log "temp目录不存在或已清空"
du -sh "$BOT_DIR/videos" 2>/dev/null | tee -a "$LOG_FILE" || log "videos目录不存在"
log ""
log "剩余 HLS 目录数: $(find "$BOT_DIR/videos" -type d -name "*_hls" 2>/dev/null | wc -l)"
log "剩余 temp 文件数: $(find "$BOT_DIR/temp" -type f 2>/dev/null | wc -l)"
log "剩余 videos 文件数: $(find "$BOT_DIR/videos" -type f 2>/dev/null | wc -l)"

# 11. 最终磁盘使用情况
log ""
log "=== 清理后磁盘使用情况 ==="
df -h / | grep "/$" | tee -a "$LOG_FILE"

# 12. 完成
log ""
log "=========================================="
log "磁盘清理任务执行完成"
log "=========================================="
log ""
