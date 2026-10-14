'use strict';
// 자동 업데이트(설치형). electron-updater가 업데이트 주소에서 새 버전을 확인·내려받고, 앱을 끝낼 때 설치한다.
//   업데이트 주소: 설치 파일을 만들 때 publish 설정(GitHub Releases)을 넣으면 앱 안에 app-update.yml이 들어간다(.github/workflows/build.yml).
//                 NABITEXT_UPDATE_URL 환경 변수가 있으면 그 주소(generic 형식 — 자체 서버·시험용)를 쓴다.
//   꺼지는 경우(상태 'off' + 까닭): 개발 실행, 업데이트 주소가 없는 설치 파일, Microsoft Store 판(스토어가 업데이트함).
//   macOS는 서명한 앱에서만 동작한다(electron-builder 문서). 서명하지 않았으면 확인 중 오류가 나고 상태 'error'로 남는다.
// 렌더러와는 IPC 네 가지로만 주고받는다: update-state(상태 묻기), update-check(지금 확인), update-auto(자동 확인 켜고 끄기), update-install(다시 시작해 설치)

const { app, ipcMain, BrowserWindow } = require('electron');
const path = require('node:path');
const fs = require('node:fs');

const CHECK_DELAY_MS = 8000;          // 앱을 켜고 이만큼 뒤에 첫 확인(시작을 느리게 하지 않게)
const CHECK_EVERY_MS = 6 * 3600e3;    // 켜 둔 동안 다시 확인하는 간격

let updater = null;
let state = { status: 'off', reason: '', version: app.getVersion(), next: null, percent: 0 };
let auto = false, timer = null, firstDone = false;

function offReason() {
  if (!app.isPackaged && !process.env.NABITEXT_UPDATE_URL) return '개발 실행';
  if (process.windowsStore) return 'Microsoft Store 판은 스토어가 업데이트합니다';
  if (!process.env.NABITEXT_UPDATE_URL && !fs.existsSync(path.join(process.resourcesPath, 'app-update.yml'))) return '이 설치 파일에는 업데이트 주소가 없습니다';
  return '';
}

function set(s) {
  state = { ...state, ...s };
  for (const w of BrowserWindow.getAllWindows()) w.webContents.send('update-state', state);
}

async function check() {
  if (!updater) return state;
  try { await updater.checkForUpdates(); } catch (err) { set({ status: 'error', reason: short(err) }); }
  return state;
}
const short = (err) => String(err?.message || err).split('\n')[0].slice(0, 200);

function schedule() {
  clearTimeout(timer);
  if (!auto || !updater) return;
  timer = setTimeout(async () => { firstDone = true; await check(); schedule(); }, firstDone ? CHECK_EVERY_MS : CHECK_DELAY_MS);
}

function init({ isAppURL }) {
  const off = offReason();
  if (off) state = { ...state, status: 'off', reason: off };
  else {
    const { autoUpdater } = require('electron-updater');
    updater = autoUpdater;
    // 자체 주소: 설치 파일 속 app-update.yml과 같은 형식의 설정 파일을 만들어 가리킨다(내려받기 폴더 이름도 여기서 읽음)
    if (process.env.NABITEXT_UPDATE_URL) {
      const f = path.join(app.getPath('userData'), 'update-feed.yml');
      fs.writeFileSync(f, `provider: generic\nurl: ${JSON.stringify(process.env.NABITEXT_UPDATE_URL)}\nupdaterCacheDirName: nabitext-updater\n`);
      updater.updateConfigPath = f;
    }
    updater.autoDownload = true;          // 새 버전이 있으면 바로 내려받고
    updater.autoInstallOnAppQuit = true;  // 앱을 끝낼 때 설치(작업 중에 끊지 않음)
    updater.on('checking-for-update', () => set({ status: 'checking', reason: '' }));
    updater.on('update-not-available', () => set({ status: 'latest', reason: '' }));
    updater.on('update-available', (info) => set({ status: 'downloading', next: info?.version || null, percent: 0 }));
    updater.on('download-progress', (p) => set({ status: 'downloading', percent: Math.round(p?.percent || 0) }));
    updater.on('update-downloaded', (info) => set({ status: 'ready', next: info?.version || state.next, percent: 100 }));
    updater.on('error', (err) => set({ status: 'error', reason: short(err) }));
    state = { ...state, status: 'idle', reason: '' };
  }
  const guard = (e) => { if (!isAppURL(e.senderFrame?.url)) throw new Error('허용되지 않은 호출'); };
  ipcMain.handle('update-state', (e) => { guard(e); return state; });
  ipcMain.handle('update-check', async (e) => { guard(e); return check(); });
  ipcMain.on('update-auto', (e, on) => { try { guard(e); } catch { return; } auto = !!on; schedule(); });
  // 다시 시작해 설치(렌더러가 저장 여부를 먼저 확인한 뒤 부른다)
  ipcMain.handle('update-install', (e) => { guard(e); if (state.status !== 'ready') return false; setImmediate(() => updater.quitAndInstall()); return true; });
}

module.exports = { init, getState: () => state };
