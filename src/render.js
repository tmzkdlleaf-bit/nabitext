// 레이아웃 결과 → 절대 위치 DOM. 래스터화/PDF 출력은 이 DOM을 그대로 쓴다.

import { fontOf } from './measure.js';
import { displaySrc, isExporting, isThumbing } from './image-src.js';

export function pieceCss(p) {
  const s = p.style;
  let css = `left:${p.x}px;top:${p.top}px;font:${fontOf(s)};line-height:${p.h}px;` +
    `letter-spacing:${s.letterSpacing || 0}px;color:${s.color};`;
  const lines = [];
  let d = null;
  if (s.underline) { lines.push('underline'); d = d || s.underline; }
  if (s.overline) { lines.push('overline'); d = d || s.overline; }
  if (s.strike) { lines.push('line-through'); d = d || s.strike; }
  if (lines.length) {
    css += `text-decoration-line:${lines.join(' ')};text-decoration-style:${d.style};`;
    if (d.color) css += `text-decoration-color:${d.color};`;
    if (d.thickness != null) css += `text-decoration-thickness:${d.thickness}px;`;
    css += 'text-decoration-skip-ink:none;';
  }
  if (s.gradient) {
    css += `background-image:${s.gradient};-webkit-background-clip:text;background-clip:text;color:transparent;`;
  } else if (s.highlight) {
    css += `background-color:${s.highlight};`;
  }
  if (s.stroke) css += `-webkit-text-stroke:${s.stroke.width}px ${s.stroke.color};paint-order:stroke fill;`;
  if (s.shadow) css += `text-shadow:${s.shadow};`;
  if (p.space) css += `display:inline-block;width:${p.adv}px;`;
  return css;
}

const decorated = (s) => s.underline || s.overline || s.strike || s.highlight;

// 결과를 el에 그린다. 같은 el에 다시 그리면 바뀐 줄만 DOM을 고친다(글 한 글자 입력에 전체를 다시 만들지 않음).
//   줄마다 vis 표(src/layout.js 메모)가 같으면 화면 모양이 같으므로 그 줄의 span을 그대로 둔다.
//   verify.js가 쓰는 data-l(줄 번호)·data-p(조각 번호)는 줄 번호가 바뀐 줄만 고쳐 쓴다.
export function renderFrame(el, frame, built, result, opts = {}) {
  const { w, h } = frame;
  const css = `position:relative;width:${w}px;height:${h}px;overflow:hidden;background:${frame.background || '#fff'};`;
  let st = el._rf;
  if (!st || st.debug || opts.debug) {
    // 처음(또는 디버그 표시): 틀을 새로 만든다
    el.innerHTML = '';
    st = el._rf = { bgKey: null, bg: document.createElement('div'), imgs: document.createElement('div'), layer: document.createElement('div'), rows: [], imgKey: null, css: null, debug: !!opts.debug };
    st.bg.style.cssText = 'position:absolute;inset:0;';
    st.imgs.style.cssText = 'position:absolute;inset:0;';
    st.layer.className = 'text-layer';
    st.layer.style.cssText = 'position:absolute;inset:0;';
    el.append(st.bg, st.imgs, st.layer);
  }
  if (st.css !== css) { el.style.cssText = css; st.css = css; }

  // 모양 채움·이미지 외곽선 원본(설정이 바뀔 때만)
  const src = frame.source || {};
  const svgKey = src.kind === 'path' && frame.shapeFill ? JSON.stringify([src.d, frame.shapeFill, w, h]) : '';
  if (st.bgKey !== svgKey) {
    st.bgKey = svgKey;
    if (!st.svg) { st.svg = document.createElement('div'); st.svg.style.cssText = 'position:absolute;inset:0;'; st.bg.prepend(st.svg); }
    st.svg.innerHTML = svgKey ? `<svg width="${w}" height="${h}" style="position:absolute;inset:0"><path d="${attr(String(src.d))}" fill="${attr(String(frame.shapeFill))}" fill-rule="evenodd"/></svg>` : '';
  }
  // 외곽선 이미지: 요소를 하나 두고 자리·크기만 바꾼다(크기를 끄는 동안 이미지를 매번 새로 만들어 다시 디코딩하지 않게)
  const r = built.drawRect && frame.imageOpacity ? built.drawRect : null;
  if (r) {
    if (!st.bgImg) { st.bgImg = document.createElement('img'); st.bgImg.decoding = 'async'; st.bg.appendChild(st.bgImg); }
    // 화면은 불러 둔 축소본, 출력은 원본
    const orig = src.image.dataset?.orig || src.image.src;
    const isrc = isExporting() ? orig : isThumbing() ? displaySrc(orig) : src.image.src;
    if (st.bgImg.getAttribute('src') !== isrc) st.bgImg.src = isrc;
    const ic = `position:absolute;left:${r.x}px;top:${r.y}px;width:${r.w}px;height:${r.h}px;opacity:${frame.imageOpacity}`;
    if (st.bgImgCss !== ic) { st.bgImg.style.cssText = ic; st.bgImgCss = ic; }
  } else if (st.bgImg) { st.bgImg.remove(); st.bgImg = null; st.bgImgCss = null; }

  // 블록 이미지(바뀔 때만)
  const imgKey = JSON.stringify(result.images.map((im) => [displaySrc(im.src), im.x, im.y, im.w, im.h, im.radius]));
  if (st.imgKey !== imgKey) {
    st.imgKey = imgKey;
    st.imgs.innerHTML = result.images.map((im) => `<img src="${attr(String(displaySrc(im.src)))}" style="position:absolute;left:${im.x}px;top:${im.y}px;width:${im.w}px;height:${im.h}px;border-radius:${im.radius}px">`).join('');
  }

  // 글 줄: vis가 같은 줄은 그대로 재사용. vis가 달라도(고친 문단의 다른 줄) 모양 문자열이 같으면 재사용
  const old = new Map(), byHtml = new Map();
  for (const row of st.rows) { if (row.vis) old.set(row.vis, row); if (row.html != null && !byHtml.has(row.html)) byHtml.set(row.html, row); }
  const rows = [];
  result.lines.forEach((ln, li) => {
    let row = ln.vis ? old.get(ln.vis) : null;
    if (row && row.used) row = null;
    let html = null;
    if (!row) { html = lineHTML(ln); const r2 = byHtml.get(html); if (r2 && !r2.used) row = r2; }
    if (row) {
      row.used = true;
      row.vis = ln.vis;
      if (row.li !== li) { for (const sp of row.nodes) sp.dataset.l = li; row.li = li; }
    } else row = { vis: ln.vis, li, html, nodes: htmlNodes(html, li), used: true };
    rows.push(row);
  });
  // DOM 맞추기: 순서대로 훑으며 제자리가 아닌 것만 넣고, 안 쓰인 것은 뺀다
  const keep = new Set();
  for (const row of rows) for (const n of row.nodes) keep.add(n);
  for (const row of st.rows) if (!row.used) for (const n of row.nodes) if (!keep.has(n)) n.remove();
  let cur = st.layer.firstChild;
  for (const row of rows) {
    for (const n of row.nodes) {
      if (n === cur) { cur = cur.nextSibling; continue; }
      st.layer.insertBefore(n, cur);
    }
  }
  while (cur) { const next = cur.nextSibling; cur.remove(); cur = next; }
  for (const row of rows) row.used = false;
  st.rows = rows;

  if (opts.debug) drawDebug(el, built.region, result);
}

