/**
 * 远程日志工具 - 用于 Windows Telegram 调试
 * 将 console 日志发送到服务器或显示在页面上
 */

// 创建悬浮日志面板
let logPanel: HTMLDivElement | null = null
const logs: string[] = []
const MAX_LOGS = 50

export function initRemoteLogger() {
  // 只在 Telegram WebApp 中启用
  if (!window.Telegram?.WebApp) return

  // 创建日志面板
  logPanel = document.createElement('div')
  logPanel.style.cssText = `
    position: fixed;
    bottom: 60px;
    right: 10px;
    width: 300px;
    max-height: 400px;
    background: rgba(0, 0, 0, 0.9);
    color: #00ff00;
    font-size: 10px;
    padding: 10px;
    border-radius: 5px;
    overflow-y: auto;
    z-index: 99999;
    font-family: monospace;
    display: none;
  `
  document.body.appendChild(logPanel)

  // 双击切换显示/隐藏
  let tapCount = 0
  let tapTimer: any = null
  document.addEventListener('click', (e) => {
    tapCount++
    if (tapTimer) clearTimeout(tapTimer)
    
    tapTimer = setTimeout(() => {
      if (tapCount >= 5) {
        // 连续点击 5 次屏幕右上角显示日志
        const x = (e as MouseEvent).clientX
        const y = (e as MouseEvent).clientY
        if (x > window.innerWidth - 100 && y < 100) {
          toggleLogPanel()
        }
      }
      tapCount = 0
    }, 1000)
  })

  // 拦截 console.log
  const originalLog = console.log
  console.log = function(...args: any[]) {
    originalLog.apply(console, args)
    addLog('LOG', args)
  }

  // 拦截 console.error
  const originalError = console.error
  console.error = function(...args: any[]) {
    originalError.apply(console, args)
    addLog('ERROR', args)
  }

  // 拦截 console.warn
  const originalWarn = console.warn
  console.warn = function(...args: any[]) {
    originalWarn.apply(console, args)
    addLog('WARN', args)
  }

  // 拦截全局错误
  window.addEventListener('error', (e) => {
    addLog('ERROR', [e.message, e.filename, e.lineno])
  })

  // 拦截 Promise 错误
  window.addEventListener('unhandledrejection', (e) => {
    addLog('PROMISE_ERROR', [e.reason])
  })
}

function addLog(type: string, args: any[]) {
  const timestamp = new Date().toLocaleTimeString()
  const message = args.map(arg => {
    if (typeof arg === 'object') {
      try {
        return JSON.stringify(arg)
      } catch {
        return String(arg)
      }
    }
    return String(arg)
  }).join(' ')

  const logEntry = `[${timestamp}] ${type}: ${message}`
  logs.push(logEntry)

  // 限制日志数量
  if (logs.length > MAX_LOGS) {
    logs.shift()
  }

  updateLogPanel()
}

function updateLogPanel() {
  if (logPanel && logPanel.style.display !== 'none') {
    logPanel.innerHTML = logs.map(log => {
      if (log.includes('ERROR')) {
        return `<div style="color: #ff0000;">${log}</div>`
      } else if (log.includes('WARN')) {
        return `<div style="color: #ffff00;">${log}</div>`
      }
      return `<div>${log}</div>`
    }).join('')
    logPanel.scrollTop = logPanel.scrollHeight
  }
}

function toggleLogPanel() {
  if (logPanel) {
    if (logPanel.style.display === 'none') {
      logPanel.style.display = 'block'
      updateLogPanel()
    } else {
      logPanel.style.display = 'none'
    }
  }
}

