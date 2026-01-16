# 🚨 严重安全漏洞：审核接口缺少权限验证

## 一、用户 42718 检查结果

### 基本信息
- **numeric_id**: 42718
- **username**: taozi2076
- **nickname**: T
- **is_admin**: ❌ false（不是管理员）
- **is_reviewer**: ✅ **true（是审核员）**
- **is_banned**: false
- **balance_coins**: 54.00
- **created_at**: 2025-12-31 15:11:55
- **last_active_at**: 2025-12-31 15:11:55

### 交易记录
1. ✅ 正常签到奖励：4.00 抖币
2. ✅ 正常观看时长奖励：5/15/30 抖币
3. ✅ 后台调整：7700 抖币（推广奖励）
4. ✅ 提现：7700 抖币（已处理完成）

### 操作记录
- ❌ 未发现执行过充值确认操作
- ❌ 未发现执行过提现处理操作
- ❌ 未发布过视频

### 结论
**用户 42718 是审核员，但未发现异常操作记录。**

---

## 二、🚨 严重安全漏洞发现

### 漏洞描述

**审核接口缺少权限验证**，任何用户都可以调用审核接口进行以下操作：
1. 批量审核/拒绝/删除视频
2. 设置视频为成人内容
3. 修改视频审核状态

### 受影响的接口

#### 1. `/video/batch-review` POST
**文件**: `supabase/functions/app-server/routes/video.ts:1093`

**问题**:
```typescript
export async function handleBatchReview(req: Request): Promise<Response> {
  const body = await parseJsonBody(req)
  // ❌ 没有权限验证！
  // ❌ 任何用户都可以调用此接口
  // ...
}
```

**可执行的操作**:
- `approve`: 批量审核通过视频
- `reject`: 批量拒绝视频
- `delete`: 批量删除视频
- `set_adult`/`unset_adult`: 设置/取消成人内容标记
- `set_sea`/`unset_sea`: 设置/取消 SEA 标记

#### 2. `/video/approve` POST
**文件**: `supabase/functions/app-server/routes/video.ts:1139`

**问题**:
```typescript
export async function handleApproveVideo(req: Request): Promise<Response> {
  const body = await parseJsonBody(req)
  // ❌ 没有权限验证！
  // ❌ 任何用户都可以调用此接口
  // ...
}
```

**可执行的操作**:
- 审核通过单个视频
- 自动设置用户 `auto_approve = true`（免审权限）

### 安全影响

#### 🔴 高风险
1. **内容安全**: 任何用户都可以审核通过/拒绝/删除任何视频
2. **权限提升**: 任何用户都可以给自己或他人设置免审权限
3. **数据破坏**: 可以批量删除视频，造成数据丢失
4. **内容标记**: 可以随意设置视频为成人内容等敏感标记

### 攻击场景

1. **恶意审核**: 攻击者可以批量拒绝所有待审核视频
2. **权限提升**: 攻击者可以审核通过自己的视频，获得免审权限
3. **数据破坏**: 攻击者可以批量删除视频
4. **内容标记**: 攻击者可以随意修改视频的敏感标记

---

## 三、修复方案

### 方案 1: 添加管理员权限验证（推荐）

**适用场景**: 只有管理员可以审核

```typescript
export async function handleBatchReview(req: Request): Promise<Response> {
  // ✅ 添加管理员权限验证
  await requireAdminAuth(req)
  
  const body = await parseJsonBody(req)
  // ... 原有逻辑
}
```

### 方案 2: 添加审核员权限验证

**适用场景**: 审核员和管理员都可以审核

**步骤**:
1. 创建 `requireReviewerAuth` 函数
2. 检查用户是否为管理员或审核员
3. 应用到审核接口

```typescript
// 在 lib/auth.ts 中添加
export async function requireReviewerAuth(req: Request) {
  const { user } = await requireAuth(req, { withProfile: false })
  
  const { data: profile } = await supabaseAdmin
    .from('profiles')
    .select('is_admin, is_reviewer')
    .eq('id', user.id)
    .maybeSingle()
  
  if (!profile?.is_admin && !profile?.is_reviewer) {
    throw new HttpError('Forbidden: Reviewer access required', 403)
  }
  
  return { user, profile }
}

// 在审核接口中使用
export async function handleBatchReview(req: Request): Promise<Response> {
  await requireReviewerAuth(req) // ✅ 添加权限验证
  // ... 原有逻辑
}
```

---

## 四、当前审核员列表

| numeric_id | username | nickname | is_admin | is_reviewer |
|------------|----------|----------|----------|-------------|
| 42718 | taozi2076 | T | false | ✅ true |
| 28565 | ChenYiZiBen | WuAn | false | ✅ true |

---

## 五、建议

### 🔴 紧急修复
1. **立即添加权限验证**到审核接口
2. **检查审核日志**，确认是否有未授权操作
3. **审查用户 42718 和 28565** 的审核操作记录

### 🟡 后续改进
1. 添加审核操作日志表
2. 记录所有审核操作的审核员 ID
3. 添加审核频率限制
4. 添加审核操作的审计日志

---

## 六、修复状态

### ✅ 已完成修复

| 优先级 | 操作 | 状态 |
|--------|------|------|
| 🔴 P0 | 添加权限验证到 `handleBatchReview` | ✅ 已修复 |
| 🔴 P0 | 添加权限验证到 `handleApproveVideo` | ✅ 已修复 |
| 🔴 P0 | 删除 `is_reviewer` 字段 | ✅ 已删除 |
| 🔴 P0 | 更新 `admin_profiles_list` 视图 | ✅ 已更新 |

### ⚠️ 待实施（可选）

| 优先级 | 操作 | 状态 |
|--------|------|------|
| 🟡 P1 | 创建审核操作日志表 | ⚠️ 待实施 |
| 🟢 P2 | 添加审核频率限制 | ⚠️ 待实施 |

---

## 七、修复详情

### 1. ✅ 添加管理员权限验证

**修复文件**: `supabase/functions/app-server/routes/video.ts`

**修复内容**:
- `handleBatchReview`: 添加 `await requireAdminAuth(req)`
- `handleApproveVideo`: 添加 `await requireAdminAuth(req)`

**效果**: 只有管理员可以调用审核接口

### 2. ✅ 删除审核员角色

**迁移文件**: `supabase/migrations/20260116000006_remove_reviewer_role.sql`

**修复内容**:
- 删除 `profiles.is_reviewer` 字段
- 更新 `admin_profiles_list` 视图（移除 `is_reviewer`）

**效果**: 系统不再有审核员角色，所有审核操作仅限管理员
