<template>
  <div class="Me">
    <!-- 整体可滚动区域 -->
    <div class="scroll-container">
      <!-- 用户信息区域 -->
      <div class="user-info">
        <header :style="headerBackgroundStyle" @click="handleHeaderClick">
          <!-- 顶部按钮栏 - 贴在背景图上，随页面滚动 -->
          <div class="header-actions">
            <div class="left" @click.stop="$nav('/me/edit-userinfo')">
              <Icon icon="ri:edit-fill" />
              <span>编辑资料</span>
            </div>
            <div class="right">
              <div class="item" @click.stop="_no">
                <Icon class="finger" icon="fluent-emoji-high-contrast:middle-finger" />
              </div>
              <div class="item" @click.stop="_no">
                <Icon icon="eva:people-outline" />
              </div>
              <!-- ✅ 隐藏搜索按钮
              <div class="item" @click.stop="_no">
                <Icon icon="ic:round-search" />
              </div>
              -->
              <!-- 🎯 隐藏设置按钮，设置功能移至BOT
              <div class="item" @click.stop="$nav('/me/right-menu/setting')">
                <Icon icon="ri:settings-line" />
              </div>
              -->
            </div>
          </div>
          <div class="info">
            <img
              :src="_checkImgUrl(userinfo.avatar_168x168?.url_list?.[0])"
              class="avatar"
              @click.stop="state.previewImg = _checkImgUrl(userinfo.avatar_300x300?.url_list?.[0])"
            />
            <div class="right">
              <p class="name">{{ userinfo.nickname }}</p>
              <!-- 🎯 TG用户名第1排 -->
              <div
                class="number"
                style="margin-bottom: 5px; display: flex; align-items: center; gap: 5px"
                v-if="userinfo.unique_id && userinfo.show_tg_username === true"
              >
                <span>TG用户名：@{{ userinfo.unique_id }}</span>
                <Icon
                  icon="mdi:content-copy"
                  style="font-size: 14px; cursor: pointer; opacity: 0.7"
                  @click.stop="copyTgUsername"
                />
                <span style="margin-left: 5px" v-if="userinfo.is_private">私密账号</span>
              </div>
              <!-- 🎯 数字ID第2排 -->
              <div class="number" style="display: flex; align-items: center; gap: 5px">
                <span>ID: {{ userinfo.numeric_id || '加载中...' }}</span>
                <Icon
                  v-if="userinfo.numeric_id"
                  icon="mdi:content-copy"
                  style="font-size: 14px; cursor: pointer; opacity: 0.7"
                  @click.stop="copyNumericId"
                />
              </div>
            </div>
          </div>
        </header>

        <!-- 详细信息 -->
        <div class="detail">
          <!-- ✅ 第1个：个性签名 -->
          <div class="signature">
            <template v-if="!userinfo.signature">
              <span>点击添加介绍，让大家认识你...</span>
              <img src="../../assets/img/icon/me/write-gray.png" alt="" />
            </template>
            <div v-else class="text signature-text">{{ userinfo.signature }}</div>
          </div>

          <!-- ✅ 第2个：年龄、地区等信息 -->
          <div class="more">
            <div class="age item" v-if="userinfo.user_age !== -1">
              <img v-if="userinfo.gender == 2" src="../../assets/img/icon/me/woman.png" alt="" />
              <img v-if="userinfo.gender == 1" src="../../assets/img/icon/me/man.png" alt="" />
              <span>{{ userinfo.user_age }}岁</span>
            </div>
            <div class="item" v-if="userinfo.country || userinfo.province || userinfo.city">
              <img src="../../assets/img/icon/me/ditu.png" alt="" />
              <template v-if="userinfo.country">{{ userinfo.country }}</template>
              <template v-if="userinfo.country && (userinfo.province || userinfo.city)">
                ·
              </template>
              <template v-if="userinfo.province">{{ userinfo.province }}</template>
              <template v-if="userinfo.province && userinfo.city"> - </template>
              <template v-if="userinfo.city">{{ userinfo.city }}</template>
            </div>
            <div class="item" v-if="userinfo.school?.name">
              {{ userinfo.school.name }}
            </div>
          </div>

          <!-- ✅ 第3个：获赞/关注/粉丝 -->
          <div class="head">
            <div class="heat">
              <div class="text">
                <span class="num">{{ _formatNumber(userinfo.aweme_count || 0) }}</span>
                <span>获赞</span>
              </div>
              <div class="text" @click="$nav('/people/follow-and-fans', { type: 0 })">
                <span class="num">{{ _formatNumber(userinfo.following_count || 0) }}</span>
                <span>关注</span>
              </div>
              <div class="text" @click="$nav('/people/follow-and-fans', { type: 1 })">
                <span class="num">{{ _formatNumber(userinfo.follower_count || 0) }}</span>
                <span>粉丝</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- Tab 指示器 -->
      <div class="tab-section">
        <Indicator
          name="videoList"
          tabStyleWidth="25%"
          :tabTexts="['作品', '喜欢', '收藏']"
          v-model:active-index="state.contentIndex"
        />
      </div>

      <!-- Tab 内容区域 -->
      <div class="tab-content-wrapper" :style="{ height: tabContentHeight }">
        <SlideRowList name="videoList" v-model:active-index="state.contentIndex">
          <!-- Tab 0: 作品 -->
          <SlideItem>
            <Posters v-if="state.videos.my.total !== -1" :list="state.videos.my.list" />
            <Loading v-if="state.loadings.loading0" :is-full-screen="false" />
            <no-more v-else />
          </SlideItem>

          <!-- Tab 1: 喜欢 -->
          <SlideItem>
            <div class="notice">
              <img src="../../assets/img/icon/me/lock-gray.png" alt="" />
              <span>只有你能看到自己的喜欢列表</span>
            </div>
            <Posters v-if="state.videos.like.total !== -1" :list="state.videos.like.list" />
            <Loading v-if="state.loadings.loading1" :is-full-screen="false" />
            <no-more v-else />
          </SlideItem>

          <!-- Tab 2: 收藏 -->
          <SlideItem>
            <div class="notice">
              <img src="../../assets/img/icon/me/lock-gray.png" alt="" />
              <span>只有你能看到自己的收藏列表</span>
            </div>
            <div class="collect">
              <!-- 视频收藏 -->
              <div class="video" v-if="state.videos.collect.video.total !== -1">
                <div class="top" @click="$nav('/me/collect/video-collect')">
                  <div class="left">
                    <img src="../../assets/img/icon/me/video-whitegray.png" alt="" />
                    <span>视频</span>
                  </div>
                  <div class="right">
                    <span>全部</span>
                    <Icon icon="mdi:chevron-right" />
                  </div>
                </div>
                <Posters
                  v-if="state.videos.collect.video.total !== -1"
                  :list="state.videos.collect.video.list"
                />
              </div>

              <!-- 音乐收藏 -->
              <div class="music" v-if="state.videos.collect.music.total !== -1">
                <div class="top" @click="$nav('/me/collect/music-collect')">
                  <div class="left">
                    <img src="../../assets/img/icon/me/music-whitegray.png" alt="" />
                    <span>音乐</span>
                  </div>
                  <div class="right">
                    <span>全部</span>
                    <Icon icon="mdi:chevron-right" />
                  </div>
                </div>
                <Posters
                  v-if="state.videos.collect.music.total !== -1"
                  :list="state.videos.collect.music.list"
                />
              </div>
            </div>
            <Loading v-if="state.loadings.loading2" :is-full-screen="false" />
            <no-more v-else />
          </SlideItem>
        </SlideRowList>
      </div>
    </div>

    <!-- 底部导航 -->
    <BaseFooter :init-tab="5" />

    <!-- 图片预览 -->
    <transition name="fade">
      <div v-if="state.previewImg" class="fixed-preview-image" @click="state.previewImg = ''">
        <img :src="state.previewImg" alt="" />
      </div>
    </transition>
  </div>
