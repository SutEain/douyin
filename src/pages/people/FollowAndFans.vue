<template>
  <div class="FollowAndFans" id="FollowAndFans">
    <BaseHeader backMode="light" :isFixed="false">
      <template v-slot:right>
        <div>
          <img
            src="../../assets/img/icon/people/add-user.png"
            style="width: 22rem"
            @click="nav('/people/find-acquaintance')"
          />
        </div>
      </template>
    </BaseHeader>

    <!-- ✅ 采用 flex 布局，确保容器高度精准等于剩余空间 -->
    <div class="scroll-container" ref="scrollContainer">
      <div class="main" ref="mainContent">
        <div class="content">
          <div class="indicator-wrapper">
            <div class="custom-tabs">
              <div
                class="tab"
                :class="{ active: data.slideIndex === 0 }"
                @click="data.slideIndex = 0"
              >
                关注
              </div>
              <div
                class="tab"
                :class="{ active: data.slideIndex === 1 }"
                @click="data.slideIndex = 1"
              >
                粉丝
              </div>
              <div
                class="custom-indicator"
                :style="{ transform: `translateX(${data.slideIndex * 100}%)` }"
              ></div>
            </div>
          </div>

          <!-- ✅ 彻底移除 SlideHorizontal 组建，改用纯 Vue 条件渲染 -->
          <!-- 这样可以 100% 消除 JS 触摸冲突 -->
          <div class="list-content">
            <div v-if="data.slideIndex === 0" class="tab-pane">
              <Search
                v-model="data.searchKey"
                placeholder="搜索用户备注或名字"
                :is-show-right-text="false"
              />
              <div class="is-search" v-if="data.searchKey">
                <div class="search-result" v-if="data.searchFollowing.length">
                  <People
                    :key="i"
                    v-for="(item, i) in data.searchFollowing"
                    :people="item"
                    :show-unfollow="true"
                    @unfollow="handleUnfollow(item.user_id)"
                    @clickAvatar="handleClickAvatar(item)"
                  />
                </div>
                <div class="no-result" v-else>
                  <img src="../../assets/img/icon/no-result.png" alt="" />
                  <span class="n1">搜索结果为空</span>
                  <span class="n2">没有搜索到相关内容</span>
                </div>
              </div>
              <div class="no-search" v-else>
                <People
                  :key="i"
                  v-for="(item, i) in data.following"
                  :people="item"
                  :show-unfollow="true"
                  @unfollow="handleUnfollow(item.user_id)"
                  @clickAvatar="handleClickAvatar(item)"
                />
                <NoMore v-if="data.following.length" />
              </div>
            </div>

            <div v-else class="tab-pane">
              <People
                :key="i"
                v-for="(item, i) in data.followers"
                :people="item"
                @clickAvatar="handleClickAvatar(item)"
              />
              <NoMore v-if="data.followers.length" />
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import People from './components/People.vue'
import Search from '../../components/Search.vue'
import { useBaseStore } from '@/store/pinia'
import { onMounted, onUnmounted, reactive, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useNav } from '@/utils/hooks/useNav'
import { getFollowingList, getFollowersList } from '@/api/user'
import { toggleFollowUser } from '@/api/videos'
import { _notice } from '@/utils'

defineOptions({
  name: 'FollowAndFans'
})

const route = useRoute()
const router = useRouter()
const nav = useNav()
const store = useBaseStore()
const followLoading = ref(false) // 🎯 防止重复点击
const data = reactive({
  slideIndex: 0,
  searchKey: '',
  following: [] as any[],
  followers: [] as any[],
  searchFollowing: [] as any[]
})

const scrollContainer = ref<HTMLElement | null>(null)
const mainContent = ref<HTMLElement | null>(null)
let startY = 0

// ✅ 🎯 核心修复：精准拦截顶部下拉
function touchStart(e: TouchEvent) {
  startY = e.touches[0].pageY
}

