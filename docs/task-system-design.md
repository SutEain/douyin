# 任务系统设计方案

## 🎯 核心目标

- **快速裂变**：通过邀请+分享机制扩大用户
- **内容激励**：鼓励用户发布优质作品
- **金额奖励**：直接的现金激励，提升参与动力

---

## 🌟 新人任务（一次性，门槛低）

新人任务目的：**快速引导新用户完成关键行为，培养创作习惯**

| 任务 | 条件 | 奖励 | 设计目的 |
|------|------|------|----------|
| 🎬 **首发作品** | 发布第1个作品 | ¥0.5 | 快速转化为创作者 |
| ❤️ **首获3赞** | 作品获得3个赞 | ¥1.0 | 引导分享求赞→裂变 |
| 👁️ **首获10播放** | 作品获得10次播放 | ¥0.5 | 鼓励传播 |
| 👥 **首次邀请** | 成功邀请1人 | ¥2.0 | 核心裂变任务 |

> 💡 **总计：新人完成全部任务可得 ¥4.0**

### 关键设计思路

- "首获3赞"只需3个赞，用户大概率会分享给朋友求赞 → **自然裂变**
- 奖励金额小但即时，给用户正向反馈
- 门槛极低，人人可完成

---

## 📈 作品激励（持续奖励）

作品里程碑奖励：**鼓励创作优质内容**

| 里程碑 | 条件 | 奖励 |
|--------|------|------|
| 🔥 热门作品 | 单作品获100赞 | ¥5.0 |
| 🔥🔥 爆款作品 | 单作品获500赞 | ¥20.0 |
| 🔥🔥🔥 超级爆款 | 单作品获1000赞 | ¥50.0 |

### 补充规则

- 每个作品的里程碑奖励只能领取一次
- 达到更高里程碑时，只发放差额奖励（或全额，待定）

---

## 👥 邀请激励（裂变核心）

| 任务 | 条件 | 奖励 |
|------|------|------|
| 🎁 邀请新人 | 每成功邀请1人 | ¥2.0 |
| 📹 徒弟发布 | 邀请的人发布作品 | ¥0.5/个（上限10个） |
| 💰 师徒分润 | 徒弟作品获赞 | 10%分润（可选） |

### 邀请规则

- 被邀请人需通过邀请链接首次启动Bot
- 徒弟发布奖励上限10个作品，防止刷量
- 师徒分润可作为长期激励（可选功能）

---

## 📅 每日任务（可选，提升日活）

| 任务 | 条件 | 奖励 |
|------|------|------|
| 📱 每日签到 | 打开App | ¥0.1 |
| 👀 每日浏览 | 看10个视频 | ¥0.1 |
| ❤️ 每日点赞 | 点赞5个视频 | ¥0.1 |
| 📤 每日分享 | 分享1个视频 | ¥0.2 |

> ⚠️ 每日任务金额小，主要目的是提升日活，可后期再做

---

## 💾 数据库设计

### 1. 用户余额（profiles 表新增字段）

```sql
ALTER TABLE profiles ADD COLUMN balance INTEGER DEFAULT 0; -- 余额（单位：分）
ALTER TABLE profiles ADD COLUMN total_earned INTEGER DEFAULT 0; -- 累计收益（单位：分）
```

### 2. 任务定义表