</template>

<script setup lang="ts">
import { reactive, computed, onMounted, watch } from 'vue'
import { Icon } from '@iconify/vue'
import Posters from '@/components/Posters.vue'
import Indicator from '@/components/slide/Indicator.vue'
import SlideRowList from '@/components/slide/SlideRowList.vue'
import SlideItem from '@/components/slide/SlideItem.vue'
import BaseFooter from '@/components/BaseFooter.vue'
import Loading from '@/components/Loading.vue'
import NoMore from '@/components/NoMore.vue'
import { _checkImgUrl, _formatNumber, _no, _copy } from '@/utils'
import { likeVideo, myVideo, collectedVideo } from '@/api/videos'
import { useBaseStore } from '@/store/pinia'
import { useNav } from '@/utils/hooks/useNav'

defineOptions({
  name: 'Me'
})

const $nav = useNav()
const baseStore = useBaseStore()

// ========== Refs ==========

// ========== State ==========
const state = reactive({
  previewImg: '',
  contentIndex: 0,

  videos: {
    my: { list: [], total: -1, pageNo: 0, pageSize: 15 },
    like: { list: [], total: -1, pageNo: 0, pageSize: 15 },
    collect: {
      video: { list: [], total: -1, pageNo: 0, pageSize: 15 },
      music: { list: [], total: -1, pageNo: 0, pageSize: 15 }
    }
  },

  loadings: {
    loading0: false,
    loading1: false,
    loading2: false
  }
})

