// 찾기·바꾸기: 프로젝트 전체(장 순서 → 공통 장)의 글상자 글과 경로 글자에서 찾는다.
//   글상자: 이어진 글상자는 한 문서(이야기)라 문서 위치로 찾고, 찾은 곳이 놓인 글상자로 가서 그 범위를 선택한다.
//   문단을 넘는 일치는 찾지 않는다(줄바꿈·이미지 자리에서 끊김).
//   "모두 바꾸기"는 되돌리기 한 번에 전부 돌아간다.

import * as M from './model.js';
import { esc } from './util.js';

export const FIND_CSS = `
.fb{position:absolute;top:8px;right:12px;z-index:30;background:#fff;border:1px solid #cfccc6;border-radius:6px;box-shadow:0 4px 16px rgba(0,0,0,.14);padding:8px;display:grid;grid-template-columns:auto 1fr auto;gap:6px 6px;align-items:center;font-size:12px;width:380px}
.fb input[type=text]{font:inherit;padding:3px 6px;border:1px solid #cfccc6;border-radius:3px;min-width:0}
.fb button{font:inherit;font-size:11px;padding:3px 8px;border:1px solid #cfccc6;background:#fff;border-radius:3px;cursor:pointer;white-space:nowrap}
.fb button:disabled{opacity:.45;cursor:default}
.fb .fb-count{color:#666;min-width:52px;text-align:right}
.fb .fb-row{grid-column:1 / -1;display:flex;gap:6px;align-items:center}
.fb .fb-row .sp{flex:1}
.fb .fb-note{grid-column:1 / -1;color:#b05a00;min-height:0}
`;

// 문서에서 query 찾기 → [[from, to], …] (문서 위치)
export function findInDoc(doc, query, { caseSensitive = false } = {}) {
  if (!query) return [];
  const q = caseSensitive ? query : query.toLowerCase();
  const out = [];
  doc.descendants((node, pos) => {
    if (!node.isTextblock) return true;
    // 문단 글자를 이어 붙이고 글자 → 문서 위치 표를 만든다. 글자가 아닌 인라인(줄바꿈·이미지)은 끊는 자리
    let text = '';
    const at = [];
    node.forEach((ch, off) => {
      const p = pos + 1 + off;
      if (ch.isText) { for (let i = 0; i < ch.text.length; i++) at.push(p + i); text += ch.text; }
      else { at.push(p); text += '\u0000'; }
    });
    const hay = caseSensitive ? text : text.toLowerCase();
    for (let i = hay.indexOf(q); i >= 0; i = hay.indexOf(q, i + q.length)) out.push([at[i], at[i + q.length - 1] + 1]);
    return false;
  });
  return out;
}
// 보통 글자열에서 찾기(경로 글자) → [[start, end], …]
export function findInString(s, query, { caseSensitive = false } = {}) {
  if (!query || !s) return [];
  const hay = caseSensitive ? s : s.toLowerCase(), q = caseSensitive ? query : query.toLowerCase();
  const out = [];
  for (let i = hay.indexOf(q); i >= 0; i = hay.indexOf(q, i + q.length)) out.push([i, i + q.length]);
  return out;
}

export class FindBar {
  // app: main.js의 app(project, current, switchPage), view: PageView
  constructor(root, app, view, history) {
    Object.assign(this, { root, app, view, history });
    this.el = null;
    this.matches = [];
    this.index = -1;
    this.caseSensitive = false;
    this.ready = new WeakSet();
  }

  get isOpen() { return !!this.el; }

  open() {
    if (!this.el) this.build();
    this.ready = new WeakSet();
    const q = this.el.querySelector('[data-f=q]');
    // 편집 중 고른 글자가 있으면 그것으로 찾기 시작
    const ed = this.view.activeEditor;
    if (ed && !ed.state.selection.empty) {
      const { from, to } = ed.state.selection;
      const t = ed.state.doc.textBetween(from, to, ' ', ' ');
      if (t && !t.includes('\n') && t.length < 200) q.value = t;
    }
    q.focus(); q.select();
    this.refresh();
  }

