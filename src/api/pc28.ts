import { supabase } from '@/utils/supabase'

// 游戏配置接口
export interface PC28GameConfig {
  id: string
  room_id: string
  anchor_id: string
  is_enabled: boolean
  game_settings: {
    big_small?: { enabled: boolean; big: number; small: number }
    odd_even?: { enabled: boolean; odd: number; even: number }
    combinations?: {
      enabled: boolean
      big_odd: number
      big_even: number
      small_odd: number
      small_even: number
    }
    extreme?: { enabled: boolean; extreme_big: number; extreme_small: number }
    patterns?: { enabled: boolean; pair: number; straight: number; leopard: number }
    single_point?: { enabled: boolean; odds: Record<string, number> }
  }
  created_at: string
  updated_at: string
}

// 游戏期数接口
export interface PC28GameRound {
  id: string
  room_id: string
  anchor_id: string
  period_number: string
  game_name: string
  status: 'betting' | 'sealed' | 'settled'
  seal_at: string | null
  result: { num1: number; num2: number; num3: number; sum: number } | null
  settled_at: string | null
  total_bet_amount: number
  total_payout: number
  total_platform_fee: number
  created_at: string
  updated_at: string
}

// 下注记录接口
export interface PC28Bet {
  id: string
  round_id: string
  room_id: string
  user_id: string
  bet_type: string
  bet_value: number | null
  amount: number
  odds: number
  status: 'pending' | 'settled'
  is_win: boolean | null
  payout: number
  platform_fee: number
  user_gain: number
  anchor_payout: number
  created_at: string
  settled_at: string | null
}

/**
 * 获取游戏配置
 */
export async function getPC28Config(roomId: string): Promise<PC28GameConfig | null> {
  const { data, error } = await supabase
    .from('pc28_game_configs')
    .select('*')
    .eq('room_id', roomId)
    .maybeSingle()

  if (error) {
    console.error('[PC28] getPC28Config error:', error)
    return null
  }

  return data as PC28GameConfig | null
}

/**
 * 创建或更新游戏配置
 */
export async function upsertPC28Config(
  roomId: string,
  config: Partial<PC28GameConfig>
): Promise<PC28GameConfig> {
  // 使用RPC函数来确保anchor_id正确设置
  const { data: rpcResult, error: rpcError } = await supabase.rpc('upsert_pc28_game_config', {
    p_room_id: roomId,
    p_game_settings: config.game_settings || null,
    p_is_enabled: config.is_enabled !== undefined ? config.is_enabled : null
  })

  if (rpcError) {
    throw rpcError
  }

  if (!rpcResult.success) {
    throw new Error(rpcResult.message || '保存配置失败')
  }

  // 重新获取配置
  const { data, error } = await supabase
    .from('pc28_game_configs')
    .select('*')
    .eq('room_id', roomId)
    .single()

  if (error) throw error
  return data as PC28GameConfig
}

/**
 * 开盘
 */
export async function openPC28Round(
  roomId: string,
  periodNumber: string,
  gameName: string,
  sealAt?: Date
): Promise<{ success: boolean; message: string; round_id?: string }> {
  const { data, error } = await supabase.rpc('open_pc28_round', {
    p_room_id: roomId,
    p_period_number: periodNumber,
    p_game_name: gameName,
    p_seal_at: sealAt?.toISOString() || null
  })

  if (error) {
    return { success: false, message: error.message }
  }

  return data as { success: boolean; message: string; round_id?: string }
}

/**
 * 下注
 */
export async function placePC28Bet(
  roundId: string,
  betType: string,
  amount: number,
  betValue?: number
): Promise<{ success: boolean; message: string; bet_id?: string }> {
  const { data, error } = await supabase.rpc('place_pc28_bet', {
    p_round_id: roundId,
    p_bet_type: betType,
    p_amount: amount,
    p_bet_value: betValue !== undefined ? betValue : null
  })

  if (error) {
    return { success: false, message: error.message }
  }

  return data as { success: boolean; message: string; bet_id?: string }
}

/**
 * 结算
 */
export async function settlePC28Round(
  roundId: string,
  num1: number,
  num2: number,
  num3: number
): Promise<{
  success: boolean
  message: string
  total_bet_amount?: number
  total_payout?: number
  total_platform_fee?: number
}> {
  const { data, error } = await supabase.rpc('settle_pc28_round', {
    p_round_id: roundId,
    p_num1: num1,
    p_num2: num2,
    p_num3: num3
  })

  if (error) {
    return { success: false, message: error.message }
  }

  return data as {
    success: boolean
    message: string
    total_bet_amount?: number
    total_payout?: number
    total_platform_fee?: number
  }
}

/**
 * 获取当前期数（包括已结算的，用于显示结果）
 */
export async function getCurrentRound(roomId: string): Promise<PC28GameRound | null> {
  const { data, error } = await supabase
    .from('pc28_game_rounds')
    .select('*')
    .eq('room_id', roomId)
    .or('status.eq.betting,status.eq.sealed,status.eq.settled')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (error) {
    console.error('[PC28] getCurrentRound error:', error)
    return null
  }

  return data as PC28GameRound | null
}

/**
 * 获取最近一个已结算的期数（用于显示上局信息）
 * @param excludeRoundId 排除的round ID（通常是当前round，避免重复显示）
 */
