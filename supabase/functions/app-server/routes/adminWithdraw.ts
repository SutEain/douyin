import { supabaseAdmin } from '../lib/env.ts'
import { successResponse, errorResponse } from '../../_shared/response.ts'
import { requireAdminAuth, parseJsonBody, HttpError } from '../lib/auth.ts'
import { checkAndSendNotification } from '../lib/notification.ts'
import { TronWeb } from 'npm:tronweb'

// USDT TRC20 Contract Address
const USDT_CONTRACT = 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t'

/**
 * 🎯 后台自动出款逻辑 (USDT-TRC20)
 */
export async function handleAdminAutoWithdraw(req: Request): Promise<Response> {
  try {
    // 1. 强制管理员认证 (含 IP 校验)
    const { user: adminUser } = await requireAdminAuth(req)

    const body = await parseJsonBody<{
      order_id: string
    }>(req)

    const { order_id } = body
    if (!order_id) {
      throw new HttpError('Missing parameters', 400)
    }

    // 2. 获取订单详情
    const { data: order, error: orderError } = await supabaseAdmin
      .from('withdraw_orders')
      .select('*')
      .eq('id', order_id)
      .single()

    if (orderError || !order) {
      return errorResponse('订单不存在', 1, 404)
    }

    // 允许待处理，或者已完成但没有 hash 的订单重新打款
    const isRetry = order.status === 'completed' && !order.tx_hash
    if (order.status !== 'pending' && !isRetry) {
      return errorResponse('订单状态不支持自动出款（已完成且已有Hash，或已取消/拒绝）', 1, 400)
    }

    // 3. 获取提现配置 (安全升级：优先从环境变量读取 Secrets)
    const config = {
      address: Deno.env.get('WITHDRAW_TRC20_ADDRESS'),
      privateKey: Deno.env.get('WITHDRAW_TRC20_PRIVATE_KEY')
    }

    // 🎯 兼容性兜底：如果环境变量未设置，尝试从数据库读取 (不建议长期使用)
    if (!config.address || !config.privateKey) {
      console.warn('[AutoWithdraw] 环境变量未配置，尝试从数据库获取敏感信息...')
      const { data: settings } = await supabaseAdmin
        .from('system_settings')
        .select('id, value_text')
        .in('id', ['withdraw_trc20_address', 'withdraw_trc20_private_key'])

      if (!config.address) {
        config.address = settings?.find((s) => s.id === 'withdraw_trc20_address')?.value_text
      }
      if (!config.privateKey) {
        config.privateKey = settings?.find((s) => s.id === 'withdraw_trc20_private_key')?.value_text
      }
    }

    if (!config.address || !config.privateKey) {
      return errorResponse('自动提现未配置（Secrets 或数据库配置缺失）', 1, 400)
    }

    // 4. 初始化 TronWeb
    const tronWeb = new TronWeb({
      fullHost: 'https://api.trongrid.io',
      privateKey: config.privateKey
    })

    // 5. 执行转账 (USDT TRC20)
    // 🎯 使用实际到账金额（已扣除手续费）
    const amountCoins = parseFloat(order.amount)
    const feeAmount = parseFloat(order.fee_amount || 0)
    const usdtAmount = parseFloat(order.actual_amount || (amountCoins - feeAmount) / 100)

    if (isNaN(usdtAmount) || usdtAmount <= 0) {
      return errorResponse('无效金额', 1, 400)
    }

    console.log(
      `[AutoWithdraw] Starting payout: order=${order.order_no}, amount=${amountCoins}抖币, fee=${feeAmount}抖币, actual=${usdtAmount}USDT, to=${order.address}`
    )

    try {
      // 获取合约实例
      const contract = await tronWeb.contract().at(USDT_CONTRACT)

      // USDT 有 6 位小数
      const sunAmount = Math.floor(usdtAmount * 1000000)

      // 执行转账
      const tx = await contract.transfer(order.address, sunAmount).send()

      if (!tx) {
        throw new Error('Transaction failed to broadcast')
      }

      console.log(`[AutoWithdraw] Success! TxHash: ${tx}`)

      // 6. 更新订单状态
      if (order.status === 'pending') {
        // 如果是待处理订单，调用 RPC 扣减冻结金额并标记完成
        const { error: rpcError } = await supabaseAdmin.rpc('admin_process_withdraw', {
          p_order_id: order_id,
          p_admin_id: adminUser.id, // ✅ 使用 adminUser.id
          p_action: 'approve',
          p_remark: `自动出款成功, Hash: ${tx}`,
          p_tx_hash: tx // ✅ 传入交易哈希供 RPC 更新
        })

        if (rpcError) {
          console.error('[AutoWithdraw] RPC Error after success payout:', rpcError)
          await supabaseAdmin
            .from('withdraw_orders')
            .update({
              tx_hash: tx,
              remark: '自动出款成功但订单状态更新失败，请手动处理。Hash: ' + tx
            })
            .eq('id', order_id)
          return errorResponse('出款成功，但数据库状态更新失败，请检查订单列表', 1, 500)
        }
      } else {
        // 如果已经是 completed (重新打款)，只需更新 hash 和备注
        await supabaseAdmin
          .from('withdraw_orders')
          .update({
            tx_hash: tx,
            remark: `[重新打款] 自动出款成功, Hash: ${tx}`,
            processed_at: new Date().toISOString(),
            processed_by: adminUser.id // ✅ 修正变量名: 使用 adminUser.id
          })
          .eq('id', order_id)
      }

      // 6. 确保记录 TxHash (RPC 内部可能没更新这个字段)
      await supabaseAdmin.from('withdraw_orders').update({ tx_hash: tx }).eq('id', order_id)

      // 7. 发送通知给用户
      const notificationMsg =
        `✅ <b>自动提现已成功出款！</b>\n\n` +
        `💰 <b>提现金额：</b> ${amountCoins} 抖币\n` +
        (feeAmount > 0 ? `📌 <b>手续费：</b> -${feeAmount} 抖币\n` : '') +
        `💵 <b>实际到账：</b> ${usdtAmount.toFixed(2)} USDT\n` +
        `📍 <b>收款地址：</b> <code>${order.address}</code>\n` +
        `🔗 <b>交易哈希：</b> <code>${tx}</code>\n\n` +
        `您的资金已通过 TRC20 网络汇出，请注意查收。`

      checkAndSendNotification(order.user_id, 'withdraw', notificationMsg)

      return successResponse({ success: true, tx_hash: tx })
    } catch (txError: any) {
      console.error('[AutoWithdraw] Transaction error:', txError)
      return errorResponse(`出款失败: ${txError.message || txError || '区块链网络错误'}`, 1, 500)
    }
  } catch (e: any) {
    console.error('[AutoWithdraw] unexpected error:', e)
    if (e instanceof HttpError) {
      return errorResponse(e.message, 1, e.status)
    }
    return errorResponse(e.message || 'Internal server error', 1, 500)
  }
}
