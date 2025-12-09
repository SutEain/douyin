<template>
  <div class="SearchResult" ref="scrollContainer">
    <!-- 顶部搜索栏 -->
    <div class="header">
      <dy-back mode="light" @click="router.back" class="mr1r"></dy-back>
      <div class="search-bar-readonly" @click="handleSearchBarClick">
        <img src="../../assets/img/icon/home/search.png" class="search-icon" />
        <div class="content">
          <span class="keyword">{{ keyword }}</span>
          <span class="count" v-if="searchType === 'video' && videoTotal > 0"
            >({{ videoTotal }})</span
          >
          <span class="count" v-if="searchType === 'user' && userTotal > 0">({{ userTotal }})</span>
        </div>
      </div>
    </div>

    <!-- 视频结果 -->
    <div v-if="searchType === 'video'" class="video-results">
      <div v-if="videoLoading && videoList.length === 0" class="loading-container">
        <Loading :is-full-screen="false" />
      </div>
      <div v-else-if="videoList.length === 0" class="empty">
        <img src="../../assets/img/icon/home/empty.png" alt="" class="empty-icon" />
        <div class="empty-text">暂无相关视频</div>
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
        加载更多
      </div>
      <div v-if="videoLoading && videoList.length > 0" class="loading-more">加载中...</div>
      <div v-if="!videoHasMore && videoList.length > 0" class="no-more">没有更多了</div>
    </div>

    <!-- 用户结果 -->
    <div v-if="searchType === 'user'" class="user-results">
      <div v-if="userLoading && userList.length === 0" class="loading-container">
        <Loading :is-full-screen="false" />
      </div>
      <div v-else-if="userList.length === 0" class="empty">
        <img src="../../assets/img/icon/home/empty.png" alt="" class="empty-icon" />
        <div class="empty-text">暂无相关用户</div>
      </div>
      <div v-else class="user-list">
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
            @error="
              (e) =>
                ((e.target as HTMLImageElement).src = require('../../assets/img/icon/avatar/1.png'))
            "
          />
          <div class="info">
            <div class="nickname">{{ user.nickname || user.username }}</div>
            <div class="username">@{{ user.username }}</div>
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
      <div v-if="userHasMore && !userLoading" class="load-more" @click="loadMoreUsers">
        加载更多
      </div>
      <div v-if="userLoading && userList.length > 0" class="loading-more">加载中...</div>
      <div v-if="!userHasMore && userList.length > 0" class="no-more">没有更多了</div>
    </div>
  </div>
</template>

<script setup lang="ts">
import Search from '../../components/Search.vue'
import VideoListItem from '../../components/VideoListItem.vue'
import Loading from '../../components/Loading.vue'
import { ref, onMounted, onActivated, onDeactivated, watch, nextTick } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { searchVideos, searchUsers } from '@/api/search'
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

// 搜索关键词和类型
const keyword = ref('')
const searchType = ref<'video' | 'user'>('video')

