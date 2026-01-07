# BOT上传作品流程梳理

## 📋 概述

本文档详细梳理了BOT上传作品的完整流程，包括每个阶段的作品状态、审核状态以及机器人通知情况。

---

## 🔄 完整流程

### 阶段1：用户上传作品

**触发条件**：用户向BOT发送视频/图片

**操作**：
1. BOT接收文件，创建数据库记录
2. 检查用户发布限制（新用户首个作品通过前限发1个）
3. 判断文件大小，决定处理方式

**初始状态设置**：
- `status`: `processing`（所有文件都需要Worker处理，转存到R2）
- `review_status`: 
  - `pending`（非免审用户）
  - `auto_approved`（免审用户 `auto_approve=true`）
- `storage_type`: `r2_pending`（所有文件统一走R2存储）

**机器人通知**：
- ✅ **非自动同步模式**：发送"🔄 正在处理视频..."消息
- ❌ **自动同步模式**（`is_auto_sync=true`）：不发送处理消息

**代码位置**：
- `supabase/functions/bot-video-upload/features/upload.ts` - `handleVideo()` / `handlePhoto()`

---

### 阶段2：Worker异步处理

**触发条件**：BOT调用Worker处理文件

**操作**：
1. Worker从Telegram下载文件
2. 转存到R2存储
3. 生成播放URL和封面URL
4. 处理完成后回调BOT

**状态变化**：
- Worker处理期间：`status` 保持 `processing`
- Worker处理完成：根据审核状态决定下一步

**机器人通知**：
- ❌ Worker处理期间：无通知（用户已看到"正在处理"消息）

**代码位置**：
- Worker回调：`supabase/functions/bot-video-upload/app.ts` - `worker_complete` 处理

---

### 阶段3：Worker完成回调

**触发条件**：Worker处理完成，回调BOT

**操作**：
1. 更新视频的 `play_url` 和 `cover_url`
2. 检查当前状态和审核状态
3. 决定是否显示编辑菜单

**状态判断逻辑**：
```typescript
// 如果是合集/相册，且审核已通过
if (video.review_status === 'approved' || video.review_status === 'auto_approved') {
  if (video.status === 'processing') {
    // 自动转为 published（相册/合集）
    status = 'published'
  }
}

// 频道同步模式：如果状态是 ready 或 published，直接退出
if (video.is_auto_sync && (video.status === 'ready' || video.status === 'published')) {
  // 发送同步成功消息，不显示编辑菜单
  return
}

// 如果状态还是 processing，不显示编辑菜单
if (video.status === 'processing') {
  return // 等待处理完成
}
```

**机器人通知**：
- ✅ **非自动同步模式**：
  - 如果状态不是 `processing`：显示编辑菜单（替换"正在处理"消息）
  - 如果状态是 `processing`：无通知（继续等待）
- ✅ **自动同步模式**：
  - 发送"同步成功 📢：检测到您的频道发布了新视频，已自动发布/已自动搬运并进入待发布状态。"

**代码位置**：
- `supabase/functions/bot-video-upload/app.ts` - `worker_complete` 处理（第110-291行）

---

### 阶段4：用户编辑作品

**触发条件**：Worker完成后，用户看到编辑菜单

**操作**：
1. 用户可以编辑描述、标签、位置
2. 可以设置隐私（公开/私密）
3. 可以标记成人内容/东南亚板块
4. 可以选择"立即发布"或"保存草稿"

**状态**：
- `status`: `draft` 或 `ready`（取决于Worker是否完成）
- `review_status`: 保持上传时的状态（`pending` 或 `auto_approved`）

**机器人通知**：
- ❌ 编辑过程中：无通知（仅更新菜单显示）

**代码位置**：
- `supabase/functions/bot-video-upload/features/editor.ts` - `getEditMenuText()` / `getEditKeyboard()`
- `supabase/functions/bot-video-upload/routers/callback.ts` - 编辑相关回调处理

---

### 阶段5：用户点击"立即发布"

