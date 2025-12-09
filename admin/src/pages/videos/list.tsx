import { List, useTable } from '@refinedev/antd'
import { Table, Space, Tag, Button, Modal, Input, Select, Form, message } from 'antd'
import { useState, useRef } from 'react'
import { useUpdate } from '@refinedev/core'
import { useNavigate } from 'react-router-dom'
import { EyeOutlined, EditOutlined } from '@ant-design/icons'
import dayjs from 'dayjs'
import utc from 'dayjs/plugin/utc'
import timezone from 'dayjs/plugin/timezone'
import { getCoverUrl, getVideoPlayUrl } from '../../utils/media'

dayjs.extend(utc)
dayjs.extend(timezone)

const statusMap: Record<string, { text: string; color: string }> = {
  draft: { text: '草稿', color: 'default' },
  processing: { text: '处理中', color: 'processing' },
  ready: { text: '就绪', color: 'cyan' },
  published: { text: '已发布', color: 'success' },
  failed: { text: '失败', color: 'error' }
}

const reviewStatusMap: Record<string, { text: string; color: string }> = {
  pending: { text: '待审核', color: 'warning' },
  auto_approved: { text: '自动通过', color: 'success' },
  manual_review: { text: '人工审核中', color: 'processing' },
  approved: { text: '已通过', color: 'success' },
  rejected: { text: '已拒绝', color: 'error' },
  appealing: { text: '申诉中', color: 'orange' }
}

