// 캔버스 화면: 한 장(page)을 그리고 요소를 선택·이동·리사이즈·회전한다. 글상자는 CanvasEditor로 캔버스 위에서 바로 편집한다.
// 이 파일은 뼈대(모델 변경 기록, 그리기, 좌표·확대, 선택, 마우스 조작, 편집 모드)이고 나머지는 mixin으로 붙인다:
//   view-stories.js(글상자 편집기·이어진 글상자·프리셋·출력 DOM), view-snap.js(스냅), view-commands.js(명령),
//   modes.js(펜·자르기·점 편집), text-flow.js(글상자 잇기), guides.js(눈금자·가이드·격자). 모드는 addMode 순위대로 입력을 받는다.
//
// 좌표: 장 좌표(px) ↔ 화면 좌표. 스테이지를 left/top(px, py)로 옮기고 scale(z)로 확대하며, 선택 상자·핸들은 확대와 무관하게
// 같은 두께로 보이도록 확대하지 않는 겹침 SVG(overlay)에 화면 좌표로 그린다.
// 요소 변경은 모두 ModelEntry(전/후 트리 스냅숏)로 전역 되돌리기 스택에 기록한다. 글자 편집은 편집기가 TextEntry로 기록한다.

import * as G from './geom.js';
import * as M from './model.js';
import { trackPointer } from './util.js';
import { buildMasterLayer, masterKey, pageNumber } from './master.js';
import { r3, pageCss, pageBgCss, boxCss, contentOf, contentKey } from './render-el.js';
import { installModes, pathElementFrom } from './modes.js';
import { installTextFlow } from './text-flow.js';
import { installStories } from './view-stories.js';
import { installSnap, SNAP_PX } from './view-snap.js';
import { installCommands } from './view-commands.js';
import { installGuides } from './guides.js';

const HANDLE_PX = 8;      // 핸들 크기(화면 px)
const ROTATE_GAP_PX = 26; // 회전 핸들과 상자 윗변 사이(화면 px)
const CLICK_SLOP_PX = 3;  // 이만큼 움직이기 전까지는 클릭으로 본다
const Z_MIN = 0.05, Z_MAX = 16;

const CSS = `
.pv-viewport{position:relative;overflow:hidden;outline:none;background:#e4e2de;touch-action:none}
.pv-stage{position:absolute;left:0;top:0;transform-origin:0 0}
.pv-page{box-shadow:0 1px 4px rgba(0,0,0,.18)}
.pv-overlay{position:absolute;inset:0;width:100%;height:100%;pointer-events:none;overflow:visible}
`;
let cssInjected = false;

// 요소 DOM은 render-el.js(화면과 출력이 같은 함수)
export { pageCss } from './render-el.js';
const SVGNS = 'http://www.w3.org/2000/svg';

export class PageView {
  // ---------- 모드(가이드·글 흐름·펜/자르기/점 편집) ----------
  // 각 모듈이 addMode로 등록한다. 마우스·키는 순위가 낮은 것부터 물어보고(처리하면 멈춤), 겹침 표시는 순위가 높은 것부터 쌓는다.
  static modes = [];
  static addMode(m) { this.modes.push(m); this.modes.sort((a, b) => a.rank - b.rank); }
  modeDown(e, p, vx, vy) { for (const m of PageView.modes) if (m.down?.call(this, e, p, vx, vy)) return true; return false; }
  modeHover(e, p) { for (const m of PageView.modes) if (m.hover?.call(this, e, p)) return true; return false; }
  modeKey(e) { for (const m of PageView.modes) if (m.key?.call(this, e)) return true; return false; }
  modeOverlay() { let s = ''; for (let i = PageView.modes.length - 1; i >= 0; i--) if (PageView.modes[i].overlay) s += PageView.modes[i].overlay.call(this); return s; }

  // root: 캔버스를 넣을 요소(크기는 부모가 정함)
  // opts: history(전역 되돌리기), keymap(편집기), appKeymap(캔버스), assets(이미지 크기 캐시), nativePaste, onChange
  // importImage(src | File) → Promise<에셋 주소 | null>: 들어오는 이미지를 에셋 저장소로(app/assets.js). 없으면 그대로 쓴다.
  constructor(root, { history, keymap, appKeymap, assets = new Map(), nativePaste = null, onChange = () => {}, importImage = null }) {
    if (!cssInjected) { document.head.insertAdjacentHTML('beforeend', `<style>${CSS}</style>`); cssInjected = true; }
    Object.assign(this, { history, keymap, appKeymap, assets, nativePaste, onChange, importImage });
    this.viewport = document.createElement('div');
    this.viewport.className = 'pv-viewport';
    this.viewport.tabIndex = 0;
    this.stage = document.createElement('div');
    this.stage.className = 'pv-stage';
    this.pageEl = document.createElement('div');
    this.pageEl.className = 'pv-page';
    this.overlay = document.createElementNS(SVGNS, 'svg');
    this.overlay.setAttribute('class', 'pv-overlay');
    this.stage.appendChild(this.pageEl);
    // 글상자 편집기의 숨긴 입력창을 모아 두는 층
    this.inputLayer = document.createElement('div');
    this.inputLayer.className = 'pv-inputs';
    this.inputLayer.style.cssText = 'position:absolute;left:0;top:0;width:0;height:0;pointer-events:none';
    this.stage.appendChild(this.inputLayer); // 장 요소와 같은 원점(장 요소의 자식 순서는 요소 순서만 담게 밖에 둔다)
    this.viewport.append(this.stage, this.overlay);
    root.appendChild(this.viewport);

    this.page = M.newPage();
    this.images = new Map(); // 글상자 모양용으로 불러온 이미지(src → HTMLImageElement)
    this.tool = 'select';
    this.selection = [];     // 선택한 요소 id(보통 최상위 요소)
    this.editing = null;     // 편집 중인 글상자 id
    this.nodes = new Map();  // id → 요소 DOM(지운 요소도 되살릴 때 쓰려고 남겨 둠)
    this.editors = new Map();// 이야기(story) id → CanvasEditor(지워도 남겨 둠: 되돌리기의 TextEntry가 같은 편집기를 가리키므로)
                             // 이야기 id = 글상자의 story 속성, 없으면 글상자 id. 이어진 글상자들은 한 편집기(한 문서)를 나눠 쓴다.
    this.regions = new Map();// 글상자 id → { key, built } (영역 계산은 이미지 외곽선이면 수 ms라 모양이 바뀔 때만)
    this.waiting = new Set();// 이미지 외곽선 이미지를 기다리는 src
    this.presets = {};       // 스타일 프리셋(프로젝트) id → { name, style, align, spacing, indent }
    this.guides = [];        // 스냅 안내선(장 좌표)
    this.marquee = null;
    this.hover = null;
    this.drag = null;
    this.clip = null;        // 요소 복사본(붙여넣기용)
    this.z = 1; this.px = 0; this.py = 0;
    this.spaceDown = false;
    this.initGuides();
    this.bind();
    this.autoFit = true; // 사용자가 확대·이동하기 전까지는 창 크기가 바뀌면 다시 '화면에 맞춤'
    const onResize = () => { this._rect = null; if (this.autoFit) this.zoomFit(); else this.setView(this.z, this.px, this.py); };
    new ResizeObserver(onResize).observe(this.viewport);
    window.addEventListener('resize', () => { this._rect = null; });
  }

