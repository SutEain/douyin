<template>
  <div
    ref="input"
    :placeholder="placeholder"
    class="auto-input"
    contenteditable
    @input="handleInput"
    @compositionstart="handleCompositionStart"
    @compositionend="handleCompositionEnd"
    @blur="handleBlur"
  ></div>
</template>

<script lang="ts">
export default {
  name: 'AutoInput',
  props: {
    modelValue: String,
    placeholder: {
      type: String,
      default: '留下你的精彩评论吧'
    }
  },
  data() {
    return {
      isComposing: false, // 是否正在输入法组合中
      internalValue: '' // 内部值，避免和 modelValue 冲突
    }
  },
  watch: {
    // 监听外部 modelValue 变化，更新内部内容
    modelValue(newVal) {
      if (this.$refs.input && this.$refs.input.innerText !== newVal) {
        this.$refs.input.innerText = newVal || ''
        this.internalValue = newVal || ''
      }
    }
  },
  mounted() {
    // 初始化内容
    if (this.$refs.input && this.modelValue) {
      this.$refs.input.innerText = this.modelValue
      this.internalValue = this.modelValue
    }
  },
  methods: {
    // ✅ 输入法组合开始（输入拼音时）
    handleCompositionStart() {
      this.isComposing = true
    },
    
    // ✅ 输入法组合结束（选择中文后）
    handleCompositionEnd(e) {
      this.isComposing = false
      // 组合结束后立即更新
      this.updateValue()
    },
    
    // ✅ 输入事件
    handleInput(e) {
      // 如果正在输入法组合中，不更新 modelValue，避免拼音混入
      if (!this.isComposing) {
        this.updateValue()
      }
    },
    
    // ✅ 失焦时确保更新
    handleBlur() {
      this.updateValue()
    },
    
    // ✅ 更新 modelValue
    updateValue() {
      const newValue = this.$refs.input?.innerText || ''
      if (newValue !== this.internalValue) {
        this.internalValue = newValue
        this.$emit('update:modelValue', newValue)
      }
    }
  }
}
</script>

<style scoped lang="less">
.auto-input {
  font-size: 14rem;
  width: 100%;
  max-height: 70rem;
  overflow-y: scroll;
  padding: 0 5rem;
  outline: none;
}

.auto-input::-webkit-scrollbar {
  width: 0 !important;
}

.auto-input:empty::before {
  /*content: "留下你的精彩评论吧";*/
  content: attr(placeholder);
  color: #999999;
}

.auto-input:focus::before {
  content: none;
}
</style>
