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

// 片段着色器：升级为全自动映射逻辑
const fs = `
  precision mediump float;
  uniform sampler2D u_image;
  uniform float u_hRatio;  // 水平彩色区域比例
  uniform float u_vRatio;  // 垂直遮罩缩放 (对应模式1的 0.5)
  uniform float u_vOffset; // 垂直遮罩偏移 (对应模式1的 0.5)
  varying vec2 v_texCoord;
  void main() {
    // 1. 映射彩色区域坐标 (左侧)
    vec2 rgbCoord = vec2(v_texCoord.x * u_hRatio, v_texCoord.y);
    
    // 2. 映射遮罩区域坐标 (右侧)
    // 水平方向：从 u_hRatio 开始映射到 1.0 之间的区域
    // 垂直方向：根据模式自动映射到对应的遮罩块
    vec2 alphaCoord = vec2(
      u_hRatio + v_texCoord.x * (1.0 - u_hRatio), 
      u_vOffset + v_texCoord.y * u_vRatio
    );
    
    vec4 color = texture2D(u_image, rgbCoord);
    vec4 mask = texture2D(u_image, alphaCoord);
    
    // 使用遮罩的 R 通道作为 Alpha
    gl_FragColor = vec4(color.rgb, mask.r);
  }
`

const initGL = () => {
  const canvas = canvasRef.value!
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

  if (video.readyState < 2 || video.videoWidth === 0 || video.paused || video.ended) {
    if (playing.value) {
      rafId = requestAnimationFrame(render)
    }
    return
  }

  gl.clearColor(0, 0, 0, 0)
  gl.clear(gl.COLOR_BUFFER_BIT)

  // 🎯 核心逻辑：全自动布局识别
  const aspect = video.videoWidth / video.videoHeight
  let hRatio = 0.5
  let vRatio = 1.0
  let vOffset = 0.0

  if (aspect < 0.9) {
    // 模式 1: 1088*1440 (窄版)
    // 左 2/3 彩色，右 1/3 的上半截是遮罩
    hRatio = 0.6666
    vRatio = 0.5
    vOffset = 0.5 // 对应视频的上半部分 (0.5 到 1.0)
  } else {
    // 模式 2: 1456*1440 (宽版)
    // 左右 1/2 对半分
    hRatio = 0.5
    vRatio = 1.0
    vOffset = 0.0
  }

  if (video.currentTime > 0 && video.currentTime < 0.1) {
    console.log(
      `[VapPlayer] Auto Mode Detected - Res: ${video.videoWidth}x${video.videoHeight}, Aspect: ${aspect.toFixed(2)}, hRatio: ${hRatio}, vRatio: ${vRatio}, vOffset: ${vOffset}`
    )
  }

  const u_hRatio = gl.getUniformLocation(program, 'u_hRatio')
  gl.uniform1f(u_hRatio, hRatio)

  const u_vRatio = gl.getUniformLocation(program, 'u_vRatio')
  gl.uniform1f(u_vRatio, vRatio)

  const u_vOffset = gl.getUniformLocation(program, 'u_vOffset')
  gl.uniform1f(u_vOffset, vOffset)

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
    video.load()
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
