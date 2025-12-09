import { Show } from '@refinedev/antd'
import { Typography, Avatar } from 'antd'
import { useShow } from '@refinedev/core'

const { Title, Text } = Typography

export const UserShow = () => {
  const { queryResult } = useShow({ resource: 'profiles' })
  const { data, isLoading } = queryResult
  const record = data?.data

  return (
    <Show isLoading={isLoading}>
      <Avatar size={64} src={record?.avatar_url} />

      <Title level={5}>昵称</Title>
      <Text>{record?.nickname}</Text>

      <Title level={5}>用户名</Title>
      <Text>{record?.username}</Text>

      <Title level={5}>简介</Title>
      <Text>{record?.bio}</Text>

      <Title level={5}>视频数</Title>
      <Text>{record?.video_count}</Text>

      <Title level={5}>粉丝数</Title>
      <Text>{record?.follower_count}</Text>
    </Show>
  )
}
