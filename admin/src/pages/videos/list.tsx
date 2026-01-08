import { List, useTable } from '@refinedev/antd'
import { Table, Space, Tag, Button, Modal, Input, Select, Form, message, Tooltip } from 'antd'
import { useState, useRef, useEffect } from 'react'
import { useInvalidate, useUpdate, useDelete } from '@refinedev/core'
import { useNavigate } from 'react-router-dom'
import Hls from 'hls.js'
import {
  EditOutlined,
  DeleteOutlined,
  LeftOutlined,
  RightOutlined,
  SyncOutlined
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
import { supabaseClient } from '../../supabaseClient'

dayjs.extend(utc)
dayjs.extend(timezone)

// 🎯 HLS 视频播放组件（支持外部控制）
const HlsVideo = ({ src, onVideoRef, ...props }: any) => {
  const videoRef = useRef<HTMLVideoElement>(null)
  const hlsRef = useRef<Hls | null>(null)

  useEffect(() => {
    const video = videoRef.current
    if (!video || !src) return

    if (src.includes('.m3u8')) {
      if (Hls.isSupported()) {
        if (hlsRef.current) hlsRef.current.destroy()
        const hls = new Hls()
        hlsRef.current = hls
        hls.loadSource(src)
        hls.attachMedia(video)
        hls.on(Hls.Events.MANIFEST_PARSED, () => {
          video.play().catch(() => {})
        })
      } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
        video.src = src
      }
    } else {
      video.src = src
    }

    // 🎯 将 video 和 hls 实例传递给父组件，以便外部控制
    if (onVideoRef) {
      onVideoRef({ video, hls: hlsRef.current })
    }

    return () => {
      if (hlsRef.current) {
        hlsRef.current.destroy()
        hlsRef.current = null
      }
    }
  }, [src, onVideoRef])

  return <video ref={videoRef} controls controlsList="nodownload" playsInline {...props} />
}

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
  const [refreshingDouyin, setRefreshingDouyin] = useState(false)
  const [rejectForm] = Form.useForm()
  const { mutate: updateVideo } = useUpdate()
  const { mutate: deleteVideo } = useDelete()
  const invalidate = useInvalidate()

  // 📸 图片/相册/合集预览相关状态
  const [previewContentType, setPreviewContentType] = useState<
    'video' | 'image' | 'album' | 'collection'
  >('video')
  const [previewMediaItems, setPreviewMediaItems] = useState<any[]>([])
  const [currentImageIndex, setCurrentImageIndex] = useState(0)

  // 🎯 视频播放控制 refs
  const videoPlayerRefs = useRef<{
    mainVideo?: { video: HTMLVideoElement; hls: Hls | null }
    mediaVideo?: { video: HTMLVideoElement; hls: Hls | null }
  }>({})

  const { tableProps, searchFormProps } = useTable({
    // ✅ 后台视频列表使用视图（支持业务优先级排序 + 用户多字段搜索）
    resource: 'admin_videos_list',
    syncWithLocation: true,
    sorters: {
      initial: [
        // ✅ 默认按业务逻辑排序：待审核(10) > 就绪(20) > 处理中(30) > 已发布(40) > 拒绝/失败/草稿
        { field: 'admin_sort_rank', order: 'asc' },
        // ✅ 同一状态下，按发布/创建时间倒序
        { field: 'admin_sort_time', order: 'desc' }
      ]
    },
    pagination: {
      current: 1,
      pageSize: 20
    } as any,
    queryOptions: {
      staleTime: 0, // ✅ 禁用缓存，确保每次进入页面都重新获取最新数据
      refetchOnMount: 'always' // ✅ 强制挂载时重新获取
    },
    onSearch: (params: Record<string, any>) => {
      const filters: any[] = []

      // 1. 视频 ID (UUID)
      const videoId = String(params.video_id || '').trim()
      if (videoId) {
        filters.push({ field: 'id', operator: 'eq', value: videoId })
      }

      // 2. 搜索描述
      const desc = String(params.description || '').trim()
      if (desc) {
        filters.push({
          field: 'description',
          operator: 'contains',
          value: desc
        })
      }

      // 3. 搜索用户（支持多种输入，统一走视图的 author_search）
      const userQ = String(params.user_q || '').trim()
      if (userQ) {
        filters.push({ field: 'author_search', operator: 'contains', value: userQ.toLowerCase() })
      }

      // 4. 筛选状态
      if (params.status) {
        filters.push({ field: 'status', operator: 'eq', value: params.status })
      }

      // 5. 筛选审核状态
      if (params.review_status) {
        filters.push({ field: 'review_status', operator: 'eq', value: params.review_status })
      }

      // 6. 筛选内容类型
      if (params.content_type) {
        filters.push({ field: 'content_type', operator: 'eq', value: params.content_type })
      }

      // 7. 筛选推荐状态
      if (params.is_recommended === 'true' || params.is_recommended === 'false') {
        filters.push({
          field: 'is_recommended',
          operator: 'eq',
          value: params.is_recommended === 'true'
        })
      }

      // 8. 筛选成人内容
      if (params.is_adult === 'true' || params.is_adult === 'false') {
        filters.push({
          field: 'is_adult',
          operator: 'eq',
          value: params.is_adult === 'true'
        })
      }

      // 9. 筛选东南亚板块
      if (params.is_sea === 'true' || params.is_sea === 'false') {
        filters.push({
          field: 'is_sea',
          operator: 'eq',
          value: params.is_sea === 'true'
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

  // 预览内容（视频/图片/相册/合集）
  const handlePreview = (record: any) => {
    const contentType = record.content_type || 'video'
    setPreviewContentType(contentType)

    if (contentType === 'video') {
      // 普通视频预览
      const videoUrl = getVideoPlayUrl(record)
      if (!videoUrl) {
        message.error('视频URL不可用')
        return
      }
      setCurrentVideoUrl(videoUrl)
      setPreviewMediaItems([])
      setPreviewModalVisible(true)
    } else {
      // 图片/相册/合集预览
      let mediaItems = parseImages(record.media_list || record.images)

      // 🎯 补丁：对于单图类型，如果 mediaItems 里面没拿到 R2 地址，尝试用顶层的 play_url/cover_url 补全
      // 这能解决：1. View 视图没选 media_list 字段 2. images 字段未同步更新 等问题
      if (
        contentType === 'image' &&
        (mediaItems.length === 0 ||
          (!mediaItems[0].play_url && !mediaItems[0].url && !mediaItems[0].cover_url))
      ) {
        const topUrl = record.play_url || record.cover_url
        if (topUrl && (topUrl.startsWith('http') || topUrl.startsWith('/'))) {
          console.log('[handlePreview] 使用顶层字段补偿图片预览 URL:', topUrl)
          mediaItems = [
            {
              type: 'image',
              file_id: record.tg_file_id || '',
              play_url: topUrl,
              cover_url: topUrl
            }
          ]
        }
      }

      if (mediaItems.length === 0) {
        message.error('媒体内容不可用')
        return
      }
      setPreviewMediaItems(mediaItems)
      setCurrentImageIndex(0)
      setCurrentVideoUrl('')
      setPreviewModalVisible(true)
    }
  }

  // 关闭预览（停止视频播放）
  const handleClosePreview = () => {
    // 🎯 停止主视频播放
    if (videoPlayerRefs.current.mainVideo) {
      const { video, hls } = videoPlayerRefs.current.mainVideo
      video.pause()
      video.currentTime = 0
      if (hls) {
        hls.destroy()
      }
      videoPlayerRefs.current.mainVideo = undefined
    }

    // 🎯 停止相册/合集中的视频播放
    if (videoPlayerRefs.current.mediaVideo) {
      const { video, hls } = videoPlayerRefs.current.mediaVideo
      video.pause()
      video.currentTime = 0
      if (hls) {
        hls.destroy()
      }
      videoPlayerRefs.current.mediaVideo = undefined
    }

    setPreviewModalVisible(false)
    setCurrentVideoUrl('')
    setPreviewMediaItems([])
    setCurrentImageIndex(0)
  }

  // 相册/合集上一张（停止当前视频）
  const handlePrevImage = () => {
    // 🎯 切换前停止当前视频
    if (videoPlayerRefs.current.mediaVideo) {
      const { video, hls } = videoPlayerRefs.current.mediaVideo
      video.pause()
      video.currentTime = 0
      if (hls) {
        hls.destroy()
      }
      videoPlayerRefs.current.mediaVideo = undefined
    }
    setCurrentImageIndex((prev) => (prev > 0 ? prev - 1 : previewMediaItems.length - 1))
  }

  // 相册/合集下一张（停止当前视频）
  const handleNextImage = () => {
    // 🎯 切换前停止当前视频
    if (videoPlayerRefs.current.mediaVideo) {
      const { video, hls } = videoPlayerRefs.current.mediaVideo
      video.pause()
      video.currentTime = 0
      if (hls) {
        hls.destroy()
      }
      videoPlayerRefs.current.mediaVideo = undefined
    }
    setCurrentImageIndex((prev) => (prev < previewMediaItems.length - 1 ? prev + 1 : 0))
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
          // 获取当前登录用户的 token
          const {
            data: { session }
          } = await supabaseClient.auth.getSession()
          const token = session?.access_token

          // 🎯 调用后端 API 处理审核通过（包含自动审核逻辑）
          const response = await fetch(`${import.meta.env.VITE_APP_SERVER_URL}/video/approve`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${token}`
            },
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

  // 批量执行操作
  const handleBatchAction = (
    action: 'approve' | 'set_adult' | 'unset_adult' | 'set_sea' | 'unset_sea' | 'delete',
    label: string
  ) => {
    if (selectedRowKeys.length === 0) {
      message.warning('请先选择要操作的视频')
      return
    }

    Modal.confirm({
      title: `批量${label}`,
      content: `确定对选中的 ${selectedRowKeys.length} 个视频执行"${label}"操作吗？${
        action === 'delete' ? '此操作不可恢复！' : ''
      }`,
      okType: action === 'delete' ? 'danger' : 'primary',
      onOk: async () => {
        setBatchLoading(true)
        try {
          const {
            data: { session }
          } = await supabaseClient.auth.getSession()
          const token = session?.access_token

          const response = await fetch(
            `${import.meta.env.VITE_APP_SERVER_URL}/video/batch-review`,
            {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${token}`
              },
              body: JSON.stringify({
                video_ids: selectedRowKeys,
                action: action
              })
            }
          )

          const result = await response.json()

          if (result.code === 0) {
            message.success(`成功执行批量${label}`)
            setSelectedRowKeys([])
            invalidate({ resource: 'admin_videos_list', invalidates: ['list'] })
          } else {
            message.error(result.msg || '批量操作失败')
          }
        } catch (error) {
          console.error(`Batch ${action} error:`, error)
          message.error('批量操作失败，请重试')
        } finally {
          setBatchLoading(false)
        }
      }
    })
  }

  // 批量通过审核 (保留原函数名，内部调用通用函数)
  const handleBatchApprove = () => handleBatchAction('approve', '通过审核')

  // 行选择配置
  const rowSelection = {
    selectedRowKeys,
    onChange: (newSelectedRowKeys: React.Key[]) => {
      setSelectedRowKeys(newSelectedRowKeys)
    }
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
      title: newIsAdult ? '确认标记成人' : '确认取消成人',
      content: newIsAdult ? '确定将该内容标记为成人吗？' : '确定要取消该内容的成人标记吗？',
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
              console.log('[VideoList] toggle adult done, refetch admin_videos_list:', {
                id: record.id,
                is_adult: newIsAdult
              })
              invalidate({ resource: 'admin_videos_list', invalidates: ['list'] })
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

  // 🎯 切换东南亚板块标记
  const handleToggleSea = (record: any) => {
    const newValue = !record.is_sea
    Modal.confirm({
      title: newValue ? '确认标记东南亚' : '确认取消东南亚',
      content: newValue ? '确定将该作品标记为东南亚板块吗？' : '确定要取消该作品的东南亚标记吗？',
      onOk: () => {
        updateVideo(
          {
            resource: 'videos',
            id: record.id,
            values: {
              is_sea: newValue
            }
          },
          {
            onSuccess: () => {
              message.success(newValue ? '已标记为东南亚' : '已取消东南亚')
              console.log('[VideoList] toggle sea done, refetch admin_videos_list:', {
                id: record.id,
                is_sea: newValue
              })
              invalidate({ resource: 'admin_videos_list', invalidates: ['list'] })
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

  // 🎯 批量刷新抖音链接
  const handleRefreshDouyinLinks = async () => {
    setRefreshingDouyin(true)
    try {
      const { data: sessionData } = await supabaseClient.auth.getSession()
      const token = sessionData?.session?.access_token
      if (!token) {
        message.error('未登录或会话已过期')
        return
      }

      const response = await fetch(
        `${import.meta.env.VITE_APP_SERVER_URL}/admin/douyin/refresh-links`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`
          },
          body: JSON.stringify({
            ids: selectedRowKeys.length > 0 ? selectedRowKeys : undefined,
            limit: 20
          })
        }
      )

      const result = await response.json()
      if (result.code === 0) {
        message.success(result.data?.message || '刷新成功')
        if (result.data?.updated_count > 0) {
          invalidate({ resource: 'admin_videos_list', invalidates: ['list'] })
        }
      } else {
        message.error(result.msg || '操作失败')
      }
    } catch (error) {
      console.error('Refresh douyin error:', error)
      message.error('操作失败，请重试')
    } finally {
      setRefreshingDouyin(false)
    }
  }

  return (
    <>
      <List
        title="视频管理"
        headerButtons={
          <Space>
            <Tooltip title="针对 storage_type 为 douyin 的视频，重新获取失效播放链接。默认处理最近 20 条，如有勾选则处理勾选项。">
              <Button
                icon={<SyncOutlined />}
                onClick={handleRefreshDouyinLinks}
                loading={refreshingDouyin}
              >
                刷新抖音链接
              </Button>
            </Tooltip>
            <Button type="primary" onClick={() => navigate('/videos/douyin-create')}>
              抖音解析新增
            </Button>
          </Space>
        }
      >
        {/* 搜索和筛选表单 */}
        <Form {...searchFormProps} layout="inline" style={{ marginBottom: 16, gap: '8px 0' }}>
          <Form.Item name="user_q" label="作者">
            <Input placeholder="昵称/用户名/ID" allowClear style={{ width: 160 }} />
          </Form.Item>
          <Form.Item name="description" label="描述">
            <Input placeholder="关键词" allowClear style={{ width: 140 }} />
          </Form.Item>
          <Form.Item name="video_id" label="视频ID">
            <Input placeholder="UUID" allowClear style={{ width: 120 }} />
          </Form.Item>
          <Form.Item name="status" label="状态">
            <Select placeholder="视频状态" allowClear style={{ width: 100 }}>
              <Select.Option value="draft">草稿</Select.Option>
              <Select.Option value="processing">处理中</Select.Option>
              <Select.Option value="ready">就绪</Select.Option>
              <Select.Option value="published">已发布</Select.Option>
              <Select.Option value="failed">失败</Select.Option>
            </Select>
          </Form.Item>
          <Form.Item name="review_status" label="审核">
            <Select placeholder="审核状态" allowClear style={{ width: 110 }}>
              <Select.Option value="pending">待审核</Select.Option>
              <Select.Option value="auto_approved">自动通过</Select.Option>
              <Select.Option value="manual_review">人工审核</Select.Option>
              <Select.Option value="approved">已通过</Select.Option>
              <Select.Option value="rejected">已拒绝</Select.Option>
            </Select>
          </Form.Item>
          <Form.Item name="content_type" label="类型">
            <Select placeholder="全部" allowClear style={{ width: 90 }}>
              <Select.Option value="video">🎬 视频</Select.Option>
              <Select.Option value="image">🖼️ 图片</Select.Option>
              <Select.Option value="album">📷 相册</Select.Option>
              <Select.Option value="collection">📦 合集</Select.Option>
            </Select>
          </Form.Item>
          <Form.Item name="is_recommended" label="推荐">
            <Select placeholder="全部" allowClear style={{ width: 90 }}>
              <Select.Option value="true">⭐ 是</Select.Option>
              <Select.Option value="false">否</Select.Option>
            </Select>
          </Form.Item>
          <Form.Item name="is_adult" label="成人">
            <Select placeholder="全部" allowClear style={{ width: 90 }}>
              <Select.Option value="true">🔞 是</Select.Option>
              <Select.Option value="false">否</Select.Option>
            </Select>
          </Form.Item>
          <Form.Item name="is_sea" label="东南亚">
            <Select placeholder="全部" allowClear style={{ width: 90 }}>
              <Select.Option value="true">🌏 是</Select.Option>
              <Select.Option value="false">否</Select.Option>
            </Select>
          </Form.Item>
          <Form.Item>
            <Space>
              <Button type="primary" htmlType="submit">
                搜索
              </Button>
              <Button
                onClick={() => {
                  searchFormProps.form?.resetFields()
                  searchFormProps.onFinish?.({})
                }}
              >
                重置
              </Button>
            </Space>
          </Form.Item>
        </Form>

        {/* 批量操作按钮 */}
        {selectedRowKeys.length > 0 && (
          <div style={{ marginBottom: 16 }}>
            <Space size="middle">
              <Button type="primary" onClick={handleBatchApprove} loading={batchLoading}>
                批量通过审核 ({selectedRowKeys.length})
              </Button>
              <Button.Group>
                <Button
                  danger
                  onClick={() => handleBatchAction('set_adult', '设为成人')}
                  loading={batchLoading}
                >
                  批量成人
                </Button>
                <Button
                  onClick={() => handleBatchAction('unset_adult', '取消成人')}
                  loading={batchLoading}
                >
                  取消
                </Button>
              </Button.Group>
              <Button.Group>
                <Button
                  type="primary"
                  style={{ background: '#722ed1', borderColor: '#722ed1' }}
                  onClick={() => handleBatchAction('set_sea', '设为东南亚')}
                  loading={batchLoading}
                >
                  批量东南亚
                </Button>
                <Button
                  onClick={() => handleBatchAction('unset_sea', '取消东南亚')}
                  loading={batchLoading}
                >
                  取消
                </Button>
              </Button.Group>
              <Button
                danger
                onClick={() => handleBatchAction('delete', '删除')}
                loading={batchLoading}
              >
                批量删除 ({selectedRowKeys.length})
              </Button>
              <Button onClick={() => setSelectedRowKeys([])}>取消选择</Button>
            </Space>
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
              const mediaItems = parseImages(record.media_list || record.images)

              // 使用 data URI 作为占位图，避免外部请求失败
              const placeholderImage =
                'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iODAiIGhlaWdodD0iODAiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+PHJlY3Qgd2lkdGg9IjgwIiBoZWlnaHQ9IjgwIiBmaWxsPSIjZjBmMGYwIi8+PHRleHQgeD0iNTAiIHk9IjQwIiBmb250LWZhbWlseT0iQXJpYWwiIGZvbnQtc2l6ZT0iMTIiIGZpbGw9IiM5OTk5OTkiIHRleHQtYW5jaG9yPSJtaWRkbGUiIGR5PSIuM2VtIj7mmoLml6DlpLHotKU8L3RleHQ+PC9zdmc+'

              return coverUrl ? (
                <div style={{ position: 'relative' }}>
                  <img
                    src={coverUrl}
                    alt="封面"
                    style={{
                      width: 80,
                      height: 80,
                      objectFit: 'cover',
                      borderRadius: 4,
                      cursor: 'pointer'
                    }}
                    onClick={(e) => {
                      e.stopPropagation()
                      handlePreview(record)
                    }}
                    onError={(e) => {
                      const img = e.target as HTMLImageElement
                      // 防止重复触发错误处理
                      if (img.src !== placeholderImage) {
                        img.src = placeholderImage
                        img.style.objectFit = 'contain'
                      }
                    }}
                  />
                  {/* 相册/合集显示媒体数量角标 */}
                  {(contentType === 'album' || contentType === 'collection') &&
                    mediaItems.length > 1 && (
                      <div
                        style={{
                          position: 'absolute',
                          top: 4,
                          right: 4,
                          background:
                            contentType === 'collection'
                              ? 'rgba(114, 46, 209, 0.8)'
                              : 'rgba(0,0,0,0.6)',
                          color: 'white',
                          fontSize: 10,
                          padding: '2px 6px',
                          borderRadius: 8
                        }}
                      >
                        {mediaItems.length}
                        {contentType === 'collection' ? '集' : '张'}
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
                    justifyContent: 'center',
                    fontSize: 12,
                    color: '#999'
                  }}
                >
                  无封面
                </div>
              )
            }}
          />

          <Table.Column
            title="作者信息"
            width={180}
            render={(_, record: any) => {
              const user = record.profiles
              const nickname = user?.nickname || '未知用户'
              const numericId = user?.numeric_id || '-'
              let avatar = user?.avatar_url

              if (typeof avatar === 'object' && avatar !== null) {
                avatar = avatar.url_list?.[0] || avatar.url
              }

              // 使用 data URI 作为头像占位图
              const avatarPlaceholder =
                'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMzIiIGhlaWdodD0iMzIiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+PGNpcmNsZSBjeD0iMTYiIGN5PSIxNiIgcj0iMTYiIGZpbGw9IiNmMGYwZjAiLz48Y2lyY2xlIGN4PSIxNiIgY3k9IjEyIiByPSI1IiBmaWxsPSIjOTk5OTk5Ii8+PHBhdGggZD0iTTggMjZjMC00IDMuNTgtNyA4LTdzOCAzIDggNyIgZmlsbD0iIzk5OTk5OSIvPjwvc3ZnPg=='

              return (
                <Space direction="vertical" size={0}>
                  <Space>
                    <img
                      src={avatar || avatarPlaceholder}
                      alt={nickname}
                      style={{ width: 32, height: 32, borderRadius: '50%', objectFit: 'cover' }}
                      onError={(e) => {
                        const img = e.target as HTMLImageElement
                        if (img.src !== avatarPlaceholder) {
                          img.src = avatarPlaceholder
                        }
                      }}
                    />
                    <span style={{ fontWeight: 500 }}>{nickname}</span>
                  </Space>
                  <small style={{ color: '#999', marginLeft: 36 }}>ID: {numericId}</small>
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
            render={(value) => formatBeijingTime(value)}
          />

          <Table.Column
            title="操作"
            width={320}
            fixed="right"
            render={(_, record: any) => (
              <Space size="small">
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
                  style={
                    record.is_adult
                      ? undefined
                      : { borderColor: '#ff4d4f', color: '#ff4d4f', background: 'transparent' }
                  }
                >
                  成人
                </Button>

                {/* 东南亚板块标记按钮 */}
                <Button
                  type={record.is_sea ? 'primary' : 'default'}
                  size="small"
                  onClick={() => handleToggleSea(record)}
                  style={
                    record.is_sea
                      ? { background: '#722ed1', borderColor: '#722ed1', color: '#fff' }
                      : { borderColor: '#722ed1', color: '#722ed1' }
                  }
                >
                  东南亚
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

      {/* 预览弹窗（视频/图片/相册/合集） */}
      <Modal
        title={
          previewContentType === 'video'
            ? '视频预览'
            : previewContentType === 'album'
              ? `相册预览 (${currentImageIndex + 1}/${previewMediaItems.length})`
              : previewContentType === 'collection'
                ? `合集预览 (${currentImageIndex + 1}/${previewMediaItems.length})`
                : '图片预览'
        }
        open={previewModalVisible}
        onCancel={handleClosePreview}
        footer={null}
        width={800}
        centered
      >
        {/* 1. 普通单视频预览 */}
        {previewContentType === 'video' && currentVideoUrl && (
          <div>
            <div style={{ marginBottom: 12 }}>
              <Space>
                <Button
                  size="small"
                  onClick={() => window.open(currentVideoUrl, '_blank', 'noopener,noreferrer')}
                >
                  新标签打开
                </Button>
              </Space>
            </div>

            <HlsVideo
              key={currentVideoUrl}
              src={currentVideoUrl}
              style={{ width: '100%', maxHeight: '70vh' }}
              muted={false}
              onVideoRef={(ref: any) => {
                videoPlayerRefs.current.mainVideo = ref
              }}
              onError={() => {
                message.warning('预览播放失败（可能 403 防盗链）')
              }}
            />
          </div>
        )}

        {/* 2. 图片/相册/合集 预览 */}
        {(previewContentType === 'image' ||
          previewContentType === 'album' ||
          previewContentType === 'collection') &&
          previewMediaItems.length > 0 && (
            <div style={{ position: 'relative', textAlign: 'center', minHeight: '400px' }}>
              {/* 根据媒体类型渲染 */}
              {previewMediaItems[currentImageIndex]?.type === 'video' ? (
                <div key={previewMediaItems[currentImageIndex].file_id}>
                  <div style={{ marginBottom: 12 }}>
                    <Tag color="purple">视频内容</Tag>
                    <small style={{ color: '#999' }}>
                      {previewMediaItems[currentImageIndex].file_id}
                    </small>
                  </div>
                  <HlsVideo
                    key={previewMediaItems[currentImageIndex].file_id}
                    src={buildCdnUrl(
                      previewMediaItems[currentImageIndex].play_url ||
                        previewMediaItems[currentImageIndex].url ||
                        previewMediaItems[currentImageIndex].file_id
                    )}
                    autoPlay
                    style={{ maxWidth: '100%', maxHeight: '60vh' }}
                    onVideoRef={(ref: any) => {
                      videoPlayerRefs.current.mediaVideo = ref
                    }}
                    onError={() => message.warning('视频加载失败')}
                  />
                </div>
              ) : (
                <img
                  src={buildCdnUrl(
                    previewMediaItems[currentImageIndex].play_url ||
                      previewMediaItems[currentImageIndex].url ||
                      previewMediaItems[currentImageIndex].file_id
                  )}
                  alt={`媒体 ${currentImageIndex + 1}`}
                  style={{ maxWidth: '100%', maxHeight: '70vh', objectFit: 'contain' }}
                  onError={(e) => {
                    const img = e.target as HTMLImageElement
                    // 使用 data URI 作为预览图占位图
                    const previewPlaceholder =
                      'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNDAwIiBoZWlnaHQ9IjQwMCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48cmVjdCB3aWR0aD0iNDAwIiBoZWlnaHQ9IjQwMCIgZmlsbD0iI2YwZjBmMCIvPjx0ZXh0IHg9IjUwJSIgeT0iNTAlIiBmb250LWZhbWlseT0iQXJpYWwiIGZvbnQtc2l6ZT0iMTYiIGZpbGw9IiM5OTk5OTkiIHRleHQtYW5jaG9yPSJtaWRkbGUiIGR5PSIuM2VtIj7mmoLml6DlpLHotKU8L3RleHQ+PC9zdmc+'
                    if (img.src !== previewPlaceholder) {
                      img.src = previewPlaceholder
                    }
                  }}
                />
              )}

              {/* 左右切换按钮 */}
              {previewMediaItems.length > 1 && (
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
                      borderRadius: '50%',
                      zIndex: 10
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
                      borderRadius: '50%',
                      zIndex: 10
                    }}
                  />
                </>
              )}

              {/* 指示器 */}
              {previewMediaItems.length > 1 && (
                <div style={{ marginTop: 16, display: 'flex', justifyContent: 'center', gap: 8 }}>
                  {previewMediaItems.map((_, index) => (
                    <div
                      key={index}
                      onClick={() => {
                        // 🎯 切换前停止当前视频
                        if (videoPlayerRefs.current.mediaVideo) {
                          const { video, hls } = videoPlayerRefs.current.mediaVideo
                          video.pause()
                          video.currentTime = 0
                          if (hls) {
                            hls.destroy()
                          }
                          videoPlayerRefs.current.mediaVideo = undefined
                        }
                        setCurrentImageIndex(index)
                      }}
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
