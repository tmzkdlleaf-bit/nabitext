// 요소 → DOM. 캔버스 화면(page-view.js)과 출력(exportPage)이 같은 함수를 쓴다.
// 출력 DOM은 앱 스타일시트 없이 SVG foreignObject 안에서 그려지므로 스타일은 모두 인라인·속성으로 넣는다.

import * as Pth from './paths.js';
import { r3 } from './util.js';
import { displaySrc, proxyGen } from '../src/image-src.js';

const SVGNS = 'http://www.w3.org/2000/svg';
export const num = (v, d = 0) => (Number.isFinite(+v) ? +v : d);
export { r3 };
export const BLENDS = new Set(['normal', 'multiply', 'screen', 'overlay', 'darken', 'lighten', 'color-dodge', 'color-burn',
  'hard-light', 'soft-light', 'difference', 'exclusion', 'hue', 'saturation', 'color', 'luminosity']);
const cssStr = (s) => '"' + String(s).replace(/["\\\n]/g, '') + '"';
const safeColor = (c, d = 'none') => (typeof c === 'string' && /^(#[0-9a-fA-F]{3,8}|none|transparent|rgba?\([\d\s.,%]+\)|[a-z]+)$/.test(c.trim()) ? c.trim() : d);

export function pageCss(page) {
  // isolation: 요소의 혼합 모드가 장 바깥(앱 배경)과 섞이지 않게
  return `position:relative;width:${num(page.w)}px;height:${num(page.h)}px;overflow:hidden;isolation:isolate;`;
}

// 장 배경: 색 + 배경 이미지(page.bgImage = { src, fit: 'cover' | 'contain' | 'fill' | 'tile' }). 색과 이미지를 따로 적어
// 투명 출력은 색만 뺀다(export.js)
const BG_SIZE = { cover: 'cover', contain: 'contain', fill: '100% 100%', tile: 'auto' };
export function pageBgCss(page) {
  let css = `background-color:${page.background || '#fff'};`;
  const b = page.bgImage;
  if (b && typeof b.src === 'string' && b.src) {
    const fit = BG_SIZE[b.fit] ? b.fit : 'cover';
    css += `background-image:url("${displaySrc(b.src).replace(/["\\\n]/g, '')}");background-size:${BG_SIZE[fit]};background-position:center;background-repeat:${fit === 'tile' ? 'repeat' : 'no-repeat'};`;
  }
  return css;
}

export function boxCss(n) {
  const blend = BLENDS.has(n.blend) ? n.blend : 'normal';
  return `position:absolute;left:${r3(num(n.x))}px;top:${r3(num(n.y))}px;width:${r3(num(n.w))}px;height:${r3(num(n.h))}px;` +
    `transform:rotate(${r3(num(n.rotation))}deg);opacity:${num(n.opacity, 1)};mix-blend-mode:${blend};`;
}

function svgRoot(w, h) {
  const svg = document.createElementNS(SVGNS, 'svg');
  svg.setAttribute('width', r3(w)); svg.setAttribute('height', r3(h));
  svg.setAttribute('viewBox', `0 0 ${r3(w)} ${r3(h)}`);
  svg.setAttribute('style', 'position:absolute;left:0;top:0;overflow:visible');
  return svg;
}
const el = (tag, attrs = {}) => { const e = document.createElementNS(SVGNS, tag); for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v); return e; };

// ---------- 채움: 단색 | { type: 'linear', angle, stops } | { type: 'radial', stops } | { type: 'pattern', src, w, h, scale } ----------
// stops: [{ o: 0–1, c: 색 }]. linear 각도: 0 = 왼쪽 → 오른쪽, 90 = 위 → 아래(시계 방향)
export function paint(fill, svg, id) {
  if (!fill || typeof fill === 'string') return safeColor(fill);
  const defs = svg.querySelector('defs') || svg.insertBefore(el('defs'), svg.firstChild);
  const pid = `fill-${id}`;
  const stops = (g) => { for (const s of (fill.stops?.length ? fill.stops : [{ o: 0, c: '#000' }, { o: 1, c: '#fff' }])) g.appendChild(el('stop', { offset: Math.max(0, Math.min(1, num(s.o))), 'stop-color': safeColor(s.c, '#000') })); return g; };
  if (fill.type === 'linear') {
    const a = (num(fill.angle, 0) * Math.PI) / 180, c = Math.cos(a) / 2, s = Math.sin(a) / 2;
    defs.appendChild(stops(el('linearGradient', { id: pid, x1: r3(0.5 - c), y1: r3(0.5 - s), x2: r3(0.5 + c), y2: r3(0.5 + s) })));
  } else if (fill.type === 'radial') {
    defs.appendChild(stops(el('radialGradient', { id: pid, cx: 0.5, cy: 0.5, r: 0.5 })));
  } else if (fill.type === 'pattern' && fill.src) {
    const k = Math.max(0.01, num(fill.scale, 1)), pw = num(fill.w, 100) * k, ph = num(fill.h, 100) * k;
    const pat = el('pattern', { id: pid, patternUnits: 'userSpaceOnUse', width: r3(pw), height: r3(ph) });
    pat.appendChild(el('image', { href: displaySrc(fill.src), x: 0, y: 0, width: r3(pw), height: r3(ph), preserveAspectRatio: 'none' }));
    defs.appendChild(pat);
  } else return 'none';
  return `url(#${pid})`;
}

// ---------- 도형·패스 ----------
export function shapePathD(n, w, h, sw) {
  // 테두리가 상자 안에 들어오도록 선 두께의 절반만큼 안쪽에 그린다
  const iw = Math.max(0, w - sw), ih = Math.max(0, h - sw);
  let d;
  if (n.shape === 'ellipse') d = Pth.ellipseD(iw / 2, ih / 2, iw / 2, ih / 2);
  else if (n.shape === 'polygon') d = Pth.polygonD(iw, ih, n.sides || 5);
  else if (n.shape === 'star') d = Pth.polygonD(iw, ih, n.sides || 5, Math.max(0.05, Math.min(1, num(n.inner, 0.5))));
  else d = Pth.rectD(iw, ih, Math.max(0, num(n.radius)));
  return sw ? Pth.translateD(d, sw / 2, sw / 2) : d;
}

export function shapeSvg(n) {
  const w = num(n.w), h = num(n.h), sw = Math.max(0, num(n.strokeWidth));
  const svg = svgRoot(w, h);
  const p = el('path', { d: shapePathD(n, w, h, sw), fill: paint(n.fill, svg, n.id) });
  if (sw > 0) { p.setAttribute('stroke', safeColor(n.stroke, '#000')); p.setAttribute('stroke-width', sw); p.setAttribute('stroke-linejoin', 'round'); }
  svg.appendChild(p);
  return svg;
}

export function pathSvg(n) {
  const w = num(n.w), h = num(n.h), sw = Math.max(0, num(n.strokeWidth));
  const svg = svgRoot(w, h);
  const d = Pth.scaleD(n.d || '', w / (num(n.pw) || w || 1), h / (num(n.ph) || h || 1));
  const p = el('path', { d, fill: paint(n.fill, svg, n.id), 'fill-rule': 'evenodd' });
  if (sw > 0) {
    p.setAttribute('stroke', safeColor(n.stroke, '#000')); p.setAttribute('stroke-width', sw);
    p.setAttribute('stroke-linecap', n.cap === 'butt' || n.cap === 'square' ? n.cap : 'round');
    p.setAttribute('stroke-linejoin', 'round');
  }
  svg.appendChild(p);
  return svg;
}

// 경로 텍스트: 경로를 따라 한 줄로. 글자 크기는 상자 배율과 무관(경로만 늘어남)
// 글꼴 설계 폭으로 잰 글 길이(글꼴이 아직 안 불러와졌으면 0 → textLength 없이 그리고, 불러온 뒤 다시 그린다)
let measureCtx = null, measureGen = 0;
const measureCache = new Map();
export function resetTextMeasure() { measureCache.clear(); measureGen++; }
function measureText(font, ls, str) {
  const key = `${font}|${ls}|${str}`;
  if (measureCache.has(key)) return measureCache.get(key);
  let w = 0;
  try {
    if (!document.fonts || document.fonts.check(font, str)) {
      measureCtx ||= document.createElement('canvas').getContext('2d');
      measureCtx.font = font;
      measureCtx.letterSpacing = `${ls}px`;
      w = measureCtx.measureText(str).width;
    }
  } catch { w = 0; }
  if (w > 0) measureCache.set(key, w);
  return w;
}
export function pathTextSvg(n) {
  const w = num(n.w), h = num(n.h);
  const svg = svgRoot(w, h);
  const d = Pth.scaleD(n.d || '', w / (num(n.pw) || w || 1), h / (num(n.ph) || h || 1));
  const pid = `tp-${n.id}`;
  const defs = el('defs');
  defs.appendChild(el('path', { id: pid, d }));
  svg.appendChild(defs);
  if (n.showPath) svg.appendChild(el('path', { d, fill: 'none', stroke: safeColor(n.stroke, '#999999'), 'stroke-width': Math.max(0.5, num(n.strokeWidth, 1)) }));
  const s = n.style || {};
  const family = s.fontFamily ? String(s.fontFamily).replace(/[;{}<>]/g, '') : '"Noto Sans KR", "Noto Sans CJK KR", sans-serif';
  const size = Math.max(1, num(s.fontSize, 32)), weight = num(s.fontWeight, 400), style = s.italic ? 'italic' : 'normal', ls = num(s.letterSpacing);
  const str = String(n.text ?? '');
  const text = el('text', { fill: safeColor(s.color, '#1f1f1f'), 'text-anchor': ['start', 'middle', 'end'].includes(n.anchor) ? n.anchor : 'start' });
  text.setAttribute('style', `font-family:${family};font-size:${size}px;font-weight:${weight};font-style:${style};letter-spacing:${ls}px;white-space:pre`);
  // 화면(글자 폭을 픽셀 단위로 맞춤)과 출력·인쇄(소수 폭)의 글자 폭이 달라 긴 글은 끝에서 몇 px 어긋난다.
  // 글꼴 설계 폭으로 잰 전체 길이를 textLength로 못박아 세 경로가 같은 자리에 글자를 놓게 한다.
  const len = str ? measureText(`${style} ${weight} ${size}px ${family}`, ls, str) : 0;
  if (len > 0) { text.setAttribute('textLength', r3(len)); text.setAttribute('lengthAdjust', 'spacing'); }
  const tp = el('textPath', { href: `#${pid}`, startOffset: `${Math.max(0, Math.min(100, num(n.offset)))}%` });
  tp.textContent = str;
  text.appendChild(tp);
  svg.appendChild(text);
  return svg;
}

// ---------- 이미지: 크롭·필터·마스크 ----------
// crop: 원본 이미지 기준 비율 { x, y, w, h } (0–1). null = 전체
// filters: { brightness, contrast, saturate (%), hue (도), blur (px), grayscale, sepia, invert (%) }
// mask: { kind: 'shape', d, pw, ph } (요소 안 좌표의 경로로 자르기) | { kind: 'alpha', src } (그 이미지의 투명도로 가리기)
export const FILTER_DEFAULTS = { brightness: 100, contrast: 100, saturate: 100, hue: 0, blur: 0, grayscale: 0, sepia: 0, invert: 0 };
export function filterCss(f) {
  if (!f) return '';
  const v = { ...FILTER_DEFAULTS, ...f };
  const parts = [];
  if (v.brightness !== 100) parts.push(`brightness(${num(v.brightness, 100)}%)`);
  if (v.contrast !== 100) parts.push(`contrast(${num(v.contrast, 100)}%)`);
  if (v.saturate !== 100) parts.push(`saturate(${num(v.saturate, 100)}%)`);
  if (v.hue) parts.push(`hue-rotate(${num(v.hue)}deg)`);
  if (v.blur) parts.push(`blur(${Math.max(0, num(v.blur))}px)`);
  if (v.grayscale) parts.push(`grayscale(${num(v.grayscale)}%)`);
  if (v.sepia) parts.push(`sepia(${num(v.sepia)}%)`);
  if (v.invert) parts.push(`invert(${num(v.invert)}%)`);
  return parts.join(' ');
}

export function maskCss(n) {
  const m = n.mask;
  if (!m) return '';
  if (m.kind === 'shape' && m.d) {
    const d = Pth.scaleD(m.d, num(n.w) / (num(m.pw) || num(n.w) || 1), num(n.h) / (num(m.ph) || num(n.h) || 1));
    return `clip-path:path(evenodd, ${cssStr(d)});`;
  }
  if (m.kind === 'alpha' && m.src) {
    const u = `url(${cssStr(displaySrc(m.src))})`;
    return `-webkit-mask-image:${u};mask-image:${u};-webkit-mask-size:100% 100%;mask-size:100% 100%;-webkit-mask-repeat:no-repeat;mask-repeat:no-repeat;`;
  }
  return '';
}

export function imageContent(n) {
  const clip = document.createElement('div');
  clip.style.cssText = `position:absolute;left:0;top:0;width:100%;height:100%;overflow:hidden;${maskCss(n)}`;
  const img = document.createElement('img');
  img.decoding = 'async'; // 큰 사진의 해독이 그리기를 막지 않게(장 전환·처음 표시에서 프레임이 밀리지 않음)
  img.src = displaySrc(n.src);
  img.draggable = false;
  const f = filterCss(n.filters);
  const c = n.crop;
  if (c && c.w > 0 && c.h > 0) {
    const W = num(n.w) / c.w, H = num(n.h) / c.h;
    img.style.cssText = `position:absolute;left:${r3(-c.x * W)}px;top:${r3(-c.y * H)}px;width:${r3(W)}px;height:${r3(H)}px;max-width:none;pointer-events:none;${f ? `filter:${f};` : ''}`;
  } else {
    img.style.cssText = `position:absolute;left:0;top:0;width:100%;height:100%;pointer-events:none;object-fit:${['fill', 'contain', 'cover'].includes(n.fit) ? n.fit : 'fill'};${f ? `filter:${f};` : ''}`;
  }
  clip.appendChild(img);
  return clip;
}

// 글상자가 아닌 요소의 내용 DOM
export function contentOf(n) {
  if (n.type === 'shape') return shapeSvg(n);
  if (n.type === 'path') return pathSvg(n);
  if (n.type === 'pathText') return pathTextSvg(n);
  if (n.type === 'image') return imageContent(n);
  return null;
}
// 내용이 바뀌었는지 보는 열쇠(같으면 DOM을 다시 만들지 않는다)
export function contentKey(n) {
  const { id, x, y, rotation, opacity, blend, name, locked, hidden, ...rest } = n;
  return JSON.stringify(rest) + (n.type === 'pathText' ? `#${measureGen}` : '') + (n.type === 'image' || n.fill?.type === 'pattern' ? `@${proxyGen}` : '');
}

// ---------- 글상자 바탕 ----------
// bg: { color, opacity(0–1), radius(사각형 모서리), stroke(테두리 색), strokeWidth } — 글보다 뒤에 깔린다.
//   글상자 모양이 원·도넛·자유형이면 그 모양대로 칠한다(모양 바깥에 글을 흘리는 '반전'이면 상자 전체).
export const hasTextBg = (n) => !!(n.bg && ((n.bg.color && n.bg.color !== 'none') || num(n.bg.strokeWidth) > 0));
export const textBgKey = (n) => (hasTextBg(n) ? JSON.stringify([n.bg, Math.round(n.w), Math.round(n.h), n.area?.kind, n.area?.inner, n.area?.d, n.area?.invert]) : '');
export function textBg(n) {
  if (!hasTextBg(n)) return null;
  const b = n.bg, w = Math.max(1, num(n.w)), h = Math.max(1, num(n.h));
  const sw = Math.max(0, num(b.strokeWidth));
  const svg = svgRoot(w, h);
  svg.setAttribute('class', 'text-bg');
  svg.style.pointerEvents = 'none';
  const a = n.area || { kind: 'rect' };
  let shape;
  if (a.invert || a.kind === 'image' || !['ellipse', 'donut', 'path'].includes(a.kind)) shape = el('path', { d: Pth.rectD(w, h, Math.max(0, num(b.radius))) });
  else if (a.kind === 'ellipse') shape = el('ellipse', { cx: r3(w / 2), cy: r3(h / 2), rx: r3(w / 2), ry: r3(h / 2) });
  else if (a.kind === 'donut') shape = el('path', { d: Pth.donutD(w, h, Math.max(0.05, Math.min(0.95, num(a.inner, 0.45)))), 'fill-rule': 'evenodd' });
  else shape = a.d ? el('path', { d: Pth.scaleD(a.d, w / (num(a.pw) || w), h / (num(a.ph) || h)) }) : el('path', { d: Pth.rectD(w, h) });
  shape.setAttribute('fill', b.color && b.color !== 'none' ? safeColor(b.color, '#ffffff') : 'none');
  shape.setAttribute('fill-opacity', Math.max(0, Math.min(1, num(b.opacity, 1))));
  if (sw > 0) { shape.setAttribute('stroke', safeColor(b.stroke, '#000000')); shape.setAttribute('stroke-width', r3(sw)); }
  svg.appendChild(shape);
  return svg;
}

// ---------- 글상자 모양(area) ----------
// area: 없음/{ kind: 'rect' } | { kind: 'ellipse' } | { kind: 'donut', inner } | { kind: 'path', d, pw, ph }
//       | { kind: 'image', src, mode: 'alpha' | 'colorKey', threshold, color, tolerance, fit, show, opacity }
//   공통: offset(안쪽 여백 = 모양에서 글까지 거리. 음수면 바깥으로), smooth(외곽 다듬기), invert(모양 바깥에 글), minWidth(이보다 좁은 구간은 건너뜀)
// images: src → 불러온 HTMLImageElement(없으면 불러오는 중 → pending)
export function textFrame(n, images) {
  const w = Math.max(1, Math.round(n.w)), h = Math.max(1, Math.round(n.h));
  const a = n.area || { kind: 'rect' };
  const base = { id: n.id, w, h, background: 'transparent', style: n.style || {}, paragraphSpacing: Math.max(0, num(n.paraSpacing, 8)), minWidth: Math.max(1, num(a.minWidth, 8)) };
  const opts = { offset: num(n.padding), smooth: Math.max(0, num(a.smooth)), invert: !!a.invert };
  if (a.kind === 'ellipse') return { frame: { ...base, source: { kind: 'path', d: Pth.ellipseD(w / 2, h / 2, w / 2, h / 2) } }, opts };
  if (a.kind === 'donut') return { frame: { ...base, source: { kind: 'path', d: Pth.donutD(w, h, Math.max(0.05, Math.min(0.95, num(a.inner, 0.45)))) } }, opts };
  if (a.kind === 'path' && a.d) return { frame: { ...base, source: { kind: 'path', d: Pth.scaleD(a.d, w / (num(a.pw) || w), h / (num(a.ph) || h)) } }, opts };
  if (a.kind === 'image' && a.src) {
    const img = images?.get(a.src);
    if (img === false) return { frame: { ...base, source: { kind: 'rect', inset: num(n.padding) } }, opts: {} }; // 이미지를 못 읽음
    if (!img) return { pending: a.src, frame: { ...base, source: { kind: 'rect', inset: num(n.padding) } }, opts: {} };
    const mode = a.mode === 'colorKey' ? 'colorKey' : 'alpha';
    return { frame: { ...base, imageOpacity: a.show === false ? 0 : Math.max(0, Math.min(1, num(a.opacity, 1))),
      source: { kind: mode, image: img, fit: ['contain', 'cover', 'fill'].includes(a.fit) ? a.fit : 'contain', threshold: num(a.threshold, 128), color: a.color || '#ffffff', tolerance: num(a.tolerance, 40) } }, opts };
  }
  if (opts.smooth || opts.invert) return { frame: { ...base, source: { kind: 'path', d: Pth.rectD(w, h) } }, opts };
  return { frame: { ...base, source: { kind: 'rect', inset: num(n.padding) } }, opts: {} };
}
