<template>
  <div class="edit">
    <BaseHeader>
      <template v-slot:center>
        <span class="f16">{{ $t('profile.editProfile') }}</span>
      </template>
    </BaseHeader>

    <!-- ✅ 双层滚动结构：防止下拉时关闭 miniApp -->
    <div class="scroll-container" @scroll="handleScroll" ref="scrollContainer">
      <div class="main" ref="mainContent">
        <!-- 🎯 隐藏的图片上传 input -->
        <input
          type="file"
          ref="fileInput"
          style="display: none"
          accept="image/*"
          @change="handleFileChange"
        />

        <div class="userinfo">
          <div class="change-avatar">
            <div class="avatar-ctn" @click="handleAvatarClick">
              <img
                class="avatar"
                :src="_checkImgUrl(store.userinfo.avatar_300x300.url_list[0])"
                alt=""
              />
              <div class="edit-mask">
                <Icon icon="ri:camera-line" />
              </div>
            </div>
            <span>{{ $t('profile.avatar') }}</span>
          </div>

          <div class="row" @click="handleCoverClick">
            <div class="left">{{ $t('profile.backgroundImage') }}</div>
            <div class="right">
              <img
                v-if="store.userinfo.cover_url?.[0]?.url_list?.[0]"
                class="cover-preview"
                :src="_checkImgUrl(store.userinfo.cover_url[0].url_list[0])"
              />
              <span v-else>{{ $t('profile.clickToSet') }}</span>
              <dy-back scale=".8" direction="right"></dy-back>
            </div>
          </div>

          <div class="row" @click="nav('/me/edit-userinfo-item', { type: 1 })">
            <div class="left">{{ $t('profile.name') }}</div>
            <div class="right">
              <span>{{ isEmpty(store.userinfo.nickname) }}</span>
              <dy-back scale=".8" direction="right"></dy-back>
            </div>
          </div>
          <div class="row" @click="nav('/me/edit-userinfo-item', { type: 3 })">
            <div class="left">{{ $t('profile.bio') }}</div>
            <div class="right">
              <span>{{ isEmpty(store.userinfo.signature) }}</span>
              <dy-back scale=".8" direction="right"></dy-back>
            </div>
          </div>
          <div class="row" @click="showSexDialog">
            <div class="left">{{ $t('profile.gender') }}</div>
            <div class="right">
              <span>{{ sex }}</span>
              <dy-back scale=".8" direction="right"></dy-back>
            </div>
          </div>
          <div class="row" @click="showBirthdayDialog">
            <div class="left">{{ $t('profile.birthday') }}</div>
            <div class="right">
              <span>{{ isEmpty(store.userinfo.user_age) }}</span>
              <div v-show="false" id="trigger1"></div>
              <dy-back scale=".8" direction="right"></dy-back>
            </div>
          </div>
          <div class="row" @click.stop="handleLocationClick">
            <div class="left" style="display: flex; align-items: center">
              <img
                src="/images/icon/ditu.png"
                alt=""
                style="width: 18px; height: 18px; margin-right: 5px"
              />
              {{ $t('profile.location') }}
            </div>
            <div class="right">
              <span>{{ isEmpty(store.userinfo.country) }}</span>
              <dy-back scale=".8" direction="right"></dy-back>
            </div>
          </div>
        </div>

        <!-- 🎯 退出登录（仅在浏览器环境显示） -->
        <div v-if="isBrowserEnv" class="logout-section">
          <div class="logout-btn" @click="handleLogout">
            <Icon icon="mdi:logout" style="font-size: 18px; margin-right: 8px" />
            <span>退出登录</span>
          </div>
        </div>
        <!-- ✅ 关闭 userinfo -->
      </div>
      <!-- ✅ 关闭 main -->
    </div>
    <!-- ✅ 关闭 scroll-container -->

    <transition name="fade">
      <div class="preview-img" v-if="data.previewImg" @click="data.previewImg = ''">
        <img class="resource" :src="data.previewImg" alt="" />
        <img
          class="download"
          src="../../../assets/img/icon/components/video/download.png"
          alt=""
          @click.stop="_no"
        />
      </div>
    </transition>
  </div>
