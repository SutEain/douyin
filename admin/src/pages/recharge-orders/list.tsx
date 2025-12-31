import { List, useTable } from '@refinedev/antd'
import { Table, Space, Button, Tag, message, Modal, Form, Input, Select } from 'antd'
import {
  CheckCircleOutlined,
  CloseCircleOutlined,
  ExclamationCircleOutlined,
  SyncOutlined
} from '@ant-design/icons'
import { supabaseClient } from '../../supabaseClient'
import { useState, useEffect } from 'react'
import dayjs from 'dayjs'
import utc from 'dayjs/plugin/utc'

dayjs.extend(utc)

export const RechargeOrderList = () => {
  const [adminId, setAdminId] = useState<string | null>(null)

  useEffect(() => {
    supabaseClient.auth.getUser().then(({ data }) => {
      setAdminId(data.user?.id || null)
    })
  }, [])

  const table = useTable({
    resource: 'recharge_orders',
    syncWithLocation: true,
    sorters: {
      initial: [{ field: 'created_at', order: 'desc' }]
    },
    meta: {
      // 关联查询用户信息
      select: '*, profiles:user_id(nickname, numeric_id, tg_user_id)'
    },
    onSearch: (params: Record<string, any>) => {
      const filters: any[] = []
      const status = params.status
      const userId = params.user_id

      if (status) {
        filters.push({ field: 'status', operator: 'eq', value: status })
      }
      if (userId) {
        filters.push({ field: 'profiles.numeric_id', operator: 'eq', value: Number(userId) })
      }

      return filters
    }
  })

  const { tableProps, searchFormProps } = table
  const queryResult = (table as any).queryResult

  // 确认支付
  const handleConfirmPayment = (record: any) => {
    Modal.confirm({
      title: '确认支付已完成？',
      icon: <ExclamationCircleOutlined />,
      content: `确定已收到来自「${record.profiles?.nickname || '用户'}」的 ${record.total_amount} USDT 吗？确认后将自动发放 ${record.base_amount * 100} 抖币。`,
      onOk: async () => {
        try {
          // 获取当前 session 的 access_token
          const { data: sessionData } = await supabaseClient.auth.getSession()
          const accessToken = sessionData.session?.access_token

          if (!accessToken) {
            message.error('未登录或登录已过期')
            return
          }

          // 调用 Edge Function 而不是直接调用 RPC
          const response = await fetch(
            `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/app-server/recharge/confirm`,
            {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${accessToken}`,
                apikey: import.meta.env.VITE_SUPABASE_ANON_KEY
              },
              body: JSON.stringify({
                order_id: record.id,
                admin_id: adminId
              })
            }
          )

          const result = await response.json()

          if (!response.ok || result.code !== 0) {
            throw new Error(result.msg || '操作失败')
          }

          message.success('充值已确认，通知已发送')
          queryResult?.refetch()
        } catch (err: any) {
          message.error(err.message || '操作失败')
        }
      }
    })
  }

  // 取消订单
  const handleCancelOrder = (record: any) => {
    Modal.confirm({
      title: '确认取消订单？',
      icon: <CloseCircleOutlined />,
      content: '取消后金额占用将立即释放。',
      okType: 'danger',
      onOk: async () => {
        const { error } = await supabaseClient
          .from('recharge_orders')
          .update({ status: 'cancelled' })
          .eq('id', record.id)

        if (error) {
          message.error('操作失败')
        } else {
          message.success('订单已取消')
          queryResult?.refetch()
        }
      }
    })
  }

  return (
    <List title="充值订单管理">
      <Form {...searchFormProps} layout="inline" style={{ marginBottom: 16 }}>
        <Form.Item name="user_id" label="用户数字ID">
          <Input placeholder="输入用户ID搜索" allowClear />
        </Form.Item>
        <Form.Item name="status" label="状态">
          <Select allowClear placeholder="全部状态" style={{ width: 120 }}>
            <Select.Option value="pending">待支付</Select.Option>
            <Select.Option value="paid">已支付</Select.Option>
            <Select.Option value="expired">已过期</Select.Option>
            <Select.Option value="cancelled">已取消</Select.Option>
          </Select>
        </Form.Item>
        <Form.Item>
          <Space>
            <Button type="primary" htmlType="submit">
              搜索
            </Button>
            <Button
              onClick={() => {
                searchFormProps.form?.resetFields()
                searchFormProps.onFinish?.({})
              }}
            >
              重置
            </Button>
          </Space>
        </Form.Item>
      </Form>

      <Table {...tableProps} rowKey="id">
        <Table.Column
          title="订单编号"
          dataIndex="order_no"
          render={(v) => <code style={{ color: '#1890ff' }}>{v || '-'}</code>}
        />
        <Table.Column
          title="用户信息"
          render={(_, record: any) => (
            <Space direction="vertical" size={0}>
              <span style={{ fontWeight: 'bold' }}>{record.profiles?.nickname || '-'}</span>
              <span style={{ fontSize: '12px', color: '#999' }}>
                ID: {record.profiles?.numeric_id} | TG: {record.profiles?.tg_user_id}
              </span>
            </Space>
          )}
        />
        <Table.Column
          dataIndex="total_amount"
          title="支付金额 (USDT)"
          render={(value) => (
            <span style={{ fontFamily: 'monospace', fontWeight: 'bold', color: '#f5222d' }}>
              {Number(value).toFixed(2)}
            </span>
          )}
        />
        <Table.Column
          dataIndex="base_amount"
          title="充值基础"
          render={(value) => <span>{value} USDT</span>}
        />
        <Table.Column
          dataIndex="status"
          title="状态"
          render={(value) => {
            const statusMap: any = {
              pending: { color: 'processing', text: '待支付', icon: <SyncOutlined spin /> },
              paid: { color: 'success', text: '已支付', icon: <CheckCircleOutlined /> },
              expired: { color: 'default', text: '已过期' },
              cancelled: { color: 'error', text: '已取消' }
            }
            const s = statusMap[value] || { color: 'default', text: value }
            return (
              <Tag color={s.color} icon={s.icon}>
                {s.text}
              </Tag>
            )
          }}
        />
        <Table.Column
          dataIndex="created_at"
          title="创建时间"
          render={(v) => (v ? dayjs(v).utcOffset(8).format('MM-DD HH:mm') : '-')}
        />
        <Table.Column
          dataIndex="expires_at"
          title="过期时间"
          render={(v, record: any) => {
            const isExpired = new Date(v) < new Date() && record.status === 'pending'
            return (
              <span style={{ color: isExpired ? '#f5222d' : 'inherit' }}>
                {v ? dayjs(v).utcOffset(8).format('HH:mm') : '-'}
                {isExpired && ' (已过支付期)'}
              </span>
            )
          }}
        />
        <Table.Column
          title="操作"
          fixed="right"
          render={(_, record: any) => (
            <Space size="small">
              {record.status === 'pending' && (
                <>
                  <Button
                    type="primary"
                    size="small"
                    style={{ backgroundColor: '#52c41a', borderColor: '#52c41a' }}
                    onClick={() => handleConfirmPayment(record)}
                  >
                    确认收款
                  </Button>
                  <Button danger size="small" onClick={() => handleCancelOrder(record)}>
                    取消
                  </Button>
                </>
              )}
            </Space>
          )}
        />
      </Table>
    </List>
  )
}
