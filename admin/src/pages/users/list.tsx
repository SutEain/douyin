import { List, useTable, ShowButton, EditButton } from '@refinedev/antd'
import { Table, Space, Avatar } from 'antd'

export const UserList = () => {
  const { tableProps } = useTable({
    resource: 'profiles',
    syncWithLocation: true
  })

  return (
    <List>
      <Table {...tableProps} rowKey="id">
        <Table.Column
          dataIndex="avatar_url"
          title="头像"
          render={(value) => <Avatar src={value} />}
        />
        <Table.Column dataIndex="nickname" title="昵称" />
        <Table.Column dataIndex="username" title="用户名" />
        <Table.Column dataIndex="video_count" title="视频数" />
        <Table.Column dataIndex="follower_count" title="粉丝数" />
        <Table.Column
          title="操作"
          dataIndex="actions"
          render={(_, record: any) => (
            <Space>
              <ShowButton hideText size="small" recordItemId={record.id} />
              <EditButton hideText size="small" recordItemId={record.id} />
            </Space>
          )}
        />
      </Table>
    </List>
  )
}
