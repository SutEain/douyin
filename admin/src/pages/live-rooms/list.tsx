import { List, useTable } from '@refinedev/antd'
import { Table, Space, Button, Image, Switch, InputNumber, message } from 'antd'
import { useInvalidate, useUpdate } from '@refinedev/core'
import { useNavigate } from 'react-router-dom'
import dayjs from 'dayjs'

type LiveRoomRow = {
  id: string
  title?: string | null
  description?: string | null
  category?: string | null
  stream_url: string
  cover_url?: string | null
  sort_order?: number | null
  is_active?: boolean
  updated_at?: string | null
  created_at?: string | null
}

export const LiveRoomList = () => {
  const navigate = useNavigate()
  const invalidate = useInvalidate()
  const { mutate: updateOne } = useUpdate()

  const { tableProps } = useTable<LiveRoomRow>({
    resource: 'live_rooms',
    sorters: {
      initial: [
        { field: 'sort_order', order: 'desc' },
        { field: 'updated_at', order: 'desc' }
      ]
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

  return (
    <List
      title="直播间管理"
      headerButtons={
        <Button type="primary" onClick={() => navigate('/live-rooms/create')}>
          新增直播间
        </Button>
      }
    >
      <Table {...tableProps} rowKey="id" size="middle">
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
          title="更新时间"
          dataIndex="updated_at"
          render={(v: any) => (v ? dayjs(v).format('YYYY-MM-DD HH:mm:ss') : '-')}
        />
        <Table.Column
          title="操作"
          dataIndex="actions"
          render={(_, record: LiveRoomRow) => (
            <Space>
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
