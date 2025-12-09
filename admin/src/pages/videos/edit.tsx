import { Edit, useForm } from '@refinedev/antd'
import { useOne } from '@refinedev/core'
import { Form, Input, Select, Tag, Spin } from 'antd'
import { useParams, useNavigate } from 'react-router-dom'
import { useEffect } from 'react'

const statusOptions = [
  { value: 'draft', label: '草稿', color: 'default' },
  { value: 'processing', label: '处理中', color: 'processing' },
  { value: 'ready', label: '就绪', color: 'cyan' },
  { value: 'published', label: '已发布', color: 'success' },
  { value: 'failed', label: '失败', color: 'error' }
]

const reviewStatusOptions = [
  { value: 'pending', label: '待审核', color: 'warning' },
  { value: 'auto_approved', label: '自动通过', color: 'success' },
  { value: 'manual_review', label: '人工审核中', color: 'processing' },
  { value: 'approved', label: '已通过', color: 'success' },
  { value: 'rejected', label: '已拒绝', color: 'error' },
  { value: 'appealing', label: '申诉中', color: 'orange' }
]

export const VideoEdit = () => {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()

  console.log('[VideoEdit] URL中的ID:', id)

  // 手动获取数据
  const { data, isLoading } = useOne({
    resource: 'videos',
    id: id!
  })

  const videoData = data?.data

  console.log('[VideoEdit] 获取到的数据:', videoData)

  const { formProps, saveButtonProps, form } = useForm({
    resource: 'videos',
    action: 'edit',
    id: id,
    redirect: false,
    onMutationSuccess: () => {
      navigate('/videos')
    }
  })

  // 当数据加载完成后，设置表单值
  useEffect(() => {
    if (videoData && form) {
      console.log('[VideoEdit] 设置表单值:', videoData)
      form.setFieldsValue({
        description: videoData.description,
        status: videoData.status,
        review_status: videoData.review_status,
        reject_reason: videoData.reject_reason
      })
    }
  }, [videoData, form])

  if (isLoading) {
    return (
      <div style={{ textAlign: 'center', padding: '50px' }}>
        <Spin size="large" />
      </div>
    )
  }

  return (
    <Edit saveButtonProps={saveButtonProps} isLoading={isLoading}>
      <Form {...formProps} layout="vertical">
        <Form.Item label="描述" name="description">
          <Input.TextArea rows={4} placeholder="视频描述" maxLength={500} showCount />
        </Form.Item>

        <Form.Item label="状态" name="status">
          <Select>
            {statusOptions.map((opt) => (
              <Select.Option key={opt.value} value={opt.value}>
                <Tag color={opt.color}>{opt.label}</Tag>
              </Select.Option>
            ))}
          </Select>
        </Form.Item>

        <Form.Item label="审核状态" name="review_status">
          <Select>
            {reviewStatusOptions.map((opt) => (
              <Select.Option key={opt.value} value={opt.value}>
                <Tag color={opt.color}>{opt.label}</Tag>
              </Select.Option>
            ))}
          </Select>
        </Form.Item>

        <Form.Item label="拒绝理由" name="reject_reason">
          <Input.TextArea rows={3} placeholder="如果审核状态为已拒绝，请填写拒绝理由" />
        </Form.Item>

        {videoData && (
          <div style={{ marginTop: 16, padding: 16, background: '#f5f5f5', borderRadius: 4 }}>
            <h4>视频信息</h4>
            <p>
              <strong>视频ID:</strong> {videoData.id}
            </p>
            <p>
              <strong>作者ID:</strong> {videoData.author_id}
            </p>
            <p>
              <strong>创建时间:</strong> {new Date(videoData.created_at).toLocaleString('zh-CN')}
            </p>
            <p>
              <strong>点赞数:</strong> {videoData.like_count || 0}
            </p>
            <p>
              <strong>浏览数:</strong> {videoData.view_count || 0}
            </p>
            <p>
              <strong>收藏数:</strong> {videoData.collect_count || 0}
            </p>
            <p>
              <strong>评论数:</strong> {videoData.comment_count || 0}
            </p>
          </div>
        )}
      </Form>
    </Edit>
  )
}
