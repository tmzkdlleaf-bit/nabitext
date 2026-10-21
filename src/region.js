// 영역(Region): 프레임 크기의 이진 마스크 → 행별 구간(run) → 띠(band) 단위 구간 질의.
// 경로·알파·배경색 세 입력 모두 마스크로 통일한다. 도넛처럼 한 행에 구간이 여러 개인 도형도 같은 경로로 처리된다.

export class Region {
  constructor(w, h, mask) {
    this.w = w;
    this.h = h;
    this.mask = mask; // Uint8Array, 1 = 글을 놓을 수 있는 픽셀
    this.rows = new Array(h);
    for (let y = 0; y < h; y++) {
      const runs = [];
      const o = y * w;
      let x = 0;
      while (x < w) {
        while (x < w && !mask[o + x]) x++;
        if (x >= w) break;
        const s = x;
        while (x < w && mask[o + x]) x++;
        runs.push([s, x]);
      }
      this.rows[y] = runs;
    }
  }

  // [y0, y1) 띠의 모든 행에서 공통으로 비어 있는 구간. 좌→우 정렬.
  intervalsAt(y0, y1, minWidth = 0) {
    const a = Math.max(0, Math.floor(y0));
    const b = Math.min(this.h, Math.ceil(y1));
    if (b <= a) return [];
    let acc = this.rows[a];
    for (let y = a + 1; y < b && acc.length; y++) acc = intersect(acc, this.rows[y]);
    return acc.filter((r) => r[1] - r[0] >= minWidth);
  }

  contains(x, y) {
    x = Math.floor(x);
    y = Math.floor(y);
    return x >= 0 && y >= 0 && x < this.w && y < this.h && this.mask[y * this.w + x] === 1;
  }
}

function intersect(A, B) {
  const out = [];
  let i = 0, j = 0;
  while (i < A.length && j < B.length) {
    const s = Math.max(A[i][0], B[j][0]);
    const e = Math.min(A[i][1], B[j][1]);
    if (s < e) out.push([s, e]);
    if (A[i][1] < B[j][1]) i++;
    else j++;
  }
  return out;
}

// source:
//   { kind: 'rect', inset }                                    사각형(글상자). inset = 안쪽 여백
//   { kind: 'path', d }                                        SVG 경로(even-odd). 구멍 포함 가능.
//   { kind: 'alpha', image, fit, scale, threshold }            투명 배경 이미지
//   { kind: 'colorKey', image, fit, scale, color, tolerance }  배경색을 바깥으로 판정
// opts: { smooth, offset, invert, exclude }
//   exclude 피할 것 목록(app/wrap.js): [{ m: 요소→프레임 행렬 [a,b,c,d,e,f], w, h, shape: 'box'|'ellipse'|'outline', gap, side: 'both'|'jump',
//           d(윤곽 경로), clip(이미지 마스크 경로), image + fit | drawRect(이미지 윤곽) }]
//   smooth  외곽 다듬기 반경(px)
//   offset  양수 = 안쪽으로 여백(수축), 음수 = 팽창. 프레임 가장자리도 바깥으로 취급한다.
//   invert  도형 바깥쪽을 글 영역으로
export function buildRegion(w, h, source, opts = {}) {
  const { smooth = 0, offset = 0, invert = false } = opts;
  let mask;
  let drawRect = null;

  if (source.kind === 'rect') {
    // 사각형 글상자: 경로를 그리지 않고 바로 채운다(리사이즈 중 매 프레임 다시 만들기 때문). inset = 안쪽 여백(px)
    const k = Math.max(0, Math.round(source.inset || 0));
    mask = new Uint8Array(w * h);
    for (let y = k; y < h - k; y++) mask.fill(1, y * w + k, y * w + w - k);
  } else if (source.kind === 'path') {
    mask = rasterPath(w, h, source.d);
  } else {
    const img = source.image;
    const iw = img.naturalWidth || img.width;
    const ih = img.naturalHeight || img.height;
    drawRect = fitRect(iw, ih, w, h, source.fit || 'contain', source.scale ?? 1);
    const data = drawImageData(w, h, img, drawRect);
    mask = source.kind === 'alpha'
      ? alphaMask(data, source.threshold ?? 128)
      : colorKeyMask(data, source.color || '#ffffff', source.tolerance ?? 40);
  }

  if (smooth > 0) mask = smoothMask(mask, w, h, smooth);
  if (invert) for (let i = 0; i < mask.length; i++) mask[i] ^= 1;
  if (offset) mask = offsetMask(mask, w, h, offset);
  // 피할 것(글이 피해 가는 사진·도형): 그 자리를 비운다
  if (opts.exclude?.length) { const ex = excludeMask(w, h, opts.exclude); for (let i = 0; i < mask.length; i++) if (ex[i]) mask[i] = 0; }

  return { region: new Region(w, h, mask), drawRect };
}

