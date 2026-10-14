// 나비글쓰기 편집기 진입점.
// 프로젝트(여러 장·스와치·업로드 글꼴)를 들고, 캔버스 화면(PageView)·패널·도구 막대·키보드·클립보드·메뉴·저장·자동 저장을 잇는다.

import { History } from '../src/history.js';
import { createKeymap, lookup } from '../src/keymap.js';
import { clearMeasureCache } from '../src/measure.js';
import { resetTextMeasure } from './render-el.js';
import { fonts, fontStack } from '../src/fonts.js';
import { fontInfo } from './font-info.js';
import { exportPages, rasterize } from '../src/export.js';
import * as platform from '../src/platform.js';
import { PageView } from './page-view.js';
import { APP_KEYMAP } from './shortcuts.js';
import * as M from './model.js';
import { LayersPanel, LAYERS_CSS } from './layers-panel.js';
import { PropsPanel, PROPS_CSS } from './props-panel.js';
import { PagesPanel, PAGES_CSS } from './pages-panel.js';
import { Swatches, COLOR_CSS } from './color.js';
import { AssetStore } from './assets.js';
import { setImageSource, bumpProxy, BLANK } from '../src/image-src.js';
import * as P from './project.js';
import { saveRecovery, orphanRecoveries, clearRecovery, claimTab } from './recovery.js';
import * as TPL from './templates.js';
import { isMaster, newMaster } from './master.js';
import { FindBar, FIND_CSS } from './find.js';
import { Thumbs } from './thumbs.js';
import { fillIcons } from './icons.js';
import { loadSettings, saveSettings, applySettings, openSettings, SETTINGS_CSS } from './settings.js';
import { initSplitters } from './layout-ui.js';
import { esc, pickFile, modal } from './util.js';

const $ = (id) => document.getElementById(id);
fillIcons(); // 정적 HTML의 아이콘 자리 → SVG(다른 코드가 버튼을 찾기 전에)
const APP_VERSION = '0.12.2';
const AUTOSAVE_MS = 2000; // 마지막 변경 뒤 이만큼 조용하면 복구용 사본을 쓴다
const DEFAULT_FONTS = ['Noto Sans KR', 'Noto Sans CJK KR', 'Noto Serif CJK KR', 'Malgun Gothic', 'sans-serif', 'serif', 'monospace'];

let panelQueued = false;
let thumbs = null; // 장 목록 미리보기(아래에서 만든다)
let layers = null, props = null, pagesPanel = null; // 패널(아래에서 만든다. 캔버스가 먼저 sync를 부를 수 있음)

const history = new History();
const keymap = createKeymap();                  // 글상자 편집 단축키
const appKeymap = createKeymap({}, APP_KEYMAP); // 캔버스 단축키
const assets = new AssetStore();
const swatches = new Swatches();
// 화면은 큰 사진의 축소본을 쓴다(출력·저장은 원본). 축소본이 준비되면 한 프레임에 모아 다시 그린다
setImageSource({
  display: (src) => { const u = assets.displayUrl(src); return u === null ? BLANK : u; },
  thumb: (src) => assets.tinyUrl(src),
  ready: (src) => assets.ready(src),
  dims: (src) => assets.dims(src),
});
let proxyQueued = null;
assets.onProxy = (a) => {
  bumpProxy();
  (proxyQueued ||= new Set()).add(a.url);
  if (proxyQueued.size > 1) return;
  requestAnimationFrame(() => {
    const urls = proxyQueued; proxyQueued = null;
    for (const ed of view.editors.values()) {
      // 글 안 이미지가 그 사진이면 그 글만 다시 그린다
      const json = JSON.stringify(ed.state.doc.toJSON());
      if ([...urls].some((u) => json.includes(u))) ed.update();
    }
    view.render();
    thumbs?.invalidateAll();
  });
};

// 들어오는 이미지(파일·붙여넣기·원격 주소)는 모두 에셋 저장소를 거친다
async function importImage(src) {
  const a = src instanceof Blob ? await assets.add(src) : await assets.importSrc(src);
  return a?.url ?? null;
}

const view = new PageView($('canvas'), { history, keymap, appKeymap, nativePaste: platform.nativePaste, onChange: sync, importImage });

// ---------- 프로젝트 상태 ----------
const app = {
  project: P.newProject(),
  current: null,
  file: null,       // 열었거나 저장한 파일(웹판 = 파일 핸들, Electron = 경로)
  dirty: false,
  lastSaved: null,
  rev: 0,      // 바뀔 때마다 1 증가: 저장하는 동안 바뀐 것이 있는지 안다
  savedRev: 0, // 마지막으로 저장(또는 열기·새로 만들기)한 때의 rev
};
window.__nabi = { ready: false };

function setDirty(on) {
  if (on) app.rev++;
  else app.savedRev = app.rev;
  if (app.dirty === on) return;
  app.dirty = on;
  platform.setDirty(on);
  updateTitle();
}
function updateTitle() {
  document.title = `${app.dirty ? '● ' : ''}${app.project.name} — 나비글쓰기`;
  $('projName').textContent = app.project.name;
  $('dirtyTag').hidden = !app.dirty;
}

// 되돌리기가 다른 장의 항목이면 먼저 그 장으로
history.onApply = (entry) => {
  const pg = entry.page ?? pageOfElement(entry.editor?.elementId);
  if (pg && pg !== app.current && (app.project.pages.includes(pg) || pg === app.project.master)) showPage(pg);
};
view.onPresets = (p) => { app.project.styles = p; };
view.onError = (msg) => status(msg);
view.allPages = () => app.project.pages;
view.getMaster = () => app.project.master || null;
view.pageStart = () => app.project.pageStart || 1;
view.setPageStart = (n) => app.setPageStart(n);
// 다음 장으로 이어 쓰기에서 새 장이 필요할 때(지금 장 크기·배경을 따름). 되돌리기 항목은 장 목록 변경으로 남는다
view.addPageAfter = (page) => {
  let made = null;
  changePages((pages) => {
    const p = M.newPage({ w: page.w, h: page.h, background: page.background });
    pages.splice(pages.indexOf(page) + 1, 0, p);
    made = p;
    return { pages, current: app.current };
  });
  return made;
};
view.onGridSize = (g) => { app.project.grid = { size: g }; setDirty(true); scheduleAutosave(); };
view.onForeignEditor = (id) => { const pg = pageOfElement(id); if (pg) showPage(pg); };
view.showPage = (pg) => showPage(pg);

