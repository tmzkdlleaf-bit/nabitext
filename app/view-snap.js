// 캔버스 화면(PageView)의 스냅: 요소를 옮기거나 크기를 바꿀 때 장 가장자리·가운데, 다른 요소, 가이드, 격자,
// 균등 간격에 붙인다. page-view.js가 mixin으로 PageView에 붙인다.

import * as M from './model.js';
import { mixin } from './util.js';

export const SNAP_PX = 6; // 스냅 거리(화면 px)

class SnapMethods {
  // ---------- 스냅 ----------
  // 움직이는 상자 b의 x 후보(왼·가운데·오른)와 y 후보를 장 가장자리·중심, 다른 요소 상자에 맞춘다
  snapTargets(exclude) {
    const xs = [0, this.page.w / 2, this.page.w], ys = [0, this.page.h / 2, this.page.h];
    const boxes = [{ x: 0, y: 0, w: this.page.w, h: this.page.h }];
    if (this.showGuides) for (const g of this.pageGuides()) (g.axis === 'x' ? xs : ys).push(g.pos);
    M.walk(this.page.elements, (n, _p, _i, anc) => {
      if (anc.length || exclude.has(n.id) || M.isHidden(n)) return; // 최상위 요소만
      const b = M.boundsOf(n);
      if (!b) return;
      boxes.push(b);
      xs.push(b.x, b.x + b.w / 2, b.x + b.w);
      ys.push(b.y, b.y + b.h / 2, b.y + b.h);
    });
    return { xs, ys, boxes };
  }

  // 반환: { dx, dy, guides } — b를 (dx, dy)만큼 옮기면 맞는다
  // 후보: 장 가장자리·중심, 다른 요소, 가이드, 격자(보일 때), 균등 간격(가까운 쪽이 이김)
  snapBox(b, t, { x = true, y = true } = {}) {
    const lim = SNAP_PX / this.z;
    const best = (vals, cands) => {
      let r = null;
      for (const v of vals) { const q = this.snapPick(v, cands, lim); if (q && (!r || Math.abs(q.d) < Math.abs(r.d))) r = q; }
      return r;
    };
    let bx = x ? best([b.x, b.x + b.w / 2, b.x + b.w], t.xs) : null;
    let by = y ? best([b.y, b.y + b.h / 2, b.y + b.h], t.ys) : null;
    const better = (e, q) => e && (!q || Math.abs(e.d) < Math.abs(q.d) - 1e-9);
    const ex = x ? this.equalSpacing({ ...b, y: b.y + (by?.d || 0) }, t, 'x', lim) : null;
    if (better(ex, bx)) bx = { d: ex.d, eq: ex };
    const ey = y ? this.equalSpacing({ ...b, x: b.x + (bx?.d || 0) }, t, 'y', lim) : null;
    if (better(ey, by)) by = { d: ey.d, eq: ey };
    this.spacing = [...(bx?.eq?.marks || []), ...(by?.eq?.marks || [])];
    return this.guidesFor(b, bx, by, t);
  }
  guidesFor(b, bx, by, t) {
    const dx = bx ? bx.d : 0, dy = by ? by.d : 0;
    const nb = { x: b.x + dx, y: b.y + dy, w: b.w, h: b.h };
    const guides = [];
    const span = (c, axis) => {
      // 안내선은 맞춘 상대(같은 값을 가진 상자들)와 움직이는 상자를 모두 덮게 그린다
      const hits = t.boxes.filter((o) => axis === 'x'
        ? [o.x, o.x + o.w / 2, o.x + o.w].some((v) => Math.abs(v - c) < 0.01)
        : [o.y, o.y + o.h / 2, o.y + o.h].some((v) => Math.abs(v - c) < 0.01));
      const all = [nb, ...hits];
      if (axis === 'x') guides.push({ a: { x: c, y: Math.min(...all.map((o) => o.y)) }, b: { x: c, y: Math.max(...all.map((o) => o.y + o.h)) } });
      else guides.push({ a: { x: Math.min(...all.map((o) => o.x)), y: c }, b: { x: Math.max(...all.map((o) => o.x + o.w)), y: c } });
    };
    if (bx && bx.c != null && !bx.grid) span(bx.c, 'x');
    if (by && by.c != null && !by.grid) span(by.c, 'y');
    return { dx, dy, guides };
  }

