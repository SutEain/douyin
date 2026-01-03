<template>
  <div class="SearchResult" ref="scrollContainer">
    <!-- 顶部搜索栏 -->
    <div class="header">
      <dy-back mode="light" @click="router.back" class="mr1r"></dy-back>
      <div class="search-bar-readonly" @click="handleSearchBarClick">
        <img src="../../assets/img/icon/search-light.png" class="search-icon" />
        <div class="content">
          <span class="keyword">{{ keyword }}</span>
        </div>
      </div>
    </div>

    <!-- 综合搜索结果 -->
    <div class="search-results">
      <!-- 1. 用户部分 -->
      <div v-if="userList.length > 0" class="user-results-section">
        <div class="section-title">相关用户</div>
        <div class="user-list">
          <div
            class="user-item"
            v-for="user in userList"
            :key="user.id"
            @click="goUserPanel(user.id)"
          >
            <img
              :src="_checkImgUrl(user.avatar_url)"
              alt=""
              class="avatar"
              @error="handleAvatarError"
            />
            <div class="info">
              <div class="nickname">{{ user.nickname || user.username }}</div>
              <div class="username" v-if="user.numeric_id">ID: {{ user.numeric_id }}</div>
              <div class="stats">
                <span>{{ _formatNumber(user.follower_count) }} 粉丝</span>
                <span class="divider">·</span>
                <span>{{ _formatNumber(user.video_count) }} 作品</span>
              </div>
            </div>
            <button
              class="follow-btn"
              :class="{ followed: user.is_following }"
              @click.stop="handleFollowUser(user)"
            >
              {{ user.is_following ? '已关注' : '关注' }}
            </button>
          </div>
        </div>
        <div v-if="userHasMore && !userLoading" class="view-more-users" @click="loadMoreUsers">
          查看更多用户 >
        </div>
      </div>

      <!-- 2. 视频部分 -->
      <div class="video-results-section">
        <div class="section-title" v-if="videoList.length > 0">相关视频</div>
        <div v-if="videoLoading && videoList.length === 0" class="loading-container">
          <Loading :is-full-screen="false" />
        </div>
        <div v-else-if="videoList.length === 0 && userList.length === 0" class="empty">
          <img src="../../assets/img/icon/no-result.png" alt="" class="empty-icon" />
          <div class="empty-text">暂无相关结果</div>
        </div>
        <div v-else class="video-list">
          <VideoListItem
            v-for="video in videoList"
            :key="video.aweme_id"
            :video="video"
            @click="handleVideoClick"
            @follow="handleFollow"
            @goUserPanel="goUserPanel"
          />
        </div>
        <div
          v-if="videoHasMore && !videoLoading && videoList.length > 0"
          class="load-more"
          @click="loadMoreVideos"
        >
          加载更多视频
        </div>
        <div v-if="videoLoading && videoList.length > 0" class="loading-more">加载中...</div>
        <div v-if="!videoHasMore && videoList.length > 0" class="no-more">没有更多了</div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import Search from '../../components/Search.vue'
import VideoListItem from '../../components/VideoListItem.vue'
import Loading from '../../components/Loading.vue'
import { ref, onMounted, onActivated, onDeactivated, watch, nextTick } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { searchCombined, searchUsers } from '@/api/search'
import { toggleFollowUser } from '@/api/videos'
import { _checkImgUrl, _formatNumber, _no } from '@/utils'
import { useBaseStore } from '@/store/pinia'

defineOptions({
  name: 'SearchResult'
})

const router = useRouter()
const route = useRoute()
const baseStore = useBaseStore()

// 滚动容器引用
const scrollContainer = ref<HTMLElement | null>(null)
// 保存滚动位置
const savedScrollTop = ref(0)

// 搜索关键词
const keyword = ref('')

// 记录上次搜索的参数
const lastSearchParams = ref<{
  keyword: string
}>({
  keyword: ''
})

// 标记是否是首次挂载
const isMounted = ref(false)

// 视频数据
const videoList = ref<any[]>([])
const videoTotal = ref(0)
const videoPage = ref(0)
const videoPageSize = ref(20)
const videoLoading = ref(false)
const videoHasMore = ref(true)

// 用户数据
const userList = ref<any[]>([])
const userTotal = ref(0)
const userLoading = ref(false)
const userHasMore = ref(false)

// 检查是否需要重新搜索
function shouldReload() {
  const newKeyword = (route.query.keyword as string) || ''
  return newKeyword !== lastSearchParams.value.keyword
}

