import { useLogin } from '@refinedev/core'
import { Form, Input, Button, Card, Layout, Typography, message } from 'antd'
import { UserOutlined, LockOutlined } from '@ant-design/icons'

const { Content } = Layout
const { Title } = Typography

export const Login = () => {
  const { mutate: login, isLoading } = useLogin()

  const onFinish = (values: any) => {
    login(values, {
      onError: (error) => {
        message.error(error.message || '登录失败，请检查账号密码')
      }
    })
  }

  return (
    <Layout style={{ height: '100vh', background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)' }}>
      <Content style={{ display: 'flex', justifyContent: 'center', alignItems: 'center' }}>
        <Card style={{ width: 400, boxShadow: '0 8px 24px rgba(0,0,0,0.15)', borderRadius: 12 }}>
          <div style={{ textAlign: 'center', marginBottom: 24 }}>
            <Title level={2}>审核后台</Title>
            <Typography.Text type="secondary">请使用审核员账号登录</Typography.Text>
          </div>
          <Form name="login" onFinish={onFinish} size="large" layout="vertical">
            <Form.Item
              name="email"
              rules={[{ required: true, message: '请输入邮箱' }, { type: 'email', message: '邮箱格式不正确' }]}
            >
              <Input prefix={<UserOutlined />} placeholder="用户名/邮箱" />
            </Form.Item>
            <Form.Item
              name="password"
              rules={[{ required: true, message: '请输入密码' }]}
            >
              <Input.Password prefix={<LockOutlined />} placeholder="密码" />
            </Form.Item>
            <Form.Item>
              <Button type="primary" htmlType="submit" loading={isLoading} block style={{ height: 45, borderRadius: 8 }}>
                登 录
              </Button>
            </Form.Item>
            <div style={{ textAlign: 'center', fontSize: 12, color: '#999' }}>
              审核员账号: shenhe1 / shenhe2 / shenhe3
            </div>
          </Form>
        </Card>
      </Content>
    </Layout>
  )
}

