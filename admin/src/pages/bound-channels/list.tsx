import { List, useTable, DateField } from '@refinedev/antd'
import { Table, Space, Button, Input, Form, Switch } from 'antd'
import { DeleteOutlined } from '@ant-design/icons'
import { useDelete, useUpdate } from '@refinedev/core'

export const BoundChannelList = () => {
  const { mutate: deleteChannel } = useDelete()
  const { mutate: updateChannel } = useUpdate()

  const { tableProps, searchFormProps } = useTable({
    resource: 'bound_channels',
    syncWithLocation: true,
    sorters: {
      initial: [{ field: 'created_at', order: 'desc' }]
    },
    meta: {
      select: '*, profiles:user_id(nickname, numeric_id)'
    },
    queryOptions: {
      staleTime: 0,
      refetchOnMount: 'always'
    },
    onSearch: (params: Record<string, any>) => {
      const filters: any[] = []
      const q = String(params.q || '').trim()
      const userQ = String(params.user_q || '').trim()

      if (q) {
        filters.push({
          operator: 'or',
          value: [
            { field: 'title', operator: 'contains', value: q },
            { field: 'username', operator: 'contains', value: q }
          ]
        })
      }

      if (userQ) {
        const isNumeric = /^[0-9]+$/.test(userQ)
        if (isNumeric) {
          filters.push({ field: 'profiles.numeric_id', operator: 'eq', value: Number(userQ) })
        } else {
          filters.push({ field: 'profiles.nickname', operator: 'contains', value: userQ })
        }
      }

      return filters
    }
  })

  return (
    <List>
      <Form {...searchFormProps} layout="inline" style={{ marginBottom: 16 }}>
        <Form.Item name="q" label="频道搜索">
          <Input placeholder="标题/用户名" allowClear style={{ width: 180 }} />
        </Form.Item>
        <Form.Item name="user_q" label="归属用户">
          <Input placeholder="昵称/数字ID" allowClear style={{ width: 180 }} />
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
        <Table.Column dataIndex="id" title="频道 ID" />
        <Table.Column
          title="归属用户"
          render={(_, record: any) => (
            <Space direction="vertical" size={0}>
              <span style={{ fontWeight: 'bold' }}>{record.profiles?.nickname || '-'}</span>
              <span style={{ fontSize: '12px', color: '#999' }}>
                ID: {record.profiles?.numeric_id}
              </span>
            </Space>
          )}
        />
        <Table.Column dataIndex="title" title="频道名称" />
        <Table.Column dataIndex="username" title="用户名" render={(v) => (v ? `@${v}` : '-')} />
        <Table.Column
          dataIndex="sync_enabled"
          title="同步状态"
          render={(v, record: any) => (
            <Switch
              checked={v}
              checkedChildren="同步"
              unCheckedChildren="暂停"
              onChange={(checked) => {
                updateChannel({
                  resource: 'bound_channels',
                  id: record.id,
                  values: { sync_enabled: checked },
                  successNotification: () => ({
                    message: '同步状态已更新',
                    type: 'success'
                  })
                })
              }}
            />
          )}
        />
        <Table.Column
          dataIndex="is_adult"
          title="成人"
          render={(v, record: any) => (
            <Switch
              checked={v}
              checkedChildren="🔞"
              unCheckedChildren="否"
              onChange={(checked) => {
                updateChannel({
                  resource: 'bound_channels',
                  id: record.id,
                  values: { is_adult: checked },
                  successNotification: () => ({
                    message: '内容分级已更新',
                    type: 'success'
                  })
                })
              }}
            />
          )}
        />
        <Table.Column
          dataIndex="is_sea"
          title="东南亚"
          render={(v, record: any) => (
            <Switch
              checked={v}
              checkedChildren="🌏"
              unCheckedChildren="否"
              onChange={(checked) => {
                updateChannel({
                  resource: 'bound_channels',
                  id: record.id,
                  values: { is_sea: checked },
                  successNotification: () => ({
                    message: '板块属性已更新',
                    type: 'success'
                  })
                })
              }}
            />
          )}
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
