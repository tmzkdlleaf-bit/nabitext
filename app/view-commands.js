// 캔버스 화면(PageView)의 명령: 단축키 처리, 요소 삭제·복제·그룹·순서·잠금·숨김·정렬·분배, 속성 바꾸기,
// 이미지 넣기·바꾸기, 요소 복사/붙여넣기. 모든 변경은 change()를 거쳐 되돌리기에 기록된다.
// page-view.js가 mixin으로 PageView에 붙인다.

import { lookup } from '../src/keymap.js';
import * as G from './geom.js';
import * as M from './model.js';
import { cleanNode } from './project.js'; // 다른 창·웹페이지에서 온 요소도 파일에서 읽은 것처럼 정리
import { EDITING_ALLOWED } from './shortcuts.js';
import { mixin } from './util.js';

class CommandMethods {
  // ---------- 명령 ----------
  // 키 이벤트 → 처리했으면 true
  handleKey(e) {
    if (!this.editing && this.modeKey(e)) return true;
    if (e.key === ' ' && !this.editing) { this.spaceDown = true; if (!this.drag) this.viewport.style.cursor = 'grab'; return true; }
    const cmd = lookup(this.appKeymap, e);
    if (!cmd) return false;
    if (this.editing && !EDITING_ALLOWED.has(cmd)) return false;
    return this.run(cmd) !== false;
  }
  handleKeyUp(e) { if (e.key === ' ') { this.spaceDown = false; if (!this.drag) this.viewport.style.cursor = 'default'; } }

  run(cmd) {
    if (cmd.startsWith('tool:')) return this.setTool(cmd.slice(5));
    if (cmd.startsWith('view:')) return this.setViewOption(cmd.slice(5));
    if (cmd.startsWith('nudge:')) { const [, dx, dy] = cmd.split(':'); return this.nudge(+dx, +dy); }
    switch (cmd) {
      case 'delete': return this.deleteSelection();
      case 'mask': return this.maskWithShape();
      case 'areaFromShape': return this.areaFromShape();
      case 'textOnPath': return this.textOnPath();
      case 'crop': { const n = this.selectedNodes()[0]; return n?.type === 'image' ? this.enterCrop(n.id) : false; }
      case 'resetCrop': return this.resetCrop();
      case 'editPath': { const n = this.selectedNodes()[0]; return n?.type === 'path' ? this.enterPathEdit(n.id) : false; }
      case 'duplicate': return this.duplicate();
      case 'group': return this.group();
      case 'ungroup': return this.ungroup();
      case 'forward': return this.reorder('forward');
      case 'backward': return this.reorder('backward');
      case 'front': return this.reorder('front');
      case 'back': return this.reorder('back');
      case 'selectAll': return this.select(this.page.elements.filter((n) => !n.hidden && !n.locked).map((n) => n.id));
      case 'lock': return this.toggleFlag('locked');
      case 'hide': return this.toggleFlag('hidden');
      case 'escape':
        if (this.editing) { const id = this.editing; this.exitEdit(); this.select([id]); return; }
        if (this.tool !== 'select') return this.setTool('select');
        return this.select([]);
      case 'enterEdit': {
        const ns = this.selectedNodes();
        if (ns.length === 1 && ns[0].type === 'text') { this.enterEdit(ns[0].id); const ed = this.activeEditor; ed.setSelection(ed.state.selection.constructor.atEnd(ed.state.doc)); return; }
        return false;
      }
      case 'zoomFit': return this.zoomFit();
      case 'zoom100': return this.zoomTo(1);
      case 'zoomIn': return this.zoomTo(this.z * 1.25);
      case 'zoomOut': return this.zoomTo(this.z / 1.25);
      case 'undo': return this.history.undo();
      case 'redo': return this.history.redo();
      default: return false; // export 등은 앱이 처리
    }
  }

