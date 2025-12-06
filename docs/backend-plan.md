# douyin 后端方案与进度（可随时更新）

## 目标与范围
- 用 Supabase（Postgres + Auth + Storage + Edge Functions）支撑现有前端，替换 mock。
- 覆盖功能：登录/注册（TG 免登 + 邮箱密码）、视频流（推荐/关注/我的/喜欢/历史/私密）、点赞、评论、收藏、关注、通知、内容审核。
- 媒体：视频/封面走第三方 CDN/点播；Supabase Storage 仅头像等轻量资源。
- 多语言：后端返回数据与 i18n key/语言字段，文案由前端处理。

## 鉴权与账号合并
- 统一使用 Supabase Auth。
- TG 免登录：
  - TG Bot 生成带签名的 `tg_token`（含 tg_user_id、username、过期时间），前端携带调用 `POST /auth/tg_login`。
  - 后端校验签名+时效。若 `tg_user_id` 未存在，则创建用户（provider=`tg`，邮箱为空，email_verified=false）。
  - 若已存在则直接签发 Supabase 会话（Edge Function 中调用管理 API 或服务角色）。
- 绑定邮箱：
  - `POST /auth/bind_email`：已登录（TG 会话）用户提交邮箱+密码，若邮箱未占用则为当前用户设置 email/password 并发送验证。
  - 解绑/修改邮箱按 Supabase 标准流程。
- 邮箱登录：标准 email+password（`POST /auth/login` / `POST /auth/signup`）。
- 字段扩展（profiles 表）：`tg_user_id`, `tg_username`, `auth_provider`, `lang`, `avatar_url`, `bio`, `email_verified`.

## 数据模型（初稿）
- users/profiles（扩展字段）  
- videos：id, author_id, title, play_url, cover_url, duration, width/height, transcode_status, review_status, tags, created_at  
- video_likes：user_id, video_id, created_at  
- video_comments：id, video_id, user_id, content, reply_to?, like_count, review_status, created_at  
- video_collections（收藏）：user_id, video_id, created_at  
- follows：follower_id, followee_id, created_at  
- watch_history：user_id, video_id, progress, created_at  
- notifications：user_id, type, payload, read_at, created_at  
- review_tasks：target_type(video/comment/profile), target_id, status(pending/approved/rejected), reason, created_at, updated_at  
- i18n_texts（如需后端提供提示语 key→value，可选）
- 索引：常用查询字段上建索引（video_id/user_id/created_at 等），评论按 video_id+created_at。
- RLS：写操作限定 owner；公共读根据 review_status=approved；交互表按 user_id 限定写。

## API 对齐（替换 mock）
- `GET /video/recommended`：推荐流（时间+热度占位，可按 lang/region 过滤）。  
- `GET /video/long/recommended`：长视频流（同上，分页）。  
- `GET /video/comments?id=`：评论列表（仅审核通过）。  
- `GET /video/private`：当前用户私密视频列表。  
- `GET /video/like`：当前用户点赞列表。  
- `GET /video/my`：我的视频列表。  
- `GET /video/history`：观看历史。  
- `GET /user/collect`：收藏视频列表（音乐收藏暂不做）。  
- `GET /user/video_list?id=`：用户主页视频列表。  
- `GET /user/panel`：当前用户信息面板。  
- `GET /user/friends`：互相关注列表。  
- `GET /historyOther`：预留空数据。  
- `GET /post/recommended`、`GET /shop/recommended`：暂不实现（返回空/占位或前端改为隐藏）。
- 新增 Auth：
  - `POST /auth/signup`（邮箱注册）、`POST /auth/login`（邮箱登录）
  - `POST /auth/tg_login`（TG token 免登）
  - `POST /auth/bind_email`（TG 用户绑定邮箱）

