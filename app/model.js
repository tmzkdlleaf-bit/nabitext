// 문서 모델. 프로젝트 → 장(page) → 요소 트리.
//
// 요소 공통: { id, type, name, x, y, w, h, rotation, opacity, blend, locked, hidden }
//   text    { doc(ProseMirror JSON), style(프레임 글자 기본값), padding, bg(바탕: { color, opacity, radius, stroke, strokeWidth }) }
//           doc은 편집기가 만들어지기 전의 초기값이다. 편집기가 생기면 문서의 주인은 편집기이고,
//           저장할 때 편집기 상태에서 다시 읽는다(serializePage).
//   image   { src, fit: 'fill' | 'contain' | 'cover' }
//   shape   { shape: 'rect' | 'ellipse', fill, stroke, strokeWidth, radius }
//   group   { children: [요소…] } — 자식 좌표는 장 기준 절대 좌표. 그룹의 x/y/w/h는 저장하지 않고 자식에서 계산한다.
// 트리 배열의 순서 = 아래(먼저) → 위(나중).

import { aabb, union } from './geom.js';

export const uid = () => crypto.randomUUID().replace(/-/g, '').slice(0, 12);

export const DEFAULTS = {
  page: { w: 1080, h: 1080, background: '#ffffff' },
  // paraSpacing: 문단 사이 추가 간격(px). 새 글상자는 0 = Enter도 줄 간격만큼만. 없으면(예전 글상자) 8
  text: { w: 360, h: 120, padding: 0, paraSpacing: 0, style: { fontSize: 32 } },
  shape: { fill: '#d9d4ff', stroke: '#5b4fc4', strokeWidth: 0, radius: 0, sides: 6, inner: 0.5 },
};

const BASE = () => ({ rotation: 0, opacity: 1, blend: 'normal', locked: false, hidden: false, name: '' });

const TYPE_NAMES = { text: '글상자', image: '이미지', shape: '도형', group: '그룹', path: '패스', pathText: '경로 글자' };

export function newPage(opts = {}) {
  return { id: uid(), name: '', ...DEFAULTS.page, ...opts, elements: [] };
}

export function makeElement(type, props = {}) {
  const base = { id: uid(), type, ...BASE() };
  if (type === 'text') return { ...base, ...DEFAULTS.text, style: { ...DEFAULTS.text.style }, doc: emptyDoc(), ...props };
  if (type === 'shape') return { ...base, shape: 'rect', ...DEFAULTS.shape, ...props };
  if (type === 'image') return { ...base, fit: 'fill', ...props };
  if (type === 'group') return { ...base, children: [], ...props };
  if (type === 'path') return { ...base, d: '', pw: 1, ph: 1, closed: false, fill: 'none', stroke: '#1f1f1f', strokeWidth: 3, ...props };
  if (type === 'pathText') return { ...base, d: '', pw: 1, ph: 1, text: '', style: { fontSize: 32, color: '#1f1f1f' }, offset: 0, anchor: 'start', showPath: false, ...props };
  throw new Error('알 수 없는 요소 종류: ' + type);
}

export const emptyDoc = () => ({ type: 'doc', content: [{ type: 'paragraph' }] });
export const displayName = (e) => e.name || TYPE_NAMES[e.type] || e.type;

// ---------- 트리 도우미 ----------

// 깊이 우선(아래 → 위). fn(node, parent배열, index, 조상 목록)
export function walk(list, fn, ancestors = []) {
  list.forEach((n, i) => {
    fn(n, list, i, ancestors);
    if (n.type === 'group') walk(n.children, fn, [...ancestors, n]);
  });
}

export function find(list, id) {
  let hit = null;
  walk(list, (n, parent, index, ancestors) => { if (!hit && n.id === id) hit = { node: n, parent, index, ancestors }; });
  return hit;
}

// 노드와 그 자손의 id 전부
export function idsOf(nodes) { const out = []; walk(nodes, (n) => out.push(n.id)); return out; }

// 그룹을 풀어 그림을 그리는 요소(잎)만. 순서 = 아래 → 위
export function leaves(list, out = []) {
  for (const n of list) {
    if (n.type === 'group') leaves(n.children, out);
    else out.push(n);
  }
  return out;
}

// 요소(그룹 포함)의 외곽 상자(회전 반영, 축 정렬)
export function boundsOf(n) {
  if (n.type !== 'group') return aabb(n);
  const bs = n.children.map(boundsOf).filter(Boolean);
  return bs.length ? union(bs) : null;
}

// 숨김은 조상까지 본다
export const isHidden = (n, ancestors = []) => n.hidden || ancestors.some((a) => a.hidden);
export const isLocked = (n, ancestors = []) => n.locked || ancestors.some((a) => a.locked);