function pageOfElement(id) {
  if (!id) return null;
  return app.project.pages.find((p) => M.find(p.elements, id)) || (app.project.master && M.find(app.project.master.elements, id) ? app.project.master : null);
}

function showPage(page) {
  if (app.current === page) return;
  app.current = page;
  view.setPage(page);
  sync();
}

// 장 목록 변경(되돌리기용)
app.setPages = (pages, cur) => {
  app.project.pages = [...pages];
  showPage(app.project.pages.includes(cur) ? cur : app.project.pages[0]);
  view.page = app.current;
  view.render();
  sync();
};
function changePages(fn) {
  const before = [...app.project.pages], curBefore = app.current;
  const next = fn([...app.project.pages]);
  if (!next) return;
  app.project.pages = next.pages;
  showPage(next.current);
  view.render(); // 장 순서가 바뀌면 여러 장에 걸친 글의 흐름 순서도 바뀐다
  history.record(new P.PagesEntry(app, before, [...app.project.pages], curBefore, app.current));
  history.closeGroup();
}
app.switchPage = (page) => showPage(page);
// 공통 장을 보고 있으면 새 장은 맨 끝에, 복제·지우기는 하지 않는다
app.addPage = () => changePages((pages) => {
  const cur = isMaster(app.current) ? pages[pages.length - 1] : app.current;
  const p = M.newPage({ w: cur.w, h: cur.h, background: cur.background }); // 새 장 크기 = 지금 장과 같게
  pages.splice(pages.indexOf(cur) + 1, 0, p);
  return { pages, current: p };
});
app.duplicatePage = () => changePages((pages) => {
  if (isMaster(app.current)) return null;
  const p = P.duplicatePage(app.current, view.docOf);
  pages.splice(pages.indexOf(app.current) + 1, 0, p);
  return { pages, current: p };
});
app.deletePage = () => changePages((pages) => {
  if (pages.length <= 1 || isMaster(app.current)) return null; // 마지막 한 장은 지우지 않는다
  const i = pages.indexOf(app.current);
  pages.splice(i, 1);
  return { pages, current: pages[Math.min(i, pages.length - 1)] };
});
app.movePage = (page, to) => changePages((pages) => {
  const i = pages.indexOf(page);
  if (i < 0 || to === i || to === i + 1) return null;
  pages.splice(i, 1);
  pages.splice(to > i ? to - 1 : to, 0, page);
  return { pages, current: app.current };
});
// 공통 장으로(처음이면 만든다: 크기는 첫 장과 같게)
app.openMaster = () => {
  if (!app.project.master) app.project.master = newMaster(app.project.pages[0]);
  showPage(app.project.master);
};
app.setPageStart = (n) => { app.project.pageStart = Math.max(-9999, Math.min(99999, Math.round(n) || 1)); setDirty(true); scheduleAutosave(); view.render(); sync(); };
app.renamePage = (page, name) => { if (page !== app.current) showPage(page); view.setPageProps({ name }); };

// 프로젝트 교체(새로 만들기·열기·복구)
async function loadProject(project, { file = null, dirty = false } = {}) {
  view.resetAll();
  history.clear();
  fonts.unregisterAll();
  for (const f of project.fonts || []) {
    const a = assets.get(f.asset);
    if (a) await fonts.register(f.family, await a.blob.arrayBuffer(), { weight: f.weight, style: f.style });
  }
  app.project = project;
  if (project.swatches) { swatches.list.splice(0, swatches.list.length, ...project.swatches); swatches.emit(); }
  app.project.swatches = null; // 저장할 때 swatches.list를 쓴다
  app.file = file;
  app.current = null;
  app.pageSel = null;
  view.masterEl = null;
  project.styles ||= {};
  project.grid ||= { size: 20 };
  view.presets = project.styles; view.presetsKey = JSON.stringify(project.styles);
  view.gridSize = project.grid.size;
  clearMeasureCache();
  showPage(project.pages[0]);
  syncProjectFonts();
  app.dirty = !dirty; setDirty(dirty);
  updateTitle();
  sync();
}

const ctx = () => ({ assets, docOf: view.docOf, swatches: swatches.list, app: APP_VERSION });

// ---------- 저장·열기 ----------
// 저장 실패 까닭 → 알아듣기 쉬운 말
function saveErrorText(err) {
  const m = String(err?.message || err || '');
  if (/EBUSY|EPERM|being used|locked/i.test(m)) return '다른 프로그램이 이 파일을 열어 두었거나 쓰기가 막혀 있습니다. 그 프로그램을 닫고 다시 저장하거나 다른 이름으로 저장하십시오.';
  if (/ENOSPC|QuotaExceeded|disk full/i.test(m) || err?.name === 'QuotaExceededError') return '저장 공간(디스크)이 부족합니다.';
  if (/EACCES|EROFS|NotAllowed|permission/i.test(m) || err?.name === 'NotAllowedError') return '이 위치에 파일을 쓸 권한이 없습니다. 다른 폴더를 골라 다른 이름으로 저장하십시오.';
  if (/ENOENT|NotFound/i.test(m) || err?.name === 'NotFoundError') return '저장할 폴더를 찾을 수 없습니다(옮겨졌거나 지워짐). 다른 이름으로 저장하십시오.';
  return m.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') || '알 수 없는 오류';
}
// 저장. 이미 저장 중이면 그 저장을 기다린다(두 번 눌러도 대화상자가 두 번 뜨지 않음).
// 반환: 저장했으면 true, 취소·실패면 false(작업 내용은 그대로 남음)
let saving = null;
function save(opts) {
  if (!saving) saving = saveNow(opts).finally(() => { saving = null; });
  return saving;
}
async function saveNow({ saveAs = false } = {}) {
  status('저장하는 중…');
  const rev = app.rev; // 이 시점의 내용을 저장한다
  try {
    const { bytes, missing } = await P.toZip(app.project, ctx());
    const r = await platform.saveProject(bytes, { file: app.file, name: app.project.name, saveAs });
    if (r.mode === 'cancelled') { status('저장 취소'); return false; }
    app.file = r.file ?? app.file;
    if (r.name) app.project.name = r.name.replace(/\.nabi$/i, '');
    // 저장하는 동안(대화상자·쓰기) 바뀐 것이 있으면 '저장 안 됨'으로 남긴다 → 닫을 때 다시 묻는다
    const changed = app.rev !== rev;
    if (!changed) { setDirty(false); await clearRecovery().catch(() => {}); }
    else { app.savedRev = rev; scheduleAutosave(); }
    updateTitle();
    status(`저장함 · ${r.name || ''}${changed ? ' · 저장하는 동안 바뀐 내용은 아직 저장되지 않았습니다' : ''}${missing.length ? ` · 가져오지 못한 이미지 ${missing.length}개(원래 주소로 남음)` : ''}`);
    return true;
  } catch (err) {
    console.error('저장 실패', err);
    const why = saveErrorText(err);
    status('저장 실패 · ' + why);
    await ask(`저장하지 못했습니다.\n${why}\n\n작업 내용은 그대로 남아 있습니다.`, [['ok', '확인']]);
    return false;
  }
}

