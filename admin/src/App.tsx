import { Refine } from '@refinedev/core'
import { ErrorComponent, useNotificationProvider, ThemedLayout } from '@refinedev/antd'
import { BrowserRouter, Navigate, Outlet, Route, Routes } from 'react-router-dom'
import routerProvider from '@refinedev/react-router'
import { dataProvider, liveProvider } from '@refinedev/supabase'
import { App as AntdApp, ConfigProvider } from 'antd'
import zhCN from 'antd/locale/zh_CN'
import '@refinedev/antd/dist/reset.css'

import { useEffect, useState } from 'react'
import { supabaseClient } from './supabaseClient'
import { VideoList, VideoShow, VideoEdit, VideoDouyinCreate } from './pages/videos'
import { UserList, UserShow, UserEdit } from './pages/users'
import { RecommendationPoolList } from './pages/recommendation-pool'
import { IncentiveRuleCreate, IncentiveRuleEdit, IncentiveRuleList } from './pages/incentive-rules'
import {
  UserIncentiveProgressList,
  UserVideoIncentiveProgressList
} from './pages/incentive-progress/index'
import { CoinTransactionList } from './pages/coin-transactions'
import { SystemSettings } from './pages/system-settings'
import { LiveRoomCreate, LiveRoomEdit, LiveRoomList } from './pages/live-rooms'
import { GiftList } from './pages/gifts'
import { RechargeOrderList } from './pages/recharge-orders'
import { WithdrawOrderList } from './pages/withdraw-orders'
import { BoundChannelList } from './pages/bound-channels'
import { Login } from './pages/login'
import { authProvider } from './authProvider'
import { Dashboard } from './pages/dashboard'
import { InheritancePage } from './pages/inheritance'

// 🎯 审核员邮箱列表（仅针对 shenhe1@review.local：显示视频管理、用户管理、资金流水、频道同步管理）
const REVIEWER_EMAILS = ['shenhe1@review.local']

function AdminGuard() {
  const [checking, setChecking] = useState(true)
  const [ok, setOk] = useState(false)

  useEffect(() => {
    let mounted = true
    ;(async () => {
      try {
        const { data } = await supabaseClient.auth.getSession()
        const session = data?.session
        if (!session) {
          if (mounted) {
            setOk(false)
            setChecking(false)
          }
          return
        }

        const role = session.user?.app_metadata?.role
        if (role !== 'admin') {
          await supabaseClient.auth.signOut()
          if (mounted) {
            setOk(false)
            setChecking(false)
          }
          return
        }

        if (mounted) {
          setOk(true)
          setChecking(false)
        }
      } catch (e) {
        console.error('[AdminGuard] check session failed:', e)
        if (mounted) {
          setOk(false)
          setChecking(false)
        }
      }
    })()

    return () => {
      mounted = false
    }
  }, [])

  if (checking) {
    return <div style={{ padding: 24 }}>加载中...</div>
  }

  if (!ok) {
    return <Navigate to="/login" replace />
  }

  return (
    <ThemedLayout>
      <Outlet />
    </ThemedLayout>
  )
}

