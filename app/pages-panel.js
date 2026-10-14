// 장 목록 패널: 클릭 = 그 장으로, Ctrl(⌘)+클릭 = 선택에 더하기/빼기, Shift+클릭 = 범위 선택(내보내기 '선택한 장'),
// 더블클릭 = 이름 바꾸기, 끌어 놓기 = 순서, 버튼 = 추가·복제·삭제.
// 장 목록 변경은 app(app/main.js)의 명령을 부르고, 되돌리기는 PagesEntry로 기록된다.

import { esc, trackPointer } from './util.js';
import { icon } from './icons.js';

export const PAGES_CSS = `
.pg-list{font-size:12.5px;user-select:none;-webkit-user-select:none;padding-bottom:4px}
.pg-row{display:flex;align-items:center;gap:8px;min-height:30px;padding:3px 6px;border-radius:8px;cursor:default;position:relative;margin-bottom:2px}
.pg-row:hover{background:#f0eeea}
.pg-row.cur{background:var(--accent-bg,#e7effd)}
.pg-row.sel .pg-no{color:#fff;background:var(--accent,#2d6cdf);border-radius:3px}
.pg-no{width:16px;color:var(--muted,#8a857d);text-align:right;flex:none;font-size:11.5px}
.pg-row.cur .pg-no{color:var(--accent,#2d6cdf);font-weight:700}
.pg-name{max-width:100%;overflow:hidden;white-space:nowrap;text-overflow:ellipsis;font-weight:600}
.pg-name input{width:100%;font:inherit;font-weight:400;padding:1px 3px;border:1px solid var(--accent,#2d6cdf);border-radius:3px;box-sizing:border-box}
.pg-size{color:var(--muted,#8a857d);font-size:11.5px;flex:none}
.pg-list.thumbs .pg-row{align-items:flex-start;padding:6px}
.pg-list.thumbs .pg-no{padding-top:2px}
.pg-thumb{display:none}
.pg-list.thumbs .pg-thumb{display:flex;flex:none;width:84px;height:84px;align-items:center;justify-content:center;background:#eceae6;border-radius:3px}
.pg-thumb img{max-width:84px;max-height:84px;box-shadow:0 0 0 1px rgba(0,0,0,.14);background:#fff}
.pg-row.cur .pg-thumb img{box-shadow:0 0 0 2px var(--accent,#2d6cdf)}
.pg-thumb img:not([src]){display:none}
.pg-meta{flex:1;min-width:0;display:flex;align-items:center;gap:6px}
.pg-list.thumbs .pg-meta{flex-direction:column;align-items:flex-start;gap:2px;padding-top:2px}
.pg-master{border:1px dashed #d6d2cb;color:#6d675e;margin-bottom:8px}
.pg-master .pg-no{color:#b07a00;display:grid;place-items:center}
.pg-list.thumbs .pg-master .pg-thumb{width:48px;height:48px}
.pg-list.thumbs .pg-master.empty .pg-thumb{display:none}
.pg-list.thumbs .pg-master.empty{align-items:center}
.pg-list.thumbs .pg-master .pg-thumb img{max-width:48px;max-height:48px}
.pg-drop{position:absolute;left:0;right:0;height:2px;background:var(--accent,#2d6cdf);pointer-events:none}
`;

export class PagesPanel {
  // app: { project, current, switchPage(page), addPage(), duplicatePage(), deletePage(), movePage(page, index), renamePage(page, name) }
  constructor(root, app) {
    this.app = app;
    this.el = document.createElement('div');
    this.el.className = 'pg-list';
    root.appendChild(this.el);
    this.renaming = null;
    this.drag = null;
    this.el.addEventListener('mousedown', (e) => this.onDown(e));
    this.el.addEventListener('dblclick', (e) => { const r = e.target.closest('.pg-row'); if (r && !r.dataset.master) this.startRename(r.dataset.id); });
  }

  label(p, i) { return p.name || `장 ${i + 1}`; }

  render() {
    if (this.renaming || this.drag) return;
    const { project, current } = this.app;
    const sel = this.app.pageSel || new Set();
    // 목록 모양(순서·이름·크기)이 그대로면 줄은 두고 표시(지금 장·선택)만 바꾼다: 장을 옮겨 다닐 때 목록 전체를 다시 만들지 않는다
    const html = `<div class="pg-row pg-master${project.master?.elements.length ? '' : ' empty'}" data-master="1" title="공통 장: 여기 놓은 요소는 모든 장 뒤에 깔립니다(쪽 번호 등)"><span class="pg-no">${icon('layout-template', 14)}</span><span class="pg-thumb"><img alt=""></span><span class="pg-meta"><span class="pg-name">공통 장</span><span class="pg-size">${project.master?.elements.length ? `요소 ${project.master.elements.length}` : '비어 있음'}</span></span></div>` +
      project.pages.map((p, i) =>
      `<div class="pg-row" data-id="${esc(p.id)}" title="Ctrl+클릭·Shift+클릭 = 여러 장 선택(내보내기 '선택한 장')"><span class="pg-no">${i + 1}</span><span class="pg-thumb"><img alt=""></span>` +
      `<span class="pg-meta"><span class="pg-name">${esc(this.label(p, i))}</span><span class="pg-size">${p.w}×${p.h}</span></span></div>`).join('');
    if (html !== this.lastHTML) { this.el.innerHTML = html; this.lastHTML = html; }
    const thumbs = this.app.thumbs;
    this.el.classList.toggle('thumbs', !!thumbs?.enabled);
    if (thumbs?.enabled) {
      if (project.master) this.setThumbEl(this.el.children[0], thumbs.urlOf(project.master));
      project.pages.forEach((p, i) => this.setThumbEl(this.el.children[i + 1], thumbs.urlOf(p)));
    }
    const rows = this.el.children, multi = sel.size > 1;
    rows[0].classList.toggle('cur', !!project.master && current === project.master);
    for (let i = 0; i < project.pages.length; i++) {
      const p = project.pages[i], r = rows[i + 1];
      if (r.classList.contains('cur') !== (p === current)) r.classList.toggle('cur', p === current);
      if (r.classList.contains('sel') !== (multi && sel.has(p))) r.classList.toggle('sel', multi && sel.has(p));
    }
  }

