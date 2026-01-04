const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

// --- 1. 初始化 Supabase 客户端 ---
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY
);

// --- 2. 辅助函数 (严格同步自 Admin/App-Server 探测逻辑) ---

async function fetchWithTimeout(url, init, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal, redirect: 'follow' });
  } finally {
    clearTimeout(timer);
  }
}

async function fetchFirstBytes(url, init, timeoutMs, maxBytes) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...init, signal: controller.signal, redirect: 'follow' });
    const reader = res.body?.getReader?.();
    if (!reader) return { res, bytes: new Uint8Array() };

    const chunks = [];
    let total = 0;
    while (total < maxBytes) {
      const { value, done } = await reader.read();
      if (done) break;
      if (value && value.length) {
        chunks.push(value);
        total += value.length;
      }
    }

    try { await reader.cancel(); } catch { /* noop */ }
    try { controller.abort(); } catch { /* noop */ }

    const out = new Uint8Array(Math.min(total, maxBytes));
    let offset = 0;
    for (const c of chunks) {
      const len = Math.min(c.length, out.length - offset);
      if (len <= 0) break;
      out.set(c.subarray(0, len), offset);
      offset += len;
    }
    return { res, bytes: out };
  } finally {
    clearTimeout(timer);
  }
}

function sniffBytes(buf) {
  if (!buf || buf.length === 0) return { kind: 'unknown', detail: 'empty' };
  if (buf.length >= 3 && buf[0] === 0x46 && buf[1] === 0x4c && buf[2] === 0x56) {
    return { kind: 'flv', detail: 'magic=FLV' };
  }
  if (buf.length >= 7) {
    const head = new TextDecoder().decode(buf.subarray(0, Math.min(buf.length, 512)));
    if (head.includes('#EXTM3U')) return { kind: 'm3u8', detail: 'head=#EXTM3U' };
  }
  if (buf.length >= 8 && buf[4] === 0x66 && buf[5] === 0x74 && buf[6] === 0x79 && buf[7] === 0x70) {
    return { kind: 'mp4', detail: 'box=ftyp' };
  }
  return { kind: 'unknown', detail: 'no_magic' };
}

function classifyM3U8Text(text) {
  const t = (text || '').trim();
  const lower = t.toLowerCase();
  if (t.includes('#EXT-X-ENDLIST')) return { ok: false, reason: 'vod:endlist' };
  if (lower.includes('#ext-x-playlist-type:vod')) return { ok: false, reason: 'vod:playlist_type' };
  if (lower.includes('cdn.jsdelivr.net/gh/feiyang666999/testvideo'))
    return { ok: false, reason: 'placeholder:testvideo' };
  if (lower.includes('/playad') || lower.includes('playad'))
    return { ok: false, reason: 'placeholder:playad' };
  return { ok: true, reason: 'live:m3u8' };
}

async function probeUrl(url) {
  try {
    const { res, bytes } = await fetchFirstBytes(
      url,
      { method: 'GET', headers: { Accept: '*/*', 'User-Agent': 'Mozilla/5.0 (probe)' } },
      8000, 
      4096  
    );
    const ct = (res.headers.get('content-type') || '').toLowerCase();
    if (res.status < 200 || res.status >= 400) return { ok: false, msg: `http_${res.status}` };

    const sniff = sniffBytes(bytes);
    if (sniff.kind === 'flv') return { ok: true, msg: 'ok:flv(sniff)', kind: 'flv' };
    if (sniff.kind === 'm3u8') {
      const text = new TextDecoder().decode(bytes.subarray(0, 4096));
      const classified = classifyM3U8Text(text);
      return { ok: classified.ok, msg: classified.reason, kind: 'm3u8' };
    }
    if (sniff.kind === 'mp4') return { ok: false, msg: 'offline:mp4(sniff)', kind: 'mp4' };

    // 兜底 Content-Type
    if (ct.includes('video/x-flv') || ct.includes('application/x-flv')) return { ok: true, msg: 'ok:flv(ct)' };
    if (ct.includes('mpegurl')) return { ok: true, msg: 'ok:m3u8(ct)' };
    
    return { ok: false, msg: `offline:unknown(${sniff.detail})` };
  } catch (e) {
    return { ok: false, msg: e.message };
  }
}

// --- 3. 主逻辑 ---

async function probeLiveRooms() {
  console.log(`\n🔄 [${new Date().toLocaleString()}] 开始巡检直播间...`);
  try {
    const { data: rooms, error } = await supabase.from('live_rooms').select('*');
    if (error) throw error;

    for (const room of rooms) {
      if (!room.stream_url) continue;
      
      const probed = await probeUrl(room.stream_url);
      const newStatus = probed.ok ? 'online' : 'offline';
      const newIsActive = probed.ok;

      console.log(`检测 [${room.id}]: ${newStatus} (${probed.msg})`);

      await supabase.from('live_rooms').update({
        status: newStatus,
        is_active: newIsActive,
        last_checked_at: new Date().toISOString(),
        last_error: probed.ok ? null : probed.msg
      }).eq('id', room.id);
    }
  } catch (err) {
    console.error('😱 巡检崩溃:', err.message);
  }
}

// 每小时运行
async function startLoop() {
  while (true) {
    await probeLiveRooms();
    await new Promise(r => setTimeout(r, 60 * 60 * 1000));
  }
}

startLoop().catch(console.error);
