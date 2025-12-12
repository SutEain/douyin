import { Show } from '@refinedev/antd'
import { Avatar, Descriptions, Tag, Card, Row, Col, Statistic, Divider } from 'antd'
import { useShow } from '@refinedev/core'
import dayjs from 'dayjs'

type Profile = {
  id: string
  nickname?: string
  username?: string
  bio?: string
  avatar_url?: string
  numeric_id?: string
  auto_approve?: boolean
  show_collect?: boolean
  show_like?: boolean
  show_tg_username?: boolean
  gender?: number
  birthday?: string | null
  country?: string
  tg_user_id?: string
  tg_username?: string
  auth_provider?: string
  lang?: string
  created_at?: string
  last_active_at?: string
  updated_at?: string
  email_verified?: boolean
  follower_count?: number
  following_count?: number
  video_count?: number
  total_likes?: number
}

export const UserShow = () => {
  const { query } = useShow<Profile>({ resource: 'profiles' })
  const { data, isLoading } = query
  const record = data?.data

  const genderMap: Record<number, string> = {
    0: '未知',
    1: '男',
    2: '女'
  }

  const genderText = record?.gender !== undefined ? genderMap[record.gender] : '未知'

  return (
    <Show isLoading={isLoading}>
      {/* 头像和基本信息卡片 */}
      <Card style={{ marginBottom: 24 }}>
        <Row gutter={24} align="middle">
          <Col>
            <Avatar size={100} src={record?.avatar_url} style={{ backgroundColor: '#87d068' }}>
              {record?.nickname?.[0] || 'U'}
            </Avatar>
          </Col>
          <Col flex="1">
            <h2 style={{ margin: 0 }}>{record?.nickname || '未设置昵称'}</h2>
            <p style={{ color: '#999', margin: '8px 0' }}>@{record?.username || '-'}</p>
            <p style={{ color: '#666' }}>{record?.bio || '暂无简介'}</p>
            <div>
              <Tag color="blue">ID: {record?.numeric_id || '-'}</Tag>
              <Tag color={record?.auto_approve ? 'green' : 'orange'}>
                {record?.auto_approve ? '自动审核' : '需要审核'}
              </Tag>
            </div>
          </Col>
        </Row>
      </Card>

      {/* 统计数据 */}
      <Row gutter={16} style={{ marginBottom: 24 }}>
        <Col span={6}>
          <Card>
            <Statistic title="视频数" value={record?.video_count || 0} />
          </Card>
        </Col>
        <Col span={6}>
          <Card>
            <Statistic title="粉丝数" value={record?.follower_count || 0} />
          </Card>
        </Col>
        <Col span={6}>
          <Card>
            <Statistic title="关注数" value={record?.following_count || 0} />
          </Card>
        </Col>
        <Col span={6}>
          <Card>
            <Statistic title="获赞数" value={record?.total_likes || 0} />
          </Card>
        </Col>
      </Row>

      {/* 详细信息 */}
      <Descriptions title="用户详情" bordered column={2}>
        <Descriptions.Item label="昵称">{record?.nickname || '-'}</Descriptions.Item>
        <Descriptions.Item label="用户名">@{record?.username || '-'}</Descriptions.Item>
        <Descriptions.Item label="数字ID">{record?.numeric_id || '-'}</Descriptions.Item>
        <Descriptions.Item label="性别">{genderText || '未知'}</Descriptions.Item>
        <Descriptions.Item label="生日">
          {record?.birthday ? dayjs(record.birthday).format('YYYY-MM-DD') : '-'}
        </Descriptions.Item>
        <Descriptions.Item label="国家/地区">{record?.country || '-'}</Descriptions.Item>
        <Descriptions.Item label="简介" span={2}>
          {record?.bio || '-'}
        </Descriptions.Item>
      </Descriptions>

      <Divider />

      <Descriptions title="Telegram 信息" bordered column={2}>
        <Descriptions.Item label="TG User ID">{record?.tg_user_id || '-'}</Descriptions.Item>
        <Descriptions.Item label="TG Username">
          {record?.tg_username ? `@${record.tg_username}` : '-'}
        </Descriptions.Item>
        <Descriptions.Item label="认证方式">{record?.auth_provider || '-'}</Descriptions.Item>
        <Descriptions.Item label="语言">{record?.lang || '-'}</Descriptions.Item>
      </Descriptions>

      <Divider />

      <Descriptions title="隐私设置" bordered column={4}>
        <Descriptions.Item label="自动审核">
          <Tag color={record?.auto_approve ? 'green' : 'red'}>
            {record?.auto_approve ? '是' : '否'}
          </Tag>
        </Descriptions.Item>
        <Descriptions.Item label="公开收藏">
          <Tag color={record?.show_collect !== false ? 'green' : 'red'}>
            {record?.show_collect !== false ? '是' : '否'}
          </Tag>
        </Descriptions.Item>
        <Descriptions.Item label="公开喜欢">
          <Tag color={record?.show_like !== false ? 'green' : 'red'}>
            {record?.show_like !== false ? '是' : '否'}
          </Tag>
        </Descriptions.Item>
        <Descriptions.Item label="显示TG用户名">
          <Tag color={record?.show_tg_username !== false ? 'green' : 'red'}>
            {record?.show_tg_username !== false ? '是' : '否'}
          </Tag>
        </Descriptions.Item>
      </Descriptions>

      <Divider />

      <Descriptions title="时间信息" bordered column={2}>
        <Descriptions.Item label="注册时间">
          {record?.created_at ? dayjs(record.created_at).format('YYYY-MM-DD HH:mm:ss') : '-'}
        </Descriptions.Item>
        <Descriptions.Item label="最后活跃">
          {record?.last_active_at
            ? dayjs(record.last_active_at).format('YYYY-MM-DD HH:mm:ss')
            : '-'}
        </Descriptions.Item>
        <Descriptions.Item label="更新时间">
          {record?.updated_at ? dayjs(record.updated_at).format('YYYY-MM-DD HH:mm:ss') : '-'}
        </Descriptions.Item>
        <Descriptions.Item label="邮箱验证">
          <Tag color={record?.email_verified ? 'green' : 'red'}>
            {record?.email_verified ? '已验证' : '未验证'}
          </Tag>
        </Descriptions.Item>
      </Descriptions>
    </Show>
  )
}
