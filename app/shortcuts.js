// 캔버스(요소 조작) 단축키 기본 배치. 글상자 편집 중에는 편집기 keymap(src/keymap.js)이 먼저 처리하고,
// 편집 중에 여기서 처리하는 것은 EDITING_ALLOWED에 든 명령뿐이다.
// 재지정: createKeymap({ 'Mod-Shift-d': 'duplicate', 'Mod-d': null }, APP_KEYMAP)

export const APP_KEYMAP = {
  'v': 'tool:select',
  't': 'tool:text',
  'r': 'tool:rect',
  'o': 'tool:ellipse',
  'p': 'tool:pen',
  'l': 'tool:line',
  'Delete': 'delete',
  'Backspace': 'delete',
  'ArrowLeft': 'nudge:-1:0', 'ArrowRight': 'nudge:1:0', 'ArrowUp': 'nudge:0:-1', 'ArrowDown': 'nudge:0:1',
  'Shift-ArrowLeft': 'nudge:-10:0', 'Shift-ArrowRight': 'nudge:10:0', 'Shift-ArrowUp': 'nudge:0:-10', 'Shift-ArrowDown': 'nudge:0:10',
  'Mod-d': 'duplicate',
  'Mod-g': 'group',
  'Mod-Shift-g': 'ungroup',
  'Mod-]': 'forward',
  'Mod-[': 'backward',
  'Mod-Shift-]': 'front',
  'Mod-Shift-[': 'back',
  'Mod-a': 'selectAll',
  'Mod-Shift-l': 'lock',
  'Mod-Shift-h': 'hide',
  'Escape': 'escape',
  'Enter': 'enterEdit',
  'Mod-0': 'zoomFit',
  'Mod-1': 'zoom100',
  'Mod-=': 'zoomIn',
  'Mod-Shift-=': 'zoomIn',
  'Mod--': 'zoomOut',
  'Mod-z': 'undo',
  'Mod-Shift-z': 'redo',
  'Mod-y': 'redo',
  'Shift-r': 'view:rulers',
  "Mod-'": 'view:grid',
  'Mod-;': 'view:guides',
  'Mod-e': 'export',
  'Mod-f': 'find',
  'Mod-\\': 'view:panels',
  'Mod-s': 'file:save',
  'Mod-Shift-s': 'file:saveAs',
  'Mod-o': 'file:open',
  'Mod-n': 'file:new', // 웹판에서는 브라우저가 Ctrl+N(새 창)을 먼저 가져가 동작하지 않는다. Electron판에서만 동작
};

// 글상자 편집 중에도 캔버스가 처리하는 명령
export const EDITING_ALLOWED = new Set(['escape', 'view:grid', 'view:guides', 'zoomFit', 'zoom100', 'zoomIn', 'zoomOut', 'export', 'find', 'view:panels', 'file:save', 'file:saveAs', 'file:open', 'file:new']);
