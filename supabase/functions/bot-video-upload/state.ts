import { supabase } from './supabaseClient.ts'

// 用户状态存储（使用数据库）
export interface UserState {
  // 注意：这里的 state 实际值在代码里比 union 更多（例如 editing_description 等）
  state: string
  draft_video_id?: string | null // UUID（用于“等待用户输入”的目标视频）
  current_message_id?: number | null // 当前编辑的消息ID（用于“等待用户输入”时回写菜单）
  dashboard_message_id?: number | null // “我的视频”主面板消息ID（单面板模式）
  context?: any // jsonb：存放各业务临时上下文（如已发布搜索/翻页）
}

// 获取或创建用户状态
export async function getUserState(userId: number): Promise<UserState> {
  const { data } = await supabase.from('user_bot_states').select('*').eq('user_id', userId).single()

  if (data) {
    return data as UserState
  }

  // 创建新状态
  const { data: newState } = await supabase
    .from('user_bot_states')
    .insert({ user_id: userId, state: 'idle' })
    .select()
    .single()

  return newState as UserState
}

// 更新用户状态
export async function updateUserState(userId: number, updates: Partial<UserState>) {
  await supabase.from('user_bot_states').upsert({
    user_id: userId,
    ...updates
  })
}
