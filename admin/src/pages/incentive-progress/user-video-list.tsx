import { List, useTable } from '@refinedev/antd'
import { Form, Input, Select, Space, Table, Tag } from 'antd'

export const UserVideoIncentiveProgressList = () => {
  const { tableProps, searchFormProps } = useTable({
    resource: 'user_video_incentive_progress',
    syncWithLocation: true,
    meta: {
      select:
        '*, profiles:user_id(nickname,numeric_id), videos:video_id(description,like_count,view_count,created_at), incentive_rules:rule_id(name,code,threshold,reward_usdt)'
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
      if (params.is_completed !== undefined) {
        filters.push({ field: 'is_completed', operator: 'eq', value: params.is_completed })
      }
      if (params.is_claimed !== undefined) {
        filters.push({ field: 'is_claimed', operator: 'eq', value: params.is_claimed })
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
        <Form.Item name="is_completed" label="完成">
          <Select placeholder="全部" allowClear style={{ width: 110 }}>
            <Select.Option value={true}>已完成</Select.Option>
            <Select.Option value={false}>未完成</Select.Option>
          </Select>
        </Form.Item>
        <Form.Item name="is_claimed" label="领取">
          <Select placeholder="全部" allowClear style={{ width: 110 }}>
            <Select.Option value={true}>已领取</Select.Option>
            <Select.Option value={false}>未领取</Select.Option>
          </Select>
        </Form.Item>
      </Form>

      <Table {...tableProps} rowKey="id" scroll={{ x: 1400 }}>
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
          title="作品"
          width={320}
          render={(_, record: any) => (
            <div
              style={{
                maxWidth: 300,
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis'
              }}
            >
              {record.videos?.description || '-'}
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
        <Table.Column
          title="作品数据"
          width={160}
          render={(_, record: any) => (
            <Space>
              <span>赞 {record.videos?.like_count ?? '-'}</span>
              <span>播 {record.videos?.view_count ?? '-'}</span>
            </Space>
          )}
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
        <Table.Column
          dataIndex="is_completed"
          title="完成"
          width={90}
          render={(v) => (v ? <Tag color="green">已完成</Tag> : <Tag>未完成</Tag>)}
        />
        <Table.Column
          dataIndex="is_claimed"
          title="领取"
          width={90}
          render={(v) => (v ? <Tag color="blue">已领取</Tag> : <Tag>未领取</Tag>)}
        />
        <Table.Column dataIndex="updated_at" title="更新时间" width={180} />
      </Table>
    </List>
  )
}