  // ---------- 모델 ----------
  setPage(page) {
    if (this.keepEditing) {
      // 편집 중 커서가 다른 장의 이어진 글상자로 넘어감: 편집을 끝내지 않고 장만 바꾼다
      const id = this.keepEditing;
      this.page = page;
      this.editing = id;
      this.selection = [id];
      this.render();
      this.zoomFit();
      return;
    }
    if (this.editing) this.exitEdit();
    this.page = page;
    this.selection = [];
    this.render();
    this.zoomFit();
  }

  // 새 프로젝트·열기: 편집기와 요소 DOM을 모두 버린다
  resetAll() {
    if (this.editing) this.exitEdit();
    if (this.linking) this.linking = null;
    for (const el of this.nodes.values()) el.remove();
    this.nodes.clear();
    for (const ed of this.editors.values()) ed.destroy(); // 입력창·되돌리기 훅을 떼어 옛 편집기가 남지 않게
    this.editors.clear();
    this.regions.clear();
    this.images.clear();
    this.imageJobs?.clear();
    this.waiting.clear();
    this._stories = null;
    this.selection = [];
  }

  node(id) { return M.find(this.page.elements, id)?.node ?? null; }
  // 이야기 id → 문서 JSON(편집기가 없으면 undefined)
  docOf = (sid) => this.editors.get(sid)?.state.doc.toJSON();
  editorOf(n) { return n ? this.editors.get(M.storyOf(n)) ?? null : null; }
  // 프로젝트의 모든 장(앱이 바꿔 끼움). 지금 장이 목록에 없으면(검증용 등) 덧붙인다
  // 공통 장이 있으면 맨 끝에 붙인다(공통 장의 글은 공통 장 안에서만 흐른다: text-flow.js가 막음)
  pagesAll() {
    const ps = this.allPages?.() || [], m = this.getMaster?.();
    const all = m && !ps.includes(m) ? [...ps, m] : ps;
    return all.includes(this.page) ? all : [...all, this.page];
  }
  pageIndex(page) { return this.pagesAll().indexOf(page); }
  // 이야기 → [{ n, page }] (프로젝트 전체, 흐르는 순서)
  // 모델이 바뀌면(render가 부름) 다시 계산한다. 그 사이(글 입력·마우스 올리기·겹침 표시)에는 캐시를 쓴다
  stories() { return (this._stories ||= M.storyFramesAll(this.pagesAll())); }
  storyList(sid) { return this.stories().get(sid) || []; }
  // 같은 이야기의 글상자들(이어진 순서, 여러 장 포함)
  storyMembers(sid) { return this.storyList(sid).map((e) => e.n); }
  // 어느 장에 있든 id로 요소 찾기 → { n, page } | null
  nodeAny(id) {
    for (const page of this.pagesAll()) { const f = M.find(page.elements, id); if (f) return { n: f.node, page }; }
    return null;
  }
  serialize() { return M.serializePage(this.page, this.docOf); }

