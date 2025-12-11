import { useEffect, useState } from 'react'
import { Card, Col, Row, Spin, Statistic, Typography } from 'antd'
import { supabaseClient } from '../../supabaseClient'

const { Title, Text } = Typography

interface DashboardStats {
  totalUsers: number
  newUsersToday: number
  activeUsersToday: number
  totalVideos: number
  totalNormalVideos: number
  totalAdultVideos: number
  newVideosToday: number
  newNormalVideosToday: number
  newAdultVideosToday: number
}

export const Dashboard = () => {
  const [loading, setLoading] = useState(true)
  const [stats, setStats] = useState<DashboardStats | null>(null)

  useEffect(() => {
    const fetchStats = async () => {
      try {
        setLoading(true)

        const now = new Date()
        const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate())
        const startISO = startOfDay.toISOString()

        const [
          totalUsersRes,
          newUsersRes,
          activeUsersRes,
          totalVideosRes,
          totalNormalVideosRes,
          totalAdultVideosRes,
          newVideosRes,
          newNormalVideosRes,
          newAdultVideosRes
        ] = await Promise.all([
          supabaseClient.from('profiles').select('*', { count: 'exact', head: true }),
          supabaseClient
            .from('profiles')
            .select('*', { count: 'exact', head: true })
            .gte('created_at', startISO),
          supabaseClient
            .from('profiles')
            .select('*', { count: 'exact', head: true })
            .gte('last_active_at', startISO),
          supabaseClient
            .from('videos')
            .select('*', { count: 'exact', head: true })
            .eq('status', 'published'),
          supabaseClient
            .from('videos')
            .select('*', { count: 'exact', head: true })
            .eq('status', 'published')
            .eq('is_adult', false),
          supabaseClient
            .from('videos')
            .select('*', { count: 'exact', head: true })
            .eq('status', 'published')
            .eq('is_adult', true),
          supabaseClient
            .from('videos')
            .select('*', { count: 'exact', head: true })
            .eq('status', 'published')
            .gte('created_at', startISO),
          supabaseClient
            .from('videos')
            .select('*', { count: 'exact', head: true })
            .eq('status', 'published')
            .gte('created_at', startISO)
            .eq('is_adult', false),
          supabaseClient
            .from('videos')
            .select('*', { count: 'exact', head: true })
            .eq('status', 'published')
            .gte('created_at', startISO)
            .eq('is_adult', true)
        ])

        setStats({
          totalUsers: totalUsersRes.count ?? 0,
          newUsersToday: newUsersRes.count ?? 0,
          activeUsersToday: activeUsersRes.count ?? 0,
          totalVideos: totalVideosRes.count ?? 0,
          totalNormalVideos: totalNormalVideosRes.count ?? 0,
          totalAdultVideos: totalAdultVideosRes.count ?? 0,
          newVideosToday: newVideosRes.count ?? 0,
          newNormalVideosToday: newNormalVideosRes.count ?? 0,
          newAdultVideosToday: newAdultVideosRes.count ?? 0
        })
      } catch (error) {
        console.error('[Dashboard] 获取统计数据失败:', error)
      } finally {
        setLoading(false)
      }
    }

    fetchStats()
  }, [])

  return (
    <Spin spinning={loading}>
      <div style={{ padding: 24 }}>
        <Title level={3}>运营看板</Title>
        <Text type="secondary">今日数据与整体概况</Text>

        <Row gutter={[16, 16]} style={{ marginTop: 24 }}>
          <Col xs={24} sm={12} md={6}>
            <Card>
              <Statistic title="今日新增人数" value={stats?.newUsersToday ?? 0} />
            </Card>
          </Col>
          <Col xs={24} sm={12} md={6}>
            <Card>
              <Statistic title="今日活跃人数" value={stats?.activeUsersToday ?? 0} />
            </Card>
          </Col>
          <Col xs={24} sm={12} md={6}>
            <Card>
              <Statistic title="今日新增作品（总）" value={stats?.newVideosToday ?? 0} />
            </Card>
          </Col>
          <Col xs={24} sm={12} md={6}>
            <Card>
              <Statistic
                title="今日新增成人视频"
                value={stats?.newAdultVideosToday ?? 0}
                valueStyle={{ color: '#cf1322' }}
              />
            </Card>
          </Col>
        </Row>

        <Row gutter={[16, 16]} style={{ marginTop: 24 }}>
          <Col xs={24} sm={12} md={6}>
            <Card>
              <Statistic title="总用户数" value={stats?.totalUsers ?? 0} />
            </Card>
          </Col>
          <Col xs={24} sm={12} md={6}>
            <Card>
              <Statistic title="总作品数" value={stats?.totalVideos ?? 0} />
            </Card>
          </Col>
          <Col xs={24} sm={12} md={6}>
            <Card>
              <Statistic
                title="普通作品总数"
                value={stats?.totalNormalVideos ?? 0}
                valueStyle={{ color: '#3f8600' }}
              />
            </Card>
          </Col>
          <Col xs={24} sm={12} md={6}>
            <Card>
              <Statistic
                title="成人作品总数"
                value={stats?.totalAdultVideos ?? 0}
                valueStyle={{ color: '#cf1322' }}
              />
            </Card>
          </Col>
        </Row>
      </div>
    </Spin>
  )
}
