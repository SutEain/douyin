/**
 * PC28 轮询脚本
 * 直接调用 API 并更新 Supabase 数据库
 * 使用 pm2 运行: pm2 start scripts/pc28-polling.js --name pc28-polling
 */

/* eslint-env node */
import dotenv from 'dotenv'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
import { existsSync } from 'fs'
import { createClient } from '@supabase/supabase-js'

// 加载环境变量（从脚本同目录）
const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const envPath = join(__dirname, '.env')

console.log(`[PC28-Poll] Script directory: ${__dirname}`)
console.log(`[PC28-Poll] Looking for .env at: ${envPath}`)

// 尝试多个可能的路径
const possiblePaths = [
  envPath, // 脚本同目录（优先）
  join(process.cwd(), '.env'), // 当前工作目录
  join(__dirname, '../.env') // 项目根目录（备用）
]

let envResult = null
let loadedPath = null

for (const path of possiblePaths) {
  if (existsSync(path)) {
    envResult = dotenv.config({ path })
    if (!envResult.error) {
      loadedPath = path
      console.log(`[PC28-Poll] ✅ Loaded .env from: ${path}`)
      break
    }
  }
}

// 如果都没成功，尝试直接加载（dotenv 会自动查找）
if (!loadedPath) {
  envResult = dotenv.config({ path: envPath })
  if (envResult.error) {
    console.warn(`[PC28-Poll] ⚠️ Failed to load .env: ${envResult.error.message}`)
    console.warn(`[PC28-Poll] Tried paths: ${possiblePaths.join(', ')}`)
  } else {
    loadedPath = envPath
    console.log(`[PC28-Poll] ✅ Loaded .env from: ${envPath}`)
  }
}

const API_TOKEN = process.env.PC28_API_TOKEN || '393a91a4f94211f0ba890d673692a033'
const API_URL = `https://www.apigx.cn/token/${API_TOKEN}/code/jnd28/rows/3.json`

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://zhlkanxfucnsatafeqdp.supabase.co'
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY

// 调试：显示环境变量加载情况（不显示完整 key）
if (SUPABASE_SERVICE_KEY) {
  console.log(`[PC28-Poll] ✅ SUPABASE_SERVICE_KEY loaded (length: ${SUPABASE_SERVICE_KEY.length})`)
} else {
  console.error('❌ SUPABASE_SERVICE_KEY is required')
  console.error(
    `[PC28-Poll] Available env vars: ${
      Object.keys(process.env)
        .filter((k) => k.includes('SUPABASE'))
        .join(', ') || 'none'
    }`
  )
  console.error(`[PC28-Poll] .env file path: ${envPath}`)
  process.exit(1)
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)

// 🎯 时间常量
const ROUND_DURATION = 3.5 * 60 * 1000 // 3分30秒
const SEAL_BEFORE_DRAW = 15 * 1000 // 15秒
const SEAL_DURATION = ROUND_DURATION - SEAL_BEFORE_DRAW // 3分15秒

const POLL_INTERVAL = 5000 // 5秒
const MAX_RETRIES = 3
const RETRY_DELAY = 1000 // 1秒

let isRunning = false
let consecutiveErrors = 0
const MAX_CONSECUTIVE_ERRORS = 10
let totalPolls = 0

/**
 * 调用 API 获取最新开奖数据
 */
async function fetchAPIData(retryCount = 0) {
  try {
    const response = await fetch(API_URL, {
      signal: AbortSignal.timeout(10000) // 10秒超时
    })

    if (!response.ok) {
      throw new Error(`API request failed: ${response.status}`)
    }

    const data = await response.json()

    if (!data.data || data.data.length === 0) {
      return null
    }

    return data.data[0] // 返回最新一期
  } catch (error) {
    if (retryCount < MAX_RETRIES && (error.code === 'ECONNRESET' || error.code === 'ETIMEDOUT')) {
      console.warn(`[PC28-Poll] Retry ${retryCount + 1}/${MAX_RETRIES} after error:`, error.message)
      await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY * (retryCount + 1)))
      return fetchAPIData(retryCount + 1)
    }
    throw error
  }
}