  // 변경 기록: fn이 트리를 바꾼 뒤 전/후 스냅숏을 되돌리기 스택에 넣는다
  change(label, fn) {
    const before = this.snapshot(), selBefore = [...this.selection];
    const r = fn();
    if (r === false) return false;
    this.render();
    // 실제로 바뀐 것이 없으면 기록하지 않는다(예: 색을 끌며 바꾼 뒤 같은 값으로 확정)
    const entry = new M.ModelEntry(this, label, before, this.snapshot(), selBefore, [...this.selection]);
    if (entry.empty && selBefore.join() === this.selection.join()) { this.onChange(this); return false; }
    this.history.record(entry);
    this.onChange(this);
    return true;
  }
  // 여러 장을 한 번에 바꾸는 변경(장을 넘는 잇기 등). 장마다 ModelEntry를 만들어 한 단위로 묶는다
  changeMany(label, pages, fn) {
    pages = [...new Set([this.page, ...pages])];
    if (pages.length === 1) return this.change(label, fn);
    const befores = pages.map((p) => [p, M.snapshot(p)]), selBefore = [...this.selection];
    if (fn() === false) return false;
    this.render();
    this.history.batch(() => {
      for (const [p, b] of befores) {
        const here = p === this.page;
        const entry = new M.ModelEntry(this, label, b, M.snapshot(p), here ? selBefore : [], here ? [...this.selection] : [], p, !here);
        if (!entry.empty) this.history.record(entry);
      }
    });
    this.onChange(this);
    return true;
  }
  commit(label, before, selBefore) {
    this.history.record(new M.ModelEntry(this, label, before, this.snapshot(), selBefore, [...this.selection]));
    this.onChange(this);
  }
  snapshot() { return M.snapshot(this.page); }
  // 되돌리기에서 부른다. page: 기록할 때의 장(여러 장 단계에서 다른 장의 항목이면 그 장으로 전환)
  restore(snap, sel, page = this.page, quiet = false) {
    if (page !== this.page && quiet) {
      // 다른 장의 곁가지 변경(여러 장에 걸친 잇기 등): 화면은 그대로 두고 그 장 모델만 되돌린다
      page.elements = M.cloneTree(snap.elements);
      for (const k of M.PAGE_PROPS) page[k] = snap[k];
      this.render();
      return;
    }
    if (page !== this.page) this.showPage?.(page);
    this.page.elements = M.cloneTree(snap.elements);
    for (const k of M.PAGE_PROPS) this.page[k] = snap[k];
    this.selection = sel.filter((id) => this.node(id));
    if (this.editing && !this.node(this.editing)) this.exitEdit();
    this.render();
    this.onChange(this);
  }

  // ---------- 렌더링 ----------
  render() {
    this._stories = null;
    this.pageEl.style.cssText = pageCss(this.page) + pageBgCss(this.page);
    this.syncStories(this.page);
    const keep = new Set();
    let prev = this.syncMaster(); // 공통 장 층(있으면 맨 앞 자식)
    M.walk(this.page.elements, (n, _p, _i, anc) => {
      if (n.type === 'group') return;
      keep.add(n.id);
      const el = this.nodes.get(n.id) || this.createNodeEl(n);
      this.syncNodeEl(el, n, M.isHidden(n, anc));
      const want = prev ? prev.nextSibling : this.pageEl.firstChild;
      if (want !== el) this.pageEl.insertBefore(el, want);
      prev = el;
    });
    for (const [id, el] of this.nodes) if (!keep.has(id) && el.parentNode) el.remove();
    for (const ed of this.editors.values()) if (ed.stale.some(Boolean)) ed.renderPending();
    this.drawOverlay();
  }

  // 공통 장 층: 지금 장이 공통 장이 아니고, 이 장에서 끄지 않았고, 공통 장에 요소가 있으면 맨 뒤에 깐다
  masterFor(page) {
    const m = this.getMaster?.();
    return m && m !== page && !page.noMaster && m.elements.length ? m : null;
  }
  masterCtx() {
    return {
      docOf: this.docOf, images: this.images, presets: this.presets, presetsKey: this.presetsKey, assets: this.assets,
      loadImage: (src) => { if (this.waiting.has(src)) return; this.waiting.add(src); this.loadImage(src).then(() => { this.waiting.delete(src); this.render(); }); },
    };
  }
  pageNumberOf(page) { return pageNumber(this.allPages?.() || [page], page, this.pageStart?.() ?? 1); }
  syncMaster() {
    const m = this.masterFor(this.page);
    if (!m) { this.masterEl?.remove(); return null; }
    const pn = this.pageNumberOf(this.page), ctx = this.masterCtx();
    const key = masterKey(m, pn, ctx);
    if (!this.masterEl || this.masterEl._key !== key) {
      const el = buildMasterLayer(m, pn, ctx);
      el._key = key;
      this.masterEl?.remove();
      this.masterEl = el;
    }
    if (this.pageEl.firstChild !== this.masterEl) this.pageEl.prepend(this.masterEl);
    return this.masterEl;
  }

  createNodeEl(n) {
    const el = document.createElement('div');
    el.className = 'pv-el';
    el.dataset.id = n.id;
    this.nodes.set(n.id, el);
    return el;
  }

  syncNodeEl(el, n, hidden) {
    el.style.cssText = boxCss(n) + (hidden ? 'display:none;' : '');
    if (n.type === 'text') {
      const ed = this.editorOf(n);
      if (!ed) return;
      const k = ed.members.indexOf(n.id);
      const v = k > 0 ? ed.more[k - 1] : { host: ed.host, overlay: ed.overlay };
      if (v.host.parentNode !== el) el.replaceChildren(v.host);
      const on = !!this.editing && this.editorOf(this.node(this.editing)) === ed;
      v.host.style.pointerEvents = on ? 'auto' : 'none';
      v.overlay.style.display = on ? '' : 'none';
    } else if (n.type !== 'group') {
      const key = contentKey(n);
      if (el._key !== key) { const c = contentOf(n); if (c) el.replaceChildren(c); else el.replaceChildren(); el._key = key; }
    }
  }

