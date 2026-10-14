// 설정 창: 단축키 재지정(캔버스·글 편집)과 동작 스위치. 설정은 이 컴퓨터에만 저장한다(localStorage 'nabitext.settings').
//   { keys: { app: { 키: 명령 | null }, edit: { … } }, crossPageLinks: true, pageThumbs: true, autoUpdate: true, layout: (app/layout-ui.js) }
//   keys에는 기본 배치와 다른 것만 담는다(null = 기본 키를 뺌).

import { DEFAULT_KEYMAP, createKeymap, refillKeymap, eventKeyName, isTypingKey, displayKey, toAccelerator } from '../src/keymap.js';
import { APP_KEYMAP } from './shortcuts.js';
import { esc, modal } from './util.js';
import { cleanLayout, applyLayout, TOOL_ITEMS, LAYOUT_DEFAULT } from './layout-ui.js';

const PREF = 'nabitext.settings';

// 명령 이름 → 설정 창에 보일 이름(표시 순서 = 이 순서)
export const APP_COMMANDS = [
  ['tool:select', '선택 도구'], ['tool:text', '글상자 도구'], ['tool:rect', '사각형 도구'], ['tool:ellipse', '원 도구'], ['tool:pen', '펜 도구'], ['tool:line', '선 도구'],
  ['undo', '되돌리기'], ['redo', '다시 실행'], ['delete', '지우기'], ['duplicate', '복제'], ['selectAll', '모두 선택'],
  ['group', '그룹'], ['ungroup', '그룹 해제'], ['forward', '앞으로'], ['backward', '뒤로'], ['front', '맨 앞으로'], ['back', '맨 뒤로'],
  ['lock', '잠금'], ['hide', '숨김'], ['escape', '선택 해제·편집 끝내기'], ['enterEdit', '글상자 편집 시작'],
  ['nudge:-1:0', '왼쪽으로 1px'], ['nudge:1:0', '오른쪽으로 1px'], ['nudge:0:-1', '위로 1px'], ['nudge:0:1', '아래로 1px'],
  ['nudge:-10:0', '왼쪽으로 10px'], ['nudge:10:0', '오른쪽으로 10px'], ['nudge:0:-10', '위로 10px'], ['nudge:0:10', '아래로 10px'],
  ['zoomFit', '화면에 맞춤'], ['zoom100', '100%'], ['zoomIn', '확대'], ['zoomOut', '축소'],
  ['view:panels', '패널 숨기기·보이기'], ['view:rulers', '눈금자'], ['view:grid', '격자'], ['view:guides', '가이드 보이기'],
  ['find', '찾기·바꾸기'], ['file:new', '새로 만들기'], ['file:open', '열기'], ['file:save', '저장'], ['file:saveAs', '다른 이름으로 저장'], ['export', '내보내기'],
];
export const EDIT_COMMANDS = [
  ['bold', '굵게'], ['italic', '기울임'], ['underline', '밑줄'], ['strike', '취소선'], ['overline', '윗줄'],
  ['sizeUp', '글자 크게'], ['sizeDown', '글자 작게'], ['clearMarks', '꾸밈 지우기'], ['selectAll', '전체 선택'], ['undo', '되돌리기'], ['redo', '다시 실행'],
];
const SCOPES = { app: { defaults: APP_KEYMAP, commands: APP_COMMANDS, title: '단축키 — 캔버스' }, edit: { defaults: DEFAULT_KEYMAP, commands: EDIT_COMMANDS, title: '단축키 — 글상자 편집 중' } };
// Electron 메뉴 항목 id → 캔버스 명령(메뉴에 보이는 단축키를 재지정에 맞춘다)
const MENU_IDS = { new: 'file:new', open: 'file:open', save: 'file:save', saveAs: 'file:saveAs', export: 'export', undo: 'undo', redo: 'redo', selectAll: 'selectAll', find: 'find', panels: 'view:panels', rulers: 'view:rulers', grid: 'view:grid', guides: 'view:guides' };

export function loadSettings() {
  let s = null;
  try { s = JSON.parse(localStorage.getItem(PREF) || 'null'); } catch { s = null; }
  const clean = (o) => { const out = {}; if (o && typeof o === 'object') for (const [k, v] of Object.entries(o)) if (typeof k === 'string' && (v === null || typeof v === 'string')) out[k] = v; return out; };
  return { keys: { app: clean(s?.keys?.app), edit: clean(s?.keys?.edit) }, crossPageLinks: s?.crossPageLinks !== false, pageThumbs: s?.pageThumbs !== false, autoUpdate: s?.autoUpdate !== false, layout: cleanLayout(s?.layout) };
}
export function saveSettings(s) { try { localStorage.setItem(PREF, JSON.stringify(s)); } catch { /* 저장소를 못 쓰면 이번 실행에만 적용 */ } }