</template>

<script setup lang="ts">
import MobileSelect from '../../../components/mobile-select/mobile-select'
import { useBaseStore } from '@/store/pinia'
import {
  _checkImgUrl,
  _hideLoading,
  _no,
  _showLoading,
  _showSelectDialog,
  _showConfirmDialog,
  _notice
} from '@/utils'
import { computed, onMounted, onUnmounted, reactive, ref } from 'vue'
import { useNav } from '@/utils/hooks/useNav'
import { useI18n } from 'vue-i18n'
import { Icon } from '@iconify/vue'
import { uploadImage } from '@/utils/upload'
import { logout } from '@/api/auth'

defineOptions({
  name: 'EditUserInfo'
})
const store = useBaseStore()
const nav = useNav()
const { t } = useI18n()
const data = reactive({
  previewImg: '',
  uploadType: '' as 'avatar' | 'cover'
})

const fileInput = ref<HTMLInputElement | null>(null)

function handleAvatarClick() {
  _showSelectDialog(
    [
      { id: 'view', name: t('profile.viewImage') },
      { id: 'upload', name: t('profile.changeAvatar') }
    ],
    (e) => {
      if (e.id === 'view') {
        data.previewImg = _checkImgUrl(store.userinfo.avatar_300x300.url_list[0])
      } else {
        data.uploadType = 'avatar'
        fileInput.value?.click()
      }
    }
  )
}

function handleCoverClick() {
  _showSelectDialog(
    [
      { id: 'view', name: t('profile.viewImage') },
      { id: 'upload', name: t('profile.changeCover') }
    ],
    (e) => {
      if (e.id === 'view') {
        const coverUrl = store.userinfo.cover_url?.[0]?.url_list?.[0]
        data.previewImg = coverUrl ? _checkImgUrl(coverUrl) : '/images/profile/default_bg.png'
      } else {
        data.uploadType = 'cover'
        fileInput.value?.click()
      }
    }
  )
}

async function handleFileChange(e: Event) {
  const file = (e.target as HTMLInputElement).files?.[0]
  if (!file) return

  try {
    _showLoading()
    const folder = data.uploadType === 'avatar' ? 'avatars' : 'covers'
    const publicUrl = await uploadImage(file, 'user-content', folder)

    if (data.uploadType === 'avatar') {
      await store.updateProfileFields({
        avatar_300x300: { url_list: [publicUrl] }
      })
      _notice('头像更新成功')
    } else {
      await store.updateProfileFields({
        cover_url: [{ url_list: [publicUrl] }]
      })
      _notice('背景更新成功')
    }
  } catch (err: any) {
    console.error('上传失败:', err)
    _notice('上传失败: ' + (err.message || '未知错误'))
  } finally {
    _hideLoading()
    // 清空 input 方便下次选择同一张图
    if (fileInput.value) fileInput.value.value = ''
  }
}

// ✅ 双层滚动结构的 refs
const scrollContainer = ref<HTMLElement | null>(null)
const mainContent = ref<HTMLElement | null>(null)

// ✅ 触摸事件状态
const touchState = reactive({
  startY: 0,
  isTop: false
})

// ✅ 触摸开始
function handleTouchStart(e: TouchEvent) {
  touchState.startY = e.touches[0].clientY
  touchState.isTop = (scrollContainer.value?.scrollTop || 0) === 0
}

// ✅ 触摸移动：在顶部下拉时阻止默认行为
function handleTouchMove(e: TouchEvent) {
  if (!touchState.isTop) return

  const currentY = e.touches[0].clientY
  const deltaY = currentY - touchState.startY

  // 如果在顶部且向下拉（deltaY > 0），阻止默认行为
  if (deltaY > 0 && scrollContainer.value?.scrollTop === 0) {
    e.preventDefault()
  }
}