  // ---------- 좌표·확대 ----------
  // 캔버스 영역의 화면 위치. 크기가 바뀔 때만(ResizeObserver·창 크기) 다시 잰다.
  // 그리기 중에 getBoundingClientRect를 부르면 방금 바꾼 DOM 때문에 브라우저가 배치를 강제로 다시 계산해(강제 리플로) 프레임이 밀린다.
  rect() {
    if (!this._rect) { const r = this.viewport.getBoundingClientRect(); this._rect = { left: r.left, top: r.top, width: r.width, height: r.height, right: r.right, bottom: r.bottom }; }
    return this._rect;
  }
  clientToPage(cx, cy) {
    const r = this.rect();
    return { x: (cx - r.left - this.px) / this.z, y: (cy - r.top - this.py) / this.z };
  }
  pageToView(p) { return { x: p.x * this.z + this.px, y: p.y * this.z + this.py }; }
  pageToClient(p) { const r = this.rect(); const v = this.pageToView(p); return { x: v.x + r.left, y: v.y + r.top }; }

  setView(z, px, py, { auto = false } = {}) {
    this.autoFit = auto;
    this.z = Math.min(Z_MAX, Math.max(Z_MIN, z));
    // 장 원점을 화면 픽셀 경계에 맞춘다. 도구 막대 높이 등으로 캔버스가 소수 px 위치에 있으면 글자 기준선 반올림이
    // 출력(원점 = 정수)과 달라져 일부 줄이 1px 어긋나 보였다(9단계에서 원인 미확인으로 남겼던 것).
    const r = this.rect(), dpr = window.devicePixelRatio || 1;
    const snap = (o, v) => (this.z === 1 ? Math.round((o + v) * dpr) / dpr - o : v); // 100%에서만(확대 중에는 커서 아래 고정이 우선)
    this.px = snap(r.left, px); this.py = snap(r.top, py);
    // 이동은 left/top, 확대만 transform. transform 이동은 합성 레이어의 소수 오프셋 때문에 글자 기준선 반올림이
    // 출력과 달라졌다(원점이 픽셀 경계에 있어도 일부 줄이 1px 어긋남). 100%에서는 transform을 아예 쓰지 않는다.
    this.stage.style.left = `${this.px}px`;
    this.stage.style.top = `${this.py}px`;
    this.stage.style.transform = this.z === 1 ? '' : `scale(${this.z})`;
    this.drawOverlay();
    this.onChange(this);
  }
  zoomAt(z, vx, vy) {
    const nz = Math.min(Z_MAX, Math.max(Z_MIN, z));
    const pt = { x: (vx - this.px) / this.z, y: (vy - this.py) / this.z };
    this.setView(nz, vx - pt.x * nz, vy - pt.y * nz);
  }
  zoomFit(margin = 40) {
    const r = this.rect();
    if (!r.width || !r.height) return this.setView(1, 0, 0, { auto: true });
    const z = Math.min((r.width - margin * 2) / this.page.w, (r.height - margin * 2) / this.page.h);
    this.setView(z, Math.round((r.width - this.page.w * z) / 2), Math.round((r.height - this.page.h * z) / 2), { auto: true });
  }
  zoomTo(z) {
    const r = this.rect();
    this.zoomAt(z, r.width / 2, r.height / 2);
  }

  // ---------- 선택 ----------
  select(ids) {
    const next = this.normalizeSelection(ids.filter((id) => this.node(id)));
    if (this.crop && !(next.length === 1 && next[0] === this.crop.id)) this.exitCrop();
    if (this.pathEdit && !(next.length === 1 && next[0] === this.pathEdit.id)) this.exitPathEdit();
    if (this.editing && !(next.length === 1 && next[0] === this.editing)) this.exitEdit();
    this.selection = next;
    this.history.closeGroup();
    this.drawOverlay();
    this.onChange(this);
  }
  selectedNodes() { return this.selection.map((id) => this.node(id)).filter(Boolean); }
  selectionLeaves() { return M.leaves(this.selectedNodes()); }
  selectionBounds() { const bs = this.selectedNodes().map(M.boundsOf).filter(Boolean); return bs.length ? G.union(bs) : null; }

  // 핸들 기준 상자: 요소 하나(그룹 아님)면 그 요소의 회전 상자, 아니면 선택 전체의 축 정렬 상자
  handleBox() {
    const ns = this.selectedNodes();
    if (!ns.length) return null;
    if (ns.length === 1 && ns[0].type !== 'group') return ns[0];
    const b = this.selectionBounds();
    return b && { ...b, rotation: 0 };
  }

  // 화면 좌표 기준 핸들 목록: { kind: 'resize', hx, hy, x, y } | { kind: 'rotate', x, y }
  handles() {
    const b = this.handleBox();
    if (!b || this.editing || this.crop || this.pathEdit) return [];
    if (this.selectedNodes().some((n) => M.isLocked(n, M.find(this.page.elements, n.id).ancestors))) return [];
    const out = [];
    for (const hy of [-1, 0, 1]) for (const hx of [-1, 0, 1]) {
      if (!hx && !hy) continue;
      const v = this.pageToView(G.fromLocal(b, { x: b.w * (hx + 1) / 2, y: b.h * (hy + 1) / 2 }));
      out.push({ kind: 'resize', hx, hy, x: v.x, y: v.y });
    }
    const top = this.pageToView(G.fromLocal(b, { x: b.w / 2, y: 0 }));
    const a = G.rad(b.rotation || 0);
    out.push({ kind: 'rotate', x: top.x + Math.sin(a) * ROTATE_GAP_PX, y: top.y - Math.cos(a) * ROTATE_GAP_PX });
    return out;
  }

  // 장 좌표 p에서 맨 위 요소. top: 최상위 요소(그룹이면 그룹), leaf: 실제로 맞은 요소
  hitTest(p) {
    const list = [];
    M.walk(this.page.elements, (n, _p, _i, anc) => { if (n.type !== 'group') list.push([n, anc]); });
    for (let i = list.length - 1; i >= 0; i--) {
      const [n, anc] = list[i];
      if (M.isHidden(n, anc) || M.isLocked(n, anc)) continue;
      if (G.contains(n, p)) return { top: anc[0] || n, leaf: n };
    }
    return null;
  }

