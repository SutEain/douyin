import { useEffect, useMemo, useState } from 'react'
import { Card, Col, Drawer, Row, Spin, Statistic, Table, Typography } from 'antd'
import { useNavigate } from 'react-router-dom'
import { supabaseClient } from '../../supabaseClient'

const { Title, Text } = Typography

interface DashboardStats {
  totalUsers: number
  usersWithVideos: number
  newUsersToday: number
  activeUsersToday: number
  totalVideos: number
  totalNormalVideos: number
  totalAdultVideos: number
  totalShortDramaVideos: number
  newVideosToday: number
  newNormalVideosToday: number
  newAdultVideosToday: number
}

type ActiveUserRow = {
  id: string
  nickname: string | null
  username: string | null
  numeric_id: number | null
  last_active_at: string | null
}

type NewUserRow = {
  id: string
  nickname: string | null
  username: string | null
  numeric_id: number | null
  created_at: string | null
}

type VideoRow = {
  id: string
  author_id: string | null
  content_type: string | null
  is_adult: boolean | null
  created_at: string | null
}

type VideoWithAuthorRow = VideoRow & {
  author_nickname: string | null
  author_username: string | null
  author_numeric_id: number | null
}

type DrawerMode = 'activeUsersToday' | 'newUsersToday' | 'newVideosToday' | 'newAdultVideosToday'

function getStartOfTodayShanghaiISO(now = new Date()): string {
  const fmt = new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  })
  const parts = fmt.formatToParts(now)
  const y = Number(parts.find((p) => p.type === 'year')?.value)
  const m = Number(parts.find((p) => p.type === 'month')?.value)
  const d = Number(parts.find((p) => p.type === 'day')?.value)
  // 上海时区 UTC+8：上海 00:00 对应 UTC 前一天 16:00
  const utcMs = Date.UTC(y, m - 1, d, 0, 0, 0) - 8 * 60 * 60 * 1000
  return new Date(utcMs).toISOString()
}

function formatShanghaiTime(iso?: string | null): string {
  if (!iso) return '-'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '-'
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  }).format(d)
}

