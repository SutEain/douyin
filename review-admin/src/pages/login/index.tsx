import { useLogin } from '@refinedev/core'
import { Form, Input, Button, Card, Typography, message } from 'antd'
import { UserOutlined, LockOutlined } from '@ant-design/icons'
import { useState } from 'react'

const { Title, Text } = Typography

export const Login = () => {
  const { mutate: login } = useLogin()
  const [loading, setLoading] = useState(false)

  const onFinish = (values: any) => {
    setLoading(true)
    // 转换用户名为邮箱格式
    const email = `${values.username}@review.local`
    login(
      { email, password: values.password },
      {
        onSuccess: () => {
          message.success('登录成功')
        },
        onError: (error: any) => {
          message.error(error?.message || '登录失败')
          setLoading(false)
        }
      }
    )
  }

  return (
    <div
      style={{
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
        minHeight: '100vh',
        background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)'
      }}
    >
      <Card
        style={{
          width: 400,
          boxShadow: '0 4px 20px rgba(0,0,0,0.1)',
          borderRadius: 8
        }}
      >
        <div style={{ textAlign: 'center', marginBottom: 32 }}>
          <Title level={2} style={{ marginBottom: 8 }}>
            审核后台
          </Title>
          <Text type="secondary">请使用审核员账号登录</Text>
        </div>

        <Form name="login" onFinish={onFinish} size="large">
          <Form.Item name="username" rules={[{ required: true, message: '请输入用户名' }]}>
            <Input prefix={<UserOutlined />} placeholder="用户名" />
          </Form.Item>

          <Form.Item name="password" rules={[{ required: true, message: '请输入密码' }]}>
            <Input.Password prefix={<LockOutlined />} placeholder="密码" />
          </Form.Item>

          <Form.Item style={{ marginBottom: 0 }}>
            <Button type="primary" htmlType="submit" loading={loading} block>
              登录
            </Button>
          </Form.Item>
        </Form>

        <div style={{ marginTop: 16, textAlign: 'center' }}>
          <Text type="secondary" style={{ fontSize: 12 }}>
            审核员账号：shenhe1 / shenhe2 / shenhe3
          </Text>
        </div>
      </Card>
    </div>
  )
}