**触发条件**：用户在编辑菜单点击"✅ 立即发布"

**操作**：
1. 检查用户是否为免审用户（`auto_approve`）
2. 根据免审状态设置不同的状态和通知

#### 5.1 免审用户（`auto_approve=true`）

**状态变化**：
- `status`: `published`
- `review_status`: `auto_approved`
- `published_at`: 设置为当前时间

**机器人通知**：
- ✅ 发送"🎉 发布成功！视频已发布。"
- ✅ 通知粉丝有新作品发布（异步）

**代码位置**：
- `supabase/functions/bot-video-upload/features/videoActions.ts` - `publishVideo()`（第244-329行）

#### 5.2 非免审用户（`auto_approve=false`）

**状态变化**：
- `status`: `ready`（等待审核）
- `review_status`: `pending`
- `published_at`: `null`

**机器人通知**：
- ✅ 发送"✅ 提交成功！您的内容已提交审核，审核通过后将自动发布到首页。💡 首次发布需要审核，后续发布将自动通过"

**代码位置**：
- `supabase/functions/bot-video-upload/features/videoActions.ts` - `publishVideo()`（第244-329行）

---

### 阶段6：管理员审核（仅非免审用户）

**触发条件**：管理员在后台审核作品

**操作**：
1. 管理员审核通过/拒绝
2. 如果通过，更新状态并可能提升用户权限

#### 6.1 审核通过

**状态变化**：
- `status`: `ready` → `published`
- `review_status`: `pending` → `approved`
- `published_at`: 设置为当前时间

**特殊处理**：
- 如果这是用户**首个通过的作品**：
  - 设置 `auto_approve = true`（开启免审权限）
  - 发送免审权限通知

**机器人通知**：
- ✅ 发送"🎉 您的作品已通过审核！由于您的首个作品表现优秀，系统已为您开启【免审核模式】。今后您发布的作品将自动发布，无需等待人工审核。"
- ✅ 通知粉丝有新作品发布（异步）

**代码位置**：
- `supabase/functions/app-server/routes/video.ts` - `handleApproveVideo()`（第1149-1252行）

#### 6.2 审核拒绝

**状态变化**：
- `status`: 保持 `ready`
- `review_status`: `pending` → `rejected`
- `reject_reason`: 设置拒绝原因

**机器人通知**：
- ✅ 发送拒绝通知（包含拒绝原因）

**代码位置**：
- `supabase/functions/app-server/routes/video.ts` - 拒绝审核处理

---

## 📊 状态流转图

```
上传作品
  ↓
[status: processing/draft, review_status: pending/auto_approved]
  ↓
Worker处理
  ↓
[status: processing → ready/draft]
  ↓
显示编辑菜单
  ↓
用户点击"立即发布"
  ↓
┌─────────────────┬─────────────────┐
│   免审用户       │   非免审用户     │
├─────────────────┼─────────────────┤
│ status:         │ status:         │
│ published       │ ready           │
│                 │                 │
│ review_status:  │ review_status:  │
│ auto_approved   │ pending         │
│                 │                 │
│ ✅ 发布成功      │ ⏳ 等待审核      │
│ ✅ 通知粉丝      │                 │
└─────────────────┴─────────────────┘
                    ↓
              管理员审核
                    ↓
            ┌───────┴───────┐
            │               │
        审核通过        审核拒绝
            │               │
    status: published  status: ready
    review_status:     review_status:
    approved           rejected
            │
    ✅ 通知用户
    ✅ 通知粉丝
    ✅ 开启免审（首次）
```

---

## 🎯 关键状态说明

### `status` 字段（作品状态）

| 状态值 | 含义 | 说明 |
|--------|------|------|
| `draft` | 草稿 | 已接收，可编辑（已废弃，现在统一用processing） |
| `processing` | 处理中 | 正在Worker处理，转存R2 |
| `ready` | 就绪 | 处理完成，等待发布或审核 |
| `published` | 已发布 | 已发布到首页，用户可见 |
| `failed` | 处理失败 | Worker处理失败 |

