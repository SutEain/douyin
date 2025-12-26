import { List, useTable } from '@refinedev/antd'
import { Table, Space, Avatar, Button, Tag, Switch, InputNumber, Select } from 'antd'
import { EditOutlined, DeleteOutlined } from '@ant-design/icons'
import { useUpdate, useDelete } from '@refinedev/core'

export const GiftList = () => {
  const { mutate: updateGift } = useUpdate()
  const { mutate: deleteGift } = useDelete()

  const { tableProps } = useTable({
    resource: 'gifts',
    sorters: {
      initial: [{ field: 'sort_order', order: 'asc' }]
    },
    pagination: {
      pageSize: 50
    }
  })

  // 快速切换启用状态
  const handleToggleActive = (record: any, checked: boolean) => {
    updateGift({
      resource: 'gifts',
      id: record.id,
      values: { is_active: checked },
      successNotification: () => ({
        message: '状态已更新',
        type: 'success'
      })
    })
  }

  // 快速修改排序
  const handleUpdateSort = (record: any, value: number | null) => {
    if (value === null) return
    updateGift({
      resource: 'gifts',
      id: record.id,
      values: { sort_order: value },
      mutationMode: 'undoable'
    })
  }

  // 快速修改价格
  const handleUpdatePrice = (record: any, value: number | null) => {
    if (value === null) return
    updateGift({
      resource: 'gifts',
      id: record.id,
      values: { price: value },
      mutationMode: 'undoable'
    })
  }

  // 快速修改比例
  const handleUpdateRatio = (record: any, value: number | null) => {
    if (value === null) return
    updateGift({
      resource: 'gifts',
      id: record.id,
      values: { video_ratio: value },
      mutationMode: 'undoable'
    })
  }

  return (
    <List>
      <Table {...tableProps} rowKey="id">
        <Table.Column
          dataIndex="icon_filename"
          title="图标"
          width={80}
          render={(value) => (
            <Avatar
              src={`/assets/gifts/icons/${value}`}
              shape="square"
              size={40}
              style={{ backgroundColor: '#f5f5f5', padding: 4 }}
              icon={!value && <EditOutlined />}
            />
          )}
        />
        <Table.Column dataIndex="name" title="礼物名称" width={150} />
        <Table.Column
          dataIndex="price"
          title="价格(抖币)"
          width={120}
          render={(value, record: any) => (
            <InputNumber
              min={1}
              value={value}
              onChange={(v) => handleUpdatePrice(record, v)}
              style={{ width: 100 }}
            />
          )}
        />
        <Table.Column
          dataIndex="sort_order"
          title="排序"
          width={120}
          render={(value, record: any) => (
            <InputNumber
              min={0}
              value={value}
              onChange={(v) => handleUpdateSort(record, v)}
              style={{ width: 80 }}
            />
          )}
        />
        <Table.Column
          dataIndex="video_ratio"
          title="VAP比例"
          width={120}
          render={(value, record: any) => (
            <Select
              value={value}
              style={{ width: 100 }}
              onChange={(v) => handleUpdateRatio(record, v)}
              options={[
                { label: '1/2 宽', value: 0.5 },
                { label: '2/3 窄', value: 0.6666 }
              ]}
            />
          )}
        />
        <Table.Column
          dataIndex="has_effect"
          title="特效"
          width={100}
          render={(value) => (value ? <Tag color="gold">视频特效</Tag> : <Tag>无特效</Tag>)}
        />
        <Table.Column
          dataIndex="is_active"
          title="启用状态"
          width={100}
          render={(value, record: any) => (
            <Switch
              checked={value}
              size="small"
              onChange={(checked) => handleToggleActive(record, checked)}
            />
          )}
        />
        <Table.Column
          title="操作"
          dataIndex="actions"
          render={(_, record: any) => (
            <Space>
              <Button
                danger
                size="small"
                icon={<DeleteOutlined />}
                onClick={() => {
                  if (confirm(`确定要删除礼物 "${record.name}" 吗？`)) {
                    deleteGift({
                      resource: 'gifts',
                      id: record.id
                    })
                  }
                }}
              />
            </Space>
          )}
        />
      </Table>
    </List>
  )
}
