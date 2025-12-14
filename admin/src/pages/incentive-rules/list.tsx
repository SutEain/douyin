import { List, useTable } from '@refinedev/antd'
import { Button, Form, Input, Select, Space, Table, Tag } from 'antd'
import { useNavigate } from 'react-router-dom'

const ruleTypeText: Record<string, { text: string; color: string }> = {
  video_like_threshold: { text: '单作品达标', color: 'blue' },
  invite_success: { text: '邀请成功', color: 'green' },
  invitee_publish: { text: '徒弟发布', color: 'orange' }
}

export const IncentiveRuleList = () => {
  const navigate = useNavigate()

  const { tableProps, searchFormProps } = useTable({
    resource: 'incentive_rules',
    syncWithLocation: true,
    sorters: {
      initial: [{ field: 'sort_order', order: 'asc' }]
    },
    onSearch: (params: Record<string, any>) => {
      const filters: any[] = []
      if (params.q) {
        filters.push({ field: 'name', operator: 'contains', value: params.q })
      }
      if (params.code) {
        filters.push({ field: 'code', operator: 'contains', value: params.code })
      }
      if (params.rule_type) {
        filters.push({ field: 'rule_type', operator: 'eq', value: params.rule_type })
      }
      if (typeof params.is_active === 'boolean') {
        filters.push({ field: 'is_active', operator: 'eq', value: params.is_active })
      }
      return filters
    }
  })

  return (
    <List
      headerButtons={() => (
        <Button type="primary" onClick={() => navigate('/incentive-rules/create')}>
          新建规则
        </Button>
      )}
    >
      <Form {...searchFormProps} layout="inline" style={{ marginBottom: 16 }}>
        <Form.Item name="q" label="名称">
          <Input placeholder="规则名称" style={{ width: 160 }} allowClear />
        </Form.Item>
        <Form.Item name="code" label="Code">
          <Input placeholder="如 invite_success_reward" style={{ width: 200 }} allowClear />
        </Form.Item>
        <Form.Item name="rule_type" label="类型">
          <Select placeholder="选择类型" allowClear style={{ width: 140 }}>
            <Select.Option value="video_like_threshold">单作品达标</Select.Option>
            <Select.Option value="invite_success">邀请成功</Select.Option>
            <Select.Option value="invitee_publish">徒弟发布</Select.Option>
          </Select>
        </Form.Item>
        <Form.Item name="is_active" label="启用">
          <Select placeholder="全部" allowClear style={{ width: 100 }}>
            <Select.Option value={true}>启用</Select.Option>
            <Select.Option value={false}>禁用</Select.Option>
          </Select>
        </Form.Item>
        <Form.Item>
          <Button type="primary" htmlType="submit">
            搜索
          </Button>
        </Form.Item>
      </Form>

      <Table {...tableProps} rowKey="id" scroll={{ x: 1200 }}>
        <Table.Column dataIndex="sort_order" title="排序" width={80} />
        <Table.Column dataIndex="name" title="名称" width={200} />
        <Table.Column
          dataIndex="code"
          title="Code"
          width={220}
          render={(v) => <span style={{ fontFamily: 'monospace', color: '#666' }}>{v}</span>}
        />
        <Table.Column
          dataIndex="rule_type"
          title="类型"
          width={130}
          render={(v) => (
            <Tag color={ruleTypeText[v]?.color || 'default'}>{ruleTypeText[v]?.text || v}</Tag>
          )}
        />
        <Table.Column dataIndex="metric" title="指标" width={120} render={(v) => v || '-'} />
        <Table.Column dataIndex="threshold" title="阈值" width={90} render={(v) => v ?? '-'} />
        <Table.Column
          dataIndex="reward_usdt"
          title="奖励(USDT)"
          width={140}
          render={(v) => <span style={{ fontFamily: 'monospace' }}>{v ?? '0'}</span>}
        />
        <Table.Column dataIndex="cap_count" title="上限" width={90} render={(v) => v ?? '-'} />
        <Table.Column dataIndex="cap_window" title="窗口" width={110} render={(v) => v || '-'} />
        <Table.Column
          dataIndex="is_active"
          title="状态"
          width={90}
          render={(v) => (v ? <Tag color="green">启用</Tag> : <Tag>禁用</Tag>)}
        />
        <Table.Column
          title="操作"
          width={120}
          fixed="right"
          render={(_, record: any) => (
            <Space size="small">
              <Button
                type="link"
                size="small"
                onClick={() => navigate(`/incentive-rules/edit/${record.id}`)}
              >
                编辑
              </Button>
            </Space>
          )}
        />
      </Table>
    </List>
  )
}