  nudge(dx, dy) {
    const leaves = this.movableLeaves();
    if (!leaves.length) return false;
    const before = this.snapshot(), selBefore = [...this.selection];
    for (const n of leaves) { n.x += dx; n.y += dy; }
    this.render();
    this.history.record(new M.ModelEntry(this, 'nudge', before, this.snapshot(), selBefore, [...this.selection]));
    this.onChange(this);
  }

  deleteSelection() {
    const ids = this.selection.filter((id) => { const f = M.find(this.page.elements, id); return f && !M.isLocked(f.node, f.ancestors); });
    if (!ids.length) return false;
    if (this.editing) this.exitEdit();
    return this.change('delete', () => {
      for (const id of ids) { const f = M.find(this.page.elements, id); if (f) f.parent.splice(f.index, 1); }
      this.selection = [];
    });
  }

  // 같은 부모 안에서 원본 바로 위에 복사본을 넣고 10px 옮긴다
  duplicate(offset = 10) {
    const ns = this.selectedNodes();
    if (!ns.length) return false;
    if (this.editing) this.exitEdit();
    return this.change('duplicate', () => {
      const ids = [], ctx = {};
      for (const n of ns) {
        const f = M.find(this.page.elements, n.id);
        const c = M.duplicateNode(n, this.docOf, ctx);
        for (const l of M.leaves([c])) { l.x += offset; l.y += offset; }
        f.parent.splice(f.parent.indexOf(n) + 1, 0, c);
        ids.push(c.id);
      }
      this.selection = ids;
    });
  }

  // 선택한 요소들을 그룹으로. 모두 같은 부모 안에 있어야 한다.
  group() {
    const fs = this.selection.map((id) => M.find(this.page.elements, id)).filter(Boolean);
    if (fs.length < 2 || fs.some((f) => f.parent !== fs[0].parent)) return false;
    return this.change('group', () => {
      const parent = fs[0].parent;
      const order = fs.map((f) => parent.indexOf(f.node)).sort((a, b) => a - b);
      const kids = order.map((i) => parent[i]);
      const at = order[order.length - 1] - (order.length - 1);
      for (let k = order.length - 1; k >= 0; k--) parent.splice(order[k], 1);
      const g = M.makeElement('group', { children: kids });
      parent.splice(at, 0, g);
      this.selection = [g.id];
    });
  }

  ungroup() {
    const gs = this.selectedNodes().filter((n) => n.type === 'group');
    if (!gs.length) return false;
    return this.change('ungroup', () => {
      const sel = [];
      for (const g of gs) {
        const f = M.find(this.page.elements, g.id);
        f.parent.splice(f.index, 1, ...g.children);
        sel.push(...g.children.map((c) => c.id));
      }
      this.selection = sel;
    });
  }

  reorder(how) {
    const fs = this.selection.map((id) => M.find(this.page.elements, id)).filter(Boolean);
    if (!fs.length) return false;
    return this.change('reorder', () => {
      const byParent = new Map();
      for (const f of fs) { if (!byParent.has(f.parent)) byParent.set(f.parent, new Set()); byParent.get(f.parent).add(f.node); }
      let changed = false;
      for (const [parent, set] of byParent) {
        const before = parent.slice();
        if (how === 'front' || how === 'back') {
          const moving = parent.filter((n) => set.has(n)), rest = parent.filter((n) => !set.has(n));
          parent.splice(0, parent.length, ...(how === 'front' ? [...rest, ...moving] : [...moving, ...rest]));
        } else if (how === 'forward') {
          for (let i = parent.length - 2; i >= 0; i--) if (set.has(parent[i]) && !set.has(parent[i + 1])) [parent[i], parent[i + 1]] = [parent[i + 1], parent[i]];
        } else {
          for (let i = 1; i < parent.length; i++) if (set.has(parent[i]) && !set.has(parent[i - 1])) [parent[i], parent[i - 1]] = [parent[i - 1], parent[i]];
        }
        if (parent.some((n, i) => n !== before[i])) changed = true;
      }
      return changed;
    });
  }

