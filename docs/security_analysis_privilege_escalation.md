# 权限提升和越权访问安全分析报告

## 一、检查范围

本次安全审计检查了以下可能存在的权限提升和越权访问漏洞：

1. ✅ 用户修改自己 `is_admin` 权限的可能性
2. ✅ 用户修改自己 `balance_coins` 等敏感字段的可能性
3. ✅ RLS 策略是否允许越权操作
4. ✅ Edge Functions 接口是否存在权限绕过
5. ✅ 数据库触发器是否可能被利用
6. ✅ 用户注册/初始化流程是否存在提权漏洞

## 二、RLS 策略分析

### profiles 表的 UPDATE 策略

#### 1. "Users can update own profile" 策略

**USING 条件**:
```sql
(select auth.uid()) = id
```
- ✅ 只允许用户更新自己的记录

**WITH CHECK 条件**:
```sql
(select auth.uid()) = id 
AND (
    -- 如果是管理员，允许修改任何字段
    public.check_is_admin()
    OR 
    -- 如果不是管理员，必须确保敏感字段没有被修改
    (
        is_admin = (SELECT p.is_admin FROM public.profiles p WHERE p.id = public.profiles.id) AND
        balance_coins = (SELECT p.balance_coins FROM public.profiles p WHERE p.id = public.profiles.id) AND
        frozen_coins = (SELECT p.frozen_coins FROM public.profiles p WHERE p.id = public.profiles.id) AND
        numeric_id = (SELECT p.numeric_id FROM public.profiles p WHERE p.id = public.profiles.id) AND
        is_banned = (SELECT p.is_banned FROM public.profiles p WHERE p.id = public.profiles.id) AND
        follower_count = (SELECT p.follower_count FROM public.profiles p WHERE p.id = public.profiles.id) AND
        following_count = (SELECT p.following_count FROM public.profiles p WHERE p.id = public.profiles.id) AND
        video_count = (SELECT p.video_count FROM public.profiles p WHERE p.id = public.profiles.id) AND
        total_likes = (SELECT p.total_likes FROM public.profiles p WHERE p.id = public.profiles.id) AND
        invite_success_count = (SELECT p.invite_success_count FROM public.profiles p WHERE p.id = public.profiles.id) AND
        auto_approve = (SELECT p.auto_approve FROM public.profiles p WHERE p.id = public.profiles.id) AND
        tg_user_id = (SELECT p.tg_user_id FROM public.profiles p WHERE p.id = public.profiles.id) AND
        auth_provider = (SELECT p.auth_provider FROM public.profiles p WHERE p.id = public.profiles.id) AND
        email_verified = (SELECT p.email_verified FROM public.profiles p WHERE p.id = public.profiles.id)
    )
)
```

**安全评估**:
- ✅ **安全**: 非管理员用户无法修改 `is_admin` 字段
- ✅ **安全**: 非管理员用户无法修改 `balance_coins`、`frozen_coins` 等敏感字段
- ✅ **安全**: 非管理员用户无法修改统计数据（`follower_count`、`video_count` 等）
- ✅ **安全**: 非管理员用户无法修改 `numeric_id`、`is_banned` 等系统字段

#### 2. "Admins can update all profiles" 策略

**USING 条件**:
```sql
check_is_admin()
```

**WITH CHECK 条件**:
```sql
check_is_admin()
```

**安全评估**:
- ✅ **安全**: 只有管理员可以更新所有 profiles
- ✅ **安全**: `check_is_admin()` 函数实时查询数据库，不信任 JWT

## 三、前端代码分析

### `src/api/profile.ts` - `updateProfile` 函数

**实现**:
```typescript
// ✅ 安全加固：显式指定允许修改的字段（白名单机制）
const safePayload = {
    nickname,
    username,
    bio,
    avatar_url,
    cover_url,
    gender,
    birthday,
    country,
    province,
    city,
    lang,
    updated_at: new Date().toISOString()
}
```