// ========== Computed ==========
const userinfo = computed(() => baseStore.userinfo || ({} as any))

const headerBackgroundStyle = computed(() => {
  const userCoverUrl = userinfo.value.cover_url?.[0]?.url_list?.[0]
  const bgUrl = userCoverUrl ? _checkImgUrl(userCoverUrl) : '/images/profile/default_bg.png'
  return {
    backgroundImage: `url(${bgUrl})`
  }
})

const tabContentHeight = computed(() => {
  // 计算 Tab 内容区域的高度，给足够的空间
  return 'auto'
})

// ========== Methods ==========

// 点击背景图预览
function handleHeaderClick() {
  const userCoverUrl = userinfo.value.cover_url?.[0]?.url_list?.[0]
  if (userCoverUrl) {
    state.previewImg = _checkImgUrl(userCoverUrl)
  } else {
    state.previewImg = '/images/profile/default_bg.png'
  }
}

// 🎯 复制数字ID
function copyNumericId() {
  if (userinfo.value.numeric_id) {
    _copy(String(userinfo.value.numeric_id))
  }
}

// 🎯 复制TG用户名
function copyTgUsername() {
  if (userinfo.value.unique_id) {
    _copy('@' + userinfo.value.unique_id)
  }
}

// 加载我的作品
async function loadMyVideos() {
  if (state.loadings.loading0) return
  if (state.videos.my.total !== -1 && state.videos.my.list.length >= state.videos.my.total) {
    return
  }

  state.loadings.loading0 = true
  const res = await myVideo({
    pageNo: state.videos.my.pageNo,
    pageSize: state.videos.my.pageSize
  })
  state.loadings.loading0 = false

  if (res.success) {
    state.videos.my.total = res.data.total
    state.videos.my.list.push(...res.data.list)
    state.videos.my.pageNo++
  }
}

// 加载喜欢的视频
async function loadLikedVideos() {
  console.log('[Me] 🔍 loadLikedVideos 被调用')
  console.log('[Me] 当前状态:', {
    loading: state.loadings.loading1,
    total: state.videos.like.total,
    listLength: state.videos.like.list.length,
    pageNo: state.videos.like.pageNo
  })

  if (state.loadings.loading1) {
    console.log('[Me] ⏸️ 正在加载中，跳过')
    return
  }
  if (state.videos.like.total !== -1 && state.videos.like.list.length >= state.videos.like.total) {
    console.log('[Me] ⏸️ 已加载全部数据，跳过')
    return
  }

  console.log('[Me] 🚀 开始请求喜欢的视频数据...')
  state.loadings.loading1 = true
  const res = await likeVideo({
    pageNo: state.videos.like.pageNo,
    pageSize: state.videos.like.pageSize
  })
  state.loadings.loading1 = false

  console.log('[Me] 📦 API 响应:', res)

  if (res.success) {
    state.videos.like.total = res.data.total
    state.videos.like.list.push(...res.data.list)
    state.videos.like.pageNo++
    console.log('[Me] ✅ 喜欢的视频加载成功:', {
      total: res.data.total,
      newCount: res.data.list.length,
      currentTotal: state.videos.like.list.length
    })
  } else {
    console.error('[Me] ❌ 喜欢的视频加载失败:', res)
  }
}