  // 잠금·숨김 켜고 끄기: 모두 켜져 있으면 끄고, 아니면 켠다. 켜면 선택을 푼다.
  toggleFlag(flag) {
    const ns = this.selectedNodes();
    if (!ns.length) return false;
    if (this.editing) this.exitEdit();
    const on = !ns.every((n) => n[flag]);
    return this.change(flag, () => { for (const n of ns) n[flag] = on; if (on) this.selection = []; });
  }

  // 정렬: 2개 이상이면 선택 전체 상자, 1개면 장에 맞춘다. how: left|hcenter|right|top|vcenter|bottom
  align(how) {
    const ns = this.selectedNodes().filter((n) => !n.locked);
    if (!ns.length) return false;
    const T = ns.length > 1 ? this.selectionBounds() : { x: 0, y: 0, w: this.page.w, h: this.page.h };
    return this.change('align', () => {
      for (const n of ns) {
        const b = M.boundsOf(n);
        let dx = 0, dy = 0;
        if (how === 'left') dx = T.x - b.x;
        if (how === 'hcenter') dx = T.x + T.w / 2 - (b.x + b.w / 2);
        if (how === 'right') dx = T.x + T.w - (b.x + b.w);
        if (how === 'top') dy = T.y - b.y;
        if (how === 'vcenter') dy = T.y + T.h / 2 - (b.y + b.h / 2);
        if (how === 'bottom') dy = T.y + T.h - (b.y + b.h);
        for (const l of M.leaves([n])) { l.x += dx; l.y += dy; }
      }
    });
  }

  // 분배: 3개 이상. 양 끝 요소는 그대로 두고 사이 간격을 같게. axis: 'h' | 'v'
  distribute(axis) {
    const ns = this.selectedNodes().filter((n) => !n.locked);
    if (ns.length < 3) return false;
    const X = axis === 'h' ? 'x' : 'y', W = axis === 'h' ? 'w' : 'h';
    const items = ns.map((n) => ({ n, b: M.boundsOf(n) })).sort((a, b) => (a.b[X] + a.b[W] / 2) - (b.b[X] + b.b[W] / 2));
    const first = items[0].b, last = items[items.length - 1].b;
    const total = items.reduce((s, it) => s + it.b[W], 0);
    const gap = (last[X] + last[W] - first[X] - total) / (items.length - 1);
    return this.change('distribute', () => {
      let pos = first[X] + first[W] + gap;
      for (const it of items.slice(1, -1)) {
        const d = pos - it.b[X];
        for (const l of M.leaves([it.n])) l[X] += d;
        pos += it.b[W] + gap;
      }
    });
  }

  // 속성 바꾸기(이후 속성 패널이 쓴다). props는 선택한 잎 요소에 그대로 넣는다.
  setProps(props, ids = this.selection, label = 'props') {
    const ns = ids.map((id) => this.node(id)).filter(Boolean);
    if (!ns.length) return false;
    return this.change(label, () => { for (const n of M.leaves(ns)) Object.assign(n, props); });
  }

  // ---------- 속성 패널용 ----------
  // label이 'live:…'이면 이어지는 같은 조작을 한 단위로 묶는다
  setPageProps(props, label = 'page') {
    const r = this.change(label, () => { for (const k of M.PAGE_PROPS) if (k in props) this.page[k] = props[k]; });
    if (this.autoFit) this.zoomFit();
    return r;
  }