// 저장하지 않은 변경이 있으면 묻는다 → 'save' | 'discard' | 'cancel'
async function confirmDiscard(what) {
  if (!app.dirty) return true;
  const r = await ask(`${what} 전에 변경 내용을 저장하시겠습니까?`, [['save', '저장'], ['discard', '저장하지 않음'], ['cancel', '취소']]);
  if (r === 'cancel') return false;
  if (r === 'save') return save();
  return true;
}

async function newProject() {
  if (!(await confirmDiscard('새로 만들기'))) return;
  assets.clear();
  await loadProject(P.newProject());
  await clearRecovery().catch(() => {});
  status('새 프로젝트');
}

// 다른 프로젝트 열기. 에셋은 지금 저장소에 더해 두고(같은 내용이면 그대로 재사용) 불러오기가 끝난 뒤에야
// 새 프로젝트가 쓰지 않는 옛 에셋을 푼다 → 열다가 실패해도 지금 프로젝트가 깨지지 않는다
async function swapIn(load) {
  const before = new Set(assets.byId.keys());
  const t = assets.tracker();
  const project = await load(t);
  return { project, commit: () => { for (const id of before) if (!t.used.has(id)) assets.remove(id); }, abort: () => { for (const id of t.used) if (!before.has(id)) assets.remove(id); } };
}
async function openBytes(bytes, file, name) {
  let sw = null;
  try {
    sw = await swapIn((store) => P.fromZip(bytes, { assets: store }));
    const project = sw.project;
    if (name) project.name = name.replace(/\.nabi$/i, ''); // 프로젝트 이름 = 파일 이름
    await loadProject(project, { file });
    sw.commit();
    await clearRecovery().catch(() => {});
    status(`열었음 · ${name || project.name}`);
  } catch (err) {
    if (sw && app.project !== sw.project) sw.abort();
    console.warn('열기 실패', err);
    status('열기 실패: ' + err.message);
    await ask('프로젝트를 열 수 없습니다.\n' + err.message, [['ok', '확인']]);
  }
}
async function openProject() {
  if (!(await confirmDiscard('열기'))) return;
  const r = await platform.openProject();
  if (r) await openBytes(r.bytes, r.file, r.name);
}
platform.onOpenFile(async (f) => { if (await confirmDiscard('다른 파일 열기')) await openBytes(f.bytes, f.path, f.name); });

// ---------- 자동 저장(복구용) ----------
let autosaveTimer = null;
// 마지막 변경 뒤 AUTOSAVE_MS가 지나고, 브라우저가 한가할 때(requestIdleCallback) 쓴다 → 입력·끌기 도중에 끼어들지 않음
function scheduleAutosave() {
  clearTimeout(autosaveTimer);
  autosaveTimer = setTimeout(() => {
    if (window.requestIdleCallback) requestIdleCallback(() => autosave(), { timeout: 3000 }); else autosave();
  }, AUTOSAVE_MS);
}
async function autosave() {
  if (!app.dirty) return;
  const rev = app.rev;
  try {
    const { json, used } = await P.toJSON(app.project, ctx());
    await saveRecovery({ json, used, assets, file: typeof app.file === 'string' ? app.file : app.file?.name ?? null });
    // 쓰는 사이에 파일로 저장되었으면 방금 쓴 복구본은 필요 없다(다음 실행 때 엉뚱한 복구 제안 방지)
    if (!app.dirty && app.savedRev >= rev) await clearRecovery();
    app.lastAutosave = Date.now();
  } catch (err) { console.warn('자동 저장 실패', err); }
}
app.autosaveNow = autosave;

// 시작할 때: 주인이 없는 자동 저장(비정상 종료 등)이 있으면 복구를 제안한다. 다른 탭(창)이 작업 중인 것은 건드리지 않는다.
// 여러 개면 최근 것부터 하나씩 묻는다. 복구하면 그 작업이 이 탭의 작업이 된다.
async function offerRecovery() {
  let list;
  try { list = await orphanRecoveries(); } catch { return; }
  for (const rec of list) {
    const when = new Date(rec.savedAt).toLocaleString('ko-KR');
    const file = rec.file ? `\n원래 파일: ${String(rec.file).split(/[\\/]/).pop()}` : '';
    const r = await ask(`저장하지 않은 작업이 남아 있습니다.\n${rec.name} · ${when}${file}\n복구하시겠습니까?`, [['restore', '복구'], ['discard', '버리기']]);
    if (r !== 'restore') { await clearRecovery(rec.key).catch(() => {}); continue; }
    try {
      const sw = await swapIn((store) => P.fromParts(rec.json, rec.readAsset, { assets: store }));
      await loadProject(sw.project, { dirty: true }); // 복구한 내용은 아직 파일에 저장되지 않음
      sw.commit();
      status(`복구함 · ${when}${rec.file ? ' · 저장하면 새 파일 이름을 묻습니다' : ''}`);
      await autosave();                                // 이 탭 자리에 옮겨 쓴 뒤
      await clearRecovery(rec.key).catch(() => {});    // 원래 자리를 지운다
    } catch (err) {
      console.error(err);
      await ask('복구하지 못했습니다.\n' + err.message, [['ok', '확인']]);
    }
    return;
  }
}

// ---------- 확인 창(앱 안) ----------
function ask(message, buttons) {
  return new Promise((resolve) => {
    const bg = modal('<p></p><div class="modal-btns"></div>');
    bg.querySelector('p').textContent = message;
    const box = bg.querySelector('.modal-btns');
    for (const [v, t] of buttons) {
      const b = document.createElement('button');
      b.textContent = t;
      b.dataset.v = v;
      b.onclick = () => { bg.remove(); resolve(v); };
      box.appendChild(b);
    }
    bg.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Escape') { bg.remove(); resolve(buttons[buttons.length - 1][0]); } });
    box.firstChild.focus();
  });
}

