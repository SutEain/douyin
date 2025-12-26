import { supabase } from './supabase'

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
  const ext = file.name.split('.').pop()
  const fileName = `${folder}/${crypto.randomUUID()}.${ext}`

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
