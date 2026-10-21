// 글꼴 고르기 칸(속성 패널). 입력칸 + 펼침 목록.
//   목록: 넣은 글꼴(이 컴퓨터에 보관, 프로젝트에도 포함) → 기본 글꼴 → 시스템 글꼴. 글꼴 이름은 그 글꼴로 그려 미리 보인다.
//   입력칸에 치면 목록이 걸러지고, ↑↓로 고르고 Enter. 목록에 없는 이름을 치고 Enter를 누르면 그 이름 그대로 적용.
//   목록 아래 "글꼴 파일 넣기…"·"시스템 글꼴 불러오기". 넣은 글꼴은 ×로 프로젝트에서 뺄 수 있다.
// 목록을 누를 때는 포커스를 옮기지 않는다(mousedown 막기) → 글상자 편집 중이면 고른 글자 범위가 그대로 남는다.

import { esc } from './util.js';
import { WEIGHT_NAMES } from './font-info.js';

const CSS = `
.fp{display:flex;align-items:center;gap:0;min-width:0}
.fp input{flex:1;min-width:0}
.fp .fp-open{border:0;background:none;padding:0 4px;color:var(--muted,#8a857d);cursor:pointer;font-size:11px;line-height:1}
.fp-pop{position:fixed;z-index:1000;background:#fff;border:1px solid var(--line,#e4e1dc);border-radius:8px;box-shadow:0 8px 28px rgba(0,0,0,.16);
  display:flex;flex-direction:column;max-height:360px;font-size:12px;color:var(--text,#23211e)}
.fp-list{overflow-y:auto;padding:4px 0;flex:1;min-height:0}
.fp-h{padding:6px 10px 3px;font-size:11px;color:var(--muted,#8a857d);display:flex;justify-content:space-between;gap:8px}
.fp-it{display:flex;align-items:center;gap:6px;padding:4px 10px;cursor:pointer;min-height:26px}
.fp-it:hover,.fp-it.hi{background:var(--accent-bg,#e7effd)}
.fp-it.cur .fp-name::before{content:'✓ ';color:var(--accent,#2d6cdf)}
.fp-name{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:15px}
.fp-sub{color:var(--muted,#8a857d);font-size:11px;white-space:nowrap;font-family:inherit}
.fp-x{border:0;background:none;color:var(--muted,#8a857d);cursor:pointer;padding:0 2px;font-size:13px;visibility:hidden}
.fp-it:hover .fp-x{visibility:visible}
.fp-x:hover{color:#c0392b}
.fp-empty{padding:8px 10px;color:var(--muted,#8a857d)}
.fp-foot{display:flex;gap:6px;padding:6px 8px;border-top:1px solid var(--line2,#ecebe7)}
.fp-foot button{flex:1;border:1px solid var(--line,#e4e1dc);background:var(--panel,#fbfaf8);border-radius:5px;padding:4px 6px;cursor:pointer;font-size:12px}
.fp-foot button:hover{background:var(--bg,#f4f3f0)}
@media (pointer: coarse){.fp-it{min-height:40px}.fp-x{visibility:visible;font-size:18px;padding:0 8px}.fp-foot button{padding:9px 6px}.fp-pop{max-height:420px}}
`;
let cssInjected = false;
let open = null; // 지금 열린 목록 { close() }

export function closeFontPicker() { open?.close(); }