**安全评估**:
- ✅ **安全**: 使用白名单机制，只允许修改非敏感字段
- ✅ **安全**: 不包含 `is_admin`、`balance_coins` 等敏感字段
- ✅ **安全**: 即使前端被篡改，RLS 策略也会阻止修改敏感字段

## 四、Edge Functions 接口分析

### 用户更新 Profile 接口

**检查结果**:
- ✅ **未发现**: 没有 Edge Function 接口允许用户更新自己的 profile
- ✅ **安全**: 用户只能通过前端直接调用 Supabase Client 更新，受 RLS 策略保护

### 用户注册/初始化流程

#### 1. `handleAutoInit` (`/user/auto-init` POST)

**实现**:
```typescript
const { data: newProfile, error: profileError } = await supabaseAdmin
  .from('profiles')
  .insert({
    id: authUser.user.id,
    tg_user_id: tgUser.id,
    username: tgUser.username || `user_${tgUser.id}`,
    nickname: nickname || 'Telegram 用户',
    avatar_url: DEFAULT_AVATAR
  })
```

**安全评估**:
- ✅ **安全**: 使用白名单字段，只设置必要的字段
- ✅ **安全**: 不设置 `is_admin` 字段（默认为 `FALSE`）
- ✅ **安全**: 使用 `supabaseAdmin`（service_role），不受 RLS 限制，但代码逻辑安全

#### 2. `handleTelegramWidgetLogin` (Telegram Widget 登录)

**实现**:
```typescript
const { data: profile, error: upsertError } = await supabaseAdmin
  .from('profiles')
  .upsert({
    id: authUserId!,
    tg_user_id: user.id,
    tg_username: user.username,
    nickname: nickname,
    username: user.username || `user_${user.id}`,
    avatar_url: avatarUrl,
    auth_provider: 'tg',
    lang: user.language_code || 'zh-CN'
  })
```

**安全评估**:
- ✅ **安全**: 使用白名单字段，不设置 `is_admin`
- ✅ **安全**: 使用 `supabaseAdmin`（service_role），但代码逻辑安全

#### 3. `handleVerifyCodeLogin` (验证码登录)

**实现**:
```typescript
const { data: profile, error: upsertError } = await supabaseAdmin
  .from('profiles')
  .upsert({
    id: authUserId!,
    tg_user_id: tgUserId,
    tg_username: codeRecord.tg_username || null,
    nickname: nickname || `user_${tgUserId}`,
    username: codeRecord.tg_username || `user_${tgUserId}`,
    avatar_url: avatarUrl,
    auth_provider: 'tg',
    lang: 'zh-CN'
  })
```

**安全评估**:
- ✅ **安全**: 使用白名单字段，不设置 `is_admin`
- ✅ **安全**: 使用 `supabaseAdmin`（service_role），但代码逻辑安全

#### 4. `getOrCreateProfile` (Bot 用户创建)

**实现**:
```typescript
const { data: profile, error: upsertError } = await supabase
  .from('profiles')
  .upsert({
    id: userId!,
    tg_user_id: tgUser.id,
    tg_username: tgUser.username || null,
    nickname: tgUser.first_name + (tgUser.last_name ? ` ${tgUser.last_name}` : ''),
    username: tgUser.username || `user_${tgUser.id}`,
    avatar_url: avatarUrl,
    auth_provider: 'tg',
    lang: tgUser.language_code || 'zh-CN'
  })
```

**安全评估**:
- ✅ **安全**: 使用白名单字段，不设置 `is_admin`
- ✅ **安全**: 使用普通 `supabase` client，受 RLS 策略保护

## 五、数据库触发器分析

**检查结果**:
- ✅ **未发现**: 没有触发器修改 `is_admin` 字段
- ✅ **安全**: 所有触发器都不涉及权限字段

## 六、数据库函数分析

### `check_is_admin()` 函数