// 初始化搜索
function initSearch() {
  const newKeyword = (route.query.keyword as string) || ''
  keyword.value = newKeyword

  if (keyword.value) {
    // 更新上次搜索参数
    lastSearchParams.value = {
      keyword: keyword.value
    }

    // 加载综合搜索结果
    loadCombinedResults()
  }
}

// 加载综合搜索结果
async function loadCombinedResults() {
  if (videoLoading.value || !videoHasMore.value) return

  try {
    videoLoading.value = true
    const result = await searchCombined(keyword.value, videoPage.value, videoPageSize.value)

    if (videoPage.value === 0) {
      userList.value = result.users || []
      userTotal.value = result.userTotal || 0
      userHasMore.value = userTotal.value > userList.value.length
    }

    if (result.videos) {
      videoList.value.push(...result.videos)
      videoTotal.value = result.videoTotal
      videoHasMore.value = result.hasMoreVideos
      videoPage.value++
    }
  } catch (error) {
    console.error('[SearchResult] 综合搜索失败:', error)
  } finally {
    videoLoading.value = false
  }
}

onMounted(() => {
  initSearch()
  isMounted.value = true
})

// ✅ 离开时保存滚动位置
onDeactivated(() => {
  if (scrollContainer.value && scrollContainer.value.scrollTop > 0) {
    savedScrollTop.value = scrollContainer.value.scrollTop
  }
})

// ✅ keep-alive 激活时
onActivated(() => {
  if (!isMounted.value) return

  if (shouldReload()) {
    videoList.value = []
    videoPage.value = 0
    videoTotal.value = 0
    videoHasMore.value = true

    userList.value = []
    userTotal.value = 0
    userHasMore.value = false

    savedScrollTop.value = 0
    initSearch()
  } else {
    keyword.value = lastSearchParams.value.keyword
    nextTick(() => {
      if (scrollContainer.value) {
        scrollContainer.value.scrollTop = savedScrollTop.value
      }
    })
  }
})

// 监听路由参数变化
watch(
  () => route.query.keyword,
  (newKeyword) => {
    if (newKeyword && newKeyword !== keyword.value) {
      keyword.value = newKeyword as string
      lastSearchParams.value = { keyword: keyword.value }
      resetAndSearch()
    }
  }
)

// 重新搜索
function resetAndSearch() {
  videoList.value = []
  videoPage.value = 0
  videoTotal.value = 0
  videoHasMore.value = true

  userList.value = []
  userTotal.value = 0
  userHasMore.value = false

  loadCombinedResults()
}

// 加载更多视频
function loadMoreVideos() {
  loadCombinedResults()
}

// 加载更多用户
async function loadMoreUsers() {
  if (userLoading.value) return
  try {
    userLoading.value = true
    const result = await searchUsers(keyword.value, 1, 20)
    if (result.list) {
      userList.value.push(...result.list)
      userHasMore.value = userList.value.length < result.total
    }
  } catch (error) {
    console.error('[SearchResult] 加载更多用户失败:', error)
  } finally {
    userLoading.value = false
  }
}

// 跳转到用户主页
function goUserPanel(userId: string) {
  router.push(`/user/${userId}`)
}

// 处理视频点击
function handleVideoClick(video: any) {
  if (scrollContainer.value) {
    savedScrollTop.value = scrollContainer.value.scrollTop
  }
  const clickedIndex = videoList.value.findIndex((v) => v.aweme_id === video.aweme_id)
  baseStore.routeData = {
    items: videoList.value,
    index: clickedIndex >= 0 ? clickedIndex : 0
  }
  router.push({ name: 'video-detail' })
}

// 返回搜索页
function handleSearchBarClick() {
  router.back()
}

// 处理视频列表关注
async function handleFollow(userId: string) {
  const targetVideo = videoList.value.find((v) => (v.author?.user_id || v.author?.uid) === userId)
  if (!targetVideo) return

  const newStatus = !targetVideo.is_following
  videoList.value.forEach((v) => {
    if ((v.author?.user_id || v.author?.uid) === userId) {
      v.is_following = newStatus
    }
  })

  try {
    await toggleFollowUser(userId, newStatus)
  } catch (error) {
    videoList.value.forEach((v) => {
      if ((v.author?.user_id || v.author?.uid) === userId) {
        v.is_following = !newStatus
      }
    })
  }
}

// 处理用户列表关注
async function handleFollowUser(user: any) {
  const originalStatus = user.is_following
  user.is_following = !originalStatus
  try {
    await toggleFollowUser(user.id, user.is_following)
  } catch (error) {
    user.is_following = originalStatus
  }
}

