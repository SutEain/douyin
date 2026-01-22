<template>
  <div class="live-tab">
    <div class="content">
      <div class="rooms">
        <div v-if="state.loading" class="rooms-state">
          <Loading :is-full-screen="false" />
        </div>
        <div v-else-if="state.error" class="rooms-state error">{{ state.error }}</div>
        <div v-else-if="!state.rooms.length" class="rooms-state">暂无直播间</div>

        <div v-else class="rooms-grid">
          <div
            v-for="r in state.rooms"
            :key="r.id"
            class="room-card"
            :class="{ active: state.currentRoom?.id === r.id }"
            @click="playRoom(r)"
          >
            <div class="cover">
              <img v-if="r.cover_url" :src="r.cover_url" alt="" />
              <div v-else class="cover-fallback">LIVE</div>
            </div>
            <div class="meta">
              <div class="title">{{ r.title || '直播间' }}</div>
              <div class="sub">{{ r.description || '' }}</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { onMounted, reactive, watchEffect } from 'vue'
import { useRouter } from 'vue-router'
import Loading from '@/components/Loading.vue'
import { fetchLiveRooms, type LiveRoom } from '@/api/live'

interface Props {
  active?: boolean
}

const props = defineProps<Props>()
const router = useRouter()

const state = reactive({
  rooms: [] as LiveRoom[],
  loading: false,
  error: ''
})

// 外层 tab 被切走/切回时，按需求默认保持“看电视”
watchEffect(() => {
  if (props.active === false) return
  // active true 时不做强制重置，避免用户切到“一起看”又被抢回
})

async function loadRooms() {
  state.loading = true
  state.error = ''
  try {
    const list = await fetchLiveRooms()
    state.rooms = list
  } catch (e: any) {
    console.error('[LiveTab] loadRooms failed:', e)
    state.error = e?.message || '加载失败'
  } finally {
    state.loading = false
  }
}

function playRoom(room: LiveRoom) {
  // 无论是自建还是转播，统一使用 TikTok 风格详情页
  router.push({
    path: '/home/live',
    query: {
      id: room.id,
      type: room.is_self_hosted ? 'self' : 'external'
    }
  })
}

onMounted(() => {
  loadRooms()
})
</script>

<style scoped lang="less">
.live-tab {
  width: 100%;
  height: 100%;
  background: #000;
  color: #fff;
  display: flex;
  flex-direction: column;
  // ✅ 默认紧凑模式布局
  padding-top: var(--home-header-height);
  box-sizing: border-box;
}

.content {
  flex: 1 1 auto;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

.rooms {
  flex: 1 1 auto;
  min-height: 0;
  overflow: auto;
  padding: 12rem 12rem 20rem;
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
}

.rooms-state {
  flex: 1;
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: center;
  text-align: center;
  color: rgba(255, 255, 255, 0.6);
  min-height: 0;

  &.error {
    color: rgba(255, 120, 120, 0.95);
  }
}

.rooms-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12rem;
}

.room-card {
  border-radius: 12rem;
  overflow: hidden;
  background: rgba(255, 255, 255, 0.06);
  cursor: pointer;

  &.active {
    outline: 2px solid rgba(255, 255, 255, 0.35);
  }
}

.cover {
  width: 100%;
  aspect-ratio: 16 / 9;
  background: rgba(255, 255, 255, 0.08);
  display: flex;
  align-items: center;
  justify-content: center;

  img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
  }
}

.cover-fallback {
  font-weight: 800;
  letter-spacing: 1px;
  color: rgba(255, 255, 255, 0.75);
}

.meta {
  padding: 10rem 10rem 12rem;

  .title {
    font-size: 13rem;
    font-weight: 700;
    color: #fff;
    line-height: 1.2;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .sub {
    margin-top: 6rem;
    font-size: 12rem;
    color: rgba(255, 255, 255, 0.6);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
}
</style>
