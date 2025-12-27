import { getFlag } from '../utils/geo.ts'

// 生成编辑菜单
export function getEditKeyboard(video: any) {
  const keyboard: any[] = []
  const vid = video.id

  keyboard.push([
    {
      text: video.description ? '✏️ 修改描述' : '📝 添加描述',
      callback_data: `edit_description:${vid}`
    },
    {
      text: video.tags && video.tags.length > 0 ? '✏️ 修改标签' : '🏷️ 添加标签',
      callback_data: `edit_tags:${vid}`
    }
  ])

  keyboard.push([
    {
      text: video.location_country ? '✏️ 修改位置' : '📍 添加位置',
      callback_data: `edit_location:${vid}`
    },
    {
      text: video.is_private ? '🔒 私密' : '🌍 公开',
      callback_data: `toggle_privacy:${vid}`
    }
  ])

  keyboard.push([
    {
      text: video.is_adult ? '🔞 成人内容：是' : '🔞 成人内容：否',
      callback_data: `toggle_adult:${vid}`
    },
    {
      text: video.is_sea ? '🌏 东南亚板块：是' : '🌏 东南亚板块：否',
      callback_data: `toggle_sea:${vid}`
    }
  ])

  if (video.status === 'published') {
    keyboard.push([
      {
        text: video.is_top ? '📍 取消置顶' : '📌 置顶该视频',
        callback_data: `toggle_pin:${vid}`
      }
    ])
  }

  keyboard.push([
    { text: '✅ 立即发布', callback_data: `publish:${vid}` },
    { text: '💾 保存草稿', callback_data: `save_draft:${vid}` }
  ])

  keyboard.push([{ text: '🗑️ 删除视频', callback_data: `delete_video_${video.id}` }])

  if (video.status !== 'published') {
    keyboard.push([{ text: '⬅️ 返回草稿列表', callback_data: 'back_my_drafts' }])
  }

  return { inline_keyboard: keyboard }
}

// 🎯 从 callback_data 中解析带 videoId 的动作（用于“视频已就绪”菜单）
export function parseVideoAction(data: string): { action: string; videoId: string } | null {
  if (!data || !data.includes(':')) return null
  const idx = data.indexOf(':')
  const action = data.slice(0, idx)
  const videoId = data.slice(idx + 1)
  if (!videoId) return null

  const supported = new Set([
    'edit_description',
    'edit_tags',
    'edit_location',
    'toggle_privacy',
    'toggle_adult',
    'toggle_sea',
    'toggle_pin',
    'publish',
    'save_draft',
    'cancel_edit'
  ])
  if (!supported.has(action)) return null
  return { action, videoId }
}

// 生成编辑菜单文本
export function getEditMenuText(video: any): string {
  let titleText = '✅ <b>视频已就绪</b>'
  const contentType = video.content_type || 'video'
  if (contentType === 'image') {
    titleText = '✅ <b>图片已就绪</b>'
  } else if (contentType === 'album') {
    const images = typeof video.images === 'string' ? JSON.parse(video.images) : video.images || []
    titleText = `✅ <b>相册已就绪</b> (${images.length}张)`
  }

  let descText = '未设置'
  if (video.description) {
    // ✅ 就绪/编辑菜单：描述展示完整（不截断）
    // 说明：长度限制已由 DB 约束取消；展示截断交给前端（App 内）处理
    descText = String(video.description)
  }

  let tagsText = '未设置'
  if (video.tags && video.tags.length > 0) {
    tagsText = video.tags.map((t: string) => '#' + t).join(' ')
  }

  let locationText = '未设置'
  if (video.location_country) {
    locationText = getFlag(video.location_country_code!) + ' ' + video.location_country
    if (video.location_city) {
      locationText += ' · ' + video.location_city
    }
  }

  const privacyText = video.is_private ? '🔒 私密' : '🌍 公开'
  const adultText = video.is_adult ? '是' : '否'
  const seaText = video.is_sea ? '是' : '否'

  const lines = [
    titleText,
    '',
    '⚠️ <b>如果你上传的是成人向内容，请务必勾选「成人内容：是」。</b>',
    '⚠️ <b>如果你上传的是东南亚风情内容，请勾选「东南亚板块：是」。</b>',
    '⛔ 严禁任何涉及儿童 / 未成年人的色情或暗示内容，一经发现将立刻封禁账号。',
    '',
    `📝 描述：${descText}`,
    `🏷️ 标签：${tagsText}`,
    `📍 位置：${locationText}`,
    `🔐 隐私：${privacyText}`,
    `🔞 成人：${adultText}`,
    `🌏 东南亚：${seaText}`,
    `📌 置顶：${video.is_top ? '已置顶' : '未置顶'}`
  ]

  return lines.join('\n')
}