const tpl = document.createElement('template');
// 줄의 조각 HTML(줄 번호 없이). 같은 문자열 = 같은 모양
function lineHTML(ln) {
  let html = '';
  ln.pieces.forEach((p, pi) => {
    if (p.space && !decorated(p.style)) return;
    html += `<span class="piece" data-p="${pi}" style="position:absolute;white-space:pre;${attr(pieceCss(p))}">${esc(p.text)}</span>`;
  });
  return html;
}
function htmlNodes(html, li) {
  if (!html) return [];
  tpl.innerHTML = html;
  const nodes = [...tpl.content.childNodes];
  for (const n of nodes) n.dataset.l = li;
  return nodes;
}

function drawDebug(el, region, result) {
  const cv = document.createElement('canvas');
  cv.width = region.w;
  cv.height = region.h;
  cv.style.cssText = 'position:absolute;inset:0;pointer-events:none;';
  const ctx = cv.getContext('2d');
  const img = ctx.createImageData(region.w, region.h);
  for (let i = 0; i < region.mask.length; i++) {
    if (!region.mask[i]) continue;
    img.data[i * 4] = 40; img.data[i * 4 + 1] = 120; img.data[i * 4 + 2] = 255; img.data[i * 4 + 3] = 28;
  }
  ctx.putImageData(img, 0, 0);
  ctx.strokeStyle = 'rgba(230,40,40,.45)';
  ctx.lineWidth = 1;
  for (const ln of result.lines) ctx.strokeRect(ln.x0 + 0.5, ln.y + 0.5, ln.x1 - ln.x0 - 1, ln.h - 1);
  ctx.strokeStyle = 'rgba(0,160,80,.7)';
  for (const im of result.images) ctx.strokeRect(im.x + 0.5, im.y + 0.5, im.w - 1, im.h - 1);
  el.appendChild(cv);
}

const attr = (t) => t.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
const esc = (t) => t.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]);
