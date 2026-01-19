import { supabaseAdmin } from '../lib/env.ts'
import { successResponse, errorResponse } from '../../_shared/response.ts'
import { requireAdminAuth, parseJsonBody, HttpError } from '../lib/auth.ts'
import { checkAndSendNotification } from '../lib/notification.ts'

export async function handleAdminProcessWithdraw(req: Request): Promise<Response> {
  try {
    // 1. 强制管理员认证 (含 IP 校验)
    const { user: adminUser } = await requireAdminAuth(req)

    const body = await parseJsonBody<{
      order_id: string
      action: 'approve' | 'reject'
      remark?: string
    }>(req)

    const { order_id, action, remark } = body
    if (!order_id || !action) {
      throw new HttpError('Missing parameters', 400)
    }

    // 2. 调用 RPC 处理提现逻辑
    const { data: res, error: rpcError } = await supabaseAdmin.rpc('admin_process_withdraw', {
      p_order_id: order_id,
      p_admin_id: adminUser.id, // ✅ 使用 adminUser.id
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
      .select('user_id, amount, fee_amount, actual_amount, order_no, address')
      .eq('id', order_id)
      .single()

    if (order) {
      const feeAmount = parseFloat(order.fee_amount || 0)
      const actualAmount = parseFloat(order.actual_amount || (order.amount - feeAmount) / 100)

      let notificationMsg = ''
      if (action === 'approve') {
        notificationMsg =
          `✅ <b>提现已处理成功！</b>\n\n` +
          `💰 <b>提现金额：</b> ${order.amount} 抖币\n` +
          (feeAmount > 0 ? `📌 <b>提现手续费1U</b>\n` : '') +
          `💵 <b>实际到账：</b> ${actualAmount.toFixed(2)} USDT\n` +
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