```sql
CREATE TABLE tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code VARCHAR(50) UNIQUE NOT NULL, -- 任务代码，如 newbie_first_publish
  name VARCHAR(100) NOT NULL, -- 任务名称
  description TEXT, -- 任务描述
  task_type VARCHAR(20) NOT NULL, -- newbie/milestone/daily/invite
  condition_type VARCHAR(30) NOT NULL, -- publish/like_received/view/invite
  condition_value INTEGER NOT NULL DEFAULT 1, -- 达成数量
  reward_amount INTEGER NOT NULL DEFAULT 0, -- 奖励金额（单位：分）
  is_active BOOLEAN DEFAULT true,
  sort_order INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- 预置新人任务
INSERT INTO tasks (code, name, description, task_type, condition_type, condition_value, reward_amount, sort_order) VALUES
('newbie_first_publish', '首发作品', '发布你的第1个作品', 'newbie', 'publish', 1, 50, 1),
('newbie_first_3_likes', '首获3赞', '作品累计获得3个赞', 'newbie', 'like_received', 3, 100, 2),
('newbie_first_10_views', '首获10播放', '作品累计获得10次播放', 'newbie', 'view', 10, 50, 3),
('newbie_first_invite', '首次邀请', '成功邀请1位好友', 'newbie', 'invite', 1, 200, 4);

-- 预置作品里程碑任务
INSERT INTO tasks (code, name, description, task_type, condition_type, condition_value, reward_amount, sort_order) VALUES
('milestone_100_likes', '热门作品', '单作品获得100赞', 'milestone', 'single_video_likes', 100, 500, 10),
('milestone_500_likes', '爆款作品', '单作品获得500赞', 'milestone', 'single_video_likes', 500, 2000, 11),
('milestone_1000_likes', '超级爆款', '单作品获得1000赞', 'milestone', 'single_video_likes', 1000, 5000, 12);
```

### 3. 用户任务进度表

```sql
CREATE TABLE user_tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id),
  task_id UUID NOT NULL REFERENCES tasks(id),
  progress INTEGER DEFAULT 0, -- 当前进度
  completed BOOLEAN DEFAULT false,
  claimed BOOLEAN DEFAULT false, -- 是否已领取奖励
  completed_at TIMESTAMPTZ,
  claimed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(user_id, task_id)
);

-- 索引
CREATE INDEX idx_user_tasks_user_id ON user_tasks(user_id);
CREATE INDEX idx_user_tasks_completed ON user_tasks(user_id, completed);
```

### 4. 奖励流水表

```sql
CREATE TABLE reward_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id),
  task_id UUID REFERENCES tasks(id),
  amount INTEGER NOT NULL, -- 金额（单位：分）
  reason VARCHAR(100), -- 奖励原因
  related_id UUID, -- 关联ID（如视频ID、被邀请人ID）
  created_at TIMESTAMPTZ DEFAULT now()
);

-- 索引
CREATE INDEX idx_reward_logs_user_id ON reward_logs(user_id);
CREATE INDEX idx_reward_logs_created_at ON reward_logs(created_at);
```

### 5. 作品里程碑记录表（防止重复领取）

```sql
CREATE TABLE video_milestones (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  video_id UUID NOT NULL REFERENCES videos(id),
  user_id UUID NOT NULL REFERENCES profiles(id),
  milestone_type VARCHAR(30) NOT NULL, -- likes_100/likes_500/likes_1000
  claimed BOOLEAN DEFAULT false,
  claimed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(video_id, milestone_type)
);
```

---

## 🔄 任务触发时机

| 触发事件 | 检查的任务 |
|----------|------------|
| 用户发布视频 | newbie_first_publish |
| 视频被点赞 | newbie_first_3_likes, milestone_*_likes |
| 视频被播放 | newbie_first_10_views |
| 邀请成功 | newbie_first_invite |
| 徒弟发布作品 | invite_apprentice_publish |

---

## 📱 前端展示

### Bot 个人中心

```
👤 个人中心

💰 余额：¥12.50
📊 累计收益：¥25.00

📋 任务中心 →
```

### 任务中心页面

```
🎯 新人任务

✅ 首发作品 - 已完成 +¥0.5
🔄 首获3赞 - 进度 1/3
⬜ 首获10播放 - 未开始
⬜ 首次邀请 - 未开始

---

🏆 作品成就

🔥 热门作品(100赞) - ¥5.0
🔥🔥 爆款作品(500赞) - ¥20.0
🔥🔥🔥 超级爆款(1000赞) - ¥50.0
```

---

## ⚠️ 风控考虑

1. **刷量防护**：同一设备/IP 的点赞不计入
2. **提现门槛**：余额满 ¥10 可提现
3. **每日上限**：每日任务奖励设上限
4. **人工审核**：大额奖励需人工审核

---

## 📝 TODO

- [ ] 数据库迁移
- [ ] 任务检查逻辑
- [ ] Bot 任务中心入口
- [ ] 奖励发放逻辑
- [ ] 余额展示
- [ ] 提现功能（后期）

