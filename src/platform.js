// 웹판과 Electron판의 차이를 이 파일 한 곳에 모은다. 나머지 렌더러 코드는 두 환경에서 같다.
// Electron에서는 preload(electron/preload.js)가 window.native를 넣는다. 없으면 웹판.

import { saveFiles as webSaveFiles, printVector, buildPrintHTML, pdfName } from './export.js';

const native = globalThis.native ?? null;

export const isElectron = !!native;
export const kind = native ? 'electron' : 'web';

// 파일 저장. files: [{ name, blob }]
// 웹판: 여러 개면 폴더 선택(File System Access API) → 실패 시 zip, 한 개면 내려받기
// Electron: 한 개면 저장 대화상자, 여러 개면 폴더 선택 대화상자(같은 이름이 있으면 덮어쓸지 확인)
// 반환: { mode: 'file' | 'directory' | 'download' | 'zip' | 'cancelled', count, paths? }
export async function saveFiles(files, opts = {}) {
  if (!native) return webSaveFiles(files, opts);
  const payload = await Promise.all(files.map(async (f) => ({ name: f.name, data: new Uint8Array(await f.blob.arrayBuffer()) })));
  return native.saveFiles(payload);
}

// 벡터 PDF. 웹판: 인쇄 대화상자(사용자가 'PDF로 저장' 선택). Electron: 저장 대화상자 → printToPDF로 바로 파일.
export async function saveVectorPDF(pages, { project = '제목 없음', ...opts } = {}) {
  if (!native) {
    await printVector(pages, { title: project, ...opts });
    return { mode: 'print-dialog', count: 1 };
  }
  const html = await buildPrintHTML(pages, { title: project, ...opts });
  return native.saveVectorPDF(html, pdfName(project));
}

// 시스템 글꼴 목록(Local Font Access API). 웹판·Electron 같은 API.
// 웹판은 처음 호출할 때 권한 요청 창이 뜨므로 버튼 클릭 같은 사용자 동작 안에서 불러야 한다.
// 반환: [{ family, faces: [{ style, fullName, postscriptName, data }] }] (data: FontData — data.blob()으로 파일 내용)
// API가 없으면 null. 권한이 거부되면 빈 배열(Chromium 152에서 확인: 예외가 아니라 빈 목록이 온다).
// 버전에 따라 NotAllowedError 예외일 수도 있으므로 부르는 쪽은 둘 다 처리한다.
export async function listSystemFonts() {
  if (typeof globalThis.queryLocalFonts !== 'function') return null;
  const all = await globalThis.queryLocalFonts();
  const byFamily = new Map();
  for (const f of all) {
    let g = byFamily.get(f.family);
    if (!g) byFamily.set(f.family, (g = { family: f.family, faces: [] }));
    g.faces.push({ style: f.style, fullName: f.fullName, postscriptName: f.postscriptName, data: f });
  }
  return [...byFamily.values()].sort((a, b) => a.family.localeCompare(b.family));
}

// 서식 없이 붙여넣기(Mod+Shift+V)를 운영체제 기본 키 동작에 맡기지 않고 직접 paste 이벤트를 부르는 함수.
// Electron에서만 제공한다(macOS는 메뉴 없이는 Cmd+Shift+V가 paste 이벤트를 내지 않음). 웹판은 null → 브라우저 기본 동작.
export const nativePaste = native ? () => native.edit('paste') : null;

// 자동 업데이트(Electron 설치판만). 웹판은 null: 웹판은 배포하면 다음에 열 때 새 버전이 뜬다
//   { state(), check(), setAuto(on), install(), onState(cb) } — electron/updater.js
export const updates = native?.updates ?? null;

// 업데이트 상태 → 사람이 읽을 문장
export function updateText(s) {
  if (!s) return '';
  switch (s.status) {
    case 'off': return `자동 업데이트 꺼짐 — ${s.reason}`;
    case 'idle': return `지금 버전 ${s.version}`;
    case 'checking': return '새 버전을 확인하는 중…';
    case 'latest': return `최신 버전입니다(${s.version})`;
    case 'downloading': return `새 버전 ${s.next || ''} 내려받는 중… ${s.percent || 0}%`;
    case 'ready': return `새 버전 ${s.next || ''} 준비됨 — 앱을 끝낼 때 설치됩니다`;
    case 'error': return `업데이트 확인 실패: ${s.reason}`;
    default: return '';
  }
}

// 메뉴 명령 수신(Electron). 웹판에서는 아무것도 하지 않는다.
export function onMenu(cb) { return native ? native.onMenu(cb) : () => {}; }
export function setMenuState(state) { if (native) native.setMenuState(state); }

// ---------- 프로젝트 파일(8단계) ----------
// file: 이전에 열었거나 저장한 파일을 가리키는 값(웹판 = 파일 핸들, Electron = 경로). 없거나 saveAs면 저장 창을 띄운다.
// 반환: { mode: 'file' | 'download' | 'cancelled', file, name }
const PROJECT_TYPES = [{ description: '나비글쓰기 프로젝트', accept: { 'application/x-nabitext': ['.nabi'] } }];

export async function saveProject(bytes, { file = null, name = '제목 없음', saveAs = false } = {}) {
  const fname = `${name.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').trim() || '제목 없음'}.nabi`;
  if (native) {
    const r = await native.saveProject(bytes, { path: saveAs ? null : file, name: fname });
    return r.mode === 'cancelled' ? r : { mode: 'file', file: r.path, name: r.name };
  }
  if (window.showSaveFilePicker) {
    let h = saveAs ? null : file;
    try {
      if (!h) h = await window.showSaveFilePicker({ suggestedName: fname, types: PROJECT_TYPES });
      const w = await h.createWritable();
      await w.write(bytes);
      await w.close();
      return { mode: 'file', file: h, name: h.name };
    } catch (err) {
      if (err.name === 'AbortError') return { mode: 'cancelled' };
      throw err;
    }
  }
  const { download } = await import('./export.js');
  download(new Blob([bytes], { type: 'application/zip' }), fname);
  return { mode: 'download', file: null, name: fname };
}

// 반환: { bytes, file, name } | null(취소)
export async function openProject() {
  if (native) {
    const r = await native.openProject();
    return r ? { bytes: r.bytes, file: r.path, name: r.name } : null;
  }
  if (window.showOpenFilePicker) {
    try {
      const [h] = await window.showOpenFilePicker({ types: PROJECT_TYPES, excludeAcceptAllOption: false });
      const f = await h.getFile();
      return { bytes: new Uint8Array(await f.arrayBuffer()), file: h, name: f.name };
    } catch (err) { if (err.name === 'AbortError') return null; throw err; }
  }
  return new Promise((resolve) => {
    const inp = document.createElement('input');
    inp.type = 'file';
    inp.accept = '.nabi,application/zip';
    inp.onchange = async () => { const f = inp.files[0]; resolve(f ? { bytes: new Uint8Array(await f.arrayBuffer()), file: null, name: f.name } : null); };
    inp.click();
  });
}

// Electron: 파일 탐색기에서 .nabi를 더블클릭해 연 경우(실행 중이면 이벤트, 실행 시 연 파일은 takePendingFile)
export function onOpenFile(cb) { return native ? native.onOpenFile(cb) : () => {}; }
export async function takePendingFile() { return native ? native.takePendingFile() : null; }
// 저장하지 않은 변경 표시(Electron: 창 닫을 때 확인, macOS 창 제목 점)
export function setDirty(dirty) { if (native) native.setDirty(!!dirty); }
export function closeWindow() { if (native) native.closeWindow(); else window.close(); }
