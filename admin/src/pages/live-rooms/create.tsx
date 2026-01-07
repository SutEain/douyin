import { Create, useForm } from '@refinedev/antd'
import { Form, Input, Upload, Button, message, Image, InputNumber, Switch } from 'antd'
import type { UploadProps } from 'antd'
import { supabaseClient } from '../../supabaseClient'

export const LiveRoomCreate = () => {
  const { formProps, saveButtonProps, form } = useForm({
    resource: 'live_rooms',
    action: 'create',
    redirect: 'list'
  })

  const BUCKET = 'live-covers'

  const uploadProps: UploadProps = {
    accept: 'image/*',
    maxCount: 1,
    showUploadList: false,
    beforeUpload: async (file) => {
      try {
        const ext = (file.name.split('.').pop() || 'jpg').toLowerCase()
        // 🎯 安全优化：禁止上传 SVG 等可能包含恶意脚本的文件
        const forbiddenExts = ['svg', 'html', 'htm', 'xml']
        if (
          forbiddenExts.includes(ext) ||
          file.type.includes('svg') ||
          file.type.includes('html')
        ) {
          message.error('不支持的文件格式，严禁上传 SVG 或 HTML 文件')
          return Upload.LIST_IGNORE
        }

        const key = `covers/${
          typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
            ? crypto.randomUUID()
            : Math.random().toString(36).slice(2) + Date.now().toString(36)
        }.${ext}`

        const { error } = await supabaseClient.storage.from(BUCKET).upload(key, file, {
          upsert: true,
          contentType: file.type || undefined
        })
        if (error) {
          console.error('[LiveRoomCreate] upload failed:', error)
          message.error('封面上传失败')
          return Upload.LIST_IGNORE
        }

        const { data } = supabaseClient.storage.from(BUCKET).getPublicUrl(key)
        const url = data?.publicUrl
        if (!url) {
          message.error('获取封面URL失败')
          return Upload.LIST_IGNORE
        }

        form?.setFieldsValue({ cover_url: url })
        message.success('封面已上传')
      } catch (e) {
        console.error('[LiveRoomCreate] upload exception:', e)
        message.error('封面上传失败')
      }
      return Upload.LIST_IGNORE
    }
  }

  return (
    <Create saveButtonProps={saveButtonProps} title="新增直播间">
      <Form {...formProps} layout="vertical">
        <Form.Item
          label="直播地址(stream_url)"
          name="stream_url"
          initialValue="https://live.nofu.ai/douyin/rid/"
          rules={[{ required: true, message: '请输入直播地址' }]}
        >
          <Input placeholder="例如：https://live.nofu.ai/douyin/rid/921169302662?stream=hls" />
        </Form.Item>

        <Form.Item label="标题(title)" name="title">
          <Input placeholder="前端展示标题（可选）" />
        </Form.Item>

        <Form.Item label="描述(description)" name="description">
          <Input placeholder="列表副标题（可选）" />
        </Form.Item>

        <Form.Item label="类别(category)" name="category">
          <Input placeholder="待用（可选）" />
        </Form.Item>

        <Form.Item label="排序(sort_order)" name="sort_order" initialValue={0}>
          <InputNumber style={{ width: '100%' }} />
        </Form.Item>

        <Form.Item
          label="启用(is_active)"
          name="is_active"
          valuePropName="checked"
          initialValue={true}
        >
          <Switch checkedChildren="启用" unCheckedChildren="停用" />
        </Form.Item>

        <Form.Item label="封面URL(cover_url)" name="cover_url">
          <Input placeholder="上传后自动填充" readOnly />
        </Form.Item>

        <Form.Item label="封面上传">
          <Upload {...uploadProps}>
            <Button>上传封面</Button>
          </Upload>
        </Form.Item>

        <Form.Item shouldUpdate noStyle>
          {() => {
            const url = form?.getFieldValue('cover_url')
            if (!url) return null
            return (
              <div style={{ marginTop: 8 }}>
                <Image
                  src={url}
                  width={240}
                  height={135}
                  style={{ objectFit: 'cover', borderRadius: 8 }}
                  preview
                />
              </div>
            )
          }}
        </Form.Item>
      </Form>
    </Create>
  )
}
