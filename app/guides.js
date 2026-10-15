// 눈금자·가이드·격자, 그리고 스냅 보강(가이드·격자·균등 간격).
//   눈금자: 캔버스 위·왼쪽 띠. 장 좌표(px)를 보여 준다. 위 눈금자에서 끌어 내리면 가로 가이드, 왼쪽에서 끌면 세로 가이드
//   가이드: 장마다 저장(page.guides = [{ axis: 'x' | 'y', pos }]; x = 세로선의 x 위치). 끌어 옮기고, 눈금자 위로 끌어 놓으면 지움
//   격자: 프로젝트 격자 간격(project.grid.size). 보일 때만 격자에 스냅
//   균등 간격: 옮기는 요소와 같은 줄(가로)·같은 열(세로)의 요소 사이 간격이 이미 있는 간격과 같아지는 자리에 스냅

import * as G from './geom.js';
import * as M from './model.js';
import { r3, trackPointer, pressEvent } from './util.js';

export const RULER_PX = 20;
const GUIDE_HIT_PX = 4;
const GUIDE_COLOR = '#00a3d9';
const GRID_COLOR = 'rgba(45,127,249,.16)';

const CSS = `
.pv-ruler{position:absolute;background:#f4f3f0;z-index:3;cursor:default;box-sizing:border-box}
.pv-ruler.top{left:${RULER_PX}px;right:0;top:0;height:${RULER_PX}px;border-bottom:1px solid #d5d2cc;cursor:row-resize}
.pv-ruler.left{top:${RULER_PX}px;bottom:0;left:0;width:${RULER_PX}px;border-right:1px solid #d5d2cc;cursor:col-resize}
.pv-ruler.corner{left:0;top:0;width:${RULER_PX}px;height:${RULER_PX}px;border-right:1px solid #d5d2cc;border-bottom:1px solid #d5d2cc}
.pv-ruler canvas{display:block;width:100%;height:100%}
`;
let cssInjected = false;

