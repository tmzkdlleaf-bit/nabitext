// 에셋 라이브러리: 이미지·글꼴 파일을 내용 해시(SHA-256 앞 16바이트 = 32자)로 구분한다.
// 같은 파일은 몇 번을 넣어도 하나만 보관한다. 작업 중 모델에는 에셋의 blob: 주소를 쓰고,
// 프로젝트 파일에는 assets/<id>.<확장자>로 바꿔 쓴다(app/project.js).

const EXT = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif', 'image/svg+xml': 'svg', 'image/avif': 'avif',
  'font/ttf': 'ttf', 'font/otf': 'otf', 'font/woff': 'woff', 'font/woff2': 'woff2' };
const MIME = Object.fromEntries(Object.entries(EXT).map(([m, e]) => [e, m]));
MIME.jpeg = 'image/jpeg';

// 파일 앞부분으로 형식 판별(브라우저가 type을 비워 줄 때가 있음)
export function sniff(u8) {
  const s = (i, n) => String.fromCharCode(...u8.subarray(i, i + n));
  if (u8[0] === 0x89 && s(1, 3) === 'PNG') return 'image/png';
  if (u8[0] === 0xff && u8[1] === 0xd8) return 'image/jpeg';
  if (s(0, 4) === 'RIFF' && s(8, 4) === 'WEBP') return 'image/webp';
  if (s(0, 3) === 'GIF') return 'image/gif';
  if (s(4, 8) === 'ftypavif') return 'image/avif';
  if (s(0, 4) === 'wOF2') return 'font/woff2';
  if (s(0, 4) === 'wOFF') return 'font/woff';
  if (s(0, 4) === 'OTTO') return 'font/otf';
  if (u8[0] === 0 && u8[1] === 1 && u8[2] === 0 && u8[3] === 0) return 'font/ttf';
  if (s(0, 4) === 'true' || s(0, 4) === 'ttcf') return 'font/ttf';
  const head = s(0, Math.min(200, u8.length)).trimStart();
  if (head.startsWith('<svg') || (head.startsWith('<?xml') && head.includes('<svg'))) return 'image/svg+xml';
  return '';
}
// 이미지 크기(파일 머리에서). 모르면 null. JPEG는 EXIF 방향을 반영하지 않은 값(가장 긴 변은 같음)
export function imageSize(u8) {
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  const s = (i, n) => String.fromCharCode(...u8.subarray(i, i + n));
  try {
    if (u8[0] === 0x89 && s(1, 3) === 'PNG') return { w: dv.getUint32(16), h: dv.getUint32(20) };
    if (s(0, 3) === 'GIF') return { w: dv.getUint16(6, true), h: dv.getUint16(8, true) };
    if (s(0, 4) === 'RIFF' && s(8, 4) === 'WEBP') {
      const k = s(12, 4);
      if (k === 'VP8X') return { w: 1 + (dv.getUint32(24, true) & 0xffffff), h: 1 + (dv.getUint32(27, true) & 0xffffff) };
      if (k === 'VP8L') { const b = dv.getUint32(21, true); return { w: 1 + (b & 0x3fff), h: 1 + ((b >> 14) & 0x3fff) }; }
      if (k === 'VP8 ') return { w: dv.getUint16(26, true) & 0x3fff, h: dv.getUint16(28, true) & 0x3fff };
    }
    if (u8[0] === 0xff && u8[1] === 0xd8) {
      let i = 2;
      while (i + 9 < u8.length) {
        if (u8[i] !== 0xff) { i++; continue; }
        const m = u8[i + 1];
        if (m === 0xd8 || m === 0x01 || (m >= 0xd0 && m <= 0xd7)) { i += 2; continue; }
        if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) return { w: dv.getUint16(i + 7), h: dv.getUint16(i + 5) };
        i += 2 + dv.getUint16(i + 2);
      }
    }
  } catch { /* 잘린 파일 */ }
  return null;
}

// 화면용 축소본: 가장 긴 변이 이보다 큰 사진은 이 크기로 줄인 사본을 화면에 쓴다(출력·저장은 원본)
export const PROXY_MAX = 2560;
// 장 목록 미리보기용 사본의 가장 긴 변
export const TINY_MAX = 256;
const PROXY_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp']);

