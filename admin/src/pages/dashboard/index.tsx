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
  newFirstPublishersToday: number // 🎯 新增
  totalVideos: number
  totalNormalVideos: number
  totalAdultVideos: number
  totalSeaVideos: number
  newVideosToday: number
  newNormalVideosToday: number
  newAdultVideosToday: number
  usersWithHistory: number // 🎯 新增：看过视频的用户（总）
  totalCoinsBalance: number // 🎯 平台抖币总余额（所有用户剩余抖币之和）
  todaySystemRewards: number // 🎯 今日系统发放的抖币奖励
  todayManualAdjustments: number // 🎯 今日手动调整的抖币
  todayGiftCommission: number // 🎯 今日打赏/直播礼物抽水
  todayDiceCommission: number // 🎯 今日骰子游戏抽水
  todayRpsCommission: number // 🎯 今日石头剪刀布游戏抽水
  todayTotalCommission: number // 🎯 今日总抽水
}

type ActiveUserRow = {
  id: string
  nickname: string | null
  username: string | null
  numeric_id: number | null
  last_active_at: string | null
  first_published_at?: string | null // 🎯 新增
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

type DrawerMode =
  | 'activeUsersToday'
  | 'newUsersToday'
  | 'newVideosToday'
  | 'newAdultVideosToday'
  | 'newFirstPublishersToday' // 🎯 新增

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

// 🎯 获取今日结束时间（北京时间）
// 注意：返回的是明天的开始时间（00:00:00），用于 < 比较
function getEndOfTodayShanghaiISO(now = new Date()): string {
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
  // 🎯 返回明天的开始时间（北京时间 00:00:00），对应 UTC 前一天的 16:00:00
  // 例如：北京时间 2026-01-13 00:00:00 = UTC 2026-01-12 16:00:00
  const utcMs = Date.UTC(y, m - 1, d + 1, 0, 0, 0) - 8 * 60 * 60 * 1000
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
  const endISO = useMemo(() => getEndOfTodayShanghaiISO(), [])

  useEffect(() => {
    const fetchStats = async () => {
      try {
        setLoading(true)

        const [
          totalUsersRes,
          usersWithVideosRes,
          newUsersRes,
          activeUsersRes, // 这里将存储今日播放人数
          totalVideosRes,
          totalNormalVideosRes,
          totalAdultVideosRes,
          totalSeaVideosRes,
          newVideosRes,
          newNormalVideosRes,
          newAdultVideosRes,
          newFirstPublishersRes,
          usersWithHistoryRes
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
          // 🎯 修改：今日活跃人数 改为 统计今日播放人数
          supabaseClient.rpc('get_watch_users_count', { p_start_iso: startISO, p_end_iso: endISO }),
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
            .eq('is_sea', true),
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
            .eq('is_adult', true),
          // 🎯 调用 RPC 获取今日首次发作品用户数
          supabaseClient.rpc('get_today_first_publishers_count', { p_start_iso: startISO }),
          // 🎯 调用 RPC 获取有过观看历史的总用户数量
          supabaseClient.rpc('get_active_user_count'),
          // 🎯 平台抖币总余额：统计所有用户的balance_coins总和（所有用户剩余抖币之和）
          // 使用 RPC 函数绕过 RLS 限制，直接使用 SQL SUM 聚合
          supabaseClient.rpc('get_total_coins_balance'),
          // 🎯 今日系统发放的抖币奖励：从交易记录统计（北京时间）
          // 使用 RPC 函数绕过 RLS 限制，直接使用 SQL SUM 聚合
          supabaseClient.rpc('get_today_system_rewards', {
            p_start_iso: startISO,
            p_end_iso: endISO
          }),
          // 🎯 今日手动调整的抖币：从交易记录统计（北京时间）
          // 使用 RPC 函数绕过 RLS 限制，直接使用 SQL SUM 聚合
          supabaseClient
            .rpc('get_today_manual_adjustments', {
              p_start_iso: startISO,
              p_end_iso: endISO
            })
            .then((res) => {
              // 🐛 调试日志：检查时间范围和结果
              if (process.env.NODE_ENV === 'development') {
                console.log('[Dashboard] 今日手动调整统计:', {
                  startISO,
                  endISO,
                  result: res.data,
                  error: res.error
                })
              }
              return res
            }),
          // 🎯 今日抖币抽水：平台通过打赏、直播礼物、游戏各种抽水回收的抖币（北京时间）
          // 分别统计各个来源的抽水
          Promise.all([
            // 打赏/直播礼物抽水：gift_out总额 - gift_in总额（差额就是平台抽水）
            // 使用 RPC 函数绕过 RLS 限制，直接使用 SQL SUM 聚合
            supabaseClient
              .rpc('get_today_gift_commission', {
                p_start_iso: startISO,
                p_end_iso: endISO
              })
              .then((res) => {
                if (res.error) throw res.error
                return Number(res.data) || 0
              }),
            // 骰子游戏抽水：total_prize * 2%
            supabaseClient
              .from('dice_rooms')
              .select('total_prize, updated_at')
              .eq('status', 'finished')
              .gte('updated_at', startISO)
              .lt('updated_at', endISO)
              .then((res) => {
                if (res.error) throw res.error
                let totalCommission = 0
                res.data?.forEach((room) => {
                  const totalPrize = Number(room.total_prize || 0)
                  if (totalPrize > 0) {
                    // 骰子游戏抽水2%
                    const commission = Math.floor(totalPrize * 0.02 * 100) / 100
                    totalCommission += commission
                  }
                })
                return totalCommission
              }),
            // 石头剪刀布游戏抽水：total_prize * 2%
            supabaseClient
              .from('rps_rooms')
              .select('total_prize, finished_at')
              .eq('status', 'finished')
              .not('total_prize', 'is', null)
              .gte('finished_at', startISO)
              .lt('finished_at', endISO)
              .then((res) => {
                if (res.error) throw res.error
                let totalCommission = 0
                res.data?.forEach((room) => {
                  const totalPrize = Number(room.total_prize || 0)
                  if (totalPrize > 0) {
                    // 石头剪刀布游戏抽水2%
                    const commission = Math.floor(totalPrize * 0.02 * 100) / 100
                    totalCommission += commission
                  }
                })
                return totalCommission
              })
          ]).then(([giftCommission, diceCommission, rpsCommission]) => ({
            data: {
              giftCommission,
              diceCommission,
              rpsCommission,
              totalCommission: giftCommission + diceCommission + rpsCommission
            },
            error: null
          }))
        ])

        setStats({
          totalUsers: totalUsersRes.count ?? 0,
          usersWithVideos: usersWithVideosRes.count ?? 0,
          newUsersToday: newUsersRes.count ?? 0,
          activeUsersToday: Number(activeUsersRes.data) || 0, // 🎯 这里的 data 就是 RPC 返回的今日播放人数
          newFirstPublishersToday: Number(newFirstPublishersRes.data) || 0,
          totalVideos: totalVideosRes.count ?? 0,
          totalNormalVideos: totalNormalVideosRes.count ?? 0,
          totalAdultVideos: totalAdultVideosRes.count ?? 0,
          totalSeaVideos: totalSeaVideosRes.count ?? 0,
          newVideosToday: newVideosRes.count ?? 0,
          newNormalVideosToday: newNormalVideosRes.count ?? 0,
          newAdultVideosToday: newAdultVideosRes.count ?? 0,
          usersWithHistory: Number(usersWithHistoryRes.data) || 0,
          totalCoinsBalance: Number(totalCoinsRes.data) || 0,
          todaySystemRewards: Number(todaySystemRewardsRes.data) || 0,
          todayManualAdjustments: Number(todayManualAdjustmentsRes.data) || 0,
          todayGiftCommission: Number(todayCommissionRes.data?.giftCommission) || 0,
          todayDiceCommission: Number(todayCommissionRes.data?.diceCommission) || 0,
          todayRpsCommission: Number(todayCommissionRes.data?.rpsCommission) || 0,
          todayTotalCommission: Number(todayCommissionRes.data?.totalCommission) || 0
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
        // 🎯 修改：获取今日播放用户列表
        const res = await supabaseClient.rpc('get_watch_users_list', {
          p_start_iso: startISO,
          p_end_iso: endISO,
          p_limit: pageSize,
          p_offset: from
        })

        if (res.error) throw res.error
        setActiveUsers((res.data ?? []) as any[])
        // 同步获取总数
        const countRes = await supabaseClient.rpc('get_watch_users_count', {
          p_start_iso: startISO,
          p_end_iso: endISO
        })
        setActiveTotal(Number(countRes.data) || 0)
        return
      }

      if (mode === 'newFirstPublishersToday') {
        // 🎯 调用 RPC 获取今日首次发作品用户列表
        const res = await supabaseClient.rpc(
          'get_today_first_publishers_list',
          {
            p_start_iso: startISO,
            p_limit: pageSize,
            p_offset: from
          },
          { count: 'exact' }
        )

        if (res.error) throw res.error
        setActiveUsers((res.data ?? []) as any[])
        // RPC count 可能不准确，使用 count: 'exact' 或单独获取
        const countRes = await supabaseClient.rpc('get_today_first_publishers_count', {
          p_start_iso: startISO
        })
        setActiveTotal(Number(countRes.data) || 0)
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
    if (drawerMode === 'activeUsersToday') return '今日播放用户（北京时间）'
    if (drawerMode === 'newUsersToday') return '今日新增用户（北京时间）'
    if (drawerMode === 'newFirstPublishersToday') return '今日首次发作品用户（北京时间）'
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
          title: '最后播放时间(北京)',
          dataIndex: 'last_watch_at',
          width: 200,
          render: (v: any) => formatShanghaiTime(v)
        }
      ]
    }

    if (drawerMode === 'newFirstPublishersToday') {
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
          title: '首发作品时间(北京)',
          dataIndex: 'first_published_at',
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
            <Card
              style={{ cursor: 'pointer', border: '1px solid #722ed1' }}
              onClick={() => openDrawer('newFirstPublishersToday')}
            >
              <Statistic
                title="今日首次发作品用户"
                value={stats?.newFirstPublishersToday ?? 0}
                valueStyle={{ color: '#722ed1' }}
              />
            </Card>
          </Col>
          <Col xs={24} sm={12} md={6}>
            <Card style={{ cursor: 'pointer' }} onClick={() => openDrawer('newVideosToday')}>
              <Statistic title="今日新增作品（总）" value={stats?.newVideosToday ?? 0} />
            </Card>
          </Col>
        </Row>

        <Row gutter={[16, 16]} style={{ marginTop: 16 }}>
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
            <Card>
              <Statistic
                title="平台抖币总余额"
                value={stats?.totalCoinsBalance ?? 0}
                precision={2}
                valueStyle={{ color: '#1890ff' }}
                suffix="抖币"
              />
            </Card>
          </Col>
          <Col xs={24} sm={12} md={6}>
            <Card>
              <Statistic
                title="今日系统发放奖励"
                value={stats?.todaySystemRewards ?? 0}
                precision={2}
                valueStyle={{ color: '#52c41a' }}
                suffix="抖币"
              />
            </Card>
          </Col>
          <Col xs={24} sm={12} md={6}>
            <Card>
              <Statistic
                title="今日手动调整"
                value={stats?.todayManualAdjustments ?? 0}
                precision={2}
                valueStyle={{ color: '#722ed1' }}
                suffix="抖币"
              />
            </Card>
          </Col>
          <Col xs={24} sm={12} md={6}>
            <Card>
              <Statistic
                title="今日总抽水"
                value={stats?.todayTotalCommission ?? 0}
                precision={2}
                valueStyle={{ color: '#fa8c16', fontWeight: 'bold' }}
                suffix="抖币"
              />
            </Card>
          </Col>
        </Row>

        <Row gutter={[16, 16]} style={{ marginTop: 16 }}>
          <Col xs={24} sm={12} md={8}>
            <Card>
              <Statistic
                title="打赏/直播礼物抽水"
                value={stats?.todayGiftCommission ?? 0}
                precision={2}
                valueStyle={{ color: '#fa541c' }}
                suffix="抖币"
              />
            </Card>
          </Col>
          <Col xs={24} sm={12} md={8}>
            <Card>
              <Statistic
                title="骰子游戏抽水"
                value={stats?.todayDiceCommission ?? 0}
                precision={2}
                valueStyle={{ color: '#faad14' }}
                suffix="抖币"
              />
            </Card>
          </Col>
          <Col xs={24} sm={12} md={8}>
            <Card>
              <Statistic
                title="石头剪刀布抽水"
                value={stats?.todayRpsCommission ?? 0}
                precision={2}
                valueStyle={{ color: '#d48806' }}
                suffix="抖币"
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
              <Statistic title="有过观看历史的总用户数量" value={stats?.usersWithHistory ?? 0} />
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
              <Statistic title="东南亚作品总数" value={stats?.totalSeaVideos ?? 0} />
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
                统计口径：今日北京时间有过播放历史（watch_history.updated_at ≥{' '}
                {formatShanghaiTime(startISO)}）的用户
              </>
            )}
            {drawerMode === 'newUsersToday' && (
              <>统计口径：profiles.created_at ≥ {formatShanghaiTime(startISO)}（Asia/Shanghai）</>
            )}
            {drawerMode === 'newFirstPublishersToday' && (
              <>
                统计口径：用户的第一篇状态为已发布的作品（videos.status='published'）发布时间 ≥{' '}
                {formatShanghaiTime(startISO)}（Asia/Shanghai）
              </>
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
