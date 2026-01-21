# Ant Media Server 播放列表卡顿优化配置

## 需要修改的设置

### 1. HLS 切片时长 (hls.time) ⭐ 最重要

**当前问题**：5秒切片在播放列表切换时缓冲时间过长，导致卡顿和跳秒

**推荐设置**：`hls.time = 4` 或 `hls.time = 2`

**修改位置**：
- Ant Media Server 配置文件：`conf/red5.properties` 或 `conf/application.properties`
- 或者通过 Web 控制台：Settings -> Advanced Settings

**添加/修改配置**：
```properties
# HLS 切片时长（秒）- 建议设置为 2-4 秒
settings.hlsTime=4

# 或者如果配置文件格式不同，可能是：
hls.time=4
```

**为什么选择 4 秒**：
- 你的视频平均 78 分钟，4秒切片会产生约 1170 个切片（vs 5秒的 936 个）
- 4秒切片在流畅度和文件数量之间取得更好平衡
- 网络恢复时最多跳过 4 秒，而不是 5 秒

---

### 2. HLS 列表大小 (hls.list.size)

**推荐设置**：`hls.list.size = 8` 或 `10`

**修改位置**：同上，在配置文件中添加

**添加配置**：
```properties
# HLS 列表大小（切片数量）- 建议设置为 8-10
settings.hlsListSize=8

# 或者：
hls.list.size=8
```

**作用**：增加 M3U8 文件中保留的切片数量，让播放器在网络波动时有更多缓冲空间

---

### 3. 播放列表类型 (hls.playListType)

**推荐设置**：`hls.playListType = live`

**添加配置**：
```properties
# HLS 播放列表类型
settings.hlsPlayListType=live
```

---

## 完整配置示例

在 Ant Media Server 的配置文件中添加以下内容：

```properties
# ============================================
# HLS 播放列表优化配置
# ============================================

# HLS 切片时长（秒）- 2-4 秒最佳
settings.hlsTime=4

# HLS 列表大小（切片数量）- 8-10 个最佳
settings.hlsListSize=8

# HLS 播放列表类型
settings.hlsPlayListType=live

# HLS 段文件大小（字节）- 0 表示不限制
settings.hlsSegmentSize=0
```

---

## 修改步骤

### 方法1：通过配置文件修改（推荐）

1. **找到配置文件位置**：
   - Linux: `/usr/local/antmedia/conf/red5.properties` 或 `/usr/local/antmedia/conf/application.properties`
   - Docker: 挂载的配置文件路径
   - Windows: `C:\antmedia\conf\red5.properties`

2. **编辑配置文件**：
   ```bash
   # Linux
   sudo nano /usr/local/antmedia/conf/red5.properties
   
   # 或
   sudo vi /usr/local/antmedia/conf/application.properties
   ```

3. **添加上述配置**（如果配置已存在，修改为推荐值）

4. **重启 Ant Media Server**：
   ```bash
   # Linux
   sudo systemctl restart antmedia
   
   # 或
   sudo service antmedia restart
   
   # Docker
   docker restart antmedia
   ```

### 方法2：通过 Web 控制台修改

1. 登录 Ant Media Server Web 控制台：`http://207.148.125.25:5080`
2. 进入 **Settings** -> **Advanced Settings**
3. 找到或添加以下设置：
   - `hlsTime` = `4`
   - `hlsListSize` = `8`
   - `hlsPlayListType` = `live`
4. 保存并重启 Application

---

## 验证配置是否生效

### 1. 检查 M3U8 文件

```bash
curl "http://207.148.125.25:5080/LiveApp/streams/playlist_short_drama_1768939177982.m3u8"
```

查看 `#EXTINF` 标签后的秒数，应该是 4 秒左右（例如：`#EXTINF:4.0,`）

### 2. 检查播放列表状态

```bash
curl "http://207.148.125.25:5080/LiveApp/rest/v2/broadcasts/playlist_short_drama_1768939177982"
```

查看返回的 JSON 数据，确认配置已生效

---

## 注意事项

1. **重启后才能生效**：修改配置后必须重启 Ant Media Server 才能生效

2. **只影响新创建的流**：已存在的播放列表可能需要重新创建才能应用新配置

3. **如果配置不生效**：
   - 检查配置文件路径是否正确
   - 检查配置项名称是否正确（不同版本可能不同）
   - 查看 Ant Media Server 日志：`/usr/local/antmedia/logs/antmedia.log`

4. **性能考虑**：
   - 2秒切片：最流畅，但文件数量多，服务器压力大
   - 4秒切片：平衡选择（推荐）
   - 5秒切片：文件少，但容易卡顿

---

## 如果仍然卡顿

如果修改配置后仍然卡顿，可能需要：

1. **开启自适应转码**：统一所有视频的编码参数
2. **检查网络状况**：确保 R2 CDN 和 Ant Media Server 之间的网络稳定
3. **减少播放列表项数量**：先测试 20-30 个视频
4. **使用 CDN 加速**：如果观众较多，建议使用 CDN 分发 M3U8 和 TS 文件
