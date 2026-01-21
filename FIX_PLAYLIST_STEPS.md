# 修复播放列表跳秒问题 - 操作步骤

## 🔴 当前问题

**切片时长是 8.33 秒**，这太长了！这就是跳秒严重的原因。

## ✅ 解决步骤

### 步骤 1: 确认 Ant Media Server 配置

1. 登录 Web 控制台：`http://207.148.125.25:5080`
2. 进入 **Settings** -> **HLS Streaming**
3. **确认以下配置**：
   - ✅ **Segment Duration**: `2`（不是 1，不是 8）
   - ✅ **Segment List Size**: `10`（或 8）
   - ✅ **Create HLS Streaming**: 已勾选
4. **点击保存/应用**

### 步骤 2: 重启 Ant Media Server 服务 ⚠️ 重要！

**必须重启整个 Ant Media Server 服务，而不只是 Application！**

```bash
# SSH 登录服务器
ssh root@207.148.125.25

# 重启 Ant Media Server（根据安装方式选择）
# 方式1: systemd
sudo systemctl restart antmedia

# 方式2: service
sudo service antmedia restart

# 方式3: Docker
docker restart <container_name>
```

### 步骤 3: 停止并重新创建播放列表

运行更新脚本：

```bash
node update_antmedia_playlist.js
```

脚本会：
1. 停止当前播放列表
2. 删除旧播放列表
3. 使用新配置重新创建播放列表
4. 验证切片时长是否为 2 秒

### 步骤 4: 验证修复

运行检查脚本：

```bash
node check_m3u8.js
```

应该看到：
- ✅ 切片时长: **2.0 秒**（不是 8.33 秒）
- ✅ 配置已生效

---

## ⚠️ 重要提示

1. **必须重启整个服务**：只重启 Application 不够，需要重启整个 Ant Media Server 服务
2. **配置必须保存**：确认 Web 控制台的配置已保存
3. **重新创建播放列表**：已存在的播放列表使用的是旧配置，必须重新创建

---

## 🔍 如果还是不行

如果重启后切片时长还是 8.33 秒，可能的原因：

1. **配置文件路径不对**：检查配置文件位置
2. **配置项名称不对**：不同版本的 Ant Media Server 配置项名称可能不同
3. **需要手动编辑配置文件**：通过 SSH 直接编辑配置文件

让我知道重启后的结果！
