<template>
  <div class="RedPacketOverlay">
    <!-- 挂件展示 -->
    <div
      v-for="packet in packets"
      :key="packet.id"
      class="packet-entry"
      @click="handlePacketClick(packet)"
    >
      <img src="/hongbao-.svg" class="packet-icon" />
      <div class="countdown" v-if="packet.timeLeft > 0">
        {{ formatTime(packet.timeLeft) }}
      </div>
      <div class="claim-tip" v-else>抢红包</div>
    </div>

    <!-- 红包弹窗 -->
    <Transition name="fade">
      <div v-if="showModal" class="packet-modal-overlay" @click.self="showModal = false">
        <div class="packet-modal">
          <div class="modal-content">
            <div class="close-btn" @click="showModal = false">
              <Icon icon="ion:close" />
            </div>
            <img src="/hongbao-.svg" class="large-icon" />
            <div class="title" v-if="currentPacket?.status === 'pending'">红包倒计时中</div>
            <div class="title" v-else-if="currentPacket?.status === 'active'">恭喜获得红包</div>

            <div class="coins" v-if="currentPacket">{{ currentPacket.total_coins }} 抖币</div>

            <div class="conditions" v-if="hasConditions">
              <div class="cond-item" :class="{ ok: condStatus.follow }">
                <Icon :icon="condStatus.follow ? 'ion:checkmark-circle' : 'ion:ellipse-outline'" />
                关注主播
              </div>
              <div class="cond-item" :class="{ ok: condStatus.chat }">
                <Icon :icon="condStatus.chat ? 'ion:checkmark-circle' : 'ion:ellipse-outline'" />
                发送指定弹幕: "{{ currentPacket.claim_conditions?.keyword }}"
              </div>
            </div>

            <div class="action-box">
              <div v-if="currentPacket?.timeLeft > 0" class="countdown-btn">
                等待 {{ formatTime(currentPacket.timeLeft) }}
              </div>
              <div v-else-if="canClaim" class="claim-btn pulse" @click="onClaim">開</div>
              <div v-else class="disabled-btn">
                {{ claimDisabledReason }}
              </div>
            </div>
          </div>
        </div>
      </div>
    </Transition>

    <!-- 领到红包的成功特效 -->
    <Transition name="scale">
      <div v-if="claimedAmount > 0" class="claim-success-overlay" @click="claimedAmount = 0">
        <div class="success-box">
          <div class="light-bg"></div>
          <div class="amount">+{{ claimedAmount }}</div>
          <div class="unit">抖币已放入余额</div>
          <div class="confirm-btn">开心收下</div>
        </div>
      </div>
    </Transition>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount, computed, watch } from 'vue'
import { Icon } from '@iconify/vue'
import { getActiveRedPackets, claimRedPacket } from '@/api/videos'
import { _notice } from '@/utils'
import { supabase } from '@/utils/supabase'

const props = defineProps<{
  roomId: string
  isFollowed: boolean
  lastMessage?: string
}>()

const packets = ref<any[]>([])
const showModal = ref(false)
const currentPacket = ref<any>(null)
const claimedAmount = ref(0)
const timer = ref<any>(null)

// 检查领取条件
const condStatus = computed(() => {
  if (!currentPacket.value) return { follow: false, chat: false }
  const cond = currentPacket.value.claim_conditions || {}
  const status = { follow: true, chat: true }

  if (cond.follow && !props.isFollowed) status.follow = false
  if (cond.keyword && props.lastMessage !== cond.keyword) status.chat = false

  return status
})

const hasConditions = computed(() => {
  const cond = currentPacket.value?.claim_conditions
  return cond?.follow || cond?.keyword
})

const canClaim = computed(() => {
  return condStatus.value.follow && condStatus.value.chat
})

const claimDisabledReason = computed(() => {
  if (!condStatus.value.follow) return '关注主播后领取'
  if (!condStatus.value.chat) return '发送弹幕后领取'
  return '无法领取'
})

async function fetchPackets() {
  try {
    const res = await getActiveRedPackets(props.roomId)
    if (res?.list) {
      packets.value = res.list.map((p: any) => ({
        ...p,
        timeLeft: Math.max(0, Math.floor((new Date(p.unlock_at).getTime() - Date.now()) / 1000))
      }))
    }
  } catch (e) {
    console.error('[RedPacket] fetch error:', e)
  }
}

function handlePacketClick(p: any) {
  currentPacket.value = p
  showModal.value = true
}

async function onClaim() {
  if (!currentPacket.value || !canClaim.value) return

  try {
    const res = await claimRedPacket(currentPacket.value.id)
    if (res?.amount) {
      claimedAmount.value = res.amount
      showModal.value = false
      // 从列表移除或更新状态
      packets.value = packets.value.filter((p) => p.id !== currentPacket.value.id)
    }
  } catch (e: any) {
    _notice(e.message || '领取失败')
  }
}

function formatTime(s: number) {
  const m = Math.floor(s / 60)
  const sec = s % 60
  return `${m}:${sec.toString().padStart(2, '0')}`
}

function startTimer() {
  timer.value = setInterval(() => {
    packets.value.forEach((p) => {
      if (p.timeLeft > 0) {
        p.timeLeft--
        if (p.timeLeft === 0) {
          p.status = 'active'
        }
      }
    })
  }, 1000)
}