// ✅ 触摸结束
function handleTouchEnd() {
  touchState.startY = 0
  touchState.isTop = false
}

// ✅ 滚动事件（预留）
function handleScroll() {
  // 可以添加滚动相关的逻辑
}

onMounted(() => {
  // ✅ 添加触摸事件监听到 scroll-container
  if (scrollContainer.value) {
    scrollContainer.value.addEventListener('touchstart', handleTouchStart, { passive: true })
    scrollContainer.value.addEventListener('touchmove', handleTouchMove, { passive: false })
    scrollContainer.value.addEventListener('touchend', handleTouchEnd, { passive: true })
  }
})

onUnmounted(() => {
  // ✅ 清理触摸事件监听
  if (scrollContainer.value) {
    scrollContainer.value.removeEventListener('touchstart', handleTouchStart)
    scrollContainer.value.removeEventListener('touchmove', handleTouchMove)
    scrollContainer.value.removeEventListener('touchend', handleTouchEnd)
  }
})

const sexList = computed(() => [
  { id: 1, name: t('profile.male') },
  { id: 2, name: t('profile.female') },
  { id: 3, name: t('profile.notShow') }
])

const sex = computed(() => {
  switch (Number(store.userinfo.gender)) {
    case 1:
      return t('profile.male')
    case 2:
      return t('profile.female')
    default:
      return ''
  }
})

function isEmpty(val) {
  if (val && val !== -1) return val
  return t('profile.clickToSet')
}

function showSexDialog() {
  _showSelectDialog(sexList.value, async (e) => {
    _showLoading()
    await store.updateProfileFields({ gender: e.id })
    _hideLoading()
  })
}

function showBirthdayDialog() {
  new MobileSelect({
    trigger: '#trigger1',
    title: t('profile.birthday'),
    connector: t('profile.birthday'),
    wheels: [
      {
        data: Array.apply(null, { length: 100 }).map((v, i) => new Date().getFullYear() - i)
      },
      {
        data: Array.apply(null, { length: 12 }).map((v, i) => 12 - i)
      },
      {
        data: Array.apply(null, { length: 31 }).map((v, i) => 31 - i)
      }
    ],
    callback: async (indexArr, pickerData) => {
      _showLoading()
      await store.updateProfileFields({
        birthday: pickerData.join('-')
      })
      _hideLoading()
    }
  }).show()
}

function handleLocationClick(e: Event) {
  // 🎯 停止事件冒泡，确保在 Windows MiniApp 中能正常工作
  e.preventDefault()
  e.stopPropagation()
  nav('/me/choose-location')
}

// 🎯 检测是否在浏览器环境（非 Telegram WebApp）
const isBrowserEnv = computed(() => {
  const host = window.location.hostname
  const isDev =
    host === 'localhost' ||
    host === '127.0.0.1' ||
    host.endsWith('.test') ||
    host.endsWith('.local')

  if (isDev) {
    return true
  }

  // 生产环境：检查是否有真实的 Telegram WebApp
  return !window.Telegram?.WebApp || !window.Telegram.WebApp.initData
})

// 🎯 退出登录
function handleLogout() {
  _showConfirmDialog(
    '确定要退出登录吗？',
    '退出后需要重新登录才能使用',
    undefined,
    async () => {
      try {
        _showLoading()
        await logout()
        // 清除 store 中的用户信息
        store.userinfo.uid = ''
        store.userinfo.nickname = ''
        store.userinfo.unique_id = ''
        // 跳转到首页（会自动显示登录页面）
        nav('/')
        _notice('已退出登录')
      } catch (error: any) {
        console.error('退出登录失败:', error)
        _notice('退出登录失败: ' + (error.message || '未知错误'))
      } finally {
        _hideLoading()
      }
    },
    undefined, // cancelCb
    '退出',
    '取消'
  )
}
</script>