export async function getLastSettledRound(
  roomId: string,
  excludeRoundId?: string
): Promise<PC28GameRound | null> {
  let query = supabase
    .from('pc28_game_rounds')
    .select('*')
    .eq('room_id', roomId)
    .eq('status', 'settled')
    .order('settled_at', { ascending: false })
    .limit(1)

  // 如果指定了排除的round ID，则排除它
  if (excludeRoundId) {
    query = query.neq('id', excludeRoundId)
  }

  const { data, error } = await query.maybeSingle()

  if (error) {
    console.error('[PC28] getLastSettledRound error:', error)
    return null
  }

  return data as PC28GameRound | null
}

/**
 * 获取期数列表
 */
export async function getRoundList(roomId: string, limit = 20): Promise<PC28GameRound[]> {
  const { data, error } = await supabase
    .from('pc28_game_rounds')
    .select('*')
    .eq('room_id', roomId)
    .order('created_at', { ascending: false })
    .limit(limit)

  if (error) throw error
  return (data || []) as PC28GameRound[]
}

/**
 * 获取我的下注记录（当前期）
 */
export async function getMyBets(roundId: string): Promise<PC28Bet[]> {
  const { data, error } = await supabase
    .from('pc28_bets')
    .select('*')
    .eq('round_id', roundId)
    .order('created_at', { ascending: false })

  if (error) throw error
  return (data || []) as PC28Bet[]
}

/**
 * 获取我的历史下注记录
 */
export async function getMyBetHistory(roomId?: string, limit = 50): Promise<PC28Bet[]> {
  let query = supabase
    .from('pc28_bets')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(limit)

  if (roomId) {
    query = query.eq('room_id', roomId)
  }

  const { data, error } = await query

  if (error) throw error
  return (data || []) as PC28Bet[]
}

/**
 * 获取所有下注记录（主播视角，当前期的所有下注）
 * 使用RPC函数确保权限正确
 */
export async function getAllBets(roundId: string): Promise<PC28Bet[]> {
  console.log('[PC28 API] Calling get_all_pc28_bets_for_anchor with roundId:', roundId)

  const { data, error } = await supabase.rpc('get_all_pc28_bets_for_anchor', {
    p_round_id: roundId
  })

  if (error) {
    console.error('[PC28 API Error] getAllBets error:', error)
    console.error('[PC28 API Error] Error details:', {
      message: error.message,
      code: error.code,
      details: error.details,
      hint: error.hint
    })
    throw error
  }

  console.log('[PC28 API] getAllBets result:', data?.length || 0, 'bets')
  return (data || []) as PC28Bet[]
}

/**
 * 获取已结算期数的所有下注记录（所有用户可访问）
 */
export async function getAllBetsForSettled(roundId: string): Promise<PC28Bet[]> {
  console.log('[PC28 API] Calling get_all_pc28_bets_for_settled with roundId:', roundId)

  const { data, error } = await supabase.rpc('get_all_pc28_bets_for_settled', {
    p_round_id: roundId
  })

  if (error) {
    console.error('[PC28 API Error] getAllBetsForSettled error:', error)
    console.error('[PC28 API Error] Error details:', {
      message: error.message,
      code: error.code,
      details: error.details,
      hint: error.hint
    })
    throw error
  }

  console.log('[PC28 API] getAllBetsForSettled result:', data?.length || 0, 'bets')
  return (data || []) as PC28Bet[]
}

/**
 * 取消下注
 */
export async function cancelPC28Bet(betId: string): Promise<{ success: boolean; message: string }> {
  const { data, error } = await supabase.rpc('cancel_pc28_bet', {
    p_bet_id: betId
  })

  if (error) {
    return { success: false, message: error.message }
  }

  return data as { success: boolean; message: string }
}

/**
 * 封盘
 */
export async function sealRound(roundId: string): Promise<{ success: boolean; message: string }> {
  const { data, error } = await supabase.rpc('seal_pc28_round', {
    p_round_id: roundId
  })

  if (error) {
    return { success: false, message: error.message }
  }

  return data as { success: boolean; message: string }
}

/**
 * 自动封盘（检查并封盘所有到期的期数）
 */
export async function autoSealPC28Rounds(): Promise<{
  success: boolean
  updated_count: number
  message: string
}> {
  const { data, error } = await supabase.rpc('auto_seal_pc28_rounds')

  if (error) {
    throw error
  }

  return data as { success: boolean; updated_count: number; message: string }
}

/**
 * 结束游戏（关闭PC28功能）
 */
export async function closePC28Game(roomId: string): Promise<{
  success: boolean
  message: string
  refund_count?: number
  total_refund?: number
}> {
  const { data, error } = await supabase.rpc('close_pc28_game', {
    p_room_id: roomId
  })

  if (error) {
    return { success: false, message: error.message }
  }

  return data as {
    success: boolean
    message: string
    refund_count?: number
    total_refund?: number
  }
}

/**
 * 获取PC28相关的资金流水记录
 * 使用数据库函数确保排序正确（created_at DESC, id DESC）
 */
export async function getPC28Transactions(limit = 50): Promise<
  Array<{
    id: string
    amount: number
    balance_after: number
    type: string
    description: string
    created_at: string
    related_id: string | null
  }>
> {
  // 获取当前用户ID
  const {
    data: { user }
  } = await supabase.auth.getUser()
  if (!user) throw new Error('用户未登录')

  // 使用数据库函数获取正确排序的交易记录
  const { data, error } = await supabase.rpc('get_pc28_transactions', {
    p_user_id: user.id,
    p_limit: limit
  })

  if (error) throw error
  return (data || []) as Array<{
    id: string
    amount: number
    balance_after: number
    type: string
    description: string
    created_at: string
    related_id: string | null
  }>
}