// 监听实时更新
let channel: any = null
function setupRealtime() {
  channel = supabase
    .channel(`red_packet_${props.roomId}`)
    .on(
      'postgres_changes',
      {
        event: 'INSERT',
        schema: 'public',
        table: 'live_red_packets',
        filter: `room_id=eq.${props.roomId}`
      },
      (payload) => {
        const p = payload.new
        const timeLeft = Math.max(
          0,
          Math.floor((new Date(p.unlock_at).getTime() - Date.now()) / 1000)
        )
        packets.value.push({ ...p, timeLeft })
      }
    )
    .on(
      'postgres_changes',
      {
        event: 'UPDATE',
        schema: 'public',
        table: 'live_red_packets',
        filter: `room_id=eq.${props.roomId}`
      },
      (payload) => {
        const p = payload.new
        const idx = packets.value.findIndex((item) => item.id === p.id)
        if (idx > -1) {
          if (p.status === 'finished' || p.status === 'expired') {
            packets.value.splice(idx, 1)
          } else {
            const timeLeft = Math.max(
              0,
              Math.floor((new Date(p.unlock_at).getTime() - Date.now()) / 1000)
            )
            packets.value[idx] = { ...packets.value[idx], ...p, timeLeft }
          }
        }
      }
    )
    .subscribe()
}

onMounted(() => {
  fetchPackets()
  startTimer()
  setupRealtime()
})

onBeforeUnmount(() => {
  if (timer.value) clearInterval(timer.value)
  if (channel) supabase.removeChannel(channel)
})
</script>

<style scoped lang="less">
.RedPacketOverlay {
  position: absolute;
  top: 100rem;
  right: 15rem;
  z-index: 100;
  pointer-events: auto;

  .packet-entry {
    background: rgba(0, 0, 0, 0.5);
    padding: 5rem;
    border-radius: 10rem;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 2rem;
    margin-bottom: 10rem;
    animation: bounce 2s infinite ease-in-out;

    .packet-icon {
      width: 40rem;
      height: 40rem;
    }

    .countdown {
      font-size: 10rem;
      color: #ffda00;
      font-weight: bold;
    }

    .claim-tip {
      font-size: 10rem;
      color: #fe2c55;
      font-weight: bold;
    }
  }
}

.packet-modal-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.7);
  z-index: 1000;
  display: flex;
  align-items: center;
  justify-content: center;

  .packet-modal {
    width: 280rem;
    background: #e83828;
    border-radius: 20rem;
    padding: 20rem;
    position: relative;
    box-shadow: 0 10rem 30rem rgba(0, 0, 0, 0.5);

    .modal-content {
      display: flex;
      flex-direction: column;
      align-items: center;
      color: #ffd700;

      .close-btn {
        position: absolute;
        top: 10rem;
        right: 10rem;
        font-size: 20rem;
        color: rgba(255, 255, 255, 0.5);
      }

      .large-icon {
        width: 100rem;
        height: 100rem;
        margin-bottom: 15rem;
      }

      .title {
        font-size: 18rem;
        font-weight: bold;
        margin-bottom: 10rem;
      }

      .coins {
        font-size: 24rem;
        font-weight: 900;
        margin-bottom: 20rem;
      }

      .conditions {
        width: 100%;
        background: rgba(0, 0, 0, 0.1);
        padding: 10rem;
        border-radius: 10rem;
        margin-bottom: 20rem;
        font-size: 12rem;

        .cond-item {
          display: flex;
          align-items: center;
          gap: 5rem;
          color: rgba(255, 215, 0, 0.6);
          margin-bottom: 5rem;

          &.ok {
            color: #ffd700;
          }
        }
      }

      .action-box {
        .countdown-btn {
          padding: 10rem 30rem;
          background: rgba(255, 255, 255, 0.2);
          border-radius: 25rem;
          color: white;
          font-size: 14rem;
        }

        .claim-btn {
          width: 80rem;
          height: 80rem;
          background: #ebc14c;
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 36rem;
          color: #c30d23;
          font-weight: bold;
          cursor: pointer;
          box-shadow: 0 5rem 15rem rgba(0, 0, 0, 0.3);

          &.pulse {
            animation: pulse 1.5s infinite;
          }
        }

        .disabled-btn {
          padding: 10rem 20rem;
          background: rgba(0, 0, 0, 0.2);
          border-radius: 20rem;
          color: rgba(255, 255, 255, 0.5);
          font-size: 13rem;
        }
      }
    }
  }
}

.claim-success-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.8);
  z-index: 2000;
  display: flex;
  align-items: center;
  justify-content: center;

  .success-box {
    text-align: center;
    color: #face15;
    position: relative;

    .amount {
      font-size: 60rem;
      font-weight: 900;
      text-shadow: 0 0 20rem rgba(250, 206, 21, 0.8);
    }

    .unit {
      font-size: 16rem;
      margin-top: 10rem;
      color: white;
    }

    .confirm-btn {
      margin-top: 40rem;
      padding: 10rem 40rem;
      background: #fe2c55;
      color: white;
      border-radius: 25rem;
      font-weight: bold;
    }
  }
}

@keyframes bounce {
  0%,
  100% {
    transform: translateY(0);
  }
  50% {
    transform: translateY(-5rem);
  }
}

@keyframes pulse {
  0% {
    transform: scale(1);
    box-shadow: 0 0 0 0 rgba(235, 193, 76, 0.7);
  }
  70% {
    transform: scale(1.1);
    box-shadow: 0 0 0 15rem rgba(235, 193, 76, 0);
  }
  100% {
    transform: scale(1);
    box-shadow: 0 0 0 0 rgba(235, 193, 76, 0);
  }
}

.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.3s;
}
.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}

.scale-enter-active,
.scale-leave-active {
  transition: all 0.4s cubic-bezier(0.175, 0.885, 0.32, 1.275);
}
.scale-enter-from,
.scale-leave-to {
  opacity: 0;
  transform: scale(0.5);
}
</style>
