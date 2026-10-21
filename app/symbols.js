// 기호 넣기: 말줄임표·가로선·괄호·도형 같은 기호를 눌러서 글상자에 넣는다(자판으로 치기 어려운 것들).
//   - 글상자 편집 중이면 커서 자리에(고른 글자가 있으면 그 자리를 바꿔) 넣는다. 지금 커서의 글자 꾸밈을 따른다.
//   - 목록을 눌러도 편집기 포커스·한글 조합·고른 범위가 그대로 남는다(mousedown 막기). 여러 개를 이어서 넣을 수 있다.
//   - 최근에 넣은 기호는 맨 앞 "최근" 칸에(이 컴퓨터에 기억). Esc나 바깥을 누르면 닫힌다.

import { esc } from './util.js';

// [칸 이름, 기호 목록]. 기호 목록은 글자 하나씩이거나 { t: 넣을 글, label: 단추 글, title: 설명 }
export const SYMBOL_SETS = [
  ['말줄임·가로선', ['…', '⋯', '‥', '⋮', '—', '–', '―', '─', '━', '⸺', '⸻', '‐', '~', '～', '〜', '∼', '·', '・', '‧', '•', '◦', '∙']],
  ['괄호·따옴표', ['“', '”', '‘', '’', '「', '」', '『', '』', '《', '》', '〈', '〉', '【', '】', '〔', '〕', '［', '］', '｛', '｝', '«', '»', '‹', '›', '″', '′', '〝', '〟']],
  ['문장부호·단위', ['※', '¶', '§', '†', '‡', '‼', '⁉', '⁈', '⁇', '¡', '¿', '°', '℃', '℉', '‰', '№', '℡', '™', '©', '®', '㉿', '㈜', '￦', '€', '¥', '£', '¢', '＃', '＆', '＊', '＠']],
  ['도형·꾸밈', ['★', '☆', '✦', '✧', '✩', '✪', '✶', '✷', '✺', '❀', '✿', '❁', '❋', '♥', '♡', '❤', '❥', '♠', '♤', '♣', '♧', '♦', '♢', '●', '○', '◎', '◉', '◆', '◇', '◈', '❖', '■', '□', '▣', '▪', '▫', '▲', '△', '▼', '▽', '▶', '▷', '◀', '◁', '♪', '♫', '♬', '♩', '☀', '☁', '☂', '☾', '☽', '❄', '☎', '✉', '✂', '✓', '✔', '✕', '✗', '✘']],
  ['화살표', ['→', '←', '↑', '↓', '↔', '↕', '⇒', '⇐', '⇔', '↗', '↘', '↙', '↖', '➜', '➝', '➞', '⟶', '⟵', '⟷', '↻', '↺', '⤴', '⤵', '↪', '↩', '▸', '◂', '▴', '▾']],
  ['숫자·수학', ['①', '②', '③', '④', '⑤', '⑥', '⑦', '⑧', '⑨', '⑩', '⑪', '⑫', '⑬', '⑭', '⑮', '❶', '❷', '❸', '❹', '❺', '❻', '❼', '❽', '❾', '❿', 'Ⅰ', 'Ⅱ', 'Ⅲ', 'Ⅳ', 'Ⅴ', 'Ⅵ', 'Ⅶ', 'Ⅷ', 'Ⅸ', 'Ⅹ', '㉠', '㉡', '㉢', '㉣', '㉤', '㉮', '㉯', '㉰', '㉱', '㉲',
    '×', '÷', '±', '≠', '≒', '≈', '≤', '≥', '∞', '∴', '∵', '√', '∑', 'π', '½', '⅓', '¼', '¾', '²', '³', '⁰']],
  ['구분선', [
    { t: '* * *', label: '* * *', title: '장면 바꿈' }, { t: '⁂', label: '⁂', title: '장면 바꿈(별 셋)' }, { t: '· · ·', label: '· · ·' }, { t: '◆ ◇ ◆', label: '◆ ◇ ◆' }, { t: '✦ ✦ ✦', label: '✦ ✦ ✦' },
    { t: '────────────', label: '────', title: '가는 선' }, { t: '━━━━━━━━━━━━', label: '━━━━', title: '굵은 선' }, { t: '════════════', label: '════', title: '두 줄 선' },
    { t: '┈┈┈┈┈┈┈┈┈┈┈┈', label: '┈┈┈┈', title: '점선' }, { t: '- - - - - - - - - -', label: '- - - -', title: '끊긴 선' }, { t: '〰〰〰〰〰〰', label: '〰〰〰', title: '물결 선' },
    { t: '———', label: '———', title: '긴 줄표(대사 끊김)' }, { t: '……', label: '……', title: '말줄임표 두 개' },
  ]],
  ['띄어쓰기', [
    { t: '　', label: '전각', title: '전각 공백 — 한글 한 글자 폭만큼 띄움(들여쓰기·칸 맞춤)' },
    { t: ' ', label: '붙임', title: '줄바꿈 없는 공백 — 앞뒤 낱말이 다른 줄로 갈라지지 않음' },
    { t: ' ', label: '얇게', title: '얇은 공백 — 보통 공백보다 좁게 띄움' },
    { t: '​', label: '폭 0', title: '폭 없는 공백 — 보이지 않지만 그 자리에서 줄을 바꿀 수 있음' },
  ]],
];