### `review_status` 字段（审核状态）

| 状态值 | 含义 | 说明 |
|--------|------|------|
| `pending` | 待审核 | 非免审用户提交，等待管理员审核 |
| `auto_approved` | 自动通过 | 免审用户，自动通过审核 |
| `manual_review` | 人工审核中 | 管理员正在审核 |
| `approved` | 已通过 | 管理员审核通过 |
| `rejected` | 已拒绝 | 管理员审核拒绝 |
| `appealing` | 申诉中 | 用户对拒绝结果申诉 |

---

## 🔔 通知总结

### 上传阶段
- ✅ 非自动同步：发送"正在处理"消息
- ❌ 自动同步：不发送

### Worker完成
- ✅ 非自动同步：显示编辑菜单（替换"正在处理"消息）
- ✅ 自动同步：发送"同步成功"消息

### 发布阶段
- ✅ 免审用户：发送"发布成功" + 通知粉丝
- ✅ 非免审用户：发送"提交成功，等待审核"

### 审核阶段
- ✅ 审核通过：发送"审核通过" + 通知粉丝 + 首次通过时通知免审权限
- ✅ 审核拒绝：发送拒绝通知（含原因）

---

## ⚠️ 特殊情况处理

### 1. 频道自动同步（`is_auto_sync=true`）
- 上传时不发送"正在处理"消息
- Worker完成后，如果状态是 `ready` 或 `published`，直接发送同步成功消息，不显示编辑菜单
- 用于频道自动搬运场景

### 2. 合集/相册处理
- 多个媒体项共享同一个 `media_group_id`
- 使用数据库原子操作 `append_collection_media` 追加媒体项
- 相册只要有图片成功就可以展示（`processing` → `published`）

### 3. 新用户发布限制
- 首个作品通过审核前，限发1个作品
- 如果已有作品在审核中（`pending`/`manual_review`），拒绝新上传
- 如果已有作品已通过（`approved`/`auto_approved`），允许继续上传

### 4. 免审权限提升
- 用户首个作品审核通过后，自动设置 `auto_approve = true`
- 后续作品自动通过审核，无需等待

---

## 📝 代码关键位置

1. **上传处理**：`supabase/functions/bot-video-upload/features/upload.ts`
2. **Worker回调**：`supabase/functions/bot-video-upload/app.ts` (第110-291行)
3. **发布处理**：`supabase/functions/bot-video-upload/features/videoActions.ts` (第244-329行)
4. **审核处理**：`supabase/functions/app-server/routes/video.ts` (第1149-1252行)
5. **编辑菜单**：`supabase/functions/bot-video-upload/features/editor.ts`

---

## 🔍 常见问题

### Q1: 为什么有些作品状态是 `processing` 但已经显示了编辑菜单？
A: 这种情况不应该发生。如果 `status` 是 `processing`，Worker回调会直接返回，不显示编辑菜单。如果出现了，可能是：
- Worker处理失败但没有正确更新状态
- 数据库状态不一致

**解决方案**：可以运行补救脚本 `rescue_all.cjs` 重新触发Worker处理。注意：补救脚本会跳过给频道同步用户发送通知（通过 `messageId=0` 判断）。

### Q2: 免审用户上传后直接是 `published` 吗？
A: 不是。免审用户上传后：
- 初始状态：`status: processing/draft`, `review_status: auto_approved`
- Worker完成后：`status: ready/draft`
- 用户点击"立即发布"后：`status: published`

### Q3: 非免审用户什么时候变成 `published`？
A: 两个时机：
1. 用户点击"立即发布"后：`status: ready`, `review_status: pending`
2. 管理员审核通过后：`status: published`, `review_status: approved`

### Q4: 审核通过后会自动通知用户吗？
A: 是的。审核通过后会：
1. 发送审核通过通知
2. 如果是首个通过的作品，还会通知获得免审权限
3. 通知粉丝有新作品发布