// 한 줄 입력 창 → 문자열 | null(취소)
function promptText(message, value = '') {
  return new Promise((resolve) => {
    const bg = modal('<p></p><input class="modal-input" type="text" spellcheck="false"><div class="modal-btns"><button data-v="ok">확인</button><button data-v="cancel">취소</button></div>');
    bg.querySelector('p').textContent = message;
    const inp = bg.querySelector('input');
    inp.value = value;
    const done = (ok) => { bg.remove(); resolve(ok ? inp.value : null); view.viewport.focus({ preventScroll: true }); };
    bg.querySelector('[data-v=ok]').onclick = () => done(true);
    bg.querySelector('[data-v=cancel]').onclick = () => done(false);
    bg.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') done(true); if (e.key === 'Escape') done(false); });
    inp.focus(); inp.select();
  });
}
app.promptText = promptText; // 검증에서 바꿔 끼울 수 있게

// ---------- 템플릿 ----------
async function thumbOf(page) {
  try {
    const k = 200 / Math.max(page.w, page.h);
    return (await rasterize(view.exportPage(page, { mode: 'display' }), { scale: k })).toDataURL('image/png');
  } catch { return null; }
}
// 지금 장 → 템플릿 보관함
async function saveTemplateFromPage() {
  const name = await app.promptText('템플릿 이름', app.current.name || `${app.project.name} 템플릿`);
  if (!name || !name.trim()) return null;
  view.ensurePage(app.current);
  const bytes = await TPL.pageToZip(app.current, { name: name.trim(), project: app.project, assets, docOf: view.docOf });
  const rec = await TPL.putTemplate({ id: M.uid(), name: name.trim(), w: app.current.w, h: app.current.h, thumb: await thumbOf(app.current), savedAt: new Date().toISOString(), bytes });
  status(`템플릿 "${rec.name}"을(를) 저장했습니다`);
  return rec;
}
// 템플릿 → 지금 장 뒤에 새 장(되돌리기 한 단위: 장 추가 + 새 스타일 프리셋)
async function insertTemplate(bytes) {
  const r = await TPL.zipToPage(bytes, { assets, projectStyles: app.project.styles });
  for (const f of r.fonts) {
    if (app.project.fonts.some((x) => x.family === f.family && x.weight === f.weight && x.style === f.style)) continue;
    await fonts.register(f.family, await f.blob.arrayBuffer(), { weight: f.weight, style: f.style });
    app.project.fonts.push({ family: f.family, weight: f.weight, style: f.style, asset: f.asset, ...(f.label ? { label: f.label } : {}) });
  }
  syncProjectFonts();
  history.batch(() => {
    if (Object.keys(r.styles).length) view.changePresets({ ...view.presets, ...r.styles }, 'template-styles');
    changePages((pages) => { pages.splice(pages.indexOf(app.current) + 1, 0, r.page); return { pages, current: r.page }; });
  });
  const n = TPL.slotsOf(r.page).length;
  status(`템플릿 "${r.name}"으로 새 장을 만들었습니다${n ? ` · 슬롯 ${n}개(주황 점선)` : ''}`);
  return r.page;
}
async function importTemplateFile() {
  const f = await pickFile(`.${TPL.TEMPLATE_EXT},.nabi`);
  if (!f) return null;
  const bytes = new Uint8Array(await f.arrayBuffer());
  try {
    const temp = new AssetStore({ proxies: false });
    const tpl = await P.fromZip(bytes, { assets: temp });
    temp.clear();
    const pg = tpl.pages[0];
    return await TPL.putTemplate({ id: M.uid(), name: tpl.name || f.name.replace(/\.[^.]+$/, ''), w: pg.w, h: pg.h, thumb: null, savedAt: new Date().toISOString(), bytes });
  } catch (err) { await ask('템플릿 파일을 읽을 수 없습니다.\n' + err.message, [['ok', '확인']]); return null; }
}
async function exportTemplateFile(rec) {
  const safe = rec.name.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').trim() || '템플릿';
  return platform.saveFiles([{ name: `${safe}.${TPL.TEMPLATE_EXT}`, blob: new Blob([rec.bytes], { type: 'application/zip' }) }], { project: safe });
}
// 템플릿 창
async function openTemplates() {
  const bg = modal(`<p>템플릿</p><div class="tpl-list"></div>
    <div class="modal-btns"><button data-v="close">닫기</button><button data-v="save">지금 장을 템플릿으로…</button><button data-v="import">파일에서 가져오기…</button></div>`, 'tpl');
  const listEl = bg.querySelector('.tpl-list');
  const close = () => { bg.remove(); view.viewport.focus({ preventScroll: true }); };
  const draw = async () => {
    const list = await TPL.listTemplates();
    listEl.innerHTML = list.length ? list.map((t) => `<div class="tpl-item" data-id="${esc(t.id)}">
      <div class="tpl-thumb">${t.thumb ? `<img src="${esc(t.thumb)}" alt="">` : `<span>${+t.w || 0}×${+t.h || 0}</span>`}</div>
      <div class="tpl-name" title="${esc(t.name)}">${esc(t.name)}</div><div class="tpl-size">${+t.w || 0}×${+t.h || 0}px</div>
      <div class="tpl-acts"><button data-act="use">새 장으로</button><button data-act="file" title="${TPL.TEMPLATE_EXT} 파일로 저장(다른 컴퓨터로 옮기기)">파일로</button><button data-act="del">지우기</button></div></div>`).join('')
      : '<div class="tpl-empty">저장한 템플릿이 없습니다. "지금 장을 템플릿으로…"를 누르면 이 장이 템플릿이 됩니다.<br>템플릿에서 바꿔 넣을 이미지·글상자는 속성 패널에서 "슬롯"으로 표시해 두십시오.</div>';
  };
  listEl.addEventListener('click', async (e) => {
    const act = e.target.closest('[data-act]')?.dataset.act;
    const id = e.target.closest('.tpl-item')?.dataset.id;
    if (!act || !id) return;
    const rec = await TPL.getTemplate(id);
    if (!rec) return draw();
    if (act === 'use') { close(); await insertTemplate(rec.bytes); }
    else if (act === 'file') await exportTemplateFile(rec);
    else if (act === 'del' && await ask(`템플릿 "${rec.name}"을(를) 지울까요?`, [['del', '지우기'], ['cancel', '취소']]) === 'del') { await TPL.deleteTemplate(id); draw(); }
  });
  bg.querySelector('[data-v=close]').onclick = close;
  bg.querySelector('[data-v=save]').onclick = async () => { if (await saveTemplateFromPage()) draw(); };
  bg.querySelector('[data-v=import]').onclick = async () => { if (await importTemplateFile()) draw(); };
  bg.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Escape') close(); });
  await draw();
  bg.querySelector('[data-v=close]').focus();
}
app.templates = { open: openTemplates, saveFromPage: saveTemplateFromPage, insert: insertTemplate, list: TPL.listTemplates, remove: TPL.deleteTemplate, exportFile: exportTemplateFile };

