// 레이어 패널: 장의 요소 트리. 위 = 앞(나중에 그린 요소). 캔버스 선택과 서로 연동한다.
//   클릭 = 선택, Ctrl(⌘)+클릭 = 더하기/빼기, Shift+클릭 = 범위, 더블클릭 = 이름 바꾸기
//   눈·자물쇠 버튼 = 숨김·잠금, ▸ = 그룹 펼치기, 끌어 놓기 = 순서 바꾸기·그룹 안팎으로 옮기기

import * as M from './model.js';
import { esc, trackPointer } from './util.js';

const TYPE_MARK = { text: 'T', image: '▣', shape: '■', group: '▤', path: '✎', pathText: '〰' };

export const LAYERS_CSS = `
.lp{font-size:12.5px;user-select:none;-webkit-user-select:none;padding:0 10px}
.lp-row{display:flex;align-items:center;height:30px;padding-right:4px;border-radius:6px;cursor:default;position:relative}
.lp-row:hover{background:#f0eeea}
.lp-row.sel{background:var(--accent-bg,#e7effd)}
.lp-row.hidden .lp-name,.lp-row.hidden .lp-type{opacity:.4}
.lp-tw{width:16px;text-align:center;color:#777;flex:none}
.lp-type{width:18px;text-align:center;color:#666;flex:none;font-size:11px}
.lp-name{flex:1;overflow:hidden;white-space:nowrap;text-overflow:ellipsis}
.lp-name input{width:100%;font:inherit;padding:1px 3px;border:1px solid var(--accent,#2d6cdf);border-radius:2px}
.lp-btn{width:22px;height:20px;border:0;background:none;color:#999;cursor:pointer;padding:0;font-size:12px;flex:none}
.lp-btn.on{color:#222}
.lp-row:not(:hover) .lp-btn:not(.on){visibility:hidden}
.lp-drop{position:absolute;left:0;right:0;height:2px;background:var(--accent,#2d6cdf);pointer-events:none}
.lp-row.drop-in{outline:2px solid var(--accent,#2d6cdf);outline-offset:-2px}
.lp-empty{padding:10px;color:#888}
`;

export class LayersPanel {
  constructor(root, view) {
    this.view = view;
    this.el = document.createElement('div');
    this.el.className = 'lp';
    root.appendChild(this.el);
    this.expanded = new Set();
    this.anchor = null;    // Shift+클릭 범위의 시작
    this.renaming = null;
    this.drag = null;
    this.el.addEventListener('mousedown', (e) => this.onDown(e));
    this.el.addEventListener('dblclick', (e) => { const r = e.target.closest('.lp-row'); if (r && e.target.closest('.lp-name')) this.startRename(r.dataset.id); });
    this.el.addEventListener('mouseover', (e) => { const r = e.target.closest('.lp-row'); this.setHover(r?.dataset.id ?? null); });
    this.el.addEventListener('mouseleave', () => this.setHover(null));
  }

  setHover(id) {
    if (this.view.hover === id || this.drag) return;
    this.view.hover = id;
    this.view.drawOverlay();
  }

  // 화면에 보이는 행 순서(위 → 아래)의 [노드, 깊이, 부모 id]
  rows() {
    const out = [];
    const visit = (list, depth, parent) => {
      for (let i = list.length - 1; i >= 0; i--) {
        const n = list[i];
        out.push({ n, depth, parent, index: i });
        if (n.type === 'group' && this.expanded.has(n.id)) visit(n.children, depth + 1, n.id);
      }
    };
    visit(this.view.page.elements, 0, null);
    return out;
  }

  render() {
    if (this.renaming || this.drag) return;
    // 캔버스에서 그룹 안 요소가 선택되면 조상을 펼친다
    for (const id of this.view.selection) for (const a of M.find(this.view.page.elements, id)?.ancestors || []) this.expanded.add(a.id);
    const sel = new Set(this.view.selection);
    const rows = this.rows();
    const html = rows.length ? rows.map(({ n, depth }) =>
      `<div class="lp-row${sel.has(n.id) ? ' sel' : ''}${n.hidden ? ' hidden' : ''}" data-id="${esc(n.id)}" style="padding-left:${4 + depth * 14}px">` +
      `<span class="lp-tw" data-act="twist">${n.type === 'group' ? (this.expanded.has(n.id) ? '▾' : '▸') : ''}</span>` +
      `<span class="lp-type">${TYPE_MARK[n.type] || '?'}</span>` +
      `<span class="lp-name">${esc(M.displayName(n))}</span>` +
      `<button class="lp-btn${n.locked ? ' on' : ''}" data-act="lock" title="잠금">${n.locked ? '🔒' : '🔓'}</button>` +
      `<button class="lp-btn${n.hidden ? ' on' : ''}" data-act="hide" title="숨김">${n.hidden ? '⊘' : '👁'}</button></div>`).join('')
      : '<div class="lp-empty">요소가 없습니다</div>';
    // 바뀐 것이 없으면 DOM을 건드리지 않는다(글 입력·확대마다 불림)
    if (html !== this.lastHTML) { this.el.innerHTML = html; this.lastHTML = html; }
  }

