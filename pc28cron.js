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
import axios from 'axios'

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
const API_URL = 'https://28.run/api/lottery/recent/6' // 主API（28.run接口，获取6期用于匹配）
const BACKUP_API_URL = 'http://pc28.help/kj.json?limit=5' // 备用API1（免费接口）
const BACKUP_API_URL_2 = `https://www.apigx.cn/token/${API_TOKEN}/code/jnd28/rows/3.json` // 备用API2（付费接口）

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
 * 调用主API获取最新开奖数据（28.run接口）
 * 格式：{ recent_results: [{ expect, number1, number2, number3, final_result, opentime }] }
 * 需要转换为统一格式：{ expect, opencode, opentime }[]
 * 返回数组格式，包含多条数据
 */
async function fetchMainAPIData() {
  const startTime = Date.now()

  try {
    console.log(`[PC28-Poll] 🔄 Fetching main API: ${API_URL}`)

    const response = await axios.get(API_URL, {
      timeout: 30000, // 30秒超时
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        Accept: 'application/json'
      }
    })

    const totalDuration = Date.now() - startTime
    console.log(
      `[PC28-Poll] ✅ Main API response received in ${totalDuration}ms, status: ${response.status}`
    )

    const data = response.data

    if (
      !data.recent_results ||
      !Array.isArray(data.recent_results) ||
      data.recent_results.length === 0
    ) {
      console.warn(`[PC28-Poll] Main API returned empty data`)
      return []
    }

    // 🚨 修复：返回多条数据，用于匹配期数
    // 转换格式：number1,number2,number3 -> opencode
    const results = data.recent_results.map((item) => ({
      expect: item.expect,
      opencode: `${item.number1},${item.number2},${item.number3}`,
      opentime: item.opentime
    }))

    return results
  } catch (error) {
    const totalDuration = Date.now() - startTime

    if (error.code === 'ECONNABORTED' || error.message.includes('timeout')) {
      console.error(`[PC28-Poll] ❌ Main API timeout after ${totalDuration}ms`)
    } else if (error.response) {
      console.error(
        `[PC28-Poll] ❌ Main API error: ${error.response.status} - ${error.response.statusText}`
      )
    } else if (error.request) {
      console.error(`[PC28-Poll] ❌ Main API no response: ${error.message}`)
    } else {
      console.error(`[PC28-Poll] ❌ Main API request error: ${error.message}`)
    }

    return []
  }
}

/**
 * 调用备用API1获取最新开奖数据（pc28.help免费接口）
 * 格式：{ data: [{ qihao, opentime, opennum, sum }] }
 * 需要转换为统一格式：{ expect, opencode, opentime }[]
 * 返回数组格式
 */
async function fetchBackupAPIData() {
  const startTime = Date.now()

  try {
    console.log(`[PC28-Poll] 🔄 Trying backup API1: ${BACKUP_API_URL}`)

    const response = await axios.get(BACKUP_API_URL, {
      timeout: 30000, // 30秒超时
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        Accept: 'application/json'
      },
      validateStatus: (status) => status < 500
    })

    const totalDuration = Date.now() - startTime
    console.log(
      `[PC28-Poll] ✅ Backup API1 response received in ${totalDuration}ms, status: ${response.status}`
    )

    const data = response.data

    if (!data.data || !Array.isArray(data.data) || data.data.length === 0) {
      console.warn(`[PC28-Poll] Backup API1 returned empty data`)
      return []
    }

    // 🚨 修复：返回多条数据，用于匹配期数
    const currentYear = new Date().getFullYear()
    const results = data.data.map((item) => {
      // 解析 opennum: "2+9+7" -> "2,9,7"
      const opencode = item.opennum.replace(/\+/g, ',')
      // 解析 opentime: "01-25 06:03:30" -> "2026-01-25 06:03:30" (假设当前年份)
      const opentime = `${currentYear}-${item.opentime}`
      return {
        expect: item.qihao,
        opencode: opencode,
        opentime: opentime
      }
    })

    return results
  } catch (error) {
    const totalDuration = Date.now() - startTime

    if (error.code === 'ECONNABORTED' || error.message.includes('timeout')) {
      console.error(`[PC28-Poll] ❌ Backup API1 timeout after ${totalDuration}ms`)
    } else if (error.response) {
      console.error(
        `[PC28-Poll] ❌ Backup API1 error: ${error.response.status} - ${error.response.statusText}`
      )
    } else if (error.request) {
      console.error(`[PC28-Poll] ❌ Backup API1 no response: ${error.message}`)
    } else {
      console.error(`[PC28-Poll] ❌ Backup API1 request error: ${error.message}`)
    }

    return []
  }
}