// 편집기 문서를 제외한 깊은 복사(되돌리기 스냅숏용)
const NESTED = ['style', 'fill', 'crop', 'filters', 'mask', 'area', 'bg'];
const deep = (v) => (v && typeof v === 'object' ? JSON.parse(JSON.stringify(v)) : v);
export function cloneTree(list) {
  return list.map((n) => {
    const c = { ...n };
    for (const k of NESTED) if (n[k] && typeof n[k] === 'object') c[k] = deep(n[k]);
    if (n.type === 'group') c.children = cloneTree(n.children);
    return c;
  });
}

// ---------- 이야기(story): 이어진 글상자 ----------
// 글상자 { story: 이야기 id(없으면 자기 id), seq: 이야기 안 순서 }. 같은 이야기의 글상자들은 문서 하나를 순서대로 나눠 담는다.
// 이야기는 한 장 안에서만 잇는다. 문서의 주인은 이야기 편집기(편집기 map의 열쇠 = 이야기 id).
export const storyOf = (n) => n.story || n.id;
// 장의 이야기 → 글상자 목록(순서대로)
export function storyFrames(list) {
  const map = new Map();
  let order = 0;
  walk(list, (n) => {
    if (n.type !== 'text') return;
    const sid = storyOf(n);
    if (!map.has(sid)) map.set(sid, []);
    map.get(sid).push({ n, k: order++ });
  });
  const out = new Map();
  for (const [sid, arr] of map) out.set(sid, arr.sort((a, b) => (a.n.seq ?? 0) - (b.n.seq ?? 0) || a.k - b.k).map((x) => x.n));
  return out;
}

// 프로젝트 전체의 이야기 → [{ n, page }] (흐르는 순서 = 장 순서, 같은 장 안에서는 seq). 여러 장에 걸친 이어진 글상자용
export function storyFramesAll(pages) {
  const map = new Map();
  let order = 0;
  pages.forEach((page, pi) => walk(page.elements, (n) => {
    if (n.type !== 'text') return;
    const sid = storyOf(n);
    if (!map.has(sid)) map.set(sid, []);
    map.get(sid).push({ n, page, pi, k: order++ });
  }));
  for (const arr of map.values()) arr.sort((a, b) => a.pi - b.pi || (a.n.seq ?? 0) - (b.n.seq ?? 0) || a.k - b.k);
  return map;
}
// 이야기마다 첫 글상자 id(저장할 때 문서를 이 글상자에만 넣는다)
export function storyFirsts(pages) { return new Set([...storyFramesAll(pages).values()].map((l) => l[0].n.id)); }

// 복제: 새 id를 붙인 깊은 복사. docOf(이야기 id)로 편집기 문서를 받아 복사본의 초기 문서로 쓴다.
// ctx.stories: 한 번에 복제하는 요소들 사이에서 원래 이야기 id → 새 이야기 id(같이 복제한 이어진 글상자는 새 이야기로 계속 이어짐)
export function duplicateNode(n, docOf, ctx = null) {
  const c = { ...n, id: uid() };
  for (const k of NESTED) if (n[k] && typeof n[k] === 'object') c[k] = deep(n[k]);
  if (n.type === 'text') {
    const old = storyOf(n);
    const d = docOf?.(old) ?? n.doc;
    if (d) c.doc = JSON.parse(JSON.stringify(d)); else delete c.doc; // 이어진 글상자의 뒤쪽은 문서가 없다(이야기의 첫 글상자가 가짐)
    delete c.story;
    if (ctx) {
      if (!ctx.stories) ctx.stories = new Map();
      const ns = ctx.stories.get(old) ?? ctx.stories.set(old, c.id).get(old);
      if (ns !== c.id) c.story = ns;
    } else delete c.seq;
  }
  if (n.type === 'group') c.children = n.children.map((k) => duplicateNode(k, docOf, ctx));
  return c;
}

// 저장용 장 JSON: 텍스트 요소의 doc을 편집기 상태에서 채운다(이어진 글상자는 이야기의 첫 글상자에만)
// firsts: 문서를 넣을 글상자 id(프로젝트 전체 기준, storyFirsts). 없으면 이 장 안에서의 첫 글상자
export function serializePage(page, docOf, firsts = null) {
  const first = firsts || new Set([...storyFrames(page.elements).values()].map((l) => l[0].id));
  const fill = (list) => list.map((n) => {
    const c = { ...n };
    if (n.style) c.style = { ...n.style };
    if (n.type === 'text') { if (first.has(n.id)) c.doc = docOf?.(storyOf(n)) ?? n.doc; else delete c.doc; }
    if (n.type === 'group') c.children = fill(n.children);
    return c;
  });
  return { ...page, elements: fill(page.elements) };
}