  // ---------- 겹침 표시(선택 상자·핸들·안내선) ----------
  drawOverlay() {
    const V = (p) => this.pageToView(p);
    const poly = (pts, attrs) => `<polygon points="${pts.map((p) => { const v = V(p); return `${r3(v.x)},${r3(v.y)}`; }).join(' ')}" ${attrs}/>`;
    let s = this.backOverlay();
    if (this.showGuides) M.walk(this.page.elements, (n, _p, _i, anc) => {
      if (!n.slot || M.isHidden(n, anc)) return;
      s += poly(G.corners(n), 'class="slot" fill="none" stroke="#f08c00" stroke-width="1" stroke-dasharray="6 3"');
      const c = V(G.fromLocal(n, { x: 0, y: 0 }));
      s += `<text x="${r3(c.x + 3)}" y="${r3(c.y + 12)}" font-size="10" fill="#f08c00" font-family="sans-serif">${n.type === 'image' ? '이미지 슬롯' : '글 슬롯'}</text>`;
    });
    if (this.hover && !this.selection.includes(this.hover) && !this.drag) {
      const n = this.node(this.hover);
      if (n) for (const leaf of M.leaves([n])) s += poly(G.corners(leaf), 'fill="none" stroke="#2d7ff9" stroke-width="1"');
    }
    const ns = this.selectedNodes();
    if (ns.length) {
      for (const n of ns) {
        if (n.type === 'group' || ns.length > 1) { const b = M.boundsOf(n); if (b) s += poly(G.corners({ ...b, rotation: 0 }), 'fill="none" stroke="#2d7ff9" stroke-width="1" stroke-dasharray="3 2"'); }
        else s += poly(G.corners(n), `fill="none" stroke="#2d7ff9" stroke-width="${this.editing ? 1 : 1.5}"`);
      }
      const b = this.handleBox();
      if (b && ns.length > 1) s += poly(G.corners(b), 'fill="none" stroke="#2d7ff9" stroke-width="1.5"');
      const hs = this.handles();
      const rot = hs.find((h) => h.kind === 'rotate');
      if (rot) {
        const top = V(G.fromLocal(b, { x: b.w / 2, y: 0 }));
        s += `<line x1="${r3(top.x)}" y1="${r3(top.y)}" x2="${r3(rot.x)}" y2="${r3(rot.y)}" stroke="#2d7ff9" stroke-width="1"/>`;
      }
      for (const h of hs) {
        if (h.kind === 'rotate') s += `<circle data-h="rotate" cx="${r3(h.x)}" cy="${r3(h.y)}" r="5" fill="#fff" stroke="#2d7ff9" stroke-width="1.5"/>`;
        else s += `<rect data-h="${h.hx},${h.hy}" x="${r3(h.x - HANDLE_PX / 2)}" y="${r3(h.y - HANDLE_PX / 2)}" width="${HANDLE_PX}" height="${HANDLE_PX}" fill="#fff" stroke="#2d7ff9" stroke-width="1.5" transform="rotate(${r3(b.rotation || 0)} ${r3(h.x)} ${r3(h.y)})"/>`;
      }
    }
    for (const g of this.guides) {
      const a = V(g.a), b = V(g.b);
      s += `<line class="guide" x1="${r3(a.x)}" y1="${r3(a.y)}" x2="${r3(b.x)}" y2="${r3(b.y)}" stroke="#ff2d95" stroke-width="1"/>`;
    }
    if (this.marquee) {
      const m = this.marquee, a = V({ x: m.x, y: m.y });
      s += `<rect x="${r3(a.x)}" y="${r3(a.y)}" width="${r3(m.w * this.z)}" height="${r3(m.h * this.z)}" fill="rgba(45,127,249,.08)" stroke="#2d7ff9" stroke-width="1"/>`;
    }
    s += this.modeOverlay();
    // 같으면 건드리지 않는다: 겹침 SVG를 바꾸면 캔버스 전체를 다시 칠하게 된다(글 입력 중에는 대개 그대로)
    if (s !== this._overlayHTML) { this.overlay.innerHTML = s; this._overlayHTML = s; }
    this.drawRulers();
  }

  // ---------- 마우스 ----------
  bind() {
    const vp = this.viewport;
    vp.addEventListener('mousedown', (e) => this.onDown(e), true);
    vp.addEventListener('mousemove', (e) => { if (!this.drag) this.onHover(e); });
    vp.addEventListener('mouseleave', () => { this.hover = null; this.drawOverlay(); });
    vp.addEventListener('wheel', (e) => {
      e.preventDefault();
      const r = this.rect();
      if (e.ctrlKey || e.metaKey) this.zoomAt(this.z * Math.exp(-e.deltaY * 0.002), e.clientX - r.left, e.clientY - r.top);
      else this.setView(this.z, this.px - (e.shiftKey ? e.deltaY : e.deltaX), this.py - (e.shiftKey ? 0 : e.deltaY));
    }, { passive: false });
    vp.addEventListener('dragover', (e) => { if ([...e.dataTransfer.items].some((i) => i.kind === 'file')) e.preventDefault(); });
    vp.addEventListener('drop', (e) => {
      // 글꼴 파일은 프로젝트 글꼴로(앱이 onFontFiles를 연결)
      const fontFiles = [...e.dataTransfer.files].filter((f) => /\.(ttf|otf|ttc|woff2?)$/i.test(f.name));
      if (fontFiles.length && this.onFontFiles) { e.preventDefault(); this.onFontFiles(fontFiles); }
      const files = [...e.dataTransfer.files].filter((f) => f.type.startsWith('image/'));
      if (!files.length) return;
      e.preventDefault();
      const p = this.clientToPage(e.clientX, e.clientY);
      // 이미지 슬롯 위에 놓으면 그 슬롯을 채운다(템플릿)
      const hit = this.hitTest(p)?.leaf;
      if (hit?.type === 'image' && hit.slot) { this.replaceImage(hit.id, files[0]); files.shift(); }
      files.forEach((f, i) => this.addImage(f, { x: p.x + i * 20, y: p.y + i * 20, center: true }));
    });
  }

