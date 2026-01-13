import { List, useTable } from '@refinedev/antd'
import {
  Table,
  Space,
  Button,
  Image,
  InputNumber,
  message,
  Tag,
  Form,
  Input,
  Select,
  Tooltip
} from 'antd'
import { useInvalidate, useUpdate } from '@refinedev/core'
import { useState, useEffect, useRef } from 'react'
import dayjs from 'dayjs'
import { supabaseClient } from '../../supabaseClient'
import { InfoCircleOutlined } from '@ant-design/icons'

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

  // 🎯 实时人数状态管理
  const [realPresenceCounts, setRealPresenceCounts] = useState<Record<string, number>>({})
  const channelsRef = useRef<Record<string, any>>({})

  const { tableProps, searchFormProps } = useTable<OfficialLiveRoomRow>({
    resource: 'live_broadcast_rooms',
    syncWithLocation: false,
    meta: {
      select: '*, anchor:profiles!live_broadcast_rooms_anchor_id_fkey(id, nickname, avatar_url)',
      order: 'status.desc.nullslast,created_at.desc.nullslast'
    },
    sorters: {
      initial: [],
      mode: 'off'
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

  // 🎯 实时订阅逻辑：监听直播中的房间人数
  useEffect(() => {
    const liveRooms = tableProps.dataSource?.filter((r) => r.status === 'live') || []
    const liveRoomIds = new Set(liveRooms.map((r) => r.id))

    // 1. 清理不再直播或不在当前页面的房间订阅
    Object.keys(channelsRef.current).forEach((id) => {
      if (!liveRoomIds.has(id)) {
        console.log(`[Admin] Unsubscribing from room: ${id}`)
        supabaseClient.removeChannel(channelsRef.current[id])
        delete channelsRef.current[id]
        setRealPresenceCounts((prev) => {
          const next = { ...prev }
          delete next[id]
          return next
        })
      }
    })

    // 2. 为新出现的直播间建立订阅
    liveRooms.forEach((room) => {
      if (!channelsRef.current[room.id]) {
        console.log(`[Admin] Subscribing to presence for room: ${room.id}`)
        const channel = supabaseClient.channel(`live_room_${room.id}`)

        channel
          .on('presence', { event: 'sync' }, () => {
            const state = channel.presenceState()
            const count = Object.keys(state).length
            setRealPresenceCounts((prev) => ({
              ...prev,
              [room.id]: count
            }))
          })
          .subscribe((status) => {
            if (status === 'SUBSCRIBED') {
              console.log(`[Admin] Subscribed to presence for room: ${room.id}`)
            }
          })

        channelsRef.current[room.id] = channel
      }
    })

    return () => {
      // 组件卸载时不需要清理所有，因为依赖项会处理，但为了保险起见也可以全清
    }
  }, [tableProps.dataSource])

  // 组件完全卸载时清理所有订阅
  useEffect(() => {
    return () => {
      Object.values(channelsRef.current).forEach((ch) => supabaseClient.removeChannel(ch))
      channelsRef.current = {}
    }
  }, [])

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
          setLocalViewerCounts((prev) => {
            const next = { ...prev }
            next[record.id] = record.custom_viewer_count ?? null
            return next
          })
        }
      }
    )
  }

  // 显示的人数：真实人数 + 自定义偏移量
  function getDisplayViewerCount(record: OfficialLiveRoomRow): number {
    const realTimeCount = realPresenceCounts[record.id]
    const dbRealCount = record.viewer_count ?? 0
    // 如果有实时订阅的人数，优先使用实时人数作为“真实人数”参考
    const finalRealCount = realTimeCount !== undefined ? realTimeCount : dbRealCount

    return finalRealCount + (record.custom_viewer_count ?? 0)
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
        <Table.Column
          title={
            <Space>
              真实人数
              <Tooltip title="基于实时 Presence 统计的在线人数">
                <InfoCircleOutlined style={{ color: '#1890ff' }} />
              </Tooltip>
            </Space>
          }
          dataIndex="viewer_count"
          render={(v: any, record: OfficialLiveRoomRow) => {
            const realTimeCount = realPresenceCounts[record.id]
            if (record.status === 'live' && realTimeCount !== undefined) {
              return (
                <Space>
                  <span style={{ fontWeight: 'bold', color: '#52c41a' }}>{realTimeCount}</span>
                  <Tag color="success" style={{ fontSize: '10px', lineHeight: '16px' }}>
                    实时
                  </Tag>
                </Space>
              )
            }
            return v ?? 0
          }}
        />
        <Table.Column
          title={
            <Space>
              人数偏移量
              <Tooltip title="在真实人数的基础上增加的显示人数（例如设置为 100，真实 10 人，则显示 110 人）">
                <InfoCircleOutlined style={{ color: '#1890ff' }} />
              </Tooltip>
            </Space>
          }
          dataIndex="custom_viewer_count"
          render={(v: any, record: OfficialLiveRoomRow) => {
            // 🎯 优先使用本地状态，如果没有则使用服务器值
            const displayValue =
              localViewerCounts[record.id] !== undefined ? localViewerCounts[record.id] : (v ?? 0)

            return (
              <InputNumber
                value={displayValue}
                size="small"
                style={{ width: 120 }}
                min={0}
                placeholder="额外增加人数"
                disabled={updatingViewerCount === record.id}
                onChange={(val) => {
                  // 🎯 只更新本地状态，不触发API请求
                  const numVal = typeof val === 'number' ? val : 0
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
                      : (v ?? 0)
                  // 🎯 如果值没有变化，不触发更新
                  if (currentValue === (v ?? 0)) {
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
          title="前端显示人数"
          render={(_, record: OfficialLiveRoomRow) => {
            const displayCount = getDisplayViewerCount(record)
            const hasOffset = (record.custom_viewer_count ?? 0) > 0
            const isRealTime = realPresenceCounts[record.id] !== undefined

            return (
              <span>
                <span style={{ fontWeight: 'bold' }}>{displayCount}</span>
                {hasOffset && (
                  <Tag color="blue" style={{ marginLeft: 8 }}>
                    +{record.custom_viewer_count} 偏移
                  </Tag>
                )}
                {isRealTime && (
                  <Tag color="success" style={{ marginLeft: 8 }}>
                    实时
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