/**
 * 调用备用API2获取最新开奖数据（付费接口）
 * 格式：{ data: [{ expect, opencode, opentime }] }
 * 需要转换为统一格式：{ expect, opencode, opentime }[]
 * 返回数组格式
 */
async function fetchBackupAPIData2() {
  const startTime = Date.now()

  try {
    console.log(`[PC28-Poll] 🔄 Trying backup API2: ${BACKUP_API_URL_2}`)

    const response = await axios.get(BACKUP_API_URL_2, {
      timeout: 30000, // 30秒超时
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        Accept: 'application/json'
      },
      validateStatus: (status) => status < 500
    })

    const totalDuration = Date.now() - startTime
    console.log(
      `[PC28-Poll] ✅ Backup API2 response received in ${totalDuration}ms, status: ${response.status}`
    )

    const data = response.data

    if (!data.data || !Array.isArray(data.data) || data.data.length === 0) {
      console.warn(`[PC28-Poll] Backup API2 returned empty data`)
      return []
    }

    // 返回数组格式
    return data.data
  } catch (error) {
    const totalDuration = Date.now() - startTime

    if (error.code === 'ECONNABORTED' || error.message.includes('timeout')) {
      console.error(`[PC28-Poll] ❌ Backup API2 timeout after ${totalDuration}ms`)
    } else if (error.response) {
      console.error(
        `[PC28-Poll] ❌ Backup API2 error: ${error.response.status} - ${error.response.statusText}`
      )
    } else if (error.request) {
      console.error(`[PC28-Poll] ❌ Backup API2 no response: ${error.message}`)
    } else {
      console.error(`[PC28-Poll] ❌ Backup API2 request error: ${error.message}`)
    }

    return []
  }
}

/**
 * 调用 API 获取最新开奖数据（多条，用于匹配期数）
 * 主API：28.run接口 https://28.run/api/lottery/recent/6
 * 格式：{ recent_results: [{ expect, number1, number2, number3, opentime }] }
 * 需要转换为统一格式：{ expect, opencode, opentime }[]
 * 主API失败时自动尝试备用API
 * @param retryCount 重试次数
 */
