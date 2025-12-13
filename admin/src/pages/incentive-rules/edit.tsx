import { Edit, useForm } from '@refinedev/antd'
import { DatePicker, Form, Input, InputNumber, Select, Switch } from 'antd'
import { useParams } from 'react-router-dom'

export const IncentiveRuleEdit = () => {
  const { id } = useParams<{ id: string }>()

  const { formProps, saveButtonProps, form } = useForm({
    resource: 'incentive_rules',
    action: 'edit',
    id,
    redirect: 'list'
  })

  return (
    <Edit saveButtonProps={saveButtonProps}>
      <Form {...formProps} layout="vertical">
        <Form.Item
          label="规则名称"
          name="name"
          rules={[{ required: true, message: '请输入规则名称' }]}
        >
          <Input />
        </Form.Item>

        <Form.Item label="规则 Code（唯一）" name="code">
          <Input disabled style={{ backgroundColor: '#f5f5f5' }} />
        </Form.Item>

        <Form.Item label="描述" name="description">
          <Input.TextArea rows={3} />
        </Form.Item>

        <Form.Item
          label="规则类型"
          name="rule_type"
          rules={[{ required: true, message: '请选择规则类型' }]}
        >
          <Select>
            <Select.Option value="video_like_threshold">单作品达标</Select.Option>
            <Select.Option value="invite_success">邀请成功</Select.Option>
            <Select.Option value="invitee_publish">徒弟发布</Select.Option>
          </Select>
        </Form.Item>

        <Form.Item label="Scope" name="scope">
          <Select>
            <Select.Option value="video">video</Select.Option>
            <Select.Option value="user">user</Select.Option>
          </Select>
        </Form.Item>

        <Form.Item shouldUpdate>
          {() => {
            const rt = form?.getFieldValue('rule_type')
            if (rt !== 'video_like_threshold') return null
            return (
              <>
                <Form.Item label="指标(metric)" name="metric">
                  <Select>
                    <Select.Option value="like_count">like_count</Select.Option>
                    <Select.Option value="view_count">view_count</Select.Option>
                  </Select>
                </Form.Item>
                <Form.Item
                  label="阈值(threshold)"
                  name="threshold"
                  rules={[{ required: true, message: '请输入阈值' }]}
                >
                  <InputNumber min={1} style={{ width: '100%' }} />
                </Form.Item>
              </>
            )
          }}
        </Form.Item>

        <Form.Item
          label="奖励(USDT)"
          name="reward_usdt"
          rules={[{ required: true, message: '请输入奖励金额' }]}
        >
          <InputNumber min={0} step="0.000001" stringMode style={{ width: '100%' }} />
        </Form.Item>

        <Form.Item shouldUpdate>
          {() => {
            const rt = form?.getFieldValue('rule_type')
            if (rt !== 'invitee_publish') return null
            return (
              <Form.Item
                label="上限次数(cap_count)"
                name="cap_count"
                rules={[{ required: true, message: '请输入上限' }]}
              >
                <InputNumber min={1} style={{ width: '100%' }} />
              </Form.Item>
            )
          }}
        </Form.Item>

        <Form.Item label="窗口(cap_window)" name="cap_window">
          <Select>
            <Select.Option value="lifetime">lifetime</Select.Option>
            <Select.Option value="daily">daily</Select.Option>
          </Select>
        </Form.Item>

        <Form.Item label="启用" name="is_active" valuePropName="checked">
          <Switch checkedChildren="启用" unCheckedChildren="禁用" />
        </Form.Item>

        <Form.Item label="排序(sort_order)" name="sort_order">
          <InputNumber style={{ width: '100%' }} />
        </Form.Item>

        <Form.Item label="活动开始时间(start_at)" name="start_at">
          <DatePicker showTime style={{ width: '100%' }} />
        </Form.Item>
        <Form.Item label="活动结束时间(end_at)" name="end_at">
          <DatePicker showTime style={{ width: '100%' }} />
        </Form.Item>
      </Form>
    </Edit>
  )
}
