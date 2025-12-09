import { Edit, useForm } from '@refinedev/antd'
import { Form, Input } from 'antd'

export const UserEdit = () => {
  const { formProps, saveButtonProps } = useForm({ resource: 'profiles' })

  return (
    <Edit saveButtonProps={saveButtonProps}>
      <Form {...formProps} layout="vertical">
        <Form.Item label="昵称" name="nickname">
          <Input />
        </Form.Item>
        <Form.Item label="用户名" name="username">
          <Input />
        </Form.Item>
        <Form.Item label="简介" name="bio">
          <Input.TextArea rows={4} />
        </Form.Item>
      </Form>
    </Edit>
  )
}