export function fitRect(iw, ih, W, H, fit, scale = 1) {
  let w, h;
  if (fit === 'fill') {
    w = W * scale;
    h = H * scale;
  } else {
    const k = (fit === 'cover' ? Math.max(W / iw, H / ih) : Math.min(W / iw, H / ih)) * scale;
    w = iw * k;
    h = ih * k;
  }
  return { x: (W - w) / 2, y: (H - h) / 2, w, h };
}

function ctx2d(w, h) {
  return new OffscreenCanvas(w, h).getContext('2d', { willReadFrequently: true });
}

function rasterPath(w, h, d) {
  const ctx = ctx2d(w, h);
  ctx.fillStyle = '#000';
  ctx.fill(new Path2D(d), 'evenodd');
  const a = ctx.getImageData(0, 0, w, h).data;
  const m = new Uint8Array(w * h);
  for (let i = 0; i < m.length; i++) m[i] = a[i * 4 + 3] >= 128 ? 1 : 0;
  return m;
}

function drawImageData(w, h, img, r) {
  const ctx = ctx2d(w, h);
  ctx.drawImage(img, r.x, r.y, r.w, r.h);
  return ctx.getImageData(0, 0, w, h).data;
}

function alphaMask(d, threshold) {
  const m = new Uint8Array(d.length / 4);
  for (let i = 0; i < m.length; i++) m[i] = d[i * 4 + 3] >= threshold ? 1 : 0;
  return m;
}

function colorKeyMask(d, color, tol) {
  const [kr, kg, kb] = parseHex(color);
  const t2 = tol * tol;
  const m = new Uint8Array(d.length / 4);
  for (let i = 0; i < m.length; i++) {
    const o = i * 4;
    if (d[o + 3] < 128) continue; // 이미지가 그려지지 않은 곳은 바깥
    const dr = d[o] - kr, dg = d[o + 1] - kg, db = d[o + 2] - kb;
    m[i] = dr * dr + dg * dg + db * db > t2 ? 1 : 0;
  }
  return m;
}

function parseHex(c) {
  let h = c.replace('#', '');
  if (h.length === 3) h = [...h].map((ch) => ch + ch).join('');
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
}

// 박스 블러 2회(가우시안 근사) 후 0.5 임계값. 톱니 모양 외곽을 매끄럽게 한다.
function smoothMask(mask, w, h, r) {
  r = Math.max(1, Math.round(r));
  let f = Float32Array.from(mask);
  for (let pass = 0; pass < 2; pass++) {
    f = blurH(f, w, h, r);
    f = blurV(f, w, h, r);
  }
  const out = new Uint8Array(mask.length);
  for (let i = 0; i < out.length; i++) out[i] = f[i] >= 0.5 ? 1 : 0;
  return out;
}

function blurH(src, w, h, r) {
  const out = new Float32Array(src.length);
  const n = 2 * r + 1;
  for (let y = 0; y < h; y++) {
    const o = y * w;
    let sum = 0;
    for (let k = -r; k <= r; k++) sum += src[o + clamp(k, 0, w - 1)];
    for (let x = 0; x < w; x++) {
      out[o + x] = sum / n;
      sum += src[o + clamp(x + r + 1, 0, w - 1)] - src[o + clamp(x - r, 0, w - 1)];
    }
  }
  return out;
}

function blurV(src, w, h, r) {
  const out = new Float32Array(src.length);
  const n = 2 * r + 1;
  for (let x = 0; x < w; x++) {
    let sum = 0;
    for (let k = -r; k <= r; k++) sum += src[clamp(k, 0, h - 1) * w + x];
    for (let y = 0; y < h; y++) {
      out[y * w + x] = sum / n;
      sum += src[clamp(y + r + 1, 0, h - 1) * w + x] - src[clamp(y - r, 0, h - 1) * w + x];
    }
  }
  return out;
}

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

// 유클리드 거리 변환(Felzenszwalb) 기반 수축/팽창
function offsetMask(mask, w, h, off) {
  const out = new Uint8Array(mask.length);
  if (off > 0) {
    // 안쪽 픽셀에서 가장 가까운 바깥 픽셀(프레임 밖 포함)까지의 거리
    const d2 = sqDist(mask, w, h, 1, true);
    const lim = off * off;
    for (let i = 0; i < out.length; i++) out[i] = mask[i] && d2[i] > lim ? 1 : 0;
  } else {
    const d2 = sqDist(mask, w, h, 0, false);
    const lim = off * off;
    for (let i = 0; i < out.length; i++) out[i] = mask[i] || d2[i] <= lim ? 1 : 0;
  }
  return out;
}