// 记录上次搜索的参数
const lastSearchParams = ref({
  keyword: '',
  type: 'video' as 'video' | 'user'
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
const userPage = ref(0)
const userPageSize = ref(20)
const userLoading = ref(false)
const userHasMore = ref(true)

// 检查是否需要重新搜索
function shouldReload() {
  const newKeyword = (route.query.keyword as string) || ''
  const newType = (route.query.type as 'video' | 'user') || 'video'

  return newKeyword !== lastSearchParams.value.keyword || newType !== lastSearchParams.value.type
}

// 初始化搜索
function initSearch() {
  const newKeyword = (route.query.keyword as string) || ''
  const newType = (route.query.type as 'video' | 'user') || 'video'

  keyword.value = newKeyword
  searchType.value = newType

  if (keyword.value) {
    // 更新上次搜索参数
    lastSearchParams.value = {
      keyword: keyword.value,
      type: searchType.value
    }

    // 根据类型搜索
    if (searchType.value === 'video') {
      loadVideos()
    } else {
      loadUsers()
    }
  }
}

onMounted(() => {
  initSearch()
  isMounted.value = true
})

// ✅ 离开时保存滚动位置（作为备份，如果不是点击视频跳转的情况）
onDeactivated(() => {
  if (scrollContainer.value && scrollContainer.value.scrollTop > 0) {
    savedScrollTop.value = scrollContainer.value.scrollTop
    console.log('[SearchResult] onDeactivated 保存滚动位置:', savedScrollTop.value)
  }
})

// ✅ keep-alive 激活时
onActivated(() => {
  // 首次挂载时跳过（onMounted 已经处理）
  if (!isMounted.value) {
    return
  }

  // 检查搜索参数是否变化
  if (shouldReload()) {
    console.log('[SearchResult] 参数变化，重新搜索')
    // 重置数据
    const newType = (route.query.type as 'video' | 'user') || 'video'
    if (newType === 'video') {
      videoList.value = []
      videoPage.value = 0
      videoTotal.value = 0
      videoHasMore.value = true
    } else {
      userList.value = []
      userPage.value = 0
      userTotal.value = 0
      userHasMore.value = true
    }
    savedScrollTop.value = 0 // 重置滚动位置
    initSearch()
  } else {
    // 参数未变化，使用缓存，并恢复滚动位置
    console.log('[SearchResult] 使用缓存，恢复滚动位置:', savedScrollTop.value)
    keyword.value = lastSearchParams.value.keyword
    searchType.value = lastSearchParams.value.type

    nextTick(() => {
      if (scrollContainer.value) {
        scrollContainer.value.scrollTop = savedScrollTop.value
      }
    })
  }
})

// 监听路由参数变化（仅在当前页面活动时）
watch(
  () => [route.query.keyword, route.query.type],
  ([newKeyword, newType]) => {
    const hasKeywordChanged = newKeyword && newKeyword !== keyword.value
    const hasTypeChanged = newType && newType !== searchType.value

    if (hasKeywordChanged || hasTypeChanged) {
      keyword.value = newKeyword as string
      searchType.value = (newType as 'video' | 'user') || 'video'

      // 更新上次搜索参数
      lastSearchParams.value = {
        keyword: keyword.value,
        type: searchType.value
      }

      resetAndSearch()
    }
  }
)

// 重新搜索
function resetAndSearch() {
  // 根据类型重置对应的状态
  if (searchType.value === 'video') {
    videoList.value = []
    videoPage.value = 0
    videoTotal.value = 0
    videoHasMore.value = true
    loadVideos()
  } else {
    userList.value = []
    userPage.value = 0
    userTotal.value = 0
    userHasMore.value = true
    loadUsers()
  }
}

// 加载视频
async function loadVideos() {
  if (videoLoading.value || !videoHasMore.value) return

  try {
    videoLoading.value = true
    const result = await searchVideos(keyword.value, videoPage.value, videoPageSize.value)

    if (result.list) {
      videoList.value.push(...result.list)
      videoTotal.value = result.total
      videoHasMore.value = videoList.value.length < result.total
      videoPage.value++
    }
  } catch (error) {
    console.error('[SearchResult] 搜索视频失败:', error)
  } finally {
    videoLoading.value = false
  }
}

// 加载用户
async function loadUsers() {
  if (userLoading.value || !userHasMore.value) return

  try {
    userLoading.value = true
    const result = await searchUsers(keyword.value, userPage.value, userPageSize.value)

    if (result.list) {
      userList.value.push(...result.list)
      userTotal.value = result.total
      userHasMore.value = userList.value.length < result.total
      userPage.value++
    }
  } catch (error) {
    console.error('[SearchResult] 搜索用户失败:', error)
  } finally {
    userLoading.value = false
  }
}

// 加载更多视频
function loadMoreVideos() {
  loadVideos()
}

// 加载更多用户
function loadMoreUsers() {
  loadUsers()
}

// 重新搜索（保留当前搜索类型）
function handleReSearch(newKeyword: string) {
  if (!newKeyword.trim()) return

  // 更新路由参数，保留搜索类型
  router.replace({
    query: {
      keyword: newKeyword.trim(),
      type: searchType.value
    }
  })
}

// 跳转到用户主页
function goUserPanel(userId: string) {
  router.push(`/user/${userId}`)
}

// 处理视频点击
function handleVideoClick(video: any) {
  // ✅ 1. 点击时立即保存滚动位置
  if (scrollContainer.value) {
    savedScrollTop.value = scrollContainer.value.scrollTop
    console.log('[SearchResult] 点击视频，手动保存滚动位置:', savedScrollTop.value)
  }

  // 找到当前点击的视频在列表中的索引
  const clickedIndex = videoList.value.findIndex((v) => v.aweme_id === video.aweme_id)

  // 使用 baseStore 传递数据到 VideoDetail 页面
  baseStore.routeData = {
    items: videoList.value, // 传递整个搜索结果列表
    index: clickedIndex >= 0 ? clickedIndex : 0 // 传递当前点击的视频索引
  }

  // 跳转到视频详情页
  router.push({
    name: 'video-detail'
  })
}

// 点击顶部搜索条：返回搜索页
function handleSearchBarClick() {
  router.back()
}

// 处理视频列表关注
async function handleFollow(userId: string) {
  // 注意：子组件传递的是 userId，但我们需要更新 videoList 中的状态
  // 这里可能需要 VideoListItem 传递 video 对象或者我们遍历更新
  // 由于列表可能包含同一个作者的多个视频，我们应该更新所有匹配的视频

  // 查找任意一个匹配该作者的视频来获取当前状态（假设列表状态一致）
  const targetVideo = videoList.value.find((v) => (v.author?.user_id || v.author?.uid) === userId)
  if (!targetVideo) return

  const newStatus = !targetVideo.is_following

  // 乐观更新所有该作者的视频状态
  videoList.value.forEach((v) => {
    if ((v.author?.user_id || v.author?.uid) === userId) {
      v.is_following = newStatus
    }
  })

  try {
    await toggleFollowUser(userId, newStatus)
  } catch (error) {
    // 回滚
    console.error('关注失败:', error)
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
    console.error('关注失败:', error)
  }
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
    font-size: 14rem;
    padding: 0 var(--page-padding);
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

        .count {
          color: var(--second-text-color);
          font-size: 12rem;
          white-space: nowrap;
        }
      }
    }
  }

  // 移除旧的 result-title 样式，或者保留它但不再使用
  .result-title {
    display: none;
  }

  .video-results,
  .user-results {
    padding-top: 60rem; // 调整顶部间距
    min-height: calc(100vh - 60rem);
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
