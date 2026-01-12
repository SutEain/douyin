import { useShow, useUpdate } from '@refinedev/core'
import { Show } from '@refinedev/antd'
import {
  Card,
  Descriptions,
  Space,
  Button,
  Tag,
  Avatar,
  Modal,
  Form,
  Input,
  message,
  Row,
  Col
} from 'antd'
import { UserOutlined } from '@ant-design/icons'
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'

export const UserShow = () => {
  const navigate = useNavigate()
  const { queryResult } = useShow({
    resource: 'profiles'
  })
  const { data, isLoading } = queryResult
  const record = data?.data

  const { mutate: updateUser } = useUpdate()
  const [banModalOpen, setBanModalOpen] = useState(false)
  const [unbanModalOpen, setUnbanModalOpen] = useState(false)
  const [banForm] = Form.useForm()

  const handleBan = () => {
    setBanModalOpen(true)
  }

  const handleUnban = () => {
    setUnbanModalOpen(true)
  }

  const handleBanSubmit = async () => {
    try {
      const values = await banForm.validateFields()

      updateUser(
        {
          resource: 'profiles',
          id: record?.id || '',
          values: {
            is_banned: true,
            ban_reason: values.reason
          }
        },
        {
          onSuccess: () => {
            message.success('封禁成功')
            setBanModalOpen(false)
            banForm.resetFields()
            queryResult.refetch()
          },
          onError: (error: any) => {
            message.error(error?.message || '操作失败')
          }
        }
      )
    } catch (error) {
      // Validation failed
    }
  }

  const handleUnbanConfirm = () => {
    updateUser(
      {
        resource: 'profiles',
        id: record?.id || '',
        values: {
          is_banned: false,
          ban_reason: null
        }
      },
      {
        onSuccess: () => {
          message.success('解封成功')
          setUnbanModalOpen(false)
          queryResult.refetch()
        },
        onError: (error: any) => {
          message.error(error?.message || '操作失败')
        }
      }
    )
  }

  return (
    <>
      <Show
        isLoading={isLoading}
        title="用户详情"
        headerButtons={({ defaultButtons }) => (
          <>
            {defaultButtons}
            <Button onClick={() => navigate('/users')}>返回列表</Button>
          </>
        )}
        footerButtons={() => (
          <Space>
            {record?.is_banned ? (
              <Button type="primary" onClick={handleUnban}>
                解除封禁
              </Button>
            ) : (
              <Button danger onClick={handleBan}>
                封禁用户
              </Button>
            )}
          </Space>
        )}
      >
        <Row gutter={16}>
          <Col span={6}>
            <Card>
              <Space
                direction="vertical"
                style={{ width: '100%', textAlign: 'center' }}
                size="large"
              >
                {record?.avatar_url ? (
                  <Avatar src={record.avatar_url} size={120} />
                ) : (
                  <Avatar icon={<UserOutlined />} size={120} />
                )}
                <div>
                  <div style={{ fontSize: 18, fontWeight: 'bold', marginBottom: 8 }}>
                    {record?.nickname || record?.username || '未命名用户'}
                  </div>
                  <Tag color={record?.is_banned ? 'red' : 'green'}>
                    {record?.is_banned ? '已封禁' : '正常'}
                  </Tag>
                </div>
              </Space>
            </Card>
          </Col>

          <Col span={18}>
            <Card title="基本信息" style={{ marginBottom: 16 }}>
              <Descriptions column={2}>
                <Descriptions.Item label="昵称">{record?.nickname || '-'}</Descriptions.Item>
                <Descriptions.Item label="用户名">{record?.username || '-'}</Descriptions.Item>
                <Descriptions.Item label="数字ID">{record?.numeric_id || '-'}</Descriptions.Item>
                <Descriptions.Item label="性别">
                  {record?.gender === 'male' ? '男' : record?.gender === 'female' ? '女' : '未知'}
                </Descriptions.Item>
                <Descriptions.Item label="个人简介" span={2}>
                  {record?.bio || '-'}
                </Descriptions.Item>
              </Descriptions>
            </Card>

            <Card title="账户信息" style={{ marginBottom: 16 }}>
              <Descriptions column={2}>
                <Descriptions.Item label="余额">
                  {record?.balance_coins || 0} 抖币
                </Descriptions.Item>
                <Descriptions.Item label="冻结金额">
                  {record?.frozen_coins || 0} 抖币
                </Descriptions.Item>
                <Descriptions.Item label="视频数">{record?.video_count || 0}</Descriptions.Item>
                <Descriptions.Item label="粉丝数">{record?.follower_count || 0}</Descriptions.Item>
                <Descriptions.Item label="关注数">{record?.following_count || 0}</Descriptions.Item>
                <Descriptions.Item label="获赞数">{record?.total_likes || 0}</Descriptions.Item>
              </Descriptions>
            </Card>

            <Card title="账号状态">
              <Descriptions column={1}>
                <Descriptions.Item label="封禁状态">
                  <Tag color={record?.is_banned ? 'red' : 'green'}>
                    {record?.is_banned ? '已封禁' : '正常'}
                  </Tag>
                </Descriptions.Item>
                {record?.is_banned && record?.ban_reason && (
                  <Descriptions.Item label="封禁原因">{record.ban_reason}</Descriptions.Item>
                )}
                <Descriptions.Item label="管理员">
                  <Tag color={record?.is_admin ? 'blue' : 'default'}>
                    {record?.is_admin ? '是' : '否'}
                  </Tag>
                </Descriptions.Item>
                <Descriptions.Item label="审核员">
                  <Tag color={record?.is_reviewer ? 'blue' : 'default'}>
                    {record?.is_reviewer ? '是' : '否'}
                  </Tag>
                </Descriptions.Item>
                <Descriptions.Item label="注册时间">
                  {record?.created_at ? new Date(record.created_at).toLocaleString('zh-CN') : '-'}
                </Descriptions.Item>
                <Descriptions.Item label="最后活跃">
                  {record?.last_active_at
                    ? new Date(record.last_active_at).toLocaleString('zh-CN')
                    : '-'}
                </Descriptions.Item>
              </Descriptions>
            </Card>
          </Col>
        </Row>
      </Show>

      <Modal
        title="封禁用户"
        open={banModalOpen}
        onOk={handleBanSubmit}
        onCancel={() => {
          setBanModalOpen(false)
          banForm.resetFields()
        }}
        okText="确认封禁"
        okButtonProps={{ danger: true }}
      >
        <Form form={banForm} layout="vertical">
          <Form.Item
            name="reason"
            label="封禁原因"
            rules={[{ required: true, message: '请输入封禁原因' }]}
          >
            <Input.TextArea rows={4} placeholder="请输入封禁原因" />
          </Form.Item>
        </Form>
        <p style={{ color: '#ff4d4f', marginTop: 16 }}>
          ⚠️ 警告：封禁后该用户将无法登录和使用平台功能
        </p>
      </Modal>

      <Modal
        title="解除封禁"
        open={unbanModalOpen}
        onOk={handleUnbanConfirm}
        onCancel={() => setUnbanModalOpen(false)}
        okText="确认解封"
      >
        <p>确定要解除该用户的封禁状态吗？</p>
        {record?.ban_reason && (
          <p style={{ marginTop: 16 }}>
            <strong>原封禁原因：</strong>
            {record.ban_reason}
          </p>
        )}
      </Modal>
    </>
  )
}