const INF = 1e20;

// target 값인 픽셀에서, target이 아닌 가장 가까운 픽셀까지의 제곱 거리.
// padOutside = true면 프레임 바깥을 target이 아닌 것으로 본다.
function sqDist(mask, w, h, target, padOutside) {
  const p = padOutside ? 1 : 0;
  const W = w + 2 * p, H = h + 2 * p;
  const g = new Float64Array(W * H); // 기본값 0 = 거리 원점
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) g[(y + p) * W + x + p] = mask[y * w + x] === target ? INF : 0;

  const n = Math.max(W, H);
  const f = new Float64Array(n), d = new Float64Array(n);
  const v = new Int32Array(n), z = new Float64Array(n + 1);
  for (let x = 0; x < W; x++) {
    for (let y = 0; y < H; y++) f[y] = g[y * W + x];
    edt1d(f, H, d, v, z);
    for (let y = 0; y < H; y++) g[y * W + x] = d[y];
  }
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) f[x] = g[y * W + x];
    edt1d(f, W, d, v, z);
    for (let x = 0; x < W; x++) g[y * W + x] = d[x];
  }
  const out = new Float64Array(w * h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) out[y * w + x] = g[(y + p) * W + x + p];
  return out;
}

function edt1d(f, n, d, v, z) {
  let k = 0;
  v[0] = 0;
  z[0] = -Infinity;
  z[1] = Infinity;
  for (let q = 1; q < n; q++) {
    let s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
    while (s <= z[k]) {
      k--;
      s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
    }
    k++;
    v[k] = q;
    z[k] = s;
    z[k + 1] = Infinity;
  }
  k = 0;
  for (let q = 0; q < n; q++) {
    while (z[k + 1] < q) k++;
    d[q] = (q - v[k]) * (q - v[k]) + f[v[k]];
  }
}

// 피할 것들을 프레임 크기 마스크로(1 = 글을 놓지 않음)
function excludeMask(W, H, list) {
  const out = new Uint8Array(W * H);
  for (const o of list) {
    const g = Math.max(0, o.gap || 0);
    const outline = o.shape === 'outline' && (o.d || o.image || o.clip);
    // 윤곽선은 그린 뒤 마스크를 부풀린다(둘레 거리 = gap). 프레임 밖에 걸친 부분도 부풀어 들어오게 gap만큼 넓게 그린다
    const pad = outline ? Math.ceil(g) : 0, PW = W + 2 * pad, PH = H + 2 * pad;
    const ctx = ctx2d(PW, PH);
    ctx.setTransform(1, 0, 0, 1, pad, pad);
    ctx.transform(...o.m);
    ctx.fillStyle = '#000';
    if (o.shape === 'ellipse') {
      ctx.beginPath(); ctx.ellipse(o.w / 2, o.h / 2, o.w / 2 + g, o.h / 2 + g, 0, 0, Math.PI * 2); ctx.fill();
    } else if (outline) {
      if (o.image) {
        if (o.clip) ctx.clip(new Path2D(o.clip), 'evenodd'); else { ctx.beginPath(); ctx.rect(0, 0, o.w, o.h); ctx.clip(); }
        const iw = o.image.naturalWidth || o.image.width, ih = o.image.naturalHeight || o.image.height;
        const r = o.drawRect || fitRect(iw, ih, o.w, o.h, o.fit || 'fill');
        ctx.drawImage(o.image, r.x, r.y, r.w, r.h);
      } else ctx.fill(new Path2D(o.d || o.clip), 'evenodd');
    } else {
      ctx.fillRect(-g, -g, o.w + 2 * g, o.h + 2 * g);
    }
    const a = ctx.getImageData(0, 0, PW, PH).data;
    let m = new Uint8Array(PW * PH);
    for (let i = 0; i < m.length; i++) m[i] = a[i * 4 + 3] >= 128 ? 1 : 0;
    if (outline && g > 0) m = offsetMask(m, PW, PH, -g);
    for (let y = 0; y < H; y++) {
      const src = (y + pad) * PW + pad, dst = y * W;
      let any = false;
      for (let x = 0; x < W; x++) if (m[src + x]) { out[dst + x] = 1; any = true; }
      if (any && o.side === 'jump') out.fill(1, dst, dst + W);
    }
  }
  return out;
}
