import { List, useTable, DateField } from '@refinedev/antd'
import { Table, Space, Avatar, Button, Tag, message, Modal, Form, Input, Select } from 'antd'
import {
  EyeOutlined,
  EditOutlined,
  CheckCircleOutlined,
  StopOutlined
  // DollarOutlined // 🚨 已禁用：调整余额功能已移除
} from '@ant-design/icons'
import { useNavigate } from 'react-router-dom'
import { useUpdate } from '@refinedev/core'
import { useState } from 'react'
import { supabaseClient } from '../../supabaseClient'

export const UserList = () => {
  const navigate = useNavigate()
  const { mutate: updateProfile } = useUpdate()
  // 🚨 已禁用：调整余额功能已移除
  // const [adjustModalVisible, setAdjustModalVisible] = useState(false)
  // const [adjustingUser, setAdjustingUser] = useState<any>(null)
  // const [adjustForm] = Form.useForm()
  // const [isAdjusting, setIsAdjusting] = useState(false)
  const [banModalVisible, setBanModalVisible] = useState(false)
  const [banningUser, setBanningUser] = useState<any>(null)
  const [banForm] = Form.useForm()

  const table = useTable({
    // ✅ 用视图直接 join 邀请人，避免 PostgREST 自关联 embed（PGRST200）
    resource: 'admin_profiles_list',
    syncWithLocation: true,
    sorters: {
      initial: [{ field: 'created_at', order: 'desc' }]
    },
    onSearch: (params: Record<string, any>) => {
      const filters: any[] = []

      // 1. 关键词搜索 (q)
      if (params.q && params.q.trim()) {
        const qVal = params.q.trim()
        const orConditions: any[] = [
          { field: 'nickname', operator: 'contains', value: qVal },
          { field: 'username', operator: 'contains', value: qVal },
          { field: 'tg_username', operator: 'contains', value: qVal }
        ]
        // 如果输入的是纯数字，主搜索框也自动匹配数字ID和TGID
        if (/^\d+$/.test(qVal)) {
          const numVal = Number(qVal)
          orConditions.push({ field: 'numeric_id', operator: 'eq', value: numVal })
          orConditions.push({ field: 'tg_user_id', operator: 'eq', value: numVal })
        }
        filters.push({ operator: 'or', value: orConditions })
      }

      // 2. 独立数字 ID 搜索
      if (params.numeric_id) {
        filters.push({ field: 'numeric_id', operator: 'eq', value: Number(params.numeric_id) })
      }

      // 3. 独立 TGID 搜索
      if (params.tg_user_id) {
        filters.push({ field: 'tg_user_id', operator: 'eq', value: Number(params.tg_user_id) })
      }

      // 4. 邀请人 ID 搜索
      if (params.inviter_id) {
        filters.push({
          field: 'inviter->numeric_id',
          operator: 'eq',
          value: Number(params.inviter_id)
        })
      }

      // 5. UUID 搜索
      if (params.id && params.id.trim()) {
        filters.push({ field: 'id', operator: 'eq', value: params.id.trim() })
      }

      // 6. 状态过滤
      if (params.has_videos === 'true' || params.has_videos === true) {
        filters.push({ field: 'video_count', operator: 'gt', value: 0 })
      } else if (params.has_videos === 'false' || params.has_videos === false) {
        filters.push({ field: 'video_count', operator: 'eq', value: 0 })
      }

      if (params.live_status !== undefined && params.live_status !== '') {
        filters.push({ field: 'live_status', operator: 'eq', value: Number(params.live_status) })
      }

      return filters
    }
  })

  const { tableProps, searchFormProps } = table

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
              // 🎯 刷新表格数据，确保状态更新
              table.tableQueryResult?.refetch()
            },
            onError: (error: any) => {
              console.error('[handleToggleAutoApprove] 更新失败:', error)
              message.error(
                error?.message || error?.error?.message || '操作失败，请检查控制台查看详细错误'
              )
            }
          }
        )
      }
    })
  }

  // 更新直播权限状态
  const handleUpdateLiveStatus = (record: any, status: number) => {
    const statusText = status === 2 ? '通过申请' : '拒绝申请'
    Modal.confirm({
      title: `${statusText}`,
      content: `确定要为「${record.nickname || record.username}」${statusText}吗？`,
      onOk: () => {
        updateProfile(
          {
            resource: 'profiles',
            id: record.id,
            values: { live_status: status }
          },
          {
            onSuccess: () => {
              message.success(`已${statusText}`)
            },
            onError: () => {
              message.error('操作失败')
            }
          }
        )
      }
    })
  }

  // 处理余额调整
  // 处理封禁/解封
  const handleToggleBan = (record: any) => {
    if (record.is_banned) {
      // 如果是解封，直接确认
      Modal.confirm({
        title: '确认解封',
        content: `确定要为「${record.nickname || record.username}」解除封禁吗？`,
        onOk: async () => {
          try {
            const { data, error } = await supabaseClient.rpc('admin_ban_user', {
              p_user_id: record.id,
              p_is_banned: false,
              p_ban_reason: null
            })

            if (error) {
              console.error('[handleToggleBan] 解封失败:', error)
              message.error(error.message || '操作失败')
              return
            }

            message.success('已解除封禁')
            table.tableQueryResult?.refetch()
          } catch (err: any) {
            console.error('[handleToggleBan] 解封异常:', err)
            message.error(err?.message || '操作失败')
          }
        }
      })
    } else {
      // 如果是封禁，弹出填写原因的弹窗
      setBanningUser(record)
      setBanModalVisible(true)
    }
  }

  const handleConfirmBan = async () => {
    try {
      const values = await banForm.validateFields()
      const { data, error } = await supabaseClient.rpc('admin_ban_user', {
        p_user_id: banningUser.id,
        p_is_banned: true,
        p_ban_reason: values.reason || '管理员封禁'
      })

      if (error) {
        console.error('[handleConfirmBan] 封禁失败:', error)
        message.error(error.message || '操作失败')
        return
      }

      message.success('已封禁用户')
      setBanModalVisible(false)
      banForm.resetFields()
      table.tableQueryResult?.refetch()
    } catch (err: any) {
      console.error('[handleConfirmBan] 封禁异常:', err)
      message.error(err?.message || '操作失败')
    }
  }

  // 🚨 已禁用：调整余额功能已移除
  // const handleAdjustBalance = async () => {
  //   ...
  // }

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
        <Form.Item name="live_status" label="直播权限">
          <Select allowClear placeholder="全部" style={{ width: 100 }}>
            <Select.Option value="0">未申请</Select.Option>
            <Select.Option value="1">申请中</Select.Option>
            <Select.Option value="2">已通过</Select.Option>
            <Select.Option value="3">已拒绝</Select.Option>
          </Select>
        </Form.Item>
        <Form.Item>
          <Space>
            <Button type="primary" htmlType="submit">
              搜索
            </Button>
            <Button
              onClick={() => {
                searchFormProps.form?.resetFields()
                searchFormProps.onFinish?.({
                  q: undefined,
                  inviter_id: undefined,
                  numeric_id: undefined,
                  tg_user_id: undefined,
                  id: undefined,
                  has_videos: undefined,
                  live_status: undefined
                })
              }}
            >
              重置
            </Button>
          </Space>
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
        <Table.Column
          dataIndex="balance_coins"
          title="余额(抖币)"
          width={120}
          sorter
          render={(v) => (
            <span style={{ fontFamily: 'monospace' }}>
              {(Math.floor((v ?? 0) * 100) / 100).toFixed(2)}
            </span>
          )}
        />
        <Table.Column
          dataIndex="frozen_coins"
          title="冻结(抖币)"
          width={120}
          render={(v) => (
            <span style={{ fontFamily: 'monospace' }}>
              {(Math.floor((v ?? 0) * 100) / 100).toFixed(2)}
            </span>
          )}
        />
        <Table.Column dataIndex="nickname" title="昵称" width={150} />
        <Table.Column
          dataIndex="username"
          title="用户名"
          width={150}
          render={(value) => <span style={{ color: '#999' }}>@{value || '-'}</span>}
        />
        <Table.Column dataIndex="video_count" title="视频数" width={80} sorter />
        <Table.Column dataIndex="follower_count" title="粉丝数" width={80} sorter />
        <Table.Column dataIndex="total_likes" title="获赞数" width={80} sorter />
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
          dataIndex="auto_approve"
          title="审核状态"
          width={100}
          render={(value, record: any) => (
            <Space direction="vertical" size={0}>
              <Tag color={value ? 'green' : 'orange'}>{value ? '自动通过' : '需审核'}</Tag>
              {record.is_banned && <Tag color="red">已封禁</Tag>}
            </Space>
          )}
        />
        <Table.Column
          dataIndex="live_status"
          title="直播权限"
          width={120}
          render={(value) => {
            const colors = ['default', 'blue', 'green', 'red']
            const texts = ['未申请', '申请中', '已通过', '已拒绝']
            return <Tag color={colors[value] || 'default'}>{texts[value] || '未知'}</Tag>
          }}
        />
        <Table.Column
          dataIndex="created_at"
          title="注册时间"
          width={120}
          sorter
          render={(value) => <DateField value={value} format="MM-DD HH:mm" />}
        />
        <Table.Column
          title="操作"
          width={280}
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
              {/* 🚨 已禁用：调整余额功能已移除 */}
              {/* {!isReviewer && (
                <Button
                  type="text"
                  size="small"
                  icon={<DollarOutlined />}
                  style={{ color: '#faad14' }}
                  onClick={() => {
                    setAdjustingUser(record)
                    setAdjustModalVisible(true)
                  }}
                />
              )} */}
              {record.live_status === 1 && (
                <>
                  <Button
                    type="primary"
                    size="small"
                    style={{ backgroundColor: '#52c41a', borderColor: '#52c41a' }}
                    onClick={() => handleUpdateLiveStatus(record, 2)}
                  >
                    通过直播
                  </Button>
                  <Button
                    type="primary"
                    danger
                    size="small"
                    onClick={() => handleUpdateLiveStatus(record, 3)}
                  >
                    拒绝
                  </Button>
                </>
              )}
              <Button
                type={record.auto_approve ? 'default' : 'primary'}
                size="small"
                icon={record.auto_approve ? <StopOutlined /> : <CheckCircleOutlined />}
                onClick={() => handleToggleAutoApprove(record)}
              >
                {record.auto_approve ? '需审核' : '免审核'}
              </Button>
              <Button
                type="primary"
                danger={!record.is_banned}
                size="small"
                ghost={record.is_banned}
                onClick={() => handleToggleBan(record)}
              >
                {record.is_banned ? '解除封禁' : '封禁'}
              </Button>
            </Space>
          )}
        />
      </Table>

      <Modal
        title={`封禁用户 - ${banningUser?.nickname || banningUser?.username || ''}`}
        open={banModalVisible}
        onOk={handleConfirmBan}
        onCancel={() => {
          setBanModalVisible(false)
          banForm.resetFields()
        }}
        destroyOnClose
      >
        <Form form={banForm} layout="vertical">
          <Form.Item
            label="封禁原因"
            name="reason"
            rules={[{ required: true, message: '请输入封禁原因' }]}
          >
            <Input.TextArea
              placeholder="请输入违规原因，用户尝试使用机器人时会看到此信息"
              rows={3}
            />
          </Form.Item>
        </Form>
      </Modal>

      {/* 🚨 已禁用：调整余额功能已移除 */}
      {/* <Modal
        title={`调整余额 - ${adjustingUser?.nickname || adjustingUser?.username || ''}`}
        open={adjustModalVisible}
        onOk={handleAdjustBalance}
        confirmLoading={isAdjusting}
        onCancel={() => {
          setAdjustModalVisible(false)
          adjustForm.resetFields()
        }}
        destroyOnClose
      >
        <Form form={adjustForm} layout="vertical">
          <Form.Item
            label="调整金额 (正数为增加，负数为减少)"
            name="amount"
            rules={[{ required: true, message: '请输入调整金额' }]}
          >
            <InputNumber
              style={{ width: '100%' }}
              placeholder="例如: 100 或 -50"
              precision={2}
              step={1}
            />
          </Form.Item>
          <Form.Item
            label="备注信息"
            name="description"
            rules={[{ required: true, message: '请输入调整理由' }]}
          >
            <Input.TextArea placeholder="请输入调整原因，将展示在用户流水中" rows={3} />
          </Form.Item>
        </Form>
      </Modal> */}
    </List>
  )
}
