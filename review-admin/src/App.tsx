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
import { authProvider } from './authProvider'
import { Login } from './pages/login'
import { VideoList } from './pages/videos/list'
import { UserList } from './pages/users/list'
import { TransactionList } from './pages/transactions/list'

function ReviewerGuard() {
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

        const { data: profile } = await supabaseClient
          .from('profiles')
          .select('is_reviewer, is_admin')
          .eq('id', session.user.id)
          .single()

        if (!profile?.is_reviewer && !profile?.is_admin) {
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
        if (mounted) {
          setOk(false)
          setChecking(false)
        }
      }
    })()
    return () => { mounted = false }
  }, [])

  if (checking) return <div style={{ padding: 24 }}>身份核验中...</div>
  if (!ok) return <Navigate to="/login" replace />

  return (
    <ThemedLayout>
      <Outlet />
    </ThemedLayout>
  )
}

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
                name: 'videos',
                list: '/videos',
                meta: { label: '视频审核' }
              },
              {
                name: 'profiles',
                list: '/users',
                meta: { label: '用户管理' }
              },
              {
                name: 'coin_transactions',
                list: '/transactions',
                meta: { label: '资金流水' }
              }
            ]}
            options={{
              syncWithLocation: true,
              warnWhenUnsavedChanges: true
            }}
          >
            <Routes>
              <Route path="/login" element={<Login />} />
              <Route element={<ReviewerGuard />}>
                <Route index element={<Navigate to="/videos" replace />} />
                <Route path="/videos" element={<VideoList />} />
                <Route path="/users" element={<UserList />} />
                <Route path="/transactions" element={<TransactionList />} />
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
