import { defineStore } from 'pinia'
import { friends, panel } from '@/api/user'
import enums from '@/utils/enums'
import resource from '@/assets/data/resource'

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
        user_age: '',
        signature: '',
        unique_id: '',
        province: '',
        city: '',
        gender: '',
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
      return this.friends.all.filter((v) => v.select)
    }
  },
  actions: {
    async init() {
      // 优先从 Supabase 获取用户数据
      try {
        const { getCurrentProfile } = await import('@/api/auth')
        const profile = await getCurrentProfile()

        if (profile) {
          // 将 Supabase profile 转换为应用格式
          this.userinfo = {
            ...this.userinfo,
            nickname: profile.nickname || '抖音用户',
            unique_id: profile.username || '',
            signature: profile.bio || '',
            user_age: -1, // Supabase 中没有年龄字段
            province: '',
            city: '',
            gender: 0,
            aweme_count: profile.total_likes || 0,
            following_count: profile.following_count || 0,
            follower_count: profile.follower_count || 0,
            // 头像处理
            avatar_168x168: {
              url_list: profile.avatar_url ? [profile.avatar_url] : []
            },
            avatar_300x300: {
              url_list: profile.avatar_url ? [profile.avatar_url] : []
            },
            // 封面处理
            cover_url: profile.cover_url ? [{ url_list: [profile.cover_url] }] : [{ url_list: [] }],
            white_cover_url: [{ url_list: [] }]
          }
          console.log('✅ 从 Supabase 加载用户数据成功')
          return
        }
      } catch (error) {
        console.warn('从 Supabase 获取用户数据失败，使用 mock 数据:', error)
      }

      // 如果 Supabase 获取失败，使用原有的 mock 数据
      const r = await panel()
      if (r.success) {
        this.userinfo = Object.assign(this.userinfo, r.data)
      }
      const r2 = await friends()
      if (r2.success) {
        this.users = r2.data
      }
    },
    setUserinfo(val) {
      this.userinfo = val
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
