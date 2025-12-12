import { List, useTable } from '@refinedev/antd'
import { Table, Space, Tag, Button, Modal, Input, Select, Form, message } from 'antd'
import { useState, useRef } from 'react'
import { useUpdate, useDelete } from '@refinedev/core'
import { useNavigate } from 'react-router-dom'
import {
  EyeOutlined,
  EditOutlined,
  DeleteOutlined,
  LeftOutlined,
  RightOutlined
} from '@ant-design/icons'
import dayjs from 'dayjs'
import utc from 'dayjs/plugin/utc'
import timezone from 'dayjs/plugin/timezone'
import {
  getCoverUrl,
  getVideoPlayUrl,
  parseImages,
  getContentTypeInfo,
  buildCdnUrl
} from '../../utils/media'

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
  const [currentVideoStatus, setCurrentVideoStatus] = useState<string>('')
  const [currentReviewStatus, setCurrentReviewStatus] = useState<string>('')
  const [savingDescription, setSavingDescription] = useState(false)
  const [selectedRowKeys, setSelectedRowKeys] = useState<React.Key[]>([])
  const [batchLoading, setBatchLoading] = useState(false)
  const [rejectForm] = Form.useForm()
  const { mutate: updateVideo } = useUpdate()
  const { mutate: deleteVideo } = useDelete()
  const videoRef = useRef<HTMLVideoElement>(null)

  // 📸 图片/相册预览相关状态
  const [previewContentType, setPreviewContentType] = useState<'video' | 'image' | 'album'>('video')
  const [previewImages, setPreviewImages] = useState<string[]>([])
  const [currentImageIndex, setCurrentImageIndex] = useState(0)

  const { tableProps, searchFormProps } = useTable({
    resource: 'videos',
    syncWithLocation: true,
    meta: {
      select: '*, profiles:author_id(nickname, avatar_url)'
    },
    sorters: {
      initial: [
        { field: 'created_at', order: 'desc' } // 按创建时间倒序
      ]
    },
    onSearch: (params: Record<string, any>) => {
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

      // 筛选内容类型
      if (params.content_type) {
        filters.push({
          field: 'content_type',
          operator: 'eq',
          value: params.content_type
        })
      }

      // 筛选推荐状态
      if (params.is_recommended) {
        filters.push({
          field: 'is_recommended',
          operator: 'eq',
          value: params.is_recommended === 'true'
        })
      }

      // 筛选成人内容
      if (params.is_adult) {
        filters.push({
          field: 'is_adult',
          operator: 'eq',
          value: params.is_adult === 'true'
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

  // 预览内容（视频/图片/相册）
  const handlePreview = (record: any) => {
    const contentType = record.content_type || 'video'
    setPreviewContentType(contentType)

    if (contentType === 'video') {
      // 视频预览
      const videoUrl = getVideoPlayUrl(record)
      if (!videoUrl) {
        message.error('视频URL不可用')
        return
      }
      setCurrentVideoUrl(videoUrl)
      setPreviewImages([])
      setPreviewModalVisible(true)

      // 延迟设置视频音频（等待 DOM 渲染）
      setTimeout(() => {
        if (videoRef.current) {
          const video = videoRef.current
          video.muted = false
          video.volume = 1.0
        }
      }, 100)
    } else {
      // 图片/相册预览
      const images = parseImages(record.images)
      if (images.length === 0) {
        message.error('图片不可用')
        return
      }
      const imageUrls = images.map((img: any) => buildCdnUrl(img.file_id))
      setPreviewImages(imageUrls)
      setCurrentImageIndex(0)
      setCurrentVideoUrl('')
      setPreviewModalVisible(true)
    }
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
    setPreviewImages([])
    setCurrentImageIndex(0)
  }

  // 相册上一张
  const handlePrevImage = () => {
    setCurrentImageIndex((prev) => (prev > 0 ? prev - 1 : previewImages.length - 1))
  }

  // 相册下一张
  const handleNextImage = () => {
    setCurrentImageIndex((prev) => (prev < previewImages.length - 1 ? prev + 1 : 0))
  }

  // 删除视频
  const handleDelete = (record: any) => {
    Modal.confirm({
      title: '确认删除',
      content: `确定要删除这个${record.content_type === 'video' ? '视频' : record.content_type === 'album' ? '相册' : '图片'}吗？此操作不可恢复！`,
      okType: 'danger',
      onOk: () => {
        deleteVideo(
          {
            resource: 'videos',
            id: record.id
          },
          {
            onSuccess: () => {
              message.success('删除成功')
            },
            onError: () => {
              message.error('删除失败')
            }
          }
        )
      }
    })
  }

  // 通过审核
  const handleApprove = (record: any) => {
    Modal.confirm({
      title: '确认通过审核',
      content: `确定通过「${record.title}」的审核吗？`,
      onOk: async () => {
        try {
          // 🎯 调用后端 API 处理审核通过（包含自动审核逻辑）
          const response = await fetch(`${import.meta.env.VITE_APP_SERVER_URL}/video/approve`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ video_id: record.id })
          })

          const result = await response.json()

          if (result.code === 0) {
            const { auto_approve_enabled } = result.data || {}
            if (auto_approve_enabled) {
              message.success('审核通过！该用户后续发布将自动通过审核')
            } else {
              message.success('审核通过，内容已发布')
            }
            // 刷新列表
            window.location.reload()
          } else {
            message.error(result.msg || '操作失败')
          }
        } catch (error) {
          console.error('Approve error:', error)
          message.error('操作失败，请重试')
        }
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

  // 🎯 切换推荐状态
  const handleToggleRecommend = (record: any) => {
    const newRecommended = !record.is_recommended
    Modal.confirm({
      title: newRecommended ? '确认推荐' : '取消推荐',
      content: newRecommended
        ? `确定将「${record.description?.substring(0, 20) || '该视频'}」加入推荐池吗？`
        : `确定将「${record.description?.substring(0, 20) || '该视频'}」从推荐池移除吗？`,
      onOk: () => {
        updateVideo(
          {
            resource: 'videos',
            id: record.id,
            values: {
              is_recommended: newRecommended,
              recommended_at: newRecommended ? new Date().toISOString() : null
            }
          },
          {
            onSuccess: () => {
              message.success(newRecommended ? '已加入推荐池' : '已从推荐池移除')
            },
            onError: (error) => {
              const err = error as { message?: string }
              message.error('操作失败：' + (err?.message || '未知错误'))
            }
          }
        )
      }
    })
  }

  // 🎯 切换成人内容标记
  const handleToggleAdult = (record: any) => {
    const newIsAdult = !record.is_adult
    Modal.confirm({
      title: newIsAdult ? '标记为成人内容' : '取消成人标记',
      content: newIsAdult
        ? '确定将该内容标记为成人内容（🔞）吗？\n标记后将只会出现在成人相关的列表/频道中。'
        : '确定要取消该内容的成人标记吗？',
      onOk: () => {
        updateVideo(
          {
            resource: 'videos',
            id: record.id,
            values: {
              is_adult: newIsAdult
            }
          },
          {
            onSuccess: () => {
              message.success(newIsAdult ? '已标记为成人内容' : '已取消成人标记')
            },
            onError: (error) => {
              const err = error as { message?: string }
              message.error('操作失败：' + (err?.message || '未知错误'))
            }
          }
        )
      }
    })
  }

  // 🎯 保存描述编辑（不回退审核状态）
  const handleSaveDescription = () => {
    if (!currentVideoId) {
      setDescriptionModalVisible(false)
      return
    }

    setSavingDescription(true)

    // 先更新描述
    updateVideo(
      {
        resource: 'videos',
        id: currentVideoId,
        values: {
          description: currentDescription
        }
      },
      {
        onSuccess: () => {
          // 如果原本是已发布 + 已通过审核，则再补一次状态，避免被触发器回退
          if (currentVideoStatus === 'published' && currentReviewStatus === 'approved') {
            updateVideo(
              {
                resource: 'videos',
                id: currentVideoId,
                values: {
                  status: currentVideoStatus,
                  review_status: currentReviewStatus
                }
              },
              {
                onSuccess: () => {
                  message.success('描述已更新')
                  setDescriptionModalVisible(false)
                  setSavingDescription(false)
                },
                onError: (error) => {
                  console.error('恢复审核状态失败:', error)
                  message.warning('描述已更新，但审核状态可能已被重置，请检查')
                  setDescriptionModalVisible(false)
                  setSavingDescription(false)
                }
              }
            )
          } else {
            message.success('描述已更新')
            setDescriptionModalVisible(false)
            setSavingDescription(false)
          }
        },
        onError: (error) => {
          console.error('更新描述失败:', error)
          message.error('更新描述失败')
          setSavingDescription(false)
        }
      }
    )
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
          <Form.Item name="content_type" label="内容类型">
            <Select placeholder="选择类型" allowClear style={{ width: 100 }}>
              <Select.Option value="video">🎬 视频</Select.Option>
              <Select.Option value="image">🖼️ 图片</Select.Option>
              <Select.Option value="album">📷 相册</Select.Option>
            </Select>
          </Form.Item>
          <Form.Item name="is_recommended" label="推荐状态">
            <Select placeholder="推荐状态" allowClear style={{ width: 100 }}>
              <Select.Option value="true">⭐ 已推荐</Select.Option>
              <Select.Option value="false">未推荐</Select.Option>
            </Select>
          </Form.Item>
          <Form.Item name="is_adult" label="成人内容">
            <Select placeholder="是否成人" allowClear style={{ width: 110 }}>
              <Select.Option value="true">🔞 成人</Select.Option>
              <Select.Option value="false">普通</Select.Option>
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
            dataIndex="content_type"
            title="类型"
            width={80}
            render={(value) => {
              const info = getContentTypeInfo(value || 'video')
              return (
                <Tag color={info.color}>
                  {info.icon} {info.text}
                </Tag>
              )
            }}
          />

          <Table.Column
            dataIndex="cover_url"
            title="封面"
            width={100}
            render={(_, record: any) => {
              const coverUrl = getCoverUrl(record)
              const contentType = record.content_type || 'video'
              const images = parseImages(record.images)

              return coverUrl ? (
                <div style={{ position: 'relative' }}>
                  <img
                    src={coverUrl}
                    alt="封面"
                    style={{ width: 80, height: 80, objectFit: 'cover', borderRadius: 4 }}
                    onError={(e) => {
                      ;(e.target as HTMLImageElement).src =
                        'https://via.placeholder.com/80x80?text=No+Image'
                    }}
                  />
                  {/* 相册显示图片数量角标 */}
                  {contentType === 'album' && images.length > 1 && (
                    <div
                      style={{
                        position: 'absolute',
                        top: 4,
                        right: 4,
                        background: 'rgba(0,0,0,0.6)',
                        color: 'white',
                        fontSize: 10,
                        padding: '2px 6px',
                        borderRadius: 8
                      }}
                    >
                      {images.length}张
                    </div>
                  )}
                </div>
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
              // 尝试获取头像
              let avatar = user?.avatar_url

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
            render={(text, record: any) => (
              <div
                style={{
                  cursor: 'pointer',
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
                  setCurrentVideoId(record.id)
                  setCurrentDescription(text || '')
                  setCurrentVideoStatus(record.status)
                  setCurrentReviewStatus(record.review_status)
                  setDescriptionModalVisible(true)
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
            dataIndex="is_recommended"
            title="推荐"
            width={80}
            render={(value) =>
              value ? <Tag color="gold">⭐ 推荐</Tag> : <Tag color="default">-</Tag>
            }
          />

          <Table.Column
            dataIndex="is_adult"
            title="成人"
            width={80}
            render={(value) =>
              value ? <Tag color="magenta">🔞 成人</Tag> : <Tag color="default">-</Tag>
            }
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
            width={320}
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

                {/* 推荐按钮（只有已发布的视频才显示） */}
                {record.status === 'published' && (
                  <Button
                    type={record.is_recommended ? 'primary' : 'default'}
                    size="small"
                    onClick={() => handleToggleRecommend(record)}
                    style={
                      record.is_recommended ? { background: '#faad14', borderColor: '#faad14' } : {}
                    }
                  >
                    {record.is_recommended ? '取消推荐' : '推荐'}
                  </Button>
                )}

                {/* 成人标记按钮 */}
                <Button
                  type={record.is_adult ? 'primary' : 'default'}
                  danger={record.is_adult}
                  size="small"
                  onClick={() => handleToggleAdult(record)}
                >
                  {record.is_adult ? '取消成人' : '标记成人'}
                </Button>

                <Button
                  type="default"
                  size="small"
                  icon={<EditOutlined />}
                  onClick={() => navigate(`/videos/edit/${record.id}`)}
                />

                {/* 删除按钮 */}
                <Button
                  danger
                  type="text"
                  size="small"
                  icon={<DeleteOutlined />}
                  onClick={() => handleDelete(record)}
                />
              </Space>
            )}
          />
        </Table>
      </List>

      {/* 预览弹窗（视频/图片/相册） */}
      <Modal
        title={
          previewContentType === 'video'
            ? '视频预览'
            : previewContentType === 'album'
              ? `相册预览 (${currentImageIndex + 1}/${previewImages.length})`
              : '图片预览'
        }
        open={previewModalVisible}
        onCancel={handleClosePreview}
        footer={null}
        width={800}
        centered
      >
        {/* 视频预览 */}
        {previewContentType === 'video' && currentVideoUrl && (
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

        {/* 图片/相册预览 */}
        {(previewContentType === 'image' || previewContentType === 'album') &&
          previewImages.length > 0 && (
            <div style={{ position: 'relative', textAlign: 'center' }}>
              <img
                src={previewImages[currentImageIndex]}
                alt={`图片 ${currentImageIndex + 1}`}
                style={{ maxWidth: '100%', maxHeight: '70vh', objectFit: 'contain' }}
                onError={(e) => {
                  ;(e.target as HTMLImageElement).src =
                    'https://via.placeholder.com/400x400?text=加载失败'
                }}
              />

              {/* 相册左右切换按钮 */}
              {previewImages.length > 1 && (
                <>
                  <Button
                    type="text"
                    icon={<LeftOutlined />}
                    onClick={handlePrevImage}
                    style={{
                      position: 'absolute',
                      left: 10,
                      top: '50%',
                      transform: 'translateY(-50%)',
                      background: 'rgba(0,0,0,0.3)',
                      color: 'white',
                      border: 'none',
                      width: 40,
                      height: 40,
                      borderRadius: '50%'
                    }}
                  />
                  <Button
                    type="text"
                    icon={<RightOutlined />}
                    onClick={handleNextImage}
                    style={{
                      position: 'absolute',
                      right: 10,
                      top: '50%',
                      transform: 'translateY(-50%)',
                      background: 'rgba(0,0,0,0.3)',
                      color: 'white',
                      border: 'none',
                      width: 40,
                      height: 40,
                      borderRadius: '50%'
                    }}
                  />
                </>
              )}

              {/* 图片指示器 */}
              {previewImages.length > 1 && (
                <div style={{ marginTop: 16, display: 'flex', justifyContent: 'center', gap: 8 }}>
                  {previewImages.map((_, index) => (
                    <div
                      key={index}
                      onClick={() => setCurrentImageIndex(index)}
                      style={{
                        width: 8,
                        height: 8,
                        borderRadius: '50%',
                        background: index === currentImageIndex ? '#1890ff' : '#d9d9d9',
                        cursor: 'pointer'
                      }}
                    />
                  ))}
                </div>
              )}
            </div>
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
          <Button key="cancel" onClick={() => setDescriptionModalVisible(false)}>
            取消
          </Button>,
          <Button
            key="save"
            type="primary"
            loading={savingDescription}
            onClick={handleSaveDescription}
          >
            保存
          </Button>
        ]}
        width={600}
      >
        <Input.TextArea
          rows={6}
          value={currentDescription}
          onChange={(e) => setCurrentDescription(e.target.value)}
          placeholder="请输入视频描述"
        />
      </Modal>
    </>
  )
}
