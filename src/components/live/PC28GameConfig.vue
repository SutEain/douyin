<template>
  <Transition name="fade">
    <div v-if="show" class="pc28-config-overlay" @click.self="handleClose">
      <div class="pc28-config-modal">
        <div class="modal-header">
          <h3>快三类游戏设置</h3>
          <Icon icon="ion:close" class="close-btn" @click="handleClose" />
        </div>

        <div class="modal-content">
          <!-- 游戏开关 -->
          <div class="config-section">
            <div class="section-title">
              <span>游戏开关</span>
              <label class="switch">
                <input type="checkbox" v-model="localConfig.is_enabled" />
                <span class="slider"></span>
              </label>
            </div>
          </div>

          <!-- 大小单双 -->
          <div class="config-section">
            <div class="section-title">
              <span>大小</span>
              <label class="switch">
                <input type="checkbox" v-model="localConfig.game_settings.big_small.enabled" />
                <span class="slider"></span>
              </label>
            </div>
            <div v-if="localConfig.game_settings.big_small.enabled" class="odds-display">
              <div class="odds-info">
                <span>平台统一赔率：大/小 2.0倍</span>
              </div>
            </div>
          </div>

          <!-- 单双 -->
          <div class="config-section">
            <div class="section-title">
              <span>单双</span>
              <label class="switch">
                <input type="checkbox" v-model="localConfig.game_settings.odd_even.enabled" />
                <span class="slider"></span>
              </label>
            </div>
            <div v-if="localConfig.game_settings.odd_even.enabled" class="odds-display">
              <div class="odds-info">
                <span>平台统一赔率：单/双 2.0倍</span>
              </div>
            </div>
          </div>

          <!-- 组合 -->
          <div class="config-section">
            <div class="section-title">
              <span>组合</span>
              <label class="switch">
                <input type="checkbox" v-model="localConfig.game_settings.combinations.enabled" />
                <span class="slider"></span>
              </label>
            </div>
            <div v-if="localConfig.game_settings.combinations.enabled" class="odds-display">
              <div class="odds-info">
                <span>平台统一赔率：大单/大双/小单/小双 4.6倍</span>
              </div>
            </div>
          </div>

          <!-- 极值 -->
          <div class="config-section">
            <div class="section-title">
              <span>极值</span>
              <label class="switch">
                <input type="checkbox" v-model="localConfig.game_settings.extreme.enabled" />
                <span class="slider"></span>
              </label>
            </div>
            <div v-if="localConfig.game_settings.extreme.enabled" class="odds-display">
              <div class="odds-info">
                <span>平台统一赔率：极大/极小 15倍</span>
              </div>
            </div>
          </div>

          <!-- 形态 -->
          <div class="config-section">
            <div class="section-title">
              <span>形态</span>
              <label class="switch">
                <input type="checkbox" v-model="localConfig.game_settings.patterns.enabled" />
                <span class="slider"></span>
              </label>
            </div>
            <div v-if="localConfig.game_settings.patterns.enabled" class="odds-display">
              <div class="odds-info">
                <span>平台统一赔率：对子 3.4倍，顺子 15倍，豹子 80倍</span>
              </div>
            </div>
          </div>

          <!-- 单点 -->
          <div class="config-section">
            <div class="section-title">
              <span>单点</span>
              <label class="switch">
                <input type="checkbox" v-model="localConfig.game_settings.single_point.enabled" />
                <span class="slider"></span>
              </label>
            </div>
            <div v-if="localConfig.game_settings.single_point.enabled" class="odds-display">
              <div class="odds-info">
                <span
                  >平台统一赔率：0/27=888倍，1/26=222倍，2/25=123倍，3/24=80倍，4/23=48倍，5/22=38倍，6/21=28倍，7/20=22倍，8/19=18倍，9/18=15倍，10/17=14倍，11/16=13倍，12/15=12倍，13/14=11倍</span
                >
              </div>
            </div>
          </div>
        </div>

        <div class="modal-footer">
          <button class="btn-cancel" @click="handleClose">取消</button>
          <button class="btn-confirm" @click="handleSave">保存设置</button>
        </div>
      </div>
    </div>
  </Transition>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue'
import { Icon } from '@iconify/vue'
import { PC28GameConfig } from '@/api/pc28'
import { _notice } from '@/utils'

const props = defineProps<{
  show: boolean
  config: PC28GameConfig | null
  roomId: string
}>()