export const extOf = (type) => EXT[type] || 'bin';
export const mimeOfExt = (ext) => MIME[String(ext).toLowerCase()] || 'application/octet-stream';

export async function hashId(buf) {
  const d = new Uint8Array(await crypto.subtle.digest('SHA-256', buf));
  return [...d.subarray(0, 16)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export class AssetStore {
  // proxies: 큰 사진의 화면용 축소본을 만들지(잠깐 쓰고 버리는 임시 저장소는 false)
  constructor({ proxies = true } = {}) {
    this.proxies = proxies;
    this.byId = new Map();  // id → { id, blob, type, name, url, size }
    this.byUrl = new Map(); // blob: 주소 → 같은 항목
  }

  // Blob/File/ArrayBuffer → 에셋(이미 있으면 기존 것). id를 알고 있으면(프로젝트 열기) 검증한다.
  async add(data, { name = '', type = '', expectId = null } = {}) {
    const buf = data instanceof ArrayBuffer ? data : ArrayBuffer.isView(data) ? data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) : await data.arrayBuffer();
    const id = await hashId(buf);
    if (expectId && expectId !== id) throw new Error(`에셋 내용이 이름과 맞지 않습니다: ${expectId}`);
    let a = this.byId.get(id);
    if (a) return a;
    const t = sniff(new Uint8Array(buf, 0, Math.min(256, buf.byteLength))) || type || data.type || '';
    const blob = new Blob([buf], { type: t });
    a = { id, blob, type: t, name: name || data.name || '', url: URL.createObjectURL(blob), size: buf.byteLength };
    // 큰 사진: 축소본을 뒤에서 만든다(하나씩 차례로 — 큰 사진 여러 장을 한꺼번에 풀어 메모리가 튀지 않게)
    const dim = this.proxies && PROXY_TYPES.has(t) ? imageSize(new Uint8Array(buf)) : null;
    if (dim && Math.max(dim.w, dim.h) > PROXY_MAX) {
      a.proxy = null;
      a.ready = this.queue = (this.queue || Promise.resolve()).then(() => this.makeProxy(a));
    }
    this.byId.set(id, a);
    this.byUrl.set(a.url, a);
    return a;
  }

  // 축소본 만들기: 디코딩·축소는 브라우저가 메인 스레드 밖에서 한다(createImageBitmap)
  async makeProxy(a) {
    if (!this.byId.has(a.id)) return a; // 그사이 비움
    let bmp = null, small = null;
    try {
      bmp = await createImageBitmap(a.blob); // EXIF 방향 반영
      a.w = bmp.width; a.h = bmp.height;
      const k = PROXY_MAX / Math.max(bmp.width, bmp.height);
      if (k >= 1) { a.proxy = false; return a; }
      const w = Math.max(1, Math.round(bmp.width * k)), h = Math.max(1, Math.round(bmp.height * k));
      small = await createImageBitmap(bmp, { resizeWidth: w, resizeHeight: h, resizeQuality: 'high' });
      bmp.close(); bmp = null;
      const c = new OffscreenCanvas(w, h);
      c.getContext('2d').drawImage(small, 0, 0);
      const blob = await c.convertToBlob({ type: a.type === 'image/jpeg' ? 'image/jpeg' : 'image/webp', quality: 0.92 });
      if (!this.byId.has(a.id)) return a;
      a.proxy = { url: URL.createObjectURL(blob), blob, w, h };
    } catch {
      a.proxy = false; // 못 줄이면 원본을 그대로 쓴다
    } finally {
      bmp?.close(); small?.close();
    }
    this.onProxy?.(a);
    return a;
  }

  // 화면에 쓸 주소: 축소본이 있으면 축소본, 만드는 중이면 null(부르는 쪽이 빈 그림을 쓴다), 필요 없으면 원본
  displayUrl(url) {
    const a = this.byUrl.get(url);
    if (!a || a.proxy === undefined || a.proxy === false) return url;
    return a.proxy ? a.proxy.url : null;
  }
  // 장 목록 미리보기용 아주 작은 사본(가장 긴 변 TINY_MAX). 처음 부르면 만들기 시작하고 null, 다 되면 onTiny
  tinyUrl(url) {
    const a = this.byUrl.get(url);
    if (!a) return url; // 에셋이 아닌 주소(data: 등)는 그대로
    if (a.tiny) return a.tiny.url;
    if (a.tiny === false) return a.url; // 줄일 수 없는 형식(SVG 등)은 원본
    if (!a.tinyJob) a.tinyJob = this.queue = (this.queue || Promise.resolve()).then(() => this.makeTiny(a));
    return null;
  }
  async makeTiny(a) {
    if (!this.byId.has(a.id)) return;
    if (a.ready) await a.ready; // 큰 사진은 축소본에서 줄인다(원본을 다시 풀지 않게)
    let bmp = null;
    try {
      if (!/^image\/(png|jpeg|webp|gif|avif)$/.test(a.type)) { a.tiny = false; return; }
      const src = a.proxy ? a.proxy.blob : a.blob;
      const full = await createImageBitmap(src);
      const k = Math.min(1, TINY_MAX / Math.max(full.width, full.height));
      bmp = k < 1 ? await createImageBitmap(full, { resizeWidth: Math.max(1, Math.round(full.width * k)), resizeHeight: Math.max(1, Math.round(full.height * k)), resizeQuality: 'medium' }) : full;
      if (bmp !== full) full.close();
      const c = new OffscreenCanvas(bmp.width, bmp.height);
      c.getContext('2d').drawImage(bmp, 0, 0);
      const blob = await c.convertToBlob({ type: 'image/webp', quality: 0.8 });
      if (!this.byId.has(a.id)) return;
      a.tiny = { url: URL.createObjectURL(blob), blob };
    } catch { a.tiny = false; } finally { bmp?.close(); }
    this.onTiny?.(a);
  }
  ready(url) { return this.byUrl.get(url)?.ready || Promise.resolve(); }
  // 원본 크기(축소본을 만들며 알게 된 것. 작은 사진은 null → 부르는 쪽이 직접 잰다)
  dims(url) { const a = this.byUrl.get(url); return a && a.w ? { w: a.w, h: a.h } : null; }

  get(id) { return this.byId.get(id) || null; }
  ofUrl(url) { return this.byUrl.get(url) || null; }

  // 모델에 들어 있는 임의의 src(blob:, data:, http(s):, 같은 출처 경로) → 에셋 주소.
  // 이미 에셋이면 그대로. 가져오지 못하면(끊긴 주소·CORS) null.
  async importSrc(src) {
    if (!src) return null;
    const have = this.byUrl.get(src);
    if (have) return have;
    try {
      const r = await fetch(src);
      if (!r.ok) return null;
      return await this.add(await r.blob());
    } catch { return null; }
  }

  // 하나 빼기(주소도 무효)
  remove(id) {
    const a = this.byId.get(id);
    if (!a) return;
    URL.revokeObjectURL(a.url);
    if (a.proxy) URL.revokeObjectURL(a.proxy.url);
    if (a.tiny) URL.revokeObjectURL(a.tiny.url);
    this.byId.delete(id);
    this.byUrl.delete(a.url);
  }
  // 바꿔 끼우기용: 이 저장소에 더하면서 더한(또는 이미 있던) id를 기록하는 얇은 창구
  tracker() {
    const used = new Set();
    return { used, add: async (data, opts) => { const a = await this.add(data, opts); used.add(a.id); return a; }, get: (id) => this.get(id) };
  }

  // 모두 비우기(새 프로젝트·다른 프로젝트 열기). 편집기 화면이 쓰던 주소도 무효가 된다.
  clear() {
    for (const a of this.byId.values()) { URL.revokeObjectURL(a.url); if (a.proxy) URL.revokeObjectURL(a.proxy.url); if (a.tiny) URL.revokeObjectURL(a.tiny.url); }
    this.byId.clear();
    this.byUrl.clear();
  }
}