// ---------- 패널 ----------
document.head.insertAdjacentHTML('beforeend', `<style>${COLOR_CSS}${LAYERS_CSS}${PROPS_CSS}${PAGES_CSS}${SETTINGS_CSS}${FIND_CSS}</style>`);
pagesPanel = new PagesPanel($('pagesList'), app);
const findBar = new FindBar($('canvas'), app, view, history);
thumbs = app.thumbs = new Thumbs({ view, app, onUpdate: (page, url) => pagesPanel.setThumb(page, url) });
assets.onTiny = () => thumbs.invalidateAll();
layers = new LayersPanel($('layers'), view);
// 속성 패널의 "이미지…" 버튼: 파일을 골라 에셋으로(원본 크기 포함)
async function pickImage() {
  const f = await pickFile('image/*');
  if (!f) return null;
  const a = await assets.add(f);
  try { const d = await view.imageSize(a.url); return { src: a.url, w: d.w, h: d.h }; } catch { return null; }
}
props = new PropsPanel($('propsBody'), view, { history, swatches, fonts: DEFAULT_FONTS, pickImage: (...a) => app.pickImage(...a), promptName: (...a) => app.promptText(...a) });
app.pickImage = pickImage; // 검증에서 바꿔 끼울 수 있게
swatches.onChange(() => { setDirty(true); scheduleAutosave(); });
$('pageAdd').onclick = () => app.addPage();
$('pageDup').onclick = () => app.duplicatePage();
$('pageDel').onclick = () => app.deletePage();
$('pageTpl').onclick = () => openTemplates();

// 시스템 글꼴(이 컴퓨터에 설치된 글꼴)을 글꼴 목록에 불러오기. 웹판은 처음에 권한을 묻는다
async function loadSystemFonts() {
  try {
    const list = await platform.listSystemFonts();
    if (!list) { status('이 환경에는 시스템 글꼴 API가 없습니다'); return false; }
    props.setSystemFonts([...props.systemFonts, ...list.map((g) => g.family)]);
    status(list.length ? `시스템 글꼴 ${list.length}종을 글꼴 목록에 넣었습니다` : '시스템 글꼴을 읽지 못했습니다(권한 거부)');
    return list.length > 0;
  } catch (err) { status('시스템 글꼴 불러오기 실패: ' + err.name); return false; }
}
$('sysFonts').addEventListener('mousedown', (e) => e.preventDefault());
$('sysFonts').onclick = () => loadSystemFonts();

// 넣은 글꼴 목록(속성 패널): 이름별로 굵기를 묶는다
function syncProjectFonts() {
  const by = new Map();
  for (const f of app.project.fonts) {
    let g = by.get(f.family);
    if (!g) by.set(f.family, (g = { family: f.family, label: null, faces: [] }));
    g.faces.push({ weight: f.weight, style: f.style });
    g.label ||= f.label || null;
  }
  props?.setProjectFonts([...by.values()]);
}
// 글꼴이 바뀐 뒤 다시 재고 다시 그리기
function relayoutFonts() {
  clearMeasureCache();
  resetTextMeasure();
  for (const ed of view.editors.values()) ed.update();
  view.render();
  thumbs?.invalidateAll();
}

// 글꼴 파일 넣기: 프로젝트에 포함되어 다른 컴퓨터에서 열어도 같은 글꼴로 보인다.
//   글꼴 이름·굵기·기울임은 파일 안 이름표에서 읽는다(WOFF2는 파일 이름으로 짐작) → 같은 글꼴의 굵기별 파일이 한 글꼴로 묶인다.
//   새 글꼴이 한 가지이고 글상자를 고른 상태(편집 중이면 글자를 고른 상태)면 바로 적용한다(되돌리기 가능).
const FONT_FILE = /\.(ttf|otf|ttc|woff2?)$/i;
async function addFontFiles(files, { apply = true } = {}) {
  const added = [], dup = [], failed = [];
  for (const f of files) {
    try {
      const buf = await f.arrayBuffer();
      const info = fontInfo(f.name, buf);
      if (app.project.fonts.some((x) => x.family === info.family && x.weight === info.weight && x.style === info.style)) { dup.push(info.family); continue; }
      const a = await assets.add(buf, { name: f.name });
      await fonts.register(info.family, await a.blob.arrayBuffer(), { weight: info.weight, style: info.style });
      app.project.fonts.push({ family: info.family, weight: info.weight, style: info.style, asset: a.id, ...(info.label ? { label: info.label } : {}) });
      added.push(info);
    } catch (err) {
      console.warn('글꼴 넣기 실패', f.name, err);
      failed.push(f.name);
    }
  }
  if (added.length) {
    syncProjectFonts();
    relayoutFonts();
    setDirty(true); scheduleAutosave();
  }
  const fams = [...new Set(added.map((i) => i.family))];
  let applied = false;
  if (apply && fams.length === 1) {
    const ed = view.editing ? view.activeEditor : null;
    const target = ed ? !ed.state.selection.empty : props.textTargetsNow().eds.length > 0;
    if (target) { props.setMark('font', { value: fontStack(fams[0]) }); applied = true; }
  }
  const msg = [];
  if (fams.length) msg.push(`글꼴 ${fams.map((f) => `"${f}"`).join(', ')}을(를) 넣었습니다${applied ? ' · 고른 글자에 적용함' : ' · 글꼴 칸 목록 맨 위 "넣은 글꼴"에서 고르십시오'}`);
  if (dup.length) msg.push(`이미 있는 글꼴 ${dup.length}개는 건너뜀`);
  if (failed.length) msg.push(`읽지 못한 파일: ${failed.join(', ')} (깨졌거나 글꼴 파일이 아님)`);
  status(msg.join(' · ') || '넣은 글꼴이 없습니다');
  if (failed.length && !added.length) await ask(`글꼴 파일을 읽지 못했습니다.\n${failed.join('\n')}\n\n.ttf .otf .ttc .woff .woff2 파일만 넣을 수 있습니다. 파일이 깨지지 않았는지 확인하십시오.`, [['ok', '확인']]);
  return fams;
}
app.addFontFiles = addFontFiles;
async function pickFontFiles() {
  const files = await pickFile('.ttf,.otf,.ttc,.woff,.woff2', { multiple: true });
  if (!files?.length) return null;
  return addFontFiles([].concat(files));
}
// 넣은 글꼴 빼기(그 글꼴을 쓴 글자는 대체 글꼴로 보임). 되돌리기 대상이 아니라 먼저 묻는다
async function removeProjectFont(family) {
  const r = await ask(`글꼴 "${family}"을(를) 프로젝트에서 뺄까요?\n이 글꼴을 쓴 글자는 다른 글꼴로 보이게 됩니다. 되돌리기로 되살릴 수 없습니다.`, [['remove', '빼기'], ['cancel', '취소']]);
  if (r !== 'remove') return false;
  app.project.fonts = app.project.fonts.filter((f) => f.family !== family);
  fonts.unregister(family);
  syncProjectFonts();
  relayoutFonts();
  setDirty(true); scheduleAutosave();
  status(`글꼴 "${family}"을(를) 프로젝트에서 뺐습니다`);
  return true;
}
props.fontActions = { addFiles: pickFontFiles, loadSystem: loadSystemFonts, remove: removeProjectFont };
$('fontFile').accept = '.ttf,.otf,.ttc,.woff,.woff2';
$('fontFile').onchange = async () => {
  const files = [...$('fontFile').files];
  $('fontFile').value = '';
  await addFontFiles(files);
};
$('fontAdd').addEventListener('mousedown', (e) => e.preventDefault());
$('fontAdd').onclick = () => $('fontFile').click();
// 캔버스에 글꼴 파일을 끌어다 놓아도 넣는다
view.onFontFiles = (files) => addFontFiles(files);