function App() {
  const [userEmail, setUserEmail] = useState<string | null>(null)

  useEffect(() => {
    // 🎯 异步获取用户邮箱，不阻塞应用渲染
    ;(async () => {
      try {
        const { data } = await supabaseClient.auth.getSession()
        setUserEmail(data?.session?.user?.email || null)
      } catch (e) {
        console.error('[App] Failed to get user email:', e)
      }
    })()
  }, [])

  // 🎯 所有可用的资源菜单
  const allResources = [
    {
      name: 'dashboard',
      list: '/dashboard',
      meta: {
        label: '运营看板'
      }
    },
    {
      name: 'gifts',
      list: '/gifts',
      meta: { label: '礼物管理' }
    },
    {
      name: 'videos',
      list: '/videos',
      edit: '/videos/edit/:id',
      meta: {
        label: '视频管理'
      }
    },
    {
      name: 'profiles',
      list: '/users',
      edit: '/users/edit/:id',
      meta: {
        label: '用户管理'
      }
    },
    {
      name: 'recommendation_pool',
      list: '/recommendation-pool',
      meta: {
        label: '推荐池管理'
      }
    },
    {
      name: 'incentive_rules',
      list: '/incentive-rules',
      create: '/incentive-rules/create',
      edit: '/incentive-rules/edit/:id',
      meta: { label: '任务/活动规则' }
    },
    {
      name: 'user_video_incentive_progress',
      list: '/incentive-progress/video',
      meta: { label: '任务进度（作品）' }
    },
    {
      name: 'user_incentive_progress',
      list: '/incentive-progress/user',
      meta: { label: '任务进度（用户）' }
    },
    {
      name: 'coin_transactions',
      list: '/coin-transactions',
      meta: { label: '资金流水' }
    },
    {
      name: 'system_settings',
      list: '/system-settings',
      meta: { label: '系统设置' }
    },
    {
      name: 'live_rooms',
      list: '/live-rooms',
      create: '/live-rooms/create',
      edit: '/live-rooms/edit/:id',
      meta: { label: '直播间管理' }
    },
    {
      name: 'recharge_orders',
      list: '/recharge-orders',
      meta: { label: '充值订单' }
    },
    {
      name: 'withdraw_orders',
      list: '/withdraw-orders',
      meta: { label: '提现申请' }
    },
    {
      name: 'bound_channels',
      list: '/bound-channels',
      meta: { label: '频道同步管理' }
    },
    {
      name: 'inheritance',
      list: '/inheritance',
      meta: { label: '资产继承 (迁移)' }
    }
  ]

  // 🎯 根据用户邮箱过滤资源菜单
  const filteredResources = (() => {
    if (!userEmail) return allResources
    if (REVIEWER_EMAILS.includes(userEmail)) {
      // 审核员：显示视频管理、用户管理、资金流水、频道同步管理
      return allResources.filter((r) =>
        ['videos', 'profiles', 'coin_transactions', 'bound_channels'].includes(r.name)
      )
    }
    // 其他管理员：显示所有菜单
    return allResources
  })()

  // 🎯 检查是否为审核员
  const isReviewer = userEmail ? REVIEWER_EMAILS.includes(userEmail) : false

  return (
    <BrowserRouter>
      <ConfigProvider locale={zhCN}>
        <AntdApp>
          <Refine
            dataProvider={dataProvider(supabaseClient)}
            liveProvider={liveProvider(supabaseClient)}
            authProvider={authProvider}
            routerProvider={routerProvider}
            notificationProvider={useNotificationProvider}
            resources={filteredResources}
            options={{
              // 🎯 启用错误追踪
              mutationMode: 'pessimistic',
              // 🎯 禁用实时更新，避免频繁请求
              liveMode: 'off',
              syncWithLocation: true,
              warnWhenUnsavedChanges: true
            }}
          >
            <Routes>
              <Route path="/login" element={<Login />} />
              <Route element={<AdminGuard />}>
                {/* 默认首页：审核员跳转到视频管理，其他管理员跳转到 Dashboard */}
                <Route
                  index
                  element={isReviewer ? <Navigate to="/videos" replace /> : <Dashboard />}
                />
                {!isReviewer && <Route path="/dashboard" element={<Dashboard />} />}
                <Route path="/videos">
                  <Route index element={<VideoList />} />
                  <Route path="show/:id" element={<VideoShow />} />
                  <Route path="edit/:id" element={<VideoEdit />} />
                  <Route path="douyin-create" element={<VideoDouyinCreate />} />
                </Route>
                {/* 审核员和管理员都可以访问：用户管理、资金流水、频道同步管理 */}
                <Route path="/users">
                  <Route index element={<UserList />} />
                  <Route path="show/:id" element={<UserShow />} />
                  <Route path="edit/:id" element={<UserEdit />} />
                </Route>
                <Route path="/coin-transactions" element={<CoinTransactionList />} />
                <Route path="/bound-channels">
                  <Route index element={<BoundChannelList />} />
                </Route>
                {!isReviewer && (
                  <>
                    <Route path="/recommendation-pool">
                      <Route index element={<RecommendationPoolList />} />
                    </Route>
                    <Route path="/incentive-rules">
                      <Route index element={<IncentiveRuleList />} />
                      <Route path="create" element={<IncentiveRuleCreate />} />
                      <Route path="edit/:id" element={<IncentiveRuleEdit />} />
                    </Route>
                    <Route path="/incentive-progress">
                      <Route path="video" element={<UserVideoIncentiveProgressList />} />
                      <Route path="user" element={<UserIncentiveProgressList />} />
                    </Route>
                    <Route path="/system-settings" element={<SystemSettings />} />
                    <Route path="/live-rooms">
                      <Route index element={<LiveRoomList />} />
                      <Route path="create" element={<LiveRoomCreate />} />
                      <Route path="edit/:id" element={<LiveRoomEdit />} />
                    </Route>
                    <Route path="/recharge-orders" element={<RechargeOrderList />} />
                    <Route path="/withdraw-orders" element={<WithdrawOrderList />} />
                    <Route path="/gifts">
                      <Route index element={<GiftList />} />
                    </Route>
                    <Route path="/inheritance">
                      <Route index element={<InheritancePage />} />
                    </Route>
                  </>
                )}
                {/* 审核员访问其他页面时重定向到视频管理 */}
                {isReviewer && <Route path="*" element={<Navigate to="/videos" replace />} />}
              </Route>
              <Route path="*" element={<ErrorComponent />} />
            </Routes>
          </Refine>
        </AntdApp>
      </ConfigProvider>
    </BrowserRouter>
  )
}

export default App
