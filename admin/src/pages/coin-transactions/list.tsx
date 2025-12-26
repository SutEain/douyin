import { List, useTable } from '@refinedev/antd'
import { Form, Input, Select, Table, Tag } from 'antd'

const typeColors: Record<string, string> = {
  recharge: 'green',
  reward: 'blue',
  gift_out: 'orange',
  gift_in: 'purple',
  withdraw: 'volcano'
}

const typeLabels: Record<string, string> = {
  recharge: '充值',
  reward: '奖励',
  gift_out: '打赏支出',
  gift_in: '打赏收入',
  withdraw: '提现'
}

export const CoinTransactionList = () => {
  const { tableProps, searchFormProps } = useTable({
    resource: 'coin_transactions',
    syncWithLocation: true,
    meta: {
      select: '*, profiles:user_id(nickname,numeric_id)'
    },
    sorters: {
      initial: [{ field: 'created_at', order: 'desc' }]
    },
    onSearch: (params: Record<string, any>) => {
      const filters: any[] = []
      if (params.username) {
        filters.push({ field: 'profiles.nickname', operator: 'contains', value: params.username })
      }
      if (params.type) {
        filters.push({ field: 'type', operator: 'eq', value: params.type })
      }
      return filters
    }
  })

  return (
    <List title="抖币流水">
      <Form {...searchFormProps} layout="inline" style={{ marginBottom: 16 }}>
        <Form.Item name="username" label="用户">
          <Input placeholder="昵称" style={{ width: 160 }} allowClear />
        </Form.Item>
        <Form.Item name="type" label="类型">
          <Select placeholder="全部" allowClear style={{ width: 140 }}>
            {Object.entries(typeLabels).map(([val, label]) => (
              <Select.Option key={val} value={val}>
                {label}
              </Select.Option>
            ))}
          </Select>
        </Form.Item>
      </Form>

      <Table {...tableProps} rowKey="id">
        <Table.Column
          title="用户"
          width={200}
          render={(_, record: any) => (
            <div>
              <div>{record.profiles?.nickname || '-'}</div>
              <div style={{ fontSize: 12, color: '#999' }}>
                ID: {record.profiles?.numeric_id || '-'}
              </div>
            </div>
          )}
        />
        <Table.Column
          dataIndex="type"
          title="类型"
          width={120}
          render={(v) => <Tag color={typeColors[v] || 'default'}>{typeLabels[v] || v}</Tag>}
        />
        <Table.Column
          dataIndex="amount"
          title="变动金额"
          width={120}
          render={(v) => (
            <span
              style={{
                fontFamily: 'monospace',
                fontWeight: 'bold',
                color: v > 0 ? '#52c41a' : '#ff4d4f'
              }}
            >
              {v > 0 ? `+${v}` : v}
            </span>
          )}
        />
        <Table.Column
          dataIndex="balance_after"
          title="变动后余额"
          width={120}
          render={(v) => <span style={{ fontFamily: 'monospace' }}>{v}</span>}
        />
        <Table.Column dataIndex="description" title="备注" render={(v) => v || '-'} />
        <Table.Column dataIndex="created_at" title="时间" width={180} />
      </Table>
    </List>
  )
}