export const VideoList = () => {
  const navigate = useNavigate()
  const [rejectModalVisible, setRejectModalVisible] = useState(false)
  const [previewModalVisible, setPreviewModalVisible] = useState(false)
  const [descriptionModalVisible, setDescriptionModalVisible] = useState(false)
  const [currentVideoId, setCurrentVideoId] = useState<string>('')
  const [currentVideoUrl, setCurrentVideoUrl] = useState<string>('')
  const [currentDescription, setCurrentDescription] = useState<string>('')
  const [selectedRowKeys, setSelectedRowKeys] = useState<React.Key[]>([])
  const [batchLoading, setBatchLoading] = useState(false)
  const [rejectForm] = Form.useForm()
  const { mutate: updateVideo } = useUpdate()
  const videoRef = useRef<HTMLVideoElement>(null)

  const { tableProps, searchFormProps, filters } = useTable({
    resource: 'videos',
    syncWithLocation: true,
    meta: {
      select: '*, profiles:author_id(nickname, avatar_url, avatar_thumb, avatar_larger)'
    },
    sorters: {
      initial: [
        { field: 'created_at', order: 'desc' } // 按创建时间倒序
      ]
    },
    onSearch: (params) => {
      const filters: any[] = []

      // 搜索描述
      if (params.description) {
        filters.push({
          field: 'description',
          operator: 'contains',
          value: params.description
        })
      }

      // 搜索用户名
      if (params.username) {
        filters.push({
          field: 'profiles.nickname',
          operator: 'contains',
          value: params.username
        })
      }

      // 筛选状态
      if (params.status) {
        filters.push({
          field: 'status',
          operator: 'eq',
          value: params.status
        })
      }

      // 筛选审核状态
      if (params.review_status) {
        filters.push({
          field: 'review_status',
          operator: 'eq',
          value: params.review_status
        })
      }

      return filters
    }
  })

  // 格式化北京时间
  const formatBeijingTime = (dateStr: string) => {
    return dayjs(dateStr).tz('Asia/Shanghai').format('YYYY-MM-DD HH:mm:ss')
  }

  // 格式化数字
  const formatNumber = (num: number) => {
    if (num >= 10000) {
      return (num / 10000).toFixed(1) + 'w'
    }
    return num.toString()
  }

  // 格式化文件大小
  const formatFileSize = (bytes: number) => {
    if (!bytes) return '-'
    if (bytes < 1024) return bytes + ' B'
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB'
    if (bytes < 1024 * 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + ' MB'
    return (bytes / (1024 * 1024 * 1024)).toFixed(2) + ' GB'
  }

  // 格式化位置信息
  const formatLocation = (record: any) => {
    const parts = []
    if (record.location_country) {
      parts.push(record.location_country)
    }
    if (record.location_city) {
      parts.push(record.location_city)
    }
    return parts.length > 0 ? parts.join(' · ') : '-'
  }

  // 预览视频
  const handlePreview = (record: any) => {
    const videoUrl = getVideoPlayUrl(record)

    if (!videoUrl) {
      message.error('视频URL不可用')
      return
    }
    setCurrentVideoUrl(videoUrl)
    setPreviewModalVisible(true)

    // 延迟设置视频音频（等待 DOM 渲染）
    setTimeout(() => {
      if (videoRef.current) {
        const video = videoRef.current
        video.muted = false
        video.volume = 1.0
      }
    }, 100)
  }

  // 关闭预览
  const handleClosePreview = () => {
    // 停止视频播放
    if (videoRef.current) {
      videoRef.current.pause()
      videoRef.current.currentTime = 0
    }
    setPreviewModalVisible(false)
    setCurrentVideoUrl('')
  }

  // 通过审核
  const handleApprove = (record: any) => {
    Modal.confirm({
      title: '确认通过审核',
      content: `确定通过视频「${record.title}」的审核吗？`,
      onOk: () => {
        // 🎯 审核通过逻辑：
        // - ready（就绪）→ published（已发布）
        // - 其他状态保持不变
        const shouldPublish = record.status === 'ready'

        updateVideo(
          {
            resource: 'videos',
            id: record.id,
            values: {
              review_status: 'approved',
              status: shouldPublish ? 'published' : record.status
            }
          },
          {
            onSuccess: () => {
              message.success(shouldPublish ? '审核通过，视频已发布' : '审核通过')
            },
            onError: () => {
              message.error('操作失败')
            }
          }
        )
      }
    })
  }

  // 拒绝审核
  const handleReject = (record: any) => {
    setCurrentVideoId(record.id)
    setRejectModalVisible(true)
    rejectForm.resetFields()
  }

  // 提交拒绝理由
  const handleRejectSubmit = () => {
    rejectForm.validateFields().then((values) => {
      updateVideo(
        {
          resource: 'videos',
          id: currentVideoId,
          values: {
            review_status: 'rejected',
            reject_reason: values.reason
          }
        },
        {
          onSuccess: () => {
            message.success(`拒绝审核，理由：${values.reason}`)
            setRejectModalVisible(false)
          },
          onError: () => {
            message.error('操作失败')
          }
        }
      )
    })
  }

  // 批量通过审核
  const handleBatchApprove = () => {
    if (selectedRowKeys.length === 0) {
      message.warning('请先选择要审核的视频')
      return
    }

    Modal.confirm({
      title: '批量通过审核',
      content: `确定通过选中的 ${selectedRowKeys.length} 个视频的审核吗？`,
      onOk: async () => {
        setBatchLoading(true)
        try {
          // 🎯 调用批量审核接口
          const response = await fetch(
            `${import.meta.env.VITE_APP_SERVER_URL}/video/batch-review`,
            {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json'
              },
              body: JSON.stringify({
                video_ids: selectedRowKeys,
                action: 'approve'
              })
            }
          )

          const result = await response.json()

          if (result.code === 0) {
            message.success(`成功通过 ${selectedRowKeys.length} 个视频的审核`)
            setSelectedRowKeys([])
            // 刷新列表
            window.location.reload()
          } else {
            message.error(result.msg || '批量审核失败')
          }
        } catch (error) {
          console.error('Batch approve error:', error)
          message.error('批量审核失败，请重试')
        } finally {
          setBatchLoading(false)
        }
      }
    })
  }

  // 行选择配置
  const rowSelection = {
    selectedRowKeys,
    onChange: (newSelectedRowKeys: React.Key[]) => {
      setSelectedRowKeys(newSelectedRowKeys)
    },
    getCheckboxProps: (record: any) => ({
      // 只有已发布且待审核的视频才能被选中
      disabled: record.status !== 'published' || record.review_status !== 'pending'
    })
  }

  // 判断是否需要显示审核按钮
  const shouldShowReviewButtons = (record: any) => {
    // 🎯 草稿状态不显示审核按钮
    if (record.status === 'draft') {
      return false
    }
    // 只在待审核或人工审核中时显示
    return record.review_status === 'pending' || record.review_status === 'manual_review'
  }

  return (
    <>
      <List>
        {/* 搜索和筛选表单 */}
        <Form {...searchFormProps} layout="inline" style={{ marginBottom: 16 }}>
          <Form.Item name="username" label="搜索用户">
            <Input placeholder="输入用户名" style={{ width: 150 }} />
          </Form.Item>
          <Form.Item name="description" label="搜索描述">
            <Input placeholder="输入视频描述" style={{ width: 200 }} />
          </Form.Item>
          <Form.Item name="status" label="视频状态">
            <Select placeholder="选择状态" allowClear style={{ width: 120 }}>
              <Select.Option value="draft">草稿</Select.Option>
              <Select.Option value="processing">处理中</Select.Option>
              <Select.Option value="ready">就绪</Select.Option>
              <Select.Option value="published">已发布</Select.Option>
              <Select.Option value="failed">失败</Select.Option>
            </Select>
          </Form.Item>
          <Form.Item name="review_status" label="审核状态">
            <Select placeholder="选择审核状态" allowClear style={{ width: 130 }}>
              <Select.Option value="pending">待审核</Select.Option>
              <Select.Option value="auto_approved">自动通过</Select.Option>
              <Select.Option value="manual_review">人工审核中</Select.Option>
              <Select.Option value="approved">已通过</Select.Option>
              <Select.Option value="rejected">已拒绝</Select.Option>
              <Select.Option value="appealing">申诉中</Select.Option>
            </Select>
          </Form.Item>
          <Form.Item>
            <Button type="primary" htmlType="submit">
              搜索
            </Button>
          </Form.Item>
        </Form>

        {/* 批量操作按钮 */}
        {selectedRowKeys.length > 0 && (
          <div style={{ marginBottom: 16 }}>
            <Button type="primary" onClick={handleBatchApprove} loading={batchLoading}>
              批量通过审核 ({selectedRowKeys.length})
            </Button>
            <Button style={{ marginLeft: 8 }} onClick={() => setSelectedRowKeys([])}>
              取消选择
            </Button>
          </div>
        )}

        <Table {...tableProps} rowKey="id" scroll={{ x: 1800 }} rowSelection={rowSelection}>
          <Table.Column
            dataIndex="cover_url"
            title="封面"
            width={100}
            render={(_, record: any) => {
              const coverUrl = getCoverUrl(record)
              return coverUrl ? (
                <img
                  src={coverUrl}
                  alt="封面"
                  style={{ width: 80, height: 80, objectFit: 'cover', borderRadius: 4 }}
                  onError={(e) => {
                    // 封面加载失败时的处理
                    ;(e.target as HTMLImageElement).src =
                      'https://via.placeholder.com/80x80?text=No+Image'
                  }}
                />
              ) : (
                <div
                  style={{
                    width: 80,
                    height: 80,
                    background: '#f0f0f0',
                    borderRadius: 4,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center'
                  }}
                >
                  无封面
                </div>
              )
            }}
          />

          <Table.Column
            title="用户"
            width={180}
            render={(_, record: any) => {
              const profile = record.profiles
              // 兼容可能为数组的情况（虽然 user_id 应该是一对一）
              const user = Array.isArray(profile) ? profile[0] : profile
              const nickname = user?.nickname || '未知用户'
              // 尝试获取头像，兼容多种字段
              let avatar = user?.avatar_url
              if (!avatar && user?.avatar_thumb) avatar = user.avatar_thumb
              if (!avatar && user?.avatar_larger) avatar = user.avatar_larger

              // 如果是对象（Telegram 风格，数据库中可能是 jsonb）
              if (typeof avatar === 'object' && avatar !== null) {
                avatar = avatar.url_list?.[0] || avatar.url
              }

              return (
                <Space>
                  <img
                    src={avatar || 'https://via.placeholder.com/32'}
                    alt={nickname}
                    style={{ width: 32, height: 32, borderRadius: '50%', objectFit: 'cover' }}
                    onError={(e) =>
                      ((e.target as HTMLImageElement).src = 'https://via.placeholder.com/32')
                    }
                  />
                  <span style={{ fontSize: 13 }}>{nickname}</span>
                </Space>
              )
            }}
          />

          <Table.Column
            dataIndex="description"
            title="描述"
            width={300}
            render={(text) => (
              <div
                style={{
                  cursor: text ? 'pointer' : 'default',
                  color: text ? '#1890ff' : 'inherit',
                  display: '-webkit-box',
                  WebkitLineClamp: 4,
                  WebkitBoxOrient: 'vertical',
                  overflow: 'hidden',
                  wordBreak: 'break-word',
                  lineHeight: '1.5',
                  maxHeight: '6em'
                }}
                onClick={() => {
                  if (text) {
                    setCurrentDescription(text)
                    setDescriptionModalVisible(true)
                  }
                }}
              >
                {text || '无描述'}
              </div>
            )}
          />

          <Table.Column
            dataIndex="tags"
            title="标签"
            width={150}
            render={(tags: string[]) => (
              <>
                {tags && tags.length > 0 ? (
                  tags.map((tag, index) => (
                    <Tag key={index} color="blue" style={{ marginBottom: 4 }}>
                      {tag}
                    </Tag>
                  ))
                ) : (
                  <span style={{ color: '#999' }}>无标签</span>
                )}
              </>
            )}
          />

          <Table.Column
            title="位置"
            width={120}
            render={(_, record: any) => <span>{formatLocation(record)}</span>}
          />

          <Table.Column
            dataIndex="file_size"
            title="文件大小"
            width={100}
            render={(size) => formatFileSize(size)}
          />

          <Table.Column
            dataIndex="status"
            title="视频状态"
            width={100}
            render={(value) => (
              <Tag color={statusMap[value]?.color || 'default'}>
                {statusMap[value]?.text || value}
              </Tag>
            )}
          />

          <Table.Column
            dataIndex="review_status"
            title="审核状态"
            width={110}
            render={(value) => (
              <Tag color={reviewStatusMap[value]?.color || 'default'}>
                {reviewStatusMap[value]?.text || value}
              </Tag>
            )}
          />

          <Table.Column
            dataIndex="view_count"
            title="播放量"
            width={80}
            sorter
            render={(value) => formatNumber(value || 0)}
          />

          <Table.Column
            dataIndex="like_count"
            title="点赞"
            width={70}
            sorter
            render={(value) => formatNumber(value || 0)}
          />

          <Table.Column
            dataIndex="collect_count"
            title="收藏"
            width={70}
            sorter
            render={(value) => formatNumber(value || 0)}
          />

          <Table.Column
            dataIndex="comment_count"
            title="评论"
            width={70}
            sorter
            render={(value) => formatNumber(value || 0)}
          />

          <Table.Column
            dataIndex="created_at"
            title="创建时间"
            width={160}
            sorter
            defaultSortOrder="descend"
            render={(value) => formatBeijingTime(value)}
          />

          <Table.Column
            title="操作"
            width={300}
            fixed="right"
            render={(_, record: any) => (
              <Space size="small">
                {/* 预览按钮 */}
                <Button
                  type="default"
                  size="small"
                  icon={<EyeOutlined />}
                  onClick={() => handlePreview(record)}
                >
                  预览
                </Button>

                {/* 审核按钮（草稿状态不显示） */}
                {shouldShowReviewButtons(record) && (
                  <>
                    <Button type="primary" size="small" onClick={() => handleApprove(record)}>
                      通过
                    </Button>
                    <Button danger size="small" onClick={() => handleReject(record)}>
                      拒绝
                    </Button>
                  </>
                )}

                <Button
                  type="default"
                  size="small"
                  icon={<EditOutlined />}
                  onClick={() => navigate(`/videos/edit/${record.id}`)}
                />
              </Space>
            )}
          />
        </Table>
      </List>

      {/* 视频预览弹窗 */}
      <Modal
        title="视频预览"
        open={previewModalVisible}
        onCancel={handleClosePreview}
        footer={null}
        width={800}
        centered
      >
        {currentVideoUrl && (
          <video
            ref={videoRef}
            src={currentVideoUrl}
            controls
            controlsList="nodownload"
            style={{ width: '100%', maxHeight: '70vh' }}
            muted={false}
            playsInline
          />
        )}
      </Modal>

      {/* 拒绝审核弹窗 */}
      <Modal
        title="拒绝审核"
        open={rejectModalVisible}
        onOk={handleRejectSubmit}
        onCancel={() => setRejectModalVisible(false)}
        okText="确定"
        cancelText="取消"
      >
        <Form form={rejectForm} layout="vertical">
          <Form.Item
            name="reason"
            label="拒绝理由"
            rules={[{ required: true, message: '请输入拒绝理由' }]}
          >
            <Input.TextArea
              rows={4}
              placeholder="请输入拒绝理由（必填）"
              maxLength={200}
              showCount
            />
          </Form.Item>
        </Form>
      </Modal>

      {/* 描述预览弹窗 */}
      <Modal
        title="视频描述"
        open={descriptionModalVisible}
        onCancel={() => setDescriptionModalVisible(false)}
        footer={[
          <Button key="close" onClick={() => setDescriptionModalVisible(false)}>
            关闭
          </Button>
        ]}
        width={600}
      >
        <div style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word', lineHeight: '1.6' }}>
          {currentDescription}
        </div>
      </Modal>
    </>
  )
}
