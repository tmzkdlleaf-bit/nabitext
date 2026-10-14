'use strict';
// 렌더러에 넘기는 네이티브 기능. 렌더러는 이 객체(window.native)를 src/platform.js에서만 사용한다.
// sandbox 모드 preload라 electron의 contextBridge·ipcRenderer만 쓴다.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('native', {
  platform: process.platform,
  // files: [{ name, data: Uint8Array }] → { mode: 'file' | 'directory' | 'cancelled', count, paths }
  saveFiles: (files) => ipcRenderer.invoke('save-files', files),
  // html: buildPrintHTML() 결과, name: 기본 파일 이름 → 저장 대화상자 후 printToPDF
  saveVectorPDF: (html, name) => ipcRenderer.invoke('save-vector-pdf', html, name),
  // 운영체제 기본 편집 동작: 'cut' | 'copy' | 'paste'
  edit: (action) => ipcRenderer.invoke('edit', action),
  // { undo: bool, redo: bool } → 메뉴 항목 활성화
  setMenuState: (state) => ipcRenderer.send('menu-state', state),
  // 프로젝트 파일(8단계)
  saveProject: (bytes, opts) => ipcRenderer.invoke('project-save', bytes, opts),
  openProject: () => ipcRenderer.invoke('project-open'),
  takePendingFile: () => ipcRenderer.invoke('project-pending'),
  onOpenFile: (cb) => { const h = (_e, f) => cb(f); ipcRenderer.on('open-file', h); return () => ipcRenderer.removeListener('open-file', h); },
  setDirty: (dirty) => ipcRenderer.send('set-dirty', dirty),
  closeWindow: () => ipcRenderer.send('close-window'),
  // 자동 업데이트(electron/updater.js): 상태 { status: off|idle|checking|latest|downloading|ready|error, reason, version, next, percent }
  updates: {
    state: () => ipcRenderer.invoke('update-state'),
    check: () => ipcRenderer.invoke('update-check'),
    setAuto: (on) => ipcRenderer.send('update-auto', !!on),
    install: () => ipcRenderer.invoke('update-install'),
    onState: (cb) => { const h = (_e, s) => cb(s); ipcRenderer.on('update-state', h); return () => ipcRenderer.removeListener('update-state', h); },
  },
  // 메뉴 명령 수신. 반환값을 부르면 해제
  onMenu: (cb) => {
    const h = (_e, cmd) => cb(cmd);
    ipcRenderer.on('menu', h);
    return () => ipcRenderer.removeListener('menu', h);
  },
});