// ---------- 도구 막대 ----------
const keep = (el) => el.addEventListener('mousedown', (e) => e.preventDefault()); // 편집기 포커스·한글 조합을 뺏지 않음
for (const b of document.querySelectorAll('#top button, #rail button, .lfoot button, .pp-foot button, #statusbar button, .tabs button')) keep(b);
// 펼침 메뉴·창(파일 메뉴, 도형 고르기, 내보내기): 하나만 열리고, 바깥 클릭·Esc로 닫힌다
const popups = { fileMenuBtn: 'fileMenu', shapeBtn: 'shapeMenu', exportBtn: 'exportPop' };
function closePopups(except = null) { for (const id of Object.values(popups)) if (id !== except) $(id).hidden = true; }
function togglePopup(btn) { const el = $(popups[btn]); const open = el.hidden; closePopups(popups[btn]); el.hidden = !open; if (open && btn === 'exportBtn') { updateExportSize(); $('exRun').focus(); } return open; }
for (const btn of Object.keys(popups)) $(btn).onclick = () => togglePopup(btn);
document.addEventListener('mousedown', (e) => { if (!e.target.closest('.wrap')) closePopups(); }, true);
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && Object.values(popups).some((id) => !$(id).hidden)) { e.stopPropagation(); e.preventDefault(); closePopups(); view.viewport.focus({ preventScroll: true }); } }, true);
for (const b of $('fileMenu').querySelectorAll('button')) b.addEventListener('click', () => closePopups());
for (const b of $('shapeMenu').querySelectorAll('button')) b.addEventListener('click', () => closePopups());
// 장·레이어 탭
function showTab(name) {
  for (const b of document.querySelectorAll('.tabs [data-tab]')) b.setAttribute('aria-selected', String(b.dataset.tab === name));
  $('pages').hidden = name !== 'pages';
  $('layers').hidden = name !== 'layers';
  if (name === 'layers') layers.render(); else pagesPanel.render();
}
for (const b of document.querySelectorAll('.tabs [data-tab]')) b.onclick = () => showTab(b.dataset.tab);
app.showTab = showTab;
$('findBtn').onclick = () => findBar.open();
// 내보내기 창: 결과 크기 미리 보기
function updateExportSize() {
  const k = +$('exScale').value, pg = app.current;
  const vec = $('exFormat').value === 'vector';
  $('exSize').textContent = vec ? '벡터 PDF: 크기 제한 없음(글자는 글자로)' : `${Math.round(pg.w * k)} × ${Math.round(pg.h * k)} px`;
  $('exTransparent').disabled = ['jpg', 'pdf', 'vector'].includes($('exFormat').value);
}
for (const id of ['exScale', 'exFormat']) $(id).addEventListener('change', updateExportSize);
for (const b of document.querySelectorAll('[data-tool]')) b.onclick = () => view.setTool(b.dataset.tool);
for (const b of document.querySelectorAll('[data-cmd]')) b.onclick = () => view.run(b.dataset.cmd);
for (const b of document.querySelectorAll('[data-align]')) b.onclick = () => view.align(b.dataset.align);
for (const b of document.querySelectorAll('[data-dist]')) b.onclick = () => view.distribute(b.dataset.dist);
for (const b of document.querySelectorAll('[data-view]')) b.onclick = () => view.setViewOption(b.dataset.view);
// 보기 설정(눈금자·격자·가이드 보이기)은 이 컴퓨터에 기억한다(프로젝트와 무관)
const VIEW_PREF = 'nabitext.view';
try { const v = JSON.parse(localStorage.getItem(VIEW_PREF) || 'null'); if (v) { view.showRulers = v.rulers ?? view.showRulers; view.showGrid = !!v.grid; view.showGuides = v.guides ?? true; view.applyRulerVisibility(); } } catch { /* 저장소를 못 쓰면 기본값 */ }
view.onViewOption = () => { try { localStorage.setItem(VIEW_PREF, JSON.stringify({ rulers: view.showRulers, grid: view.showGrid, guides: view.showGuides })); } catch { /* 무시 */ } };
$('undo').onclick = () => history.undo();
$('redo').onclick = () => history.redo();
$('fileNew').onclick = () => runCmd('file:new');
$('fileOpen').onclick = () => runCmd('file:open');
$('fileSave').onclick = () => save();
$('fileSaveAs').onclick = () => save({ saveAs: true });
// 설정(단축키 재지정·동작 스위치). 이 컴퓨터에 저장되고 시작할 때 적용한다
// ---------- 자동 업데이트(설치판) ----------
// 새 버전이 준비되면 화면 구석에 알림: 지금 다시 시작하거나, 그대로 두면 앱을 끝낼 때 설치된다
async function installUpdate() {
  if (app.dirty) {
    const r = await ask('저장하지 않은 변경이 있습니다. 저장하고 다시 시작할까요?', [['save', '저장하고 다시 시작'], ['cancel', '취소']]);
    if (r !== 'save' || !(await save())) return false;
  }
  return platform.updates.install();
}
app.installUpdate = installUpdate;
function updateToast(st) {
  let el = document.querySelector('.upd-toast');
  if (st.status !== 'ready') { el?.remove(); return; }
  if (el) return;
  el = document.createElement('div');
  el.className = 'upd-toast';
  el.setAttribute('role', 'status');
  el.innerHTML = `<span></span><button data-v="now">지금 다시 시작</button><button data-v="later">나중에</button>`;
  el.querySelector('span').textContent = `새 버전 ${st.next || ''}이(가) 준비되었습니다. 앱을 끝낼 때 설치됩니다.`;
  el.querySelector('[data-v=now]').onclick = async () => { if (await installUpdate()) el.remove(); };
  el.querySelector('[data-v=later]').onclick = () => el.remove();
  document.body.appendChild(el);
}
platform.updates?.onState(updateToast);
async function checkUpdatesNow() {
  const st = await platform.updates.check();
  if (st.status !== 'ready') await ask(platform.updateText(st), [['ok', '확인']]);
}

