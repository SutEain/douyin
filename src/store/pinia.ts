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
    // 🎯 数字ID
    numeric_id: profile.numeric_id ?? current.numeric_id ?? null,
    // 🎯 隐私设置
    show_collect: profile.show_collect !== false,
    show_like: profile.show_like !== false,
    show_tg_username: profile.show_tg_username === true,
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
      userinfo: {
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
        is_private: false,
        numeric_id: null,
        show_collect: true,
        show_like: true,
        show_tg_username: false,
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
      message: ''
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
      // 优先从 Supabase 获取用户数据
      try {
        const { getCurrentProfile } = await import('@/api/auth')
        const profile = await getCurrentProfile()

        if (profile) {
          this.userinfo = mapProfileToUserinfo(profile, this.userinfo)
          const lang = normalizeLang(this.userinfo.lang)
          this.userinfo.lang = lang
          i18n.global.locale.value = lang
          return
        }
      } catch (error) {
        console.warn('从 Supabase 获取用户数据失败，使用 mock 数据:', error)
      }

      // 如果没有用户数据，尝试使用 Telegram 语言设置
      // @ts-ignore
      const tgLang = window.Telegram?.WebApp?.initDataUnsafe?.user?.language_code
      if (tgLang) {
        const lang = normalizeLang(tgLang)
        this.userinfo.lang = lang
        i18n.global.locale.value = lang
      } else {
        const fallback = normalizeLang()
        this.userinfo.lang = fallback
        i18n.global.locale.value = fallback
      }

      // ✅ 不再调用 mock API，等待用户登录后获取真实数据
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