async function fetchAPIData(retryCount = 0) {
  const startTime = Date.now()

  try {
    console.log(`[PC28-Poll] Fetching main API (attempt ${retryCount + 1}/${MAX_RETRIES + 1})...`)

    // 🚨 修复：优先使用28.run API作为主API
    const mainResult = await fetchMainAPIData()
    if (mainResult && mainResult.length > 0) {
      return mainResult
    }

    // 主API失败，尝试备用API1（pc28.help）
    console.warn(`[PC28-Poll] Main API returned empty data, trying backup APIs...`)
    const backup1Result = await fetchBackupAPIData()
    if (backup1Result && backup1Result.length > 0) {
      return backup1Result
    }

    // 备用API1失败，尝试备用API2（付费接口）
    const backup2Result = await fetchBackupAPIData2()
    if (backup2Result && backup2Result.length > 0) {
      return backup2Result
    }

    return []
  } catch (error) {
    const totalDuration = Date.now() - startTime

    if (error.code === 'ECONNABORTED' || error.message.includes('timeout')) {
      console.error(`[PC28-Poll] ❌ Main API timeout after ${totalDuration}ms`)
      console.error(`[PC28-Poll] 🔄 Trying backup APIs...`)
      // 先尝试备用API1（pc28.help）
      const backup1Result = await fetchBackupAPIData()
      if (backup1Result && backup1Result.length > 0) {
        return backup1Result
      }
      // 再尝试备用API2（付费接口）
      const backup2Result = await fetchBackupAPIData2()
      if (backup2Result && backup2Result.length > 0) {
        return backup2Result
      }
      return []
    } else if (error.response) {
      console.error(
        `[PC28-Poll] ❌ Main API error: ${error.response.status} - ${error.response.statusText}`
      )
      console.error(`[PC28-Poll] 🔄 Trying backup APIs...`)
      // 先尝试备用API1（pc28.help）
      const backup1Result = await fetchBackupAPIData()
      if (backup1Result && backup1Result.length > 0) {
        return backup1Result
      }
      // 再尝试备用API2（付费接口）
      const backup2Result = await fetchBackupAPIData2()
      if (backup2Result && backup2Result.length > 0) {
        return backup2Result
      }
      return []
    } else if (error.request) {
      console.error(`[PC28-Poll] ❌ Main API no response: ${error.message}`)
      console.error(`[PC28-Poll] 🔄 Trying backup APIs...`)
      // 先尝试备用API1（pc28.help）
      const backup1Result = await fetchBackupAPIData()
      if (backup1Result && backup1Result.length > 0) {
        return backup1Result
      }
      // 再尝试备用API2（付费接口）
      const backup2Result = await fetchBackupAPIData2()
      if (backup2Result && backup2Result.length > 0) {
        return backup2Result
      }
      return []
    } else {
      console.error(`[PC28-Poll] ❌ Main API request error: ${error.message}`)
      console.error(`[PC28-Poll] 🔄 Trying backup APIs...`)
      // 先尝试备用API1（pc28.help）
      const backup1Result = await fetchBackupAPIData()
      if (backup1Result && backup1Result.length > 0) {
        return backup1Result
      }
      // 再尝试备用API2（付费接口）
      const backup2Result = await fetchBackupAPIData2()
      if (backup2Result && backup2Result.length > 0) {
        return backup2Result
      }

      // 如果重试次数未用完，继续重试主API
      if (
        retryCount < MAX_RETRIES &&
        (error.code === 'ECONNABORTED' || error.code === 'ECONNRESET' || error.code === 'ETIMEDOUT')
      ) {
        console.warn(`[PC28-Poll] Retry main API ${retryCount + 1}/${MAX_RETRIES} after error`)
        await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY * (retryCount + 1)))
        return fetchAPIData(retryCount + 1)
      }

      // 所有API都失败，返回空数组（不抛出错误，避免中断定时任务）
      console.error(`[PC28-Poll] ❌ All APIs failed, returning empty array`)
      return []
    }
  }
}

/**
 * 处理 PC28 数据并更新数据库
 * 🚨 修复：确保期数和开奖结果一一对应，不能用一个期的结果结算另一个期
 */
