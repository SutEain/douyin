<template>
  <Transition name="fade">
    <div v-if="show" class="pc28-config-overlay" @click.self="handleClose">
      <div class="pc28-config-modal">
        <div class="modal-header">
          <h3>加拿大PC28游戏设置</h3>
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
              <span>大小单双</span>
              <label class="switch">
                <input type="checkbox" v-model="localConfig.game_settings.big_small.enabled" />
                <span class="slider"></span>
              </label>
            </div>
            <div v-if="localConfig.game_settings.big_small.enabled" class="odds-inputs">
              <div class="odds-item">
                <label>大</label>
                <input
                  type="number"
                  v-model.number="localConfig.game_settings.big_small.big"
                  step="0.01"
                  min="1"
                  max="9999"
                  @blur="validateOdds('big_small', 'big', localConfig.game_settings.big_small.big)"
                />
              </div>
              <div class="odds-item">
                <label>小</label>
                <input
                  type="number"
                  v-model.number="localConfig.game_settings.big_small.small"
                  step="0.01"
                  min="1"
                  max="9999"
                  @blur="
                    validateOdds('big_small', 'small', localConfig.game_settings.big_small.small)
                  "
                />
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
            <div v-if="localConfig.game_settings.odd_even.enabled" class="odds-inputs">
              <div class="odds-item">
                <label>单</label>
                <input
                  type="number"
                  v-model.number="localConfig.game_settings.odd_even.odd"
                  step="0.01"
                  min="1"
                  max="9999"
                  @blur="validateOdds('odd_even', 'odd', localConfig.game_settings.odd_even.odd)"
                />
              </div>
              <div class="odds-item">
                <label>双</label>
                <input
                  type="number"
                  v-model.number="localConfig.game_settings.odd_even.even"
                  step="0.01"
                  min="1"
                  max="9999"
                  @blur="validateOdds('odd_even', 'even', localConfig.game_settings.odd_even.even)"
                />
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
            <div v-if="localConfig.game_settings.combinations.enabled" class="odds-inputs">
              <div class="odds-item">
                <label>大单</label>
                <input
                  type="number"
                  v-model.number="localConfig.game_settings.combinations.big_odd"
                  step="0.01"
                  min="1"
                  max="9999"
                  @blur="
                    validateOdds(
                      'combinations',
                      'big_odd',
                      localConfig.game_settings.combinations.big_odd
                    )
                  "
                />
              </div>
              <div class="odds-item">
                <label>大双</label>
                <input
                  type="number"
                  v-model.number="localConfig.game_settings.combinations.big_even"
                  step="0.01"
                  min="1"
                  max="9999"
                  @blur="
                    validateOdds(
                      'combinations',
                      'big_even',
                      localConfig.game_settings.combinations.big_even
                    )
                  "
                />
              </div>
              <div class="odds-item">
                <label>小单</label>
                <input
                  type="number"
                  v-model.number="localConfig.game_settings.combinations.small_odd"
                  step="0.01"
                  min="1"
                  max="9999"
                  @blur="
                    validateOdds(
                      'combinations',
                      'small_odd',
                      localConfig.game_settings.combinations.small_odd
                    )
                  "
                />
              </div>
              <div class="odds-item">
                <label>小双</label>
                <input
                  type="number"
                  v-model.number="localConfig.game_settings.combinations.small_even"
                  step="0.01"
                  min="1"
                  max="9999"
                  @blur="
                    validateOdds(
                      'combinations',
                      'small_even',
                      localConfig.game_settings.combinations.small_even
                    )
                  "
                />
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
            <div v-if="localConfig.game_settings.extreme.enabled" class="odds-inputs">
              <div class="odds-item">
                <label>极大</label>
                <input
                  type="number"
                  v-model.number="localConfig.game_settings.extreme.extreme_big"
                  step="0.01"
                  min="1"
                  max="9999"
                  @blur="
                    validateOdds(
                      'extreme',
                      'extreme_big',
                      localConfig.game_settings.extreme.extreme_big
                    )
                  "
                />
              </div>
              <div class="odds-item">
                <label>极小</label>
                <input
                  type="number"
                  v-model.number="localConfig.game_settings.extreme.extreme_small"
                  step="0.01"
                  min="1"
                  max="9999"
                  @blur="
                    validateOdds(
                      'extreme',
                      'extreme_small',
                      localConfig.game_settings.extreme.extreme_small
                    )
                  "
                />
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
            <div v-if="localConfig.game_settings.patterns.enabled" class="odds-inputs">
              <div class="odds-item">
                <label>对子</label>
                <input
                  type="number"
                  v-model.number="localConfig.game_settings.patterns.pair"
                  step="0.01"
                  min="1"
                  max="9999"
                  @blur="validateOdds('patterns', 'pair', localConfig.game_settings.patterns.pair)"
                />
              </div>
              <div class="odds-item">
                <label>顺子</label>
                <input
                  type="number"
                  v-model.number="localConfig.game_settings.patterns.straight"
                  step="0.01"
                  min="1"
                  max="9999"
                  @blur="
                    validateOdds(
                      'patterns',
                      'straight',
                      localConfig.game_settings.patterns.straight
                    )
                  "
                />
              </div>
              <div class="odds-item">
                <label>豹子</label>
                <input
                  type="number"
                  v-model.number="localConfig.game_settings.patterns.leopard"
                  step="0.01"
                  min="1"
                  max="9999"
                  @blur="
                    validateOdds('patterns', 'leopard', localConfig.game_settings.patterns.leopard)
                  "
                />
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
            <div v-if="localConfig.game_settings.single_point.enabled" class="single-point-grid">
              <div v-for="point in 28" :key="point - 1" class="point-item">
                <label>{{ point - 1 }}</label>
                <input
                  type="number"
                  v-model.number="localConfig.game_settings.single_point.odds[point - 1]"
                  step="0.01"
                  min="1"
                  max="9999"
                  placeholder="赔率"
                  @blur="
                    validateOdds(
                      'single_point',
                      point - 1,
                      localConfig.game_settings.single_point.odds[point - 1]
                    )
                  "
                />
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

