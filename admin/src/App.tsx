import { Refine, Authenticated } from '@refinedev/core'
import { ErrorComponent, useNotificationProvider, ThemedLayout } from '@refinedev/antd'
import { BrowserRouter, Outlet, Route, Routes } from 'react-router-dom'
import routerProvider from '@refinedev/react-router'
import { dataProvider, liveProvider } from '@refinedev/supabase'
import { App as AntdApp, ConfigProvider } from 'antd'
import zhCN from 'antd/locale/zh_CN'
import '@refinedev/antd/dist/reset.css'

import { supabaseClient } from './supabaseClient'
import { VideoList, VideoShow, VideoEdit } from './pages/videos'
import { UserList, UserShow, UserEdit } from './pages/users'
import { RecommendationPoolList } from './pages/recommendation-pool'
import { IncentiveRuleCreate, IncentiveRuleEdit, IncentiveRuleList } from './pages/incentive-rules'
import {
  UserIncentiveProgressList,
  UserVideoIncentiveProgressList
} from './pages/incentive-progress/index'
import { WalletLedgerList } from './pages/wallet-ledger/index'
import { SystemSettings } from './pages/system-settings'
import { Login } from './pages/login'
import { authProvider } from './authProvider'
import { Dashboard } from './pages/dashboard'

function App() {
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
            resources={[
              {
                name: 'dashboard',
                list: '/dashboard',
                meta: {
                  label: '运营看板'
                }
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
                name: 'wallet_ledger',
                list: '/wallet-ledger',
                meta: { label: '资金流水' }
              },
              {
                name: 'system_settings',
                list: '/system-settings',
                meta: { label: '系统设置' }
              }
            ]}
            options={{
              syncWithLocation: true,
              warnWhenUnsavedChanges: true
            }}
          >
            <Routes>
              <Route path="/login" element={<Login />} />
              <Route
                element={
                  <Authenticated
                    key="authenticated-routes"
                    redirectOnFail="/login"
                    fallback={<div style={{ padding: 24 }}>加载中...</div>}
                  >
                    <ThemedLayout>
                      <Outlet />
                    </ThemedLayout>
                  </Authenticated>
                }
              >
                {/* 默认首页为 Dashboard */}
                <Route index element={<Dashboard />} />
                <Route path="/dashboard" element={<Dashboard />} />
                <Route path="/videos">
                  <Route index element={<VideoList />} />
                  <Route path="show/:id" element={<VideoShow />} />
                  <Route path="edit/:id" element={<VideoEdit />} />
                </Route>
                <Route path="/users">
                  <Route index element={<UserList />} />
                  <Route path="show/:id" element={<UserShow />} />
                  <Route path="edit/:id" element={<UserEdit />} />
                </Route>
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
                <Route path="/wallet-ledger" element={<WalletLedgerList />} />
                <Route path="/system-settings" element={<SystemSettings />} />
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