  handleAt(vx, vy) {
    for (const h of this.handles()) {
      const r = h.kind === 'rotate' ? 8 : HANDLE_PX / 2 + 3;
      if (Math.abs(h.x - vx) <= r && Math.abs(h.y - vy) <= r) return h;
    }
    return null;
  }

  onHover(e) {
    const r = this.rect();
    const vx = e.clientX - r.left, vy = e.clientY - r.top;
    const p = this.clientToPage(e.clientX, e.clientY);
    if (!this.spaceDown && this.modeHover(e, p)) return;
    let cursor = 'default';
    if (this.spaceDown) cursor = 'grab';
    else if (this.tool !== 'select') cursor = 'crosshair';
    else if (this.editing && this.activeEditor?.members.some((id) => { const n = this.node(id); return n && G.contains(n, p); })) cursor = 'text';
    else {
      const h = this.handleAt(vx, vy);
      if (h?.kind === 'rotate') cursor = 'grab';
      else if (h) {
        const b = this.handleBox();
        const ang = (Math.atan2(h.hy, h.hx) * 180 / Math.PI + (b.rotation || 0) + 360) % 180;
        cursor = ['ew-resize', 'nwse-resize', 'ns-resize', 'nesw-resize'][Math.round(ang / 45) % 4];
      } else {
        const hit = this.hitTest(p);
        if (hit) cursor = 'move';
        const id = hit?.top.id ?? null;
        if (id !== this.hover) { this.hover = id; this.drawOverlay(); }
      }
    }
    this.viewport.style.cursor = cursor;
  }

  onDown(e) {
    const vp = this.viewport;
    const r = this.rect();
    const vx = e.clientX - r.left, vy = e.clientY - r.top;
    const p = this.clientToPage(e.clientX, e.clientY);
    if (e.target.closest?.('.pv-ruler')) return; // 눈금자: 가이드 만들기(guides.js)
    if (e.button === 1 || (e.button === 0 && this.spaceDown)) { e.preventDefault(); e.stopPropagation(); return this.startPan(e); }
    if (e.button !== 0) return;
    if (this.editing) {
      const ed = this.activeEditor;
      if (ed && ed.members.some((id) => { const n = this.node(id); return n && G.contains(n, p); })) return; // 편집 중인 글상자(이어진 글상자 포함) 안: 편집기가 처리
      this.exitEdit();
    }
    e.preventDefault();
    e.stopPropagation();
    vp.focus({ preventScroll: true });

    if (this.modeDown(e, p, vx, vy)) return;
    if (this.tool !== 'select') return this.startCreate(e, p);
    const h = this.handleAt(vx, vy);
    if (h) return h.kind === 'rotate' ? this.startRotate(e, p) : this.startResize(e, p, h.hx, h.hy);
    const hit = this.hitTest(p);
    if (hit) {
      if (e.detail >= 2 && hit.leaf.type === 'text') return this.enterEdit(hit.leaf.id, { x: e.clientX, y: e.clientY });
      if (e.detail >= 2 && hit.leaf.type === 'path' && !hit.leaf.locked) return this.enterPathEdit(hit.leaf.id);
      if (e.detail >= 2 && hit.leaf.type === 'image' && !hit.leaf.locked) return this.enterCrop(hit.leaf.id);
      const id = hit.top.id;
      if (e.shiftKey) {
        // Shift+클릭: 선택에 더하기/빼기. Shift+끌기: 한 축으로 옮기기
        if (!this.selection.includes(id)) { this.select([...this.selection, id]); return this.startMove(e, p); }
        return this.startMove(e, p, () => this.select(this.selection.filter((x) => x !== id)));
      }
      if (!this.selection.includes(id)) this.select([id]);
      return this.startMove(e, p);
    }
    this.startMarquee(e, p);
  }

  // 공통 끌기: move(ev, p) 반복, up(ev, p, moved)
  track(e, move, up) {
    const x0 = e.clientX, y0 = e.clientY;
    let moved = false;
    const mm = (ev) => {
      if (!moved && Math.hypot(ev.clientX - x0, ev.clientY - y0) < CLICK_SLOP_PX) return;
      moved = true;
      move(ev, this.clientToPage(ev.clientX, ev.clientY));
    };
    const mu = (ev) => {
      up(ev, this.clientToPage(ev.clientX, ev.clientY), moved);
      this.drag = null;
      this.guides = [];
      this.spacing = [];
      this.drawOverlay();
      this.onChange(this); // 끄는 동안 미뤄 둔 패널 갱신
    };
    trackPointer(mm, mu);
  }

  startPan(e) {
    const x0 = e.clientX, y0 = e.clientY, px = this.px, py = this.py;
    this.drag = { kind: 'pan' };
    this.viewport.style.cursor = 'grabbing';
    const mm = (ev) => this.setView(this.z, px + ev.clientX - x0, py + ev.clientY - y0);
    const mu = () => { this.drag = null; this.viewport.style.cursor = this.spaceDown ? 'grab' : 'default'; };
    trackPointer(mm, mu);
  }

