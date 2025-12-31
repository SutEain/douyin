<template>
  <div id="Community" @dragstart="(e) => _stopPropagation(e)">
    <ScrollList class="Scroll" v-if="state.show" :api="recommendedPost">
      <template v-slot="{ list }">
        <WaterfallList :list="mergeOverrides(list)" class="list">
          <template v-slot="{ item }">
            <div class="card" @click="(e) => showDetail(e, item)">
              <img class="poster" v-lazy="_checkImgUrl(item.note_card?.cover?.url_default)" />
              <div class="bottom">
                <div class="title">
                  {{ truncateTitle(item.note_card?.display_title) }}
                </div>
                <div class="b2">
                  <div class="user">
                    <img class="avatar" :src="_checkImgUrl(item.note_card?.user?.avatar)" />
                    <div class="name">{{ item.note_card?.user?.nickname }}</div>
                  </div>
                  <div class="star">
                    <Icon :icon="item.isLoved ? 'solar:heart-bold' : 'solar:heart-linear'" />
                    <div class="num">
                      {{ item.note_card?.interact_info?.liked_count }}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </template>
        </WaterfallList>
      </template>
    </ScrollList>

    <teleport to="body">
      <div class="shadow">
        <div class="wrap"></div>
        <AlbumDetail :detail="state.current" @close="close" @update="handleDetailUpdate" />
      </div>
    </teleport>
  </div>
</template>

<script setup>
import { reactive, ref, watch } from 'vue'
import { _checkImgUrl, _stopPropagation, cloneDeep } from '@/utils'
import { recommendedPost } from '@/api/user'
import WaterfallList from '@/components/WaterfallList.vue'
import ScrollList from '@/components/ScrollList.vue'
import { useBaseStore } from '@/store/pinia'
import AlbumDetail from '@/pages/other/AlbumDetail.vue'
import { _css } from '@/utils/dom'

const baseStore = useBaseStore()
const props = defineProps({
  active: {
    type: Boolean,
    default: false
  }
})

const state = reactive({
  show: false,
  overrides: {},
  current: {
    id: '',
    note_card: {
      interact_info: {},
      cover: {},
      image_list: [],
      display_title: '',
      user: {},
      comment_list: [],
      createTime: ''
    }
  },
  d: false
})
let rect = ref({})

watch(
  () => props.active,
  (n) => {
    if (n && !state.show) {
      state.show = true
    }
  },
  { immediate: true }
)

function truncateTitle(text) {
  const s = String(text || '')
  if (s.length <= 60) return s
  return s.slice(0, 60) + '…'
}

function applyPatchToItem(item, patch) {
  if (!patch) return item
  const next = {
    ...item,
    ...patch,
    note_card: {
      ...(item?.note_card || {}),
      ...(patch?.note_card || {}),
      interact_info: {
        ...((item?.note_card || {})?.interact_info || {}),
        ...((patch?.note_card || {})?.interact_info || {})
      }
    }
  }
  return next
}

function mergeOverrides(list) {
  const arr = Array.isArray(list) ? list : []
  return arr.map((item) => {
    const id = item?.id || item?.note_card?.aweme_id
    const patch = id ? state.overrides[String(id)] : null
    return patch ? applyPatchToItem(item, patch) : item
  })
}

function handleDetailUpdate(patch) {
  const id = patch?.id || patch?.note_card?.aweme_id
  if (!id) return
  state.overrides[String(id)] = patch
  // 同步当前打开的详情数据（避免关闭后再打开状态又回退）
  const currentId = state.current?.id || state.current?.note_card?.aweme_id
  if (String(currentId || '') === String(id)) {
    state.current = applyPatchToItem(state.current, patch)
  }
  console.log('[Community] synced detail update to list:', { id, patch })
}

function close() {
  let s = document.querySelector('.shadow ')
  let domRect = rect.value
  let t = '.3'
  _css(s, 'transition', `all ${t}s`)
  _css(s, 'top', domRect.top)
  _css(s, 'left', domRect.left)
  _css(s, 'width', domRect.width)
  _css(s, 'height', domRect.height)

  let a = document.querySelector('.goods-detail')
  _css(a, 'transition', `all ${t}s`)
  _css(a, 'opacity', '0')
  _css(a, 'width', '100vw')
  _css(a, 'height', '100vh')
  _css(a, 'transform', `scale(${domRect.sw},${domRect.sh})`)
  _css(a, 'transform-origin', `0 0`)

  let d = document.querySelector('.shadow .wrap')
  _css(d, 'transition', `all ${t}s`)
  _css(d, 'opacity', '1')

  // state.d = false
  setTimeout(() => {
    _css(s, 'z-index', '-100')
    _css(s, 'transition', 'all 0s')
    _css(s, 'top', '-200vh')
  }, 300)
}

