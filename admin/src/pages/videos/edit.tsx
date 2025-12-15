import { Edit, useForm } from '@refinedev/antd'
import { useOne } from '@refinedev/core'
import { Form, Input, Select, Tag, Spin, Switch } from 'antd'
import { useParams, useNavigate } from 'react-router-dom'
import { useEffect } from 'react'
import { supabaseClient } from '../../supabaseClient'

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

type VideoRecord = {
  id: string
  description?: string
  tags?: string[]
  status?: string
  review_status?: string
  reject_reason?: string
  is_adult?: boolean
  is_shortdrama?: boolean
  is_private?: boolean
  is_recommended?: boolean
  is_top?: boolean
  location_country?: string
  location_city?: string
  author_id?: string
  created_at?: string
  like_count?: number
  view_count?: number
  collect_count?: number
  comment_count?: number
  play_url?: string
}

type FormValues = Omit<VideoRecord, 'tags'> & { tags?: string | string[] }

export const VideoEdit = () => {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()

  console.log('[VideoEdit] URL中的ID:', id)

  // 手动获取数据
  const { query } = useOne<VideoRecord>({
    resource: 'videos',
    id: id!
  })

  const { data, isLoading } = query
  const videoData = data?.data as VideoRecord | undefined

  console.log('[VideoEdit] 获取到的数据:', videoData)

  const { formProps, saveButtonProps, form } = useForm<VideoRecord, any, FormValues>({
    resource: 'videos',
    action: 'edit',
    id: id,
    redirect: false,
    onMutationSuccess: async () => {
      // 🎯 避免后台小范围编辑把已发布视频打回待审核
      if (videoData && form) {
        const values = form.getFieldsValue() as FormValues
        const originalStatus = videoData.status
        const originalReviewStatus = videoData.review_status

        // 仅当原本是已发布+已通过，并且表单中没有修改状态字段时，才进行修正
        if (
          originalStatus === 'published' &&
          originalReviewStatus === 'approved' &&
          values.status === originalStatus &&
          values.review_status === originalReviewStatus
        ) {
          try {
            await supabaseClient
              .from('videos')
              .update({
                status: originalStatus,
                review_status: originalReviewStatus
              })
              .eq('id', videoData.id)
          } catch (error) {
            // 不中断主流程，仅做日志
            console.error('[VideoEdit] 恢复审核状态失败:', error)
          }
        }
      }

      navigate('/videos')
    }
  })

  // 当数据加载完成后，设置表单值
  useEffect(() => {
    if (videoData && form) {
      console.log('[VideoEdit] 设置表单值:', videoData)
      form.setFieldsValue({
        description: videoData.description,
        // 标签：用空格拼接
        tags: Array.isArray(videoData.tags) ? videoData.tags.join(' ') : '',
        status: videoData.status,
        review_status: videoData.review_status,
        reject_reason: videoData.reject_reason,
        is_adult: videoData.is_adult,
        is_shortdrama: videoData.is_shortdrama,
        is_private: videoData.is_private,
        is_recommended: videoData.is_recommended,
        is_top: videoData.is_top,
        location_country: videoData.location_country,
        location_city: videoData.location_city
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
      <Form
        {...formProps}
        layout="vertical"
        onFinish={(values: FormValues) => {
          // 🔧 将标签从自由文本转换为数组（用空格分隔）
          const tagsString = (values.tags || '') as string
          const tagsArray =
            tagsString
              .trim()
              .split(/\s+/)
              .filter((t) => !!t) || []

          const payload = {
            ...values,
            tags: tagsArray
          }

          if (formProps.onFinish) {
            formProps.onFinish(payload)
          }
        }}
      >
        <Form.Item label="描述" name="description">
          <Input.TextArea rows={4} placeholder="视频描述" maxLength={500} showCount />
        </Form.Item>

        <Form.Item label="标签" name="tags">
          <Input.TextArea
            rows={3}
            placeholder="自由输入，用空格分隔多个标签（例：搞笑 美食 旅游）"
            maxLength={300}
            showCount
          />
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

        <Form.Item label="成人内容" name="is_adult" valuePropName="checked">
          <Switch checkedChildren="成人" unCheckedChildren="普通" />
        </Form.Item>

        <Form.Item label="短剧" name="is_shortdrama" valuePropName="checked">
          <Switch checkedChildren="短剧" unCheckedChildren="非短剧" />
        </Form.Item>

        <Form.Item label="公开/私密" name="is_private" valuePropName="checked">
          <Switch checkedChildren="私密" unCheckedChildren="公开" />
        </Form.Item>

        <Form.Item label="加入推荐池" name="is_recommended" valuePropName="checked">
          <Switch checkedChildren="推荐" unCheckedChildren="未推荐" />
        </Form.Item>

        <Form.Item label="作者主页置顶" name="is_top" valuePropName="checked">
          <Switch checkedChildren="置顶" unCheckedChildren="普通" />
        </Form.Item>

        <Form.Item label="国家" name="location_country">
          <Input placeholder="例如：中国、日本、美国" />
        </Form.Item>

        <Form.Item label="城市" name="location_city">
          <Input placeholder="例如：北京、东京、纽约" />
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
              <strong>创建时间:</strong>{' '}
              {videoData.created_at ? new Date(videoData.created_at).toLocaleString('zh-CN') : '-'}
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