  // 잠긴 요소는 움직이지 않는다
  movableLeaves() {
    return this.selectedNodes().filter((n) => !M.isLocked(n, M.find(this.page.elements, n.id).ancestors)).flatMap((n) => M.leaves([n]));
  }

  // onClick: 움직이지 않고 놓았을 때 할 일(Shift+클릭으로 선택 빼기)
  startMove(e, p0, onClick = null) {
    const leaves = this.movableLeaves();
    if (!leaves.length) { if (onClick) this.track(e, () => {}, (_e, _p, moved) => { if (!moved) onClick(); }); return; }
    const before = this.snapshot(), selBefore = [...this.selection];
    const start = leaves.map((n) => ({ n, x: n.x, y: n.y }));
    const b0 = this.selectionBounds();
    const targets = this.snapTargets(new Set(M.idsOf(this.selectedNodes())));
    this.drag = { kind: 'move' };
    this.track(e, (ev, p) => {
      let dx = p.x - p0.x, dy = p.y - p0.y;
      if (ev.shiftKey) { if (Math.abs(dx) > Math.abs(dy)) dy = 0; else dx = 0; }
      let guides = [];
      if (!ev.altKey) { // Alt를 누르면 스냅하지 않음
        const s = this.snapBox({ ...b0, x: b0.x + dx, y: b0.y + dy }, targets, { x: !ev.shiftKey || dx !== 0, y: !ev.shiftKey || dy !== 0 });
        dx += s.dx; dy += s.dy; guides = s.guides;
      }
      for (const s of start) { s.n.x = s.x + dx; s.n.y = s.y + dy; }
      this.guides = guides;
      this.render();
    }, (_ev, _p, moved) => { if (moved) this.commit('move', before, selBefore); else onClick?.(); });
  }

  startResize(e, p0, hx, hy) {
    const box = this.handleBox();
    const leaves = this.movableLeaves();
    if (!box || !leaves.length) return;
    const single = this.selectedNodes().length === 1 && this.selectedNodes()[0].type !== 'group';
    const before = this.snapshot(), selBefore = [...this.selection];
    const start = leaves.map((n) => ({ n, g: { x: n.x, y: n.y, w: n.w, h: n.h, rotation: n.rotation || 0 } }));
    const b0 = { x: box.x, y: box.y, w: box.w, h: box.h, rotation: box.rotation || 0 };
    const targets = this.snapTargets(new Set(M.idsOf(this.selectedNodes())));
    this.drag = { kind: 'resize' };
    this.track(e, (ev, p) => {
      let nb = G.resizeOne(b0, hx, hy, p, { keepRatio: ev.shiftKey, fromCenter: ev.altKey });
      let guides = [];
      // 회전 없는 상자는 움직이는 변을 스냅(비율 유지·중심 기준 중에는 끔)
      if (!b0.rotation && !ev.shiftKey && !ev.altKey) {
        const lim = SNAP_PX / this.z;
        const pick = (v, cands) => this.snapPick(v, cands, lim);
        let bx = null, by = null;
        if (hx === 1) { bx = pick(nb.x + nb.w, targets.xs); if (bx) nb.w += bx.d; }
        if (hx === -1) { bx = pick(nb.x, targets.xs); if (bx) { nb.x += bx.d; nb.w -= bx.d; } }
        if (hy === 1) { by = pick(nb.y + nb.h, targets.ys); if (by) nb.h += by.d; }
        if (hy === -1) { by = pick(nb.y, targets.ys); if (by) { nb.y += by.d; nb.h -= by.d; } }
        guides = this.guidesFor(nb, bx && { d: 0, c: bx.c, grid: bx.grid }, by && { d: 0, c: by.c, grid: by.grid }, targets).guides;
      }
      if (single) {
        const s = start[0];
        // 글상자 크기는 정수 px(영역 마스크 단위). 반올림해도 잡지 않은 쪽은 그 자리에 둔다
        if (s.n.type === 'text') nb = G.anchoredBox(b0, hx, hy, Math.max(1, Math.round(nb.w)), Math.max(1, Math.round(nb.h)), ev.altKey);
        Object.assign(s.n, nb);
      } else {
        for (const s of start) {
          Object.assign(s.n, G.scaleLeaf(s.g, b0, nb));
          if (s.n.type === 'text') { s.n.w = Math.max(1, Math.round(s.n.w)); s.n.h = Math.max(1, Math.round(s.n.h)); }
        }
      }
      this.guides = guides;
      this.render();
    }, (_ev, _p, moved) => { if (moved) this.commit('resize', before, selBefore); });
  }

  startRotate(e, p0) {
    const box = this.handleBox();
    const leaves = this.movableLeaves();
    if (!box || !leaves.length) return;
    const before = this.snapshot(), selBefore = [...this.selection];
    const c = G.center(box);
    const a0 = Math.atan2(p0.y - c.y, p0.x - c.x);
    const base = box.rotation || 0;
    const start = leaves.map((n) => ({ n, g: { x: n.x, y: n.y, w: n.w, h: n.h, rotation: n.rotation || 0 } }));
    this.drag = { kind: 'rotate' };
    this.track(e, (ev, p) => {
      let da = G.deg(Math.atan2(p.y - c.y, p.x - c.x) - a0);
      if (ev.shiftKey) da = Math.round((base + da) / 15) * 15 - base; // 15도 단위
      for (const s of start) Object.assign(s.n, G.rotateLeaf(s.g, c, da));
      this.render();
    }, (_ev, _p, moved) => { if (moved) this.commit('rotate', before, selBefore); });
  }

