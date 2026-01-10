import { defineStore } from 'pinia'
import enums from '@/utils/enums'
import resource from '@/assets/data/resource'
import defaultAvatar from '@/assets/img/icon/avatar/0.png'
import i18n from '@/locales'

type SupabaseProfile = {
  id?: string
  nickname?: string | null
  username?: string | null
  bio?: string | null
  avatar_url?: string | null
  cover_url?: string | null
  follower_count?: number | null
  following_count?: number | null
  video_count?: number | null
  country?: string | null
  province?: string | null
  city?: string | null
  gender?: number | null
  birthday?: string | null
  tg_username?: string | null
  lang?: string | null
  numeric_id?: number | null
  show_collect?: boolean | null
  show_like?: boolean | null
  show_tg_username?: boolean | null
  balance_coins?: number | null
  is_admin?: boolean | null
  checkin_streak?: number | null
  last_checkin_at?: string | null
  is_banned?: boolean | null
  ban_reason?: string | null
}

function normalizeLang(lang?: string | null) {
  if (!lang) return 'zh-CN'
  const value = String(lang).replace('_', '-').toLowerCase()
  if (value.startsWith('zh')) {
    return 'zh-CN'
  }
  if (value.startsWith('en')) {
    return 'en-US'
  }
  return 'en-US'
}

function calculateAge(birthday?: string | null): number {
  if (!birthday) return -1
  const birthDate = new Date(birthday)
  if (Number.isNaN(birthDate.getTime())) return -1
  const today = new Date()
  let age = today.getFullYear() - birthDate.getFullYear()
  const m = today.getMonth() - birthDate.getMonth()
  if (m < 0 || (m === 0 && today.getDate() < birthDate.getDate())) {
    age--
  }
  return age < 0 ? -1 : age
}

function mapProfileToUserinfo(profile: SupabaseProfile, current: any) {
  if (!profile) return current

  const avatar = profile.avatar_url || current?.avatar_300x300?.url_list?.[0] || defaultAvatar
  const cover = profile.cover_url || current?.cover_url?.[0]?.url_list?.[0] || ''
  const birthday = profile.birthday || current?.birthday || ''

  const lang = normalizeLang(profile.lang || current?.lang)

  return {
    ...current,
    uid: profile.id || current.uid,
    nickname:
      profile.nickname ||
      (profile.tg_username ? `@${profile.tg_username}` : current.nickname || '抖音用户'),
    unique_id: profile.username || profile.tg_username || current.unique_id,
    signature: profile.bio || '',
    gender: profile.gender ?? current.gender ?? 0,
    lang,
    birthday,
    user_age: calculateAge(birthday),
    country: profile.country || '',
    province: profile.province || '',
    city: profile.city || '',
    aweme_count: profile.video_count ?? current.aweme_count ?? 0,
    following_count: profile.following_count ?? current.following_count ?? 0,
    follower_count: profile.follower_count ?? current.follower_count ?? 0,
    balance_coins: profile.balance_coins ?? current.balance_coins ?? 0,
    is_admin: profile.is_admin === true,
    is_banned: profile.is_banned === true,
    ban_reason: profile.ban_reason || '',
    // 🎯 数字ID
    numeric_id: profile.numeric_id ?? current.numeric_id ?? null,
    // 🎯 隐私设置
    show_collect: profile.show_collect !== false,
    show_like: profile.show_like !== false,
    show_tg_username: profile.show_tg_username === true,
    checkin_streak: profile.checkin_streak ?? current.checkin_streak ?? 0,
    last_checkin_at: profile.last_checkin_at ?? current.last_checkin_at ?? null,
    avatar_168x168: {
      url_list: [avatar]
    },
    avatar_300x300: {
      url_list: [avatar]
    },
    cover_url: cover ? [{ url_list: [cover] }] : [{ url_list: [] }],
    white_cover_url: [{ url_list: [] }]
  }
}

