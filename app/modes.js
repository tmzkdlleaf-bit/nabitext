// 캔버스의 특수 모드: 펜 도구, 패스 점 편집, 이미지 자르기. 그리고 요소를 조합하는 명령(마스크·글상자 모양·경로 글자).
// PageView에 메서드로 붙이고(installModes) 모드 목록에 등록한다(순위 30: 가이드·글 흐름 다음). 마우스·키·겹침 표시는 PageView가 먼저 모드들에 물어본다.

import * as G from './geom.js';
import * as M from './model.js';
import * as Pth from './paths.js';
import { r3, esc } from './util.js';

const PT_PX = 7; // 점·핸들을 잡는 거리(화면 px)

export function installModes(PV) {
  const P = PV.prototype;

  // ---------- 공통 진입점 ----------
  // 처리했으면 true
  P.toolDown = function (e, p, vx, vy) {
    if (this.tool === 'pen') { this.penDown(e, p); return true; }
    if (this.pathEdit) { if (this.pathEditDown(e, p, vx, vy)) return true; this.exitPathEdit(); }
    if (this.crop) { if (this.cropDown(e, p, vx, vy)) return true; this.exitCrop(); }
    return false;
  };
  P.toolHover = function (e, p) {
    if (this.tool === 'pen' && this.pen) { this.pen.cur = p; this.drawOverlay(); this.viewport.style.cursor = 'crosshair'; return true; }
    if (this.tool === 'pen') { this.viewport.style.cursor = 'crosshair'; return true; }
    if (this.crop) { this.viewport.style.cursor = this.cropHandleAt(e) ? 'nwse-resize' : 'move'; return true; }
    if (this.pathEdit) { this.viewport.style.cursor = this.pathHit(e) ? 'pointer' : 'default'; return true; }
    return false;
  };
  P.toolKey = function (e) {
    if (this.pen && (e.key === 'Enter' || e.key === 'Escape')) { this.finishPen(false); return true; }
    if (this.pathEdit) {
      if (e.key === 'Enter' || e.key === 'Escape') { this.exitPathEdit(); return true; }
      if ((e.key === 'Delete' || e.key === 'Backspace') && this.pathEdit.sel != null) { this.deletePathNode(); return true; }
      return /^(Arrow|Delete|Backspace)/.test(e.key); // 점 편집 중에는 요소 이동·삭제를 막는다
    }
    if (this.crop && (e.key === 'Enter' || e.key === 'Escape')) { this.exitCrop(); return true; }
    return false;
  };
  P.toolOverlay = function () {
    let s = '';
    const V = (p) => this.pageToView(p);
    if (this.pen) {
      const pts = this.pen.nodes.map((n) => ({ ...n }));
      if (this.pen.cur && !this.pen.dragging) pts.push({ x: this.pen.cur.x, y: this.pen.cur.y, i: null, o: null });
      const d = Pth.mapD(Pth.nodesToD(pts, false), ([x, y]) => { const v = V({ x, y }); return [v.x, v.y]; });
      s += `<path d="${esc(d)}" fill="none" stroke="#2d7ff9" stroke-width="1.5"/>`;
      for (const [k, n] of this.pen.nodes.entries()) {
        const v = V(n);
        s += `<rect x="${r3(v.x - 4)}" y="${r3(v.y - 4)}" width="8" height="8" fill="${k === 0 ? '#2d7ff9' : '#fff'}" stroke="#2d7ff9" stroke-width="1.5"/>`;
        for (const h of [n.i, n.o]) if (h) { const hv = V({ x: h[0], y: h[1] }); s += `<line x1="${r3(v.x)}" y1="${r3(v.y)}" x2="${r3(hv.x)}" y2="${r3(hv.y)}" stroke="#2d7ff9"/><circle cx="${r3(hv.x)}" cy="${r3(hv.y)}" r="3" fill="#fff" stroke="#2d7ff9"/>`; }
      }
    }
    if (this.pathEdit) {
      const n = this.node(this.pathEdit.id);
      if (n) {
        const L = (x, y) => V(G.fromLocal(n, { x, y }));
        for (const [k, nd] of this.pathEdit.nodes.entries()) {
          const v = L(nd.x, nd.y);
          for (const h of [nd.i, nd.o]) if (h) { const hv = L(h[0], h[1]); s += `<line x1="${r3(v.x)}" y1="${r3(v.y)}" x2="${r3(hv.x)}" y2="${r3(hv.y)}" stroke="#2d7ff9"/><circle data-ph="${k}" cx="${r3(hv.x)}" cy="${r3(hv.y)}" r="3.5" fill="#fff" stroke="#2d7ff9"/>`; }
          s += `<rect data-pn="${k}" x="${r3(v.x - 4)}" y="${r3(v.y - 4)}" width="8" height="8" fill="${this.pathEdit.sel === k ? '#2d7ff9' : '#fff'}" stroke="#2d7ff9" stroke-width="1.5"/>`;
        }
      }
    }
    if (this.crop) {
      const n = this.node(this.crop.id);
      if (n) {
        const f = cropFull(n);
        const tl = V(f.tl);
        const a = n.rotation || 0;
        // 원본 전체(흐리게) + 자른 창 테두리·핸들
        s += `<image href="${n.src.replace(/"/g, '&quot;')}" x="0" y="0" width="${r3(f.W * this.z)}" height="${r3(f.H * this.z)}" preserveAspectRatio="none" opacity="0.35" transform="translate(${r3(tl.x)} ${r3(tl.y)}) rotate(${r3(a)})"/>`;
        s += `<polygon points="${G.corners(n).map((c) => { const v = V(c); return `${r3(v.x)},${r3(v.y)}`; }).join(' ')}" fill="none" stroke="#2d7ff9" stroke-width="1.5"/>`;
        for (const h of cropHandles(this, n)) s += `<rect data-ch="${h.hx},${h.hy}" x="${r3(h.x - 5)}" y="${r3(h.y - 5)}" width="10" height="10" fill="#2d7ff9" stroke="#fff"/>`;
      }
    }
    return s;
  };

  // ---------- 펜 도구 ----------
  // 클릭 = 모서리 점, 끌기 = 곡선 점(핸들), 첫 점 클릭 = 닫기, 더블클릭·Enter·Esc = 열린 패스로 끝내기
  P.penDown = function (e, p) {
    if (!this.pen) this.pen = { nodes: [], cur: null };
    const pen = this.pen;
    if (e.detail >= 2 && pen.nodes.length >= 2) { this.finishPen(false); return; }
    const first = pen.nodes[0];
    if (first && pen.nodes.length >= 2) {
      const a = this.pageToView(first), b = this.pageToView(p);
      if (Math.hypot(a.x - b.x, a.y - b.y) <= PT_PX) { this.finishPen(true); return; }
    }
    const node = { x: p.x, y: p.y, i: null, o: null };
    pen.nodes.push(node);
    pen.dragging = true;
    this.track(e, (ev, q) => {
      node.o = [q.x, q.y];
      node.i = [2 * node.x - q.x, 2 * node.y - q.y];
      this.drawOverlay();
    }, () => { pen.dragging = false; this.drawOverlay(); });
    this.drawOverlay();
  };
  P.finishPen = function (closed) {
    const pen = this.pen;
    this.pen = null;
    if (!pen || pen.nodes.length < 2) { this.drawOverlay(); return; }
    const n = pathElementFrom(Pth.nodesToD(pen.nodes, closed), { closed });
    this.change('create', () => { this.page.elements.push(n); this.selection = [n.id]; });
    this.setTool('select');
  };

  // ---------- 패스 점 편집 ----------
  P.enterPathEdit = function (id) {
    const n = this.node(id);
    if (!n || n.type !== 'path') return;
    // 점을 지금 크기 기준으로(늘어난 상태 그대로 편집)
    const d = Pth.scaleD(n.d, n.w / (n.pw || n.w), n.h / (n.ph || n.h));
    const { nodes, closed } = Pth.dToNodes(d);
    this.pathEdit = { id, nodes, closed, sel: null, before: this.snapshot(), selBefore: [...this.selection] };
    this.selection = [id];
    this.drawOverlay(); this.onChange(this);
  };
  P.exitPathEdit = function () {
    if (!this.pathEdit) return;
    this.pathEdit = null;
    this.drawOverlay(); this.onChange(this);
  };
  // 화면 좌표에서 잡힌 점: { k, part: 'anchor' | 'i' | 'o' }
  P.pathHit = function (e) {
    const pe = this.pathEdit, n = pe && this.node(pe.id);
    if (!n) return null;
    const r = this.rect();
    const vx = e.clientX - r.left, vy = e.clientY - r.top;
    const near = (x, y) => { const v = this.pageToView(G.fromLocal(n, { x, y })); return Math.hypot(v.x - vx, v.y - vy) <= PT_PX; };
    for (let k = pe.nodes.length - 1; k >= 0; k--) {
      const nd = pe.nodes[k];
      for (const part of ['o', 'i']) if (nd[part] && near(nd[part][0], nd[part][1])) return { k, part };
      if (near(nd.x, nd.y)) return { k, part: 'anchor' };
    }
    return null;
  };
  P.pathEditDown = function (e, p) {
    const pe = this.pathEdit, n = this.node(pe.id);
    const hit = this.pathHit(e);
    if (!hit) return false;
    pe.sel = hit.k;
    const nd = pe.nodes[hit.k];
    const q0 = G.toLocal(n, p);
    const start = JSON.parse(JSON.stringify(nd));
    const before = this.snapshot(), selBefore = [...this.selection];
    this.track(e, (_ev, q) => {
      const l = G.toLocal(n, q), dx = l.x - q0.x, dy = l.y - q0.y;
      if (hit.part === 'anchor') {
        nd.x = start.x + dx; nd.y = start.y + dy;
        if (start.i) nd.i = [start.i[0] + dx, start.i[1] + dy];
        if (start.o) nd.o = [start.o[0] + dx, start.o[1] + dy];
      } else nd[hit.part] = [start[hit.part][0] + dx, start[hit.part][1] + dy];
      // 끄는 동안은 상자를 그대로 두고 경로만 바꾼다
      n.d = Pth.nodesToD(pe.nodes, pe.closed); n.pw = n.w; n.ph = n.h;
      this.render();
    }, (_ev, _q, moved) => {
      if (moved) { this.normalizePath(n); pe.nodes = Pth.dToNodes(n.d).nodes; this.commit('pathEdit', before, selBefore); }
      this.drawOverlay();
    });
    this.drawOverlay();
    return true;
  };
  P.deletePathNode = function () {
    const pe = this.pathEdit, n = this.node(pe.id);
    if (!n || pe.nodes.length <= 2) return;
    this.change('pathEdit', () => {
      pe.nodes.splice(pe.sel, 1);
      pe.sel = null;
      n.d = Pth.nodesToD(pe.nodes, pe.closed && pe.nodes.length > 2); n.pw = n.w; n.ph = n.h;
      this.normalizePath(n);
      pe.nodes = Pth.dToNodes(n.d).nodes;
    });
  };
  // 경로의 외곽 상자에 맞춰 요소 상자를 다시 잡는다(화면에서 점 위치는 그대로)
  P.normalizePath = function (n) {
    const b = Pth.boundsD(n.d);
    const w = Math.max(1, b.w), h = Math.max(1, b.h);
    const c = G.fromLocal(n, { x: b.x + b.w / 2, y: b.y + b.h / 2 });
    n.d = Pth.translateD(n.d, -b.x + (w - b.w) / 2, -b.y + (h - b.h) / 2);
    n.x = c.x - w / 2; n.y = c.y - h / 2; n.w = w; n.h = h; n.pw = w; n.ph = h;
  };

  // ---------- 이미지 자르기 ----------
  // 원본은 장 위에 고정하고 자른 창(요소 상자)만 바꾼다. 테두리 핸들 = 창 크기, 안쪽 끌기 = 보이는 부분 옮기기
  P.enterCrop = async function (id) {
    const n = this.node(id);
    if (!n || n.type !== 'image') return;
    if (!n.crop && n.fit && n.fit !== 'fill') {
      // 맞추기·채우기로 보이던 모양을 자르기 값으로 바꾼다
      const page = this.page;
      const nat = await this.imageSize(n.src).catch(() => null);
      if (this.page !== page || this.node(id) !== n) return; // 기다리는 사이 장이 바뀌었거나 요소가 지워짐
      if (nat) this.change('crop', () => fitToCrop(n, nat.w, nat.h));
    }
    this.crop = { id, before: this.snapshot(), selBefore: [...this.selection] };
    this.selection = [id];
    this.drawOverlay(); this.onChange(this);
  };
  P.exitCrop = function () {
    if (!this.crop) return;
    this.crop = null;
    this.drawOverlay(); this.onChange(this);
  };
  P.cropHandleAt = function (e) {
    const n = this.crop && this.node(this.crop.id);
    if (!n) return null;
    const r = this.rect();
    return cropHandles(this, n).find((h) => Math.abs(h.x - (e.clientX - r.left)) <= 7 && Math.abs(h.y - (e.clientY - r.top)) <= 7) || null;
  };
  P.cropDown = function (e, p) {
    const n = this.node(this.crop.id);
    if (!n) return false;
    const h = this.cropHandleAt(e);
    const f0 = cropFull(n);
    const box0 = { x: n.x, y: n.y, w: n.w, h: n.h, rotation: n.rotation || 0 };
    const before = this.snapshot(), selBefore = [...this.selection];
    if (h) {
      this.track(e, (_ev, q) => {
        const nb = G.resizeOne(box0, h.hx, h.hy, q, { min: 4 });
        let c = cropOf({ ...nb, rotation: box0.rotation }, f0);
        // 원본 밖으로 나가지 않게
        const x0 = Math.max(0, c.x), y0 = Math.max(0, c.y), x1 = Math.min(1, c.x + c.w), y1 = Math.min(1, c.y + c.h);
        c = { x: x0, y: y0, w: Math.max(1e-4, x1 - x0), h: Math.max(1e-4, y1 - y0) };
        Object.assign(n, boxOf(f0, c, box0.rotation), { crop: c, fit: 'fill' });
        this.render();
      }, (_ev, _q, moved) => { if (moved) this.commit('crop', before, selBefore); });
      return true;
    }
    if (!G.contains(n, p)) return false;
    const c0 = n.crop || { x: 0, y: 0, w: 1, h: 1 };
    this.track(e, (_ev, q) => {
      const tl = { x: f0.tl.x + q.x - p.x, y: f0.tl.y + q.y - p.y };
      const l = G.toLocal(box0, tl);
      const c = { x: Math.max(0, Math.min(1 - c0.w, -l.x / f0.W)), y: Math.max(0, Math.min(1 - c0.h, -l.y / f0.H)), w: c0.w, h: c0.h };
      Object.assign(n, { crop: c, fit: 'fill' });
      this.render();
    }, (_ev, _q, moved) => { if (moved) this.commit('crop', before, selBefore); });
    return true;
  };
  // 자르기 해제: 원본 전체가 보이도록 상자를 넓힌다
  P.resetCrop = function (id = this.selection[0]) {
    const n = this.node(id);
    if (!n || n.type !== 'image' || !n.crop) return false;
    return this.change('crop', () => { const f = cropFull(n); Object.assign(n, boxOf(f, { x: 0, y: 0, w: 1, h: 1 }, n.rotation || 0)); n.crop = null; });
  };

  // ---------- 조합 명령 ----------
  // 선택한 두 요소 중 target 종류 하나 + 모양 요소(도형·패스) 하나
  P.pairFor = function (targetTypes) {
    const ns = this.selectedNodes();
    if (ns.length !== 2) return null;
    const t = ns.find((n) => targetTypes.includes(n.type));
    const s = ns.find((n) => n !== t && (n.type === 'shape' || n.type === 'path'));
    return t && s ? { target: t, source: s } : null;
  };
  // 모양 요소의 외곽선을 target 요소 안 좌표로
  P.outlineIn = function (target, source) {
    return Pth.mapD(Pth.outlineOf(source), ([x, y]) => { const pg = G.fromLocal(source, { x, y }); const l = G.toLocal(target, pg); return [l.x, l.y]; });
  };
  // 이미지 + 도형 → 도형 모양으로 이미지를 자르고 도형은 지운다
  P.maskWithShape = function () {
    const pr = this.pairFor(['image']);
    if (!pr) return false;
    return this.change('mask', () => {
      pr.target.mask = { kind: 'shape', d: this.outlineIn(pr.target, pr.source), pw: pr.target.w, ph: pr.target.h };
      removeNode(this, pr.source.id);
      this.selection = [pr.target.id];
    });
  };
  // 글상자 + 도형 → 도형 모양을 글상자 영역으로, 도형은 지운다
  P.areaFromShape = function () {
    const pr = this.pairFor(['text']);
    if (!pr) return false;
    return this.change('area', () => {
      pr.target.area = { ...(pr.target.area || {}), kind: 'path', d: this.outlineIn(pr.target, pr.source), pw: pr.target.w, ph: pr.target.h };
      removeNode(this, pr.source.id);
      this.selection = [pr.target.id];
    });
  };
  // 도형·패스 → 같은 자리의 경로 글자(원래 요소는 지움)
  P.textOnPath = function (text = '경로를 따라 쓰는 글자') {
    const ns = this.selectedNodes();
    if (ns.length !== 1 || !['shape', 'path'].includes(ns[0].type)) return false;
    const src = ns[0];
    const f = M.find(this.page.elements, src.id);
    // 원·타원은 맨 위 가운데에 글자가 바로 서게(시작 9시, 시계 방향, 시작 위치 25%·가운데 정렬)
    const oval = src.type === 'shape' && src.shape === 'ellipse';
    const d = oval ? Pth.ellipseTextD(src.w / 2, src.h / 2, src.w / 2, src.h / 2) : Pth.outlineOf(src);
    const n = M.makeElement('pathText', { x: src.x, y: src.y, w: src.w, h: src.h, rotation: src.rotation || 0, d, pw: src.w, ph: src.h, text, ...(oval ? { offset: 25, anchor: 'middle' } : {}) });
    return this.change('pathText', () => { f.parent.splice(f.index, 1, n); this.selection = [n.id]; });
  };
  PV.addMode({ rank: 30, down: P.toolDown, hover: P.toolHover, key: P.toolKey, overlay: P.toolOverlay });
}