function handleAvatarError(e: Event) {
  const target = e.target as HTMLImageElement
  target.src = new URL('../../assets/img/icon/avatar/1.png', import.meta.url).href
}
</script>

<style scoped lang="less">
@import '../../assets/less/index';

.SearchResult {
  position: fixed;
  left: 0;
  right: 0;
  bottom: 0;
  top: 0;
  overflow: auto;
  background: var(--main-bg);
  color: white;

  .header {
    z-index: 4;
    background: var(--main-bg);
    height: 60rem;
    height: calc(60rem + constant(safe-area-inset-top));
    height: calc(60rem + env(safe-area-inset-top));
    padding: 0 var(--page-padding);
    padding-top: constant(safe-area-inset-top);
    padding-top: env(safe-area-inset-top);

    font-size: 14rem;
    display: flex;
    justify-content: space-between;
    align-items: center;
    border-bottom: 1px solid var(--line-color);
    position: fixed;
    width: 100%;
    box-sizing: border-box;
    top: 0;

    .search-bar-readonly {
      flex: 1;
      height: 36rem;
      background: rgba(255, 255, 255, 0.1);
      border-radius: 4rem;
      display: flex;
      align-items: center;
      padding: 0 10rem;
      margin-left: 10rem;
      cursor: text;

      .search-icon {
        width: 14rem;
        height: 14rem;
        opacity: 0.5;
        margin-right: 8rem;
      }

      .content {
        flex: 1;
        display: flex;
        align-items: center;
        overflow: hidden;

        .keyword {
          color: white;
          font-size: 14rem;
          margin-right: 8rem;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
      }
    }
  }

  .search-results {
    padding-top: 60rem;
    padding-top: calc(60rem + constant(safe-area-inset-top));
    padding-top: calc(60rem + env(safe-area-inset-top));
    min-height: 100vh;
  }

  .section-title {
    padding: 15rem var(--page-padding);
    font-size: 15rem;
    font-weight: bold;
    color: white;
    background: rgba(255, 255, 255, 0.05);
    border-bottom: 1px solid rgba(255, 255, 255, 0.05);
  }

  .view-more-users {
    text-align: center;
    padding: 12rem;
    color: var(--second-text-color);
    font-size: 13rem;
    background: rgba(255, 255, 255, 0.02);
    cursor: pointer;

    &:active {
      background: rgba(255, 255, 255, 0.05);
    }
  }

  .loading-container {
    display: flex;
    justify-content: center;
    align-items: center;
    padding: 50rem 0;
  }

  .video-list {
    background: var(--main-bg);
  }

  .empty {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: 100rem 0;
    color: var(--second-text-color);

    .empty-icon {
      width: 100rem;
      height: 100rem;
      opacity: 0.5;
      margin-bottom: 20rem;
    }

    .empty-text {
      font-size: 14rem;
    }
  }

  .user-list {
    padding: var(--page-padding);

    .user-item {
      display: flex;
      align-items: center;
      padding: 15rem 0;
      border-bottom: 1px solid rgba(255, 255, 255, 0.1);

      &:active {
        opacity: 0.7;
      }

      .avatar {
        width: 50rem;
        height: 50rem;
        border-radius: 50%;
        margin-right: 12rem;
        object-fit: cover;
      }

      .info {
        flex: 1;
        min-width: 0;

        .nickname {
          font-size: 15rem;
          font-weight: bold;
          color: white;
          margin-bottom: 4rem;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        .username {
          font-size: 13rem;
          color: var(--second-text-color);
          margin-bottom: 6rem;
        }

        .stats {
          font-size: 12rem;
          color: var(--second-text-color);

          .divider {
            margin: 0 5rem;
          }
        }
      }

      .follow-btn {
        padding: 8rem 20rem;
        background: var(--primary-btn-color);
        color: white;
        border: none;
        border-radius: 4rem;
        font-size: 14rem;
        cursor: pointer;

        &:active {
          opacity: 0.8;
        }

        &.followed {
          background: rgba(255, 255, 255, 0.15);
          color: var(--second-text-color);
        }
      }
    }
  }

  .load-more,
  .loading-more,
  .no-more {
    text-align: center;
    padding: 20rem;
    font-size: 14rem;
    color: var(--second-text-color);
  }

  .load-more {
    cursor: pointer;
    color: var(--primary-btn-color);

    &:active {
      opacity: 0.7;
    }
  }
}
</style>