// 설정 → 실제 keymap(Map, 제자리 갱신)·화면 스위치·Electron 메뉴 표시
export function applySettings(s, ctx) {
  const { appKeymap, keymap, view, platform } = ctx;
  refillKeymap(appKeymap, s.keys.app, APP_KEYMAP);
  refillKeymap(keymap, s.keys.edit, DEFAULT_KEYMAP);
  view.crossPageLinks = s.crossPageLinks;
  applyLayout(s.layout);
  if (ctx.thumbs) { ctx.thumbs.setEnabled(s.pageThumbs); ctx.onThumbs?.(); }
  platform?.updates?.setAuto(s.autoUpdate);
  if (platform?.isElectron) {
    const accels = {};
    for (const [id, cmd] of Object.entries(MENU_IDS)) { const k = keysOf(appKeymap, cmd)[0]; accels[id] = k ? toAccelerator(k) : ''; }
    platform.setMenuState({ accels });
  }
}

// map에서 cmd에 걸린 키들(기본 배치 순서를 먼저)
export function keysOf(map, cmd) { return [...map].filter(([, c]) => c === cmd).map(([k]) => k); }

// 현재 배치(map) → 기본 배치와의 차이(overrides)
function diff(map, defaults) {
  const def = createKeymap({}, defaults);
  const out = {};
  for (const [k, c] of map) if (def.get(k) !== c) out[k] = c;
  for (const [k] of def) if (!map.has(k)) out[k] = null;
  return out;
}

export const SETTINGS_CSS = `
.modal.settings{max-width:760px;width:760px}
.st-body{max-height:66vh;overflow:auto;margin-bottom:10px}
.st-body h4{margin:14px 0 6px;font-size:13px}
.st-row{display:flex;align-items:center;gap:8px;padding:3px 0;border-bottom:1px solid #f0eeea;font-size:12px}
.st-name{width:170px;flex:none}
.st-keys{flex:1;display:flex;flex-wrap:wrap;gap:4px;align-items:center}
.st-key{display:inline-flex;align-items:center;gap:2px;padding:1px 4px 1px 7px;border:1px solid #cfccc6;border-radius:4px;background:#fafaf8;font-family:inherit}
.st-key button{border:0;background:none;cursor:pointer;color:#999;padding:0 2px;font:inherit}
.st-row .st-act{font:inherit;font-size:11px;padding:2px 7px;border:1px solid #cfccc6;background:#fff;border-radius:3px;cursor:pointer}
.st-capture{color:#2d7ff9;font-weight:600}
.st-note{color:#b05a00;font-size:12px;min-height:18px;margin:4px 0}
.st-lay{display:flex;align-items:center;gap:12px;font-size:12px;padding:4px 0;flex-wrap:wrap}
.st-lay > span{width:70px;flex:none;color:#666}
.st-lay em{font-style:normal;color:#888}
.st-lay.top{align-items:flex-start}
.st-tools{display:flex;flex-direction:column;gap:2px}
.st-tool{display:flex;align-items:center;gap:6px}
.st-tool label{width:90px}
.st-upd{font-size:12px;color:#444;margin:4px 0 0 22px;display:flex;gap:6px;align-items:center;flex-wrap:wrap}
.st-opt{display:flex;gap:6px;align-items:flex-start;font-size:12px;line-height:1.6}
`;

