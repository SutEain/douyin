import { Show } from '@refinedev/antd'
import { Typography } from 'antd'
import { useShow } from '@refinedev/core'

const { Title, Text } = Typography

type VideoRecord = {
  id: string
  title?: string
  description?: string
  status?: string
}

export const VideoShow = () => {
  const { query } = useShow<VideoRecord>()
  const { data, isLoading } = query
  const record = data?.data

  return (
    <Show isLoading={isLoading}>
      <Title level={5}>ID</Title>
      <Text>{record?.id}</Text>

      <Title level={5}>标题</Title>
      <Text>{record?.title}</Text>

      <Title level={5}>描述</Title>
      <Text>{record?.description}</Text>

      <Title level={5}>状态</Title>
      <Text>{record?.status}</Text>
    </Show>
  )
}
