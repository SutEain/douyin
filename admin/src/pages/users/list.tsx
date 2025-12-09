import { List, useTable } from '@refinedev/antd'
import { Table, Space, Avatar, Button, Tag, message, Modal } from 'antd'
import { EyeOutlined, EditOutlined, CheckCircleOutlined, StopOutlined } from '@ant-design/icons'
import { useNavigate } from 'react-router-dom'
import { useUpdate } from '@refinedev/core'

export const UserList = () => {
  const navigate = useNavigate()
  const { mutate: updateProfile } = useUpdate()

  const { tableProps } = useTable({
    resource: 'profiles',
    syncWithLocation: true,
    sorters: {
      initial: [{ field: 'created_at', order: 'desc' }]
    }
  })

  // 切换自动审核状态
  const handleToggleAutoApprove = (record: any) => {
    const newValue = !record.auto_approve
    Modal.confirm({
      title: newValue ? '开启自动审核' : '关闭自动审核',
      content: newValue
        ? `确定让「${record.nickname || record.username}」后续发布自动通过审核吗？`
        : `确定让「${record.nickname || record.username}」后续发布需要人工审核吗？`,
      onOk: () => {
        updateProfile(
          {
            resource: 'profiles',
            id: record.id,
            values: { auto_approve: newValue }
          },
          {
            onSuccess: () => {
              message.success(newValue ? '已开启自动审核' : '已关闭自动审核')
            },
            onError: () => {
              message.error('操作失败')
            }
          }
        )
      }
    })
  }

  return (
    <List>
      <Table {...tableProps} rowKey="id" scroll={{ x: 1200 }}>
        <Table.Column
          dataIndex="avatar_url"
          title="头像"
          width={80}
          render={(value) => (
            <Avatar src={value} size={40} style={{ backgroundColor: '#87d068' }}>
              {!value && 'U'}
            </Avatar>
          )}
        />
        <Table.Column
          dataIndex="numeric_id"
          title="数字ID"
          width={100}
          render={(value) => (
            <span style={{ fontFamily: 'monospace', color: '#666' }}>{value || '-'}</span>
          )}
        />
        <Table.Column dataIndex="nickname" title="昵称" width={150} />
        <Table.Column
          dataIndex="username"
          title="用户名"
          width={150}
          render={(value) => <span style={{ color: '#999' }}>@{value || '-'}</span>}
        />
        <Table.Column dataIndex="video_count" title="视频数" width={80} />
        <Table.Column dataIndex="follower_count" title="粉丝数" width={80} />
        <Table.Column dataIndex="total_likes" title="获赞数" width={80} />
        <Table.Column
          dataIndex="auto_approve"
          title="审核状态"
          width={100}
          render={(value) => (
            <Tag color={value ? 'green' : 'orange'}>{value ? '自动通过' : '需审核'}</Tag>
          )}
        />
        <Table.Column
          title="操作"
          width={200}
          fixed="right"
          render={(_, record: any) => (
            <Space size="small">
              <Button
                type="text"
                size="small"
                icon={<EyeOutlined />}
                onClick={() => navigate(`/users/show/${record.id}`)}
              />
              <Button
                type="text"
                size="small"
                icon={<EditOutlined />}
                onClick={() => navigate(`/users/edit/${record.id}`)}
              />
              <Button
                type={record.auto_approve ? 'default' : 'primary'}
                size="small"
                icon={record.auto_approve ? <StopOutlined /> : <CheckCircleOutlined />}
                onClick={() => handleToggleAutoApprove(record)}
              >
                {record.auto_approve ? '需审核' : '免审核'}
              </Button>
            </Space>
          )}
        />
      </Table>
    </List>
  )
}
