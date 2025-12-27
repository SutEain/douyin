import { supabaseAdmin } from '../lib/env.ts'
import { successResponse, errorResponse } from '../../_shared/response.ts'
import { requireAuth, parseJsonBody, HttpError } from '../lib/auth.ts'
import { checkAndSendNotification } from '../lib/notification.ts'

function isAdminUser(user: any): boolean {
  return user?.app_metadata?.role === 'admin' || user?.email?.endsWith('@admin.user')
}

export async function handleAdminProcessWithdraw(req: Request): Promise<Response> {
  try {
    const { user } = await requireAuth(req)

    if (!isAdminUser(user)) {
      throw new HttpError('Forbidden', 403)
    }

    const body = await parseJsonBody<{
      order_id: string
      admin_id: string
      action: 'approve' | 'reject'
      remark?: string
    }>(req)

    const { order_id, admin_id, action, remark } = body
    if (!order_id || !admin_id || !action) {
      throw new HttpError('Missing parameters', 400)
    }

    // 1. 调用 RPC 处理提现逻辑
    const { data: res, error: rpcError } = await supabaseAdmin.rpc('admin_process_withdraw', {
      p_order_id: order_id,
      p_admin_id: admin_id,
      p_action: action,
      p_remark: remark
    })

    if (rpcError) {
      console.error('[Withdraw] RPC Error:', rpcError)
      return errorResponse('提现处理失败: ' + rpcError.message, 1, 500)
    }

    if (!res.success) {
      return errorResponse(res.message || '提现处理失败', 1, 400)
    }

    // 2. 成功后发送通知给用户
    const { data: order } = await supabaseAdmin
      .from('withdraw_orders')
      .select('user_id, amount, order_no, address')
      .eq('id', order_id)
      .single()

    if (order) {
      let notificationMsg = ''
      if (action === 'approve') {
        notificationMsg =
          `✅ <b>提现已处理成功！</b>\n\n` +
          `💰 <b>提现金额：</b> ${order.amount} 抖币\n` +
          `📍 <b>收款地址：</b> <code>${order.address}</code>\n` +
          `📑 <b>订单编号：</b> <code>${order.order_no || '-'}</code>\n\n` +
          `管理员已完成汇款，请注意查收。`
      } else {
        notificationMsg =
          `❌ <b>提现申请被拒绝</b>\n\n` +
          `💰 <b>提现金额：</b> ${order.amount} 抖币\n` +
          `📑 <b>订单编号：</b> <code>${order.order_no || '-'}</code>\n` +
          `💬 <b>原因/备注：</b> ${remark || '未提供具体原因'}\n\n` +
          `对应的金额已退回您的抖币余额。如有疑问请联系客服。`
      }

      checkAndSendNotification(order.user_id, 'withdraw', notificationMsg)
    }

    return successResponse({
      success: true,
      final_balance: res.final_balance,
      final_frozen: res.final_frozen
    })
  } catch (e: any) {
    console.error('[Withdraw] unexpected error:', e)
    if (e instanceof HttpError) {
      return errorResponse(e.message, 1, e.status)
    }
    return errorResponse(e.message || 'Internal server error', 1, 500)
  }
}
