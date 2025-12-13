import { List, useTable } from '@refinedev/antd'
import { Form, Input, Select, Table, Tag } from 'antd'

const reasonColors: Record<string, string> = {
  task_reward: 'blue',
  invite_reward: 'green',
  manual_adjust: 'orange'
}

export const WalletLedgerList = () => {
  const { tableProps, searchFormProps } = useTable({
    resource: 'wallet_ledger',
    syncWithLocation: true,
    meta: {
      select:
        '*, profiles:user_id(nickname,numeric_id), videos:video_id(description), incentive_rules:rule_id(name,code)'
    },
    sorters: {
      initial: [{ field: 'created_at', order: 'desc' }]
    },
    onSearch: (params: Record<string, any>) => {
      const filters: any[] = []
      if (params.username) {
        filters.push({ field: 'profiles.nickname', operator: 'contains', value: params.username })
      }
      if (params.reason_type) {
        filters.push({ field: 'reason_type', operator: 'eq', value: params.reason_type })
      }
      if (params.rule_code) {
        filters.push({
          field: 'incentive_rules.code',
          operator: 'contains',
          value: params.rule_code
        })
      }
      return filters
    }
  })

  return (
    <List>
      <Form {...searchFormProps} layout="inline" style={{ marginBottom: 16 }}>
        <Form.Item name="username" label="用户">
          <Input placeholder="昵称" style={{ width: 160 }} allowClear />
        </Form.Item>
        <Form.Item name="reason_type" label="类型">
          <Select placeholder="全部" allowClear style={{ width: 140 }}>
            <Select.Option value="task_reward">任务奖励</Select.Option>
            <Select.Option value="invite_reward">邀请奖励</Select.Option>
            <Select.Option value="manual_adjust">手动调整</Select.Option>
          </Select>
        </Form.Item>
        <Form.Item name="rule_code" label="规则">
          <Input placeholder="规则 code" style={{ width: 200 }} allowClear />
        </Form.Item>
      </Form>

      <Table {...tableProps} rowKey="id" scroll={{ x: 1700 }}>
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
          dataIndex="reason_type"
          title="类型"
          width={120}
          render={(v) => <Tag color={reasonColors[v] || 'default'}>{v}</Tag>}
        />
        <Table.Column
          dataIndex="amount_usdt"
          title="变动(USDT)"
          width={120}
          render={(v) => <span style={{ fontFamily: 'monospace' }}>{v}</span>}
        />
        <Table.Column
          title="余额(前→后)"
          width={180}
          render={(_, r: any) => (
            <span style={{ fontFamily: 'monospace' }}>
              {r.balance_before_usdt} → {r.balance_after_usdt}
            </span>
          )}
        />
        <Table.Column
          title="冻结(前→后)"
          width={180}
          render={(_, r: any) => (
            <span style={{ fontFamily: 'monospace' }}>
              {r.frozen_before_usdt} → {r.frozen_after_usdt}
            </span>
          )}
        />
        <Table.Column
          title="规则"
          width={240}
          render={(_, r: any) => (
            <div>
              <div>{r.incentive_rules?.name || '-'}</div>
              <div style={{ fontSize: 12, color: '#999', fontFamily: 'monospace' }}>
                {r.incentive_rules?.code || '-'}
              </div>
            </div>
          )}
        />
        <Table.Column
          title="作品"
          width={320}
          render={(_, r: any) => (
            <div
              style={{
                maxWidth: 300,
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis'
              }}
            >
              {r.videos?.description || '-'}
            </div>
          )}
        />
        <Table.Column dataIndex="note" title="备注" width={200} render={(v) => v || '-'} />
        <Table.Column dataIndex="created_at" title="时间" width={180} />
      </Table>
    </List>
  )
}
