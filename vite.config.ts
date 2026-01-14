import { defineConfig, PluginOption, UserConfig } from 'vite'
import Vue from '@vitejs/plugin-vue'
import VueJsx from '@vitejs/plugin-vue-jsx'
import { visualizer } from 'rollup-plugin-visualizer'
import { Plugin as importToCDN } from 'vite-plugin-cdn-import'
import { fileURLToPath, URL } from 'node:url'
import { getLastCommit } from 'git-last-commit'
import VueMacros from 'unplugin-vue-macros/vite'

const lifecycle = process.env.npm_lifecycle_event

export default defineConfig((): Promise<UserConfig> => {
  let latestCommitHash = ''

  return new Promise((resolve) => {
    getLastCommit((err, commit) => {
      if (!err) {
        latestCommitHash = commit.shortHash
      }
      resolve({
        base: process.env.VITE_ENV === 'GITEE_PAGES' ? '/douyin' : '/',
        envDir: 'env',
        plugins: [
          VueMacros({
            plugins: {
              vue: Vue(),
              vueJsx: VueJsx() // if needed
            }
          })
        ],
        resolve: {
          alias: {
            '@': fileURLToPath(new URL('./src', import.meta.url))
          },
          extensions: ['.mjs', '.js', '.ts', '.jsx', '.tsx', '.json', '.vue']
        },
        build: {
          sourcemap: false,
          rollupOptions: {
            output: {
              manualChunks(id: string) {
                // 1. 独立拆分非逻辑依赖
                if (id.includes('node_modules')) {
                  if (id.includes('@iconify')) return 'libs-icons'
                  return 'vendor'
                }

                // 2. 业务页面按功能模块分包
                if (id.includes('/src/pages/')) {
                  if (
                    !id.includes('/src/pages/home/index.vue') &&
                    !id.includes('/src/pages/home/slide/')
                  ) {
                    return 'other'
                  }
                }
              },
              chunkFileNames: 'js/[name]-[hash].js',
              entryFileNames: 'js/[name]-[hash].js',
              assetFileNames: 'assets/[name]-[hash].[ext]'
            }
          },
          assetsInlineLimit: 2048
        },
        define: {
          LATEST_COMMIT_HASH: JSON.stringify(
            latestCommitHash + (process.env.NODE_ENV === 'production' ? '' : ' (dev)')
          )
        },
        server: {
          port: 3000,
          open: true,
          host: '0.0.0.0',
          allowedHosts: [
            '.ngrok-free.app',
            '.ngrok-free.dev',
            '.ngrok.io',
            '.ngrok.app',
            'localhost',
            'app.reol-dev.com'
          ],
          fs: {
            strict: false
          },
          proxy: {
            '/api': {
              target: process.env.VITE_SUPABASE_URL || 'http://localhost:54321',
              changeOrigin: true,
              rewrite: (path) => path.replace(/^\/api/, '/functions/v1')
            }
          }
        },
        preview: {
          port: 5555
        }
      })
    })
  })
})
