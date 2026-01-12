import { List, useTable } from '@refinedev/antd'
import { Table, Tag, Space, Button, Input, Select, message, Modal, Avatar, Form } from 'antd'
import { supabaseClient } from '../../supabaseClient'
import { CheckCircleOutlined, CloseCircleOutlined, EyeOutlined, UserOutlined } from '@ant-design/icons'
import dayjs from 'dayjs'

export const VideoList = () => {
  const { tableProps, searchFormProps } = useTable({
    resource: 'videos',
    syncWithLocation: true,
    pagination: { pageSize: 10 },
    sorters: { initial: [{ field: 'created_at', order: 'desc' }] },
    meta: {
      select: '*, profiles:user_id(nickname, numeric_id, avatar_url)'
    },
    onSearch: (params: any) => {
      const filters: any[] = []
      // 🎯 核心逻辑：只根据当前表单里的值生成 Filter
      if (params.title) {
        filters.push({ field: 'title', operator: 'contains', value: params.title })
      }
      if (params.review_status) {
        filters.push({ field: 'review_status', operator: 'eq', value: params.review_status })
      }
      if (params.content_type) {
        filters.push({ field: 'content_type', operator: 'eq', value: params.content_type })
      }
      return filters
    }
  })

  // 快速审核操作
  const handleReview = async (id: string, status: 'approved' | 'rejected') => {
    const { error } = await supabaseClient
      .from('videos')
      .update({ review_status: status })
      .eq('id', id)

    if (error) {
      message.error('审核操作失败: ' + error.message)
    } else {
      message.success('审核操作成功')
      tableProps.onChange?.(tableProps.pagination as any, {}, {}) 
    }
  }

  const previewVideo = (url: string) => {
    Modal.info({
      title: '视频预览',
      width: 800,
      centered: true,
      content: <video src={url} controls autoPlay style={{ width: '100%', maxHeight: '70vh' }} />,
      footer: null,
      maskClosable: true
    })
  }

  const formatNumber = (num: number) => {
    if (num >= 10000) return (num / 10000).toFixed(1) + 'w'
    return num?.toString() || '0'
  }

  return (
    <List title="视频审核">
      <Form {...searchFormProps} layout="inline" style={{ marginBottom: 16 }}>
        <Form.Item name="title" label="关键词">
          <Input placeholder="标题/描述" allowClear style={{ width: 180 }} />
        </Form.Item>
        <Form.Item name="review_status" label="审核">
          <Select placeholder="全部" allowClear style={{ width: 100 }}>
            <Select.Option value="pending">待审核</Select.Option>
            <Select.Option value="approved">已通过</Select.Option>
            <Select.Option value="rejected">已拒绝</Select.Option>
          </Select>
        </Form.Item>
        <Form.Item name="content_type" label="类型">
          <Select placeholder="全部" allowClear style={{ width: 90 }}>
            <Select.Option value="video">视频</Select.Option>
            <Select.Option value="image">图片</Select.Option>
            <Select.Option value="album">相册</Select.Option>
            <Select.Option value="collection">合集</Select.Option>
          </Select>
        </Form.Item>
        <Form.Item>
          <Space>
            <Button type="primary" htmlType="submit">搜索</Button>
            <Button onClick={() => {
              searchFormProps.form?.resetFields();
              searchFormProps.onFinish?.({}); // 🎯 强制用空条件刷新，解决 admin 后台的粘性搜索 bug
            }}>重置</Button>
          </Space>
        </Form.Item>
      </Form>

      <Table {...tableProps} rowKey="id" scroll={{ x: 1500 }}>
        <Table.Column title="封面" width={90} render={(_, r: any) => <img src={r.cover_url} style={{ width: 70, height: 70, objectFit: 'cover', borderRadius: 4, cursor: 'pointer' }} onClick={() => previewVideo(r.play_url)} />} />
        <Table.Column dataIndex="title" title="标题/描述" width={250} render={(val) => <div style={{ maxHeight: 70, overflow: 'hidden' }}>{val || '无标题'}</div>} />
        <Table.Column title="作者" width={180} render={(_, r: any) => <Space><Avatar src={r.profiles?.avatar_url} icon={<UserOutlined />} /><div><div>{r.profiles?.nickname || '未知'}</div><div style={{ fontSize: 12, color: '#999' }}>ID: {r.profiles?.numeric_id || '-'}</div></div></Space>} />
        <Table.Column dataIndex="review_status" title="状态" width={100} render={(v) => <Tag color={v === 'approved' ? 'green' : v === 'rejected' ? 'red' : 'orange'}>{v === 'approved' ? '已通过' : v === 'rejected' ? '已拒绝' : '待审核'}</Tag>} />
        <Table.Column dataIndex="is_adult" title="成人" width={70} render={(v) => <Tag color={v ? 'magenta' : 'blue'}>{v ? '🔞' : '否'}</Tag>} />
        <Table.Column title="数据" width={180} render={(_, r: any) => <div style={{ fontSize: 12 }}>播放: {formatNumber(r.view_count)}<br/>赞: {formatNumber(r.like_count)} | 评: {formatNumber(r.comment_count)}</div>} />
        <Table.Column dataIndex="created_at" title="创建时间" width={160} render={(val) => dayjs(val).format('YYYY-MM-DD HH:mm:ss')} />
        <Table.Column title="操作" fixed="right" width={180} render={(_, r: any) => (
          <Space size="small">
            <Button size="small" icon={<EyeOutlined />} onClick={() => previewVideo(r.play_url)}>预览</Button>
            {r.review_status === 'pending' && (
              <><Button size="small" type="primary" onClick={() => handleReview(r.id, 'approved')} style={{ background: '#52c41a', borderColor: '#52c41a' }}>通过</Button>
              <Button size="small" danger onClick={() => handleReview(r.id, 'rejected')}>拒绝</Button></>
            )}
          </Space>
        )} />
      </Table>
    </List>
  )
}
