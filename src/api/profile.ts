import { supabase } from '@/utils/supabase'
import { getCurrentUser } from '@/api/auth'

export type ProfileUpdatePayload = {
  nickname?: string | null
  username?: string | null
  bio?: string | null
  avatar_url?: string | null
  cover_url?: string | null
  gender?: number | null
  birthday?: string | null
  country?: string | null
  province?: string | null
  city?: string | null
  lang?: string | null
}

export async function updateProfile(payload: ProfileUpdatePayload) {
  const user = await getCurrentUser()
  if (!user) {
    throw new Error('请先登录后再编辑资料')
  }

  const { data, error } = await supabase
    .from('profiles')
    .update({
      ...payload,
      updated_at: new Date().toISOString()
    })
    .eq('id', user.id)
    .select('*')
    .single()

  if (error) {
    throw error
  }

  return data
}