export function installGuides(PV) {
  const P = PV.prototype;

  P.initGuides = function () {
    if (!cssInjected) { document.head.insertAdjacentHTML('beforeend', `<style>${CSS}</style>`); cssInjected = true; }
    this.showRulers = true;
    this.showGrid = false;
    this.showGuides = true;
    this.gridSize = 20;
    this.spacing = [];   // 균등 간격 표시(끄는 동안)
    const mk = (cls) => { const d = document.createElement('div'); d.className = `pv-ruler ${cls}`; if (cls !== 'corner') d.appendChild(document.createElement('canvas')); this.viewport.appendChild(d); return d; };
    this.rulers = { top: mk('top'), left: mk('left'), corner: mk('corner') };
    this.rulers.top.addEventListener('mousedown', (e) => { if (e.button === 0) { e.preventDefault(); e.stopPropagation(); this.startGuideDrag(e, { axis: 'y', index: -1 }); } });
    this.rulers.left.addEventListener('mousedown', (e) => { if (e.button === 0) { e.preventDefault(); e.stopPropagation(); this.startGuideDrag(e, { axis: 'x', index: -1 }); } });
    // 손가락·펜: 눈금자에서 끌어 가이드 만들기(마우스와 같게)
    for (const [r, axis] of [[this.rulers.top, 'y'], [this.rulers.left, 'x']])
      r.addEventListener('pointerdown', (e) => { if (e.pointerType === 'mouse' || this.touches?.size > 1) return; e.preventDefault(); e.stopPropagation(); this.startGuideDrag(pressEvent(e, 1), { axis, index: -1 }); });
    this.applyRulerVisibility();
  };

  P.setViewOption = function (key, on) {
    const k = { rulers: 'showRulers', grid: 'showGrid', guides: 'showGuides' }[key];
    if (!k) return false;
    this[k] = on ?? !this[k];
    if (key === 'rulers') this.applyRulerVisibility();
    this.drawOverlay();
    this.onViewOption?.(key, this[k]);
    this.onChange(this);
    return true;
  };
  P.applyRulerVisibility = function () {
    for (const r of Object.values(this.rulers)) r.style.display = this.showRulers ? '' : 'none';
    this._rulerSig = null;
    this.drawRulers();
  };

  // ---------- 눈금자 ----------
  P.drawRulers = function () {
    if (!this.rulers || !this.showRulers) return;
    const dpr = window.devicePixelRatio || 1;
    const vr = this.rect();
    // 바뀐 것이 없으면 다시 그리지 않는다(글자 입력처럼 확대·이동·선택 상자가 그대로인 경우)
    const b0 = this.selectionBounds?.();
    const sig = [this.z, this.px, this.py, this.page.w, this.page.h, vr.width, vr.height, dpr, b0 && [b0.x, b0.y, b0.w, b0.h]].join();
    if (sig === this._rulerSig) return;
    this._rulerSig = sig;
    const step = niceStep(60 / this.z); // 숫자 사이 간격(장 px): 화면에서 60px 이상
    const minor = step / (String(step)[0] === '2' ? 4 : 5);
    for (const side of ['top', 'left']) {
      const cv = this.rulers[side].firstChild;
      const W = side === 'top' ? vr.width - RULER_PX : RULER_PX, H = side === 'top' ? RULER_PX : vr.height - RULER_PX;
      if (W <= 0 || H <= 0) continue;
      cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
      const x = cv.getContext('2d');
      x.setTransform(dpr, 0, 0, dpr, 0, 0);
      x.clearRect(0, 0, W, H);
      x.fillStyle = '#e8e6e1'; // 장 범위
      const len = side === 'top' ? W : H;
      const off = side === 'top' ? this.px - RULER_PX : this.py - RULER_PX; // 캔버스 안 장 원점 위치
      const pageLen = (side === 'top' ? this.page.w : this.page.h) * this.z;
      if (side === 'top') x.fillRect(off, 0, pageLen, H); else x.fillRect(0, off, W, pageLen);
      x.strokeStyle = '#8f8b84'; x.fillStyle = '#5f5b55';
      x.font = '10px sans-serif'; x.lineWidth = 1;
      const v0 = -off / this.z, v1 = (len - off) / this.z;
      x.beginPath();
      for (let v = Math.floor(v0 / minor) * minor; v <= v1; v += minor) {
        const s = Math.round(off + v * this.z) + 0.5;
        const major = Math.abs(v / step - Math.round(v / step)) < 1e-6;
        const t = major ? RULER_PX : RULER_PX * 0.3;
        if (side === 'top') { x.moveTo(s, RULER_PX); x.lineTo(s, RULER_PX - t); } else { x.moveTo(RULER_PX, s); x.lineTo(RULER_PX - t, s); }
        if (major) {
          const label = String(Math.round(v));
          if (side === 'top') x.fillText(label, s + 2, 9);
          else { x.save(); x.translate(9, s + 2); x.rotate(-Math.PI / 2); x.textAlign = 'right'; x.fillText(label, 0, 0); x.restore(); }
        }
      }
      x.stroke();
      // 선택 범위 표시
      const b = this.selectionBounds?.();
      if (b) {
        x.fillStyle = 'rgba(45,127,249,.25)';
        if (side === 'top') x.fillRect(off + b.x * this.z, RULER_PX - 5, b.w * this.z, 5); else x.fillRect(RULER_PX - 5, off + b.y * this.z, 5, b.h * this.z);
      }
    }
  };

  // ---------- 가이드 ----------
  P.pageGuides = function () { return Array.isArray(this.page.guides) ? this.page.guides : []; };
  // 화면 좌표(뷰포트 기준) 근처의 가이드 번호
  P.guideAt = function (vx, vy) {
    if (!this.showGuides) return -1;
    const gs = this.pageGuides();
    for (let i = gs.length - 1; i >= 0; i--) {
      const g = gs[i];
      const v = this.pageToView(g.axis === 'x' ? { x: g.pos, y: 0 } : { x: 0, y: g.pos });
      if (g.axis === 'x' ? Math.abs(v.x - vx) <= GUIDE_HIT_PX : Math.abs(v.y - vy) <= GUIDE_HIT_PX) return i;
    }
    return -1;
  };
  // index -1 = 눈금자에서 새 가이드. 눈금자 위(또는 캔버스 밖)에 놓으면 지움/취소
  P.startGuideDrag = function (e, { axis, index }) {
    if (this.editing) this.exitEdit();
    this.showGuides = true;
    const before = this.snapshot(), selBefore = [...this.selection];
    const orig = this.pageGuides();
    const cur = { axis, pos: index >= 0 ? orig[index].pos : null };
    this.drag = { kind: 'guide' };
    const vr = () => this.rect();
    const outside = (ev) => { const r = vr(); const vx = ev.clientX - r.left, vy = ev.clientY - r.top; return vx < 0 || vy < 0 || vx > r.width || vy > r.height || (this.showRulers && (axis === 'y' ? vy < RULER_PX : vx < RULER_PX)); };
    const place = (ev) => {
      const p = this.clientToPage(ev.clientX, ev.clientY);
      let pos = axis === 'x' ? p.x : p.y;
      if (!ev.shiftKey) pos = Math.round(pos); // 정수 px(Shift = 소수 그대로)
      cur.pos = pos;
      const del = outside(ev);
      const rest = orig.filter((_, i) => i !== index);
      this.page.guides = del ? rest : [...rest.slice(0, index < 0 ? rest.length : index), { axis, pos }, ...rest.slice(index < 0 ? rest.length : index)];
      this.guideHint = del ? null : { axis, pos };
      this.drawOverlay();
    };
    const mm = (ev) => place(ev);
    const mu = (ev) => {
      this.drag = null;
      this.guideHint = null;
      if (cur.pos != null || index >= 0) {
        if (cur.pos != null) place(ev);
        if (JSON.stringify(this.pageGuides()) !== JSON.stringify(orig)) this.commit('guide', before, selBefore);
      }
      this.drawOverlay();
    };
    trackPointer(mm, mu);
  };
  P.setGridSize = function (g) {
    if (g === this.gridSize) return false;
    this.gridSize = g;
    this.onGridSize?.(g);
    this.drawOverlay();
    this.onChange(this);
    return true;
  };
  P.clearGuides = function () {
    if (!this.pageGuides().length) return false;
    return this.change('guide', () => { this.page.guides = []; });
  };

  P.guideDown = function (e, p, vx, vy) {
    if (this.tool === 'select' && !this.linking && !this.crop && !this.pathEdit && !this.handleAt(vx, vy)) {
      const i = this.guideAt(vx, vy);
      if (i >= 0) { this.startGuideDrag(e, { axis: this.pageGuides()[i].axis, index: i }); return true; }
    }
    return false;
  };
  P.guideHover = function (e, p) {
    if (this.tool === 'select' && !this.linking && !this.crop && !this.pathEdit) {
      const r = this.rect();
      const i = this.guideAt(e.clientX - r.left, e.clientY - r.top);
      if (i >= 0) { this.viewport.style.cursor = this.pageGuides()[i].axis === 'x' ? 'col-resize' : 'row-resize'; return true; }
    }
    return false;
  };

  // 격자·가이드(요소 위, 선택 표시 아래에 그리려고 drawOverlay가 먼저 부른다)
  P.backOverlay = function () {
    let s = '';
    const vr = this.rect();
    const V = (q) => this.pageToView(q);
    if (this.showGrid && this.gridSize * this.z >= 4) {
      const g = this.gridSize * this.z;
      const o = V({ x: 0, y: 0 });
      const w = this.page.w * this.z, h = this.page.h * this.z;
      let d = '';
      for (let k = 1; k * this.gridSize < this.page.w; k++) d += `M${r3(o.x + k * g)} ${r3(o.y)}v${r3(h)}`;
      for (let k = 1; k * this.gridSize < this.page.h; k++) d += `M${r3(o.x)} ${r3(o.y + k * g)}h${r3(w)}`;
      s += `<path class="grid" d="${d}" stroke="${GRID_COLOR}" stroke-width="1" fill="none"/>`;
    }
    if (this.showGuides) {
      for (const [i, gd] of this.pageGuides().entries()) {
        const v = V(gd.axis === 'x' ? { x: gd.pos, y: 0 } : { x: 0, y: gd.pos });
        s += gd.axis === 'x' ? `<line data-guide="${i}" x1="${r3(v.x)}" y1="0" x2="${r3(v.x)}" y2="${r3(vr.height)}" stroke="${GUIDE_COLOR}" stroke-width="1"/>`
          : `<line data-guide="${i}" x1="0" y1="${r3(v.y)}" x2="${r3(vr.width)}" y2="${r3(v.y)}" stroke="${GUIDE_COLOR}" stroke-width="1"/>`;
      }
    }
    return s;
  };
  P.guideOverlay = function () {
    let s = '';
    // 균등 간격 표시: 같은 간격 구간마다 양 끝 막대가 있는 선 + 간격 값
    for (const sp of this.spacing || []) {
      const a = this.pageToView(sp.a), b = this.pageToView(sp.b);
      const vert = sp.axis === 'y';
      const cap = (q) => (vert ? `M${r3(q.x - 4)} ${r3(q.y)}h8` : `M${r3(q.x)} ${r3(q.y - 4)}v8`);
      s += `<path class="spacing" d="M${r3(a.x)} ${r3(a.y)}L${r3(b.x)} ${r3(b.y)}${cap(a)}${cap(b)}" stroke="#ff2d95" stroke-width="1" fill="none"/>`;
      const m = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      s += `<text x="${r3(m.x + (vert ? 6 : 0))}" y="${r3(m.y - (vert ? -4 : 6))}" font-size="11" fill="#ff2d95" font-family="sans-serif" text-anchor="${vert ? 'start' : 'middle'}">${Math.round(sp.gap * 10) / 10}</text>`;
    }
    if (this.guideHint) {
      const g = this.guideHint;
      const v = this.pageToView(g.axis === 'x' ? { x: g.pos, y: 0 } : { x: 0, y: g.pos });
      s += `<text x="${r3((g.axis === 'x' ? v.x : 0) + 24)}" y="${r3((g.axis === 'y' ? v.y : 0) + 34)}" font-size="11" fill="${GUIDE_COLOR}" font-family="sans-serif">${Math.round(g.pos * 10) / 10}</text>`;
    }
    return s;
  };

  PV.addMode({ rank: 10, down: P.guideDown, hover: P.guideHover, overlay: P.guideOverlay });
}

// 1·2·5 × 10^n 중 v 이상인 가장 작은 값
function niceStep(v) {
  const p = Math.pow(10, Math.floor(Math.log10(v)));
  for (const k of [1, 2, 5, 10]) if (k * p >= v) return k * p;
  return 10 * p;
}
