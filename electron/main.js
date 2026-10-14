'use strict';
// Electron 메인 프로세스.
// 렌더러는 웹판과 같은 파일(index.html = 편집기, demo.html = 엔진 데모, app/, src/, vendor/, res/)을 app://bundle/ 주소로 그대로 불러온다.
// 웹판과 다른 점은 preload가 넣는 window.native(네이티브 저장·PDF·메뉴)뿐이고, 렌더러는 src/platform.js에서만 이를 본다.

const { app, BrowserWindow, Menu, dialog, ipcMain, protocol, session, shell } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const crypto = require('node:crypto');
const updates = require('./updater.js');

const ROOT = path.join(__dirname, '..');
const HOST = 'bundle';
const ORIGIN = `app://${HOST}`;
// app://bundle/ 로 내보내는 최상위 항목. electron/, node_modules/, package.json 등은 렌더러에서 읽을 수 없다.
const SERVED = new Set(['index.html', 'demo.html', 'app', 'res', 'src', 'vendor', 'demo']);
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif',
  '.woff2': 'font/woff2', '.woff': 'font/woff', '.ttf': 'font/ttf', '.otf': 'font/otf', '.md': 'text/plain; charset=utf-8',
};

// standard: 상대 주소·origin이 일반 웹처럼 동작. secure: 보안 컨텍스트(Local Font Access·클립보드 API 조건).
// supportFetchAPI/corsEnabled: 출력 시 fetch()로 이미지·글꼴을 읽어 data URL로 넣기 때문에 필요.
protocol.registerSchemesAsPrivileged([{
  scheme: 'app',
  privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true, codeCache: true },
}]);

// ---------- app:// 응답 ----------

// HTML 문서의 CSP: electron/csp.js(웹판 배포 폴더의 _headers도 같은 함수로 만든다)
const { cspFor } = require('./csp.js');

// 인쇄용 문서(벡터 PDF). 내용은 렌더러의 buildPrintHTML() 결과이며 자원은 모두 data URL이다.
const printDocs = new Map(); // token → html
const PRINT_CSP = "default-src 'none'; img-src data:; font-src data:; style-src 'unsafe-inline'";

const notFound = () => new Response('Not found', { status: 404, headers: { 'content-type': 'text/plain' } });

async function serve(request) {
  const url = new URL(request.url);
  if (url.host === 'print') {
    const html = printDocs.get(url.pathname.slice(1));
    if (html == null) return notFound();
    return new Response(html, { headers: { 'content-type': 'text/html; charset=utf-8', 'content-security-policy': PRINT_CSP } });
  }
  if (url.host !== HOST) return notFound();
  let rel;
  try { rel = decodeURIComponent(url.pathname).replace(/^\/+/, '') || 'index.html'; } catch { return notFound(); }
  const abs = path.resolve(ROOT, rel);
  const inside = path.relative(ROOT, abs);
  if (!inside || inside.startsWith('..') || path.isAbsolute(inside)) return notFound();
  if (!SERVED.has(inside.split(path.sep)[0])) return notFound();
  let body;
  try { body = await fsp.readFile(abs); } catch { return notFound(); }
  const ext = path.extname(abs).toLowerCase();
  const headers = { 'content-type': MIME[ext] || 'application/octet-stream', 'x-content-type-options': 'nosniff' };
  if (ext === '.html') headers['content-security-policy'] = cspFor(body.toString('utf8'));
  return new Response(body, { headers });
}

// ---------- 창 ----------

// 렌더러에 허용하는 권한. local-fonts: 시스템 글꼴 목록(Local Font Access API), 클립보드 쓰기.
const ALLOWED_PERMISSIONS = new Set(['local-fonts', 'clipboard-sanitized-write']);
const isAppURL = (u) => typeof u === 'string' && (u === ORIGIN || u.startsWith(ORIGIN + '/'));

