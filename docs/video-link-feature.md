# 视频流链接跳转功能

## 功能说明

在 Telegram 小程序的 feed 视频流中，视频描述中的链接现在可以点击跳转。支持以下类型的链接：

1. **Telegram Bot 链接**
   - 格式：`@botname` 或 `@botname?start=xxx`
   - 示例：`@advertiser_bot` 或 `@advertiser_bot?start=promo123`
   - 点击后会在 Telegram 中打开对应的机器人

2. **Telegram 完整链接**
   - 格式：`https://t.me/botname?start=xxx`
   - 示例：`https://t.me/advertiser_bot?start=promo123`
   - 点击后会在 Telegram 中打开对应的机器人

3. **普通网站链接**
   - 格式：`https://example.com` 或 `http://example.com`
   - 示例：`https://advertiser.com/promo`
   - 点击后会在浏览器中打开（Telegram WebApp 内）

## 使用方法

### 在视频描述中添加链接

发布视频时，在描述中直接输入链接即可：

```
🎉 限时优惠！点击链接查看详情：
@advertiser_bot?start=promo123

或者访问我们的网站：
https://advertiser.com/promo
```

### 链接样式

- **Telegram Bot 链接**：显示为 Telegram 蓝色（#229ed9），带下划线
- **普通网站链接**：显示为蓝色（#4fc3f7），带下划线
- 点击时有透明度变化反馈

## 技术实现

### 链接解析

使用 `src/utils/linkParser.ts` 中的 `parseLinks()` 函数解析描述文本：

```typescript
import { parseLinks, openLink } from '@/utils/linkParser'

const text = "查看详情：@botname?start=123 或访问 https://example.com"
const parsed = parseLinks(text)
// 返回：
// [
//   { type: 'text', text: '查看详情：' },
//   { type: 'telegram_bot', text: '@botname?start=123', url: 'https://t.me/botname?start=123', ... },
//   { type: 'text', text: ' 或访问 ' },
//   { type: 'url', text: 'https://example.com', url: 'https://example.com' }
// ]
```

### 打开链接

使用 `openLink()` 函数打开链接：

```typescript
import { openLink } from '@/utils/linkParser'

// 自动判断链接类型并使用相应的 Telegram WebApp API
openLink(parsedLink)
```

### Telegram WebApp API

- **Telegram 链接**：使用 `Telegram.WebApp.openTelegramLink(url)`
- **普通链接**：使用 `Telegram.WebApp.openLink(url, { try_instant_view: false })`
- **降级处理**：如果不在 Telegram 环境中，使用 `window.open()` 打开

## 广告商使用建议

### 1. Telegram Bot 推广

如果广告商有自己的 Telegram Bot，可以在视频描述中添加：

```
🎁 限时优惠！点击机器人获取专属折扣：
@advertiser_bot?start=promo_code_123
```

### 2. 网站推广

如果广告商有网站，可以添加：

```
🌐 了解更多详情，访问我们的网站：
https://advertiser.com/promo
```

### 3. 组合使用

可以同时使用两种方式：

```
🎉 限时优惠活动！

方式1：点击机器人获取折扣码
@advertiser_bot?start=promo123

方式2：访问网站查看详情
https://advertiser.com/promo

#优惠 #限时活动
```

## 注意事项

1. **链接格式**：确保链接格式正确，Telegram Bot 用户名必须是 5-32 个字符
2. **安全性**：所有外部链接都会在新窗口打开，并设置 `noopener,noreferrer` 安全属性
3. **用户体验**：链接在描述中会高亮显示，点击时有视觉反馈
4. **兼容性**：在非 Telegram 环境中会自动降级使用普通浏览器打开

## 未来扩展

可以考虑添加的功能：

1. **链接预览**：显示链接的预览卡片
2. **链接统计**：统计链接点击次数
3. **链接验证**：验证链接是否有效
4. **自定义样式**：允许广告商自定义链接颜色和样式
