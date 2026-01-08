import ReactDOM from 'react-dom/client'

// ✅ 生产环境禁用控制台输出（除非 URL 包含 debug=1）
if (import.meta.env.PROD && !window.location.search.includes('debug=1')) {
  console.log = () => {}
  console.info = () => {}
  console.debug = () => {}
}

import App from './App'

ReactDOM.createRoot(document.getElementById('root')!).render(<App />)