const settingsCtx = { appKeymap, keymap, view, platform, thumbs, updateText: platform.updateText, installUpdate, onThumbs: () => { pagesPanel.lastHTML = null; pagesPanel.render(); }, onChange: () => sync() };
applySettings(loadSettings(), settingsCtx);
app.openSettings = () => openSettings(settingsCtx);
// 화면 배치: 패널 가장자리 끌기(너비는 놓을 때 저장), 패널 숨기기·보이기
initSplitters(() => loadSettings().layout, (key, w, done) => { if (done) { const s = loadSettings(); s.layout[key] = w; saveSettings(s); } });
function togglePanels() {
  const s = loadSettings(), L = s.layout;
  const show = !(L.showLeft || L.showRight);
  L.showLeft = show; L.showRight = show;
  saveSettings(s); applySettings(s, settingsCtx);
  status(show ? '패널을 보입니다' : '패널을 숨겼습니다 · 다시 보이려면 Ctrl+\\ 또는 설정 → 화면 배치');
}
app.togglePanels = togglePanels;
$('settings').onclick = () => app.openSettings();
$('addImage').onclick = () => $('imgFile').click();
$('imgFile').onchange = async () => {
  const files = [...$('imgFile').files];
  for (let i = 0; i < files.length; i++) await view.addImage(files[i], { x: view.page.w / 2 + i * 20, y: view.page.h / 2 + i * 20, center: true });
  $('imgFile').value = '';
};

function status(t) { $('status').textContent = t; app.statusUntil = Date.now() + 3000; }

// 변경이 몰려도 패널은 한 프레임에 한 번만 다시 그린다
function syncPanels() {
  if (panelQueued || !layers) return;
  panelQueued = true;
  requestAnimationFrame(() => { panelQueued = false; pagesPanel.render(); layers.render(); props.render(); });
}
// 도구 막대·상태 줄 갱신. 글 입력·확대마다 불리므로 값이 바뀐 곳만 DOM에 쓴다
const setText = (el, t) => { if (el.textContent !== t) el.textContent = t; };
const setAttr = (el, k, v) => { if (el.getAttribute(k) !== v) el.setAttribute(k, v); };
const setProp = (el, k, v) => { if (el[k] !== v) el[k] = v; };
let lastMenu = '';
function sync() {
  syncPanels();
  thumbs?.touch();
  for (const b of document.querySelectorAll('[data-tool]')) setAttr(b, 'aria-pressed', String(view.tool === b.dataset.tool));
  setAttr($('shapeBtn'), 'aria-pressed', String(['rect', 'ellipse', 'polygon'].includes(view.tool)));
  for (const b of document.querySelectorAll('[data-view]')) setAttr(b, 'aria-pressed', String(!!view[{ rulers: 'showRulers', grid: 'showGrid', guides: 'showGuides' }[b.dataset.view]]));
  setProp($('undo'), 'disabled', !history.canUndo);
  setProp($('redo'), 'disabled', !history.canRedo);
  setProp($('pageDel'), 'disabled', app.project.pages.length <= 1 || isMaster(app.current));
  setProp($('pageDup'), 'disabled', isMaster(app.current));
  setText($('zoomLabel'), Math.round(view.z * 100) + '%');
  setText($('exRange').options[2], `선택한 장 (${selectedPages().length})`);
  if (!app.statusUntil || Date.now() > app.statusUntil) {
    const n = view.selection.length;
    setText($('status'), view.editing ? '글상자 편집 중 · Esc 끝내기'
      : n ? `${n}개 선택` + (n === 1 ? ` · ${M.displayName(view.node(view.selection[0]))}` : '') : `${view.page.w} × ${view.page.h}px`);
  }
  const pi = app.project.pages.indexOf(app.current) + 1;
  setText($('pageInfo'), isMaster(app.current) ? '공통 장(모든 장 뒤에 깔림)' : `장 ${pi} / ${app.project.pages.length}`);
  const menu = `${history.canUndo}${history.canRedo}`;
  if (menu !== lastMenu) { lastMenu = menu; platform.setMenuState({ undo: history.canUndo, redo: history.canRedo }); }
}
// 되돌리기 스택이 바뀌면(기록·되돌리기·다시 실행) = 문서가 바뀜
let clearing = false;
const origClear = history.clear.bind(history);
history.clear = () => { clearing = true; origClear(); clearing = false; };
history.onChange(() => { sync(); if (!clearing) { setDirty(true); scheduleAutosave(); } });

