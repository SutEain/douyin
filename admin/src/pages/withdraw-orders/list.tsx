import { List, useTable, DateField } from '@refinedev/antd'
import {
  Table,
  Space,
  Button,
  Tag,
  message,
  Modal,
  Form,
  Input,
  Select,
  Typography,
  Tooltip
} from 'antd'
import {
  CheckCircleOutlined,
  CloseCircleOutlined,
  SyncOutlined,
  ThunderboltOutlined
} from '@ant-design/icons'
import { supabaseClient } from '../../supabaseClient'
import { useState, useEffect } from 'react'

const { Text } = Typography

export const WithdrawOrderList = () => {
  const [adminId, setAdminId] = useState<string | null>(null)

  useEffect(() => {
    supabaseClient.auth.getUser().then(({ data }) => {
      setAdminId(data.user?.id || null)
    })
  }, [])

  const table = useTable({
    resource: 'withdraw_orders',
    syncWithLocation: true,
    sorters: {
      initial: [{ field: 'created_at', order: 'desc' }]
    },
    meta: {
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

  // 处理提现：完成或拒绝
  const handleProcessWithdraw = (record: any, action: 'approve' | 'reject') => {
    const isApprove = action === 'approve'
    Modal.confirm({
      title: isApprove ? '确认已完成汇款？' : '确认拒绝该提现申请？',
      icon: isApprove ? (
        <CheckCircleOutlined style={{ color: '#52c41a' }} />
      ) : (
        <CloseCircleOutlined style={{ color: '#ff4d4f' }} />
      ),
      content: (
        <Space direction="vertical">
          <Text>
            用户：{record.profiles?.nickname} (ID: {record.profiles?.numeric_id})
          </Text>
          <Text>
            金额：{record.amount} 抖币 (约 {(record.amount / 100).toFixed(2)} USDT)
          </Text>
          {isApprove && (
            <Text type="danger" strong>
              请确保您已向 TRC20 地址完成转账：
            </Text>
          )}
          {isApprove && <Text code>{record.address}</Text>}
          {!isApprove && <Text>拒绝后，金额将退回至用户的抖币余额。</Text>}
        </Space>
      ),
      onOk: async () => {
        try {
          const { data: sessionData } = await supabaseClient.auth.getSession()
          const accessToken = sessionData.session?.access_token

          if (!accessToken) {
            message.error('未登录或登录已过期')
            return
          }

          const response = await fetch(
            `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/app-server/withdraw/process`,
            {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${accessToken}`,
                apikey: import.meta.env.VITE_SUPABASE_ANON_KEY
              },
              body: JSON.stringify({
                order_id: record.id,
                admin_id: adminId,
                action: action,
                remark: isApprove ? '管理员已完成汇款' : '提现申请被拒绝，余额已退回'
              })
            }
          )

          const result = await response.json()

          if (!response.ok || result.code !== 0) {
            throw new Error(result.msg || '操作失败')
          }

          message.success(isApprove ? '已确认完成汇款' : '已拒绝提现申请')
          queryResult?.refetch()
        } catch (err: any) {
          message.error(err.message || '操作失败')
        }
      }
    })
  }

  // 自动出款：一键转账
  const handleAutoPayout = (record: any) => {
    Modal.confirm({
      title: '确认一键自动出款？',
      icon: <ThunderboltOutlined style={{ color: '#faad14' }} />,
      content: (
        <Space direction="vertical">
          <Text>
            用户：{record.profiles?.nickname} (ID: {record.profiles?.numeric_id})
          </Text>
          <Text>
            金额：{record.amount} 抖币 (约 {(record.amount / 100).toFixed(2)} USDT)
          </Text>
          <Text type="warning" strong>
            点击确认后，系统将自动通过 TRC20 网络进行转账。
          </Text>
          <Text type="danger">请确保后台配置的出款钱包余额充足，操作不可撤回！</Text>
          <Text code ellipsis>
            目标地址：{record.address}
          </Text>
        </Space>
      ),
      onOk: async () => {
        try {
          const { data: sessionData } = await supabaseClient.auth.getSession()
          const accessToken = sessionData.session?.access_token

          if (!accessToken) {
            message.error('未登录或登录已过期')
            return
          }

          message.loading({ content: '正在进行链上转账，请稍后...', key: 'payout' })

          const response = await fetch(
            `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/app-server/admin/withdraw/auto-payout`,
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
            throw new Error(result.msg || '出款失败')
          }

          message.success({ content: '自动出款成功！', key: 'payout', duration: 3 })
          queryResult?.refetch()
        } catch (err: any) {
          message.error({ content: err.message || '操作失败', key: 'payout', duration: 5 })
        }
      }
    })
  }

  return (
    <List title="提现申请管理">
      <Form {...searchFormProps} layout="inline" style={{ marginBottom: 16 }}>
        <Form.Item name="user_id" label="用户数字ID">
          <Input placeholder="输入用户ID搜索" allowClear />
        </Form.Item>
        <Form.Item name="status" label="状态">
          <Select allowClear placeholder="全部状态" style={{ width: 120 }}>
            <Select.Option value="pending">待审核</Select.Option>
            <Select.Option value="completed">已汇款</Select.Option>
            <Select.Option value="rejected">已拒绝</Select.Option>
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
          title="提现金额 (抖币)"
          render={(_, record: any) => (
            <Space direction="vertical" size={0}>
              <span style={{ fontWeight: 'bold', color: '#cf1322' }}>
                {Number(record.amount).toLocaleString()}
              </span>
              <span style={{ fontSize: '12px', color: '#8c8c8c' }}>
                ≈ {(record.amount / 100).toFixed(2)} USDT
              </span>
            </Space>
          )}
        />
        <Table.Column
          title="TRC20 地址"
          dataIndex="address"
          render={(v, record: any) => (
            <Space direction="vertical" size={0}>
              <Tooltip title={v}>
                <Text copyable style={{ width: 150 }} ellipsis>
                  {v}
                </Text>
              </Tooltip>
              {record.tx_hash && (
                <Tooltip title={record.tx_hash}>
                  <Text
                    copyable
                    style={{ fontSize: '11px', color: '#1890ff', width: 150 }}
                    ellipsis
                  >
                    Hash: {record.tx_hash}
                  </Text>
                </Tooltip>
              )}
            </Space>
          )}
        />
        <Table.Column
          dataIndex="status"
          title="状态"
          render={(value) => {
            const statusMap: any = {
              pending: { color: 'processing', text: '待审核', icon: <SyncOutlined spin /> },
              completed: { color: 'success', text: '已汇款', icon: <CheckCircleOutlined /> },
              rejected: { color: 'error', text: '已拒绝', icon: <CloseCircleOutlined /> },
              cancelled: { color: 'default', text: '已取消' }
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
          title="申请时间"
          render={(value) => <DateField value={value} format="MM-DD HH:mm" />}
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
                    icon={<ThunderboltOutlined />}
                    style={{ backgroundColor: '#faad14', borderColor: '#faad14' }}
                    onClick={() => handleAutoPayout(record)}
                  >
                    一键出款
                  </Button>
                  <Button
                    type="primary"
                    size="small"
                    style={{ backgroundColor: '#52c41a', borderColor: '#52c41a' }}
                    onClick={() => handleProcessWithdraw(record, 'approve')}
                  >
                    确认汇款
                  </Button>
                  <Button
                    danger
                    size="small"
                    onClick={() => handleProcessWithdraw(record, 'reject')}
                  >
                    拒绝
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