// 默认配置
const defaultConfig: Partial<PC28GameConfig> = {
  is_enabled: false,
  game_settings: {
    big_small: { enabled: true, big: 1.99, small: 1.99 },
    odd_even: { enabled: true, odd: 1.99, even: 1.99 },
    combinations: {
      enabled: true,
      big_odd: 4.2,
      big_even: 4.6,
      small_odd: 4.6,
      small_even: 4.2
    },
    extreme: { enabled: true, extreme_big: 15, extreme_small: 15 },
    patterns: { enabled: true, pair: 3.5, straight: 15, leopard: 88 },
    single_point: { enabled: true, odds: {} }
  }
}

const localConfig = ref<Partial<PC28GameConfig>>({
  ...defaultConfig,
  ...(props.config || {})
})

// 验证赔率范围（1-9999）
function validateOdds(section: string, key: string | number, value: number | undefined) {
  if (value === undefined || value === null) return

  if (value < 1 || value > 9999) {
    _notice(`赔率必须在1-9999范围内，当前值：${value}`)
    // 自动修正到有效范围
    if (value < 1) {
      if (section === 'single_point') {
        localConfig.value.game_settings!.single_point.odds[key as number] = 1
      } else {
        ;(localConfig.value.game_settings as any)[section][key] = 1
      }
    } else if (value > 9999) {
      if (section === 'single_point') {
        localConfig.value.game_settings!.single_point.odds[key as number] = 9999
      } else {
        ;(localConfig.value.game_settings as any)[section][key] = 9999
      }
    }
  }
}

