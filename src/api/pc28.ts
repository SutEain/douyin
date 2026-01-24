import { supabase } from '@/utils/supabase'

// 注意：PC28GameConfig接口已废弃，平台统一规则，不再需要配置
// 保留接口定义仅用于类型兼容性
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
  global_round_id: string // 关联到全局期数ID（新系统）
  room_id: string // 记录在哪个房间下的注
  user_id: string
  bet_type: string
  bet_value: number | null
  amount: number
  odds: number
  status: 'pending' | 'settled' | 'cancelled'
  is_win: boolean | null
  payout: number
  platform_fee: number
  user_gain: number
  anchor_payout: number
  refund_amount?: number // 退款金额字段
  created_at: string
  settled_at: string | null
}

/**
 * @deprecated 已废弃：平台统一规则，不再需要配置
 * 获取游戏配置（保留用于向后兼容，始终返回null）
 */
export async function getPC28Config(roomId: string): Promise<PC28GameConfig | null> {
  console.warn('[PC28] getPC28Config is deprecated, platform uses unified rules')
  return null
}

/**
 * @deprecated 已废弃：平台统一规则，不再需要配置
 * 创建或更新游戏配置（保留用于向后兼容，不执行任何操作）
 */
export async function upsertPC28Config(
  roomId: string,
  config: Partial<PC28GameConfig>
): Promise<PC28GameConfig> {
  console.warn('[PC28] upsertPC28Config is deprecated, platform uses unified rules')
  throw new Error('配置功能已废弃，平台统一规则')
}

/**
 * @deprecated 已废弃：使用全局期数系统，不再需要手动开盘
 * 开盘（游戏名称固定为PC28）
 */