## 开发顺序
1) 规范接口契约：整理请求/响应字段、分页、错误码，更新本文档。  
2) 数据库迁移：建表/索引/初始 RLS；创建 Storage bucket（avatar 等）。  
3) Auth 与账户流程：邮箱注册/登录、TG 登录、绑定邮箱。  
4) 视频流与列表：推荐/关注/我的/喜欢/历史/私密；上传写入（URL/元数据），播放走第三方 URL。  
5) 互动：点赞、收藏、评论（含审核状态）、关注/取关、好友列表（互关）。  
6) 审核与通知：review_tasks、审核过滤；基础通知（点赞/评论/关注）。  
7) 多语言支持：接口接受 `lang`/`Accept-Language`，返回语言字段或 i18n key。  
8) 风控：基础速率限制（Edge Function 内节流或计数表）、审计日志。  
9) 验证与联调：对齐前端 mock 的数据结构，提供示例响应。

## 媒体与审核
- 视频/封面 URL 存第三方（字段 play_url、cover_url、transcode_status）。  
- 审核：在 review_tasks 中记录状态，接口只返回 `review_status=approved` 的内容；评论同理。  
- 可留 Webhook/人工审核入口，后续接入第三方内容安全。

## 多语言
- profiles.lang 记录用户偏好；接口接受 `lang` 参数，数据侧可按地区/语言筛流（占位策略：先按 lang 或默认）。  
- 提示语尽量用前端 i18n；如需后端提示，返回 i18n key + fallback 文案。

## 待决与后续扩展
- 推荐算法：当前用时间+热度占位，后续可做个性化。  
- 通知类型与负载格式：后续细化。  
- 速率限制策略：按 IP/用户的窗口计数或 Edge KV/pg 实现。  
- 日志与追踪：接入 Supabase Logs 或外部 APM（可选）。

## Auth 接口契约（首批实现）
- 文件结构（Edge Functions 分文件，便于维护）：
  - `supabase/functions/auth-signup/index.ts`：邮箱注册。
  - `supabase/functions/auth-login/index.ts`：邮箱登录。
  - `supabase/functions/server/index.ts`：TG token 免登。
  - `supabase/functions/auth-bind-email/index.ts`：TG 用户绑定邮箱。
  - 公共工具文件：`supabase/functions/_shared/` 存放校验、签名校验、响应封装等。

- 通用响应格式示例：
  ```json
  { "code": 0, "msg": "ok", "data": { ... } }
  ```
  - 错误：`code` 非 0，`msg` 为描述/可选 i18n key，`data` 可为空。

- `POST /auth/signup`
  - req: `{ "email": "...", "password": "...", "lang": "en|zh|..." }`
  - res: `{ "code": 0, "data": { "user_id": "...", "email": "...", "session": { access_token, refresh_token, expires_in } } }`
  - 行为：创建 Supabase 用户；profiles 写入 `lang`、`auth_provider="email"`。

- `POST /auth/login`
  - req: `{ "email": "...", "password": "..." }`
  - res: 同上，返回 session。

- `POST /auth/tg_login`
  - req: `{ "tg_token": "签名 token" }`
  - token 含：`tg_user_id`, `tg_username`, `exp`; 服务端用环境变量 `TG_BOT_SECRET` 验签 + 时效检查。
  - 行为：
    - 若 `tg_user_id` 已存在 → 返回会话；
    - 若不存在 → 创建新用户（provider=`tg`，email 为空，email_verified=false），写 profiles 的 tg 字段，返回会话。
  - res: `{ "code": 0, "data": { "user_id": "...", "session": {...}, "need_bind_email": true|false } }`

- `POST /auth/bind_email`
  - headers: `Authorization: Bearer <access_token>`（需已有会话，通常是 TG 登录后）。
  - req: `{ "email": "...", "password": "..." }`
  - 行为：当前用户（ctx.user.id）绑定邮箱，若邮箱已被占用则报错；触发邮箱验证流程。
  - res: `{ "code": 0, "data": { "user_id": "...", "email": "...", "email_verified": false } }`

- 安全与限频
  - TG token 短时有效；请求入口可按 IP/用户限频（后续实现）。
  - 所有响应隐藏内部错误，记录日志。