  // 미리보기 그림 바꾸기(목록을 다시 만들지 않고 그 줄의 그림만)
  setThumbEl(row, url) {
    const im = row?.querySelector('.pg-thumb img');
    if (!im) return;
    if (url) { if (im.getAttribute('src') !== url) im.src = url; } else if (im.hasAttribute('src')) im.removeAttribute('src');
  }
  setThumb(page, url) {
    if (this.renaming) return;
    const row = page === this.app.project.master ? this.el.querySelector('.pg-master') : this.el.querySelector(`.pg-row[data-id="${page.id}"]`);
    this.setThumbEl(row, url);
  }

  pageOf(id) { return this.app.project.pages.find((p) => p.id === id); }

  onDown(e) {
    if (e.button !== 0 || this.renaming) return;
    const row = e.target.closest('.pg-row');
    if (!row) return;
    e.preventDefault();
    if (row.dataset.master) { this.app.openMaster(); return; }
    const page = this.pageOf(row.dataset.id);
    const x0 = e.clientX, y0 = e.clientY;
    let started = false;
    const move = (ev) => {
      if (!started && Math.hypot(ev.clientX - x0, ev.clientY - y0) < 4) return;
      started = true;
      this.drag = { page };
      this.showDrop(ev.clientY);
    };
    const up = () => {
      if (!started) return this.click(page, e);
      const to = this.drag.to;
      this.drag = null;
      for (const x of this.el.querySelectorAll('.pg-drop')) x.remove();
      if (to != null) this.app.movePage(page, to);
      this.render();
    };
    trackPointer(move, up);
  }

  // 장 선택(내보내기용). 보통 클릭은 그 장 하나만 선택하고 그 장으로 간다
  click(page, e) {
    const pages = this.app.project.pages;
    const sel = this.app.pageSel instanceof Set ? this.app.pageSel : new Set([this.app.current]);
    if (e.ctrlKey || e.metaKey) {
      if (sel.has(page) && sel.size > 1) sel.delete(page); else sel.add(page);
      this.app.pageSel = sel;
      if (sel.has(page)) this.app.switchPage(page);
    } else if (e.shiftKey) {
      const a = pages.indexOf(this.app.current), b = pages.indexOf(page);
      this.app.pageSel = new Set(pages.slice(Math.min(a, b), Math.max(a, b) + 1));
      this.app.switchPage(page);
    } else {
      this.app.pageSel = new Set([page]);
      this.app.switchPage(page);
    }
    this.app.onPageSel?.(); // 목록은 다음 프레임에 다시 그린다(바로 그리면 더블클릭이 끊김)
  }

  // 놓을 자리 = 행 사이 번호(0 = 맨 앞). 옮기기 전 배열 기준
  showDrop(y) {
    for (const x of this.el.querySelectorAll('.pg-drop')) x.remove();
    this.lastHTML = null;
    const rows = [...this.el.querySelectorAll('.pg-row:not(.pg-master)')];
    let to = rows.length;
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i].getBoundingClientRect();
      if (y < r.top + r.height / 2) { to = i; break; }
    }
    this.drag.to = to;
    const line = document.createElement('div');
    line.className = 'pg-drop';
    const ref = rows[Math.min(to, rows.length - 1)];
    line.style.top = to < rows.length ? '-1px' : 'calc(100% - 1px)';
    ref.appendChild(line);
  }

  startRename(id) {
    const page = this.pageOf(id);
    const cell = this.el.querySelector(`.pg-row[data-id="${id}"] .pg-name`);
    if (!page || !cell) return;
    this.renaming = id;
    this.lastHTML = null;
    const inp = document.createElement('input');
    inp.value = page.name || '';
    inp.placeholder = this.label({}, this.app.project.pages.indexOf(page));
    cell.replaceChildren(inp);
    inp.focus();
    inp.select();
    const done = (ok) => {
      if (this.renaming !== id) return;
      this.renaming = null;
      if (ok) this.app.renamePage(page, inp.value.trim());
      this.render();
    };
    inp.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') done(true); if (e.key === 'Escape') done(false); });
    inp.addEventListener('blur', () => done(true));
    inp.addEventListener('mousedown', (e) => e.stopPropagation());
  }
}
