<template>
  <div class="Me">
    <!-- 顶部浮动栏 -->
    <div ref="floatRef" class="float" :class="state.floatFixed ? 'fixed' : ''">
      <div
        :style="state.floatFixed ? 'opacity: 0;' : ''"
        class="left"
        @click="$nav('/me/edit-userinfo')"
      >
        <Icon icon="ri:edit-fill" />
        <span>编辑资料</span>
      </div>
      <transition name="fade">
        <div class="center" v-if="state.floatShowName">
          <p class="name f14 mt1r mb1r">{{ userinfo.nickname }}</p>
        </div>
      </transition>
      <div class="right">
        <div
          class="item"
          :style="state.floatFixed ? 'opacity: 0;' : ''"
          @click="$nav('/me/request-update')"
        >
          <Icon class="finger" icon="fluent-emoji-high-contrast:middle-finger" />
        </div>
        <div
          class="item"
          :style="state.floatFixed ? 'opacity: 0;' : ''"
          @click="$nav('/message/visitors')"
        >
          <Icon icon="eva:people-outline" />
        </div>
        <div class="item" @click="_no">
          <Icon icon="ic:round-search" />
        </div>
        <div class="item" @click.stop="$nav('/me/right-menu/setting')">
          <Icon icon="ri:settings-line" />
        </div>
      </div>
    </div>

    <!-- 主要内容区域 -->
    <div
      class="scroll"
      ref="scrollRef"
      @touchstart="handleTouchStart"
      @touchmove="handleTouchMove"
      @touchend="handleTouchEnd"
    >
      <!-- 用户信息区域 -->
      <div ref="descRef" class="desc">
        <header
          ref="headerRef"
          :style="{
            backgroundImage: `url(${_checkImgUrl(userinfo.cover_url?.[0]?.url_list?.[0])})`
          }"
          @click="state.previewImg = _checkImgUrl(userinfo.cover_url?.[0]?.url_list?.[0])"
        >
          <div class="info">
            <img
              :src="_checkImgUrl(userinfo.avatar_168x168?.url_list?.[0])"
              class="avatar"
              @click.stop="state.previewImg = _checkImgUrl(userinfo.avatar_300x300?.url_list?.[0])"
            />
            <div class="right">
              <p class="name">{{ userinfo.nickname }}</p>
              <div class="number mb1r">
                <span class="mr1r" v-if="userinfo.is_private">私密账号</span>
                <span>抖音号：{{ _getUserDouyinId({ author: userinfo }) }}</span>
                <img
                  src="../../assets/img/icon/me/qrcode-gray.png"
                  alt=""
                  @click.stop="$nav('/me/my-card')"
                />
              </div>
            </div>
          </div>
        </header>

        <!-- 详细信息 -->
        <div class="detail">
          <div class="head">
            <div class="heat">
              <div class="text" @click="state.isShowStarCount = true">
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

          <!-- 个性签名 -->
          <div class="signature" @click="$nav('/me/edit-userinfo-item', { type: 3 })">
            <template v-if="!userinfo.signature">
              <span>点击添加介绍，让大家认识你...</span>
              <img src="../../assets/img/icon/me/write-gray.png" alt="" />
            </template>
            <div v-else class="text" v-html="userinfo.signature"></div>
          </div>

          <!-- 年龄、地区等信息 -->
          <div class="more" @click="$nav('/me/edit-userinfo')">
            <div class="age item" v-if="userinfo.user_age !== -1">
              <img
                v-if="userinfo.gender == 2"
                src="../../assets/img/icon/me/woman.png"
                alt=""
              />
              <img v-if="userinfo.gender == 1" src="../../assets/img/icon/me/man.png" alt="" />
              <span>{{ userinfo.user_age }}岁</span>
            </div>
            <div class="item" v-if="userinfo.province || userinfo.city">
              {{ userinfo.province }}
              <template v-if="userinfo.province && userinfo.city"> -</template>
              {{ userinfo.city }}
            </div>
            <div class="item" v-if="userinfo.school?.name">
              {{ userinfo.school.name }}
            </div>
          </div>
        </div>
      </div>

      <!-- Tab 指示器 -->
      <Indicator
        name="videoList"
        tabStyleWidth="25%"
        :tabTexts="['作品', '喜欢', '收藏']"
        v-model:active-index="state.contentIndex"
      />

      <!-- Tab 内容 -->
      <SlideRowList
        ref="videoSlideRowListRef"
        name="videoList"
        :style="videoSlideRowListStyle"
        v-model:active-index="state.contentIndex"
      >
        <!-- Tab 0: 作品 -->
        <SlideItem class="SlideItem" @scroll="handleSlideScroll" :style="slideItemStyle">
          <Posters v-if="state.videos.my.total !== -1" :list="state.videos.my.list" />
          <Loading v-if="state.loadings.loading0" :is-full-screen="false" />
          <no-more v-else />
        </SlideItem>

        <!-- Tab 1: 喜欢 -->
        <SlideItem class="SlideItem" @scroll="handleSlideScroll" :style="slideItemStyle">
          <div class="notice">
            <img src="../../assets/img/icon/me/lock-gray.png" alt="" />
            <span>只有你能看到自己的喜欢列表</span>
          </div>
          <Posters v-if="state.videos.like.total !== -1" :list="state.videos.like.list" />
          <Loading v-if="state.loadings.loading1" :is-full-screen="false" />
          <no-more v-else />
        </SlideItem>

        <!-- Tab 2: 收藏 -->
        <SlideItem class="SlideItem" @scroll="handleSlideScroll" :style="slideItemStyle">
          <div class="notice">
            <img src="../../assets/img/icon/me/lock-gray.png" alt="" />
            <span>只有你能看到自己的收藏列表</span>
          </div>
          <div class="collect" ref="collectRef">
            <!-- 视频收藏 -->
            <div class="video" v-if="state.videos.collect.video.total !== -1">
              <div class="top" @click="$nav('/me/collect/video-collect')">
                <div class="left">
                  <img src="../../assets/img/icon/me/video-whitegray.png" alt="" />
                  <span>视频</span>
                </div>
                <div class="right">
                  <span>全部</span>
                  <dy-back direction="right" />
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
                  <dy-back direction="right" />
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

    <!-- 底部导航 -->
    <BaseFooter :init-tab="5" />

    <!-- 图片预览 -->
    <transition name="fade">
      <div
        v-if="state.previewImg"
        class="fixed-preview-image"
        @click="state.previewImg = ''"
      >
        <img :src="state.previewImg" alt="" />
      </div>
    </transition>

    <!-- 获赞数弹窗 -->
    <ConfirmDialog
      :title="`${_formatNumber(userinfo.total_favorited)}次获赞`"
      v-model:visible="state.isShowStarCount"
      ok-text="我知道了"
    >
      <div class="star-count-content">
        <img src="../../assets/img/icon/me/love-red.png" alt="" />
        <div class="desc">
          <p>你的视频一共获得<span> {{ _formatNumber(userinfo.total_favorited) }} </span>次赞</p>
          <p>与你的粉丝互动，获得更多赞吧～</p>
        </div>
      </div>
    </ConfirmDialog>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, computed, onMounted, nextTick } from 'vue'
