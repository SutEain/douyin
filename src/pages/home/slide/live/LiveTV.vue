<template>
  <div class="live-tv">
    <div class="player">
      <DPPlayer :src="currentSrc" :muted="true" :controls="true" />
    </div>

    <div class="programs" :class="{ collapsed: state.collapsed }">
      <div class="programs-header" @click="toggleCollapsed">
        <div class="left">
          <div class="title">节目列表</div>
          <div class="current" v-if="state.current">正在播放：{{ state.current.name }}</div>
        </div>
        <div class="right">{{ state.collapsed ? '展开' : '收起' }}</div>
      </div>

      <div class="programs-body" v-if="!state.collapsed">
        <div v-if="state.error" class="error">{{ state.error }}</div>

        <div v-else class="list">
          <div
            v-for="item in state.channels"
            :key="item.id"
            class="row"
            :class="{ active: state.current?.id === item.id }"
            @click="play(item)"
          >
            <div class="name">{{ item.name }}</div>
            <div class="tag" v-if="state.current?.id === item.id">播放中</div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, reactive } from 'vue'
import DPPlayer from '@/components/live/DPPlayer.vue'

type Channel = { name: string; id: string }

// Supabase Edge Function：/functions/v1/migu720p?id=xxxxxx
const FUNCTION_URL = (() => {
  const explicit = String(import.meta.env.VITE_LIVE_MIGU_FUNCTION_URL || '').trim()
  if (explicit) return explicit.replace(/\/$/, '')
  const supabaseUrl = String(import.meta.env.VITE_SUPABASE_URL || '').trim()
  if (!supabaseUrl) return ''
  return `${supabaseUrl.replace(/\/$/, '')}/functions/v1/migu720p`
})()

// 节目单写死（只保留 id）
const CHANNELS: Channel[] = [
  { name: 'CCTV1综合', id: '608807420' },
  { name: 'CCTV2财经', id: '631780532' },
  { name: 'CCTV3综艺', id: '624878271' },
  { name: 'CCTV4中文国际', id: '631780421' },
  { name: 'CCTV5体育', id: '641886683' },
  { name: 'CCTV5+体育赛事', id: '641886773' },
  { name: 'CCTV6电影', id: '624878396' },
  { name: 'CCTV7国防军事', id: '673168121' },
  { name: 'CCTV8电视剧', id: '624878356' },
  { name: 'CCTV9纪录', id: '673168140' },
  { name: 'CCTV10科教', id: '624878405' },
  { name: 'CCTV11戏曲', id: '667987558' },
  { name: 'CCTV12社会与法', id: '673168185' },
  { name: 'CCTV13新闻', id: '608807423' },
  { name: 'CCTV14少儿', id: '624878440' },
  { name: 'CCTV15音乐', id: '673168223' },
  { name: 'CCTV17农业农村', id: '673168256' },
  { name: 'CCTV4欧洲', id: '608807419' },
  { name: 'CCTV4美洲', id: '608807416' },
  { name: 'CGTN外语纪录', id: '609006487' },
  { name: 'CGTN阿拉伯语', id: '609154345' },
  { name: 'CGTN西班牙语', id: '609006450' },
  { name: 'CGTN法语', id: '609006476' },
  { name: 'CGTN俄语', id: '609006446' },
  { name: '老故事', id: '884121956' },
  { name: '中学生', id: '708869532' },
  { name: 'CGTN', id: '609017205' },
  { name: '东方卫视', id: '651632648' },
  { name: '江苏卫视', id: '623899368' },
  { name: '广东卫视', id: '608831231' },
  { name: '江西卫视', id: '783847495' },
  { name: '河南卫视', id: '790187291' },
  { name: '陕西卫视', id: '738910838' },
  { name: '大湾区卫视', id: '608917627' },
  { name: '湖北卫视', id: '947472496' },
  { name: '吉林卫视', id: '947472500' },
  { name: '青海卫视', id: '947472506' },
  { name: '东南卫视', id: '849116810' },
  { name: '海南卫视', id: '947472502' },
  { name: '海峡卫视', id: '849119120' },
  { name: '中国农林卫视', id: '956904896' },
  { name: '兵团卫视', id: '956923145' },
  { name: '辽宁卫视', id: '630291707' },
  { name: '上海新闻综合', id: '651632657' },
  { name: '上视东方影视', id: '617290047' },
  { name: '南京新闻综合频道', id: '838109047' },
  { name: '南京教科频道', id: '838153729' },
  { name: '南京十八频道', id: '838151753' },
  { name: '江苏城市频道', id: '626064714' },
  { name: '江苏国际', id: '626064674' },
  { name: '江苏教育', id: '628008321' },
  { name: '江苏影视频道', id: '626064697' },
  { name: '江苏综艺频道', id: '626065193' },
  { name: '公共新闻频道', id: '626064693' },
  { name: '盐城新闻综合', id: '639731825' },
  { name: '淮安新闻综合', id: '639731826' },
  { name: '泰州新闻综合', id: '639731818' },
  { name: '连云港新闻综合', id: '639731715' },
  { name: '宿迁新闻综合', id: '639731832' },
  { name: '徐州新闻综合', id: '639731747' },
  { name: '优漫卡通频道', id: '626064703' },
  { name: '江阴新闻综合', id: '955227979' },
  { name: '南通新闻综合', id: '955227985' },
  { name: '宜兴新闻综合', id: '955227996' },
  { name: '溧水新闻综合', id: '639737327' },
  { name: '陕西银龄频道', id: '956909362' },
  { name: '陕西都市青春频道', id: '956909358' },
  { name: '陕西体育休闲频道', id: '956909356' },
  { name: '陕西秦腔频道', id: '956909303' },
  { name: '陕西新闻资讯频道', id: '956909289' },
  { name: '财富天下', id: '956923159' },
  { name: '经典香港电影', id: '625703337' },
  { name: '抗战经典影片', id: '617432318' },
  { name: '新片放映厅', id: '619495952' },
  { name: 'CHC影迷电影', id: '952383261' },
  { name: '和美乡途轮播台', id: '713591450' },
  { name: '高清大片', id: '629943678' },
  { name: '南方影视', id: '614961829' },
  { name: '血色山河·抗日战争影像志', id: '713600957' },
  { name: '熊猫频道01高清', id: '609158151' },
  { name: '熊猫频道1', id: '608933610' },
  { name: '熊猫频道2', id: '608933640' },
  { name: '熊猫频道3', id: '608934619' },
  { name: '熊猫频道4', id: '608934721' },
  { name: '熊猫频道5', id: '608935104' },
  { name: '熊猫频道6', id: '608935797' },
  { name: '熊猫频道7', id: '609169286' },
  { name: '熊猫频道8', id: '609169287' },
  { name: '熊猫频道9', id: '609169226' },
  { name: '熊猫频道10', id: '609169285' },
  { name: '最强综艺趴', id: '629942228' },
  { name: '嘉佳卡通', id: '614952364' },
  { name: '经典动画大集合', id: '629942219' },
  { name: '新动力量创一流', id: '713589837' },
  { name: '环球旅游', id: '958475356' },
  { name: '钱塘江', id: '647370520' },
  { name: '五环传奇', id: '707671890' },
  { name: '赛事最经典', id: '646596895' },
  { name: '掼蛋精英赛', id: '631354620' },
  { name: '体坛名栏汇', id: '629943305' },
  { name: '四海钓鱼', id: '637444975' },
  { name: '咪咕24小时体育台', id: '654102378' },
  { name: '24小时城市联赛轮播台', id: '915512915' },
  { name: '武术世界', id: '958475359' },
  { name: 'CETV1', id: '923287154' },
  { name: 'CETV2', id: '923287211' },
  { name: 'CETV4', id: '923287339' },
  { name: '山东教育', id: '609154353' }
]