export const useBaseStore = defineStore('base', {
  state: () => {
    return {
      bodyHeight: document.body.clientHeight,
      bodyWidth: document.body.clientWidth,
      maskDialog: false,
      maskDialogMode: 'dark',
      version: '17.1.0',
      excludeNames: [],
      judgeValue: 20,
      homeRefresh: 60,
      loading: false,
      routeData: null,
      users: [],
      // 🎯 深链接：从 Telegram 启动参数传来的 video_id
      startVideoId: null as string | null,
      // 🎯 深链接：从 Telegram 启动参数传来的 live_room_id
      startLiveId: null as string | null,
      // 🎯 深链接：预加载的视频数据
      startVideoData: null as any,
      userinfo: {
        uid: '',
        nickname: '',
        desc: '',
        user_age: -1,
        signature: '',
        unique_id: '',
        province: '',
        city: '',
        country: '',
        birthday: '',
        gender: 0,
        lang: 'zh-CN',
        aweme_count: 0,
        following_count: 0,
        follower_count: 0,
        balance_coins: 0,
        is_admin: false,
        is_banned: false,
        ban_reason: '',
        is_private: false,
        numeric_id: null,
        show_collect: true,
        show_like: true,
        show_tg_username: false,
        checkin_streak: 0,
        last_checkin_at: null,
        school: {
          name: '',
          department: null,
          joinTime: null,
          education: null,
          displayType: enums.DISPLAY_TYPE.ALL
        },
        avatar_168x168: {
          url_list: []
        },
        avatar_300x300: {
          url_list: []
        },
        cover_url: [
          {
            url_list: []
          }
        ],
        white_cover_url: [
          {
            url_list: []
          }
        ]
      },
      friends: resource.users,
      message: '',
      _isInitializing: false, // 🎯 内部锁，防止重复初始化
      _authRetryCount: 0, // 🎯 自动登录重试计数，防止死循环
      isAppReady: false // 🎯 应用初始化就绪标志（登录+信息同步完成）
    }
  },
  getters: {
    selectFriends() {
      const allFriends = (this as any).friends?.all ?? []
      return allFriends.filter((v: any) => v.select)
    }
  },
  actions: {
    async init() {
      // 🎯 防止重复初始化导致的死循环或资源浪费
      // @ts-ignore
      if (this._isInitializing) {
        console.warn('[Store.init] ⏳ 初始化已在进行中，跳过重复调用')
        return
      }
      // @ts-ignore
      this._isInitializing = true

      // 1. 🎯 并行启动：解析参数、加载 API
      // 提前加载核心 API 模块，避免后续顺序调用导致的等待
      const paramPromise = Promise.resolve().then(() => this.parseStartParam())
      const authApiPromise = import('@/api/auth')
      const videoApiPromise = import('@/api/videos')

      await paramPromise // 确保 startVideoId/startLiveId 已从 URL/TG 环境解析完成

      // 2. 🎯 并行执行任务池：身份验证 & 深链接数据预取
      // 这样在验证身份的同时，已经在拉取视频详情了
      const tasks: Promise<any>[] = [authApiPromise]

      let videoTaskIndex = -1
      if (this.startVideoId && !this.startVideoData) {
        tasks.push(videoApiPromise.then(({ getVideoById }) => getVideoById(this.startVideoId!)))
        videoTaskIndex = tasks.length - 1
      }

      try {
        const results = await Promise.all(tasks)
        const { getCurrentProfile, loginWithTelegram, logout } = results[0]

        // 处理深链接视频预加载结果（如果存在）
        if (videoTaskIndex !== -1) {
          const videoRes = results[videoTaskIndex]
          if (videoRes?.success && videoRes.data) {
            this.setStartVideoData(videoRes.data)
            console.log('[Store.init] 深链接视频预加载成功')
          }
        }

        // 3. 处理身份验证逻辑
        console.log('[Store.init] 📋 开始获取用户 profile...')
        let profile = await getCurrentProfile()
        console.log(
          '[Store.init] 📊 getCurrentProfile() 结果:',
          profile
            ? {
                id: profile.id,
                nickname: profile.nickname,
                username: profile.username,
                tg_user_id: profile.tg_user_id
              }
            : '无 profile'
        )

        // 🎯 自动登录与"防串号"校验逻辑
        // @ts-ignore
        const tg = window.Telegram?.WebApp
        console.log('[Store.init] 🔍 Telegram WebApp 对象:', {
          exists: !!tg,
          version: tg?.version,
          platform: tg?.platform,
          hasInitData: !!tg?.initData,
          initDataLength: tg?.initData?.length || 0
        })

        if (tg) {
          tg.expand()
        }

        const tgUser = tg?.initDataUnsafe?.user
        console.log(
          '[Store.init] 👤 Telegram 用户信息:',
          tgUser
            ? {
                id: tgUser.id,
                first_name: tgUser.first_name,
                username: tgUser.username
              }
            : '无 TG 用户信息'
        )

        // 🚨 核心漏洞修复：检测 Telegram 当前用户与本地缓存用户是否一致
        if (profile && tgUser) {
          // 🎯 强制转字符串对比，防止大整数精度丢失导致的误判
          const cachedTgId = String(profile.tg_user_id || '')
          const currentTgId = String(tgUser.id || '')

          console.log('[Store.init] 🔐 账号校验:', {
            cached: cachedTgId,
            current: currentTgId,
            match: cachedTgId === currentTgId
          })

          if (cachedTgId && currentTgId && cachedTgId !== currentTgId) {
            console.warn(`[Auth] 📢 检测到账号切换: ${cachedTgId} -> ${currentTgId}，强制重新登录`)
            await logout() // 清除 A 账号本地缓存
            profile = null // 标记为未登录，进入下方的自动登录逻辑
          }
        }

        // 🎯 自动登录：如果在 TG 环境且没登录（或者是刚才因为账号切换被清除了），则自动登录
        if (!profile && tg?.initData) {
          // 🛡️ 防死循环保护：如果单次生命周期内尝试登录超过 3 次，停止尝试
          if (this._authRetryCount < 3) {
            try {
              this._authRetryCount++
              console.log(`[Auth] 🚀 正在执行 Telegram 自动登录 (第 ${this._authRetryCount} 次)...`)
              await loginWithTelegram(tg.initData)
              profile = await getCurrentProfile()
              console.log('[Auth] ✅ 自动登录完成，profile:', profile ? '成功' : '失败')
            } catch (e) {
              console.error('[Auth] ❌ 自动登录失败:', e)
            }
          } else {
            console.error('[Auth] 🛑 自动登录尝试次数过多，停止重试，防止 WebView 崩溃')
          }
        } else if (!profile && !tg?.initData) {
          console.log(
            '[Store.init] ℹ️ 无 profile 且无 TG initData，跳过自动登录（可能是验证码登录）'
          )
        }

        if (profile) {
          console.log('[Store.init] ✅ 应用 profile 到 userinfo...')
          this.userinfo = mapProfileToUserinfo(profile, this.userinfo)
          const lang = normalizeLang(this.userinfo.lang)
          this.userinfo.lang = lang
          i18n.global.locale.value = lang
          console.log('[Store.init] 🎉 用户信息已设置:', {
            uid: this.userinfo.uid,
            nickname: this.userinfo.nickname,
            unique_id: this.userinfo.unique_id
          })
        } else {
          console.warn('[Store.init] ⚠️ 最终没有 profile，用户未登录')
          // 如果最终没有 profile (未登录)，尝试使用 Telegram 语言设置
          const tgLang = tg?.initDataUnsafe?.user?.language_code
          const lang = normalizeLang(tgLang)
          this.userinfo.lang = lang
          i18n.global.locale.value = lang
        }
      } catch (error) {
        console.warn('[Store.init] 获取用户数据或登录失败:', error)
      } finally {
        // ✅ 无论如何都要标记就绪，允许 App 渲染
        this.isAppReady = true
        // @ts-ignore
        this._isInitializing = false
      }
    },

    // 🎯 自动初始化用户（用于深链接等场景）
    async autoInitUser() {
      const { callAppServer } = await import('@/api/videos')
      const res = await callAppServer('/user/auto-init', {
        method: 'POST'
      })

      if (res.code === 0) {
        // 更新用户信息到 store
        this.userinfo = {
          ...this.userinfo,
          id: res.data.id,
          uid: res.data.id,
          short_id: res.data.numeric_id || '',
          unique_id: res.data.username || '',
          nickname: res.data.nickname || 'Telegram 用户',
          avatar_168x168: {
            url_list: [res.data.avatar || '']
          }
        }
        return res.data
      } else {
        throw new Error(res.msg || '初始化失败')
      }
    },

    // 🎯 解析 Telegram 启动参数
    async parseStartParam() {
      try {
        console.log('[parseStartParam] ========== 开始解析启动参数 ==========')
        console.log('[parseStartParam] window.location.href:', window.location.href)
        console.log('[parseStartParam] window.location.search:', window.location.search)

        // 🎯 Windows 修复：优先从 URL 中解析 startapp 参数（适用于通知链接）
        const urlParams = new URLSearchParams(window.location.search)
        const startappParam = urlParams.get('startapp')
        console.log('[parseStartParam] startappParam from URL:', startappParam)

        if (startappParam) {
          // 解析格式：video_xxxxx[_iyyyyy] 或 live_xxxxx[_iyyyyy]
          if (startappParam.startsWith('video_')) {
            let videoId = startappParam.replace('video_', '')
            // 去除邀请码后缀
            if (videoId.includes('_i')) {
              videoId = videoId.split('_i')[0]
            }
            this.startVideoId = videoId
            console.log('[parseStartParam] ✅ 从 URL startapp 参数解析到视频 ID:', videoId)
            return
          } else if (startappParam.startsWith('live_')) {
            let roomId = startappParam.replace('live_', '')
            // 🎯 去除邀请码后缀
            if (roomId.includes('_i')) {
              roomId = roomId.split('_i')[0]
            }
            this.startLiveId = roomId
            console.log('[parseStartParam] ✅ 从 URL startapp 参数解析到直播间 ID:', roomId)
            console.log('[parseStartParam] ✅ store.startLiveId 已设置为:', this.startLiveId)
            return
          }
        }

        // 🎯 等待 Telegram WebApp 初始化（最多等待 3 秒）
        // @ts-ignore
        let tg = window.Telegram?.WebApp
        console.log('[parseStartParam] Telegram WebApp 初始状态:', tg ? '存在' : '不存在')

        if (!tg) {
          console.log('[parseStartParam] ⏳ Telegram WebApp 未初始化，等待最多 3 秒...')
          for (let i = 0; i < 30; i++) {
            await new Promise((resolve) => setTimeout(resolve, 100))
            // @ts-ignore
            tg = window.Telegram?.WebApp
            if (tg) {
              console.log(
                '[parseStartParam] ✅ Telegram WebApp 已初始化（等待了',
                (i + 1) * 100,
                'ms）'
              )
              break
            }
          }
        }

        if (!tg) {
          console.log('[parseStartParam] ⚠️ Telegram WebApp 仍未初始化，跳过 TG 参数解析')
          return
        }

        // 方式1: 从 start_param 获取（格式：video_xxxxx）
        const startParam = tg.initDataUnsafe?.start_param
        console.log('[parseStartParam] Telegram start_param:', startParam)

        if (startParam) {
          // 解析格式：video_xxxxx[_iyyyyy]
          if (startParam.startsWith('video_')) {
            let videoId = startParam.replace('video_', '')
            // 去除邀请码后缀
            if (videoId.includes('_i')) {
              videoId = videoId.split('_i')[0]
            }
            this.startVideoId = videoId
            console.log('[parseStartParam] ✅ 从 Telegram start_param 解析到视频 ID:', videoId)
            return
          } else if (startParam.startsWith('live_')) {
            let roomId = startParam.replace('live_', '')
            // 🎯 去除邀请码后缀
            if (roomId.includes('_i')) {
              roomId = roomId.split('_i')[0]
            }
            this.startLiveId = roomId
            console.log('[parseStartParam] ✅ 从 Telegram start_param 解析到直播间 ID:', roomId)
            console.log('[parseStartParam] ✅ store.startLiveId 已设置为:', this.startLiveId)
            return
          }
        }

        // 方式2: 从 URL 参数获取（格式：?video_id=abcd）
        const videoId = urlParams.get('video_id')

        if (videoId) {
          this.startVideoId = videoId
          console.log('[parseStartParam] ✅ 从 URL video_id 参数解析到视频 ID:', videoId)
          return
        }

        // 方式3: 从 hash 中解析（有些情况参数在 hash 中）
        if (window.location.hash) {
          const hashParams = new URLSearchParams(window.location.hash.substring(1))
          const hashVideoId = hashParams.get('video_id')

          if (hashVideoId) {
            this.startVideoId = hashVideoId
            console.log('[parseStartParam] ✅ 从 URL hash 解析到视频 ID:', hashVideoId)
            return
          }
        }

        console.log('[parseStartParam] ⚠️ 没有找到任何启动参数')
      } catch (error) {
        console.error('[parseStartParam] ❌ 解析失败:', error)
      }
    },
    // 🎯 设置深链接视频数据
    setStartVideoData(videoData: any) {
      this.startVideoData = videoData
    },
    // 🎯 清空启动参数（已使用）
    clearStartVideoId() {
      this.startVideoId = null
      this.startVideoData = null
    },
    // 🎯 仅清除 ID 触发器，保留预加载数据供详情页使用
    consumeStartVideoId() {
      this.startVideoId = null
    },
    clearStartLiveId() {
      this.startLiveId = null
    },
    setUserinfo(val) {
      this.userinfo = { ...this.userinfo, ...val }
    },
    applyProfile(profile: SupabaseProfile) {
      this.userinfo = mapProfileToUserinfo(profile, this.userinfo)
      const lang = normalizeLang(this.userinfo.lang)
      this.userinfo.lang = lang
      i18n.global.locale.value = lang
    },
    async updateProfileFields(partial: Record<string, any>) {
      this.userinfo = { ...this.userinfo, ...partial }
      if (Object.prototype.hasOwnProperty.call(partial, 'birthday')) {
        this.userinfo.user_age = calculateAge(this.userinfo.birthday)
      }
      const keys = Object.keys(partial)
      if (!keys.length) return

      const payload: Record<string, any> = {}
      if (keys.includes('nickname')) payload.nickname = this.userinfo.nickname
      if (keys.includes('unique_id')) payload.username = this.userinfo.unique_id
      if (keys.includes('signature')) payload.bio = this.userinfo.signature
      if (keys.includes('gender')) payload.gender = this.userinfo.gender
      if (keys.includes('birthday')) payload.birthday = this.userinfo.birthday || null
      if (keys.includes('country')) payload.country = this.userinfo.country || null
      if (keys.includes('province')) payload.province = this.userinfo.province || null
      if (keys.includes('city')) payload.city = this.userinfo.city || null
      if (keys.includes('lang')) payload.lang = this.userinfo.lang || 'en-US'
      if (keys.includes('avatar_300x300') || keys.includes('avatar_168x168')) {
        payload.avatar_url = this.userinfo.avatar_300x300.url_list[0] || null
      }
      if (keys.includes('cover_url')) {
        payload.cover_url = this.userinfo.cover_url?.[0]?.url_list?.[0] || null
      }

      if (!Object.keys(payload).length) return

      try {
        const { updateProfile } = await import('@/api/profile')
        const profile = await updateProfile(payload)
        this.applyProfile(profile)
      } catch (error) {
        console.error('更新资料失败：', error)
      }
    },
    setMaskDialog(val) {
      this.maskDialog = val.state
      if (val.mode) {
        this.maskDialogMode = val.mode
      }
    },
    updateExcludeNames(val) {
      if (val.type === 'add') {
        if (!this.excludeNames.find((v) => v === val.value)) {
          this.excludeNames.push(val.value)
        }
      } else {
        const resIndex = this.excludeNames.findIndex((v) => v === val.value)
        if (resIndex !== -1) {
          this.excludeNames.splice(resIndex, 1)
        }
      }
      // console.log('store.excludeNames', store.excludeNames,val)
    }
  }
})
