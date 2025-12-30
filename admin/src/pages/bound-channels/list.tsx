import { List, useTable, DateField } from '@refinedev/antd'
import { Table, Space, Tag, Button, Input, Form } from 'antd'
import { DeleteOutlined, SyncOutlined } from '@ant-design/icons'
import { useDelete } from '@refinedev/core'

export const BoundChannelList = () => {
  const { mutate: deleteChannel } = useDelete()

  const { tableProps, searchFormProps } = useTable({
    resource: 'bound_channels',
    syncWithLocation: true,
    sorters: {
      initial: [{ field: 'created_at', order: 'desc' }]
    },
    onSearch: (params: Record<string, any>) => {
      const filters: any[] = []
      const q = String(params.q || '').trim()

      if (q) {
        filters.push({
          operator: 'or',
          value: [
            { field: 'title', operator: 'contains', value: q },
            { field: 'username', operator: 'contains', value: q }
          ]
        })
      }

      return filters
    }
  })

  return (
    <List>
      <Form {...searchFormProps} layout="inline" style={{ marginBottom: 16 }}>
        <Form.Item name="q" label="频道搜索">
          <Input placeholder="标题/用户名" allowClear />
        </Form.Item>
        <Form.Item>
          <Space>
            <Button type="primary" htmlType="submit">
              搜索
            </Button>
            <Button
              onClick={() => {
                searchFormProps.form?.resetFields()
                searchFormProps.form?.submit()
              }}
            >
              重置
            </Button>
          </Space>
        </Form.Item>
      </Form>
      <Table {...tableProps} rowKey="id">
        <Table.Column dataIndex="id" title="频道 ID" />
        <Table.Column dataIndex="title" title="频道名称" />
        <Table.Column dataIndex="username" title="用户名" render={(v) => (v ? `@${v}` : '-')} />
        <Table.Column
          dataIndex="sync_enabled"
          title="同步状态"
          render={(v) => (
            <Tag color={v ? 'green' : 'gray'} icon={<SyncOutlined spin={v} />}>
              {v ? '同步中' : '已暂停'}
            </Tag>
          )}
        />
        <Table.Column
          dataIndex="is_adult"
          title="成人内容"
          render={(v) => (v ? <Tag color="red">🔞 是</Tag> : <Tag>否</Tag>)}
        />
        <Table.Column
          dataIndex="is_sea"
          title="东南亚"
          render={(v) => (v ? <Tag color="blue">🌏 是</Tag> : <Tag>否</Tag>)}
        />
        <Table.Column
          dataIndex="created_at"
          title="绑定时间"
          render={(v) => <DateField value={v} format="YYYY-MM-DD HH:mm" />}
        />
        <Table.Column
          title="操作"
          fixed="right"
          render={(_, record: any) => (
            <Space>
              <Button
                danger
                size="small"
                icon={<DeleteOutlined />}
                onClick={() => {
                  if (confirm(`确定要解绑频道「${record.title}」吗？`)) {
                    deleteChannel({
                      resource: 'bound_channels',
                      id: record.id
                    })
                  }
                }}
              >
                解绑
              </Button>
            </Space>
          )}
        />
      </Table>
    </List>
  )
}