  // ---------- 스냅 보강 ----------
  // 값 v에 가장 가까운 후보(목록 + 격자). 반환 { d, c, grid } | null
  snapPick(v, cands, lim) {
    let r = null;
    for (const c of cands) { const d = c - v; if (Math.abs(d) <= lim && (!r || Math.abs(d) < Math.abs(r.d))) r = { d, c }; }
    if (this.showGrid && this.gridSize > 0) {
      const c = Math.round(v / this.gridSize) * this.gridSize, d = c - v;
      if (Math.abs(d) <= lim && (!r || Math.abs(d) < Math.abs(r.d) - 1e-9)) r = { d, c, grid: true };
    }
    return r;
  }

  // 균등 간격: 축(axis)을 따라 b를 옮길 후보. 반환 { d, gap, marks: [{ a, b }] } | null
  equalSpacing(b, t, axis, lim) {
    const X = axis === 'x';
    const lo = (o) => (X ? o.x : o.y), len = (o) => (X ? o.w : o.h);
    const hi = (o) => lo(o) + len(o);
    const cLo = (o) => (X ? o.y : o.x), cHi = (o) => cLo(o) + (X ? o.h : o.w);
    // 같은 줄: 다른 축으로 겹치는 상자(장 전체 상자는 뺌)
    const row = t.boxes.slice(1).filter((o) => cLo(o) < cHi(b) && cHi(o) > cLo(b));
    if (!row.length) return null;
    // 줄 안의 이웃 쌍 간격(겹치지 않는 것만)
    const sorted = [...row].sort((p, q) => lo(p) - lo(q));
    const pairs = [];
    for (let i = 0; i + 1 < sorted.length; i++) {
      const a = sorted[i];
      let nb = null;
      for (let j = i + 1; j < sorted.length; j++) if (lo(sorted[j]) >= hi(a) - 0.01 && (!nb || lo(sorted[j]) < lo(nb))) nb = sorted[j];
      if (nb) pairs.push({ a, b: nb, gap: lo(nb) - hi(a) });
    }
    const left = row.filter((o) => hi(o) <= lo(b) + lim && lo(o) < lo(b)).sort((p, q) => hi(q) - hi(p))[0];
    const right = row.filter((o) => lo(o) >= hi(b) - lim && hi(o) > hi(b)).sort((p, q) => lo(p) - lo(q))[0];
    const cands = [];
    if (left && right) { // 두 이웃 사이 가운데
      const gap = (lo(right) - hi(left) - len(b)) / 2;
      if (gap >= 0) cands.push({ pos: hi(left) + gap, gap, refs: [] });
    }
    for (const pr of pairs) {
      if (pr.gap < 0.5) continue;
      if (left && pr.b !== right) cands.push({ pos: hi(left) + pr.gap, gap: pr.gap, refs: [pr] });
      if (right && pr.a !== left) cands.push({ pos: lo(right) - pr.gap - len(b), gap: pr.gap, refs: [pr] });
    }
    let best = null;
    for (const c of cands) { const d = c.pos - lo(b); if (Math.abs(d) <= lim && (!best || Math.abs(d) < Math.abs(best.d))) best = { ...c, d }; }
    if (!best) return null;
    // 표시: 새 자리의 양쪽 간격(해당하는 것) + 기준 쌍
    const nb = X ? { ...b, x: b.x + best.d } : { ...b, y: b.y + best.d };
    const mid = (p, q) => (Math.max(cLo(p), cLo(q)) + Math.min(cHi(p), cHi(q))) / 2;
    const seg = (p, q) => { const m = mid(p, q); return X ? { axis: 'x', a: { x: hi(p), y: m }, b: { x: lo(q), y: m }, gap: lo(q) - hi(p) } : { axis: 'y', a: { x: m, y: hi(p) }, b: { x: m, y: lo(q) }, gap: lo(q) - hi(p) }; };
    const marks = [];
    if (left && Math.abs(lo(nb) - hi(left) - best.gap) < 0.01) marks.push(seg(left, nb));
    if (right && Math.abs(lo(right) - hi(nb) - best.gap) < 0.01) marks.push(seg(nb, right));
    for (const pr of best.refs) marks.push(seg(pr.a, pr.b));
    return { d: best.d, gap: best.gap, marks };
  }

}

export function installSnap(PV) { mixin(PV, SnapMethods); }
