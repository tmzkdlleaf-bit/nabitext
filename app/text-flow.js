// 이어진 글상자(글 흐름): 넘친 글이 다음 글상자로 이어진다. 다른 장의 글상자로도 이을 수 있다(설정에서 끌 수 있음).
// 모델: 글상자 { story, seq } (app/model.js storyOf·storyFrames). 편집기는 이야기마다 하나(app/page-view.js syncStory).
//
// 조작
//   - 글상자의 출구(오른쪽 아래 바깥의 작은 네모. 넘치면 빨간 +)를 클릭 → 잇기 모드
//     · 다른 글상자 클릭 = 그 글상자로 잇기(그 글상자에 있던 글은 이야기 끝에 붙음)
//     · 빈 곳 클릭 = 같은 크기의 새 글상자를 만들어 잇기, 빈 곳 끌기 = 그린 크기로 새 글상자
//     · Esc = 취소
//   - 속성 패널: 글상자 두 개 선택 → "글상자 잇기"(먼저 고른 것 → 나중 것), 이어진 글상자 → "이어짐에서 빼기"
//   - 이어진 글상자를 지우면 글은 남은 글상자로 다시 흐른다

import * as G from './geom.js';
import * as M from './model.js';
import { r3 } from './util.js';
import { isMaster } from './master.js';

const PORT_PX = 7;     // 출구 네모 반지름(화면 px)
const PORT_GAP_PX = 14; // 글상자 오른쪽 변에서 출구까지(화면 px)

