// 단축키 → 명령 이름. 사용자가 재지정할 수 있다(createKeymap의 overrides).
// 키 이름 형식: 'Mod-Shift-z'. Mod는 macOS에서 Cmd, 나머지에서 Ctrl.
// 수식키 순서는 Mod, Ctrl, Alt, Shift로 고정한다(createKeymap이 정규화).

export const IS_MAC = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);

export const DEFAULT_KEYMAP = {
  'Mod-z': 'undo',
  'Mod-Shift-z': 'redo',
  'Mod-y': 'redo',
  'Mod-b': 'bold',
  'Mod-i': 'italic',
  'Mod-u': 'underline',
  'Mod-Shift-x': 'strike',
  'Mod-Shift-.': 'sizeUp',
  'Mod-Shift-,': 'sizeDown',
  'Mod-\\': 'clearMarks',
  'Mod-a': 'selectAll',
};

const ORDER = ['Mod', 'Ctrl', 'Alt', 'Shift'];

export function normalizeKeyName(name) {
  const parts = name.split(/-(?!$)/);
  let key = parts.pop();
  const mods = new Set(parts.map((p) => (/^(cmd|meta|m)$/i.test(p) ? 'Mod' : /^(control|ctrl|c)$/i.test(p) ? 'Ctrl' : /^(alt|a|option)$/i.test(p) ? 'Alt' : /^(shift|s)$/i.test(p) ? 'Shift' : p)));
  if (key.length === 1) key = key.toLowerCase();
  // 비 mac에서는 Ctrl = Mod
  if (!IS_MAC && mods.has('Ctrl')) { mods.delete('Ctrl'); mods.add('Mod'); }
  return [...ORDER.filter((m) => mods.has(m)), key].join('-');
}

// overrides: { '키': '명령' | null }. null이면 해당 키 해제.
// defaults: 기본 배치(편집기 = DEFAULT_KEYMAP, 캔버스 = app/shortcuts.js의 APP_KEYMAP)
export function createKeymap(overrides = {}, defaults = DEFAULT_KEYMAP) {
  const map = new Map();
  for (const [k, v] of Object.entries(defaults)) map.set(normalizeKeyName(k), v);
  for (const [k, v] of Object.entries(overrides)) {
    const n = normalizeKeyName(k);
    if (v == null) map.delete(n); else map.set(n, v);
  }
  return map;
}

// 물리 키 코드 → 기본(수식키 없는) 문자. 한글 입력 상태에서는 e.key가 'ㅠ'처럼 들어오므로 이 값으로 보정.
const CODE_KEYS = {
  Period: '.', Comma: ',', Slash: '/', Backslash: '\\', BracketLeft: '[', BracketRight: ']',
  Semicolon: ';', Quote: "'", Minus: '-', Equal: '=', Backquote: '`', Space: ' ',
};
function baseFromCode(code) {
  if (/^Key[A-Z]$/.test(code)) return code.slice(3).toLowerCase();
  if (/^Digit\d$/.test(code)) return code.slice(5);
  return CODE_KEYS[code] ?? null;
}

function modPrefix(e, withShift = true) {
  let s = '';
  const mod = IS_MAC ? e.metaKey : e.ctrlKey;
  if (mod) s += 'Mod-';
  if (IS_MAC && e.ctrlKey) s += 'Ctrl-';
  if (e.altKey) s += 'Alt-';
  if (withShift && e.shiftKey) s += 'Shift-';
  return s;
}

// keydown 이벤트 → 명령 이름(없으면 null).
// 1) e.key 그대로  2) 한글 등 비 ASCII 문자이거나 Shift로 문자가 바뀐 경우(>, <) 물리 키 기준으로 다시 찾는다.
export function lookup(map, e) {
  let key = e.key;
  if (key.length === 1) key = key.toLowerCase();
  const direct = map.get(modPrefix(e) + key);
  if (direct) return direct;
  const base = baseFromCode(e.code);
  if (base && base !== key) return map.get(modPrefix(e) + base) ?? null;
  return null;
}

// ---------- 사용자 재지정(설정 창) ----------
const MOD_KEYS = new Set(['Control', 'Shift', 'Alt', 'Meta', 'OS', 'CapsLock', 'Process', 'Unidentified', 'Dead', 'HangulMode', 'HanjaMode']);
// keydown → 키 이름('Mod-Shift-z'). 수식키만 누른 경우 null. 한글 자판 상태에서도 물리 키 기준(ㄱ → r)
export function eventKeyName(e) {
  if (MOD_KEYS.has(e.key)) return null;
  const base = baseFromCode(e.code);
  let key = base ?? e.key;
  if (!key) return null;
  if (key.length === 1) key = key.toLowerCase();
  return normalizeKeyName(modPrefix(e) + key);
}
// 수식키 없이 글자를 입력하는 키인가(글 편집 단축키로는 쓸 수 없음)
export function isTypingKey(name) {
  const parts = name.split(/-(?!$)/);
  const key = parts.pop();
  const mods = parts.filter((p) => p !== 'Shift');
  return !mods.length && (key.length === 1 || key === 'Enter' || key === 'Backspace' || key === 'Delete' || key === 'Tab' || /^Arrow/.test(key) || key === 'Home' || key === 'End');
}
const SHOW = { ArrowLeft: '←', ArrowRight: '→', ArrowUp: '↑', ArrowDown: '↓', ' ': 'Space', Escape: 'Esc', Delete: 'Delete', Backspace: 'Backspace', Enter: 'Enter' };
// 화면 표시용: 'Mod-Shift-z' → 'Ctrl+Shift+Z'(macOS: ⌘⇧Z)
export function displayKey(name) {
  const parts = name.split(/-(?!$)/);
  const key = parts.pop();
  const k = SHOW[key] ?? (key.length === 1 ? key.toUpperCase() : key);
  if (IS_MAC) return parts.map((p) => ({ Mod: '⌘', Ctrl: '⌃', Alt: '⌥', Shift: '⇧' })[p] || p).join('') + k;
  return [...parts.map((p) => (p === 'Mod' ? 'Ctrl' : p)), k].join('+');
}
// Electron 메뉴 accelerator 문자열: 'Mod-Shift-z' → 'CmdOrCtrl+Shift+Z'
const ACC = { ArrowLeft: 'Left', ArrowRight: 'Right', ArrowUp: 'Up', ArrowDown: 'Down', ' ': 'Space', Escape: 'Esc', '+': 'Plus' };
export function toAccelerator(name) {
  const parts = name.split(/-(?!$)/);
  const key = parts.pop();
  const k = ACC[key] ?? (key.length === 1 ? key.toUpperCase() : key);
  return [...parts.map((p) => (p === 'Mod' ? 'CmdOrCtrl' : p === 'Ctrl' ? 'Control' : p)), k].join('+');
}
// 기존 Map을 그 자리에서 다시 채운다(편집기·캔버스가 같은 Map을 쥐고 있으므로)
export function refillKeymap(map, overrides = {}, defaults = DEFAULT_KEYMAP) {
  const next = createKeymap(overrides, defaults);
  map.clear();
  for (const [k, v] of next) map.set(k, v);
  return map;
}