function showDetail(e, item) {
  // ✅ 不再使用 Mock 数据，直接使用接口返回结构
  state.current = cloneDeep(item)
  // console.log(state.current)

  state.d = true

  let domRect = e.currentTarget.getBoundingClientRect()
  // // console.log('e', domRect)

  let s = document.querySelector('.shadow')

  // ✅ 盖住首页顶部 Tab（IndicatorHome），避免详情页顶部还露出 tab
  _css(s, 'z-index', '9999')
  _css(s, 'transition', 'all 0s')
  _css(s, 'top', domRect.top)
  _css(s, 'left', domRect.left)
  _css(s, 'width', domRect.width)
  _css(s, 'height', domRect.height)

  let t = '.3'
  let d = document.querySelector('.shadow .wrap')
  d.innerHTML = ''
  d.append(e.currentTarget.cloneNode(true))
  _css(d, 'display', 'block')
  _css(d, 'transition', `all ${t}s`)
  _css(d, 'opacity', '1')

  let sw = domRect.width / baseStore.bodyWidth
  let sh = domRect.height / baseStore.bodyHeight
  domRect.sw = sw
  domRect.sh = sh

  let a = document.querySelector('.goods-detail')
  _css(a, 'opacity', '0')
  _css(a, 'width', '100vw')
  _css(a, 'height', '100vh')
  _css(a, 'transform', `scale(${domRect.sw},${domRect.sh})`)
  _css(a, 'transform-origin', `0 0`)

  rect.value = domRect
  setTimeout(() => {
    _css(s, 'transition', `all ${t}s`)
    _css(s, 'top', 0)
    _css(s, 'left', 0)
    _css(s, 'width', '100vw')
    _css(s, 'height', '100vh')

    _css(d, 'opacity', '0')
    _css(d, 'z-index', '-1')

    _css(a, 'transition', `all ${t}s`)
    _css(a, 'opacity', '1')
    _css(a, 'transform', `scale(1,1)`)
    _css(a, 'transform-origin', `0 0`)
  })
}
</script>

<style scoped lang="less">
#Community {
  font-size: 14rem;
  color: white;
  // ✅ 默认紧凑模式布局
  padding-top: var(--home-header-height);
  background: #000;

  .Scroll {
    height: calc(
      var(--vh, 1vh) * 100 - var(--home-header-height) - var(--footer-height)
    ) !important;
  }

  // ✅ 全屏模式布局
  :global(.is-tg-fullscreen) & {
    padding-top: calc(var(--home-header-height) + env(safe-area-inset-top, 0rem));

    .Scroll {
      height: calc(
        var(--vh, 1vh) * 100 - (var(--home-header-height) + env(safe-area-inset-top, 0rem)) -
          var(--footer-height)
      ) !important;
    }
  }

  .list {
    margin-left: 2%;
    width: 96%;
  }
}

.card {
  border-radius: 4rem;
  overflow: hidden;
  background: var(--main-bg);

  .poster {
    display: block;
    width: 100%;
    object-fit: cover;
    //height: 33vh;
  }

  .bottom {
    color: gainsboro;
    padding: 10rem;
    padding-bottom: 15rem;

    .title {
      font-size: 14rem;
      margin-bottom: 8rem;
    }

    .b2 {
      display: flex;
      justify-content: space-between;
      align-items: center;

      .user {
        display: flex;
        font-size: 12rem;

        img {
          width: 15rem;
          border-radius: 50%;
          margin-right: 5rem;
        }
      }

      .star {
        display: flex;
        align-items: center;
        gap: 3rem;

        svg {
          font-size: 15rem;
        }

        .num {
          font-size: 12rem;
        }
      }
    }
  }
}

.shadow {
  background: var(--color-message);
  // ✅ fixed：确保打开详情页时能覆盖整个 viewport（不受父容器影响）
  position: fixed;
  left: 0;
  top: -200vh;
  width: 100%;
  transition: all 0.3s;
  overflow: hidden;
  z-index: -100;

  .wrap {
    position: absolute;
    z-index: 9999;
  }
}
</style>