function hardenSession(ses) {
  ses.setPermissionRequestHandler((wc, permission, callback, details) => {
    callback(ALLOWED_PERMISSIONS.has(permission) && isAppURL(details.requestingUrl || wc.getURL()));
  });
  ses.setPermissionCheckHandler((wc, permission, origin) => ALLOWED_PERMISSIONS.has(permission) && isAppURL(origin));
}

app.on('web-contents-created', (_e, wc) => {
  // 앱 밖 주소로 이동·새 창 금지. http(s) 링크는 기본 브라우저로 연다.
  wc.on('will-navigate', (e, url) => { if (!isAppURL(url)) e.preventDefault(); });
  wc.on('will-redirect', (e, url) => { if (!isAppURL(url) && !url.startsWith('app://print/')) e.preventDefault(); });
  wc.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  wc.on('will-attach-webview', (e) => e.preventDefault());
});

let mainWindow = null;

function createWindow() {
  const win = new BrowserWindow({
    width: 1400, height: 900, minWidth: 800, minHeight: 600, show: false,
    backgroundColor: '#e9e7e3',
    icon: path.join(ROOT, 'res', 'icon.png'), // Linux 창 아이콘(Windows·macOS는 설치 파일의 아이콘을 씀)
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true, sandbox: true, nodeIntegration: false, webSecurity: true,
      spellcheck: false,
    },
  });
  win.once('ready-to-show', () => win.show());
  win.webContents.on('render-process-gone', async (_e, details) => {
    if (details.reason === 'clean-exit') return;
    await dialog.showMessageBox(win, { type: 'error', message: '화면 프로세스가 비정상 종료되었습니다.', detail: `원인: ${details.reason}\n다시 불러옵니다.` });
    if (!win.isDestroyed()) win.reload();
  });
  // 저장하지 않은 변경이 있으면 닫기 전에 묻는다(렌더러가 set-dirty로 알려 줌)
  win.on('close', (e) => {
    if (!win.dirty || win.forceClose) return;
    e.preventDefault();
    const r = dialog.showMessageBoxSync(win, {
      type: 'question', buttons: ['저장', '저장하지 않음', '취소'], defaultId: 0, cancelId: 2,
      message: '변경 내용을 저장하시겠습니까?', detail: '저장하지 않으면 마지막 저장 이후의 변경이 사라집니다.',
    });
    if (r === 0) win.webContents.send('menu', 'saveAndClose');
    if (r === 1) win.webContents.send('menu', 'discardAndClose');
  });
  win.loadURL(`${ORIGIN}/index.html`);
  mainWindow = win;
  win.on('closed', () => { if (mainWindow === win) mainWindow = null; });
  return win;
}