// label: 칸 이름, get() → 지금 글꼴 이름(MIXED면 섞임), set(이름), source() → { project: [{ family, label, faces:[{weight,style}] }], defaults: [이름], system: [이름] }
// actions: { addFiles(), loadSystem(), remove(family) } (없으면 그 버튼을 감춤), back(): 적용 뒤 키보드를 캔버스로
export function fontField({ label, get, set, source, actions = {}, back = () => {}, MIXED }) {
  if (!cssInjected) { document.head.insertAdjacentHTML('beforeend', `<style>${CSS}</style>`); cssInjected = true; }
  const el = document.createElement('label');
  el.className = 'f fp';
  el.innerHTML = `<span>${esc(label)}</span><input class="txt" type="text" spellcheck="false" autocomplete="off" role="combobox" aria-expanded="false"><button type="button" class="fp-open" tabindex="-1" title="글꼴 목록">▼</button>`;
  const inp = el.querySelector('input');
  inp.dataset.field = label;
  const btn = el.querySelector('.fp-open');
  let pop = null, items = [], hi = -1, typed = false;

  const current = () => { const v = get(); return v === MIXED ? '' : v ?? ''; };
  const refresh = () => {
    const v = get();
    if (document.activeElement !== inp || !typed) inp.value = v === MIXED ? '' : v ?? '';
    inp.placeholder = v === MIXED ? '여러 글꼴' : '';
  };

  function choose(name) {
    close();
    typed = false;
    name = String(name || '').trim();
    if (name && name !== current()) set(name);
    refresh();
    back();
  }

  function build(filter) {
    const src = source();
    const q = (filter || '').trim().toLowerCase();
    const match = (name, alt) => !q || name.toLowerCase().includes(q) || (alt && alt.toLowerCase().includes(q));
    const seen = new Set();
    const groups = [];
    const proj = src.project.filter((f) => match(f.family, f.label));
    proj.forEach((f) => seen.add(f.family.toLowerCase()));
    groups.push(['넣은 글꼴 (이 컴퓨터에 보관 · 모든 프로젝트)', proj.map((f) => ({ family: f.family, sub: subOf(f), removable: true })),
      src.project.length ? '' : '아직 없음 · 아래 "글꼴 파일 넣기…"로 넣으십시오']);
    const plain = (list) => list.filter((n) => { const k = n.toLowerCase(); if (seen.has(k) || !match(n)) return false; seen.add(k); return true; }).map((family) => ({ family }));
    groups.push(['기본 글꼴', plain(src.defaults), '']);
    if (src.system.length) groups.push(['시스템 글꼴 (이 컴퓨터에만 있음)', plain(src.system), '']);
    const cur = current().toLowerCase();
    items = [];
    let html = '';
    for (const [title, list, empty] of groups) {
      if (!list.length && !(empty && !q)) continue;
      html += `<div class="fp-h"><span>${esc(title)}</span></div>`;
      if (!list.length) html += `<div class="fp-empty">${esc(empty)}</div>`;
      for (const it of list) {
        const i = items.push(it) - 1;
        html += `<div class="fp-it${it.family.toLowerCase() === cur ? ' cur' : ''}" data-i="${i}" role="option">` +
          `<span class="fp-name" style="font-family:${esc(cssFamily(it.family))}">${esc(it.family)}</span>` +
          (it.sub ? `<span class="fp-sub">${esc(it.sub)}</span>` : '') +
          (it.removable && actions.remove ? `<button type="button" class="fp-x" data-x="${i}" title="이 글꼴 빼기">×</button>` : '') + '</div>';
      }
    }
    if (!items.length && q) html += `<div class="fp-empty">"${esc(filter.trim())}" — 목록에 없습니다. Enter를 누르면 이 이름 그대로 적용합니다.</div>`;
    return html;
  }

  function render() {
    if (!pop) return;
    pop.querySelector('.fp-list').innerHTML = build(typed ? inp.value : '');
    hi = Math.min(hi, items.length - 1);
    highlight(hi);
  }
  function highlight(i) {
    hi = i;
    for (const x of pop.querySelectorAll('.fp-it.hi')) x.classList.remove('hi');
    const row = i >= 0 ? pop.querySelector(`.fp-it[data-i="${i}"]`) : null;
    if (row) { row.classList.add('hi'); row.scrollIntoView({ block: 'nearest' }); }
  }
  function place() {
    const r = inp.getBoundingClientRect();
    const w = Math.max(r.width + 40, 280);
    const left = Math.min(r.left, window.innerWidth - w - 8);
    const below = window.innerHeight - r.bottom - 8;
    pop.style.width = w + 'px';
    pop.style.left = Math.max(8, left) + 'px';
    if (below < 220 && r.top > below) { pop.style.top = ''; pop.style.bottom = (window.innerHeight - r.top + 4) + 'px'; pop.style.maxHeight = Math.min(360, r.top - 12) + 'px'; }
    else { pop.style.bottom = ''; pop.style.top = (r.bottom + 4) + 'px'; pop.style.maxHeight = Math.min(360, below) + 'px'; }
  }
  function openPop() {
    if (pop) return;
    closeFontPicker();
    pop = document.createElement('div');
    pop.className = 'fp-pop';
    pop.setAttribute('role', 'listbox');
    pop.innerHTML = `<div class="fp-list"></div><div class="fp-foot">${actions.addFiles ? '<button type="button" data-a="add">글꼴 파일 넣기…</button>' : ''}${actions.loadSystem && !source().system.length ? '<button type="button" data-a="sys">시스템 글꼴 불러오기</button>' : ''}</div>`;
    if (!pop.querySelector('.fp-foot button')) pop.querySelector('.fp-foot').remove();
    pop.addEventListener('mousedown', (e) => e.preventDefault()); // 포커스·글자 선택을 그대로 둔다
    pop.addEventListener('click', async (e) => {
      const x = e.target.closest('[data-x]');
      if (x) { e.stopPropagation(); const it = items[+x.dataset.x]; if (it && await actions.remove(it.family)) render(); return; }
      const a = e.target.closest('[data-a]')?.dataset.a;
      if (a === 'add') { close(); const added = await actions.addFiles(); if (added) refresh(); return; }
      if (a === 'sys') { await actions.loadSystem(); render(); pop?.querySelector('[data-a="sys"]')?.remove(); return; }
      const row = e.target.closest('.fp-it');
      if (row) choose(items[+row.dataset.i].family);
    });
    pop.addEventListener('mousemove', (e) => { const row = e.target.closest('.fp-it'); if (row && +row.dataset.i !== hi) highlight(+row.dataset.i); });
    document.body.appendChild(pop);
    inp.setAttribute('aria-expanded', 'true');
    hi = -1;
    render();
    place();
    const cur = pop.querySelector('.fp-it.cur');
    if (cur && !typed) { highlight(+cur.dataset.i); hi = -1; cur.classList.remove('hi'); }
    const outside = (e) => { if (!pop?.contains(e.target) && !el.contains(e.target)) close(); };
    // 목록이 열린 동안 키: Esc = 목록만 닫기(선택 해제·편집 끝내기로 넘어가지 않게). 입력칸 밖(▼로 연 경우)에서는 ↑↓·Enter로 고르기
    const onKey = (e) => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); if (document.activeElement === inp) { typed = false; refresh(); back(); } return; }
      if (document.activeElement === inp) return; // 입력칸은 아래 keydown이 처리
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault(); e.stopPropagation();
        const n = items.length;
        if (n) highlight(e.key === 'ArrowDown' ? (hi + 1) % n : (hi <= 0 ? n - 1 : hi - 1));
      } else if (e.key === 'Enter' && hi >= 0) { e.preventDefault(); e.stopPropagation(); choose(items[hi].family); }
    };
    window.addEventListener('keydown', onKey, true);
    const onScroll = (e) => { if (!pop?.contains(e.target)) close(); };
    document.addEventListener('mousedown', outside, true);
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', close);
    open = { close };
    pop.cleanup = () => { window.removeEventListener('keydown', onKey, true); document.removeEventListener('mousedown', outside, true); window.removeEventListener('scroll', onScroll, true); window.removeEventListener('resize', close); };
  }
  function close() {
    if (!pop) return;
    pop.cleanup();
    pop.remove();
    pop = null;
    items = [];
    hi = -1;
    inp.setAttribute('aria-expanded', 'false');
    if (open?.close === close) open = null;
  }

  btn.addEventListener('mousedown', (e) => e.preventDefault());
  btn.addEventListener('click', (e) => { e.preventDefault(); if (pop) close(); else { typed = false; openPop(); } });
  inp.addEventListener('focus', () => { typed = false; inp.select(); });
  inp.addEventListener('input', () => {
    typed = true;
    if (!pop) openPop(); else render();
    // 똑같은 이름 → 그 이름으로 시작하는 이름 순으로 미리 고른다(없으면 Enter = 친 이름 그대로)
    const v = inp.value.trim().toLowerCase();
    let i = v ? items.findIndex((it) => it.family.toLowerCase() === v) : -1;
    if (i < 0 && v) i = items.findIndex((it) => it.family.toLowerCase().startsWith(v));
    highlight(i);
  });
  inp.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!pop) { openPop(); return; }
      const n = items.length;
      if (n) highlight(e.key === 'ArrowDown' ? (hi + 1) % n : (hi <= 0 ? n - 1 : hi - 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const v = inp.value.trim();
      // 고른 줄이 있으면 그 글꼴, 없으면 친 이름(목록에 대소문자만 다른 같은 이름이 있으면 그 이름으로)
      if (pop && hi >= 0 && items[hi]) return choose(items[hi].family);
      const all = [...source().project.map((f) => f.family), ...source().defaults, ...source().system];
      choose(all.find((n) => n.toLowerCase() === v.toLowerCase()) || v);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      if (pop) close();
      typed = false; refresh(); back();
    } else if (e.key === 'Tab') close();
  });
  inp.addEventListener('blur', () => { setTimeout(() => { if (document.activeElement !== inp && !pop) { typed = false; refresh(); } }, 0); });
  return { el, refresh, open: openPop, close, items: () => items.map((i) => i.family) };
}

// 미리보기용 CSS 글꼴 값(일반 이름은 따옴표 없이)
const GENERIC = new Set(['serif', 'sans-serif', 'monospace', 'cursive', 'fantasy', 'system-ui']);
function cssFamily(f) { return GENERIC.has(f.toLowerCase()) ? f : `"${f.replace(/["\\]/g, '')}", sans-serif`; }

function subOf(f) {
  const ws = [...new Set(f.faces.map((x) => +x.weight))].sort((a, b) => a - b);
  const parts = [];
  if (f.label) parts.push(f.label);
  if (ws.length > 1) parts.push(`굵기 ${ws.length}종`);
  else if (ws.length === 1 && ws[0] !== 400) parts.push(WEIGHT_NAMES[ws[0]] || String(ws[0]));
  if (f.faces.some((x) => x.style === 'italic')) parts.push('기울임 포함');
  return parts.join(' · ');
}