const RECENT_KEY = 'nabitext-recent-symbols';
const RECENT_MAX = 16;
const norm = (s) => (typeof s === 'string' ? { t: s, label: s } : s);
const readRecent = () => { try { const a = JSON.parse(localStorage.getItem(RECENT_KEY) || '[]'); return Array.isArray(a) ? a.filter((x) => typeof x === 'string' && x.length <= 40) : []; } catch { return []; } };
const allItems = () => new Map(SYMBOL_SETS.flatMap(([, list]) => list.map(norm)).map((it) => [it.t, it]));
function remember(t) {
  const list = [t, ...readRecent().filter((x) => x !== t)].slice(0, RECENT_MAX);
  try { localStorage.setItem(RECENT_KEY, JSON.stringify(list)); } catch { /* 저장 안 되는 환경: 이번만 */ }
}

const CSS = `
.sym-pop{position:fixed;z-index:1000;width:332px;max-width:calc(100vw - 16px);background:var(--panel,#fbfaf8);border:1px solid var(--line,#e4e1dc);border-radius:10px;
  box-shadow:0 10px 30px rgba(0,0,0,.16);display:flex;flex-direction:column;font-size:12px;color:var(--text,#23211e);overflow:hidden}
.sym-tabs{display:flex;flex-wrap:wrap;gap:4px;padding:8px 8px 6px;border-bottom:1px solid var(--line,#e4e1dc)}
.sym-tabs button{border:1px solid var(--line,#e4e1dc);background:#fff;border-radius:999px;padding:3px 9px;font:inherit;font-size:11px;cursor:pointer;color:var(--muted,#8a857d)}
.sym-tabs button[aria-selected="true"]{background:var(--accent,#2d6cdf);border-color:var(--accent,#2d6cdf);color:#fff}
.sym-grid{display:grid;grid-template-columns:repeat(8,1fr);gap:3px;padding:8px;overflow:auto;max-height:240px}
.sym-grid.wide{grid-template-columns:repeat(3,1fr)}
.sym-grid button{height:34px;border:1px solid transparent;background:#fff;border-radius:6px;cursor:pointer;font:inherit;font-size:18px;line-height:1;padding:0;
  font-family:"Noto Sans KR","Noto Sans CJK KR","Malgun Gothic","Segoe UI Symbol","Apple Symbols",sans-serif;color:inherit;white-space:nowrap;overflow:hidden}
.sym-grid.wide button{font-size:13px}
.sym-grid button:hover,.sym-grid button:focus-visible{border-color:var(--accent,#2d6cdf);background:var(--accent-bg,#e7effd);outline:none}
.sym-empty{grid-column:1/-1;color:var(--muted,#8a857d);padding:10px 4px;font-size:12px}
.sym-foot{padding:6px 10px 8px;color:var(--muted,#8a857d);font-size:11px;border-top:1px solid var(--line,#e4e1dc)}
@media (pointer: coarse){.sym-grid button{height:44px;font-size:20px}.sym-tabs button{padding:7px 12px;font-size:13px}.sym-pop{width:380px}}
`;
let cssIn = false, open = null;
export function closeSymbolPicker() { open?.close(); }
export const symbolPickerOpen = () => !!open;