function touchMove(e: TouchEvent) {
  if (!scrollContainer.value) return
  const moveY = e.touches[0].pageY - startY
  const isTop = scrollContainer.value.scrollTop <= 0

  // 只有在顶部且手指“向下拉”时，才拦截（防止 Telegram 关闭 APP）
  // 向上划（moveY < 0）绝对不拦截，交给系统原生滚动
  if (isTop && moveY > 0) {
    if (e.cancelable) e.preventDefault()
  }
}

function handleScroll() {
  // 可以在这里处理加载更多
}

onMounted(async () => {
  data.slideIndex = ~~route.query.type || 0
  await loadFollowing()
  await loadFollowers()

  // ✅ 在内容主体上绑定拦截，非 passive 模式
  if (mainContent.value) {
    mainContent.value.addEventListener('touchstart', touchStart, { passive: true })
    mainContent.value.addEventListener('touchmove', touchMove, { passive: false })
  }
})

onUnmounted(() => {
  if (mainContent.value) {
    mainContent.value.removeEventListener('touchstart', touchStart)
    mainContent.value.removeEventListener('touchmove', touchMove)
  }
})

async function loadFollowing() {
  const res = await getFollowingList()
  if (res.success) {
    data.following = res.data.list
  }
}

async function loadFollowers() {
  const res = await getFollowersList()
  if (res.success) {
    data.followers = res.data.list
  }
}

async function handleUnfollow(userId: string) {
  if (followLoading.value) return
  followLoading.value = true
  try {
    await toggleFollowUser(userId, false)
    _notice('已取消关注')
    await loadFollowing()
  } catch (error: any) {
    _notice(error?.message || '取消关注失败')
  } finally {
    followLoading.value = false
  }
}

function handleClickAvatar(user: any) {
  const userId = user.user_id || user.uid
  if (userId) {
    router.push(`/user/${userId}`)
  }
}

watch(
  () => data.searchKey,
  (newVal) => {
    if (newVal) {
      const keyword = newVal.toLowerCase()
      data.searchFollowing = data.following.filter((v) => {
        return (
          v.nickname?.toLowerCase().includes(keyword) ||
          v.unique_id?.toLowerCase().includes(keyword)
        )
      })
    } else {
      data.searchFollowing = []
    }
  }
)
</script>

<style scoped lang="less">
@import '../../assets/less/index';

.FollowAndFans {
  position: fixed;
  inset: 0;
  color: white;
  font-size: 14rem;
  overflow: hidden;
  display: flex;
  flex-direction: column; // ✅ 关键：垂直排列 header 和 container
  background: var(--main-bg);

  .scroll-container {
    flex: 1; // ✅ 关键：自动占满剩余高度
    overflow-y: auto;
    overflow-x: hidden;
    -webkit-overflow-scrolling: touch;

    &::-webkit-scrollbar {
      display: none;
    }
  }

  .main {
    width: 100%;
    min-height: 100.1%; // 激活 iOS 滚动引擎
    padding-bottom: 50px; // 给底部留点空间
  }

  .content {
    .indicator-wrapper {
      padding: 0 var(--page-padding);
      background: var(--main-bg);
      position: sticky;
      top: 0;
      z-index: 10;

      .custom-tabs {
        display: flex;
        position: relative;
        height: 45px;
        align-items: center;

        .tab {
          flex: 1;
          text-align: center;
          font-size: 16px;
          color: #888;
          cursor: pointer;
          transition: color 0.3s;
          height: 100%;
          display: flex;
          align-items: center;
          justify-content: center;

          &.active {
            color: #fff;
            font-weight: bold;
          }
        }

        .custom-indicator {
          position: absolute;
          bottom: 0;
          left: 0;
          width: 50%;
          height: 2px;
          background: #face15;
          transition: transform 0.3s ease;
        }
      }
    }
  }

  .tab-pane {
    padding: 0 var(--page-padding);
    animation: fadeIn 0.2s ease-in;
  }

  @keyframes fadeIn {
    from {
      opacity: 0;
    }
    to {
      opacity: 1;
    }
  }

  .tab1 {
    .no-search {
      padding-top: 60rem;
    }
    .is-search {
      padding-top: 50rem;
    }
  }
}
</style>