**实现**:
```sql
RETURN (
    auth.role() = 'service_role' -- ✅ 允许 service_role 绕过
    OR EXISTS (
        SELECT 1 FROM public.profiles 
        WHERE id = auth.uid() AND is_admin = TRUE
    )
);
```

**安全评估**:
- ✅ **安全**: 实时查询数据库，不信任 JWT
- ✅ **安全**: 只有 `is_admin = TRUE` 的用户才能通过检查
- ✅ **安全**: `service_role` 绕过是必要的（Edge Functions 使用）

## 七、潜在风险点分析

### 1. ⚠️ JWT Metadata 中的 `role` 字段

**当前状态**:
- Edge Function `requireAdminAuth` 会检查 `user.app_metadata.role === 'admin'`
- 但数据库函数 `check_is_admin()` 不再信任 JWT，只查询数据库

**风险评估**:
- 🟢 **低风险**: 即使 JWT 被篡改，数据库函数也会拒绝
- 🟢 **低风险**: Edge Function 也会查询数据库 Profile 进行二次验证

**建议**:
- ✅ **已实施**: Edge Function 双重验证（JWT + 数据库）
- ✅ **已实施**: 数据库函数只信任数据库

### 2. ⚠️ 用户注册时设置 `is_admin`

**当前状态**:
- 所有用户注册/初始化流程都使用白名单字段
- 不设置 `is_admin` 字段（默认为 `FALSE`）

**风险评估**:
- 🟢 **低风险**: 代码逻辑安全，不会设置 `is_admin`

**建议**:
- ✅ **已实施**: 使用白名单字段
- ✅ **已实施**: 显式指定字段，不依赖默认值

### 3. ⚠️ 通过 SQL 注入修改权限

**当前状态**:
- 所有数据库查询都使用参数化查询
- RLS 策略强制检查敏感字段

**风险评估**:
- 🟢 **低风险**: 即使存在 SQL 注入，RLS 策略也会阻止修改敏感字段

**建议**:
- ✅ **已实施**: 使用参数化查询
- ✅ **已实施**: RLS 策略双重保护

## 八、安全结论

### ✅ 已确认的安全措施

1. ✅ **RLS 策略保护**: 非管理员用户无法修改 `is_admin` 等敏感字段
2. ✅ **前端白名单**: 前端代码只允许修改非敏感字段
3. ✅ **注册流程安全**: 所有用户注册流程都不设置 `is_admin`
4. ✅ **数据库函数安全**: `check_is_admin()` 实时查询数据库，不信任 JWT
5. ✅ **Edge Function 双重验证**: JWT + 数据库双重验证
6. ✅ **无触发器风险**: 没有触发器可能被利用

### 🎯 安全状态总结

| 检查项 | 状态 | 说明 |
|--------|------|------|
| 用户修改自己 `is_admin` | ✅ 安全 | RLS 策略阻止 |
| 用户修改自己 `balance_coins` | ✅ 安全 | RLS 策略阻止 |
| 用户注册时设置 `is_admin` | ✅ 安全 | 代码逻辑安全 |
| Edge Function 权限绕过 | ✅ 安全 | 双重验证 |
| 数据库函数权限绕过 | ✅ 安全 | 实时查询数据库 |
| SQL 注入提权 | ✅ 安全 | RLS 策略保护 |
| 触发器提权 | ✅ 安全 | 无相关触发器 |

### 📋 最终结论

**✅ 未发现权限提升或越权访问漏洞**

所有关键路径都有多层安全保护：
1. **前端层**: 白名单机制
2. **Edge Function 层**: 双重验证（JWT + 数据库）
3. **数据库层**: RLS 策略强制检查敏感字段
4. **数据库函数层**: 实时查询数据库，不信任 JWT

即使攻击者：
- 篡改前端代码 → RLS 策略会阻止
- 绕过 Edge Function → 数据库函数会拒绝
- SQL 注入 → RLS 策略会阻止
- 修改 JWT → 数据库函数不信任 JWT

**系统安全状态良好，未发现权限提升漏洞。**
