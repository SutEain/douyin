import ReactDOM from 'react-dom/client'

// ✅ 彻底禁用所有控制台输出（仅生产环境生效，除非 URL 包含 debug=1）
// 🎯 生产环境启用 console 的方法：
// 1. URL 添加 ?debug=1
// 2. 在浏览器控制台执行：window.__enableConsole__()
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

  // 🎯 保存原始 console 引用
  if (!(window as any).__rawConsole__) {
    ;(window as any).__rawConsole__ = {}
    consoleMethods.forEach((method) => {
      ;(window as any).__rawConsole__[method] = (console as any)[method]
    })
  }

  // 覆盖方法
  consoleMethods.forEach((method) => {
    if (typeof (console as any)[method] === 'function') {
      ;(console as any)[method] = noop
    }
  })

  // 🎯 提供恢复 console 的方法（方便调试）
  ;(window as any).__enableConsole__ = function () {
    const rawConsole = (window as any).__rawConsole__
    if (rawConsole) {
      consoleMethods.forEach((method) => {
        try {
          if (typeof rawConsole[method] === 'function') {
            ;(console as any)[method] = rawConsole[method]
          }
        } catch (e) {
          // ignore
        }
      })
      // 使用原始 console.log 输出提示
      if (rawConsole.log) {
        rawConsole.log('[Console] ✅ Console 已启用！')
      }
    }
  }
} else {
  // 开发环境或已启用调试，提供空函数避免报错
  ;(window as any).__enableConsole__ = function () {
    console.log('[Console] Console 已经是启用状态')
  }
}

import App from './App'

ReactDOM.createRoot(document.getElementById('root')!).render(<App />)
