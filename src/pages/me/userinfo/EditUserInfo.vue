<template>
  <div class="edit">
    <BaseHeader>
      <template v-slot:center>
        <span class="f16">{{ $t('profile.editProfile') }}</span>
      </template>
    </BaseHeader>
    <div class="userinfo">
      <div class="change-avatar">
        <div class="avatar-ctn" @click="viewAvatarOnly">
          <img class="avatar" :src="_checkImgUrl(store.userinfo.avatar_300x300.url_list[0])" alt="" />
        </div>
        <span>{{ $t('profile.avatar') }}</span>
      </div>
      <div class="row" @click="nav('/me/edit-userinfo-item', { type: 1 })">
        <div class="left">{{ $t('profile.name') }}</div>
        <div class="right">
          <span>{{ isEmpty(store.userinfo.nickname) }}</span>
          <dy-back scale=".8" direction="right"></dy-back>
        </div>
      </div>
      <div class="row" @click="nav('/me/edit-userinfo-item', { type: 2 })">
        <div class="left">{{ $t('profile.douyinId') }}</div>
        <div class="right">
          <span>{{ isEmpty(_getUserDouyinId({ author: store.userinfo })) }}</span>
          <dy-back scale=".8" direction="right"></dy-back>
        </div>
      </div>
      <div class="row" @click="nav('/me/edit-userinfo-item', { type: 3 })">
        <div class="left">{{ $t('profile.bio') }}</div>
        <div class="right">
          <span>{{ isEmpty(store.userinfo.signature) }}</span>
          <dy-back scale=".8" direction="right"></dy-back>
        </div>
      </div>
      <div class="row" @click="showSexDialog">
        <div class="left">{{ $t('profile.gender') }}</div>
        <div class="right">
          <span>{{ sex }}</span>
          <dy-back scale=".8" direction="right"></dy-back>
        </div>
      </div>
      <div class="row" @click="showBirthdayDialog">
        <div class="left">{{ $t('profile.birthday') }}</div>
        <div class="right">
          <span>{{ isEmpty(store.userinfo.user_age) }}</span>
          <div v-show="false" id="trigger1"></div>
          <dy-back scale=".8" direction="right"></dy-back>
        </div>
      </div>
      <div class="row" @click="nav('/me/choose-location')">
        <div class="left">{{ $t('profile.location') }}</div>
        <div class="right">
          <span>{{ isEmpty(store.userinfo.country) }}</span>
          <dy-back scale=".8" direction="right"></dy-back>
        </div>
      </div>
    </div>
    <transition name="fade">
      <div class="preview-img" v-if="data.previewImg" @click="data.previewImg = ''">
        <img class="resource" :src="data.previewImg" alt="" />
        <img
          class="download"
          src="../../../assets/img/icon/components/video/download.png"
          alt=""
          @click.stop="_no"
        />
      </div>
    </transition>
  </div>
</template>

<script setup lang="ts">
import MobileSelect from '../../../components/mobile-select/mobile-select'
import { useBaseStore } from '@/store/pinia'
import {
  _checkImgUrl,
  _getUserDouyinId,
  _hideLoading,
  _no,
  _showLoading,
  _showSelectDialog,
  _sleep
} from '@/utils'
import { computed, reactive } from 'vue'
import { useNav } from '@/utils/hooks/useNav'
import { useI18n } from 'vue-i18n'

defineOptions({
  name: 'EditUserInfo'
})
const store = useBaseStore()
const nav = useNav()
const { t } = useI18n()
const data = reactive({
  previewImg: ''
})

const sexList = computed(() => [
  { id: 1, name: t('profile.male') },
  { id: 2, name: t('profile.female') },
  { id: 3, name: t('profile.notShow') }
])

const sex = computed(() => {
  switch (Number(store.userinfo.gender)) {
    case 1:
      return t('profile.male')
    case 2:
      return t('profile.female')
    default:
      return ''
  }
})

function isEmpty(val) {
  if (val && val !== -1) return val
  return t('profile.clickToSet')
}

function showSexDialog() {
  _showSelectDialog(sexList.value, async (e) => {
    _showLoading()
    await store.updateProfileFields({ gender: e.id })
    _hideLoading()
  })
}

function viewAvatarOnly() {
  // 只查看头像，不能更换（使用 TG 头像）
        data.previewImg = _checkImgUrl(store.userinfo.avatar_300x300.url_list[0])
}

function showBirthdayDialog() {
  new MobileSelect({
    trigger: '#trigger1',
    title: t('profile.birthday'),
    connector: t('profile.birthday'),
    wheels: [
      {
        data: Array.apply(null, { length: 100 }).map((v, i) => new Date().getFullYear() - i)
      },
      {
        data: Array.apply(null, { length: 12 }).map((v, i) => 12 - i)
      },
      {
        data: Array.apply(null, { length: 31 }).map((v, i) => 31 - i)
      }
    ],
    callback: async (indexArr, pickerData) => {
      _showLoading()
      await store.updateProfileFields({
        birthday: pickerData.join('-')
      })
      _hideLoading()
    }
  }).show()
}
</script>

<style scoped lang="less">
@import '../../../assets/less/index';

.edit {
  position: fixed;
  left: 0;
  right: 0;
  bottom: 0;
  top: 0;
  overflow: auto;
  font-size: 14rem;
}


.preview-img {
  z-index: 9;
  position: fixed;
  left: 0;
  right: 0;
  bottom: 0;
  top: 0;
  background: black;
  display: flex;
  align-items: center;
  justify-content: center;

  .resource {
    width: 100%;
    max-height: %;
  }

  .download {
    position: absolute;
    bottom: 20rem;
    right: 20rem;
    padding: 3rem;
    background: var(--second-btn-color-tran);
    width: 20rem;
  }
}

.userinfo {
  padding-top: 60rem;
  color: white;

  .change-avatar {
    display: flex;
    justify-content: center;
    align-items: center;
    flex-direction: column;
    margin: 30rem 0;
    @avatar-width: 80rem;

    .avatar-ctn {
      position: relative;
      display: flex;
      justify-content: center;
      align-items: center;
      margin-bottom: 10rem;
      cursor: pointer;

      width: @avatar-width;
      height: @avatar-width;

      .avatar {
        width: @avatar-width;
        height: @avatar-width;
        border-radius: 50%;
        object-fit: cover;
      }
    }
  }
}

.change-dialog {
  z-index: 10;
  position: absolute;
  top: 0;
  bottom: 0;
  left: 0;
  right: 0;
  background: #000000bb;
  display: flex;
  justify-content: center;
  align-items: center;

  .content {
    background: white;
    width: 80%;
    padding: 5rem 0;
    border-radius: 2px;
    box-sizing: border-box;

    .item {
      font-size: 15rem;
      padding: 15rem 20rem;
      transition: all 0.2s;

      &:active {
        background: darkgray;
      }
    }
  }
}
</style>