import { Icon } from '@iconify/vue'
import Posters from '@/components/Posters.vue'
import Indicator from '@/components/slide/Indicator.vue'
import SlideRowList from '@/components/slide/SlideRowList.vue'
import SlideItem from '@/components/slide/SlideItem.vue'
import BaseFooter from '@/components/BaseFooter.vue'
import ConfirmDialog from '@/components/dialog/ConfirmDialog.vue'
import Loading from '@/components/Loading.vue'
import NoMore from '@/components/NoMore.vue'
import DyBack from '@/components/DyBack.vue'
import { _checkImgUrl, _formatNumber, _getUserDouyinId, _no } from '@/utils'
import { likeVideo, myVideo } from '@/api/videos'
import { userCollect } from '@/api/user'
import { useBaseStore } from '@/store/pinia'
import { useNav } from '@/utils/hooks/useNav'

defineOptions({
  name: 'Me'
})

const $nav = useNav()
const baseStore = useBaseStore()

// ========== Refs ==========
const floatRef = ref<HTMLDivElement>()
const scrollRef = ref<HTMLDivElement>()
const descRef = ref<HTMLDivElement>()
const headerRef = ref<HTMLElement>()
const videoSlideRowListRef = ref()
const collectRef = ref<HTMLDivElement>()

// ========== State ==========
const state = reactive({
  previewImg: '',
  contentIndex: 0,
  isShowStarCount: false,
  floatFixed: false,
  floatShowName: false,
  isScroll: false,
  
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
  },
  
  // 触摸相关
  touchStartY: 0,
  touchStartTime: 0,
  lastScrollTop: 0
})

// ========== Computed ==========
const userinfo = computed(() => baseStore.userinfo || {})

const videoSlideRowListStyle = computed(() => {
  // 动态计算高度
  return {
    height: 'auto',
    minHeight: '400px'
  }
})

const slideItemStyle = computed(() => {
  return {
    height: 'auto',
    minHeight: '400px'
  }
})

