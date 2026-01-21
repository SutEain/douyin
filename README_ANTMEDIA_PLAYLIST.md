# Ant Media Server 播放列表创建脚本

## 功能说明
自动将用户 10000 和 10003 的短剧视频（M3U8格式）添加到 Ant Media Server 播放列表。

## 使用方法

### 1. 设置环境变量
```bash
export SUPABASE_URL="你的Supabase项目URL"
export SUPABASE_SERVICE_ROLE_KEY="你的Supabase Service Role Key"
export VIDEO_BASE_URL="https://media.tgdouyin.com"  # R2 CDN地址
export ANT_MEDIA_SERVER_IP="207.148.125.25"  # Ant Media Server IP
export ANT_MEDIA_SERVER_PORT="5080"  # Ant Media Server 端口
export ANT_MEDIA_SERVER_APP="LiveApp"  # Ant Media Server 应用名称
```

### 2. 运行脚本
```bash
node create_antmedia_playlist.js
```

## 脚本功能

1. **查询用户**: 从数据库查询用户 10000 和 10003 的用户ID
2. **查询视频**: 查询这些用户的所有短剧视频（HLS格式，已发布）
3. **构建URL**: 将相对路径转换为完整的 M3U8 URL
4. **创建播放列表**: 调用 Ant Media Server API 创建播放列表

## 输出信息

脚本会输出：
- 找到的视频数量
- API 调用结果
- 播放列表 Stream ID
- 播放地址（M3U8 URL）

## 注意事项

1. 确保 Ant Media Server 可以访问 R2 的公开 URL
2. 确保 R2 文件是公开可访问的
3. 如果视频数量很多，可能需要分批创建