  close() {
    if (!this.el) return;
    this.el.remove();
    this.el = null;
    this.matches = [];
    if (!this.view.editing) this.view.viewport.focus({ preventScroll: true });
  }

  build() {
    const el = this.el = document.createElement('div');
    el.className = 'fb';
    el.setAttribute('role', 'search');
    el.innerHTML = `<span>찾기</span><input type="text" data-f="q" spellcheck="false" aria-label="찾을 글자"><span class="fb-count" data-f="count"></span>
      <span>바꾸기</span><input type="text" data-f="r" spellcheck="false" aria-label="바꿀 글자"><span></span>
      <div class="fb-row"><label><input type="checkbox" data-f="case"> 대소문자 구분</label><span class="sp"></span>
        <button data-f="prev" title="이전 (Shift+Enter)">이전</button><button data-f="next" title="다음 (Enter)">다음</button>
        <button data-f="one">바꾸기</button><button data-f="all">모두 바꾸기</button><button data-f="close" title="닫기 (Esc)">×</button></div>
      <div class="fb-note" data-f="note"></div>`;
    const $ = (k) => el.querySelector(`[data-f=${k}]`);
    $('q').addEventListener('input', () => { this.index = -1; this.refresh(); });
    $('case').addEventListener('change', (e) => { this.caseSensitive = e.target.checked; this.index = -1; this.refresh(); });
    $('prev').onclick = () => this.go(-1);
    $('next').onclick = () => this.go(1);
    $('one').onclick = () => this.replaceOne();
    $('all').onclick = () => this.replaceAll();
    $('close').onclick = () => this.close();
    for (const b of el.querySelectorAll('button')) b.addEventListener('mousedown', (e) => e.preventDefault()); // 입력칸 포커스 유지
    el.addEventListener('keydown', (e) => {
      e.stopPropagation(); // 캔버스 단축키로 가지 않게
      if (e.key === 'Escape') { e.preventDefault(); this.close(); }
      else if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); if (e.target === $('r') && (e.ctrlKey || e.metaKey)) this.replaceAll(); else if (e.target === $('r')) this.replaceOne(); else this.go(e.shiftKey ? -1 : 1); }
      else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f') { e.preventDefault(); $('q').select(); }
    });
    this.root.appendChild(el);
  }

  get query() { return this.el?.querySelector('[data-f=q]').value || ''; }
  get replacement() { return this.el?.querySelector('[data-f=r]').value || ''; }

  // 찾을 곳: 장 순서대로, 장 안에서는 요소 순서. 이야기는 첫 글상자 자리에서 한 번. 끝에 공통 장
  sources() {
    const pages = [...this.app.project.pages];
    if (this.app.project.master?.elements.length) pages.push(this.app.project.master);
    // 아직 열지 않은 장의 글상자 편집기도 준비(찾은 곳으로 가고 바꾸려면 필요). 창을 연 동안 한 번씩만
    for (const p of pages) if (!this.ready.has(p)) { this.view.ensurePage(p); this.ready.add(p); }
    const out = [];
    const seen = new Set();
    for (const page of pages) {
      M.walk(page.elements, (n) => {
        if (n.type === 'text') {
          const sid = M.storyOf(n);
          if (seen.has(sid)) return;
          seen.add(sid);
          const ed = this.view.editors.get(sid);
          if (ed) out.push({ kind: 'text', sid, ed, page });
        } else if (n.type === 'pathText') out.push({ kind: 'path', id: n.id, n, page });
      });
    }
    return out;
  }

  search() {
    const q = this.query, opt = { caseSensitive: this.caseSensitive };
    const list = [];
    if (!q) return list;
    for (const s of this.sources()) {
      if (s.kind === 'text') for (const [from, to] of findInDoc(s.ed.state.doc, q, opt)) list.push({ ...s, from, to });
      else for (const [from, to] of findInString(s.n.text, q, opt)) list.push({ ...s, from, to });
    }
    return list;
  }

  refresh(note = '') {
    if (!this.el) return;
    this.matches = this.search();
    if (this.index >= this.matches.length) this.index = this.matches.length - 1;
    this.draw(note);
  }

  draw(note = '') {
    const $ = (k) => this.el.querySelector(`[data-f=${k}]`);
    const n = this.matches.length;
    $('count').textContent = !this.query ? '' : n ? `${this.index >= 0 ? this.index + 1 : '–'}/${n}` : '없음';
    for (const k of ['prev', 'next', 'all']) $(k).disabled = !n;
    $('one').disabled = !n;
    $('note').textContent = note;
  }

  // 찾은 곳으로: 그 장으로 가서 글상자 편집 + 범위 선택(경로 글자는 요소 선택). 입력칸 포커스는 찾기 창에 둔다
  go(dir) {
    if (!this.matches.length) return;
    this.index = this.index < 0 ? (dir > 0 ? 0 : this.matches.length - 1) : (this.index + dir + this.matches.length) % this.matches.length;
    const m = this.matches[this.index];
    const v = this.view;
    let note = '';
    if (m.kind === 'text') {
      const { k, overflow } = m.ed.memberOfPos(m.from);
      const id = m.ed.members[k], pg = m.ed.memberPages?.[k] || m.page;
      if (pg !== this.app.current) this.app.switchPage(pg);
      if (v.editing !== id) v.enterEdit(id);
      m.ed.selectRange(m.from, m.to);
      if (overflow) note = '글상자를 넘쳐 보이지 않는 곳입니다(글상자를 키우거나 이어 주십시오)';
    } else {
      if (m.page !== this.app.current) this.app.switchPage(m.page);
      if (v.editing) v.exitEdit();
      v.select([m.id]);
      note = `경로 글자 "${esc(m.n.text).slice(0, 30)}"`;
    }
    this.el.querySelector('[data-f=q]').focus({ preventScroll: true });
    this.draw(note);
  }

  replaceOne() {
    if (!this.matches.length) return;
    if (this.index < 0) return this.go(1); // 먼저 찾은 곳으로 가서 보여 준 뒤 바꾼다
    const m = this.matches[this.index];
    const r = this.replacement;
    if (m.kind === 'text') m.ed.replaceRanges([[m.from, m.to]], r);
    else {
      if (m.page !== this.view.page) this.app.switchPage(m.page);
      this.view.setProps({ text: m.n.text.slice(0, m.from) + r + m.n.text.slice(m.to) }, [m.id]);
    }
    const keep = this.index;
    this.matches = this.search();
    this.index = Math.min(keep, this.matches.length) - 1; // 바꾼 다음 것으로
    if (this.matches.length) this.go(1); else this.draw('모두 바꿨습니다');
  }

  // 모두 바꾸기: 이야기마다 한 번에, 경로 글자는 장별로. 전체가 되돌리기 한 단위
  replaceAll() {
    const all = this.search();
    if (!all.length) return;
    const r = this.replacement;
    const v = this.view;
    if (v.editing) v.exitEdit();
    const byStory = new Map(), paths = new Map();
    for (const m of all) {
      if (m.kind === 'text') { if (!byStory.has(m.sid)) byStory.set(m.sid, { ed: m.ed, ranges: [] }); byStory.get(m.sid).ranges.push([m.from, m.to]); }
      else { if (!paths.has(m.id)) paths.set(m.id, { n: m.n, page: m.page, ranges: [] }); paths.get(m.id).ranges.push([m.from, m.to]); }
    }
    this.history.batch(() => {
      for (const { ed, ranges } of byStory.values()) ed.replaceRanges(ranges, r);
      if (paths.size) {
        const pages = [...new Set([...paths.values()].map((p) => p.page))];
        v.changeMany('replace', pages, () => {
          for (const { n, ranges } of paths.values()) {
            let t = n.text;
            for (const [a, b] of [...ranges].sort((x, y) => y[0] - x[0])) t = t.slice(0, a) + r + t.slice(b);
            n.text = t;
          }
        });
      }
    });
    this.history.closeGroup();
    v.render();
    this.index = -1;
    this.refresh(`${all.length}곳을 바꿨습니다(되돌리기 한 번으로 모두 되돌림)`);
  }
}
