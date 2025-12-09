<template>
  <div class="user-page">
    <UserPanel
      v-if="currentItem"
      :currentItem="currentItem"
      :active="true"
      @back="router.back()"
      @update:currentItem="handleUpdate"
    />
    <div v-else class="loading-container">
      <Loading :isFullScreen="false" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import UserPanel from '@/components/UserPanel.vue'
import Loading from '@/components/Loading.vue'
import { DefaultUser } from '@/utils/const_var'

const route = useRoute()
const router = useRouter()
const currentItem = ref<any>(null)

defineOptions({
  name: 'UserPage'
})

onMounted(() => {
  const userId = route.params.id as string
  if (userId) {
    // 构造初始 currentItem，只包含 authorId，UserPanel 会自己加载详情
    currentItem.value = {
      author: {
        ...DefaultUser,
        user_id: userId,
        uid: userId
      },
      aweme_list: []
    }
  }
})

function handleUpdate(newItem: any) {
  currentItem.value = newItem
}
</script>

<style scoped>
.user-page {
  position: fixed;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  background: black;
  z-index: 1000;
  overflow: hidden; /* 防止溢出 */
  overscroll-behavior: contain; /* 防止拉动整个页面 */
}

.loading-container {
  display: flex;
  justify-content: center;
  align-items: center;
  height: 100%;
}
</style>
