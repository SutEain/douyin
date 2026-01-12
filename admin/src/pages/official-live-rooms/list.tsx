import { List, useTable } from '@refinedev/antd'
import { Table, Space, Button, Image, InputNumber, message, Tag, Form, Input, Select } from 'antd'
import { useInvalidate, useUpdate } from '@refinedev/core'
import { useState } from 'react'
import dayjs from 'dayjs'

type OfficialLiveRoomRow = {
  id: string
  title?: string | null
  status?: 'pending' | 'live' | 'ended' | string | null
  viewer_count?: number | null
  custom_viewer_count?: number | null
  total_likes?: number | null
  anchor_id?: string | null
  anchor?: {
    id: string
    nickname?: string | null
    avatar_url?: string | null
  } | null
  created_at?: string | null
  updated_at?: string | null
}

export const OfficialLiveRoomList = () => {
  const invalidate = useInvalidate()
  const { mutate: updateOne } = useUpdate()
  const [updatingViewerCount, setUpdatingViewerCount] = useState<string | null>(null)
  // 🎯 本地状态管理输入值，避免每次输入都触发更新
  const [localViewerCounts, setLocalViewerCounts] = useState<Record<string, number | null>>({})

  const { tableProps, searchFormProps } = useTable<OfficialLiveRoomRow>({
    resource: 'live_broadcast_rooms',
    syncWithLocation: false, // 🎯 禁用 URL 同步，避免排序参数冲突
    meta: {
      select: '*, anchor:profiles!live_broadcast_rooms_anchor_id_fkey(id, nickname, avatar_url)',
      // 🎯 明确指定排序，使用 PostgREST 的 order 参数格式，避免使用不存在的字段
      // 注意：order 参数会覆盖 sorters 配置
      order: 'status.desc.nullslast,created_at.desc.nullslast'
    },
    // 🎯 不设置 sorters，完全依赖 meta.order 来避免字段冲突
    sorters: {
      initial: [],
      mode: 'off' // 🎯 完全禁用 sorters，只使用 meta.order
    },
    pagination: {
      pageSize: 50
    },
    filters: {
      initial: []
    },
    onSearch: (params: any) => {
      const filters: any[] = []
      if (params.title) {
        filters.push({ field: 'title', operator: 'contains', value: params.title })
      }
      if (params.status) {
        filters.push({ field: 'status', operator: 'eq', value: params.status })
      }
      return filters
    }
  })

  function updateCustomViewerCount(record: OfficialLiveRoomRow, value: number | null) {
    if (updatingViewerCount === record.id) return

    setUpdatingViewerCount(record.id)
    updateOne(
      {
        resource: 'live_broadcast_rooms',
        id: record.id,
        values: { custom_viewer_count: value }
      },
      {
        onSuccess: () => {
          message.success('自定义人数已更新')
          invalidate({ resource: 'live_broadcast_rooms', invalidates: ['list'] })
          setUpdatingViewerCount(null)
          // 🎯 清除本地状态，使用服务器返回的值
          setLocalViewerCounts((prev) => {
            const next = { ...prev }
            delete next[record.id]
            return next
          })
        },
        onError: (e: any) => {
          console.error('[OfficialLiveRoomList] updateCustomViewerCount failed:', e)
          message.error(e?.message || '更新失败')
          setUpdatingViewerCount(null)
          // 🎯 更新失败时，恢复本地状态为原始值
          setLocalViewerCounts((prev) => {
            const next = { ...prev }
            next[record.id] = record.custom_viewer_count ?? null
            return next
          })
        }
      }
    )
  }

  // 显示的人数（优先使用自定义人数，否则使用真实人数）
  function getDisplayViewerCount(record: OfficialLiveRoomRow): number {
    return record.custom_viewer_count ?? record.viewer_count ?? 0
  }

  return (
    <List
      title="官方直播间管理"
      headerButtons={
        <Space>
          <Button
            onClick={() => {
              searchFormProps.form?.resetFields()
              searchFormProps.onFinish?.({})
            }}
          >
            刷新
          </Button>
        </Space>
      }
    >
      <Form {...searchFormProps} layout="inline" style={{ marginBottom: 16 }}>
        <Form.Item name="title" label="标题">
          <Input placeholder="搜索标题" allowClear />
        </Form.Item>
        <Form.Item name="status" label="状态">
          <Select placeholder="选择状态" allowClear style={{ width: 120 }}>
            <Select.Option value="pending">待开始</Select.Option>
            <Select.Option value="live">直播中</Select.Option>
            <Select.Option value="ended">已结束</Select.Option>
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
      <Table
        {...tableProps}
        rowKey="id"
        size="middle"
        pagination={{
          ...(tableProps.pagination as any),
          pageSize: 50,
          showSizeChanger: true,
          pageSizeOptions: [20, 50, 100]
        }}
      >
        <Table.Column
          title="封面"
          dataIndex={['anchor', 'avatar_url']}
          render={(v: string) =>
            v ? (
              <Image
                src={v}
                width={80}
                height={80}
                style={{ objectFit: 'cover', borderRadius: 8 }}
                preview
              />
            ) : (
              <span style={{ color: '#999' }}>-</span>
            )
          }
        />
        <Table.Column title="标题" dataIndex="title" render={(v: any) => v || '-'} />
        <Table.Column
          title="主播"
          dataIndex={['anchor', 'nickname']}
          render={(v: any) => v || '未知'}
        />
        <Table.Column
          title="状态"
          dataIndex="status"
          render={(v: any) => {
            const status = String(v || 'pending')
            if (status === 'live') return <Tag color="green">直播中</Tag>
            if (status === 'ended') return <Tag color="red">已结束</Tag>
            return <Tag>待开始</Tag>
          }}
        />
        <Table.Column title="真实人数" dataIndex="viewer_count" render={(v: any) => v ?? 0} />
        <Table.Column
          title="自定义人数"
          dataIndex="custom_viewer_count"
          render={(v: any, record: OfficialLiveRoomRow) => {
            // 🎯 优先使用本地状态，如果没有则使用服务器值
            const displayValue =
              localViewerCounts[record.id] !== undefined
                ? localViewerCounts[record.id]
                : (v ?? null)

            return (
              <InputNumber
                value={displayValue}
                size="small"
                style={{ width: 120 }}
                min={0}
                placeholder="使用真实人数"
                disabled={updatingViewerCount === record.id}
                onChange={(val) => {
                  // 🎯 只更新本地状态，不触发API请求
                  const numVal = typeof val === 'number' ? val : null
                  setLocalViewerCounts((prev) => ({
                    ...prev,
                    [record.id]: numVal
                  }))
                }}
                onBlur={() => {
                  // 🎯 失去焦点时才触发更新
                  const currentValue =
                    localViewerCounts[record.id] !== undefined
                      ? localViewerCounts[record.id]
                      : (v ?? null)
                  // 🎯 如果值没有变化，不触发更新
                  if (currentValue === (v ?? null)) {
                    // 清除本地状态
                    setLocalViewerCounts((prev) => {
                      const next = { ...prev }
                      delete next[record.id]
                      return next
                    })
                    return
                  }
                  updateCustomViewerCount(record, currentValue)
                }}
                onPressEnter={(e) => {
                  // 🎯 按回车时也触发更新
                  ;(e.target as HTMLInputElement).blur()
                }}
              />
            )
          }}
        />
        <Table.Column
          title="显示人数"
          render={(_, record: OfficialLiveRoomRow) => {
            const displayCount = getDisplayViewerCount(record)
            const isCustom = record.custom_viewer_count !== null
            return (
              <span>
                {displayCount}
                {isCustom && (
                  <Tag color="blue" style={{ marginLeft: 8 }}>
                    自定义
                  </Tag>
                )}
              </span>
            )
          }}
        />
        <Table.Column title="点赞数" dataIndex="total_likes" render={(v: any) => v ?? 0} />
        <Table.Column
          title="创建时间"
          dataIndex="created_at"
          render={(v: any) => (v ? dayjs(v).format('YYYY-MM-DD HH:mm:ss') : '-')}
        />
        <Table.Column
          title="更新时间"
          dataIndex="updated_at"
          render={(v: any) => (v ? dayjs(v).format('YYYY-MM-DD HH:mm:ss') : '-')}
        />
      </Table>
    </List>
  )
}