  // 선택의 외곽 상자를 box로(요소 하나면 그 요소의 x·y·w·h, 여러 개·그룹이면 전체 상자 기준 배율)
  setBounds(box, label = 'bounds') {
    const ns = this.selectedNodes().filter((n) => !M.isLocked(n, M.find(this.page.elements, n.id).ancestors));
    if (!ns.length) return false;
    const single = ns.length === 1 && ns[0].type !== 'group' ? ns[0] : null;
    return this.change(label, () => {
      if (single) {
        const nb = { x: single.x, y: single.y, w: single.w, h: single.h, ...box };
        if (single.type === 'text') { nb.w = Math.max(1, Math.round(nb.w)); nb.h = Math.max(1, Math.round(nb.h)); }
        nb.w = Math.max(1, nb.w); nb.h = Math.max(1, nb.h);
        Object.assign(single, nb);
        return;
      }
      const b0 = this.selectionBounds();
      const b1 = { ...b0, ...box };
      b1.w = Math.max(1, b1.w); b1.h = Math.max(1, b1.h);
      for (const l of M.leaves(ns)) {
        Object.assign(l, G.scaleLeaf(l, b0, b1));
        if (l.type === 'text') { l.w = Math.max(1, Math.round(l.w)); l.h = Math.max(1, Math.round(l.h)); }
      }
    });
  }

  // 회전: 요소 하나면 그 각도로, 여러 개·그룹이면 선택 중심 둘레로 (각도 - 현재 기준 각도)만큼
  setRotation(deg, label = 'rotate') {
    const ns = this.selectedNodes().filter((n) => !M.isLocked(n, M.find(this.page.elements, n.id).ancestors));
    if (!ns.length) return false;
    return this.change(label, () => {
      if (ns.length === 1 && ns[0].type !== 'group') { ns[0].rotation = G.normAngle(deg); return; }
      const c = G.center(this.selectionBounds());
      for (const l of M.leaves(ns)) Object.assign(l, G.rotateLeaf(l, c, deg));
    });
  }

  rename(id, name) {
    const n = this.node(id);
    if (!n || n.name === name) return false;
    return this.change('rename', () => { n.name = name; });
  }

  // 한 요소의 잠금·숨김(레이어 패널의 눈·자물쇠 버튼). 선택은 건드리지 않는다
  setFlag(id, flag, on) {
    const n = this.node(id);
    if (!n || !!n[flag] === on) return false;
    return this.change(flag, () => {
      n[flag] = on;
      if (on) this.selection = this.selection.filter((s) => !M.idsOf([n]).includes(s));
    });
  }

  // 레이어 패널 끌어 놓기: ids를 parentId(null = 장 최상위)의 index 위치(아래→위 순서 기준)로 옮긴다.
  // 자기 자신이나 자손 안으로는 옮기지 않는다. 비게 된 그룹은 지운다.
  moveNodes(ids, parentId, index) {
    const fs = ids.map((id) => M.find(this.page.elements, id)).filter(Boolean);
    if (!fs.length) return false;
    const target = parentId ? this.node(parentId) : null;
    if (parentId && (!target || target.type !== 'group')) return false;
    if (target && fs.some((f) => M.idsOf([f.node]).includes(parentId))) return false;
    return this.change('reorder', () => {
      const dest = target ? target.children : this.page.elements;
      // 옮길 노드를 아래→위 순서로 모은다(트리 순서 기준)
      const order = [];
      M.walk(this.page.elements, (n) => { if (ids.includes(n.id)) order.push(n); });
      const moving = order.filter((n) => !order.some((o) => o !== n && o.type === 'group' && M.idsOf([o]).includes(n.id)));
      // index는 옮기기 전 dest 기준 → 앞쪽에서 빠지는 만큼 당긴다
      let at = index;
      for (const n of moving) { const i = dest.indexOf(n); if (i >= 0 && i < index) at--; }
      for (const n of moving) { const f = M.find(this.page.elements, n.id); f.parent.splice(f.index, 1); }
      dest.splice(Math.max(0, Math.min(at, dest.length)), 0, ...moving);
      const prune = (list) => { for (let i = list.length - 1; i >= 0; i--) { const n = list[i]; if (n.type === 'group') { prune(n.children); if (!n.children.length) list.splice(i, 1); } } };
      prune(this.page.elements);
      this.selection = moving.map((n) => n.id);
    });
  }