const emit = defineEmits<{
  (e: 'close'): void
  (e: 'save', config: Partial<PC28GameConfig>): void
}>()

// 赔率由平台统一管理，不再需要默认赔率配置

// 默认配置（只包含开关状态，赔率由平台统一管理）
const defaultConfig: Partial<PC28GameConfig> = {
  is_enabled: false,
  game_settings: {
    big_small: { enabled: true },
    odd_even: { enabled: true },
    combinations: { enabled: true },
    extreme: { enabled: true },
    patterns: { enabled: true },
    single_point: { enabled: true }
  }
}

const localConfig = ref<Partial<PC28GameConfig>>({
  ...defaultConfig,
  ...(props.config || {})
})

// 赔率由平台统一管理，不再需要验证和初始化赔率

// 监听配置变化
watch(
  () => props.config,
  (newConfig) => {
    if (newConfig) {
      localConfig.value = { ...newConfig }
    } else {
      localConfig.value = { ...defaultConfig }
    }
  },
  { immediate: true }
)

function handleClose() {
  emit('close')
}

async function handleSave() {
  try {
    // 只保存开关状态，不保存赔率（赔率由平台统一管理）
    // 构建只包含开关状态的配置
    const settings = localConfig.value.game_settings
    const saveConfig: Partial<PC28GameConfig> = {
      is_enabled: localConfig.value.is_enabled,
      game_settings: {
        big_small: { enabled: settings?.big_small?.enabled ?? true },
        odd_even: { enabled: settings?.odd_even?.enabled ?? true },
        combinations: { enabled: settings?.combinations?.enabled ?? true },
        extreme: { enabled: settings?.extreme?.enabled ?? true },
        patterns: { enabled: settings?.patterns?.enabled ?? true },
        single_point: { enabled: settings?.single_point?.enabled ?? true }
      }
    }

    emit('save', saveConfig)
    _notice('设置已保存')
    handleClose()
  } catch (e: any) {
    _notice(e.message || '保存失败')
  }
}
</script>

<style scoped lang="less">
.pc28-config-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.7);
  z-index: 2000;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 20rem;
}

.pc28-config-modal {
  width: 100%;
  max-width: 500rem;
  max-height: 90vh;
  background: #1a1a1a;
  border-radius: 20rem;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.modal-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 20rem;
  border-bottom: 1px solid rgba(255, 255, 255, 0.1);

  h3 {
    color: white;
    font-size: 18rem;
    margin: 0;
  }

  .close-btn {
    font-size: 24rem;
    color: rgba(255, 255, 255, 0.6);
    cursor: pointer;
  }
}

.modal-content {
  flex: 1;
  overflow-y: auto;
  padding: 20rem;
}

.config-section {
  margin-bottom: 20rem;
  padding: 15rem;
  background: rgba(255, 255, 255, 0.05);
  border-radius: 10rem;
}

.section-title {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 10rem;
  color: white;
  font-size: 16rem;
  font-weight: bold;
}

.switch {
  position: relative;
  display: inline-block;
  width: 50rem;
  height: 26rem;

  input {
    opacity: 0;
    width: 0;
    height: 0;
  }

  .slider {
    position: absolute;
    cursor: pointer;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background-color: #ccc;
    transition: 0.4s;
    border-radius: 26rem;

    &:before {
      position: absolute;
      content: '';
      height: 20rem;
      width: 20rem;
      left: 3rem;
      bottom: 3rem;
      background-color: white;
      transition: 0.4s;
      border-radius: 50%;
    }
  }

  input:checked + .slider {
    background-color: #fe2c55;
  }

  input:checked + .slider:before {
    transform: translateX(24rem);
  }
}

.odds-display {
  margin-top: 10rem;
  padding: 10rem;
  background: rgba(255, 255, 255, 0.05);
  border-radius: 6rem;
}

.odds-info {
  color: rgba(255, 255, 255, 0.7);
  font-size: 14rem;
  line-height: 1.6;
}

.modal-footer {
  display: flex;
  gap: 10rem;
  padding: 20rem;
  border-top: 1px solid rgba(255, 255, 255, 0.1);

  button {
    flex: 1;
    padding: 12rem;
    border-radius: 10rem;
    font-size: 16rem;
    font-weight: bold;
    border: none;
    cursor: pointer;
  }

  .btn-cancel {
    background: rgba(255, 255, 255, 0.1);
    color: white;
  }

  .btn-confirm {
    background: #fe2c55;
    color: white;
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
</style>
