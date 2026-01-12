import { Refine, Authenticated } from '@refinedev/core'
import { RefineKbar, RefineKbarProvider } from '@refinedev/kbar'
import { ErrorComponent, ThemedLayoutV2, useNotificationProvider } from '@refinedev/antd'
import routerBindings, {
  CatchAllNavigate,
  DocumentTitleHandler,
  NavigateToResource,
  UnsavedChangesNotifier
} from '@refinedev/react-router-v6'
import { dataProvider, liveProvider } from '@refinedev/supabase'
import { BrowserRouter, Outlet, Route, Routes } from 'react-router-dom'
import { App as AntdApp, ConfigProvider } from 'antd'
import zhCN from 'antd/locale/zh_CN'
import '@refinedev/antd/dist/reset.css'

import { supabaseClient } from './supabaseClient'
import { authProvider } from './authProvider'
import { VideoList } from './pages/videos/list'
import { VideoShow } from './pages/videos/show'
import { UserList } from './pages/users/list'
import { UserShow } from './pages/users/show'
import { TransactionList } from './pages/transactions/list'
import { Login } from './pages/login'

import { VideoCameraOutlined, UserOutlined, TransactionOutlined } from '@ant-design/icons'

function App() {
  return (
    <BrowserRouter>
      <ConfigProvider locale={zhCN}>
        <RefineKbarProvider>
          <AntdApp>
            <Refine
              dataProvider={dataProvider(supabaseClient)}
              liveProvider={liveProvider(supabaseClient)}
              authProvider={authProvider}
              routerProvider={routerBindings}
              notificationProvider={useNotificationProvider}
              resources={[
                {
                  name: 'videos',
                  list: '/videos',
                  show: '/videos/show/:id',
                  meta: {
                    label: '视频审核',
                    icon: <VideoCameraOutlined />
                  }
                },
                {
                  name: 'profiles',
                  list: '/users',
                  show: '/users/show/:id',
                  meta: {
                    label: '用户管理',
                    icon: <UserOutlined />
                  }
                },
                {
                  name: 'coin_transactions',
                  list: '/transactions',
                  meta: {
                    label: '资金流水',
                    icon: <TransactionOutlined />
                  }
                }
              ]}
              options={{
                syncWithLocation: true,
                warnWhenUnsavedChanges: true,
                useNewQueryKeys: true,
                projectId: 'review-admin'
              }}
            >
              <Routes>
                <Route
                  element={
                    <Authenticated
                      key="authenticated-inner"
                      fallback={<CatchAllNavigate to="/login" />}
                    >
                      <ThemedLayoutV2>
                        <Outlet />
                      </ThemedLayoutV2>
                    </Authenticated>
                  }
                >
                  <Route index element={<NavigateToResource resource="videos" />} />
                  <Route path="/videos">
                    <Route index element={<VideoList />} />
                    <Route path="show/:id" element={<VideoShow />} />
                  </Route>
                  <Route path="/users">
                    <Route index element={<UserList />} />
                    <Route path="show/:id" element={<UserShow />} />
                  </Route>
                  <Route path="/transactions" element={<TransactionList />} />
                </Route>
                <Route
                  element={
                    <Authenticated key="authenticated-outer" fallback={<Outlet />}>
                      <NavigateToResource />
                    </Authenticated>
                  }
                >
                  <Route path="/login" element={<Login />} />
                </Route>
                <Route path="*" element={<ErrorComponent />} />
              </Routes>

              <RefineKbar />
              <UnsavedChangesNotifier />
              <DocumentTitleHandler />
            </Refine>
          </AntdApp>
        </RefineKbarProvider>
      </ConfigProvider>
    </BrowserRouter>
  )
}

export default App