// 加载收藏的视频
async function loadCollectedVideos() {
  console.log('[Me] 🔍 loadCollectedVideos 被调用')
  console.log('[Me] 当前状态:', {
    loading: state.loadings.loading2,
    total: state.videos.collect.video.total,
    listLength: state.videos.collect.video.list.length,
    pageNo: state.videos.collect.video.pageNo
  })

  if (state.loadings.loading2) {
    console.log('[Me] ⏸️ 正在加载中，跳过')
    return
  }

  console.log('[Me] 🚀 开始请求收藏的视频数据...')
  state.loadings.loading2 = true
  const res = await collectedVideo({
    pageNo: state.videos.collect.video.pageNo,
    pageSize: state.videos.collect.video.pageSize
  })
  state.loadings.loading2 = false

  console.log('[Me] 📦 API 响应:', res)

  if (res.success) {
    state.videos.collect.video.total = res.data.total
    state.videos.collect.video.list.push(...res.data.list)
    state.videos.collect.video.pageNo++
    console.log('[Me] ✅ 收藏的视频加载成功:', {
      total: res.data.total,
      newCount: res.data.list.length,
      currentTotal: state.videos.collect.video.list.length
    })
  } else {
    console.error('[Me] ❌ 收藏的视频加载失败:', res)
  }
}

// ========== Watch ==========
// 监听 tab 切换，加载对应数据
watch(
  () => state.contentIndex,
  (newIndex) => {
    console.log('[Me] 📌 Tab 切换到:', newIndex, ['作品', '喜欢', '收藏'][newIndex])

    if (newIndex === 0 && state.videos.my.list.length === 0) {
      console.log('[Me] 加载作品数据')
      loadMyVideos()
    } else if (newIndex === 1 && state.videos.like.list.length === 0) {
      console.log('[Me] 加载喜欢数据')
      loadLikedVideos()
    } else if (newIndex === 2 && state.videos.collect.video.list.length === 0) {
      console.log('[Me] 加载收藏数据')
      loadCollectedVideos()
    }
  }
)

// ========== 生命周期 ==========
onMounted(() => {
  console.log('[Me] mounted')
  loadMyVideos()
})
</script>

