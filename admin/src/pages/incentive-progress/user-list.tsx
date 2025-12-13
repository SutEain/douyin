import { List, useTable } from '@refinedev/antd'
import { Form, Input, Select, Table, Tag } from 'antd'

export const UserIncentiveProgressList = () => {
  const { tableProps, searchFormProps } = useTable({
    resource: 'user_incentive_progress',
    syncWithLocation: true,
    meta: {
      select:
        '*, profiles:user_id(nickname,numeric_id), incentive_rules:rule_id(name,code,reward_usdt,cap_count)'
    },
    sorters: {
      initial: [{ field: 'updated_at', order: 'desc' }]
    },
    onSearch: (params: Record<string, any>) => {
      const filters: any[] = []
      if (params.username) {
        filters.push({ field: 'profiles.nickname', operator: 'contains', value: params.username })
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
        <Form.Item name="rule_code" label="规则">
          <Input placeholder="规则 code" style={{ width: 200 }} allowClear />
        </Form.Item>
        <Form.Item name="cap_only" label="上限">
          <Select placeholder="全部" allowClear style={{ width: 120 }}>
            <Select.Option value="has_cap">有上限</Select.Option>
            <Select.Option value="no_cap">无上限</Select.Option>
          </Select>
        </Form.Item>
      </Form>

      <Table {...tableProps} rowKey="id" scroll={{ x: 1200 }}>
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
          title="规则"
          width={260}
          render={(_, record: any) => (
            <div>
              <div>{record.incentive_rules?.name || '-'}</div>
              <div style={{ fontSize: 12, color: '#999', fontFamily: 'monospace' }}>
                {record.incentive_rules?.code || '-'}
              </div>
            </div>
          )}
        />
        <Table.Column dataIndex="progress_value" title="进度值" width={90} />
        <Table.Column dataIndex="cap_used" title="已消耗上限" width={110} />
        <Table.Column
          title="上限"
          width={120}
          render={(_, record: any) => {
            const cap = record.incentive_rules?.cap_count
            if (cap == null) return <Tag>无上限</Tag>
            return <Tag color="orange">上限 {cap}</Tag>
          }}
        />
        <Table.Column
          title="奖励(USDT)"
          width={120}
          render={(_, record: any) => (
            <span style={{ fontFamily: 'monospace' }}>
              {record.incentive_rules?.reward_usdt ?? '0'}
            </span>
          )}
        />
        <Table.Column dataIndex="updated_at" title="更新时间" width={180} />
      </Table>
    </List>
  )
}
