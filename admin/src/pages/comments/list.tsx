import { List, useTable } from '@refinedev/antd'
import { Table, Space, Button, Tag, message, Modal, Input, Select, Tooltip, Popconfirm } from 'antd'
import { DeleteOutlined, SearchOutlined } from '@ant-design/icons'
import { useUpdate, useDelete } from '@refinedev/core'
import { useState } from 'react'
import dayjs from 'dayjs'
import utc from 'dayjs/plugin/utc'
import timezone from 'dayjs/plugin/timezone'
import { supabaseClient } from '../../supabaseClient'

dayjs.extend(utc)
dayjs.extend(timezone)

const reviewStatusMap: Record<string, { text: string; color: string }> = {
  pending: { text: '待审核', color: 'warning' },
  auto_approved: { text: '自动通过', color: 'success' },
  approved: { text: '已通过', color: 'success' },
  rejected: { text: '已拒绝', color: 'error' }
}

export const CommentList = () => {
  const { mutate: updateComment } = useUpdate()
  const { mutate: deleteComment } = useDelete()
  const [selectedRowKeys, setSelectedRowKeys] = useState<React.Key[]>([])
  const [batchDeleting, setBatchDeleting] = useState(false)

  const table = useTable({
    resource: 'video_comments',
    syncWithLocation: true,
    filters: {
      initial: [
        {
          field: 'deleted_at',
          operator: 'null',
          value: null
        }
      ]
    },
    sorters: {
      initial: [{ field: 'created_at', order: 'desc' }]
    },
    meta: {
      select: `
        *,
        profiles:user_id (
          numeric_id,
          nickname,
          tg_user_id
        ),
        videos:video_id (
          id,
          title,
          author_id
        )
      `
    },
    onSearch: (params: Record<string, any>) => {
      const filters: any[] = []

      // 只显示未删除的评论
      filters.push({
        field: 'deleted_at',
        operator: 'null',
        value: null
      })

      // 关键词搜索（评论内容）
      if (params.q && params.q.trim()) {
        filters.push({
          field: 'content',
          operator: 'contains',
          value: params.q.trim()
        })
      }

      // 审核状态筛选
      if (params.review_status && params.review_status !== 'all') {
        filters.push({
          field: 'review_status',
          operator: 'eq',
          value: params.review_status
        })
      }

      return filters
    }
  })

  const { tableProps, searchFormProps } = table

  // 格式化北京时间
  const formatBeijingTime = (dateStr: string) => {
    return dayjs(dateStr).tz('Asia/Shanghai').format('YYYY-MM-DD HH:mm:ss')
  }

  // 删除评论（软删除）
  const handleDelete = (record: any) => {
    Modal.confirm({
      title: '删除评论',
      content: `确定要删除这条评论吗？删除后用户将无法看到此评论。`,
      okText: '确定删除',
      okType: 'danger',
      cancelText: '取消',
      onOk: async () => {
        try {
          const { error } = await supabaseClient
            .from('video_comments')
            .update({ deleted_at: new Date().toISOString() })
            .eq('id', record.id)

          if (error) throw error

          message.success('删除成功')
          table.refetch()
        } catch (error: any) {
          console.error('[DeleteComment] Error:', error)
          message.error('删除失败：' + (error.message || '未知错误'))
        }
      }
    })
  }

  // 批量删除
  const handleBatchDelete = () => {
    if (selectedRowKeys.length === 0) {
      message.warning('请先选择要删除的评论')
      return
    }

    Modal.confirm({
      title: '批量删除评论',
      content: `确定要删除选中的 ${selectedRowKeys.length} 条评论吗？删除后用户将无法看到这些评论。`,
      okText: '确定删除',
      okType: 'danger',
      cancelText: '取消',
      onOk: async () => {
        setBatchDeleting(true)
        try {
          const { error } = await supabaseClient
            .from('video_comments')
            .update({ deleted_at: new Date().toISOString() })
            .in('id', selectedRowKeys)

          if (error) throw error

          message.success(`成功删除 ${selectedRowKeys.length} 条评论`)
          setSelectedRowKeys([])
          table.refetch()
        } catch (error: any) {
          console.error('[BatchDeleteComment] Error:', error)
          message.error('批量删除失败：' + (error.message || '未知错误'))
        } finally {
          setBatchDeleting(false)
        }
      }
    })
  }

  // 渲染评论内容（截断长文本）
  const renderContent = (content: string) => {
    if (!content) return '-'
    const maxLength = 100
    if (content.length > maxLength) {
      return (
        <Tooltip title={content}>
          <span>{content.substring(0, maxLength)}...</span>
        </Tooltip>
      )
    }
    return content
  }

  return (
    <List
      headerButtons={({ defaultButtons }) => [
        ...defaultButtons,
        <Button
          key="batch-delete"
          danger
          icon={<DeleteOutlined />}
          disabled={selectedRowKeys.length === 0 || batchDeleting}
          loading={batchDeleting}
          onClick={handleBatchDelete}
        >
          批量删除 ({selectedRowKeys.length})
        </Button>
      ]}
    >
      <Space direction="vertical" style={{ width: '100%' }} size="middle">
        {/* 搜索表单 */}
        <div style={{ background: '#fff', padding: 16, borderRadius: 8 }}>
          <Input.Group compact style={{ display: 'flex', gap: 8 }}>
            <Input
              {...searchFormProps.form.getFieldProps('q')}
              placeholder="搜索评论内容..."
              style={{ flex: 1 }}
              allowClear
              prefix={<SearchOutlined />}
            />
            <Select
              {...searchFormProps.form.getFieldProps('review_status')}
              placeholder="审核状态"
              style={{ width: 150 }}
              allowClear
              options={[
                { label: '全部', value: 'all' },
                { label: '待审核', value: 'pending' },
                { label: '已通过', value: 'approved' },
                { label: '自动通过', value: 'auto_approved' },
                { label: '已拒绝', value: 'rejected' }
              ]}
            />
            <Button
              type="primary"
              onClick={() => {
                searchFormProps.form.submit()
              }}
            >
              搜索
            </Button>
            <Button
              onClick={() => {
                searchFormProps.form.resetFields()
                searchFormProps.form.submit()
              }}
            >
              重置
            </Button>
          </Input.Group>
        </div>

        {/* 评论表格 */}
        <Table
          {...tableProps}
          rowKey="id"
          rowSelection={{
            selectedRowKeys,
            onChange: setSelectedRowKeys
          }}
          scroll={{ x: 1200 }}
        >
          <Table.Column
            title="评论内容"
            dataIndex="content"
            key="content"
            width={300}
            render={(text) => renderContent(text)}
          />
          <Table.Column
            title="用户"
            key="user"
            width={150}
            render={(record: any) => {
              const profile = record.profiles
              if (!profile) return '-'
              return (
                <div>
                  <div>{profile.nickname || `用户${profile.numeric_id}`}</div>
                  <div style={{ fontSize: 12, color: '#999' }}>ID: {profile.numeric_id}</div>
                </div>
              )
            }}
          />
          <Table.Column
            title="视频"
            key="video"
            width={200}
            render={(record: any) => {
              const video = record.videos
              if (!video) return '-'
              return (
                <Tooltip title={video.title || '未命名视频'}>
                  <div
                    style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                  >
                    {video.title || '未命名视频'}
                  </div>
                </Tooltip>
              )
            }}
          />
          <Table.Column
            title="点赞数"
            dataIndex="like_count"
            key="like_count"
            width={80}
            sorter
            render={(count) => count || 0}
          />
          <Table.Column
            title="审核状态"
            dataIndex="review_status"
            key="review_status"
            width={120}
            render={(status) => {
              const statusInfo = reviewStatusMap[status] || {
                text: status || '未知',
                color: 'default'
              }
              return <Tag color={statusInfo.color}>{statusInfo.text}</Tag>
            }}
          />
          <Table.Column
            title="发布时间"
            dataIndex="created_at"
            key="created_at"
            width={180}
            sorter
            render={(date) => formatBeijingTime(date)}
          />
          <Table.Column
            title="操作"
            key="actions"
            width={100}
            fixed="right"
            render={(record: any) => (
              <Space>
                <Popconfirm
                  title="确定要删除这条评论吗？"
                  description="删除后用户将无法看到此评论"
                  onConfirm={() => handleDelete(record)}
                  okText="确定"
                  cancelText="取消"
                  okType="danger"
                >
                  <Button type="link" danger size="small" icon={<DeleteOutlined />}>
                    删除
                  </Button>
                </Popconfirm>
              </Space>
            )}
          />
        </Table>
      </Space>
    </List>
  )
}