  startMarquee(e, p0) {
    const base = e.shiftKey ? [...this.selection] : [];
    if (!e.shiftKey) this.select([]);
    this.drag = { kind: 'marquee' };
    this.track(e, (_ev, p) => {
      this.marquee = { x: Math.min(p0.x, p.x), y: Math.min(p0.y, p.y), w: Math.abs(p.x - p0.x), h: Math.abs(p.y - p0.y) };
      const ids = [];
      for (const n of this.page.elements) {
        if (n.hidden || n.locked) continue;
        const b = M.boundsOf(n);
        if (b && G.intersects(b, this.marquee)) ids.push(n.id);
      }
      this.selection = [...new Set([...base, ...ids])];
      this.drawOverlay();
    }, () => { this.marquee = null; this.select(this.selection); });
  }

  // 도구로 만들기: 끌면 그 크기, 클릭만 하면 기본 크기. Shift = 정사각형
  startCreate(e, p0) {
    if (this.tool === 'line') return this.startLine(e, p0);
    const type = this.tool === 'text' ? 'text' : 'shape';
    const shape = this.tool === 'ellipse' ? 'ellipse' : this.tool === 'polygon' ? 'polygon' : 'rect';
    this.drag = { kind: 'create' };
    this.track(e, (ev, p) => {
      let w = p.x - p0.x, h = p.y - p0.y;
      if (ev.shiftKey) { const s = Math.max(Math.abs(w), Math.abs(h)); w = Math.sign(w || 1) * s; h = Math.sign(h || 1) * s; }
      this.marquee = { x: Math.min(p0.x, p0.x + w), y: Math.min(p0.y, p0.y + h), w: Math.abs(w), h: Math.abs(h) };
      this.drawOverlay();
    }, (_ev, _p, moved) => {
      const m = this.marquee;
      this.marquee = null;
      const d = type === 'text' ? M.DEFAULTS.text : { w: 200, h: 200 };
      const g = moved && m.w >= 2 && m.h >= 2 ? m : { x: p0.x, y: p0.y, w: d.w, h: d.h };
      if (type === 'text') { g.w = Math.round(g.w); g.h = Math.round(g.h); }
      const n = M.makeElement(type, type === 'shape' ? { shape, ...g } : g);
      this.change('create', () => { this.page.elements.push(n); this.selection = [n.id]; });
      this.setTool('select');
      if (type === 'text') this.enterEdit(n.id);
    });
  }

  // 선 도구: 끌어서 직선 패스. Shift = 45도 단위
  startLine(e, p0) {
    this.drag = { kind: 'create' };
    let p1 = p0;
    this.track(e, (ev, p) => {
      p1 = p;
      if (ev.shiftKey) {
        const a = Math.round(Math.atan2(p.y - p0.y, p.x - p0.x) / (Math.PI / 4)) * (Math.PI / 4), L = Math.hypot(p.x - p0.x, p.y - p0.y);
        p1 = { x: p0.x + Math.cos(a) * L, y: p0.y + Math.sin(a) * L };
      }
      this.pen = { nodes: [{ x: p0.x, y: p0.y }, { x: p1.x, y: p1.y }], cur: null, dragging: true };
      this.drawOverlay();
    }, (_ev, _p, moved) => {
      this.pen = null;
      if (moved && Math.hypot(p1.x - p0.x, p1.y - p0.y) >= 2) {
        const n = pathElementFrom(`M${p0.x} ${p0.y}L${p1.x} ${p1.y}`);
        this.change('create', () => { this.page.elements.push(n); this.selection = [n.id]; });
      }
      this.setTool('select');
    });
  }

  setTool(t) {
    if (this.pen && t !== 'pen') this.finishPen(false);
    if (t !== 'select') { this.exitCrop(); this.exitPathEdit(); }
    if (this.editing && t !== 'select') this.exitEdit();
    this.tool = t;
    this.viewport.style.cursor = t === 'select' ? 'default' : 'crosshair';
    this.onChange(this);
  }

  // ---------- 글상자 편집 모드 ----------
  // fromFocus: 편집기가 포커스를 받아 들어온 경우(되돌리기 등) — 커서를 옮기지 않는다
  enterEdit(id, at, fromFocus = false) {
    const n = this.node(id);
    if (!n || n.type !== 'text') return;
    const ed = this.editorOf(n);
    if (this.editing && this.editorOf(this.node(this.editing)) !== ed) this.exitEdit();
    this.editing = id;
    this.selection = [id];
    this.render();
    if (!fromFocus) ed.focus();
    if (at) { const q = G.toLocal(n, this.clientToPage(at.x, at.y)); ed.placeCaretAt(q.x, q.y, ed.members.indexOf(id)); }
    this.drawOverlay();
    this.onChange(this);
  }
  exitEdit() {
    const id = this.editing;
    if (!id) return;
    const ed = this.editorOf(this.node(id));
    this.editing = null;
    if (ed) {
      if (ed.comp) ed.commitComposition();
      ed.input.blur();
      for (const v of ed.views()) { v.host.style.pointerEvents = 'none'; v.overlay.style.display = 'none'; }
    }
    this.viewport.focus({ preventScroll: true });
    this.drawOverlay();
    this.onChange(this);
  }
  get activeEditor() { return this.editing ? this.editorOf(this.node(this.editing)) : null; }

}

installStories(PageView);
installSnap(PageView);
installCommands(PageView);
installModes(PageView);
installTextFlow(PageView);
installGuides(PageView);
