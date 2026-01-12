import { useShow, useUpdate } from '@refinedev/core'
import { Show } from '@refinedev/antd'
import {
  Card,
  Descriptions,
  Space,
  Button,
  Tag,
  Image,
  Modal,
  Form,
  Input,
  Radio,
  message,
  Row,
  Col
} from 'antd'
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'

export const VideoShow = () => {
  const navigate = useNavigate()
  const { queryResult } = useShow({
    meta: {
      select:
        '*, author:profiles!videos_author_id_fkey(id, nickname, username, numeric_id, avatar_url)'
    }
  })
  const { data, isLoading } = queryResult
  const record = data?.data

  const { mutate: updateVideo } = useUpdate()
  const [reviewModalOpen, setReviewModalOpen] = useState(false)
  const [reviewForm] = Form.useForm()

  const handleReview = (action: 'approve' | 'reject' | 'flag') => {
    reviewForm.setFieldsValue({ action })
    setReviewModalOpen(true)
  }

  const handleReviewSubmit = async () => {
    try {
      const values = await reviewForm.validateFields()

      const updates: any = {}

      if (values.action === 'approve') {
        updates.review_status = 'approved'
      } else if (values.action === 'reject') {
        updates.review_status = 'rejected'
      } else if (values.action === 'flag') {
        updates.review_status = 'flagged'
      }

      if (values.is_adult !== undefined) {
        updates.is_adult = values.is_adult
      }

      if (values.reason) {
        updates.review_note = values.reason
      }

      updateVideo(
        {
          resource: 'videos',
          id: record?.id || '',
          values: updates
        },
        {
          onSuccess: () => {
            message.success('审核操作成功')
            setReviewModalOpen(false)
            reviewForm.resetFields()
            queryResult.refetch()
          },
          onError: (error: any) => {
            message.error(error?.message || '操作失败')
          }
        }
      )
    } catch (error) {
      // Validation failed
    }
  }

  const getReviewStatusTag = (status: string) => {
    const statusMap: Record<string, { color: string; text: string }> = {
      pending: { color: 'orange', text: '待审核' },
      approved: { color: 'green', text: '已通过' },
      rejected: { color: 'red', text: '已拒绝' },
      flagged: { color: 'volcano', text: '已标记' }
    }
    const s = statusMap[status] || { color: 'default', text: status }
    return <Tag color={s.color}>{s.text}</Tag>
  }

  return (
    <>
      <Show
        isLoading={isLoading}
        title="视频详情"
        headerButtons={({ defaultButtons }) => (
          <>
            {defaultButtons}
            <Button onClick={() => navigate('/videos')}>返回列表</Button>
          </>
        )}
        footerButtons={() => (
          <Space>
            <Button
              type="primary"
              onClick={() => handleReview('approve')}
              disabled={record?.review_status === 'approved'}
            >
              通过审核
            </Button>
            <Button danger onClick={() => handleReview('reject')}>
              拒绝
            </Button>
            <Button onClick={() => handleReview('flag')}>标记问题</Button>
          </Space>
        )}
      >
        <Row gutter={16}>
          <Col span={16}>
            <Card title="视频内容" style={{ marginBottom: 16 }}>
              {record?.play_url ? (
                <video
                  src={record.play_url}
                  controls
                  style={{ width: '100%', maxHeight: 600, backgroundColor: '#000' }}
                />
              ) : (
                <div
                  style={{
                    width: '100%',
                    height: 400,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    backgroundColor: '#f0f0f0'
                  }}
                >
                  <span style={{ color: '#999' }}>无视频</span>
                </div>
              )}
            </Card>

            <Card title="视频信息">
              <Descriptions column={1}>
                <Descriptions.Item label="标题">{record?.title || '-'}</Descriptions.Item>
                <Descriptions.Item label="描述">{record?.description || '-'}</Descriptions.Item>
                <Descriptions.Item label="内容类型">
                  {record?.content_type || '-'}
                </Descriptions.Item>
                <Descriptions.Item label="审核状态">
                  {getReviewStatusTag(record?.review_status || 'pending')}
                </Descriptions.Item>
                <Descriptions.Item label="成人内容">
                  <Tag color={record?.is_adult ? 'red' : 'blue'}>
                    {record?.is_adult ? '是' : '否'}
                  </Tag>
                </Descriptions.Item>
                {record?.review_note && (
                  <Descriptions.Item label="审核备注">{record.review_note}</Descriptions.Item>
                )}
                <Descriptions.Item label="观看数">{record?.view_count || 0}</Descriptions.Item>
                <Descriptions.Item label="点赞数">{record?.like_count || 0}</Descriptions.Item>
                <Descriptions.Item label="评论数">{record?.comment_count || 0}</Descriptions.Item>
              </Descriptions>
            </Card>
          </Col>

          <Col span={8}>
            <Card title="封面">
              {record?.cover_url ? (
                <Image src={record.cover_url} style={{ width: '100%' }} />
              ) : (
                <div
                  style={{
                    width: '100%',
                    height: 200,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    backgroundColor: '#f0f0f0'
                  }}
                >
                  <span style={{ color: '#999' }}>无封面</span>
                </div>
              )}
            </Card>

            <Card title="作者信息" style={{ marginTop: 16 }}>
              <Space direction="vertical" style={{ width: '100%' }}>
                {record?.author?.avatar_url && (
                  <Image
                    src={record.author.avatar_url}
                    width={80}
                    height={80}
                    style={{ borderRadius: 40 }}
                  />
                )}
                <Descriptions column={1} size="small">
                  <Descriptions.Item label="昵称">
                    {record?.author?.nickname || '-'}
                  </Descriptions.Item>
                  <Descriptions.Item label="用户名">
                    {record?.author?.username || '-'}
                  </Descriptions.Item>
                  <Descriptions.Item label="数字ID">
                    {record?.author?.numeric_id || '-'}
                  </Descriptions.Item>
                </Descriptions>
                <Button
                  type="link"
                  onClick={() => navigate(`/users/show/${record?.author?.id}`)}
                  block
                >
                  查看作者详情
                </Button>
              </Space>
            </Card>
          </Col>
        </Row>
      </Show>

      <Modal
        title="视频审核"
        open={reviewModalOpen}
        onOk={handleReviewSubmit}
        onCancel={() => {
          setReviewModalOpen(false)
          reviewForm.resetFields()
        }}
        width={500}
      >
        <Form form={reviewForm} layout="vertical">
          <Form.Item name="action" label="审核操作" hidden>
            <Input />
          </Form.Item>

          <Form.Item name="is_adult" label="内容分类">
            <Radio.Group>
              <Radio value={false}>正常内容</Radio>
              <Radio value={true}>成人内容</Radio>
            </Radio.Group>
          </Form.Item>

          <Form.Item
            name="reason"
            label="备注"
            rules={[
              {
                required: reviewForm.getFieldValue('action') === 'reject',
                message: '拒绝时必须填写原因'
              }
            ]}
          >
            <Input.TextArea rows={4} placeholder="请输入审核备注（拒绝时必填）" />
          </Form.Item>
        </Form>
      </Modal>
    </>
  )
}
