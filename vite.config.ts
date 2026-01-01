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
            // betterDefine: true,
            // reactivityTransform: {
            //   exclude: [/node_modules/, /jQuery\.js/]
            // }
          })
          // Vue(),
          // VueJsx(),
          // lifecycle === 'report' ? (visualizer({ open: false }) as any as PluginOption) : null,
          // importToCDN({
          //   modules: [
          //     {
          //       name: 'vue',
          //       var: 'Vue',
          //       path: `https://lib.baomitu.com/vue/3.4.21/vue.runtime.global.prod.min.js`
          //     },
          //     {
          //       name: 'vue-router',
          //       var: 'VueRouter',
          //       path: 'https://lib.baomitu.com/vue-router/4.3.0/vue-router.global.prod.min.js'
          //     },
          //     {
          //       name: 'vue-demi',
          //       var: 'VueDemi',
          //       path: 'https://lib.baomitu.com/vue-demi/0.14.7/index.iife.min.js'
          //     }
          //     // ❌ 移除 mockjs CDN 引用，生产环境不应该加载 Mock.js
          //     // {
          //     //   name: 'mockjs',
          //     //   var: 'Mock',
          //     //   path: 'https://lib.baomitu.com/Mock.js/1.0.1-beta3/mock-min.js'
          //     // }
          //   ]
          // })
          // viteCompression({
          //   verbose: false,
          //   disable: false,
          //   threshold: 10240,
          //   algorithm: 'brotliCompress',
          // }),
          // viteCompression({
          //   verbose: false,
          //   disable: false,
          //   algorithm: 'gzip',
          //   threshold: 10240,
          // }),
          // viteImagemin({
          //   gifsicle: {
          //     optimizationLevel: 7,
          //     interlaced: false,
          //   },
          //   optipng: {
          //     optimizationLevel: 7,
          //   },
          //   mozjpeg: {
          //     quality: 20,
          //   },
          //   pngquant: {
          //     quality: [0.8, 0.9],
          //     speed: 4,
          //   },
          //   svgo: {
          //     plugins: [
          //       {
          //         name: 'removeViewBox',
          //       },
          //       {
          //         name: 'removeEmptyAttrs',
          //         active: false,
          //       },
          //     ],
          //   },
          // }),
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
            // https://rollupjs.org/guide/en/#outputmanualchunks
            output: {
              manualChunks(id: string) {
                if (id.includes('node_modules')) {
                  if (id.includes('@supabase')) return 'supabase'
                  if (id.includes('@iconify')) return 'icons'
                  if (id.includes('vue-virtual-scroller')) return 'scroller'
                  return 'vendor'
                }
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
