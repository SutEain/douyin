<template>
  <div class="vap-container" v-show="playing">
    <canvas ref="canvasRef"></canvas>
    <video
      ref="videoRef"
      :src="src"
      muted
      playsinline
      webkit-playsinline
      crossorigin="anonymous"
      preload="none"
      style="display: none"
      @ended="onEnded"
      @canplay="onCanPlay"
    ></video>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue'

const props = defineProps({
  src: String,
  videoRatio: { type: Number, default: 0.5 }, // 🎯 外部传入比例：0.5 或 0.6666
  outputWidth: { type: Number, default: 360 },
  outputHeight: { type: Number, default: 720 }
})

const emit = defineEmits(['ended'])

const videoRef = ref<HTMLVideoElement | null>(null)
const canvasRef = ref<HTMLCanvasElement | null>(null)
const playing = ref(false)

let gl: WebGLRenderingContext | null = null
let program: WebGLProgram | null = null
let texture: WebGLTexture | null = null
let rafId: number | null = null

// 顶点着色器
const vs = `
  attribute vec2 a_position;
  attribute vec2 a_texCoord;
  varying vec2 v_texCoord;
  void main() {
    gl_Position = vec4(a_position, 0, 1);
    v_texCoord = a_texCoord;
  }
`

// 片段着色器：核心透明度合成逻辑
const fs = `
  precision mediump float;
  uniform sampler2D u_image;
  uniform float u_ratio; // 🎯 动态比例：0.5 或 0.666
  varying vec2 v_texCoord;
  void main() {
    // 1. 映射彩色区域坐标
    vec2 rgbCoord = vec2(v_texCoord.x * u_ratio, v_texCoord.y);
    
    // 2. 映射遮罩区域坐标
    // 起始点偏移 u_ratio，宽度缩放比例为 (1.0 - u_ratio)
    vec2 alphaCoord = vec2(u_ratio + v_texCoord.x * (1.0 - u_ratio), v_texCoord.y);
    
    vec4 color = texture2D(u_image, rgbCoord);
    vec4 mask = texture2D(u_image, alphaCoord);
    
    // 使用遮罩的 R 通道作为 Alpha
    gl_FragColor = vec4(color.rgb, mask.r);
  }
`

const initGL = () => {
  const canvas = canvasRef.value!
  // 提高清晰度
  canvas.width = canvas.clientWidth * window.devicePixelRatio || 720
  canvas.height = canvas.clientHeight * window.devicePixelRatio || 1280

  gl = canvas.getContext('webgl', {
    alpha: true,
    premultipliedAlpha: false,
    antialias: true
  })
  if (!gl) return

  const createShader = (gl: WebGLRenderingContext, type: number, source: string) => {
    const shader = gl.createShader(type)!
    gl.shaderSource(shader, source)
    gl.compileShader(shader)
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      console.error(gl.getShaderInfoLog(shader))
    }
    return shader
  }

  program = gl.createProgram()!
  gl.attachShader(program, createShader(gl, gl.VERTEX_SHADER, vs))
  gl.attachShader(program, createShader(gl, gl.FRAGMENT_SHADER, fs))
  gl.linkProgram(program)
  gl.useProgram(program)

  const positionBuffer = gl.createBuffer()
  gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer)
  gl.bufferData(
    gl.ARRAY_BUFFER,
    new Float32Array([-1, -1, 0, 1, 1, -1, 1, 1, -1, 1, 0, 0, 1, 1, 1, 0]),
    gl.STATIC_DRAW
  )

  // 设置视口，确保渲染区域正确
  gl.viewport(0, 0, canvas.width, canvas.height)

  const stride = 4 * 4
  const a_position = gl.getAttribLocation(program, 'a_position')
  gl.enableVertexAttribArray(a_position)
  gl.vertexAttribPointer(a_position, 2, gl.FLOAT, false, stride, 0)

  const a_texCoord = gl.getAttribLocation(program, 'a_texCoord')
  gl.enableVertexAttribArray(a_texCoord)
  gl.vertexAttribPointer(a_texCoord, 2, gl.FLOAT, false, stride, 2 * 4)

  texture = gl.createTexture()
  gl.bindTexture(gl.TEXTURE_2D, texture)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
}

const render = () => {
  if (!playing.value || !gl || !videoRef.value || !program) return

  const video = videoRef.value

  // 🎯 核心修复：检查视频就绪状态
  // 如果视频还没准备好当前帧数据，或者由于 CORS 失败导致无数据，则跳过本次渲染，防止 WebGL INVALID_VALUE 报错
  if (video.readyState < 2 || video.videoWidth === 0 || video.paused || video.ended) {
    if (playing.value) {
      rafId = requestAnimationFrame(render)
    }
    return
  }

  gl.clearColor(0, 0, 0, 0)
  gl.clear(gl.COLOR_BUFFER_BIT)

  // 🎯 使用外部传入的比例，不再自动计算
  const ratio = props.videoRatio

  const u_ratio = gl.getUniformLocation(program, 'u_ratio')
  gl.uniform1f(u_ratio, ratio)

  gl.bindTexture(gl.TEXTURE_2D, texture)
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, video)
  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)

  rafId = requestAnimationFrame(render)
}

const onCanPlay = () => {
  console.log('[VapPlayer] Video can play:', props.src)
}

const startPlaying = () => {
  const video = videoRef.value
  if (!video) return

  playing.value = true
  video
    .play()
    .then(() => {
      console.log('[VapPlayer] Play started success')
      render()
    })
    .catch((err) => {
      console.error('[VapPlayer] Play failed:', err)
    })
}

const onEnded = () => {
  console.log('[VapPlayer] Play ended')
  playing.value = false
  if (rafId) cancelAnimationFrame(rafId)
  emit('ended')
}

const play = () => {
  const video = videoRef.value
  if (video) {
    console.log('[VapPlayer] Request play:', props.src)
    video.currentTime = 0
    video.load() // 🎯 强制重新加载资源
    startPlaying()
  }
}

defineExpose({ play })

onMounted(() => {
  initGL()
})

onUnmounted(() => {
  if (rafId) cancelAnimationFrame(rafId)
})
</script>

<style scoped>
.vap-container {
  position: fixed;
  top: 0;
  left: 0;
  width: 100vw;
  height: 100vh;
  pointer-events: none;
  z-index: 9999;
  display: flex;
  align-items: center;
  justify-content: center;
}
canvas {
  width: 100%;
  height: 100%;
  object-fit: contain;
}
</style>
