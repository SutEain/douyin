# 合辑修复说明

## ✅ 当前状态

**特定合辑 `6d98aa36-9a1d-4fb5-8da2-f9e8da45a7c6` 已修复**
- 已转换为单个视频类型
- play_url: `/videos/6d98aa36-9a1d-4fb5-8da2-f9e8da45a7c6/index.m3u8`
- 应该可以正常播放了

## 📝 脚本说明

### 1. `fix_collection_play_urls.js` - **主要修复脚本** ⭐
**用途**：修复所有合辑的 play_url 问题
- 检测并修复错误的合辑根路径 play_url
- 基于内容特征（duration、width、height、file_size）检测重复视频
- 如果合辑只剩下1个视频，自动转换为单个视频类型
- 清除合辑的根 play_url

**运行方式**：
```bash
node fix_collection_play_urls.js
```

**什么时候运行**：
- 如果需要修复所有合辑的问题
- 修复脚本已经改进，可以正确处理重复视频的情况

### 2. `fix_specific_collection.js` - **已运行** ✅
**用途**：修复特定合辑 `6d98aa36-9a1d-4fb5-8da2-f9e8da45a7c6`
- 已经运行过了，不需要再运行

### 3. `reprocess_collection_videos.js` - **未完成** ❌
**用途**：检查合辑中的视频文件是否存在
- 需要 R2 环境变量，未完成
- 暂时不需要

### 4. `fix_missing_collection_files.js` - **未完成** ❌
**用途**：修复缺失的文件
- 需要 R2 环境变量，未完成
- 暂时不需要

## 🎯 推荐操作

### 如果当前合辑已经修复好了
**不需要运行任何脚本**，直接测试播放即可。

### 如果还有其他合辑有问题
运行主修复脚本：
```bash
node fix_collection_play_urls.js
```

## 🗑️ 清理建议

可以删除以下未完成的脚本（如果需要）：
- `reprocess_collection_videos.js`
- `fix_missing_collection_files.js`

保留以下脚本：
- `fix_collection_play_urls.js` - 主修复脚本
- `fix_specific_collection.js` - 已运行，可以保留作为参考