  // 조상이 이미 선택되어 있으면 자손은 뺀다
  normalizeSelection(ids) {
    return ids.filter((id) => { const f = M.find(this.page.elements, id); return f && !f.ancestors.some((a) => ids.includes(a.id)); });
  }

  // 이미지 요소 넣기. at: 중심 또는 왼쪽 위 좌표. 기본 크기: 원본과 장 크기의 60% 중 작은 쪽
  // 이미지 바꾸기(슬롯 채우기): 상자·필터·마스크는 그대로, 새 이미지는 상자를 채우게(맞춤 = 채우기), 자르기는 풂
  // src: 에셋 주소 | File | { src }
  async replaceImage(id, src) {
    const n = this.node(id);
    if (!n || n.type !== 'image') return false;
    const url = src instanceof Blob ? (await this.importImage?.(src)) ?? URL.createObjectURL(src) : typeof src === 'string' ? src : src?.src;
    if (!url) return false;
    return this.change('replace-image', () => { const cur = this.node(id); cur.src = url; cur.fit = 'cover'; delete cur.crop; });
  }

  async addImage(src, { x, y, center = false } = {}) {
    if (this.importImage) src = (await this.importImage(src)) || (src instanceof Blob ? URL.createObjectURL(src) : src);
    else if (src instanceof Blob) src = URL.createObjectURL(src);
    let nat;
    try { nat = await this.imageSize(src); } catch { this.onError?.('이미지를 읽을 수 없습니다(손상되었거나 지원하지 않는 형식)'); return null; }
    const k = Math.min(1, (this.page.w * 0.6) / nat.w, (this.page.h * 0.6) / nat.h);
    const w = nat.w * k, h = nat.h * k;
    const px = x ?? this.page.w / 2, py = y ?? this.page.h / 2;
    const cx = center || x == null;
    const n = M.makeElement('image', { src, x: cx ? px - w / 2 : px, y: cx ? py - h / 2 : py, w, h });
    this.change('create', () => { this.page.elements.push(n); this.selection = [n.id]; });
    return n;
  }

  // ---------- 요소 복사/붙여넣기 ----------
  copySelection() {
    const ns = this.selectedNodes();
    if (!ns.length) return null;
    this.clip = { nodes: ns.map((n) => M.serializePage({ elements: [n] }, this.docOf).elements[0]), pastes: 0 };
    return JSON.stringify({ nabitext: 1, elements: this.clip.nodes });
  }
  // data: copySelection()이 만든 JSON 문자열(다른 창에서 온 것 포함)
  pasteElements(data) {
    let nodes;
    try { const o = JSON.parse(data); if (o?.nabitext !== 1 || !Array.isArray(o.elements)) return false; nodes = o.elements.map(cleanNode).filter(Boolean); } catch { return false; }
    if (!nodes.length) return false;
    const same = this.clip && JSON.stringify(this.clip.nodes) === JSON.stringify(nodes);
    const k = same ? ++this.clip.pastes : (this.clip = { nodes, pastes: 1 }).pastes;
    return this.change('paste', () => {
      const ids = [], ctx = {};
      for (const n of nodes) {
        const c = M.duplicateNode(n, null, ctx);
        for (const l of M.leaves([c])) { l.x += 10 * k; l.y += 10 * k; }
        this.page.elements.push(c);
        ids.push(c.id);
      }
      this.selection = ids;
    });
  }
  // 붙여넣은 글자로 새 글상자(장 가운데)
  pasteTextAsElement(text) {
    const lines = text.replace(/\r\n?/g, '\n').split('\n');
    const doc = { type: 'doc', content: lines.map((l) => (l ? { type: 'paragraph', content: [{ type: 'text', text: l }] } : { type: 'paragraph' })) };
    const n = M.makeElement('text', { doc });
    n.x = Math.round((this.page.w - n.w) / 2); n.y = Math.round((this.page.h - n.h) / 2);
    return this.change('create', () => { this.page.elements.push(n); this.selection = [n.id]; });
  }
}

export function installCommands(PV) { mixin(PV, CommandMethods); }
