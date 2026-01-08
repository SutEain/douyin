<template>
  <div class="FollowAndFans" id="FollowAndFans">
    <BaseHeader backMode="light">
      <template v-slot:center>
        <span class="f14">{{ store.userinfo.nickname }}</span>
      </template>
      <template v-slot:right>
        <div>
          <img
            src="../../assets/img/icon/people/add-user.png"
            style="width: 2rem"
            @click="nav('/people/find-acquaintance')"
          />
        </div>
      </template>
    </BaseHeader>

    <!-- ✅ 双层滚动结构：防止下拉时关闭 miniApp -->
    <div class="scroll-container" @scroll="handleScroll" ref="scrollContainer">
      <div class="main" ref="mainContent">
        <div class="content">
          <div class="indicator-wrapper">
            <Indicator
              tabStyleWidth="50%"
              :tabTexts="['关注', '粉丝']"
              v-model:active-index="data.slideIndex"
            >
            </Indicator>
          </div>
          <SlideHorizontal v-model:index="data.slideIndex" :disableSwipe="true">
            <SlideItem class="tab1">
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
                  ></People>
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
                ></People>
                <NoMore v-if="data.following.length" />
              </div>
            </SlideItem>
            <SlideItem class="tab2">
              <People
                :key="i"
                v-for="(item, i) in data.followers"
                :people="item"
                @clickAvatar="handleClickAvatar(item)"
              ></People>
              <NoMore v-if="data.followers.length" />
            </SlideItem>
          </SlideHorizontal>
        </div>
      </div>
      <!-- ✅ 关闭 main -->
    </div>
    <!-- ✅ 关闭 scroll-container -->
  </div>
</template>
<script setup lang="ts">
import People from './components/People.vue'
import Search from '../../components/Search.vue'
import Indicator from '../../components/slide/Indicator.vue'
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
const data = reactive({
  isSearch: false,
  searchKey: '',
  slideIndex: 0,
  following: [] as any[],
  followers: [] as any[],
  searchFollowing: [] as any[]
})

// UserPanel 相关状态 (已移除，改用路由跳转)
// const showUserPanel = ref(false)
// const selectedUser = ref<any>(null)

// ✅ 双层滚动结构的 refs
const scrollContainer = ref<HTMLElement | null>(null)
const mainContent = ref<HTMLElement | null>(null)

// ✅ 滚动事件（预留，可以用于其他逻辑）
function handleScroll() {
  // 可以添加滚动相关的逻辑
}

onMounted(async () => {
  data.slideIndex = ~~route.query.type
  await loadFollowing()
  await loadFollowers()
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
  try {
    await toggleFollowUser(userId, false)
    _notice('已取消关注')
    await loadFollowing()
  } catch (error: any) {
    _notice(error?.message || '取消关注失败')
  }
}

// ✅ 处理头像点击，打开用户资料页（路由跳转）
function handleClickAvatar(user: any) {
  console.log('[FollowAndFans] 点击头像:', user)
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
  left: 0;
  right: 0;
  bottom: 0;
  top: 0;
  color: white;
  font-size: 14rem;
  overflow: hidden; // ✅ 外层禁止滚动
  display: flex;
  flex-direction: column;

  // ✅ 内层滚动容器
  .scroll-container {
    flex: 1;
    overflow-y: auto;
    overflow-x: hidden;
    -webkit-overflow-scrolling: touch;
    background: var(--main-bg);

    &::-webkit-scrollbar {
      display: none;
    }
  }

  .main {
    min-height: 100.1%; // ✅ 强制内容超出一点点，确保 iOS 下能触发滚动
  }

  .content {
    padding-top: var(--common-header-height);

    .indicator-wrapper {
      padding: 0 var(--page-padding);
      background: var(--main-bg);
      position: sticky;
      top: 0;
      z-index: 10;
    }

    .search-ctn {
      z-index: 9;
      left: 0;
      background: var(--main-bg);
      position: fixed;
      width: 100vw;
      box-sizing: border-box;
      padding: 10rem var(--page-padding) 0 var(--page-padding);
    }
  }

  .tab1,
  .tab2 {
    // ✅ 移除 overflow: auto，让外层的 scroll-container 处理滚动
    overflow: visible;
    padding: 0 var(--page-padding);
    box-sizing: border-box;
  }

  .tab1 {
    .title {
      display: flex;
      align-items: center;
      margin-bottom: 10rem;
      color: var(--second-text-color);
      font-size: 12rem;
    }

    .no-search {
      padding-top: 60rem;
    }

    .is-search {
      padding-top: 50rem;

      .no-result {
        display: flex;
        flex-direction: column;
        align-items: center;

        img {
          margin-top: 150rem;
          height: 150rem;
        }

        .n1 {
          margin-top: 40rem;
          font-size: 16rem;
        }

        .n2 {
          margin-top: 20rem;
          font-size: 12rem;
          color: var(--second-text-color);
        }
      }
    }
  }
}
</style>