export async function openPC28Round(
  roomId: string,
  periodNumber: string,
  sealAt?: Date
): Promise<{ success: boolean; message: string; round_id?: string }> {
  const { data, error } = await supabase.rpc('open_pc28_round', {
    p_room_id: roomId,
    p_period_number: periodNumber,
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
 * @deprecated 已废弃：使用全局期数系统，自动结算
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
 * @deprecated 已废弃：使用getCurrentGlobalRound获取全局期数
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
 * @deprecated 已废弃：使用全局期数系统
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
 * 获取我的下注记录（当前期）- 支持全局期数
 */
export async function getMyBets(roundId: string, useGlobalRound = false): Promise<PC28Bet[]> {
  const {
    data: { user }
  } = await supabase.auth.getUser()
  if (!user) throw new Error('用户未登录')

  let query = supabase.from('pc28_bets').select('*').eq('user_id', user.id)

  if (useGlobalRound) {
    query = query.eq('global_round_id', roundId)
  } else {
    query = query.eq('round_id', roundId)
  }

  const { data, error } = await query.order('created_at', { ascending: false })

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
    p_global_round_id: roundId
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
    p_global_round_id: roundId
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
 * @deprecated 已废弃：使用全局期数系统，自动封盘
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

// ============================================================================
// 全局期数相关API（新系统）
// ============================================================================

/**
 * 全局期数接口
 */
export interface PC28GlobalRound {
  id: string
  period_number: string
  status: 'betting' | 'sealed' | 'settled' | 'cancelled'
  seal_at: string | null
  result: { num1: number; num2: number; num3: number; sum: number } | null
  settled_at: string | null
  cancelled_at: string | null
  total_bet_amount: number
  total_payout: number
  total_platform_fee: number
  created_at: string
  updated_at: string
}

/**
 * 开启PC28游戏（主播操作）
 */
export async function enablePC28ForRoom(
  roomId: string
): Promise<{ success: boolean; message: string }> {
  const { data, error } = await supabase.rpc('enable_pc28_for_room', {
    p_room_id: roomId
  })

  if (error) {
    return { success: false, message: error.message }
  }

  return data as { success: boolean; message: string }
}

/**
 * 关闭PC28游戏（主播操作）
 */
export async function disablePC28ForRoom(
  roomId: string
): Promise<{ success: boolean; message: string }> {
  const { data, error } = await supabase.rpc('disable_pc28_for_room', {
    p_room_id: roomId
  })

  if (error) {
    return { success: false, message: error.message }
  }

  return data as { success: boolean; message: string }
}

/**
 * 获取当前全局期数
 */
export async function getCurrentGlobalRound(): Promise<PC28GlobalRound | null> {
  const { data, error } = await supabase.rpc('get_current_global_round')

  if (error) {
    console.error('[PC28 API] getCurrentGlobalRound error:', error)
    return null
  }

  if (!data || data.length === 0) {
    return null
  }

  return data[0] as PC28GlobalRound
}

/**
 * 获取房间PC28状态
 */
export async function getRoomPC28Status(roomId: string): Promise<{
  success: boolean
  data: {
    enabled: boolean
    current_round: PC28GlobalRound | null
  }
}> {
  const { data, error } = await supabase.rpc('get_room_pc28_status', {
    p_room_id: roomId
  })

  if (error) {
    throw error
  }

  return data as {
    success: boolean
    data: {
      enabled: boolean
      current_round: PC28GlobalRound | null
    }
  }
}

/**
 * 全局期数下注
 */
export async function placePC28BetGlobal(
  globalRoundId: string,
  roomId: string,
  betType: string,
  amount: number,
  betValue?: number
): Promise<{ success: boolean; message: string; bet_id?: string }> {
  const { data, error } = await supabase.rpc('place_pc28_bet_global', {
    p_global_round_id: globalRoundId,
    p_room_id: roomId,
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
 * 取消全局期数（退回下注）
 */
export async function cancelGlobalRound(globalRoundId: string): Promise<{
  success: boolean
  message: string
  refund_count?: number
  total_refund?: number
}> {
  const { data, error } = await supabase.rpc('cancel_global_round', {
    p_global_round_id: globalRoundId
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
 * 获取开奖历史（最新20期已结算的期数）
 * 优先从数据库查询，失败时使用备用API
 */
export async function getPC28History(limit = 20): Promise<PC28GlobalRound[]> {
  // 1. 优先从数据库查询
  try {
    const { data, error } = await supabase
      .from('pc28_global_rounds')
      .select('*')
      .eq('status', 'settled')
      .not('result', 'is', null)
      .order('settled_at', { ascending: false })
      .limit(limit)

    if (!error && data && data.length > 0) {
      // 按period_number数字排序（因为period_number是字符串，需要转换为数字）
      const sorted = data.sort((a, b) => {
        const numA = parseInt(a.period_number || '0', 10)
        const numB = parseInt(b.period_number || '0', 10)
        return numB - numA
      })
      return sorted as PC28GlobalRound[]
    }
  } catch (dbError) {
    console.warn('[PC28 API] Database query failed, trying backup API:', dbError)
  }

  // 2. 数据库查询失败或数据不足，使用备用API
  try {
    const backupUrl = `http://pc28.help/kj.json?limit=${limit}`
    const response = await fetch(backupUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        Accept: 'application/json'
      }
    })

    if (!response.ok) {
      throw new Error(`Backup API returned ${response.status}`)
    }

    const result = await response.json()

    if (!result.data || !Array.isArray(result.data) || result.data.length === 0) {
      console.warn('[PC28 API] Backup API returned empty data')
      return []
    }

    // 转换备用API数据格式为 PC28GlobalRound 格式
    const history: PC28GlobalRound[] = result.data.map((item: any) => {
      // 解析开奖号码：opennum 格式为 "2+9+7"
      const nums = item.opennum.split('+').map((n: string) => parseInt(n.trim(), 10))
      if (nums.length !== 3) {
        throw new Error(`Invalid opennum format: ${item.opennum}`)
      }

      // 解析时间：opentime 格式为 "01-25 06:03:30"，需要转换为完整日期时间
      // 假设是当前年份
      const currentYear = new Date().getFullYear()
      const timeStr = `${currentYear}-${item.opentime}`
      const settledAt = new Date(
        timeStr.replace(/(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})/, '$1-$2-$3T$4:$5:$6')
      )

      return {
        id: `backup_${item.qihao}`, // 临时ID
        period_number: item.qihao,
        status: 'settled' as const,
        seal_at: null,
        result: {
          num1: nums[0],
          num2: nums[1],
          num3: nums[2],
          sum: parseInt(item.sum, 10)
        },
        settled_at: settledAt.toISOString(),
        cancelled_at: null,
        total_bet_amount: 0,
        total_payout: 0,
        total_platform_fee: 0,
        created_at: settledAt.toISOString(),
        updated_at: settledAt.toISOString()
      }
    })

    // 按period_number数字排序
    return history.sort((a, b) => {
      const numA = parseInt(a.period_number || '0', 10)
      const numB = parseInt(b.period_number || '0', 10)
      return numB - numA
    })
  } catch (backupError) {
    console.error('[PC28 API] Backup API also failed:', backupError)
    // 如果备用API也失败，返回空数组而不是抛出错误
    return []
  }
}
