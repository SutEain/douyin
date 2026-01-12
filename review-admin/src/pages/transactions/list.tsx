import { List, useTable } from '@refinedev/antd'
import { Table, Tag, Select, Space, Form, Button, Input } from 'antd'
import dayjs from 'dayjs'

export const TransactionList = () => {
  const { tableProps, searchFormProps } = useTable({
    resource: 'coin_transactions',
    syncWithLocation: true,
    pagination: { pageSize: 10 },
    sorters: { initial: [{ field: 'created_at', order: 'desc' }] },
    meta: {
      select: '*, profiles:user_id(nickname, numeric_id)'
    },
    onSearch: (params: any) => {
      const filters: any[] = []
      if (params.type) {
        filters.push({ field: 'type', operator: 'eq', value: params.type })
      }
      if (params.user_id) {
        filters.push({ field: 'profiles.numeric_id', operator: 'eq', value: Number(params.user_id) })
      }
      return filters
    }
  })

  const typeLabels: Record<string, { label: string, color: string }> = {
    recharge: { label: '充值', color: 'green' },
    reward: { label: '签到', color: 'blue' },
    gift_out: { label: '打赏', color: 'orange' },
    gift_in: { label: '收入', color: 'purple' },
    withdraw: { label: '提现', color: 'volcano' }
  }

  return (
    <List title="资金流水 (只读)">
      <Form {...searchFormProps} layout="inline" style={{ marginBottom: 16 }}>
        <Form.Item name="user_id" label="用户 ID">
          <Input placeholder="数字 ID" allowClear style={{ width: 120 }} />
        </Form.Item>
        <Form.Item name="type" label="类型">
          <Select placeholder="全部" allowClear style={{ width: 120 }}>
            {Object.entries(typeLabels).map(([val, { label }]) => (
              <Select.Option key={val} value={val}>{label}</Select.Option>
            ))}
          </Select>
        </Form.Item>
        <Form.Item>
          <Space>
            <Button type="primary" htmlType="submit">搜索</Button>
            <Button onClick={() => {
              searchFormProps.form?.resetFields();
              searchFormProps.onFinish?.({});
            }}>重置</Button>
          </Space>
        </Form.Item>
      </Form>

      <Table {...tableProps} rowKey="id" scroll={{ x: 1200 }}>
        <Table.Column title="用户" width={180} render={(_, r: any) => (
          <div><div style={{ fontWeight: 'bold' }}>{r.profiles?.nickname || '-'}</div><div style={{ fontSize: 12, color: '#999' }}>ID: {r.profiles?.numeric_id || '-'}</div></div>
        )} />
        <Table.Column dataIndex="type" title="类型" width={100} render={(v) => <Tag color={typeLabels[v]?.color}>{typeLabels[v]?.label || v}</Tag>} />
        <Table.Column dataIndex="amount" title="金额" width={120} render={(v) => <b style={{ color: v > 0 ? '#52c41a' : '#f5222d' }}>{v > 0 ? `+${v}` : v}</b>} />
        <Table.Column dataIndex="balance_after" title="变动后" width={120} render={(v) => <span>{v}</span>} />
        <Table.Column dataIndex="description" title="备注" />
        <Table.Column dataIndex="created_at" title="时间" width={180} render={(val) => dayjs(val).format('YYYY-MM-DD HH:mm:ss')} />
      </Table>
    </List>
  )
}
