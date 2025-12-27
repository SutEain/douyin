import { Card, Form, InputNumber, Button, message, Typography, Input } from 'antd'
import { useEffect, useState } from 'react'
import { supabaseClient } from '../../supabaseClient'

export const SystemSettings = () => {
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [form] = Form.useForm()

  async function load() {
    setLoading(true)
    try {
      const { data, error } = await supabaseClient.from('system_settings').select('*')

      if (error) {
        console.error('[SystemSettings] load error:', error)
        message.error('加载失败：无权限或系统错误')
        return
      }

      const settings: any = {}
      data?.forEach((item) => {
        settings[item.id] = {
          int: item.value_int,
          text: item.value_text
        }
      })

      form.setFieldsValue({
        bot_max_video_size_mb: settings.bot_max_video_size_mb?.int || 500,
        invitation_reward_coins: settings.invitation_reward_coins?.int || 10,
        gift_split_percentage: settings.gift_split_percentage?.int || 50,
        recharge_trc20_address: settings.recharge_trc20_address?.text || ''
      })
    } finally {
      setLoading(false)
    }
  }

  async function save() {
    const values = await form.validateFields()
    setSaving(true)
    try {
      const payloads = [
        {
          id: 'bot_max_video_size_mb',
          value_int: Number(values.bot_max_video_size_mb),
          value_text: 'Bot 单视频最大大小（MiB）'
        },
        {
          id: 'invitation_reward_coins',
          value_int: Number(values.invitation_reward_coins),
          value_text: '成功邀请新用户奖励（抖币）'
        },
        {
          id: 'gift_split_percentage',
          value_int: Number(values.gift_split_percentage),
          value_text: '打赏分账比例（百分比，如50代表主播得50%）'
        },
        {
          id: 'recharge_trc20_address',
          value_int: null,
          value_text: values.recharge_trc20_address
        }
      ]

      const { error } = await supabaseClient
        .from('system_settings')
        .upsert(payloads, { onConflict: 'id' })

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

        <Form.Item
          label="成功邀请新用户奖励（抖币）"
          name="invitation_reward_coins"
          rules={[{ required: true, message: '请输入奖励金额' }]}
        >
          <InputNumber min={0} precision={0} style={{ width: 260 }} />
        </Form.Item>

        <Form.Item
          label="打赏分账比例（主播获得比例，单位：%）"
          name="gift_split_percentage"
          rules={[{ required: true, message: '请输入分账比例' }]}
          help="设置主播实际获得的比例。例如设为 50，则主播获得打赏金额的 50%，剩下 50% 归平台。"
        >
          <InputNumber min={0} max={100} precision={0} style={{ width: 260 }} addonAfter="%" />
        </Form.Item>

        <Form.Item
          label="TRC20 充值收款地址"
          name="recharge_trc20_address"
          rules={[{ required: true, message: '请输入收款地址' }]}
          help="用户在 Bot 中点击充值下单时显示的 TRC20 收款地址。"
        >
          <Input placeholder="请输入 TRC20 地址" style={{ width: 400 }} />
        </Form.Item>

        <Button type="primary" onClick={save} loading={saving}>
          保存
        </Button>
      </Form>
    </Card>
  )
}
