import { supabaseAdmin } from '../lib/env.ts'
import { successResponse, errorResponse } from '../../_shared/response.ts'
import { requireAuth, parseJsonBody, HttpError } from '../lib/auth.ts'
import { checkAndSendNotification } from '../lib/notification.ts'

function isAdminUser(user: any): boolean {
  return user?.app_metadata?.role === 'admin' || user?.email?.endsWith('@admin.user')
}

/**
 * 获取充值信息 (小程序端调用)
 * GET /recharge/info
 */
export async function handleGetRechargeInfo(req: Request): Promise<Response> {
  try {
    const { user } = await requireAuth(req)

    // 1. 检查是否有待支付的订单
    const { data: pendingOrder } = await supabaseAdmin
      .from('recharge_orders')
      .select('*')
      .eq('user_id', user.id)
      .eq('status', 'pending')
      .gt('expires_at', new Date().toISOString())
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    // 2. 获取收款地址
    const { data: setting } = await supabaseAdmin
      .from('system_settings')
      .select('value_text')
      .eq('id', 'recharge_trc20_address')
      .single()

    const trcAddress = setting?.value_text

    return successResponse({
      pending_order: pendingOrder,
      trc_address: trcAddress,
      amounts: [10, 20, 50, 100, 200, 500, 1000, 2000]
    })
  } catch (e: any) {
    if (e instanceof HttpError) return errorResponse(e.message, 1, e.status)
    return errorResponse(e.message || 'Internal server error', 1, 500)
  }
}

/**
 * 创建充值订单 (小程序端调用)
 * POST /recharge/create
 */
export async function handleCreateRechargeOrder(req: Request): Promise<Response> {
  try {
    const { user } = await requireAuth(req)
    const body = await parseJsonBody<{ amount: number }>(req)
    const { amount } = body

    if (!amount || amount < 1) {
      throw new HttpError('Invalid amount', 400)
    }

    // 1. 获取收款地址
    const { data: setting } = await supabaseAdmin
      .from('system_settings')
      .select('value_text')
      .eq('id', 'recharge_trc20_address')
      .single()

    const trcAddress = setting?.value_text
    if (!trcAddress) {
      throw new HttpError('充值通道暂时关闭，请稍后再试', 500)
    }

    // 2. 计算浮动金额
    const { data: totalAmount, error: funcError } = await supabaseAdmin.rpc(
      'get_next_recharge_amount',
      {
        p_base_amount: amount
      }
    )

    if (funcError) throw funcError

    const floatAmount = Number(totalAmount) - amount

    // 3. 生成订单号 (与机器人逻辑保持一致)
    const dateStr = new Date().toISOString().slice(2, 10).replace(/-/g, '')
    const randomSuffix = Math.floor(Math.random() * 900000 + 100000)
    const orderNo = `${dateStr}${randomSuffix}`

    const now = new Date()
    const expiresAt = new Date(now.getTime() + 30 * 60 * 1000) // 30 分钟过期
    const lockedUntil = new Date(now.getTime() + 60 * 60 * 1000) // 1 小时占用

    const { data: order, error: insertError } = await supabaseAdmin
      .from('recharge_orders')
      .insert({
        user_id: user.id,
        order_no: orderNo,
        base_amount: amount,
        float_amount: floatAmount,
        total_amount: totalAmount,
        trc20_address: trcAddress,
        status: 'pending',
        expires_at: expiresAt.toISOString(),
        locked_until: lockedUntil.toISOString()
      })
      .select()
      .single()

    if (insertError) throw insertError

    return successResponse({ order })
  } catch (e: any) {
    if (e instanceof HttpError) return errorResponse(e.message, 1, e.status)
    return errorResponse(e.message || 'Internal server error', 1, 500)
  }
}

/**
 * 取消充值订单 (小程序端调用)
 * POST /recharge/cancel
 */
export async function handleCancelRechargeOrder(req: Request): Promise<Response> {
  try {
    const { user } = await requireAuth(req)
    const body = await parseJsonBody<{ order_id: string }>(req)
    const { order_id } = body

    if (!order_id) throw new HttpError('Missing order_id', 400)

    const { error } = await supabaseAdmin
      .from('recharge_orders')
      .update({ status: 'cancelled' })
      .eq('id', order_id)
      .eq('user_id', user.id) // 确保只能取消自己的
      .eq('status', 'pending')

    if (error) throw error

    return successResponse({ success: true })
  } catch (e: any) {
    if (e instanceof HttpError) return errorResponse(e.message, 1, e.status)
    return errorResponse(e.message || 'Internal server error', 1, 500)
  }
}

export async function handleAdminConfirmRecharge(req: Request): Promise<Response> {
  try {
    const { user } = await requireAuth(req)

    // 权限检查：只有管理员可以确认充值
    if (!isAdminUser(user)) {
      throw new HttpError('Forbidden', 403)
    }

    const body = await parseJsonBody<{
      order_id: string
      admin_id: string
    }>(req)

    const { order_id, admin_id } = body
    if (!order_id || !admin_id) {
      throw new HttpError('Missing order_id or admin_id', 400)
    }

    // 1. 调用 RPC 处理充值逻辑
    const { data: res, error: rpcError } = await supabaseAdmin.rpc('admin_confirm_recharge', {
      p_order_id: order_id,
      p_admin_id: admin_id
    })

    if (rpcError) {
      console.error('[Recharge] RPC Error:', rpcError)
      return errorResponse('充值确认失败: ' + rpcError.message, 1, 500)
    }

    if (!res.success) {
      return errorResponse(res.message || '充值确认失败', 1, 400)
    }

    // 2. 成功后发送通知给用户
    // 获取订单关联的用户 ID 和充值金额
    const { data: order } = await supabaseAdmin
      .from('recharge_orders')
      .select('user_id, base_amount, order_no')
      .eq('id', order_id)
      .single()

    if (order) {
      const addedCoins = order.base_amount * 100
      const notificationMsg =
        `✅ <b>充值到账成功！</b>\n\n` +
        `💰 <b>到账金额：</b> ${addedCoins} 抖币\n` +
        `📑 <b>订单编号：</b> <code>${order.order_no || '-'}</code>\n\n` +
        `您的余额已更新，请在“个人中心-我的钱包”查看详情。感谢您的支持！`

      // 异步发送通知
      checkAndSendNotification(order.user_id, 'recharge', notificationMsg)
    }

    return successResponse({
      success: true,
      added_coins: res.added_coins,
      new_balance: res.new_balance
    })
  } catch (e: any) {
    console.error('[Recharge] unexpected error:', e)
    if (e instanceof HttpError) {
      return errorResponse(e.message, 1, e.status)
    }
    return errorResponse(e.message || 'Internal server error', 1, 500)
  }
}