// ---------- 도우미 ----------
function removeNode(view, id) { const f = M.find(view.page.elements, id); if (f) f.parent.splice(f.index, 1); }

// 장 좌표 경로 → 패스 요소(상자 = 경로의 외곽 상자)
export function pathElementFrom(dPage, props = {}) {
  const b = Pth.boundsD(dPage);
  const w = Math.max(1, b.w), h = Math.max(1, b.h);
  return M.makeElement('path', { x: b.x - (w - b.w) / 2, y: b.y - (h - b.h) / 2, w, h, d: Pth.translateD(dPage, -b.x + (w - b.w) / 2, -b.y + (h - b.h) / 2), pw: w, ph: h, ...props });
}

// 자르기: 원본 전체의 왼쪽 위(장 좌표)와 크기
function cropFull(n) {
  const c = n.crop || { x: 0, y: 0, w: 1, h: 1 };
  const W = n.w / c.w, H = n.h / c.h;
  return { W, H, tl: G.fromLocal(n, { x: -c.x * W, y: -c.y * H }) };
}
// 상자 → 자르기 값(원본은 고정)
function cropOf(box, f) {
  const l = G.toLocal(box, f.tl);
  return { x: -l.x / f.W, y: -l.y / f.H, w: box.w / f.W, h: box.h / f.H };
}
// 자르기 값 → 상자(원본은 고정)
function boxOf(f, c, rot) {
  const a = G.rad(rot);
  const cx = (c.x + c.w / 2) * f.W, cy = (c.y + c.h / 2) * f.H;
  const center = { x: f.tl.x + cx * Math.cos(a) - cy * Math.sin(a), y: f.tl.y + cx * Math.sin(a) + cy * Math.cos(a) };
  const w = c.w * f.W, h = c.h * f.H;
  return { x: center.x - w / 2, y: center.y - h / 2, w, h };
}
function cropHandles(view, n) {
  const out = [];
  for (const hy of [-1, 0, 1]) for (const hx of [-1, 0, 1]) {
    if (!hx && !hy) continue;
    const v = view.pageToView(G.fromLocal(n, { x: n.w * (hx + 1) / 2, y: n.h * (hy + 1) / 2 }));
    out.push({ hx, hy, x: v.x, y: v.y });
  }
  return out;
}
// 맞추기·채우기 표시 → 같은 모양의 자르기 값
function fitToCrop(n, iw, ih) {
  if (n.fit === 'cover') {
    const k = Math.max(n.w / iw, n.h / ih);
    const cw = n.w / (iw * k), ch = n.h / (ih * k);
    n.crop = { x: (1 - cw) / 2, y: (1 - ch) / 2, w: cw, h: ch };
  } else if (n.fit === 'contain') {
    // 여백 없이 이미지만 남도록 상자를 줄인다
    const k = Math.min(n.w / iw, n.h / ih);
    const w = iw * k, h = ih * k, c = G.center(n);
    Object.assign(n, { x: c.x - w / 2, y: c.y - h / 2, w, h });
  }
  n.fit = 'fill';
}