const state = reactive({
  error: '',
  channels: CHANNELS as Channel[],
  current: (CHANNELS[0] ?? null) as Channel | null,
  collapsed: false
})

const currentSrc = computed(() => {
  if (!state.current?.id) return ''
  if (!FUNCTION_URL) return ''
  return `${FUNCTION_URL}?id=${encodeURIComponent(state.current.id)}`
})

function play(item: Channel) {
  state.current = item
}

function toggleCollapsed() {
  state.collapsed = !state.collapsed
}

if (!FUNCTION_URL) {
  state.error =
    '缺少 Supabase 配置：请设置 VITE_SUPABASE_URL 或 VITE_LIVE_MIGU_FUNCTION_URL（用于 /functions/v1/migu720p）'
}
</script>

<style scoped lang="less">
.live-tv {
  width: 100%;
  height: 100%;
  background: #000;
  display: flex;
  flex-direction: column;
}

.player {
  flex: 1 1 auto;
  min-height: 0;
}

.programs {
  flex: 0 0 auto;
  background: rgba(0, 0, 0, 0.92);
  border-top: 1px solid rgba(255, 255, 255, 0.08);
  max-height: 45%;
  overflow: hidden;
}

.programs.collapsed {
  max-height: 52rem;
}

.programs-header {
  height: 52rem;
  padding: 0 15rem;
  display: flex;
  align-items: center;
  justify-content: space-between;
  cursor: pointer;
  user-select: none;
}

.programs-header .left {
  display: flex;
  flex-direction: column;
  gap: 4rem;
  min-width: 0;
}

.programs-header .title {
  font-size: 14rem;
  font-weight: 700;
}

.programs-header .current {
  font-size: 12rem;
  color: rgba(255, 255, 255, 0.65);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 70vw;
}

.programs-header .right {
  font-size: 12rem;
  color: rgba(255, 255, 255, 0.7);
}

.programs-body {
  overflow: auto;
  max-height: calc(45vh - 52rem);
  padding: 0 15rem 12rem 15rem;
}

.loading,
.error {
  padding: 12rem 0;
  font-size: 13rem;
  color: rgba(255, 255, 255, 0.7);
}

.list {
  display: flex;
  flex-direction: column;
}

.row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10rem 0;
  border-bottom: 1px solid rgba(255, 255, 255, 0.06);
  cursor: pointer;
}

.row .name {
  font-size: 14rem;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 70vw;
}

.row .tag {
  font-size: 12rem;
  color: #fff;
  background: rgba(255, 255, 255, 0.16);
  padding: 2rem 8rem;
  border-radius: 999rem;
}

.row.active .name {
  font-weight: 700;
}
</style>
