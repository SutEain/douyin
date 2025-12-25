import { List, useTable } from '@refinedev/antd'
import { Table, Space, Avatar, Button, Tag, message, Modal, Form, Input, Select } from 'antd'
import { EyeOutlined, EditOutlined, CheckCircleOutlined, StopOutlined } from '@ant-design/icons'
import { useNavigate } from 'react-router-dom'
import { useUpdate } from '@refinedev/core'

export const UserList = () => {
  const navigate = useNavigate()
  const { mutate: updateProfile } = useUpdate()

  const { tableProps, searchFormProps } = useTable({
    // ✅ 用视图直接 join 邀请人，避免 PostgREST 自关联 embed（PGRST200）
    resource: 'admin_profiles_list',
    syncWithLocation: true,
    sorters: {
      initial: [{ field: 'created_at', order: 'desc' }]
    },
    onSearch: (params: Record<string, any>) => {
      const filters: any[] = []

      const q = String(params.q || '').trim()
      const inviterId = String(params.inviter_id || '').trim()
      const numericId = String(params.numeric_id || '').trim()
      const tgUserId = String(params.tg_user_id || '').trim()
      const uuid = String(params.id || '').trim()
      const hasVideos = params.has_videos

      if (q) {
        // 昵称 / 用户名 模糊搜索（任意命中）
        // 使用标准 Refine 逻辑过滤器数组语法，修复 e.value.map is not a function 错误
        filters.push({
          operator: 'or',
          value: [
            { field: 'nickname', operator: 'contains', value: q },
            { field: 'username', operator: 'contains', value: q },
            { field: 'tg_username', operator: 'contains', value: q }
          ]
        })
      }

      if (inviterId) {
        // 搜索邀请人：直接用邀请人的数字 ID 搜索
        // 注意：这里利用 Supabase/PostgREST 对 JSONB 字段的过滤能力
        filters.push({
          field: 'inviter->numeric_id',
          operator: 'eq',
          value: Number(inviterId)
        })
      }

      if (numericId) {
        filters.push({ field: 'numeric_id', operator: 'eq', value: Number(numericId) })
      }
      if (tgUserId) {
        filters.push({ field: 'tg_user_id', operator: 'eq', value: Number(tgUserId) })
      }
      if (uuid) {
        filters.push({ field: 'id', operator: 'eq', value: uuid })
      }

      if (hasVideos === 'true' || hasVideos === true) {
        filters.push({ field: 'video_count', operator: 'gt', value: 0 })
      } else if (hasVideos === 'false' || hasVideos === false) {
        filters.push({ field: 'video_count', operator: 'eq', value: 0 })
      }

      return filters
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
      <Form {...searchFormProps} layout="inline" style={{ marginBottom: 16 }}>
        <Form.Item name="q" label="关键词">
          <Input placeholder="昵称/用户名" allowClear style={{ width: 180 }} />
        </Form.Item>
        <Form.Item name="inviter_id" label="邀请人ID">
          <Input placeholder="邀请人数字ID" allowClear style={{ width: 140 }} />
        </Form.Item>
        <Form.Item name="numeric_id" label="数字ID">
          <Input placeholder="如 10086" allowClear style={{ width: 120 }} />
        </Form.Item>
        <Form.Item name="tg_user_id" label="TGID">
          <Input placeholder="如 123456789" allowClear style={{ width: 160 }} />
        </Form.Item>
        <Form.Item name="id" label="UUID">
          <Input placeholder="profiles.id" allowClear style={{ width: 260 }} />
        </Form.Item>
        <Form.Item name="has_videos" label="是否有作品">
          <Select allowClear placeholder="全部" style={{ width: 100 }}>
            <Select.Option value="true">是</Select.Option>
            <Select.Option value="false">否</Select.Option>
          </Select>
        </Form.Item>
        <Form.Item>
          <Button type="primary" htmlType="submit">
            搜索
          </Button>
        </Form.Item>
      </Form>
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
          title="邀请人"
          width={160}
          render={(_, record: any) => {
            const inviterRaw = record?.inviter
            const inviter = Array.isArray(inviterRaw) ? inviterRaw?.[0] : inviterRaw
            const name = inviter?.nickname || inviter?.username || inviter?.numeric_id || '-'
            return <span>{name}</span>
          }}
        />
        <Table.Column
          dataIndex="balance_usdt"
          title="余额(USDT)"
          width={120}
          render={(v) => <span style={{ fontFamily: 'monospace' }}>{v ?? '0'}</span>}
        />
        <Table.Column
          dataIndex="frozen_usdt"
          title="冻结(USDT)"
          width={120}
          render={(v) => <span style={{ fontFamily: 'monospace' }}>{v ?? '0'}</span>}
        />
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