<style scoped lang="less">
.Me {
  height: 100vh;
  width: 100%;
  background: #000; // ✅ 改为纯黑
  position: relative;
  overflow: hidden;

  .scroll-container {
    height: 100vh;
    overflow-y: auto;
    overflow-x: hidden;
    -webkit-overflow-scrolling: touch;
    padding-bottom: var(--footer-height);

    &::-webkit-scrollbar {
      display: none;
    }

    .user-info {
      header {
        position: relative;
        height: 200px;
        background-size: cover;
        background-position: center;
        background-repeat: no-repeat;
        background-color: #000; // ✅ 改为纯黑

        // 顶部按钮栏 - 贴在背景图顶部
        .header-actions {
          position: absolute;
          top: 0;
          left: 0;
          right: 0;
          height: 44px;
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 0 15px;
          background: transparent;
          z-index: 10;

          .left {
            display: flex;
            align-items: center;
            gap: 5px;
            font-size: 14px;
            color: white;
            cursor: pointer;
          }

          .right {
            display: flex;
            gap: 15px;

            .item {
              font-size: 20px;
              color: white;
              cursor: pointer;
            }
          }
        }

        .info {
          position: absolute;
          bottom: 20px;
          left: 30px; // ✅ 调整左边距，让头像中心和获赞中心对齐
          display: flex;
          align-items: flex-end;
          gap: 15px;

          .avatar {
            width: 80px;
            height: 80px;
            border-radius: 50%;
            border: 3px solid white;
          }

          .right {
            color: white;

            .name {
              font-size: 18px;
              font-weight: bold;
              margin-bottom: 5px;
            }

            .number {
              font-size: 13px;
              display: flex;
              align-items: center;
              gap: 5px;
              color: rgba(255, 255, 255, 0.6); // ✅ TG用户名颜色调灰

              img {
                width: 16px;
                height: 16px;
                cursor: pointer;
              }
            }
          }
        }
      }

      .detail {
        padding: 15px;

        .head {
          .heat {
            display: flex;
            justify-content: space-around;
            padding: 10px 0;

            .text {
              text-align: center;
              cursor: pointer;

              .num {
                display: block;
                font-size: 18px;
                font-weight: bold;
                margin-bottom: 5px;
                color: #fff;
              }

              span:last-child {
                font-size: 14px;
                color: rgba(255, 255, 255, 0.6);
              }
            }
          }
        }

        .signature {
          padding: 0 0 15px 15px; // ✅ 上 右 下 左
          font-size: 14px;
          font-family: 'Microsoft YaHei', '微软雅黑', sans-serif; // ✅ 雅黑字体
          color: rgba(255, 255, 255, 0.8);
          cursor: pointer;
          display: flex;
          align-items: center;
          gap: 5px;

          img {
            width: 16px;
            height: 16px;
          }

          .text {
            flex: 1;
          }

          // 🎯 保留换行格式
          .signature-text {
            white-space: pre-wrap; // 保留换行和空格
            word-wrap: break-word; // 长单词换行
          }
        }

        .more {
          display: flex;
          flex-wrap: wrap;
          gap: 10px;
          padding: 0 0 10px 10px; // ✅ 上 右 下 左
          font-size: 13px;
          color: rgba(255, 255, 255, 0.8);
          cursor: pointer;

          .item {
            display: flex;
            align-items: center;
            gap: 5px;
            padding: 5px 10px;
            background: rgba(255, 255, 255, 0.1);
            border-radius: 4px;

            img {
              width: 16px;
              height: 16px;
            }
          }
        }
      }
    }

    // Tab 区域
    .tab-section {
      position: sticky;
      top: 0;
      z-index: 50;
      background: #000; // ✅ 改为纯黑
    }

    .tab-content-wrapper {
      // 让内容自然显示
      position: relative;
      min-height: 60vh;
      padding-bottom: 80px;

      // SlideRowList 内容
      :deep(.slide-row-list) {
        width: 100%;
        height: auto;
        min-height: 60vh;
      }

      :deep(#base-slide-wrapper) {
        height: auto;
        min-height: 60vh;
        overflow: hidden; // ✅ 恢复 hidden，防止内容溢出
      }

      :deep(#base-slide-list) {
        height: auto;
        min-height: 60vh;
      }

      // SlideItem 内容样式
      :deep(.slide-item) {
        padding: 0; // ✅ 去掉左右padding
        min-height: 110vh;
        background-color: #000; // ✅ 三个 tab 的背景色
        width: 100%;
        box-sizing: border-box;
      }
    }

    .notice {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
      padding: 15px 0;
      font-size: 13px;
      color: rgba(255, 255, 255, 0.5);

      img {
        width: 14px;
        height: 14px;
      }
    }

    .collect {
      .video,
      .music {
        margin-bottom: 20px;

        .top {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 15px 0;
          cursor: pointer;

          .left {
            display: flex;
            align-items: center;
            gap: 8px;
            font-size: 15px;
            font-weight: bold;
            color: #fff;

            img {
              width: 20px;
              height: 20px;
            }
          }

          .right {
            display: flex;
            align-items: center;
            gap: 5px;
            font-size: 13px;
            color: rgba(255, 255, 255, 0.5);
          }
        }
      }
    }
  }

  .fixed-preview-image {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background: rgba(0, 0, 0, 0.9);
    z-index: 9999;
    display: flex;
    align-items: center;
    justify-content: center;

    img {
      max-width: 90%;
      max-height: 90%;
      object-fit: contain;
    }
  }

  .star-count-content {
    display: flex;
    flex-direction: column;
    align-items: center;
    padding: 30px 20px;
    background: #000; // ✅ 改为纯黑

    img {
      width: 60px;
      height: 60px;
      margin-bottom: 20px;
    }

    .desc {
      text-align: center;

      p {
        margin-bottom: 10px;
        font-size: 14px;
        color: rgba(255, 255, 255, 0.8);

        span {
          color: #ff2d55;
          font-weight: bold;
        }
      }
    }
  }
}

// Transition 动画
.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.3s;
}

.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}
</style>