// ---------- 메뉴 ----------
// 단축키는 렌더러의 keymap이 처리한다(사용자 재지정 가능). 그래서 되돌리기·전체 선택 등은 메뉴에 단축키를 '표시'만 하고
// 등록하지 않는다(registerAccelerator: false) → 키 한 번에 두 번 실행될 여지가 없다.
// 잘라내기·복사·붙여넣기는 운영체제 기본 동작(role)을 쓴다. macOS는 Cmd+C/V가 메뉴를 통해서만 동작하기 때문이다.
// 렌더러가 알려 준 단축키(사용자 재지정 반영) → 메뉴에 표시할 accelerator. 메뉴 id → 'CmdOrCtrl+S' 같은 문자열('' = 표시 안 함)
let menuAccels = {};
let lastMenuState = { undo: false, redo: false };
function buildMenu() {
  const isMac = process.platform === 'darwin';
  const A = (id, def) => (typeof menuAccels[id] === 'string' ? menuAccels[id] || undefined : def);
  const send = (cmd) => (_item, win) => (win || BrowserWindow.getFocusedWindow() || mainWindow)?.webContents.send('menu', cmd);
  const sep = { type: 'separator' };
  const template = [
    ...(isMac ? [{ role: 'appMenu' }] : []),
    { label: '파일', submenu: [
      { id: 'new', label: '새로 만들기', accelerator: A('new', 'CmdOrCtrl+N'), registerAccelerator: false, click: send('file:new') },
      { id: 'open', label: '열기…', accelerator: A('open', 'CmdOrCtrl+O'), registerAccelerator: false, click: send('file:open') },
      { id: 'save', label: '저장', accelerator: A('save', 'CmdOrCtrl+S'), registerAccelerator: false, click: send('file:save') },
      { id: 'saveAs', label: '다른 이름으로 저장…', accelerator: A('saveAs', 'CmdOrCtrl+Shift+S'), registerAccelerator: false, click: send('file:saveAs') },
      sep,
      { id: 'export', label: '내보내기…', accelerator: A('export', 'CmdOrCtrl+E'), registerAccelerator: false, click: send('export') },
      sep,
      isMac ? { role: 'close', label: '창 닫기' } : { role: 'quit', label: '종료' },
    ] },
    { label: '편집', submenu: [
      { id: 'undo', label: '되돌리기', accelerator: A('undo', 'CmdOrCtrl+Z'), registerAccelerator: false, click: send('undo') },
      { id: 'redo', label: '다시 실행', accelerator: A('redo', 'CmdOrCtrl+Shift+Z'), registerAccelerator: false, click: send('redo') },
      sep,
      { id: 'cut', role: 'cut', label: '잘라내기' },
      { id: 'copy', role: 'copy', label: '복사' },
      { id: 'paste', role: 'paste', label: '붙여넣기' },
      { id: 'pastePlain', label: '서식 없이 붙여넣기', accelerator: A('pastePlain', 'CmdOrCtrl+Shift+V'), registerAccelerator: false, click: send('pastePlain') },
      sep,
      { id: 'selectAll', label: '전체 선택', accelerator: A('selectAll', 'CmdOrCtrl+A'), registerAccelerator: false, click: send('selectAll') },
      { type: 'separator' },
      { id: 'find', label: '찾기·바꾸기…', accelerator: A('find', 'CmdOrCtrl+F'), registerAccelerator: false, click: send('find') },
    ] },
    { label: '보기', submenu: [
      { id: 'rulers', label: '눈금자', accelerator: A('rulers', 'Shift+R'), registerAccelerator: false, click: send('view:rulers') },
      { id: 'grid', label: '격자', accelerator: A('grid', "CmdOrCtrl+'"), registerAccelerator: false, click: send('view:grid') },
      { id: 'guides', label: '가이드', accelerator: A('guides', 'CmdOrCtrl+;'), registerAccelerator: false, click: send('view:guides') },
      { id: 'panels', label: '패널 숨기기·보이기', accelerator: A('panels', 'CmdOrCtrl+\\'), registerAccelerator: false, click: send('view:panels') },
      sep,
      { role: 'togglefullscreen', label: '전체 화면' },
      ...(app.isPackaged ? [] : [sep, { role: 'reload', label: '새로 고침(개발)' }, { role: 'toggleDevTools', label: '개발자 도구' }]),
    ] },
    ...(isMac ? [{ role: 'windowMenu' }] : []),
    { label: '도움말', submenu: [
      { id: 'updateCheck', label: '업데이트 확인…', click: send('update:check') },
      { label: `나비글쓰기 ${app.getVersion()}`, enabled: false },
    ] },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// ---------- IPC ----------

function assertSender(e) {
  const url = e.senderFrame?.url;
  if (!isAppURL(url)) throw new Error('허용되지 않은 호출: ' + url);
}

// 파일 이름 검사: 폴더 경로가 섞이거나 금지 문자가 있으면 거부(렌더러의 fileName()이 이미 치환한 값이어야 함)
function checkName(name) {
  if (typeof name !== 'string' || !name || name !== path.basename(name) || /[\\/:*?"<>|\u0000-\u001f]/.test(name) || name === '.' || name === '..')
    throw new Error('잘못된 파일 이름: ' + name);
  return name;
}
function checkFiles(files) {
  if (!Array.isArray(files) || !files.length) throw new Error('저장할 파일이 없습니다');
  return files.map((f) => ({ name: checkName(f?.name), data: f?.data instanceof Uint8Array ? f.data : (() => { throw new Error('파일 내용 형식 오류'); })() }));
}

// 임시 파일에 쓴 뒤 이름을 바꾼다(쓰는 도중 실패해도 기존 파일이 반쯤 덮이지 않음)
async function writeAtomic(target, data) {
  const tmp = `${target}.${crypto.randomBytes(4).toString('hex')}.tmp`;
  await fsp.writeFile(tmp, data);
  try { await fsp.rename(tmp, target); } catch (err) { await fsp.rm(tmp, { force: true }); throw err; }
}

// 대화상자 기본 폴더: 이번 실행에서 마지막으로 저장한 폴더, 처음에는 '사진' 폴더
let lastDir = null;
const defaultDir = () => lastDir || app.getPath('pictures');

const winOf = (e) => BrowserWindow.fromWebContents(e.sender);

// 한 개: 파일 저장 대화상자. 여러 개: 폴더 선택 → 같은 이름이 있으면 덮어쓸지 확인.
async function saveFiles(e, files) {
  assertSender(e);
  files = checkFiles(files);
  const win = winOf(e);
  if (files.length === 1) {
    const f = files[0];
    const ext = path.extname(f.name).slice(1).toLowerCase();
    const r = await dialog.showSaveDialog(win, {
      title: '내보내기', defaultPath: path.join(defaultDir(), f.name),
      filters: ext ? [{ name: ext.toUpperCase(), extensions: [ext] }] : [],
      properties: ['createDirectory', 'showOverwriteConfirmation'],
    });
    if (r.canceled || !r.filePath) return { mode: 'cancelled' };
    const target = ext && !path.extname(r.filePath) ? `${r.filePath}.${ext}` : r.filePath;
    await writeAtomic(target, f.data);
    lastDir = path.dirname(target);
    return { mode: 'file', count: 1, paths: [target] };
  }
  const r = await dialog.showOpenDialog(win, {
    title: `${files.length}개 파일을 저장할 폴더`, buttonLabel: '이 폴더에 저장', defaultPath: defaultDir(),
    properties: ['openDirectory', 'createDirectory', 'promptToCreate'],
  });
  if (r.canceled || !r.filePaths?.length) return { mode: 'cancelled' };
  const dir = r.filePaths[0];
  await fsp.mkdir(dir, { recursive: true });
  const clash = files.filter((f) => fs.existsSync(path.join(dir, f.name)));
  if (clash.length) {
    const list = clash.slice(0, 10).map((f) => f.name).join('\n') + (clash.length > 10 ? `\n…외 ${clash.length - 10}개` : '');
    const b = await dialog.showMessageBox(win, {
      type: 'question', buttons: ['덮어쓰기', '취소'], defaultId: 1, cancelId: 1,
      message: `같은 이름의 파일 ${clash.length}개가 이미 있습니다. 덮어쓰시겠습니까?`, detail: list,
    });
    if (b.response !== 0) return { mode: 'cancelled' };
  }
  const paths = [];
  for (const f of files) {
    const p = path.join(dir, f.name);
    await writeAtomic(p, f.data);
    paths.push(p);
  }
  lastDir = dir;
  return { mode: 'directory', count: files.length, dir, paths };
}

// 인쇄 문서 → PDF(인쇄 창 없이). 숨긴 창에 불러와 글꼴·이미지가 준비된 뒤 printToPDF.
async function renderPDF(html) {
  const token = crypto.randomUUID();
  printDocs.set(token, html);
  const w = new BrowserWindow({
    show: false, width: 800, height: 600,
    webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false, spellcheck: false },
  });
  try {
    await w.loadURL(`app://print/${token}`);
    await w.webContents.executeJavaScript(
      'document.fonts.ready.then(() => Promise.all([...document.images].map((i) => i.decode().catch(() => {})))).then(() => true)');
    // preferCSSPageSize: 장마다 이름 붙은 @page 크기를 따른다. printBackground: 배경·형광펜을 인쇄한다.
    return await w.webContents.printToPDF({ preferCSSPageSize: true, printBackground: true, margins: { marginType: 'none' } });
  } finally {
    printDocs.delete(token);
    w.destroy();
  }
}

async function saveVectorPDF(e, html, name) {
  assertSender(e);
  if (typeof html !== 'string' || !html) throw new Error('인쇄 문서가 비어 있습니다');
  checkName(name);
  const r = await dialog.showSaveDialog(winOf(e), {
    title: 'PDF 저장(벡터)', defaultPath: path.join(defaultDir(), name),
    filters: [{ name: 'PDF', extensions: ['pdf'] }], properties: ['createDirectory', 'showOverwriteConfirmation'],
  });
  if (r.canceled || !r.filePath) return { mode: 'cancelled' };
  const target = path.extname(r.filePath) ? r.filePath : `${r.filePath}.pdf`;
  const pdf = await renderPDF(html);
  await writeAtomic(target, pdf);
  lastDir = path.dirname(target);
  return { mode: 'file', count: 1, paths: [target], bytes: pdf.length };
}

// ---------- 프로젝트 파일 ----------
// 렌더러는 경로를 직접 고를 수 없다. 이 프로세스가 대화상자·파일 연결로 받은 경로만 기억해 두고(granted) 그 경로에만 쓴다.
const PROJECT_FILTERS = [{ name: '나비글쓰기 프로젝트', extensions: ['nabi'] }];
const MAX_PROJECT = 2 * 1024 ** 3; // 2GB
const granted = new Set();
let lastProjectDir = null;
let pendingOpen = null; // 실행 인자로 받은 .nabi(렌더러가 준비되면 가져감)

async function readProject(p) {
  const st = await fsp.stat(p);
  if (!st.isFile() || st.size > MAX_PROJECT) throw new Error('열 수 없는 파일입니다');
  granted.add(p);
  lastProjectDir = path.dirname(p);
  return { path: p, name: path.basename(p), bytes: new Uint8Array(await fsp.readFile(p)) };
}
const projectArg = (argv) => argv.slice(1).find((a) => /\.nabi$/i.test(a) && fs.existsSync(a)) || null;

async function saveProject(e, bytes, opts = {}) {
  assertSender(e);
  if (!(bytes instanceof Uint8Array)) throw new Error('프로젝트 내용 형식 오류');
  let target = typeof opts.path === 'string' && granted.has(opts.path) ? opts.path : null;
  if (!target) {
    const name = checkName(opts.name || '제목 없음.nabi');
    const r = await dialog.showSaveDialog(winOf(e), {
      title: '프로젝트 저장', defaultPath: path.join(lastProjectDir || app.getPath('documents'), name),
      filters: PROJECT_FILTERS, properties: ['createDirectory', 'showOverwriteConfirmation'],
    });
    if (r.canceled || !r.filePath) return { mode: 'cancelled' };
    target = /\.nabi$/i.test(r.filePath) ? r.filePath : `${r.filePath}.nabi`;
  }
  await writeAtomic(target, bytes);
  granted.add(target);
  lastProjectDir = path.dirname(target);
  return { mode: 'file', path: target, name: path.basename(target) };
}

async function openProject(e) {
  assertSender(e);
  const r = await dialog.showOpenDialog(winOf(e), {
    title: '프로젝트 열기', defaultPath: lastProjectDir || app.getPath('documents'), filters: PROJECT_FILTERS, properties: ['openFile'],
  });
  if (r.canceled || !r.filePaths?.length) return null;
  return readProject(r.filePaths[0]);
}

async function openPending(e) {
  assertSender(e);
  const p = pendingOpen;
  pendingOpen = null;
  return p ? readProject(p).catch(() => null) : null;
}

// 실행 중에 .nabi를 더블클릭(Windows·Linux: 두 번째 실행의 인자, macOS: open-file 이벤트)
async function sendOpen(p) {
  if (!mainWindow) { pendingOpen = p; return; }
  try { mainWindow.webContents.send('open-file', await readProject(p)); } catch { /* 읽을 수 없는 파일 */ }
}

// 렌더러가 요청하는 기본 편집 동작(붙여넣기 등). 서식 없이 붙여넣기는 렌더러가 표시를 켠 뒤 이것으로 paste 이벤트를 부른다.
const EDIT_ACTIONS = new Set(['cut', 'copy', 'paste']);
function edit(e, action) {
  assertSender(e);
  if (!EDIT_ACTIONS.has(action)) throw new Error('알 수 없는 편집 동작: ' + action);
  e.sender[action]();
  return true;
}

// 되돌리기 가능 여부 → 메뉴 항목 활성화
function menuState(e, s) {
  try { assertSender(e); } catch { return; }
  const m = Menu.getApplicationMenu();
  if (!m || !s || typeof s !== 'object') return;
  if (s.accels && typeof s.accels === 'object') {
    const ok = {};
    for (const [id, v] of Object.entries(s.accels)) if (/^\w{1,20}$/.test(id) && typeof v === 'string' && v.length <= 40 && /^[\w+;'=\-[\],./\\`]*$/.test(v)) ok[id] = v;
    menuAccels = ok;
    buildMenu();
    for (const id of ['undo', 'redo']) { const it = Menu.getApplicationMenu()?.getMenuItemById(id); if (it) it.enabled = lastMenuState[id]; }
  }
  for (const id of ['undo', 'redo']) if (typeof s[id] === 'boolean') { lastMenuState[id] = s[id]; const it = Menu.getApplicationMenu()?.getMenuItemById(id); if (it) it.enabled = s[id]; }
}

// ---------- 시작 ----------

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  pendingOpen = projectArg(process.argv);
  app.on('open-file', (e, p) => { e.preventDefault(); if (app.isReady() && mainWindow) sendOpen(p); else pendingOpen = p; });
  app.on('second-instance', (_e, argv) => {
    if (!mainWindow) return;
    const p = projectArg(argv);
    if (p) sendOpen(p);
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  });
  app.whenReady().then(() => {
    protocol.handle('app', serve);
    hardenSession(session.defaultSession);
    ipcMain.handle('save-files', saveFiles);
    ipcMain.handle('save-vector-pdf', saveVectorPDF);
    ipcMain.handle('edit', edit);
    ipcMain.on('menu-state', menuState);
    ipcMain.handle('project-save', saveProject);
    ipcMain.handle('project-open', openProject);
    ipcMain.handle('project-pending', openPending);
    ipcMain.on('set-dirty', (e, dirty) => {
      const w = BrowserWindow.fromWebContents(e.sender);
      if (!w || !isAppURL(e.senderFrame?.url)) return;
      w.dirty = !!dirty;
      if (process.platform === 'darwin') w.setDocumentEdited(w.dirty);
    });
    ipcMain.on('close-window', (e) => {
      const w = BrowserWindow.fromWebContents(e.sender);
      if (!w || !isAppURL(e.senderFrame?.url)) return;
      w.forceClose = true;
      w.close();
    });
    updates.init({ isAppURL });
    buildMenu();
    createWindow();
    app.on('activate', () => { if (!BrowserWindow.getAllWindows().length) createWindow(); });
  });
  app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
}

// 검증(test/electron.py)에서 메인 프로세스 검사기로 접근하는 내부 함수. 동작에는 영향 없음.
module.exports = { renderPDF, serve, hardenSession, printDocs, ORIGIN, granted, sendOpen };
