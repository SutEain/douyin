import { supabaseAdmin } from '../lib/env.ts'
import { successResponse, errorResponse } from '../../_shared/response.ts'
import { requireAuth, parseJsonBody, HttpError } from '../lib/auth.ts'
import { checkAndSendNotification } from '../lib/notification.ts'

function isAdminUser(user: any): boolean {
  return user?.app_metadata?.role === 'admin' || user?.email?.endsWith('@admin.user')
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