/**
 * 处理 PC28 数据并更新数据库
 */
async function processPC28Data() {
  // 1. 智能判断是否需要请求API
  // 先检查数据库中最新已结算期数的开奖时间，如果开奖时间在3分钟内，说明刚开奖，不需要请求API
  // （因为API返回的也是这个结果，不会有新数据）
  const { data: latestSettledRound } = await supabase
    .from('pc28_global_rounds')
    .select('period_number, settled_at')
    .eq('status', 'settled')
    .order('settled_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  let shouldFetchAPI = true
  let skipReason = ''

  if (latestSettledRound?.settled_at) {
    // 数据库中的 settled_at 应该是 UTC 时间（ISO 8601 格式）
    // 但如果之前存储时有问题（比如存储了北京时间），需要处理
    let settledTimeStr = latestSettledRound.settled_at
    let settledTime = new Date(settledTimeStr)

    // 确保 settled_at 是有效的日期
    if (isNaN(settledTime.getTime())) {
      console.warn(
        `⚠️ Invalid settled_at format: ${latestSettledRound.settled_at}, forcing API call`
      )
      shouldFetchAPI = true
      skipReason = ''
    } else {
      const nowUTC = Date.now() // UTC 时间戳（毫秒）
      let settledUTC = settledTime.getTime() // UTC 时间戳（毫秒）
      let timeSinceSettled = nowUTC - settledUTC
      const THREE_MINUTES = 3 * 60 * 1000 // 3分钟
      const ONE_HOUR = 60 * 60 * 1000 // 1小时（用于检测异常情况）
      const BEIJING_OFFSET = 8 * 60 * 60 * 1000 // 北京时间偏移（8小时）

      // 如果时间差是负数且接近8小时（±30分钟），说明可能是时区问题
      // settled_at 可能是北京时间但被当作UTC解析了
      if (timeSinceSettled < 0 && Math.abs(timeSinceSettled + BEIJING_OFFSET) < 30 * 60 * 1000) {
        // 可能是时区问题，尝试减去8小时（假设存储的是北京时间）
        console.warn(`⚠️ Possible timezone issue detected, adjusting settled time by -8 hours`)
        settledUTC = settledUTC - BEIJING_OFFSET
        timeSinceSettled = nowUTC - settledUTC
      }

      // 调试信息：显示UTC时间用于排查
      const settledUTCStr = new Date(settledUTC).toISOString()
      const nowUTCStr = new Date(nowUTC).toISOString()

      // 检查时间差是否合理：
      // 1. 如果时间差是负数，说明时间异常（可能是服务器时间不同步或时区问题），应该请求API
      // 2. 如果时间差超过1小时，说明可能停机重启了，应该请求API
      // 3. 只有在时间差正常且在3分钟内时，才跳过API请求
      if (timeSinceSettled < 0) {
        // 时间异常，强制请求API
        shouldFetchAPI = true
        skipReason = ''
        console.warn(
          `⚠️ Time anomaly detected: settled UTC (${settledUTCStr}) is after current UTC (${nowUTCStr}), diff=${Math.floor(timeSinceSettled / 1000)}s, forcing API call`
        )
      } else if (timeSinceSettled > ONE_HOUR) {
        // 时间差过大，可能是停机重启，强制请求API
        shouldFetchAPI = true
        skipReason = ''
        console.log(
          `⚠️ Large time gap detected (${Math.floor(timeSinceSettled / 1000)}s, ${Math.floor(timeSinceSettled / 60000)}min), possible service restart, forcing API call`
        )
      } else if (timeSinceSettled < THREE_MINUTES) {
        // 正常情况：3分钟内刚开奖，跳过API请求
        shouldFetchAPI = false
        skipReason = `Latest settled round ${latestSettledRound.period_number} was settled ${Math.floor(timeSinceSettled / 1000)}s ago (less than 3min)`
      }
    }
  }

  // 2. 只有在需要时才调用 API 获取最新开奖数据
  let latestItem = null
  if (shouldFetchAPI) {
    latestItem = await fetchAPIData()
    if (!latestItem) {
      return { success: true, message: 'No data from API' }
    }

    // 输出API返回的完整数据，用于调试
    console.log('📥 API Response:', JSON.stringify(latestItem, null, 2))
  } else {
    console.log(`⏭️ Skipping API call: ${skipReason}`)
    // 即使不请求API，也需要处理封盘逻辑
    // 继续执行后续的封盘检查
  }

  // 3. 如果有API数据，处理结算逻辑
  let latestPeriod = null
  let currentBettingPeriod = null

  if (latestItem) {
    latestPeriod = latestItem.expect
    const latestOpencode = latestItem.opencode

    // 解析开奖号码
    const nums = latestOpencode.split(',').map((n) => parseInt(n.trim()))
    if (nums.length !== 3) {
      throw new Error(`Invalid opencode format: ${latestOpencode}`)
    }

    currentBettingPeriod = String(parseInt(latestPeriod) + 1)

    // 2. 确保已开奖的期数在数据库中为 settled 状态
    const { data: existingSettledRound, error: checkError } = await supabase
      .from('pc28_global_rounds')
      .select('*')
      .eq('period_number', latestPeriod)
      .maybeSingle()

    if (checkError && checkError.code !== 'PGRST116') {
      throw checkError
    }

    // 3.1 结算 latestPeriod
    if (!existingSettledRound || existingSettledRound.status !== 'settled') {
      if (!existingSettledRound) {
        // 创建 settled 记录
        const { error: insertError } = await supabase.from('pc28_global_rounds').insert({
          period_number: latestPeriod,
          status: 'settled',
          result: {
            num1: nums[0],
            num2: nums[1],
            num3: nums[2],
            sum: nums[0] + nums[1] + nums[2]
          },
          settled_at: new Date().toISOString()
        })

        if (insertError) {
          console.error(`❌ Failed to create settled: ${latestPeriod}`, insertError)
        } else {
          console.log(`✅ Settled: ${latestPeriod} ${latestOpencode}`)
        }
      } else {
        // 更新为 settled 状态
        if (existingSettledRound.status === 'betting' || existingSettledRound.status === 'sealed') {
          // 先封盘
          if (existingSettledRound.status === 'betting') {
            await supabase
              .from('pc28_global_rounds')
              .update({ status: 'sealed', updated_at: new Date().toISOString() })
              .eq('id', existingSettledRound.id)
          }

          // 结算
          const { error: settleError } = await supabase.rpc('settle_global_round', {
            p_global_round_id: existingSettledRound.id,
            p_num1: nums[0],
            p_num2: nums[1],
            p_num3: nums[2]
          })

          if (settleError) {
            console.error(`❌ Failed to settle: ${latestPeriod}`, settleError)
          } else {
            console.log(`✅ Settled: ${latestPeriod} ${latestOpencode}`)
          }
        } else {
          // 直接更新为 settled
          const { error: updateError } = await supabase
            .from('pc28_global_rounds')
            .update({
              status: 'settled',
              result: {
                num1: nums[0],
                num2: nums[1],
                num3: nums[2],
                sum: nums[0] + nums[1] + nums[2]
              },
              settled_at: new Date().toISOString(),
              updated_at: new Date().toISOString()
            })
            .eq('id', existingSettledRound.id)

          if (updateError) {
            console.error(`❌ Failed to update: ${latestPeriod}`, updateError)
          } else {
            console.log(`✅ Settled: ${latestPeriod} ${latestOpencode}`)
          }
        }
      }
    }

    // 3.2 结算所有小于 latestPeriod 的未结算期数
    const { data: previousRoundsData } = await supabase.rpc('get_latest_unsettled_round')
    const previousRound =
      previousRoundsData && previousRoundsData.length > 0 ? previousRoundsData[0] : null

    if (previousRound && parseInt(previousRound.period_number) < parseInt(latestPeriod)) {
      if (previousRound.status === 'betting') {
        await supabase
          .from('pc28_global_rounds')
          .update({ status: 'sealed', updated_at: new Date().toISOString() })
          .eq('id', previousRound.id)
      }

      const { error: settleError } = await supabase.rpc('settle_global_round', {
        p_global_round_id: previousRound.id,
        p_num1: nums[0],
        p_num2: nums[1],
        p_num3: nums[2]
      })

      if (settleError) {
        console.error(`❌ Failed to settle previous: ${previousRound.period_number}`, settleError)
      } else {
        console.log(`✅ Settled previous: ${previousRound.period_number}`)
      }
    }

    // 3.3 确保当前应该开盘的期数（latestPeriod + 1）存在且为 betting 状态
    // 获取上一期的 settled_at 作为基准时间
    const { data: latestSettledRound } = await supabase
      .from('pc28_global_rounds')
      .select('settled_at')
      .eq('period_number', latestPeriod)
      .eq('status', 'settled')
      .order('settled_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    let baseTime = new Date()
    if (latestSettledRound?.settled_at) {
      baseTime = new Date(latestSettledRound.settled_at)
    }

    const { data: currentBettingRound } = await supabase
      .from('pc28_global_rounds')
      .select('*')
      .eq('period_number', currentBettingPeriod)
      .maybeSingle()

    if (!currentBettingRound) {
      // 创建当前开盘期数
      const nextSealAt = new Date(baseTime.getTime() + SEAL_DURATION)
      const { error: insertError } = await supabase.from('pc28_global_rounds').insert({
        period_number: currentBettingPeriod,
        status: 'betting',
        seal_at: nextSealAt.toISOString()
      })

      if (insertError) {
        // 如果是唯一约束冲突，说明期数已存在，跳过
        if (insertError.code === '23505') {
          console.log(`⏭️ Period ${currentBettingPeriod} already exists, skipping`)
        } else {
          console.error(`❌ Failed to create betting: ${currentBettingPeriod}`, insertError)
        }
      } else {
        console.log(`✅ Opened: ${currentBettingPeriod}`)

        // 只在成功创建时才推送开盘消息
        const { data: enabledRooms } = await supabase
          .from('pc28_room_enabled')
          .select('room_id')
          .eq('enabled', true)

        if (enabledRooms) {
          const messages = enabledRooms.map((room) => ({
            room_id: room.room_id,
            msg_type: 'pc28',
            content: JSON.stringify({
              type: 'round_opened',
              period_number: currentBettingPeriod,
              text: `PC28 ${currentBettingPeriod}期 已开盘，开始下注！`
            })
          }))

          await supabase.from('live_broadcast_messages').insert(messages)
        }
      }
    } else if (currentBettingRound.status !== 'betting') {
      // 更新为 betting 状态
      const nextSealAt = new Date(baseTime.getTime() + SEAL_DURATION)
      const { error: updateError } = await supabase
        .from('pc28_global_rounds')
        .update({
          status: 'betting',
          seal_at: nextSealAt.toISOString(),
          updated_at: new Date().toISOString()
        })
        .eq('id', currentBettingRound.id)

      if (updateError) {
        console.error(`❌ Failed to update betting: ${currentBettingPeriod}`, updateError)
      } else {
        console.log(`✅ Opened: ${currentBettingPeriod}`)
      }
    } else if (currentBettingRound.seal_at) {
      // 检查 seal_at 是否正确
      const currentSealAt = new Date(currentBettingRound.seal_at)
      const expectedSealAt = new Date(baseTime.getTime() + SEAL_DURATION)
      const timeDiff = currentSealAt.getTime() - expectedSealAt.getTime()

      if (Math.abs(timeDiff) > 30000) {
        const { error: updateError } = await supabase
          .from('pc28_global_rounds')
          .update({
            seal_at: expectedSealAt.toISOString(),
            updated_at: new Date().toISOString()
          })
          .eq('id', currentBettingRound.id)

        if (updateError) {
          console.error(`❌ Failed to fix seal_at: ${currentBettingPeriod}`, updateError)
        } else {
          console.log(`✅ Fixed seal_at: ${currentBettingPeriod}`)
        }
      }
    }
  }

  // 4. 如果没有API数据，获取当前期数用于封盘检查
  if (!currentBettingPeriod) {
    const { data: currentRoundsData } = await supabase.rpc('get_latest_unsettled_round')
    const currentRound =
      currentRoundsData && currentRoundsData.length > 0 ? currentRoundsData[0] : null
    if (currentRound) {
      currentBettingPeriod = currentRound.period_number
    }
  }

  // 5. 检查封盘时间（自动封盘）
  // 只处理当前期数或更新的期数，避免更新旧期数导致状态回退
  const { data: bettingRounds } = await supabase
    .from('pc28_global_rounds')
    .select('*')
    .eq('status', 'betting')
    .lte('seal_at', new Date().toISOString())
    .gte('period_number', currentBettingPeriod || '0') // 只处理当前期数或更新的期数

  if (bettingRounds && bettingRounds.length > 0) {
    for (const round of bettingRounds) {
      // 检查状态是否真的需要改变（避免重复更新）
      if (round.status === 'sealed') {
        continue
      }

      const { error: sealError } = await supabase
        .from('pc28_global_rounds')
        .update({ status: 'sealed', updated_at: new Date().toISOString() })
        .eq('id', round.id)
        .eq('status', 'betting') // 确保只更新 betting 状态的记录

      if (sealError) {
        console.error(`❌ Failed to seal: ${round.period_number}`, sealError)
      } else {
        // 检查是否真的更新了（affected rows > 0）
        const { data: updatedRound } = await supabase
          .from('pc28_global_rounds')
          .select('status')
          .eq('id', round.id)
          .single()

        if (updatedRound && updatedRound.status === 'sealed') {
          console.log(`✅ Sealed: ${round.period_number}`)

          // 只在状态真正改变时才推送封盘消息
          const { data: enabledRooms } = await supabase
            .from('pc28_room_enabled')
            .select('room_id')
            .eq('enabled', true)

          if (enabledRooms) {
            const messages = enabledRooms.map((room) => ({
              room_id: room.room_id,
              msg_type: 'pc28',
              content: JSON.stringify({
                type: 'round_sealed',
                period_number: round.period_number,
                text: `PC28 ${round.period_number}期 已封盘，停止下注！`
              })
            }))

            await supabase.from('live_broadcast_messages').insert(messages)
          }
        }
      }
    }
  }

  // 5. 检查超时封盘期数（自动取消）
  const timeoutThreshold = new Date(Date.now() - 5 * 60 * 1000) // 5分钟前
  const { data: timeoutRounds } = await supabase
    .from('pc28_global_rounds')
    .select('*')
    .eq('status', 'sealed')
    .lt('seal_at', timeoutThreshold.toISOString())

  if (timeoutRounds && timeoutRounds.length > 0) {
    for (const round of timeoutRounds) {
      const { error: cancelError } = await supabase.rpc('cancel_global_round', {
        p_global_round_id: round.id
      })

      if (cancelError) {
        console.error(`❌ Failed to cancel timeout: ${round.period_number}`, cancelError)
      } else {
        console.log(`✅ Cancelled timeout: ${round.period_number}`)
      }
    }
  }

  // 6. 检查是否有开启PC28的房间但没有当前期数（兜底开盘）
  const { data: enabledRooms } = await supabase
    .from('pc28_room_enabled')
    .select('room_id')
    .eq('enabled', true)

  if (enabledRooms && enabledRooms.length > 0) {
    const { data: currentRoundsData } = await supabase.rpc('get_latest_unsettled_round')
    const currentRound =
      currentRoundsData && currentRoundsData.length > 0 ? currentRoundsData[0] : null

    if (!currentRound) {
      // 获取最新已结算的期号
      const { data: lastSettled } = await supabase
        .from('pc28_global_rounds')
        .select('period_number, settled_at')
        .eq('status', 'settled')
        .order('settled_at', { ascending: false })
        .limit(1)
        .maybeSingle()

      let nextPeriod
      let lastSettledTime

      if (lastSettled && lastSettled.settled_at) {
        nextPeriod = String(parseInt(lastSettled.period_number) + 1)
        lastSettledTime = new Date(lastSettled.settled_at)
      } else {
        nextPeriod = currentBettingPeriod
        lastSettledTime = new Date()
      }

      const nextSealAt = new Date(lastSettledTime.getTime() + SEAL_DURATION)

      const { data: periodExists } = await supabase
        .from('pc28_global_rounds')
        .select('id')
        .eq('period_number', nextPeriod)
        .maybeSingle()

      if (!periodExists) {
        const { error: openError } = await supabase.from('pc28_global_rounds').insert({
          period_number: nextPeriod,
          status: 'betting',
          seal_at: nextSealAt.toISOString()
        })

        if (openError) {
          // 如果是唯一约束冲突，说明期数已存在，跳过
          if (openError.code === '23505') {
            console.log(`⏭️ Period ${nextPeriod} already exists, skipping`)
          } else {
            console.error(`❌ Failed to open: ${nextPeriod}`, openError)
          }
        } else {
          console.log(`✅ Opened: ${nextPeriod}`)

          // 只在成功创建时才推送开盘消息
          const messages = enabledRooms.map((room) => ({
            room_id: room.room_id,
            msg_type: 'pc28',
            content: JSON.stringify({
              type: 'round_opened',
              period_number: nextPeriod,
              text: `PC28 ${nextPeriod}期 已开盘，开始下注！`
            })
          }))

          await supabase.from('live_broadcast_messages').insert(messages)
        }
      }
    }
  }

  return {
    success: true,
    message: latestItem ? 'PC28 data processed' : skipReason || 'Skipped API call',
    latestPeriod: latestPeriod || 'N/A',
    currentBettingPeriod: currentBettingPeriod || 'N/A',
    apiCalled: !!latestItem
  }
}

/**
 * 执行一次轮询
 */
async function pollOnce() {
  if (isRunning) {
    return
  }

  isRunning = true
  const startTime = Date.now()
  totalPolls++

  try {
    const result = await processPC28Data()
    const duration = Date.now() - startTime

    consecutiveErrors = 0

    console.log(`✅ [PC28-Poll #${totalPolls}] Success (${duration}ms) - ${result.message || ''}`)
  } catch (error) {
    consecutiveErrors++
    const duration = Date.now() - startTime

    console.error(`❌ [PC28-Poll #${totalPolls}] Error (${duration}ms)`)
    console.error(`Error: ${error.message}`)

    if (consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
      console.error(`Too many consecutive errors (${consecutiveErrors}), stopping...`)
      process.exit(1)
    }
  } finally {
    isRunning = false
  }
}

/**
 * 主循环
 */
function startPolling() {
  console.log('\n' + '='.repeat(60))
  console.log('🚀 PC28 Polling Service Starting...')
  console.log('='.repeat(60))
  console.log(`📅 Start Time: ${new Date().toISOString()}`)
  console.log(`⏱️  Poll Interval: ${POLL_INTERVAL}ms (${POLL_INTERVAL / 1000}s)`)
  console.log(`🔗 API URL: ${API_URL}`)
  console.log(`🔄 Max Retries: ${MAX_RETRIES}`)
  console.log('='.repeat(60) + '\n')

  // 立即执行一次
  pollOnce()

  // 然后每5秒执行一次
  const interval = setInterval(() => {
    pollOnce()
  }, POLL_INTERVAL)

  // 优雅退出处理
  const shutdown = () => {
    console.log('[PC28-Poll] Shutting down...')
    clearInterval(interval)
    if (isRunning) {
      setTimeout(() => process.exit(0), 5000)
    } else {
      process.exit(0)
    }
  }

  process.on('SIGTERM', shutdown)
  process.on('SIGINT', shutdown)
}

// 启动服务
startPolling()
