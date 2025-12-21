import { List, useTable } from '@refinedev/antd'
import { Table, Space, Button, Image } from 'antd'
import { useNavigate } from 'react-router-dom'
import dayjs from 'dayjs'

type LiveRoomRow = {
  id: string
  title?: string | null
  description?: string | null
  stream_url: string
  cover_url?: string | null
  updated_at?: string | null
  created_at?: string | null
}

export const LiveRoomList = () => {
  const navigate = useNavigate()

  const { tableProps } = useTable<LiveRoomRow>({
    resource: 'live_rooms',
    sorters: {
      initial: [
        { field: 'sort_order', order: 'desc' },
        { field: 'updated_at', order: 'desc' }
      ]
    }
  })

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
