import ReactDOM from 'react-dom/client'

// ✅ 彻底禁用所有控制台输出（仅生产环境生效，除非 URL 包含 debug=1）
if (import.meta.env.PROD && !window.location.search.includes('debug=1')) {
  const noop = () => {}
  const consoleMethods: (keyof Console)[] = [
    'log',
    'info',
    'debug',
    'warn',
    'error',
    'trace',
    'table',
    'group',
    'groupCollapsed',
    'groupEnd',
    'time',
    'timeEnd',
    'count',
    'assert'
  ]

  consoleMethods.forEach((method) => {
    if (typeof (console as any)[method] === 'function') {
      ;(console as any)[method] = noop
    }
  })
}

import App from './App'

ReactDOM.createRoot(document.getElementById('root')!).render(<App />)
