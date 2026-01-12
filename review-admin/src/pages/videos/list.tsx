import { List, useTable, DateField } from '@refinedev/antd'
import { Table, Space, Button, Tag, Image, Form, Select, Input } from 'antd'
import { EyeOutlined } from '@ant-design/icons'
import { useNavigate } from 'react-router-dom'

export const VideoList = () => {
  const navigate = useNavigate()

  const { tableProps, searchFormProps } = useTable({
    resource: 'videos',
    sorters: {
      initial: [{ field: 'created_at', order: 'desc' }]
    },
    filters: {
      initial: [{ field: 'status', operator: 'eq', value: 'published' }]
    },
    meta: {
      select: '*, author:profiles!videos_author_id_fkey(id, nickname, username, numeric_id)'
    },
    pagination: {
      pageSize: 20
    },
    onSearch: (params: any) => {
      const filters: any[] = [{ field: 'status', operator: 'eq', value: 'published' }]

      if (params.review_status) {
        filters.push({ field: 'review_status', operator: 'eq', value: params.review_status })
      }
      if (params.is_adult) {
        filters.push({ field: 'is_adult', operator: 'eq', value: params.is_adult === 'true' })
      }
      if (params.title) {
        filters.push({ field: 'title', operator: 'contains', value: params.title })
      }

      return filters
    }
  })

  const getReviewStatusTag = (status: string) => {
    const statusMap: Record<string, { color: string; text: string }> = {
      pending: { color: 'orange', text: '待审核' },
      approved: { color: 'green', text: '已通过' },
      rejected: { color: 'red', text: '已拒绝' },
      flagged: { color: 'volcano', text: '已标记' }
    }
    const s = statusMap[status] || { color: 'default', text: status }
    return <Tag color={s.color}>{s.text}</Tag>
  }

  return (
    <List
      title="视频审核"
      headerButtons={
        <Button
          onClick={() => {
            searchFormProps.form?.resetFields()
            searchFormProps.form?.submit()
          }}
        >
          刷新
        </Button>
      }
    >
      <Form {...searchFormProps} layout="inline" style={{ marginBottom: 16 }}>
        <Form.Item name="review_status" label="审核状态">
          <Select placeholder="全部" allowClear style={{ width: 120 }}>
            <Select.Option value="pending">待审核</Select.Option>
            <Select.Option value="approved">已通过</Select.Option>
            <Select.Option value="rejected">已拒绝</Select.Option>
            <Select.Option value="flagged">已标记</Select.Option>
          </Select>
        </Form.Item>
        <Form.Item name="is_adult" label="内容类型">
          <Select placeholder="全部" allowClear style={{ width: 120 }}>
            <Select.Option value="false">正常</Select.Option>
            <Select.Option value="true">成人</Select.Option>
          </Select>
        </Form.Item>
        <Form.Item name="title" label="标题">
          <Input placeholder="搜索标题" allowClear />
        </Form.Item>
        <Form.Item>
          <Space>
            <Button type="primary" htmlType="submit">
              搜索
            </Button>
            <Button
              onClick={() => {
                searchFormProps.form?.resetFields()
                searchFormProps.form?.submit()
              }}
            >
              重置
            </Button>
          </Space>
        </Form.Item>
      </Form>

      <Table {...tableProps} rowKey="id" size="middle">
        <Table.Column
          title="封面"
          dataIndex="cover_url"
          width={100}
          render={(url: string) =>
            url ? (
              <Image
                src={url}
                width={80}
                height={80}
                style={{ objectFit: 'cover', borderRadius: 4 }}
                preview
              />
            ) : (
              <span style={{ color: '#999' }}>-</span>
            )
          }
        />
        <Table.Column
          title="标题"
          dataIndex="title"
          width={200}
          render={(title: string) => title || '-'}
        />
        <Table.Column
          title="作者"
          dataIndex={['author', 'nickname']}
          width={120}
          render={(nickname: string, record: any) =>
            nickname || record.author?.username || `ID: ${record.author?.numeric_id}` || '-'
          }
        />
        <Table.Column
          title="审核状态"
          dataIndex="review_status"
          width={100}
          render={(status: string) => getReviewStatusTag(status)}
        />
        <Table.Column
          title="内容类型"
          dataIndex="is_adult"
          width={100}
          render={(isAdult: boolean) => (
            <Tag color={isAdult ? 'red' : 'blue'}>{isAdult ? '成人' : '正常'}</Tag>
          )}
        />
        <Table.Column
          title="观看/点赞"
          width={120}
          render={(_: any, record: any) => (
            <span>
              {record.view_count || 0} / {record.like_count || 0}
            </span>
          )}
        />
        <Table.Column
          title="创建时间"
          dataIndex="created_at"
          width={180}
          render={(value: any) => <DateField value={value} format="YYYY-MM-DD HH:mm:ss" />}
        />
        <Table.Column
          title="操作"
          width={100}
          fixed="right"
          render={(_: any, record: any) => (
            <Space>
              <Button
                type="link"
                size="small"
                icon={<EyeOutlined />}
                onClick={() => navigate(`/videos/show/${record.id}`)}
              >
                查看
              </Button>
            </Space>
          )}
        />
      </Table>
    </List>
  )
}
