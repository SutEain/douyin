import { List, useTable } from '@refinedev/antd'
import {
  Table,
  Space,
  Button,
  Image,
  Switch,
  InputNumber,
  message,
  Tag,
  Form,
  Input,
  Select
} from 'antd'
import { useInvalidate, useUpdate } from '@refinedev/core'
import { useNavigate } from 'react-router-dom'
import { useState } from 'react'
import dayjs from 'dayjs'
import { supabaseClient } from '../../supabaseClient'

type LiveRoomRow = {
  id: string
  title?: string | null
  description?: string | null
  category?: string | null
  stream_url: string
  cover_url?: string | null
  sort_order?: number | null
  is_active?: boolean
  status?: 'online' | 'offline' | 'unknown' | string | null
  last_checked_at?: string | null
  check_count?: number | null
  last_error?: string | null
  updated_at?: string | null
  created_at?: string | null
}

export const LiveRoomList = () => {
  const navigate = useNavigate()
  const invalidate = useInvalidate()
  const { mutate: updateOne } = useUpdate()
  const [selectedRowKeys, setSelectedRowKeys] = useState<React.Key[]>([])
  const [bulkProbing, setBulkProbing] = useState(false)

  const { tableProps, searchFormProps } = useTable<LiveRoomRow>({
    resource: 'live_rooms',
    sorters: {
      initial: [
        { field: 'is_active', order: 'desc' },
        { field: 'sort_order', order: 'desc' },
        { field: 'updated_at', order: 'desc' }
      ]
    },
    pagination: {
      pageSize: 100
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

  function toggleActive(record: LiveRoomRow, next: boolean) {
    updateOne(
      {
        resource: 'live_rooms',
        id: record.id,
        values: { is_active: next }
      },
      {
        onSuccess: () => {
          message.success(next ? '已启用' : '已停用')
          invalidate({ resource: 'live_rooms', invalidates: ['list'] })
        },
        onError: (e: any) => {
          console.error('[LiveRoomList] toggleActive failed:', e)
          message.error(e?.message || '操作失败')
        }
      }
    )
  }

  function updateSort(record: LiveRoomRow, next: number | null) {
    updateOne(
      {
        resource: 'live_rooms',
        id: record.id,
        values: { sort_order: next ?? 0 }
      },
      {
        onSuccess: () => {
          message.success('排序已更新')
          invalidate({ resource: 'live_rooms', invalidates: ['list'] })
        },
        onError: (e: any) => {
          console.error('[LiveRoomList] updateSort failed:', e)
          message.error(e?.message || '操作失败')
        }
      }
    )
  }

  async function probeOne(record: LiveRoomRow) {
    try {
      const { data } = await supabaseClient.auth.getSession()
      const token = data?.session?.access_token
      if (!token) {
        message.error('未登录或会话已过期')
        return
      }

      const res = await fetch(`${import.meta.env.VITE_APP_SERVER_URL}/live/rooms/probe`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ ids: [record.id] })
      })
      const json = await res.json().catch(() => null)
      if (!res.ok || !json) {
        message.error('探测失败')
        return
      }
      if (json.code !== 0) {
        message.error(json.msg || '探测失败')
        return
      }
      message.success('已探测')
      invalidate({ resource: 'live_rooms', invalidates: ['list'] })
    } catch (e: any) {
      console.error('[LiveRoomList] probeOne failed:', e)
      message.error(e?.message || '探测失败')
    }
  }

  async function probeSelectedSequential() {
    const ids = selectedRowKeys.map((k) => String(k)).filter(Boolean)
    if (!ids.length) {
      message.warning('请先勾选要探测的直播间')
      return
    }
    if (bulkProbing) return

    try {
      setBulkProbing(true)

      const { data } = await supabaseClient.auth.getSession()
      const token = data?.session?.access_token
      if (!token) {
        message.error('未登录或会话已过期')
        return
      }

      const msgKey = 'live_rooms_bulk_probe'
      message.loading({ content: `开始探测 0/${ids.length}`, key: msgKey, duration: 0 })

      let okCount = 0
      let failCount = 0

      for (let i = 0; i < ids.length; i++) {
        const id = ids[i]
        message.loading({ content: `正在探测 ${i + 1}/${ids.length}`, key: msgKey, duration: 0 })

        try {
          const res = await fetch(`${import.meta.env.VITE_APP_SERVER_URL}/live/rooms/probe`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${token}`
            },
            body: JSON.stringify({ ids: [id] })
          })
          const json = await res.json().catch(() => null)
          if (res.ok && json && json.code === 0) okCount++
          else failCount++
        } catch {
          failCount++
        }

        // 轻微间隔，避免后端瞬时压力
        await new Promise((r) => setTimeout(r, 150))
      }

      message.success({ content: `探测完成：成功 ${okCount}，失败 ${failCount}`, key: msgKey })
      invalidate({ resource: 'live_rooms', invalidates: ['list'] })
    } finally {
      setBulkProbing(false)
    }
  }

  function play(record: LiveRoomRow) {
    const url = record?.stream_url
    if (!url) {
      message.warning('未填写直播地址')
      return
    }
    try {
      window.open(url, '_blank', 'noopener,noreferrer')
    } catch (e) {
      console.error('[LiveRoomList] window.open failed:', e)
      message.error('打开失败，请复制链接到新标签页')
    }
  }

  return (
    <List
      title="直播间管理"
      headerButtons={
        <Space>
          <Button type="primary" onClick={() => navigate('/live-rooms/create')}>
            新增直播间
          </Button>
          <Button
            onClick={() => probeSelectedSequential()}
            disabled={bulkProbing || selectedRowKeys.length === 0}
            loading={bulkProbing}
          >
            勾选探测
          </Button>
          <Button
            onClick={() => setSelectedRowKeys([])}
            disabled={bulkProbing || selectedRowKeys.length === 0}
          >
            清空勾选
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
            <Select.Option value="online">在线</Select.Option>
            <Select.Option value="offline">离线</Select.Option>
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
        rowSelection={{
          selectedRowKeys,
          onChange: (keys) => setSelectedRowKeys(keys)
        }}
        pagination={{
          ...(tableProps.pagination as any),
          pageSize: 100,
          showSizeChanger: true,
          pageSizeOptions: [20, 50, 100, 200]
        }}
      >
        <Table.Column
          title="封面"
          dataIndex="cover_url"
          render={(v: string) =>
            v ? (
              <Image
                src={v}
                width={120}
                height={68}
                style={{ objectFit: 'cover', borderRadius: 8 }}
                preview
              />
            ) : (
              <span style={{ color: '#999' }}>-</span>
            )
          }
        />
        <Table.Column title="标题" dataIndex="title" render={(v: any) => v || '-'} />
        <Table.Column title="描述" dataIndex="description" render={(v: any) => v || '-'} />
        <Table.Column title="类别" dataIndex="category" render={(v: any) => v || '-'} />
        <Table.Column
          title="排序"
          dataIndex="sort_order"
          render={(v: any, record: LiveRoomRow) => (
            <InputNumber
              value={typeof v === 'number' ? v : 0}
              size="small"
              style={{ width: 90 }}
              onChange={(val) => updateSort(record, typeof val === 'number' ? val : 0)}
            />
          )}
        />
        <Table.Column
          title="启用"
          dataIndex="is_active"
          render={(v: any, record: LiveRoomRow) => (
            <Switch checked={v === true} onChange={(checked) => toggleActive(record, checked)} />
          )}
        />
        <Table.Column
          title="探测状态"
          dataIndex="status"
          render={(v: any) => {
            const vv = String(v || 'unknown')
            if (vv === 'online') return <Tag color="green">在线</Tag>
            if (vv === 'offline') return <Tag color="red">离线</Tag>
            return <Tag>未知</Tag>
          }}
        />
        <Table.Column
          title="上次探测"
          dataIndex="last_checked_at"
          render={(v: any) => (v ? dayjs(v).format('YYYY-MM-DD HH:mm:ss') : '-')}
        />
        <Table.Column title="探测次数" dataIndex="check_count" render={(v: any) => v ?? 0} />
        <Table.Column title="错误" dataIndex="last_error" render={(v: any) => v || '-'} />
        <Table.Column
          title="更新时间"
          dataIndex="updated_at"
          render={(v: any) => (v ? dayjs(v).format('YYYY-MM-DD HH:mm:ss') : '-')}
        />
        <Table.Column
          title="操作"
          dataIndex="actions"
          render={(_, record: LiveRoomRow) => (
            <Space>
              <Button size="small" type="default" onClick={() => play(record)}>
                播放
              </Button>
              <Button size="small" onClick={() => probeOne(record)}>
                探测
              </Button>
              <Button size="small" onClick={() => navigate(`/live-rooms/edit/${record.id}`)}>
                编辑
              </Button>
            </Space>
          )}
        />
      </Table>
    </List>
  )
}
