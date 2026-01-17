import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error('缺少 Supabase 环境变量')
}

export const supabaseClient = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: true
  },
  db: {
    schema: 'public'
  },
  global: {
    // 🎯 自定义 fetch，增加请求超时时间和错误处理，避免 ERR_CONNECTION_CLOSED 和 JSON 解析错误
    fetch: async (url, options = {}) => {
      // 🎯 如果已经有 signal，直接使用
      if (options.signal) {
        return fetch(url, options)
      }

      // 🎯 创建超时控制器（60秒超时）
      const controller = new AbortController()
      const timeoutId = setTimeout(() => {
        controller.abort()
      }, 60000)

      try {
        const response = await fetch(url, {
          ...options,
          signal: controller.signal
        })

        // 🎯 检查响应是否完整（避免返回单个 } 的情况）
        // 对于非流式响应，先克隆响应以便检查内容
        if (
          !response.bodyUsed &&
          response.headers.get('content-type')?.includes('application/json')
        ) {
          const clonedResponse = response.clone()
          try {
            const text = await clonedResponse.text()
            // 🎯 检查是否是有效的 JSON（允许对象、数组、数字、字符串、布尔值、null）
            // RPC 函数可能返回纯数字（如 2780.00），这也是有效的 JSON
            if (text.trim()) {
              const trimmed = text.trim()
              // 允许的 JSON 格式：对象 { }, 数组 [ ], 数字 123, 字符串 "abc", 布尔值 true/false, null
              const isValidJson =
                trimmed.startsWith('{') ||
                trimmed.startsWith('[') ||
                /^-?\d+(\.\d+)?([eE][+-]?\d+)?$/.test(trimmed) || // 数字
                trimmed.startsWith('"') ||
                trimmed === 'true' ||
                trimmed === 'false' ||
                trimmed === 'null'

              if (!isValidJson && trimmed !== '}') {
                // 如果不是有效的 JSON 格式，且不是单个 }，才报错
                console.error('[SupabaseClient] 无效的 JSON 响应:', text.substring(0, 100))
                throw new Error('服务器返回了无效的响应格式')
              }
              // 🎯 尝试解析 JSON，确保格式正确
              JSON.parse(text)
            }
          } catch (parseError: any) {
            // 🎯 JSON 解析失败，抛出更友好的错误
            if (parseError.message.includes('JSON') || parseError.message.includes('Unexpected')) {
              console.error('[SupabaseClient] JSON 解析失败:', parseError)
              throw new Error('服务器响应格式错误，请刷新页面重试')
            }
            throw parseError
          }
        }

        return response
      } catch (error: any) {
        // 🎯 如果是 AbortError，提供更友好的错误信息
        if (error.name === 'AbortError' || error.message?.includes('aborted')) {
          throw new Error('请求超时，请稍后重试')
        }
        // 🎯 如果是网络错误
        if (
          error.message?.includes('Failed to fetch') ||
          error.message?.includes('ERR_CONNECTION')
        ) {
          throw new Error('网络连接失败，请检查网络后重试')
        }
        throw error
      } finally {
        clearTimeout(timeoutId)
      }
    }
  }
})