export const Dashboard = () => {
  const navigate = useNavigate()
  const [loading, setLoading] = useState(true)
  const [stats, setStats] = useState<DashboardStats | null>(null)

  const [activeDrawerOpen, setActiveDrawerOpen] = useState(false)
  const [drawerMode, setDrawerMode] = useState<DrawerMode>('activeUsersToday')
  const [activeLoading, setActiveLoading] = useState(false)
  const [activeUsers, setActiveUsers] = useState<
    Array<ActiveUserRow | NewUserRow | VideoWithAuthorRow>
  >([])
  const [activeTotal, setActiveTotal] = useState(0)
  const [activePage, setActivePage] = useState(1)
  const [activePageSize, setActivePageSize] = useState(20)

  const startISO = useMemo(() => getStartOfTodayShanghaiISO(), [])

  useEffect(() => {
    const fetchStats = async () => {
      try {
        setLoading(true)

        const [
          totalUsersRes,
          usersWithVideosRes,
          newUsersRes,
          activeUsersRes,
          totalVideosRes,
          totalNormalVideosRes,
          totalAdultVideosRes,
          totalShortDramaVideosRes,
          newVideosRes,
          newNormalVideosRes,
          newAdultVideosRes
        ] = await Promise.all([
          supabaseClient.from('profiles').select('*', { count: 'exact', head: true }),
          supabaseClient
            .from('profiles')
            .select('*', { count: 'exact', head: true })
            .gt('video_count', 0),
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
            .eq('is_adult', false)
            .eq('is_shortdrama', true),
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
          usersWithVideos: usersWithVideosRes.count ?? 0,
          newUsersToday: newUsersRes.count ?? 0,
          activeUsersToday: activeUsersRes.count ?? 0,
          totalVideos: totalVideosRes.count ?? 0,
          totalNormalVideos: totalNormalVideosRes.count ?? 0,
          totalAdultVideos: totalAdultVideosRes.count ?? 0,
          totalShortDramaVideos: totalShortDramaVideosRes.count ?? 0,
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

  async function fetchDrawerList(mode: DrawerMode, page = activePage, pageSize = activePageSize) {
    try {
      setActiveLoading(true)
      const from = (page - 1) * pageSize
      const to = from + pageSize - 1

      if (mode === 'activeUsersToday') {
        const res = await supabaseClient
          .from('profiles')
          .select('id,nickname,username,numeric_id,last_active_at', { count: 'exact' })
          .gte('last_active_at', startISO)
          .order('last_active_at', { ascending: false })
          .range(from, to)

        if (res.error) throw res.error
        setActiveUsers((res.data ?? []) as ActiveUserRow[])
        setActiveTotal(res.count ?? 0)
        return
      }

      if (mode === 'newUsersToday') {
        const res = await supabaseClient
          .from('profiles')
          .select('id,nickname,username,numeric_id,created_at', { count: 'exact' })
          .gte('created_at', startISO)
          .order('created_at', { ascending: false })
          .range(from, to)

        if (res.error) throw res.error
        setActiveUsers((res.data ?? []) as NewUserRow[])
        setActiveTotal(res.count ?? 0)
        return
      }

      if (mode === 'newVideosToday' || mode === 'newAdultVideosToday') {
        let q = supabaseClient
          .from('videos')
          .select('id,author_id,content_type,is_adult,created_at', { count: 'exact' })
          .eq('status', 'published')
          .gte('created_at', startISO)

        if (mode === 'newAdultVideosToday') {
          q = q.eq('is_adult', true)
        }

        const res = await q.order('created_at', { ascending: false }).range(from, to)
        if (res.error) throw res.error

        const videos = (res.data ?? []) as VideoRow[]
        const authorIds = Array.from(
          new Set(videos.map((v) => v.author_id).filter((x): x is string => !!x))
        )

        let profileMap = new Map<
          string,
          { nickname: string | null; username: string | null; numeric_id: number | null }
        >()
        if (authorIds.length) {
          const profRes = await supabaseClient
            .from('profiles')
            .select('id,nickname,username,numeric_id')
            .in('id', authorIds)
          if (profRes.error) throw profRes.error
          profileMap = new Map(
            (profRes.data ?? []).map((p: any) => [
              String(p.id),
              {
                nickname: p.nickname ?? null,
                username: p.username ?? null,
                numeric_id: p.numeric_id ?? null
              }
            ])
          )
        }

        const rows: VideoWithAuthorRow[] = videos.map((v) => {
          const p = v.author_id ? profileMap.get(String(v.author_id)) : undefined
          return {
            ...v,
            author_nickname: p?.nickname ?? null,
            author_username: p?.username ?? null,
            author_numeric_id: p?.numeric_id ?? null
          }
        })

        setActiveUsers(rows)
        setActiveTotal(res.count ?? 0)
        return
      }
    } catch (e) {
      console.error('[Dashboard] 获取今日活跃列表失败:', e)
    } finally {
      setActiveLoading(false)
    }
  }

  function openDrawer(mode: DrawerMode) {
    setDrawerMode(mode)
    setActiveDrawerOpen(true)
    setActivePage(1)
    fetchDrawerList(mode, 1, activePageSize)
  }

  const drawerTitle = useMemo(() => {
    if (drawerMode === 'activeUsersToday') return '今日活跃用户（北京时间）'
    if (drawerMode === 'newUsersToday') return '今日新增用户（北京时间）'
    if (drawerMode === 'newAdultVideosToday') return '今日新增成人视频（北京时间）'
    return '今日新增作品（北京时间）'
  }, [drawerMode])

  const tableColumns = useMemo(() => {
    if (drawerMode === 'activeUsersToday') {
      return [
        { title: '昵称', dataIndex: 'nickname', render: (v: any) => v || '-' },
        { title: '用户名', dataIndex: 'username', render: (v: any) => v || '-' },
        {
          title: '数字ID',
          dataIndex: 'numeric_id',
          width: 110,
          render: (v: any) => (v == null ? '-' : String(v))
        },
        {
          title: '最后活跃时间(北京)',
          dataIndex: 'last_active_at',
          width: 200,
          render: (v: any) => formatShanghaiTime(v)
        }
      ]
    }

    if (drawerMode === 'newUsersToday') {
      return [
        { title: '昵称', dataIndex: 'nickname', render: (v: any) => v || '-' },
        { title: '用户名', dataIndex: 'username', render: (v: any) => v || '-' },
        {
          title: '数字ID',
          dataIndex: 'numeric_id',
          width: 110,
          render: (v: any) => (v == null ? '-' : String(v))
        },
        {
          title: '注册时间(北京)',
          dataIndex: 'created_at',
          width: 200,
          render: (v: any) => formatShanghaiTime(v)
        }
      ]
    }

    // videos
    return [
      { title: '作品ID', dataIndex: 'id', width: 260, render: (v: any) => v || '-' },
      {
        title: '作者',
        dataIndex: 'author_username',
        render: (_: any, row: any) => {
          const nick = row.author_nickname || ''
          const user = row.author_username || ''
          const id = row.author_numeric_id == null ? '' : ` (${row.author_numeric_id})`
          const s = nick || user ? `${nick || user}${id}` : '-'
          return s
        }
      },
      { title: '类型', dataIndex: 'content_type', width: 90, render: (v: any) => v || '-' },
      {
        title: '成人',
        dataIndex: 'is_adult',
        width: 70,
        render: (v: any) => (v === true ? '是' : '否')
      },
      {
        title: '创建时间(北京)',
        dataIndex: 'created_at',
        width: 200,
        render: (v: any) => formatShanghaiTime(v)
      }
    ]
  }, [drawerMode])

  return (
    <Spin spinning={loading}>
      <div style={{ padding: 24 }}>
        <Title level={3}>运营看板</Title>
        <Text type="secondary">今日数据与整体概况</Text>

        <Row gutter={[16, 16]} style={{ marginTop: 24 }}>
          <Col xs={24} sm={12} md={6}>
            <Card style={{ cursor: 'pointer' }} onClick={() => openDrawer('newUsersToday')}>
              <Statistic title="今日新增人数" value={stats?.newUsersToday ?? 0} />
            </Card>
          </Col>
          <Col xs={24} sm={12} md={6}>
            <Card style={{ cursor: 'pointer' }} onClick={() => openDrawer('activeUsersToday')}>
              <Statistic title="今日活跃人数" value={stats?.activeUsersToday ?? 0} />
            </Card>
          </Col>
          <Col xs={24} sm={12} md={6}>
            <Card style={{ cursor: 'pointer' }} onClick={() => openDrawer('newVideosToday')}>
              <Statistic title="今日新增作品（总）" value={stats?.newVideosToday ?? 0} />
            </Card>
          </Col>
          <Col xs={24} sm={12} md={6}>
            <Card style={{ cursor: 'pointer' }} onClick={() => openDrawer('newAdultVideosToday')}>
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
            <Card
              style={{ cursor: 'pointer', border: '1px solid #1890ff' }}
              onClick={() => navigate('/users?has_videos=true')}
            >
              <Statistic
                title="已发作品用户 (总)"
                value={stats?.usersWithVideos ?? 0}
                valueStyle={{ color: '#1890ff' }}
                suffix={
                  <Text type="secondary" style={{ fontSize: 12 }}>
                    一键查看
                  </Text>
                }
              />
            </Card>
          </Col>
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

        <Row gutter={[16, 16]} style={{ marginTop: 16 }}>
          <Col xs={24} sm={12} md={6}>
            <Card>
              <Statistic title="短剧总数（非成人）" value={stats?.totalShortDramaVideos ?? 0} />
            </Card>
          </Col>
        </Row>
      </div>

      <Drawer
        title={drawerTitle}
        open={activeDrawerOpen}
        onClose={() => setActiveDrawerOpen(false)}
        width={720}
      >
        <div style={{ marginBottom: 12 }}>
          <Text type="secondary">
            {drawerMode === 'activeUsersToday' && (
              <>
                统计口径：profiles.last_active_at ≥ {formatShanghaiTime(startISO)}（Asia/Shanghai）
              </>
            )}
            {drawerMode === 'newUsersToday' && (
              <>统计口径：profiles.created_at ≥ {formatShanghaiTime(startISO)}（Asia/Shanghai）</>
            )}
            {(drawerMode === 'newVideosToday' || drawerMode === 'newAdultVideosToday') && (
              <>
                统计口径：videos.created_at ≥ {formatShanghaiTime(startISO)} 且
                status='published'（Asia/Shanghai）
              </>
            )}
          </Text>
        </div>

        <Table<any>
          rowKey="id"
          loading={activeLoading}
          dataSource={activeUsers}
          pagination={{
            current: activePage,
            pageSize: activePageSize,
            total: activeTotal,
            showSizeChanger: true,
            onChange: (page, pageSize) => {
              setActivePage(page)
              setActivePageSize(pageSize)
              fetchDrawerList(drawerMode, page, pageSize)
            }
          }}
          columns={tableColumns as any}
        />
      </Drawer>
    </Spin>
  )
}
