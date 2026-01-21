# Ant Media Server 播放列表卡顿优化方案

## 问题分析

直播出现"一卡一卡"并"跳过几秒"的现象，主要原因是：

1. **HLS 协议的"追赶"机制**：网络卡顿时，播放器会跳过卡顿内容，直接跳到最新切片
2. **视频切换时缓冲不足**：播放列表从一个视频切换到下一个时，缓冲不够导致卡顿
3. **视频编码参数不一致**：73个视频可能有不同的编码参数（GOP、码率、分辨率）

## 优化方案

### 方案1：调整 Ant Media Server 服务器配置（推荐）

在 Ant Media Server 的配置文件中（通常是 `conf/red5.properties` 或 `conf/application.properties`）调整 HLS 参数：

```properties
# HLS 切片时长（秒）- 建议设置为 2-4 秒
hls.time=2

# HLS 列表大小（切片数量）- 建议设置为 5-10
hls.list.size=8

# HLS 段文件大小（字节）- 可选
hls.segment.size=0
```

**注意**：需要重启 Ant Media Server 才能生效。

### 方案2：通过 API 更新播放列表配置

尝试通过 Ant Media Server REST API 更新播放列表，添加缓冲配置：

```bash
curl -X POST "http://207.148.125.25:5080/LiveApp/rest/v2/broadcasts/playlist_short_drama_1768939177982" \
  -H "Content-Type: application/json" \
  -d '{
    "playListStatus": "broadcasting",
    "playlistLoopEnabled": true
  }'
```

### 方案3：优化视频源（长期方案）

1. **统一视频编码参数**：
   - 统一使用 H.264 编码
   - 固定 GOP（关键帧间隔）为 2 秒（对应 30fps 的 60 帧）
   - 统一分辨率和码率

2. **使用 FFmpeg 批量转码**：
   ```bash
   # 示例：统一转码所有视频
   ffmpeg -i input.mp4 -c:v libx264 -g 60 -preset medium -crf 23 -c:a aac -b:a 128k output.mp4
   ```

### 方案4：前端播放器优化

在 `DPPlayer.vue` 中已经有一些 HLS 配置，可以进一步优化：

```javascript
const hlsConfig = {
  enableWorker: true,
  autoStartLoad: true,
  lowLatencyMode: false,
  maxBufferLength: 30,        // 增加最大缓冲长度
  maxMaxBufferLength: 60,     // 增加最大缓冲上限
  liveSyncDurationCount: 5,   // 增加直播同步切片数
  liveMaxLatencyDurationCount: 10,  // 增加最大延迟切片数
  minBufferLength: 10         // 增加最小缓冲长度
}
```

## 临时解决方案

如果无法立即修改服务器配置，可以尝试：

1. **减少播放列表中的视频数量**：先测试 10-20 个视频，看是否还有卡顿
2. **检查网络状况**：确保 R2 CDN 和 Ant Media Server 之间的网络稳定
3. **使用 CDN 加速**：如果观众较多，建议使用 CDN 分发 M3U8 和 TS 文件

## 监控和调试

1. **检查 M3U8 文件**：
   ```bash
   curl "http://207.148.125.25:5080/LiveApp/streams/playlist_short_drama_1768939177982.m3u8"
   ```
   查看 `#EXTINF` 标签后的秒数是否稳定

2. **检查播放列表状态**：
   ```bash
   curl "http://207.148.125.25:5080/LiveApp/rest/v2/broadcasts/playlist_short_drama_1768939177982"
   ```
   查看 `playListStatus` 和 `currentPlayIndex`

3. **浏览器开发者工具**：
   - Network 标签查看 M3U8 和 TS 文件的加载时间
   - 检查是否有请求失败或超时
