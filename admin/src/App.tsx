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
                    fallback={<div>Loading...</div>}
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
