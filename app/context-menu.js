// 캔버스 오른쪽 클릭 메뉴(태블릿은 길게 누르기). 메뉴 항목은 앱(main.js)이 지금 선택에 맞춰 만든다.
// items: [{ label, keys(단축키 글), act(), disabled, checked } | '-'(구분선)]

import { esc } from './util.js';

const CSS = `
.cm{position:fixed;z-index:1100;min-width:200px;max-width:280px;background:#fff;border:1px solid var(--line,#e4e1dc);border-radius:8px;
  box-shadow:0 10px 28px rgba(0,0,0,.16);padding:4px;font-size:13px;color:var(--text,#23211e)}
.cm button{display:flex;width:100%;align-items:center;gap:10px;border:0;background:none;text-align:left;padding:7px 10px;border-radius:5px;font:inherit;color:inherit;cursor:pointer}
.cm button:hover:not(:disabled),.cm button:focus-visible{background:var(--accent-bg,#e7effd);outline:none}
.cm button:disabled{color:#b9b4ab;cursor:default}
.cm .cm-k{margin-left:auto;color:var(--muted,#8a857d);font-size:11px}
.cm .cm-c{width:14px;flex:none;color:var(--accent,#2d6cdf)}
.cm hr{border:0;border-top:1px solid var(--line,#e4e1dc);margin:4px 2px}
@media (pointer: coarse){.cm button{padding:12px 12px;font-size:15px}.cm{min-width:240px}}
`;
let cssIn = false, open = null;
export function closeContextMenu() { open?.(); }

export function showContextMenu(x, y, items) {
  closeContextMenu();
  if (!cssIn) { document.head.insertAdjacentHTML('beforeend', `<style>${CSS}</style>`); cssIn = true; }
  const list = items.filter(Boolean);
  if (!list.some((it) => it !== '-')) return null;
  const el = document.createElement('div');
  el.className = 'cm';
  el.setAttribute('role', 'menu');
  el.innerHTML = list.map((it, i) => (it === '-' ? '<hr>' :
    `<button type="button" role="menuitem" data-i="${i}"${it.disabled ? ' disabled' : ''}><span class="cm-c">${it.checked ? '✓' : ''}</span><span>${esc(it.label)}</span>${it.keys ? `<span class="cm-k">${esc(it.keys)}</span>` : ''}</button>`)).join('');
  el.addEventListener('mousedown', (e) => e.preventDefault());
  el.addEventListener('contextmenu', (e) => e.preventDefault());
  el.addEventListener('click', (e) => {
    const b = e.target.closest('button[data-i]');
    if (!b || b.disabled) return;
    const it = list[+b.dataset.i];
    close();
    it.act();
  });
  document.body.appendChild(el);
  const w = el.offsetWidth, h = el.offsetHeight;
  el.style.left = Math.max(4, Math.min(x, window.innerWidth - w - 4)) + 'px';
  el.style.top = Math.max(4, y + h > window.innerHeight - 4 ? y - h : y) + 'px';
  const onKey = (e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); } };
  // 바깥을 누르면 닫는다. 메뉴를 띄운 그 누름(길게 누르기)에서 이어지는 이벤트로 바로 닫히지 않게 한 틱 뒤에 단다
  const outside = (e) => { if (!el.contains(e.target)) close(); };
  const t = setTimeout(() => { document.addEventListener('pointerdown', outside, true); window.addEventListener('blur', close); }, 0);
  window.addEventListener('keydown', onKey, true);
  window.addEventListener('resize', close);
  function close() {
    if (!el.isConnected) return;
    clearTimeout(t);
    el.remove();
    document.removeEventListener('pointerdown', outside, true);
    window.removeEventListener('blur', close);
    window.removeEventListener('keydown', onKey, true);
    window.removeEventListener('resize', close);
    if (open === close) open = null;
  }
  open = close;
  return el;
}
