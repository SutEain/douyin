import { supabase } from './supabase'

/**
 * 生成随机 UUID (兼容非安全上下文)
 */
function generateUUID() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  // 兜底方案：手动生成 UUID v4 格式的随机字符串
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
    const r = (Math.random() * 16) | 0
    const v = c === 'x' ? r : (r & 0x3) | 0x8
    return v.toString(16)
  })
}

/**
 * 上传图片到 Supabase Storage
 * @param file 文件对象
 * @param bucket 存储桶名称
 * @param folder 文件夹路径
 */
export async function uploadImage(
  file: File,
  bucket: string = 'user-content',
  folder: string = 'avatars'
): Promise<string> {
  // 🎯 安全优化：禁止上传 SVG 等可能包含恶意脚本的文件
  const forbiddenExts = ['svg', 'html', 'htm', 'xml']
  const ext = file.name.split('.').pop()?.toLowerCase() || ''
  if (forbiddenExts.includes(ext) || file.type.includes('svg') || file.type.includes('html')) {
    throw new Error('不支持的文件格式，严禁上传 SVG 或 HTML 文件')
  }

  const fileName = `${folder}/${generateUUID()}.${ext}`

  const { data, error } = await supabase.storage.from(bucket).upload(fileName, file, {
    cacheControl: '3600',
    upsert: false
  })

  if (error) {
    throw error
  }

  // 获取公共 URL
  const {
    data: { publicUrl }
  } = supabase.storage.from(bucket).getPublicUrl(data.path)

  return publicUrl
}
