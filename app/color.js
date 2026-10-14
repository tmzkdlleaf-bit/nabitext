// 색 입력칸과 프로젝트 스와치(자주 쓰는 색 모음).
// 색 값은 CSS 16진 표기: #rrggbb 또는 #rrggbbaa(투명도 포함). 빈 값 = 없음(채움·테두리 없음).

import { esc } from './util.js';

// 스와치에 들일 수 있는 값(파일에서 읽은 값은 화면에 넣기 전에 거른다)
const isColor = (c) => typeof c === 'string' && !!normHex(c);

export const normHex = (v) => {
  if (v == null) return '';
  v = String(v).trim().toLowerCase();
  if (!v || v === 'none' || v === 'transparent') return '';
  if (!v.startsWith('#')) v = '#' + v;
  if (/^#[0-9a-f]{3}$/.test(v)) v = '#' + [...v.slice(1)].map((c) => c + c).join('');
  if (/^#[0-9a-f]{4}$/.test(v)) v = '#' + [...v.slice(1)].map((c) => c + c).join('');
  if (/^#[0-9a-f]{8}$/.test(v) && v.endsWith('ff')) v = v.slice(0, 7);
  return /^#[0-9a-f]{6}([0-9a-f]{2})?$/.test(v) ? v : null; // null = 잘못된 값
};

// 프로젝트 스와치. 저장 단계에서 프로젝트 파일에 들어간다.
export class Swatches {
  constructor(list = ['#1f1f1f', '#ffffff', '#2b3a66', '#f4b942', '#e07a5f', '#b8c6e3']) {
    this.list = [...list];
    this.listeners = new Set();
  }
  add(c) { c = normHex(c); if (c && !this.list.includes(c)) { this.list.push(c); this.emit(); } }
  remove(c) { const i = this.list.indexOf(c); if (i >= 0) { this.list.splice(i, 1); this.emit(); } }
  onChange(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  emit() { for (const fn of this.listeners) fn(this.list); }
}

export const MIXED = Symbol('여러 값');

let popover = null; // 한 번에 하나만 연다
function closePopover() { popover?.remove(); popover = null; }
document.addEventListener('mousedown', (e) => { if (popover && !popover.contains(e.target) && !e.target.closest?.('.cf-more')) closePopover(); }, true);

// 색 입력칸
//   onInput(hex): 끌며 고르는 중(연속). onChange(hex): 확정. 둘 다 hex가 ''이면 '없음'.
//   allowNone: 빈 값 허용(채움 없음 등)
export class ColorField {
  constructor({ swatches, onInput, onChange, allowNone = false, title = '' }) {
    Object.assign(this, { swatches, onInput: onInput || onChange, onChange, allowNone });
    const el = this.el = document.createElement('span');
    el.className = 'cf';
    el.title = title;
    el.innerHTML = `<input type="color" class="cf-pick" tabindex="-1"><input type="text" class="cf-hex" spellcheck="false" maxlength="9" placeholder="${allowNone ? '없음' : ''}">` +
      `<button type="button" class="cf-drop" title="화면에서 색 가져오기(스포이트)">◉</button><button type="button" class="cf-more" title="스와치">▾</button>`;
    this.pick = el.querySelector('.cf-pick');
    this.hex = el.querySelector('.cf-hex');
    const drop = el.querySelector('.cf-drop');
    drop.disabled = typeof window.EyeDropper !== 'function';
    this.pick.addEventListener('input', () => this.onInput(this.withAlpha(this.pick.value)));
    this.pick.addEventListener('change', () => this.commit(this.withAlpha(this.pick.value)));
    this.hex.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); this.commitText(); this.hex.blur(); }
      if (e.key === 'Escape') { e.preventDefault(); this.set(this.value); this.hex.blur(); }
    });
    this.hex.addEventListener('change', () => this.commitText());
    drop.addEventListener('click', async () => {
      try { const r = await new window.EyeDropper().open(); this.commit(normHex(r.sRGBHex)); } catch { /* 취소 */ }
    });
    el.querySelector('.cf-more').addEventListener('click', () => this.openSwatches());
    this.value = '';
  }
  // 투명도가 있는 값을 고르기 창으로 바꾸면 원래 투명도를 유지한다
  withAlpha(rgb) { const a = typeof this.value === 'string' && this.value.length === 9 ? this.value.slice(7) : ''; return rgb + a; }
  commitText() {
    const v = normHex(this.hex.value);
    if (v === null || (v === '' && !this.allowNone)) { this.set(this.value); return; }
    this.commit(v);
  }
  commit(v) { this.set(v); this.onChange(v); }
  set(v) {
    this.value = v;
    const mixed = v === MIXED;
    this.hex.value = mixed ? '' : (v || '');
    this.hex.placeholder = mixed ? '여러 값' : this.allowNone ? '없음' : '';
    this.pick.value = !mixed && v ? v.slice(0, 7) : '#000000';
    this.pick.style.opacity = !mixed && v ? '1' : '.35';
  }
  openSwatches() {
    if (popover?.owner === this) return closePopover();
    closePopover();
    const pop = popover = document.createElement('div');
    pop.owner = this;
    pop.className = 'cf-pop';
    const draw = () => {
      pop.innerHTML = this.swatches.list.filter(isColor).map((c) => `<button type="button" class="cf-sw" data-c="${esc(c)}" title="${esc(c)} (Alt+클릭: 스와치에서 빼기)" style="background:${esc(c)}"></button>`).join('') +
        `<button type="button" class="cf-add" title="지금 색을 스와치에 추가">＋</button>`;
    };
    draw();
    const off = this.swatches.onChange(draw);
    pop.addEventListener('mousedown', (e) => e.preventDefault());
    pop.addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      if (b.classList.contains('cf-add')) { if (typeof this.value === 'string' && this.value) this.swatches.add(this.value); return; }
      if (e.altKey) { this.swatches.remove(b.dataset.c); return; }
      this.commit(b.dataset.c);
      closePopover();
    });
    const r = this.el.getBoundingClientRect();
    pop.style.cssText = `position:fixed;left:${Math.max(4, r.right - 190)}px;top:${r.bottom + 4}px;z-index:1000`;
    document.body.appendChild(pop);
    const origRemove = pop.remove.bind(pop);
    pop.remove = () => { off(); origRemove(); };
  }
}

export const COLOR_CSS = `
.cf{display:inline-flex;align-items:center;gap:2px}
.cf-pick{width:24px;height:22px;padding:0;border:1px solid #cfccc6;border-radius:3px;background:none;cursor:pointer}
.cf-hex{width:78px;font:12px ui-monospace,monospace;padding:2px 4px;border:1px solid #cfccc6;border-radius:3px}
.cf button{font:11px/1 system-ui;padding:3px 4px;border:1px solid #cfccc6;background:#fff;border-radius:3px;cursor:pointer}
.cf button:disabled{opacity:.35;cursor:default}
.cf-pop{display:flex;flex-wrap:wrap;gap:4px;width:180px;padding:6px;background:#fff;border:1px solid #cfccc6;border-radius:6px;box-shadow:0 4px 14px rgba(0,0,0,.15)}
.cf-pop .cf-sw{width:22px;height:22px;border:1px solid rgba(0,0,0,.2);border-radius:3px;cursor:pointer;padding:0}
.cf-pop .cf-add{width:22px;height:22px;border:1px dashed #999;background:#fff;border-radius:3px;cursor:pointer;padding:0}
`;