// ========== Methods ==========

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
  if (state.loadings.loading1) return
  if (state.videos.like.total !== -1 && state.videos.like.list.length >= state.videos.like.total) {
    return
  }
  
  state.loadings.loading1 = true
  const res = await likeVideo({
    pageNo: state.videos.like.pageNo,
    pageSize: state.videos.like.pageSize
  })
  state.loadings.loading1 = false
  
  if (res.success) {
    state.videos.like.total = res.data.total
    state.videos.like.list.push(...res.data.list)
    state.videos.like.pageNo++
  }
}

// 加载收藏的视频
async function loadCollectedVideos() {
  if (state.loadings.loading2) return
  
  state.loadings.loading2 = true
  const res = await userCollect({
    pageNo: state.videos.collect.video.pageNo,
    pageSize: state.videos.collect.video.pageSize
  })
  state.loadings.loading2 = false
  
  if (res.success) {
    state.videos.collect.video.total = res.data.total
    state.videos.collect.video.list.push(...res.data.list)
    state.videos.collect.video.pageNo++
  }
}

// 滚动处理
function handleScroll(e: Event) {
  const target = e.target as HTMLElement
  const scrollTop = target.scrollTop
  
  // 处理顶部浮动栏显示/隐藏
  if (descRef.value && headerRef.value) {
    const descBottom = descRef.value.offsetHeight
    const headerHeight = headerRef.value.offsetHeight
    
    if (scrollTop > descBottom - headerHeight) {
      state.floatFixed = true
      state.floatShowName = true
    } else {
      state.floatFixed = false
      state.floatShowName = false
    }
  }
  
  state.lastScrollTop = scrollTop
}

// 触摸事件处理（简化版）
function handleTouchStart(e: TouchEvent) {
  state.touchStartY = e.touches[0].clientY
  state.touchStartTime = Date.now()
}

function handleTouchMove(e: TouchEvent) {
  // 处理触摸移动
}

function handleTouchEnd(e: TouchEvent) {
  // 处理触摸结束
}

// Slide 内容滚动处理
function handleSlideScroll(e: Event) {
  const target = e.target as HTMLElement
  const scrollTop = target.scrollTop
  const scrollHeight = target.scrollHeight
  const clientHeight = target.clientHeight
  
  // 接近底部时加载更多
  if (scrollHeight - scrollTop - clientHeight < 100) {
    if (state.contentIndex === 0) {
      loadMyVideos()
    } else if (state.contentIndex === 1) {
      loadLikedVideos()
    } else if (state.contentIndex === 2) {
      loadCollectedVideos()
    }
  }
}

// ========== 生命周期 ==========
onMounted(() => {
  console.log('[Me] mounted')
  
  // 添加主滚动区域的滚动监听
  if (scrollRef.value) {
    scrollRef.value.addEventListener('scroll', handleScroll)
  }
  
  // 初始加载我的作品
  nextTick(() => {
    loadMyVideos()
  })
})
</script>

<style scoped lang="less">
.Me {
  position: relative;
  height: 100%;
  width: 100%;
  background: white;

  .float {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    height: 44px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0 15px;
    background: transparent;
    z-index: 100;
    transition: background 0.3s;

    &.fixed {
      background: white;
      border-bottom: 1px solid #f0f0f0;
    }

    .left {
      display: flex;
      align-items: center;
      gap: 5px;
      font-size: 14px;
      color: white;
      transition: opacity 0.3s;
    }

    .center {
      flex: 1;
      text-align: center;
      color: #333;
    }

    .right {
      display: flex;
      gap: 15px;

      .item {
        font-size: 20px;
        color: white;
        cursor: pointer;
        transition: opacity 0.3s;
      }
    }
  }

  .scroll {
    height: 100%;
    overflow-y: auto;
    -webkit-overflow-scrolling: touch;

    .desc {
      header {
        position: relative;
        height: 200px;
        background-size: cover;
        background-position: center;
        background-repeat: no-repeat;
        background-color: #4a90e2;

        .info {
          position: absolute;
          bottom: 20px;
          left: 15px;
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
              }

              span:last-child {
                font-size: 14px;
                color: #666;
              }
            }
          }
        }

        .signature {
          padding: 15px 0;
          font-size: 14px;
          color: #333;
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
        }

        .more {
          display: flex;
          flex-wrap: wrap;
          gap: 10px;
          padding: 10px 0;
          font-size: 13px;
          color: #666;
          cursor: pointer;

          .item {
            display: flex;
            align-items: center;
            gap: 5px;
            padding: 5px 10px;
            background: #f5f5f5;
            border-radius: 4px;

            img {
              width: 16px;
              height: 16px;
            }
          }
        }
      }
    }

    .SlideItem {
      padding: 15px;
      background: white;

      .notice {
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 8px;
        padding: 15px;
        font-size: 13px;
        color: #999;

        img {
          width: 14px;
          height: 14px;
        }
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
            color: #999;
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
        color: #666;

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

