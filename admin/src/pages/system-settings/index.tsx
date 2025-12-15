import { Card, Form, InputNumber, Button, message, Typography } from 'antd'
import { useEffect, useState } from 'react'
import { supabaseClient } from '../../supabaseClient'

export const SystemSettings = () => {
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [form] = Form.useForm()

  async function load() {
    setLoading(true)
    try {
      const { data, error } = await supabaseClient
        .from('system_settings')
        .select('value_int')
        .eq('id', 'bot_max_video_size_mb')
        .maybeSingle()

      if (error) {
        console.error('[SystemSettings] load error:', error)
        message.error('加载失败：无权限或系统错误')
        return
      }

      const mb = Number(data?.value_int)
      form.setFieldsValue({ bot_max_video_size_mb: Number.isFinite(mb) && mb > 0 ? mb : 200 })
    } finally {
      setLoading(false)
    }
  }

  async function save() {
    const values = await form.validateFields()
    setSaving(true)
    try {
      const mb = Number(values.bot_max_video_size_mb)
      const { error } = await supabaseClient.from('system_settings').upsert(
        {
          id: 'bot_max_video_size_mb',
          value_int: mb,
          value_text: 'Bot 单视频最大大小（MiB）'
        },
        { onConflict: 'id' }
      )

      if (error) {
        console.error('[SystemSettings] save error:', error)
        message.error('保存失败：无权限或系统错误')
        return
      }

      message.success('已保存')
    } finally {
      setSaving(false)
    }
  }

  useEffect(() => {
    load()
  }, [])

  return (
    <Card
      title="系统设置"
      extra={
        <Button onClick={() => load()} disabled={loading || saving}>
          刷新
        </Button>
      }
    >
      <Typography.Paragraph type="secondary" style={{ marginTop: 0 }}>
        Bot 上传限制会实时生效（约 60 秒缓存）。仅限制视频，不影响图片/相册。
      </Typography.Paragraph>

      <Form form={form} layout="vertical" disabled={loading}>
        <Form.Item
          label="Bot 单视频最大大小（MiB）"
          name="bot_max_video_size_mb"
          rules={[
            { required: true, message: '请输入限制值' },
            {
              validator: async (_, v) => {
                const n = Number(v)
                if (!Number.isFinite(n) || n <= 0) throw new Error('必须是大于 0 的数字')
              }
            }
          ]}
        >
          <InputNumber min={1} max={5000} precision={0} style={{ width: 260 }} />
        </Form.Item>

        <Button type="primary" onClick={save} loading={saving}>
          保存
        </Button>
      </Form>
    </Card>
  )
}