// 初始化单点赔率（如果没有配置）
if (!localConfig.value.game_settings?.single_point?.odds) {
  localConfig.value.game_settings!.single_point!.odds = {}
}

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
    // 验证所有赔率
    const settings = localConfig.value.game_settings
    if (settings) {
      // 验证大小单双
      if (settings.big_small?.enabled) {
        if (settings.big_small.big < 1 || settings.big_small.big > 9999) {
          _notice('大小单双-大的赔率必须在1-9999范围内')
          return
        }
        if (settings.big_small.small < 1 || settings.big_small.small > 9999) {
          _notice('大小单双-小的赔率必须在1-9999范围内')
          return
        }
      }

      // 验证单双
      if (settings.odd_even?.enabled) {
        if (settings.odd_even.odd < 1 || settings.odd_even.odd > 9999) {
          _notice('单双-单的赔率必须在1-9999范围内')
          return
        }
        if (settings.odd_even.even < 1 || settings.odd_even.even > 9999) {
          _notice('单双-双的赔率必须在1-9999范围内')
          return
        }
      }

      // 验证组合
      if (settings.combinations?.enabled) {
        const comboKeys = ['big_odd', 'big_even', 'small_odd', 'small_even']
        for (const key of comboKeys) {
          const value = (settings.combinations as any)[key]
          if (value !== undefined && (value < 1 || value > 9999)) {
            _notice(`组合-${key}的赔率必须在1-9999范围内`)
            return
          }
        }
      }

      // 验证极值
      if (settings.extreme?.enabled) {
        if (settings.extreme.extreme_big < 1 || settings.extreme.extreme_big > 9999) {
          _notice('极值-极大的赔率必须在1-9999范围内')
          return
        }
        if (settings.extreme.extreme_small < 1 || settings.extreme.extreme_small > 9999) {
          _notice('极值-极小的赔率必须在1-9999范围内')
          return
        }
      }

      // 验证形态
      if (settings.patterns?.enabled) {
        if (settings.patterns.pair < 1 || settings.patterns.pair > 9999) {
          _notice('形态-对子的赔率必须在1-9999范围内')
          return
        }
        if (settings.patterns.straight < 1 || settings.patterns.straight > 9999) {
          _notice('形态-顺子的赔率必须在1-9999范围内')
          return
        }
        if (settings.patterns.leopard < 1 || settings.patterns.leopard > 9999) {
          _notice('形态-豹子的赔率必须在1-9999范围内')
          return
        }
      }

      // 验证单点
      if (settings.single_point?.enabled && settings.single_point.odds) {
        for (let i = 0; i <= 27; i++) {
          const value = settings.single_point.odds[i]
          if (value !== undefined && (value < 1 || value > 9999)) {
            _notice(`单点${i}的赔率必须在1-9999范围内`)
            return
          }
        }
      }
    }

    emit('save', localConfig.value)
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

.odds-inputs {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 10rem;
  margin-top: 10rem;
}

.odds-item {
  display: flex;
  flex-direction: column;
  gap: 5rem;
  min-width: 0; // 防止flex子元素溢出

  label {
    color: rgba(255, 255, 255, 0.8);
    font-size: 14rem;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  input {
    width: 100%;
    max-width: 100%;
    box-sizing: border-box;
    padding: 8rem;
    background: rgba(255, 255, 255, 0.1);
    border: 1px solid rgba(255, 255, 255, 0.2);
    border-radius: 6rem;
    color: white;
    font-size: 14rem;

    &:focus {
      outline: none;
      border-color: #fe2c55;
    }
  }
}

.single-point-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 10rem;
  margin-top: 10rem;
  max-height: 300rem;
  overflow-y: auto;
}

.point-item {
  display: flex;
  flex-direction: column;
  gap: 5rem;
  min-width: 0; // 防止flex子元素溢出

  label {
    color: rgba(255, 255, 255, 0.8);
    font-size: 12rem;
    text-align: center;
  }

  input {
    width: 100%;
    max-width: 100%;
    box-sizing: border-box;
    padding: 6rem;
    background: rgba(255, 255, 255, 0.1);
    border: 1px solid rgba(255, 255, 255, 0.2);
    border-radius: 4rem;
    color: white;
    font-size: 12rem;
    text-align: center;

    &:focus {
      outline: none;
      border-color: #fe2c55;
    }
  }
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