// ---------- 되돌리기 항목 ----------
// 장 스냅숏(요소 트리 + 장 속성) 전/후. 편집기 문서는 제외. 요소가 수백 개 수준이면 복사 비용은 1ms 안팎이다.
// 텍스트 내용은 편집기가 TextEntry로 따로 기록하므로 두 종류 항목이 같은 스택에서 순서대로 적용된다.
export const PAGE_PROPS = ['w', 'h', 'background', 'bgImage', 'name', 'guides', 'noMaster']; // guides 배열은 통째로 바꾼다(제자리 수정 금지: 스냅숏이 같은 배열을 가리킴)
export function snapshot(page) {
  const s = { elements: cloneTree(page.elements) };
  for (const k of PAGE_PROPS) s[k] = page[k];
  return s;
}

// 되돌리기 기록은 두 스냅숏에서 달라진 최상위 요소만 남긴다(바뀌지 않은 요소는 되돌릴 때 지금 장의 것을 그대로 쓴다).
// 그래서 요소 수백 개인 장에서 요소 하나를 여러 번 바꿔도 기록 하나는 그 요소 크기만큼만 차지한다.
function pickProps(s) { const o = {}; for (const k of PAGE_PROPS) o[k] = s[k]; return o; }
function sameOrder(a, b) { return a.length === b.length && a.every((x, i) => x === b[i]); }
export function diffSnapshots(before, after) {
  const bMap = new Map(before.elements.map((n) => [n.id, n])), aMap = new Map(after.elements.map((n) => [n.id, n]));
  const changed = new Set();
  for (const [id, n] of bMap) { const m = aMap.get(id); if (!m || JSON.stringify(m) !== JSON.stringify(n)) changed.add(id); }
  for (const id of aMap.keys()) if (!bMap.has(id)) changed.add(id);
  const orderB = before.elements.map((n) => n.id), orderA = after.elements.map((n) => n.id);
  const b = new Map(), a = new Map();
  for (const id of changed) { if (bMap.has(id)) b.set(id, bMap.get(id)); if (aMap.has(id)) a.set(id, aMap.get(id)); }
  const propsB = pickProps(before), propsA = pickProps(after);
  const propsSame = PAGE_PROPS.every((k) => JSON.stringify(propsB[k]) === JSON.stringify(propsA[k]));
  return { changed, b, a, orderB, orderA: sameOrder(orderB, orderA) ? orderB : orderA, propsB, propsA, empty: !changed.size && propsSame && sameOrder(orderB, orderA) };
}
// 기록 → 전체 스냅숏(바뀌지 않은 요소는 지금 장의 요소)
function rebuild(page, order, stored, props) {
  const live = new Map(page.elements.map((n) => [n.id, n]));
  return { elements: order.map((id) => stored.get(id) ?? live.get(id)).filter(Boolean), ...props };
}

export class ModelEntry {
  // page: 기록할 장(기본 = 지금 장). quiet: 되돌릴 때 그 장으로 화면을 옮기지 않음(여러 장을 함께 바꾼 항목의 곁가지)
  // before/after: 전체 스냅숏을 받아 달라진 것만 남긴다
  constructor(view, label, before, after, selBefore, selAfter, page = view.page, quiet = false) {
    Object.assign(this, { view, page, quiet, label, selBefore, selAfter, time: Date.now() });
    this.d = diffSnapshots(before, after);
  }
  get empty() { return this.d.empty; }
  // 이어지는 같은 동작은 한 단위로: 방향키 이동('nudge'), 속성 패널의 연속 조작('live:…' — 색 고르기 끌기, 숫자 칸 화살표 등)
  canMerge(next, delay) {
    const mergeable = this.label === 'nudge' || this.label.startsWith('live:');
    return mergeable && next.label === this.label && next.view === this.view && next.page === this.page &&
      next.time - this.time <= delay && JSON.stringify(next.selBefore) === JSON.stringify(this.selAfter);
  }
  // 두 기록 합치기: 처음 상태는 앞 기록의 것(앞에서 안 바꾼 요소는 뒤 기록의 처음 상태), 끝 상태는 뒤 기록의 것
  merge(next) {
    const A = this.d, B = next.d;
    const changed = new Set([...A.changed, ...B.changed]);
    const b = new Map(), a = new Map();
    for (const id of changed) {
      const bb = A.changed.has(id) ? A.b.get(id) : B.b.get(id);
      const aa = B.changed.has(id) ? B.a.get(id) : A.a.get(id);
      if (bb) b.set(id, bb);
      if (aa) a.set(id, aa);
    }
    this.d = { changed, b, a, orderB: A.orderB, orderA: B.orderA, propsB: A.propsB, propsA: B.propsA, empty: false };
    this.selAfter = next.selAfter; this.time = next.time;
  }
  get before() { return rebuild(this.page, this.d.orderB, this.d.b, this.d.propsB); }
  get after() { return rebuild(this.page, this.d.orderA, this.d.a, this.d.propsA); }
  undo() { this.view.restore(this.before, this.selBefore, this.page, this.quiet); }
  redo() { this.view.restore(this.after, this.selAfter, this.page, this.quiet); }
}
