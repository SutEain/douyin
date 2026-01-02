import { List } from '@refinedev/antd'
import {
  Form,
  Input,
  Button,
  Card,
  Descriptions,
  message,
  Modal,
  Typography,
  Divider,
  Statistic,
  Row,
  Col
} from 'antd'
import { SwapOutlined, SearchOutlined, SafetyCertificateOutlined } from '@ant-design/icons'
import { useState } from 'react'
import { supabaseClient } from '../../supabaseClient'

const { Title, Text } = Typography

export const InheritancePage = () => {
  const [form] = Form.useForm()
  const [loading, setLoading] = useState(false)
  const [previewData, setPreviewData] = useState<any>(null)
  const [isExecuting, setIsExecuting] = useState(false)

  // 1. 查询预览信息
  const handlePreview = async () => {
    try {
      const values = await form.validateFields()
      setLoading(true)
      setPreviewData(null)

      const { data, error } = await supabaseClient.rpc('get_inheritance_preview', {
        p_from_numeric_id: values.from_id,
        p_to_numeric_id: values.to_id
      })

      if (error) throw error

      if (!data || data.length === 0) {
        message.error('未找到对应账号，请检查数字ID是否正确')
        return
      }

      setPreviewData(data[0])
    } catch (err: any) {
      message.error(err.message || '查询失败')
    } finally {
      setLoading(false)
    }
  }

  // 2. 执行继承操作
  const handleExecute = () => {
    if (!previewData) return

    Modal.confirm({
      title: '🛑 核心安全警告',
      icon: <SafetyCertificateOutlined style={{ color: '#ff4d4f' }} />,
      content: (
        <div>
          <p>
            您正在执行<b>资产全量继承</b>操作，此操作不可逆！
          </p>
          <p>
            源账号：
            <Text code>
              {previewData.from_nickname} ({form.getFieldValue('from_id')})
            </Text>
          </p>
          <p>
            目标账号：
            <Text code>
              {previewData.to_nickname} ({form.getFieldValue('to_id')})
            </Text>
          </p>
          <Divider />
          <p>
            确认要将 <b>{previewData.balance_coins}</b> 抖币和 <b>{previewData.video_count}</b>{' '}
            个作品迁移吗？
          </p>
        </div>
      ),
      okText: '确认迁移',
      okType: 'danger',
      cancelText: '取消',
      onOk: async () => {
        try {
          setIsExecuting(true)
          const { data, error } = await supabaseClient.rpc('admin_execute_inheritance', {
            p_from_numeric_id: form.getFieldValue('from_id'),
            p_to_numeric_id: form.getFieldValue('to_id')
          })

          if (error) throw error

          message.success(
            `迁移成功！共迁移 ${data.transferred_balance} 抖币和 ${data.transferred_videos} 个作品`
          )
          setPreviewData(null)
          form.resetFields()
        } catch (err: any) {
          message.error(err.message || '迁移失败')
        } finally {
          setIsExecuting(false)
        }
      }
    })
  }

  return (
    <List title="资产继承 (作品与抖币迁移)">
      <Card style={{ maxWidth: 800, margin: '0 auto' }}>
        <Title level={4}>第一步：输入账号数字ID</Title>
        <Form form={form} layout="vertical" onFinish={handlePreview}>
          <Row gutter={24}>
            <Col span={11}>
              <Form.Item
                name="from_id"
                label="源账号 (被继承者)"
                rules={[{ required: true, message: '请输入源账号数字ID' }]}
              >
                <Input placeholder="输入旧账号数字ID" size="large" />
              </Form.Item>
            </Col>
            <Col
              span={2}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                paddingTop: 24
              }}
            >
              <SwapOutlined style={{ fontSize: 24, color: '#1890ff' }} />
            </Col>
            <Col span={11}>
              <Form.Item
                name="to_id"
                label="新账号 (继承者)"
                rules={[{ required: true, message: '请输入新账号数字ID' }]}
              >
                <Input placeholder="输入新账号数字ID" size="large" />
              </Form.Item>
            </Col>
          </Row>
          <Form.Item>
            <Button
              type="primary"
              icon={<SearchOutlined />}
              onClick={handlePreview}
              loading={loading}
              block
              size="large"
            >
              查询资产详情
            </Button>
          </Form.Item>
        </Form>

        {previewData && (
          <div
            style={{
              marginTop: 32,
              padding: '24px',
              background: '#fafafa',
              borderRadius: '8px',
              border: '1px solid #f0f0f0'
            }}
          >
            <Title level={4}>第二步：核对待迁移资产</Title>
            <Row gutter={16}>
              <Col span={12}>
                <Statistic
                  title="待转移抖币"
                  value={previewData.balance_coins}
                  precision={2}
                  suffix="抖币"
                  valueStyle={{ color: '#cf1322' }}
                />
              </Col>
              <Col span={12}>
                <Statistic title="待转移作品数" value={previewData.video_count} suffix="个" />
              </Col>
            </Row>

            <Divider />

            <Descriptions bordered size="small" column={1}>
              <Descriptions.Item label="源账号信息">
                <Text strong>{previewData.from_nickname}</Text> (ID: {form.getFieldValue('from_id')}
                )
              </Descriptions.Item>
              <Descriptions.Item label="目标账号信息">
                <Text strong>{previewData.to_nickname}</Text> (ID: {form.getFieldValue('to_id')})
              </Descriptions.Item>
            </Descriptions>

            <Button
              type="primary"
              danger
              block
              size="large"
              style={{ marginTop: 24 }}
              onClick={handleExecute}
              loading={isExecuting}
              icon={<SafetyCertificateOutlined />}
            >
              确认执行资产继承
            </Button>
            <p style={{ textAlign: 'center', color: '#999', marginTop: 12 }}>
              ⚠️ 注意：执行后源账号资产将清零，作品归属权将永久变更。
            </p>
          </div>
        )}
      </Card>
    </List>
  )
}
