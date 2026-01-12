import { List, useTable } from '@refinedev/antd'
import { Table, Tag, Input, Space, Avatar, Form, Button } from 'antd'
import { UserOutlined } from '@ant-design/icons'
import dayjs from 'dayjs'

export const UserList = () => {
  const { tableProps, searchFormProps } = useTable({
    resource: 'profiles',
    syncWithLocation: true,
    pagination: { pageSize: 10 },
    sorters: { initial: [{ field: 'created_at', order: 'desc' }] },
    onSearch: (params: any) => {
      const filters: any[] = []
      const q = params.q?.trim()
      if (q) {
        filters.push({
          operator: 'or',
          value: [
            { field: 'nickname', operator: 'contains', value: q },
            { field: 'username', operator: 'contains', value: q },
            { field: 'numeric_id', operator: 'eq', value: isNaN(Number(q)) ? undefined : Number(q) }
          ].filter(f => f.value !== undefined)
        })
      }
      return filters
    }
  })

  return (
    <List title="用户管理 (只读)">
      <Form {...searchFormProps} layout="inline" style={{ marginBottom: 16 }}>
        <Form.Item name="q" label="关键词">
          <Input placeholder="昵称/ID/用户名" allowClear style={{ width: 250 }} />
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

      <Table {...tableProps} rowKey="id" scroll={{ x: 1300 }}>
        <Table.Column title="基本信息" width={200} render={(_, r: any) => (
          <Space><Avatar src={r.avatar_url} icon={<UserOutlined />} />
          <div><div style={{ fontWeight: 'bold' }}>{r.nickname || '神秘用户'}</div><div style={{ fontSize: 12, color: '#999' }}>ID: {r.numeric_id || '-'}</div></div></Space>
        )} />
        <Table.Column title="身份/状态" width={150} render={(_, r: any) => (
          <Space direction="vertical" size={0}>
            <Space>{r.is_admin && <Tag color="gold">管理员</Tag>}{r.is_reviewer && <Tag color="blue">审核员</Tag>}</Space>
            <div style={{ marginTop: 4 }}>{r.is_banned ? <Tag color="red">已封禁</Tag> : <Tag color="green">正常</Tag>}</div>
          </Space>
        )} />
        <Table.Column title="资产" width={180} render={(_, r: any) => (
          <div style={{ fontSize: 12 }}>余额: <b>{r.balance_coins || 0}</b> | 冻结: {r.frozen_coins || 0}</div>
        )} />
        <Table.Column dataIndex="video_count" title="作品数" width={100} sorter />
        <Table.Column dataIndex="created_at" title="注册时间" width={160} render={(val) => dayjs(val).format('YYYY-MM-DD HH:mm')} />
      </Table>
    </List>
  )
}