// ---------- 키보드 ----------
const isField = (t) => t instanceof HTMLElement && t.matches('input, select, textarea:not(.ce-input)');
const FILE_CMDS = { 'view:panels': () => togglePanels(), find: () => findBar.open(), 'file:save': () => save(), 'file:saveAs': () => save({ saveAs: true }), 'file:open': () => openProject(), 'file:new': () => newProject(), export: () => togglePopup('exportBtn') };
// 파일 명령 실행(오류가 나면 상태 줄과 확인 창으로 알린다 — 조용히 멈추지 않게)
async function runCmd(cmd) {
  try { await FILE_CMDS[cmd](); } catch (err) {
    console.error(cmd, err);
    status('실패: ' + saveErrorText(err));
    await ask('작업을 끝내지 못했습니다.\n' + saveErrorText(err), [['ok', '확인']]);
  }
}
document.addEventListener('keydown', (e) => {
  if (document.querySelector('.modal-bg')) return; // 확인 창이 떠 있는 동안
  if (e.defaultPrevented || isField(e.target)) return; // 편집기가 처리한 키, 입력칸
  const cmd = lookup(appKeymap, e);
  if (FILE_CMDS[cmd]) { e.preventDefault(); return runCmd(cmd); }
  if (view.handleKey(e)) e.preventDefault();
});
document.addEventListener('keyup', (e) => view.handleKeyUp(e));
// 창을 벗어난 채 스페이스를 떼면 keyup이 안 와서 계속 '손 도구'로 남는다 → 창이 포커스를 잃으면 풀어 준다
window.addEventListener('blur', () => view.handleKeyUp({ key: ' ' }));
window.addEventListener('beforeunload', (e) => { if (app.dirty && !platform.isElectron) { autosave(); e.preventDefault(); e.returnValue = ''; } });

// ---------- 클립보드(글상자 편집 중이 아닐 때 = 요소 단위) ----------
const clipHTML = (json) => { const d = document.createElement('div'); d.setAttribute('data-nabitext', json); return d.outerHTML; };
function onCopy(e, cut) {
  if (e.defaultPrevented || view.editing || isField(e.target)) return;
  const json = view.copySelection();
  if (!json) return;
  e.preventDefault();
  e.clipboardData.setData('text/html', clipHTML(json));
  e.clipboardData.setData('text/plain', view.selectionLeaves().filter((n) => n.type === 'text').map((n) => view.editorOf(n)?.text ?? '').join('\n'));
  if (cut) view.deleteSelection();
}
document.addEventListener('copy', (e) => onCopy(e, false));
document.addEventListener('cut', (e) => onCopy(e, true));
document.addEventListener('paste', (e) => {
  if (e.defaultPrevented || view.editing || isField(e.target)) return;
  const dt = e.clipboardData;
  e.preventDefault();
  const html = dt.getData('text/html');
  if (html && html.includes('data-nabitext')) {
    const el = new DOMParser().parseFromString(html, 'text/html').querySelector('[data-nabitext]');
    if (el && view.pasteElements(el.getAttribute('data-nabitext'))) return;
  }
  const files = [...dt.files].filter((f) => f.type.startsWith('image/'));
  if (files.length) { files.forEach((f, i) => view.addImage(f, { x: view.page.w / 2 + i * 20, y: view.page.h / 2 + i * 20, center: true })); return; }
  const text = dt.getData('text/plain');
  if (text) view.pasteTextAsElement(text);
});

// ---------- 글꼴 ----------
// 웹 글꼴이 늦게 도착하면 글자 폭이 바뀌므로 측정 캐시를 비우고 다시 배치
document.fonts.addEventListener('loadingdone', () => { clearMeasureCache(); resetTextMeasure(); for (const ed of view.editors.values()) ed.update(); view.render(); });

// ---------- 내보내기 ----------
// 장 목록에서 고른 장(프로젝트 순서). 지운 장은 빼고, 하나도 없으면 지금 장
function selectedPages() {
  const sel = app.pageSel instanceof Set ? app.pageSel : new Set();
  const list = app.project.pages.filter((p) => sel.has(p));
  return list.length ? list : [app.current];
}
app.selectedPages = selectedPages;
app.onPageSel = () => sync();
async function runExport() {
  const format = $('exFormat').value;
  const range = $('exRange').value;
  const list = range === 'all' ? app.project.pages : range === 'selected' ? selectedPages() : [app.current];
  const pages = list.map((p) => view.exportPage(p));
  const name = app.project.name;
  status('내보내는 중…');
  try {
    let r;
    if (format === 'vector') r = await platform.saveVectorPDF(pages, { project: name });
    else {
      // 파일 이름의 장 번호는 프로젝트 안 순서를 따른다(현재 장만 내보내도 _3처럼)
      const indices = list.map((p) => app.project.pages.indexOf(p));
      const every = app.project.pages.map((p) => (list.includes(p) ? pages[list.indexOf(p)] : null));
      r = await platform.saveFiles(await exportPages(every, { project: name, format, indices, scale: +$('exScale').value, transparent: $('exTransparent').checked }), { project: name });
    }
    status(r.mode === 'cancelled' ? '취소함' : r.mode === 'print-dialog' ? '인쇄 대화상자에서 "PDF로 저장"을 선택하십시오' : `내보냄 · ${list.length}장`);
  } catch (err) {
    console.error(err);
    status('내보내기 실패: ' + err.message);
  }
}
$('exRun').onclick = () => { closePopups(); runExport(); };

// ---------- Electron 메뉴 ----------
platform.onMenu(async (cmd) => {
  const ed = view.activeEditor;
  if (cmd === 'undo' || cmd === 'redo') history[cmd]();
  else if (cmd === 'selectAll') { if (ed) ed.run('selectAll'); else view.run('selectAll'); }
  else if (cmd === 'pastePlain') { if (ed) ed.plainPaste = true; platform.nativePaste(); }
  else if (FILE_CMDS[cmd]) runCmd(cmd);
  else if (cmd === 'view:panels') togglePanels();
  else if (cmd.startsWith('view:')) view.setViewOption(cmd.slice(5));
  else if (cmd === 'update:check') checkUpdatesNow();
  else if (cmd === 'saveAndClose') { if (await save()) platform.closeWindow(); }
  else if (cmd === 'discardAndClose') { await clearRecovery().catch(() => {}); platform.closeWindow(); }
});

// ---------- 시작 ----------
await loadProject(app.project);
Object.assign(window.__nabi, {
  ready: true, app, view, history, keymap, appKeymap, fonts, M, P, platform, layers, props, pagesPanel, swatches, assets, ask, promptText,
  flush: () => { pagesPanel.render(); layers.render(); props.render(); },
  save, openBytes, newProject, autosave, findBar,
});
claimTab().catch(() => {});
await offerRecovery();
const pending = await platform.takePendingFile();
if (pending && await confirmDiscard('파일 열기')) await openBytes(pending.bytes, pending.path, pending.name);