// anchor: 단추(목록을 그 옆에 띄움), insert(글): 실제로 넣기. 반환 { close }
export function openSymbolPicker({ anchor, insert }) {
  if (open) { const was = open.anchor === anchor; open.close(); if (was) return null; } // 같은 단추를 다시 누르면 닫기
  if (!cssIn) { document.head.insertAdjacentHTML('beforeend', `<style>${CSS}</style>`); cssIn = true; }
  const pop = document.createElement('div');
  pop.className = 'sym-pop';
  pop.setAttribute('role', 'dialog');
  pop.setAttribute('aria-label', '기호 넣기');
  const tabs = [['최근', null], ...SYMBOL_SETS];
  let tab = readRecent().length ? 0 : 1;
  const items = allItems();
  const render = () => {
    const [name, list] = tabs[tab];
    const shown = list ? list.map(norm) : readRecent().map((t) => items.get(t) || { t, label: t });
    const wide = shown.some((it) => [...it.label].length > 2);
    pop.innerHTML = `<div class="sym-tabs" role="tablist">${tabs.map(([n], i) => `<button type="button" role="tab" data-tab="${i}" aria-selected="${i === tab}">${esc(n)}</button>`).join('')}</div>` +
      `<div class="sym-grid${wide ? ' wide' : ''}" role="listbox" aria-label="${esc(name)}">` +
      (shown.length ? shown.map((it, i) => `<button type="button" data-i="${i}" title="${esc(it.title || it.t.trim() || it.label)}">${esc(it.label)}</button>`).join('')
        : '<div class="sym-empty">아직 넣은 기호가 없습니다. 다른 칸에서 고르면 여기에 모입니다.</div>') +
      '</div><div class="sym-foot">누르면 커서 자리에 들어갑니다 · 여러 번 눌러 이어서 넣기 · Esc로 닫기</div>';
    pop._shown = shown;
  };
  render();
  pop.addEventListener('mousedown', (e) => e.preventDefault()); // 편집기 포커스·선택·한글 조합을 그대로
  pop.addEventListener('click', (e) => {
    const t = e.target.closest('[data-tab]');
    if (t) { tab = +t.dataset.tab; render(); return; }
    const b = e.target.closest('[data-i]');
    if (!b) return;
    const it = pop._shown[+b.dataset.i];
    if (!it) return;
    if (insert(it.t) !== false) { remember(it.t); if (tab === 0) render(); }
  });
  document.body.appendChild(pop);
  // 자리: 단추 아래(모자라면 위), 화면 밖으로 나가지 않게
  const r = anchor?.getBoundingClientRect?.() || { left: window.innerWidth / 2 - 166, right: window.innerWidth / 2, top: 80, bottom: 80 };
  const w = pop.offsetWidth, h = pop.offsetHeight;
  const left = Math.max(8, Math.min(r.right - w, window.innerWidth - w - 8, Math.max(8, r.left)));
  const below = window.innerHeight - r.bottom - 8;
  pop.style.left = Math.max(8, Math.min(left, window.innerWidth - w - 8)) + 'px';
  pop.style.top = (below >= h || r.top < h ? Math.min(r.bottom + 4, window.innerHeight - h - 8) : r.top - h - 4) + 'px';

  const onKey = (e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); } };
  const outside = (e) => { if (!pop.contains(e.target) && !anchor?.contains?.(e.target)) close(); };
  window.addEventListener('keydown', onKey, true);
  document.addEventListener('mousedown', outside, true);
  window.addEventListener('resize', close);
  function close() {
    if (!pop.isConnected) return;
    window.removeEventListener('keydown', onKey, true);
    document.removeEventListener('mousedown', outside, true);
    window.removeEventListener('resize', close);
    pop.remove();
    if (open?.close === close) open = null;
  }
  open = { close, anchor, el: pop };
  return open;
}