<style scoped lang="less">
@import '../../../assets/less/index';

.edit {
  position: fixed;
  left: 0;
  right: 0;
  bottom: 0;
  top: 0;
  overflow: hidden; // ✅ 外层禁止滚动
  overscroll-behavior-y: contain; // ✅ 防止过度滚动传播
  font-size: 14rem;
  background-color: #000;
  height: 100vh;

  // ✅ 内层滚动容器
  .scroll-container {
    height: 100vh;
    overflow-y: auto;
    overflow-x: hidden;
    -webkit-overflow-scrolling: touch;
    overscroll-behavior: contain;
    overscroll-behavior-y: contain;
    touch-action: pan-y; // ✅ 只允许垂直滚动

    &::-webkit-scrollbar {
      display: none;
    }
  }

  .main {
    touch-action: pan-y; // ✅ 只允许垂直滚动
  }
}

.preview-img {
  z-index: 9;
  position: fixed;
  left: 0;
  right: 0;
  bottom: 0;
  top: 0;
  background: black;
  display: flex;
  align-items: center;
  justify-content: center;

  .resource {
    width: 100%;
    max-height: %;
  }

  .download {
    position: absolute;
    bottom: 20rem;
    right: 20rem;
    padding: 3rem;
    background: var(--second-btn-color-tran);
    width: 20rem;
  }
}

.userinfo {
  padding-top: 60rem;
  color: white;

  .change-avatar {
    display: flex;
    justify-content: center;
    align-items: center;
    flex-direction: column;
    margin: 30rem 0;
    @avatar-width: 80rem;

    .avatar-ctn {
      position: relative;
      display: flex;
      justify-content: center;
      align-items: center;
      margin-bottom: 10rem;
      cursor: pointer;

      width: @avatar-width;
      height: @avatar-width;

      .avatar {
        width: @avatar-width;
        height: @avatar-width;
        border-radius: 50%;
        object-fit: cover;
      }

      .edit-mask {
        position: absolute;
        bottom: 0;
        right: 0;
        width: 24rem;
        height: 24rem;
        background: #fe2c55;
        border-radius: 50%;
        display: flex;
        align-items: center;
        justify-content: center;
        color: white;
        border: 2px solid #000;
        font-size: 14rem;
      }
    }
  }

  .row {
    height: 54rem;
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0 15rem;
    border-bottom: 1px solid rgba(255, 255, 255, 0.05);

    &:active {
      background: rgba(255, 255, 255, 0.05);
    }

    .left {
      font-size: 15rem;
      color: white;
    }

    .right {
      display: flex;
      align-items: center;
      gap: 5rem;
      color: #999;
      font-size: 14rem;

      .cover-preview {
        width: 40rem;
        height: 30rem;
        object-fit: cover;
        border-radius: 4rem;
      }
    }
  }
}

.logout-section {
  margin-top: 30rem;
  padding: 0 15rem;
  padding-bottom: 30rem;

  .logout-btn {
    height: 54rem;
    display: flex;
    align-items: center;
    justify-content: center;
    background: rgba(254, 44, 85, 0.1);
    border: 1px solid rgba(254, 44, 85, 0.3);
    border-radius: 8rem;
    color: #fe2c55;
    font-size: 15rem;
    cursor: pointer;
    transition: all 0.3s;

    &:active {
      background: rgba(254, 44, 85, 0.2);
      opacity: 0.8;
    }
  }
}

.change-dialog {
  z-index: 10;
  position: absolute;
  top: 0;
  bottom: 0;
  left: 0;
  right: 0;
  background: #000000bb;
  display: flex;
  justify-content: center;
  align-items: center;

  .content {
    background: white;
    width: 80%;
    padding: 5rem 0;
    border-radius: 2px;
    box-sizing: border-box;

    .item {
      font-size: 15rem;
      padding: 15rem 20rem;
      transition: all 0.2s;

      &:active {
        background: darkgray;
      }
    }
  }
}
</style>
