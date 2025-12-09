import { AuthPage } from '@refinedev/antd'

export const Login = () => {
  return (
    <AuthPage
      type="login"
      title="抖音管理后台"
      formProps={{
        initialValues: {
          email: '',
          password: ''
        }
      }}
    />
  )
}
