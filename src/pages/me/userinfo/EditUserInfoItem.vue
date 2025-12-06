<template>
  <div class="edit-item">
    <BaseHeader @back="back">
      <template v-slot:center>
        <span v-if="data.type === 1" class="f16">{{ $t('profile.editName') }}</span>
        <span v-if="data.type === 2" class="f16">{{ $t('profile.editDouyinId') }}</span>
        <span v-if="data.type === 3" class="f16">{{ $t('profile.editBio') }}</span>
      </template>
      <template v-slot:right>
        <div>
          <span class="f16" :class="isChanged ? 'save-yes' : 'save-no'" @click="save">{{ $t('profile.save') }}</span>
        </div>
      </template>
    </BaseHeader>

    <div class="content">
      <div v-if="data.type === 1">
        <div class="notice">{{ $t('profile.myName') }}</div>
        <div class="input-ctn" style="margin-bottom: 1rem">
          <input type="text" v-model="data.localUserinfo.nickname" :placeholder="$t('profile.namePlaceholder')" />
          <img
            v-if="data.localUserinfo.nickname"
            style="transform: scale(2)"
            class="close"
            src="../../../assets/img/icon/newicon/close-and-bg.png"
            alt=""
            @click="data.localUserinfo.nickname = ''"
          />
        </div>
        <div class="num">{{ data.localUserinfo.nickname.length }}/20</div>
      </div>
      <div class="l-row" v-if="data.type === 2">
        <div class="notice">{{ $t('profile.myDouyinId') }}</div>
        <div class="input-ctn" style="margin-bottom: 10rem">
          <input type="text" v-model="data.localUserinfo.unique_id" />
          <img
            v-if="data.localUserinfo.unique_id"
            style="transform: scale(2)"
            class="close"
            src="../../../assets/img/icon/newicon/close-and-bg.png"
            alt=""
            @click="data.localUserinfo.unique_id = ''"
          />
        </div>
        <div class="num">{{ $t('profile.douyinIdRule') }}</div>
      </div>
      <div class="l-row" v-if="data.type === 3">
        <div class="notice">{{ $t('profile.myBio') }}</div>
        <div class="textarea-ctn">
          <textarea
            name=""
            id=""
            cols="30"
            rows="10"
            v-model="data.localUserinfo.signature"
            :placeholder="$t('profile.bioPlaceholder')"
          ></textarea>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
//TODO 1、数据变了后，保存按钮变亮；2、数据变了，点返回，弹窗是否确认

import { useBaseStore } from '@/store/pinia'
import { updateProfile } from '@/api/profile'
import { _hideLoading, _notice, _showLoading, _showSimpleConfirmDialog, cloneDeep } from '@/utils'
import { computed, onMounted, reactive } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'

defineOptions({
  name: 'EditUserInfo'
})
const store = useBaseStore()
const router = useRouter()
const route = useRoute()
const { t } = useI18n()
const data = reactive({
  type: 1,
  localUserinfo: {
    nickname: '',
    signature: '',
    unique_id: '',
    desc: ''
  }
})
const isChanged = computed(() => {
  switch (data.type) {
    case 1:
      return (
        !!data.localUserinfo.nickname &&
        data.localUserinfo.nickname !== (store.userinfo.nickname || '')
      )
    case 2:
      return (
        !!data.localUserinfo.unique_id &&
        data.localUserinfo.unique_id !== (store.userinfo.unique_id || '')
      )
    case 3:
      return data.localUserinfo.signature !== (store.userinfo.signature || '')
    default:
      return false
  }
})

onMounted(() => {
  data.localUserinfo = cloneDeep(store.userinfo)
  data.type = Number(route.query.type)
})

function back() {
  if (isChanged.value) {
    _showSimpleConfirmDialog(t('profile.saveConfirm'), save, router.back)
  } else {
    router.back()
  }
}

async function save() {
  if (!isChanged.value) return
  if (data.type === 1) {
    if (!data.localUserinfo.nickname) return _notice(t('profile.nameRequired'))
  }
  _showLoading()
  try {
    let payload: Record<string, any> = {}
    switch (data.type) {
      case 1:
        payload.nickname = data.localUserinfo.nickname
        break
      case 2:
        payload.username = data.localUserinfo.unique_id
        break
      case 3:
        payload.bio = data.localUserinfo.signature
        break
    }
    const profile = await updateProfile(payload)
    store.applyProfile(profile)
  } catch (error) {
    console.error('保存资料失败：', error)
    _notice(t('profile.saveFailed'))
    _hideLoading()
    return
  }
  _hideLoading()
  router.back()
  if (data.type === 3) return _notice(t('profile.saveSuccess'))
}
</script>

<style scoped lang="less">
@import '../../../assets/less/index';

.edit-item {
  position: fixed;
  left: 0;
  right: 0;
  bottom: 0;
  top: 0;

  .save-yes {
    color: var(--primary-btn-color);
  }

  .save-no {
    color: var(--disable-primary-btn-color);
  }

  .content {
    padding: 20rem;
    padding-top: 70rem;

    .notice,
    .num {
      font-size: 12rem;
      color: var(--second-text-color);
    }

    .input-ctn {
      position: relative;
      border-bottom: 1px solid var(--line-color);
      display: flex;
      align-items: center;

      input {
        margin: 5rem 0;
        color: white;
        height: 30rem;
        width: 100%;
        outline: none;
        border: none;
        background: transparent;

        &::placeholder {
          color: var(--second-text-color);
        }
      }

      .close {
        position: absolute;
        right: 0;
        top: 15rem;
        width: 10rem;
      }
    }

    .textarea-ctn {
      width: 100%;
      background: var(--active-main-bg);
      padding: 15rem;
      box-sizing: border-box;
      margin-top: 10rem;
      border-radius: 2px;

      textarea {
        font-family: 'Microsoft YaHei UI';
        outline: none;
        width: 100%;
        border: none;
        background: transparent;
        color: white;

        &::placeholder {
          color: var(--second-text-color);
        }
      }
    }
  }
}
</style>
