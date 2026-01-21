# Ant Media Server 配置修改指南

## 配置文件位置

Ant Media Server 的配置文件位置取决于安装方式：

### 1. Linux 标准安装

配置文件通常在：
```
/usr/local/antmedia/conf/red5.properties
```
或
```
/usr/local/antmedia/conf/application.properties
```

### 2. Docker 安装

配置文件在容器内的：
```
/usr/local/antmedia/conf/red5.properties
```

如果使用 Docker，需要：
- 找到挂载的配置文件路径
- 或者进入容器修改：`docker exec -it <container_name> bash`

### 3. Windows 安装

配置文件在：
```
C:\antmedia\conf\red5.properties
```

---

## 修改步骤

### 方法1：直接编辑配置文件（推荐）

1. **找到配置文件**：
   ```bash
   # Linux
   sudo find /usr/local/antmedia -name "red5.properties" -o -name "application.properties"
   
   # 或直接查看
   ls -la /usr/local/antmedia/conf/
   ```

2. **备份配置文件**：
   ```bash
   sudo cp /usr/local/antmedia/conf/red5.properties /usr/local/antmedia/conf/red5.properties.backup
   ```

3. **编辑配置文件**：
   ```bash
   sudo nano /usr/local/antmedia/conf/red5.properties
   # 或
   sudo vi /usr/local/antmedia/conf/red5.properties
   ```

4. **添加或修改以下配置**：
   ```properties
   # HLS 切片时长（秒）- 2秒最佳，减少跳秒
   settings.hlsTime=2
   
   # HLS 列表大小（切片数量）- 10个提供更多缓冲
   settings.hlsListSize=10
   
   # HLS 播放列表类型
   settings.hlsPlayListType=live
   ```

5. **保存并退出**：
   - nano: `Ctrl+X` -> `Y` -> `Enter`
   - vi: `:wq` -> `Enter`

6. **重启 Ant Media Server**：
   ```bash
   # Linux systemd
   sudo systemctl restart antmedia
   
   # 或
   sudo service antmedia restart
   
   # Docker
   docker restart <container_name>
   ```

---

### 方法2：通过 Web 控制台修改

1. **登录 Web 控制台**：
   ```
   http://207.148.125.25:5080
   ```

2. **进入设置**：
   - 点击左侧菜单的 **Settings**
   - 选择 **Advanced Settings** 或 **Application Settings**

3. **添加配置项**：
   - 找到或添加以下配置项：
     - `hlsTime` = `2`
     - `hlsListSize` = `10`
     - `hlsPlayListType` = `live`

4. **保存并重启**：
   - 点击 **Save** 或 **Apply**
   - 重启 Application（如果提示）

---

### 方法3：通过环境变量（Docker）

如果使用 Docker，可以在启动时设置环境变量：

```bash
docker run -d \
  -e SETTINGS_HLS_TIME=2 \
  -e SETTINGS_HLS_LIST_SIZE=10 \
  -e SETTINGS_HLS_PLAY_LIST_TYPE=live \
  ...
```

或在 `docker-compose.yml` 中：
```yaml
environment:
  - SETTINGS_HLS_TIME=2
  - SETTINGS_HLS_LIST_SIZE=10
  - SETTINGS_HLS_PLAY_LIST_TYPE=live
```

---

## 验证配置是否生效

### 1. 检查配置文件

```bash
# 查看配置是否已添加
grep -i "hlsTime\|hlsListSize\|hlsPlayListType" /usr/local/antmedia/conf/red5.properties
```

### 2. 检查 M3U8 文件

重启后，检查播放列表的 M3U8 文件：

```bash
curl "http://207.148.125.25:5080/LiveApp/streams/playlist_short_drama_1768939177982.m3u8" | head -20
```

如果看到 `#EXTINF:2.0,` 或 `#EXTINF:2,`，说明配置已生效。

### 3. 检查播放列表状态

```bash
curl "http://207.148.125.25:5080/LiveApp/rest/v2/broadcasts/playlist_short_drama_1768939177982"
```

---

## 注意事项

1. **配置项名称可能不同**：
   - 不同版本的 Ant Media Server 配置项名称可能不同
   - 如果 `settings.hlsTime` 不生效，尝试：
     - `hls.time`
     - `hlsTime`
     - `hls_time`

2. **需要重启才能生效**：
   - 修改配置后必须重启 Ant Media Server
   - 只重启 Application 可能不够，需要重启整个服务

3. **只影响新创建的流**：
   - 已存在的播放列表可能需要重新创建才能应用新配置
   - 建议重新运行 `create_antmedia_playlist.js` 创建新的播放列表

4. **如果配置不生效**：
   - 检查配置文件路径是否正确
   - 检查配置项名称是否正确
   - 查看日志：`/usr/local/antmedia/logs/antmedia.log`
   - 尝试不同的配置项名称格式

---

## 快速检查脚本

创建一个检查脚本 `check_antmedia_config.sh`：

```bash
#!/bin/bash

echo "检查 Ant Media Server 配置..."
echo ""

# 检查配置文件位置
CONFIG_FILE="/usr/local/antmedia/conf/red5.properties"
if [ ! -f "$CONFIG_FILE" ]; then
    CONFIG_FILE="/usr/local/antmedia/conf/application.properties"
fi

if [ -f "$CONFIG_FILE" ]; then
    echo "✅ 找到配置文件: $CONFIG_FILE"
    echo ""
    echo "当前 HLS 配置:"
    grep -i "hls" "$CONFIG_FILE" | grep -v "^#" | grep -v "^$"
else
    echo "❌ 未找到配置文件"
    echo "请检查 Ant Media Server 安装路径"
fi

echo ""
echo "检查 M3U8 文件:"
curl -s "http://207.148.125.25:5080/LiveApp/streams/playlist_short_drama_1768939177982.m3u8" | head -5
```

运行：
```bash
chmod +x check_antmedia_config.sh
./check_antmedia_config.sh
```
