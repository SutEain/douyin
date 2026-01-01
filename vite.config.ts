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
              manualChunks(id: string, { getModuleInfo }: any) {
                const reg = /(.*)\/src\/components\/(.*)/
                if (reg.test(id)) {
                  const importersLen = getModuleInfo(id)?.importers.length ?? 0
                  // 被多处引用
                  if (importersLen > 1) return 'common'
                }
                if (id.includes('node_modules')) return 'vendor'

                if (id.includes('/src/pages/home/Publish.vue')) return 'other'

                if (id.includes('/src/pages/home/Music.vue')) return 'other'
                if (id.includes('/src/pages/home/MusicRankList.vue')) return 'other'
                if (id.includes('/src/pages/home/LivePage.vue')) return 'other'
                if (id.includes('/src/pages/home/SearchPage.vue')) return 'other'

                if (id.includes('/src/pages/shop/Shop.vue')) return 'other'
                if (id.includes('/src/pages/shop/GoodsDetail.vue')) return 'other'

                if (id.includes('/src/pages/message/Message.vue')) return 'other'
                if (id.includes('/src/pages/message/Fans.vue')) return 'other'
                if (id.includes('/src/pages/message/AllMessage.vue')) return 'other'
                if (id.includes('/src/pages/message/notice/DouyinHelper.vue')) return 'other'
                if (id.includes('/src/pages/message/notice/SystemNotice.vue')) return 'other'
                if (id.includes('/src/pages/message/notice/TaskNotice.vue')) return 'other'
                if (id.includes('/src/pages/message/notice/LiveNotice.vue')) return 'other'
                if (id.includes('/src/pages/message/notice/MoneyNotice.vue')) return 'other'

                if (id.includes('/src/pages/me/Me.vue')) return 'other'
                if (id.includes('/src/pages/me/Visitors.vue')) return 'other'
                if (id.includes('/src/pages/me/RequestUpdate.vue')) return 'other'
                if (id.includes('/src/pages/me/userinfo/EditUserInfo.vue')) return 'other'
                if (id.includes('/src/pages/me/userinfo/EditUserInfoItem.vue')) return 'other'
                if (id.includes('/src/pages/me/MyMusic.vue')) return 'other'

                if (id.includes('/src/pages/other/VideoDetail.vue')) return 'other'
                if (id.includes('/src/pages/other/AlbumDetail.vue')) return 'other'

                if (id.includes('/src/pages/people/FindAcquaintance.vue')) return 'other'
                if (id.includes('/src/pages/people/FollowAndFans.vue')) return 'other'
              },
              chunkFileNames: 'js/[name]-[hash].js', // 引入文件名的名称
              entryFileNames: 'js/[name]-[hash].js', // 包的入口文件名称
              assetFileNames: 'assets/[name]-[hash].[ext]' // 资源文件像 字体，图片等
            }
          },
          assetsInlineLimit: 2048
        },
        define: {
          LATEST_COMMIT_HASH: JSON.stringify(
            latestCommitHash + (process.env.NODE_ENV === 'production' ? '' : ' (dev)')
          )
        },
        esbuild: {
          // drop: ['console', 'debugger']
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