// 설정 창 열기. ctx: { appKeymap, keymap, view, platform, onChange }
export function openSettings(ctx) {
  const s = loadSettings();
  const maps = { app: ctx.appKeymap, edit: ctx.keymap };
  const bg = modal(`<p>설정</p><div class="st-body"></div><div class="st-note"></div>
    <div class="modal-btns"><button data-v="close">닫기</button></div>`, 'settings');
  const body = bg.querySelector('.st-body'), note = bg.querySelector('.st-note');
  let capture = null; // { scope, cmd }
  // 업데이트 상태(창이 떠 있는 동안 바뀌면 그 줄만 고친다)
  let updState = null;
  const offUpd = ctx.platform?.updates?.onState((st) => { updState = st; draw(); });
  ctx.platform?.updates?.state().then((st) => { updState = st; draw(); });
  const commit = () => {
    s.keys.app = diff(maps.app, APP_KEYMAP);
    s.keys.edit = diff(maps.edit, DEFAULT_KEYMAP);
    saveSettings(s);
    applySettings(s, ctx);
    ctx.onChange?.(s);
  };
  const draw = () => {
    const L = s.layout;
    const radio = (name, val, label) => `<label><input type="radio" name="lay-${name}" data-lay="${name}" value="${val}"${String(L[name]) === String(val) ? ' checked' : ''}> ${label}</label>`;
    const ck = (key, label) => `<label><input type="checkbox" data-lay="${key}"${L[key] ? ' checked' : ''}> ${label}</label>`;
    const tools = L.toolOrder.map((id, i) => `<div class="st-tool" data-tool-id="${id}"><label><input type="checkbox" data-toolshow="${id}"${L.toolHidden.includes(id) ? '' : ' checked'}> ${esc(TOOL_ITEMS.find((t) => t[0] === id)[1])}</label>` +
      `<button class="st-act" data-toolmove="-1"${i ? '' : ' disabled'} title="앞으로">↑</button><button class="st-act" data-toolmove="1"${i < L.toolOrder.length - 1 ? '' : ' disabled'} title="뒤로">↓</button></div>`).join('');
    let h = `<h4>화면 배치 <button class="st-act" data-layreset>기본값으로</button></h4>
      <div class="st-lay"><span>도구 막대</span>${radio('tools', 'top', '위')}${radio('tools', 'left', '왼쪽')}${radio('tools', 'right', '오른쪽')}</div>
      <div class="st-lay"><span>패널 자리</span>${radio('swap', 'false', '장·레이어 왼쪽 · 속성 오른쪽')}${radio('swap', 'true', '반대로')}</div>
      <div class="st-lay"><span>보이기</span>${ck('showLeft', '장·레이어 패널')}${ck('showRight', '속성 패널')}${ck('showStatus', '상태 줄')}</div>
      <div class="st-lay"><span>패널 너비</span><em>패널 가장자리를 끌어 바꿉니다(두 번 누르면 기본). 지금 ${L.leftW}px · ${L.rightW}px</em></div>
      <div class="st-lay top"><span>보일 도구</span><div class="st-tools">${tools}</div></div>
      <h4>동작</h4><label class="st-opt"><input type="checkbox" data-opt="pageThumbs"${s.pageThumbs ? ' checked' : ''}>
      <span><b>장 목록 미리보기</b> — 장 목록에 장마다 작은 그림을 보입니다. 끄면 목록이 한 줄씩으로 줄고 미리보기를 그리지 않습니다.</span></label><label class="st-opt"><input type="checkbox" data-opt="crossPageLinks"${s.crossPageLinks ? ' checked' : ''}>
      <span><b>다른 장의 글상자와 잇기</b> — 켜면 넘친 글을 뒤쪽 장의 글상자로 이을 수 있습니다("다음 장으로 이어 쓰기" 포함). 끄면 같은 장 안에서만 잇습니다. 이미 여러 장에 걸쳐 이어진 글은 그대로 흐릅니다.</span></label>`;
    if (ctx.platform?.updates) h += `<h4>업데이트</h4><label class="st-opt"><input type="checkbox" data-opt="autoUpdate"${s.autoUpdate ? ' checked' : ''}>
      <span><b>업데이트 자동 확인</b> — 켜 두면 앱을 켤 때와 켜 둔 동안 6시간마다 새 버전을 확인해 내려받고, 앱을 끝낼 때 설치합니다. 작업 중에는 끊지 않습니다.</span></label>
      <div class="st-upd"><span data-upd>${esc(ctx.updateText?.(updState) || '')}</span> <button class="st-act" data-updcheck>지금 확인</button>${updState?.status === 'ready' ? ' <button class="st-act" data-updinstall>다시 시작해서 업데이트</button>' : ''}</div>`;
    for (const [scope, sc] of Object.entries(SCOPES)) {
      h += `<h4>${sc.title} <button class="st-act" data-reset="${scope}">모두 기본값으로</button></h4>`;
      for (const [cmd, label] of sc.commands) {
        const keys = keysOf(maps[scope], cmd);
        const cap = capture && capture.scope === scope && capture.cmd === cmd;
        h += `<div class="st-row" data-scope="${scope}" data-cmd="${esc(cmd)}"><span class="st-name">${esc(label)}</span><span class="st-keys">` +
          keys.map((k) => `<span class="st-key" data-key="${esc(k)}">${esc(displayKey(k))}<button data-del title="이 키 빼기">×</button></span>`).join('') +
          (cap ? '<span class="st-capture">키를 누르십시오(Esc = 취소)</span>' : '') +
          `</span><button class="st-act" data-add>추가</button><button class="st-act" data-def>기본값</button></div>`;
      }
    }
    body.innerHTML = h;
  };
  const layChanged = () => { saveSettings(s); applySettings(s, ctx); ctx.onChange?.(s); ctx.onLayout?.(); };
  body.addEventListener('change', (e) => {
    const lay = e.target.dataset?.lay, show = e.target.dataset?.toolshow;
    if (lay) {
      s.layout[lay] = e.target.type === 'checkbox' ? e.target.checked : lay === 'swap' ? e.target.value === 'true' : e.target.value;
      layChanged(); return;
    }
    if (show) {
      const hid = new Set(s.layout.toolHidden);
      if (e.target.checked) hid.delete(show); else hid.add(show);
      s.layout.toolHidden = [...hid];
      layChanged(); return;
    }
    const opt = e.target.dataset?.opt;
    if (opt) { s[opt] = e.target.checked; saveSettings(s); applySettings(s, ctx); ctx.onChange?.(s); }
  });
  body.addEventListener('click', (e) => {
    if (e.target.matches('[data-layreset]')) { s.layout = cleanLayout(LAYOUT_DEFAULT); layChanged(); note.textContent = '화면 배치를 기본값으로 되돌렸습니다.'; return draw(); }
    const mv = e.target.dataset?.toolmove;
    if (mv) {
      const id = e.target.closest('[data-tool-id]').dataset.toolId, o = s.layout.toolOrder, i = o.indexOf(id), j = i + +mv;
      if (j >= 0 && j < o.length) { [o[i], o[j]] = [o[j], o[i]]; layChanged(); draw(); }
      return;
    }
    if (e.target.matches('[data-updcheck]')) { ctx.platform.updates.check(); return; }
    if (e.target.matches('[data-updinstall]')) { close(); ctx.installUpdate?.(); return; }
    const reset = e.target.dataset?.reset;
    if (reset) { refillKeymap(maps[reset], {}, SCOPES[reset].defaults); commit(); note.textContent = `${SCOPES[reset].title}을(를) 기본값으로 되돌렸습니다.`; return draw(); }
    const row = e.target.closest('.st-row');
    if (!row) return;
    const { scope, cmd } = row.dataset;
    const map = maps[scope];
    if (e.target.matches('[data-del]')) { map.delete(e.target.closest('.st-key').dataset.key); commit(); note.textContent = ''; return draw(); }
    if (e.target.matches('[data-add]')) { capture = { scope, cmd }; note.textContent = ''; return draw(); }
    if (e.target.matches('[data-def]')) {
      for (const k of keysOf(map, cmd)) map.delete(k);
      for (const [k, c] of createKeymap({}, SCOPES[scope].defaults)) if (c === cmd) { const was = map.get(k); map.set(k, cmd); if (was && was !== cmd) note.textContent = `${displayKey(k)}을(를) "${nameOf(scope, was)}"에서 뺐습니다.`; }
      commit();
      return draw();
    }
  });
  // 키 받기: 창이 떠 있는 동안 문서 전체에서 가로챈다(버튼을 다시 그리면 포커스가 body로 가므로 window에서 받는다)
  const onKey = (e) => {
    e.stopPropagation();
    if (!capture) { if (e.key === 'Escape') close(); return; }
    e.preventDefault();
    if (e.key === 'Escape') { capture = null; note.textContent = ''; return draw(); }
    const name = eventKeyName(e);
    if (!name) return; // 수식키만 누름: 계속 기다림
    const { scope, cmd } = capture;
    if (scope === 'edit' && isTypingKey(name)) { note.textContent = `${displayKey(name)}은(는) 글자 입력·커서 이동에 쓰는 키라 글 편집 단축키로 쓸 수 없습니다. Ctrl(⌘)이나 Alt와 함께 누르십시오.`; return; }
    const map = maps[scope];
    const was = map.get(name);
    map.set(name, cmd);
    capture = null;
    note.textContent = was && was !== cmd ? `${displayKey(name)}을(를) "${nameOf(scope, was)}"에서 빼고 "${nameOf(scope, cmd)}"에 걸었습니다.` : `${displayKey(name)} → "${nameOf(scope, cmd)}"`;
    commit();
    draw();
  };
  window.addEventListener('keydown', onKey, true);
  const close = () => { offUpd?.(); window.removeEventListener('keydown', onKey, true); bg.remove(); ctx.view.viewport.focus({ preventScroll: true }); };
  bg.querySelector('[data-v=close]').onclick = close;
  draw();
  bg.querySelector('[data-v=close]').focus();
  return bg;
}
function nameOf(scope, cmd) { return SCOPES[scope].commands.find(([c]) => c === cmd)?.[1] || cmd; }
