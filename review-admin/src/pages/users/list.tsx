import { List, useTable, DateField } from '@refinedev/antd'
import { Table, Space, Button, Tag, Avatar, Form, Input, Select } from 'antd'
import { EyeOutlined, UserOutlined } from '@ant-design/icons'
import { useNavigate } from 'react-router-dom'

export const UserList = () => {
  const navigate = useNavigate()

  const { tableProps, searchFormProps } = useTable({
    resource: 'profiles',
    sorters: {
      initial: [{ field: 'created_at', order: 'desc' }]
    },
    pagination: {
      pageSize: 20
    },
    onSearch: (params: any) => {
      const filters: any[] = []

      if (params.is_banned) {
        filters.push({ field: 'is_banned', operator: 'eq', value: params.is_banned === 'true' })
      }
      if (params.keyword) {
        // Note: Supabase doesn't support OR directly in filters, so we'll use username search
        filters.push({ field: 'username', operator: 'contains', value: params.keyword })
      }

      return filters
    }
  })

  return (
    <List
      title="用户管理"
      headerButtons={
        <Button
          onClick={() => {
            searchFormProps.form?.resetFields()
            searchFormProps.form?.submit()
          }}
        >
          刷新
        </Button>
      }
    >
      <Form {...searchFormProps} layout="inline" style={{ marginBottom: 16 }}>
        <Form.Item name="is_banned" label="状态">
          <Select placeholder="全部" allowClear style={{ width: 120 }}>
            <Select.Option value="false">正常</Select.Option>
            <Select.Option value="true">已封禁</Select.Option>
          </Select>
        </Form.Item>
        <Form.Item name="keyword" label="关键词">
          <Input placeholder="搜索用户名/昵称" allowClear />
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

      <Table {...tableProps} rowKey="id" size="middle">
        <Table.Column
          title="头像"
          dataIndex="avatar_url"
          width={80}
          render={(url: string) =>
            url ? <Avatar src={url} size={50} /> : <Avatar icon={<UserOutlined />} size={50} />
          }
        />
        <Table.Column
          title="昵称"
          dataIndex="nickname"
          width={150}
          render={(nickname: string) => nickname || '-'}
        />
        <Table.Column
          title="用户名"
          dataIndex="username"
          width={150}
          render={(username: string) => username || '-'}
        />
        <Table.Column
          title="数字ID"
          dataIndex="numeric_id"
          width={100}
          render={(id: number) => id || '-'}
        />
        <Table.Column
          title="状态"
          dataIndex="is_banned"
          width={100}
          render={(isBanned: boolean) => (
            <Tag color={isBanned ? 'red' : 'green'}>{isBanned ? '已封禁' : '正常'}</Tag>
          )}
        />
        <Table.Column
          title="余额"
          dataIndex="balance_coins"
          width={120}
          render={(balance: number) => `${balance || 0} 抖币`}
        />
        <Table.Column
          title="视频数"
          dataIndex="video_count"
          width={100}
          render={(count: number) => count || 0}
        />
        <Table.Column
          title="粉丝/关注"
          width={120}
          render={(_: any, record: any) => (
            <span>
              {record.follower_count || 0} / {record.following_count || 0}
            </span>
          )}
        />
        <Table.Column
          title="注册时间"
          dataIndex="created_at"
          width={180}
          render={(value: any) => <DateField value={value} format="YYYY-MM-DD HH:mm:ss" />}
        />
        <Table.Column
          title="操作"
          width={100}
          fixed="right"
          render={(_: any, record: any) => (
            <Space>
              <Button
                type="link"
                size="small"
                icon={<EyeOutlined />}
                onClick={() => navigate(`/users/show/${record.id}`)}
              >
                查看
              </Button>
            </Space>
          )}
        />
      </Table>
    </List>
  )
}