async function processPC28Data() {
  // 🚨 修复：获取多条API数据，用于匹配期数
  const apiResults = await fetchAPIData()
  if (!apiResults || apiResults.length === 0) {
    return { success: true, message: 'No data from API' }
  }

  // 输出API返回的完整数据，用于调试
  console.log('📥 API Response:', JSON.stringify(apiResults, null, 2))

  // 🚨 修复：只处理最新的期数，避免一直处理历史期数
  // 🚨 修复：API返回的数组，最新一期在最后（降序排列），不是第一个
  // 获取最新期数（API返回的最后一条是最新的）
  const latestItem = apiResults[apiResults.length - 1]
  const latestPeriod = latestItem.expect
  const latestOpencode = latestItem.opencode
  const currentBettingPeriod = String(parseInt(latestPeriod) + 1)

  console.log(`🎯 Processing latest period: ${latestPeriod} with result: ${latestOpencode}`)

  // 解析最新期数的开奖号码
  const nums = latestOpencode.split(',').map((n) => parseInt(n.trim()))
  if (nums.length !== 3) {
    console.error(`❌ Invalid opencode format for period ${latestPeriod}: ${latestOpencode}`)
    return { success: false, message: 'Invalid opencode format' }
  }

  // 检查数据库中是否有这个期数
  const { data: existingRound, error: checkError } = await supabase
    .from('pc28_global_rounds')
    .select('*')
    .eq('period_number', latestPeriod)
    .maybeSingle()

  if (checkError && checkError.code !== 'PGRST116') {
    console.error(`❌ Error checking period ${latestPeriod}:`, checkError)
    return { success: false, message: 'Database error' }
  }

  // 🚨 关键修复：只处理最新期数
  if (existingRound) {
    // 如果已经结算，检查结果是否一致
    if (existingRound.status === 'settled') {
      const existingResult = existingRound.result
      if (
        existingResult &&
        existingResult.num1 === nums[0] &&
        existingResult.num2 === nums[1] &&
        existingResult.num3 === nums[2]
      ) {
        console.log(`✅ Period ${latestPeriod} already settled correctly: ${latestOpencode}`)
      } else {
        console.warn(
          `⚠️ Period ${latestPeriod} already settled but result mismatch! DB: ${JSON.stringify(existingResult)}, API: ${latestOpencode}`
        )
        // 不覆盖已结算的结果，只记录警告
      }
    } else if (existingRound.status === 'betting' || existingRound.status === 'sealed') {
      // 需要结算的期数（betting 或 sealed 状态）
      // 🎯 修复：如果状态是 betting，先封盘（但不推送消息，因为马上就要结算）
      if (existingRound.status === 'betting') {
        const { data: sealedRounds } = await supabase
          .from('pc28_global_rounds')
          .update({ status: 'sealed', updated_at: new Date().toISOString() })
          .eq('id', existingRound.id)
          .eq('status', 'betting')
          .select('id')

        if (sealedRounds && sealedRounds.length > 0) {
          console.log(`🔒 Sealed before settle: ${latestPeriod}`)
        }
      }

      // 🚨 关键修复：使用最新期数对应的开奖结果结算
      const { error: settleError } = await supabase.rpc('settle_global_round', {
        p_global_round_id: existingRound.id,
        p_num1: nums[0],
        p_num2: nums[1],
        p_num3: nums[2]
      })

      if (settleError) {
        console.error(`❌ Failed to settle period ${latestPeriod}:`, settleError)
        return { success: false, message: 'Settlement failed' }
      } else {
        console.log(`✅ Settled period ${latestPeriod} with result ${latestOpencode}`)
      }
    }
  } else {
    // 期数不存在，创建 settled 记录（说明这是新开奖的期数）
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
      // 如果是唯一约束冲突，说明期数已存在，跳过
      if (insertError.code === '23505') {
        console.log(`⏭️ Period ${latestPeriod} already exists, skipping`)
      } else {
        console.error(`❌ Failed to create settled: ${latestPeriod}`, insertError)
        return { success: false, message: 'Insert failed' }
      }
    } else {
      console.log(`✅ Created settled record for period ${latestPeriod}: ${latestOpencode}`)
    }
  }

  // 3. 确保当前应该开盘的期数（latestPeriod + 1）存在且为 betting 状态
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

  // 4. 检查封盘时间（自动封盘）
  // 只处理当前期数或更新的期数，避免更新旧期数导致状态回退
  // 🚨 修复：按期数数字降序排序，确保先处理最新的期数
  const { data: bettingRounds } = await supabase
    .from('pc28_global_rounds')
    .select('*')
    .eq('status', 'betting')
    .lte('seal_at', new Date().toISOString())
    .gte('period_number', currentBettingPeriod || '0') // 只处理当前期数或更新的期数
    .order('period_number', { ascending: false }) // 🚨 按期数数字降序排序，先处理最新的

  if (bettingRounds && bettingRounds.length > 0) {
    for (const round of bettingRounds) {
      // 🎯 修复：使用原子更新操作，并检查是否真的更新了
      // 使用 UPDATE ... RETURNING 来确保只更新一次，并获取更新后的状态
      const { data: updatedRounds, error: sealError } = await supabase
        .from('pc28_global_rounds')
        .update({ status: 'sealed', updated_at: new Date().toISOString() })
        .eq('id', round.id)
        .eq('status', 'betting') // 确保只更新 betting 状态的记录
        .select('id, period_number, status') // 返回更新后的记录

      if (sealError) {
        console.error(`❌ Failed to seal: ${round.period_number}`, sealError)
        continue
      }

      // 🎯 修复：只有当 UPDATE 真的更新了记录（返回了数据）时才推送消息
      // 如果记录已经是 sealed 状态，UPDATE 不会返回任何数据，从而避免重复推送
      if (updatedRounds && updatedRounds.length > 0) {
        const updatedRound = updatedRounds[0]
        console.log(`✅ Sealed: ${updatedRound.period_number}`)

        // 🎯 根本修复：检查是否已经推送过封盘消息，避免重复推送
        // 查询 content 字段中包含该期数和"已封盘"文本的消息
        const sealedMessageText = `${updatedRound.period_number}期 已封盘`
        const { data: existingMessages } = await supabase
          .from('live_broadcast_messages')
          .select('id')
          .eq('msg_type', 'pc28')
          .like('content', `%${sealedMessageText}%`)
          .limit(1)

        // 如果已经存在封盘消息，跳过推送
        if (existingMessages && existingMessages.length > 0) {
          console.log(
            `⏭️ Period ${updatedRound.period_number} sealed message already sent, skipping`
          )
          continue
        }

        // 只在状态真正改变且消息未推送时才推送封盘消息
        const { data: enabledRooms } = await supabase
          .from('pc28_room_enabled')
          .select('room_id')
          .eq('enabled', true)

        if (enabledRooms && enabledRooms.length > 0) {
          const messages = enabledRooms.map((room) => ({
            room_id: room.room_id,
            msg_type: 'pc28',
            content: JSON.stringify({
              type: 'round_sealed',
              period_number: updatedRound.period_number,
              text: `PC28 ${updatedRound.period_number}期 已封盘，停止下注！`
            })
          }))

          const { error: insertError } = await supabase
            .from('live_broadcast_messages')
            .insert(messages)
          if (insertError) {
            console.error(
              `❌ Failed to insert sealed messages for ${updatedRound.period_number}:`,
              insertError
            )
          } else {
            console.log(`📢 Sealed message sent for period ${updatedRound.period_number}`)
          }
        }
      } else {
        // 记录已经是 sealed 状态，跳过（避免重复推送）
        console.log(`⏭️ Period ${round.period_number} already sealed, skipping`)
      }
    }
  }

  // 5. 检查超时封盘期数（自动取消）
  const timeoutThreshold = new Date(Date.now() - 5 * 60 * 1000) // 5分钟前
  // 🚨 修复：按期数数字降序排序，确保先处理最新的期数
  const { data: timeoutRounds } = await supabase
    .from('pc28_global_rounds')
    .select('*')
    .eq('status', 'sealed')
    .lt('seal_at', timeoutThreshold.toISOString())
    .order('period_number', { ascending: false }) // 🚨 按期数数字降序排序，先处理最新的

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
      // 🚨 修复：获取最新已结算的期号，按期数数字排序（不是按时间排序）
      // 因为历史期数补结算时，settled_at可能是最新的，但期数却是旧的
      // Supabase的order对字符串排序可能不准确，所以获取多条后在内存中排序
      const { data: allSettled } = await supabase
        .from('pc28_global_rounds')
        .select('period_number, settled_at')
        .eq('status', 'settled')
        .order('settled_at', { ascending: false }) // 先用时间排序获取最近的数据
        .limit(100) // 获取最近100期，然后在内存中按期数排序

      // 🚨 关键修复：按期数数字降序排序，获取真正最新的期数
      let lastSettled = null
      if (allSettled && allSettled.length > 0) {
        // 按期数数字降序排序
        const sorted = allSettled.sort((a, b) => {
          const numA = parseInt(a.period_number || '0', 10)
          const numB = parseInt(b.period_number || '0', 10)
          return numB - numA // 降序，期数大的在前
        })
        lastSettled = sorted[0] // 取期数最大的
      }

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
    message: 'PC28 data processed',
    latestPeriod: latestPeriod || 'N/A',
    currentBettingPeriod: currentBettingPeriod || 'N/A'
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
      console.error(`💡 Tip: Check API availability and network connection`)
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