export function installTextFlow(PV) {
  const P = PV.prototype;
  P.flowDown = function (e, p, vx, vy) {
    if (this.linking) { this.linkDown(e, p); return true; }
    if (this.tool === 'select' && !this.crop && !this.pathEdit) {
      const port = this.portAt(vx, vy);
      if (port) { this.startLinking(port); return true; }
    }
    return false;
  };
  P.flowHover = function (e, p) {
    if (this.linking) {
      this.linking.cur = p;
      const t = this.linkTarget(p);
      this.viewport.style.cursor = t ? 'alias' : 'crosshair';
      this.linking.target = t?.id ?? null;
      this.drawOverlay();
      return true;
    }
    if (this.tool === 'select' && !this.crop && !this.pathEdit) {
      const r = this.rect();
      if (this.portAt(e.clientX - r.left, e.clientY - r.top)) { this.viewport.style.cursor = 'pointer'; return true; }
    }
    return false;
  };
  P.flowKey = function (e) {
    if (this.linking && e.key === 'Escape') { this.cancelLinking(); return true; }
    return false;
  };
  P.flowOverlay = function () {
    let s = '';
    const V = (q) => this.pageToView(q);
    const label = (x, y, t, anchor = 'start') => `<text x="${r3(x)}" y="${r3(y)}" font-size="11" fill="#2d7ff9" font-family="sans-serif" text-anchor="${anchor}">${t}</text>`;
    // 선택하거나 편집 중인 이야기의 흐름(글상자 k 출구 → k+1 입구). 다른 장으로 이어지면 "→ 3장", 다른 장에서 오면 "2장에서 →"
    const shown = new Set();
    for (const id of [...this.selection, this.editing].filter(Boolean)) { const n = this.node(id); if (n?.type === 'text') shown.add(M.storyOf(n)); }
    if (this.linking) shown.add(this.linking.story);
    const pno = (pg) => this.pageIndex(pg) + 1;
    for (const [sid, ents] of this.stories()) {
      if (!ents.some((e) => e.page === this.page)) continue;
      const ed = this.editors.get(sid);
      const lastE = ents[ents.length - 1];
      const over = ed?.overflow != null;
      if (shown.has(sid) && ents.length > 1) {
        ents.forEach((e, k) => {
          if (e.page !== this.page) return;
          const c = V(G.fromLocal(e.n, { x: 0, y: 0 }));
          s += label(c.x + 4, c.y - 5, `${k + 1}/${ents.length}`);
          const prev = ents[k - 1], next = ents[k + 1];
          if (prev && prev.page !== this.page) s += label(c.x - 4, c.y - 5, `${pno(prev.page)}장에서 →`, 'end');
          if (next && next.page === this.page) {
            const a = V(outPort(this, e.n)), b = V(G.fromLocal(next.n, { x: 0, y: 0 }));
            s += `<path data-thread="${e.n.id}" d="M${r3(a.x)} ${r3(a.y)}L${r3(b.x)} ${r3(b.y)}" stroke="#2d7ff9" stroke-width="1.2" stroke-dasharray="4 3" fill="none"/>` +
              `<circle cx="${r3(b.x)}" cy="${r3(b.y)}" r="3" fill="#2d7ff9"/>`;
          } else if (next) {
            const a = V(outPort(this, e.n));
            s += `<g data-next-page="${pno(next.page)}">${label(a.x + PORT_PX + 4, a.y + 4, `→ ${pno(next.page)}장`)}</g>`;
          }
        });
      }
      // 출구: 넘치면 항상(빨간 +), 아니면 선택한 이야기의 마지막 글상자에만. 마지막 글상자가 이 장에 있을 때
      if ((over || shown.has(sid)) && lastE.page === this.page) {
        const last = lastE.n;
        const c = V(outPort(this, last));
        const col = over ? '#e5484d' : '#2d7ff9';
        s += `<g data-port="${last.id}"${over ? ` data-overflow="${last.id}"` : ''}><rect x="${r3(c.x - PORT_PX)}" y="${r3(c.y - PORT_PX)}" width="${PORT_PX * 2}" height="${PORT_PX * 2}" fill="#fff" stroke="${col}" stroke-width="1.5"/>` +
          (over ? `<path d="M${r3(c.x - 4)} ${r3(c.y)}h8M${r3(c.x)} ${r3(c.y - 4)}v8" stroke="${col}" stroke-width="1.5"/>` : `<path d="M${r3(c.x - 2)} ${r3(c.y - 4)}l4 4l-4 4" stroke="${col}" stroke-width="1.5" fill="none"/>`) + '</g>';
      }
    }
    if (this.linking) {
      const L = this.linking;
      const from = this.node(L.from);
      const t = L.target && this.node(L.target);
      const b = t ? V(G.fromLocal(t, { x: 0, y: 0 })) : L.cur ? V(L.cur) : null;
      if (from) {
        const a = V(outPort(this, from));
        if (b) s += `<path d="M${r3(a.x)} ${r3(a.y)}L${r3(b.x)} ${r3(b.y)}" stroke="#2d7ff9" stroke-width="1.5" stroke-dasharray="5 3" fill="none"/>`;
      } else if (b) {
        // 다른 장에서 시작한 잇기: 커서 옆에 어디서 왔는지 표시
        const src = this.nodeAny(L.from);
        if (src) s += `<g data-linking-from="${pno(src.page)}">${label(b.x + 12, b.y - 8, `${pno(src.page)}장 글상자에서 잇는 중 (Esc 취소)`)}</g>`;
      }
      if (t) s += `<polygon points="${G.corners(t).map((q) => { const v = V(q); return `${r3(v.x)},${r3(v.y)}`; }).join(' ')}" fill="rgba(45,127,249,.08)" stroke="#2d7ff9" stroke-width="2"/>`;
      if (L.box) { const bx = L.box; const p0 = V(bx), p1 = V({ x: bx.x + bx.w, y: bx.y + bx.h }); s += `<rect x="${r3(p0.x)}" y="${r3(p0.y)}" width="${r3(p1.x - p0.x)}" height="${r3(p1.y - p0.y)}" fill="none" stroke="#2d7ff9" stroke-dasharray="4 3"/>`; }
    }
    return s;
  };

  // 화면 좌표(뷰포트 기준)에 있는 출구 → 그 글상자 id
  P.portAt = function (vx, vy) {
    const shown = new Set(this.selection.map((id) => this.node(id)).filter((n) => n?.type === 'text').map(M.storyOf));
    for (const [sid, ents] of this.stories()) {
      const lastE = ents[ents.length - 1];
      if (lastE.page !== this.page) continue;
      const last = lastE.n;
      const ed = this.editors.get(sid);
      if (!(ed?.overflow != null || shown.has(sid))) continue;
      const f = M.find(this.page.elements, last.id);
      if (M.isHidden(last, f.ancestors) || M.isLocked(last, f.ancestors)) continue;
      const c = this.pageToView(outPort(this, last));
      if (Math.abs(c.x - vx) <= PORT_PX + 2 && Math.abs(c.y - vy) <= PORT_PX + 2) return last.id;
    }
    return null;
  };

  P.startLinking = function (fromId) {
    if (this.editing) this.exitEdit();
    const f = this.nodeAny(fromId);
    this.linking = { from: fromId, story: M.storyOf(f.n), page: f.page, cur: null, target: null, box: null };
    this.viewport.style.cursor = 'crosshair';
    this.drawOverlay();
    this.onChange(this);
  };
  P.cancelLinking = function () {
    this.linking = null;
    this.viewport.style.cursor = 'default';
    this.drawOverlay();
    this.onChange(this);
  };
  // 이 장에서 잇기를 계속할 수 있는가: 같은 장, 또는 "다른 장의 글상자와 잇기"가 켜져 있고 뒤쪽 장
  P.linkAllowedHere = function () {
    const L = this.linking;
    if (!L) return false;
    if (L.page === this.page) return true;
    if (isMaster(L.page) || isMaster(this.page)) return false; // 공통 장의 글은 공통 장 안에서만 잇는다
    return this.crossPageLinks !== false && this.pageIndex(this.page) > this.pageIndex(L.page);
  };
  // 이을 수 있는 글상자: 다른 이야기의 글상자(잠김·숨김 제외). 흐름은 장 순서를 따르므로 앞쪽 장으로는 잇지 않는다
  P.linkTarget = function (p) {
    if (!this.linkAllowedHere()) return null;
    const hit = this.hitTest(p);
    const n = hit?.leaf;
    if (!n || n.type !== 'text' || M.storyOf(n) === this.linking.story) return null;
    return n;
  };
  P.linkDown = function (e, p0) {
    const L = this.linking;
    if (!this.linkAllowedHere()) { this.cancelLinking(); return; }
    const t = this.linkTarget(p0);
    if (t) { this.linking = null; this.linkFrames(L.from, t.id); this.viewport.style.cursor = 'default'; return; }
    // 빈 곳: 클릭 = 같은 크기, 끌기 = 그린 크기로 새 글상자
    this.track(e, (_ev, p) => {
      L.box = { x: Math.min(p0.x, p.x), y: Math.min(p0.y, p.y), w: Math.abs(p.x - p0.x), h: Math.abs(p.y - p0.y) };
      this.drawOverlay();
    }, (_ev, _p, moved) => {
      this.linking = null;
      this.viewport.style.cursor = 'default';
      const src = this.nodeAny(L.from)?.n;
      if (!src) return this.drawOverlay();
      const box = moved && L.box && L.box.w >= 8 && L.box.h >= 8 ? L.box : { x: p0.x, y: p0.y, w: src.w, h: src.h };
      const n = M.makeElement('text', { x: r3(box.x), y: r3(box.y), w: r3(box.w), h: r3(box.h), padding: src.padding || 0 });
      this.history.batch(() => {
        this.change('create', () => { this.page.elements.push(n); this.selection = [n.id]; });
        this.linkFrames(L.from, n.id);
      });
    });
  };

  // a(이야기의 한 글상자) 바로 뒤에 b의 이야기(b가 속한 글상자 전부)를 끼워 넣는다. b 이야기의 글은 a 이야기 끝에 붙인다.
  // a와 b는 다른 장이어도 된다(b가 뒤쪽 장). 흐르는 순서는 장 순서, 같은 장 안에서는 seq
  P.linkFrames = function (aId, bId) {
    const A = this.nodeAny(aId), B = this.nodeAny(bId);
    if (!A || !B || A.n.type !== 'text' || B.n.type !== 'text') return false;
    if (A.page !== B.page && (isMaster(A.page) || isMaster(B.page) || this.crossPageLinks === false || this.pageIndex(B.page) < this.pageIndex(A.page))) return false;
    const sa = M.storyOf(A.n), sb = M.storyOf(B.n);
    if (sa === sb) return false;
    const la = this.storyList(sa), lb = this.storyList(sb);
    const edA = this.editors.get(sa), edB = this.editors.get(sb);
    if (this.editing) this.exitEdit();
    return this.history.batch(() => {
      // b 이야기의 글 → a 이야기 끝
      if (edA && edB && edB.state.doc.textContent.length + countImages(edB.state.doc) > 0) {
        const tr = edA.state.tr;
        const docA = edA.state.doc;
        const emptyA = docA.childCount === 1 && docA.firstChild.content.size === 0;
        if (emptyA) tr.replaceWith(0, docA.content.size, edB.state.doc.content);
        else tr.insert(docA.content.size, edB.state.doc.content);
        edA.dispatch(tr);
      }
      const ia = la.findIndex((e) => e.n === A.n);
      const order = [...la.slice(0, ia + 1), ...lb, ...la.slice(ia + 1)];
      return this.changeMany('link', order.map((e) => e.page), () => {
        order.forEach((e, k) => {
          const cur = e.n;
          if (k === 0 && cur.id === sa) delete cur.story; else cur.story = sa;
          cur.seq = k;
        });
        if (B.page === this.page) this.selection = [bId];
      });
    });
  };

  // 글상자 하나를 이어짐에서 뺀다(빈 글상자로 남고, 글은 나머지 글상자로 다시 흐름)
  P.unlinkFrame = function (id) {
    const n = this.node(id);
    if (!n || n.type !== 'text') return false;
    const sid = M.storyOf(n);
    const list = this.storyList(sid);
    if (list.length < 2) return false;
    if (this.editing) this.exitEdit();
    return this.changeMany('unlink', list.map((e) => e.page), () => {
      n.story = M.uid(); // 새 이야기(빈 글)
      n.doc = M.emptyDoc();
      delete n.seq;
      list.filter((e) => e.n.id !== id).forEach((e, k) => { const cur = e.n; cur.seq = k; if (cur.id === sid) delete cur.story; else cur.story = sid; });
    });
  };

  // 다음 장으로 이어 쓰기: 이야기의 마지막 글상자와 같은 자리·크기의 글상자를 다음 장에 만들어 잇는다(다음 장이 없으면 새로 만든다)
  P.flowToNextPage = function (id) {
    if (this.crossPageLinks === false || isMaster(this.page)) return false;
    const f = this.nodeAny(id);
    if (!f || f.n.type !== 'text') return false;
    const ents = this.storyList(M.storyOf(f.n));
    const last = ents[ents.length - 1];
    if (this.editing) this.exitEdit();
    return this.history.batch(() => {
      const pages = this.pagesAll();
      let next = pages[pages.indexOf(last.page) + 1];
      if (!next) next = this.addPageAfter?.(last.page);
      if (!next) return false;
      if (next !== this.page) this.showPage?.(next);
      const src = last.n;
      const n = M.makeElement('text', { x: src.x, y: src.y, w: src.w, h: src.h, rotation: src.rotation || 0, padding: src.padding || 0,
        ...(src.area ? { area: JSON.parse(JSON.stringify(src.area)) } : {}) });
      this.change('create', () => { this.page.elements.push(n); this.selection = [n.id]; });
      this.linkFrames(src.id, n.id);
      this.select([n.id]);
      return true;
    });
  };

  PV.addMode({ rank: 20, down: P.flowDown, hover: P.flowHover, key: P.flowKey, overlay: P.flowOverlay });
}

function countImages(doc) { let k = 0; doc.descendants((n) => { if (n.type.name === 'image') k++; }); return k; }

// 출구 위치(장 좌표): 오른쪽 변 바깥, 아래쪽. 확대와 관계없이 화면에서 같은 간격
function outPort(view, n) {
  return G.fromLocal(n, { x: n.w + PORT_GAP_PX / view.z, y: Math.max(0, n.h - PORT_GAP_PX / view.z) });
}