  onDown(e) {
    if (e.button !== 0 || this.renaming) return;
    const row = e.target.closest('.lp-row');
    if (!row) return;
    e.preventDefault(); // 글상자 편집 중이면 편집기 포커스를 유지
    const id = row.dataset.id;
    const act = e.target.closest('[data-act]')?.dataset.act;
    const n = this.view.node(id);
    if (act === 'twist' && n?.type === 'group') { this.expanded.has(id) ? this.expanded.delete(id) : this.expanded.add(id); return this.render(); }
    if (act === 'lock') return this.view.setFlag(id, 'locked', !n.locked);
    if (act === 'hide') return this.view.setFlag(id, 'hidden', !n.hidden);

    const mod = e.ctrlKey || e.metaKey;
    const x0 = e.clientX, y0 = e.clientY;
    let started = false;
    const move = (ev) => {
      if (!started && Math.hypot(ev.clientX - x0, ev.clientY - y0) < 4) return;
      if (!started) {
        started = true;
        const ids = this.view.selection.includes(id) ? this.view.selection : [id];
        this.drag = { ids };
      }
      this.updateDrop(ev.clientY);
    };
    const up = () => {
      if (started) return this.finishDrag();
      this.clickRow(id, { mod, shift: e.shiftKey });
    };
    trackPointer(move, up);
  }

  clickRow(id, { mod, shift }) {
    const v = this.view;
    if (v.editing) v.exitEdit();
    if (shift && this.anchor) {
      const order = this.rows().map((r) => r.n.id);
      const a = order.indexOf(this.anchor), b = order.indexOf(id);
      if (a >= 0 && b >= 0) return v.select(order.slice(Math.min(a, b), Math.max(a, b) + 1));
    }
    this.anchor = id;
    if (mod) return v.select(v.selection.includes(id) ? v.selection.filter((x) => x !== id) : [...v.selection, id]);
    v.select([id]);
  }

  // 놓을 자리 계산: 행의 위 1/3 = 그 행 위(더 앞), 아래 1/3 = 그 행 아래, 그룹 행의 가운데 = 그룹 안 맨 앞
  updateDrop(y) {
    for (const x of this.el.querySelectorAll('.lp-drop')) x.remove();
    for (const x of this.el.querySelectorAll('.drop-in')) x.classList.remove('drop-in');
    this.lastHTML = null;
    const rows = [...this.el.querySelectorAll('.lp-row')];
    const info = this.rows();
    let target = null;
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i].getBoundingClientRect();
      if (y < r.top || y > r.bottom) continue;
      const { n, parent, index } = info[i];
      const k = (y - r.top) / r.height;
      if (n.type === 'group' && k > 0.3 && k < 0.7) target = { parent: n.id, index: n.children.length, row: rows[i], into: true };
      else if (k <= 0.5) target = { parent, index: index + 1, row: rows[i], above: true };
      else target = { parent, index, row: rows[i], above: false };
      break;
    }
    if (!target && rows.length) { // 목록 아래 빈 곳 = 맨 뒤
      const last = rows[rows.length - 1].getBoundingClientRect();
      if (y > last.bottom) target = { parent: null, index: 0, row: rows[rows.length - 1], above: false };
    }
    this.drag.target = target;
    if (!target) return;
    if (target.into) target.row.classList.add('drop-in');
    else {
      const line = document.createElement('div');
      line.className = 'lp-drop';
      line.style.top = target.above ? '-1px' : 'calc(100% - 1px)';
      target.row.appendChild(line);
    }
  }

  finishDrag() {
    const { ids, target } = this.drag;
    this.drag = null;
    if (target) {
      if (target.into) this.expanded.add(target.parent);
      this.view.moveNodes(ids, target.parent, target.index);
    }
    this.render();
  }

  startRename(id) {
    const row = this.el.querySelector(`.lp-row[data-id="${id}"] .lp-name`);
    const n = this.view.node(id);
    if (!row || !n) return;
    this.renaming = id;
    this.lastHTML = null;
    const inp = document.createElement('input');
    inp.value = n.name || '';
    inp.placeholder = M.displayName({ ...n, name: '' });
    row.replaceChildren(inp);
    inp.focus();
    inp.select();
    const done = (ok) => {
      if (this.renaming !== id) return;
      this.renaming = null;
      if (ok) this.view.rename(id, inp.value.trim());
      this.render();
    };
    inp.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') done(true);
      if (e.key === 'Escape') done(false);
    });
    inp.addEventListener('blur', () => done(true));
    inp.addEventListener('mousedown', (e) => e.stopPropagation());
  }
}
