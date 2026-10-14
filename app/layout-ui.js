// 화면 배치(사용자가 바꿈): 도구 막대 위치, 패널 좌우, 패널 너비, 숨기기, 도구 막대에 보일 도구·순서.
// 설정(app/settings.js의 layout)에 저장하고, 여기서는 DOM에 적용만 한다.
//   도구 막대: 'top' = 위 막대 가운데 / 'left'·'right' = 세로 줄
//   swap: 장·레이어 패널과 속성 패널의 좌우를 바꿈(CSS order만 바꾸므로 DOM·포커스는 그대로)
//   너비: 패널 가장자리의 손잡이를 끌어 바꾸고, 두 번 누르면 기본 너비

export const TOOL_ITEMS = [['select', '선택'], ['text', '글상자'], ['shapes', '도형'], ['line', '선'], ['pen', '펜'], ['image', '이미지'], ['find', '찾기']];
export const LEFT_W = 236, RIGHT_W = 292, MIN_W = 180, MAX_W = 520;
export const LAYOUT_DEFAULT = Object.freeze({ tools: 'top', swap: false, showLeft: true, showRight: true, showStatus: true, leftW: LEFT_W, rightW: RIGHT_W, toolOrder: TOOL_ITEMS.map((t) => t[0]), toolHidden: [] });

const clampW = (w, d) => (Number.isFinite(+w) ? Math.max(MIN_W, Math.min(MAX_W, Math.round(+w))) : d);

// 저장된 값 정리(모르는 값은 기본값, 새로 생긴 도구는 끝에 붙임)
export function cleanLayout(o) {
  const L = { ...LAYOUT_DEFAULT, toolOrder: [...LAYOUT_DEFAULT.toolOrder], toolHidden: [] };
  if (!o || typeof o !== 'object') return L;
  if (['top', 'left', 'right'].includes(o.tools)) L.tools = o.tools;
  for (const k of ['swap', 'showLeft', 'showRight', 'showStatus']) if (typeof o[k] === 'boolean') L[k] = o[k];
  L.leftW = clampW(o.leftW, LEFT_W);
  L.rightW = clampW(o.rightW, RIGHT_W);
  const ids = new Set(LAYOUT_DEFAULT.toolOrder);
  if (Array.isArray(o.toolOrder)) {
    const order = o.toolOrder.filter((id, i, a) => ids.has(id) && a.indexOf(id) === i);
    L.toolOrder = [...order, ...LAYOUT_DEFAULT.toolOrder.filter((id) => !order.includes(id))];
  }
  if (Array.isArray(o.toolHidden)) L.toolHidden = o.toolHidden.filter((id) => ids.has(id));
  return L;
}

const $ = (id) => document.getElementById(id);
const toolEl = (id) => ({ select: document.querySelector('#rail > [data-tool="select"]'), text: document.querySelector('#rail > [data-tool="text"]'), shapes: $('shapeWrap'),
  line: document.querySelector('#rail > [data-tool="line"]'), pen: document.querySelector('#rail > [data-tool="pen"]'), image: $('addImage'), find: $('findBtn') })[id];

// 배치를 화면에 적용
export function applyLayout(L) {
  const body = document.body, rail = $('rail'), main = $('main');
  body.classList.remove('tools-top', 'tools-left', 'tools-right');
  body.classList.add('tools-' + L.tools);
  if (L.tools === 'top') { if (rail.parentNode !== $('toolSlot')) $('toolSlot').appendChild(rail); }
  else if (rail.parentNode !== main) main.appendChild(rail);
  body.classList.toggle('swap', !!L.swap);
  body.classList.toggle('hide-left', !L.showLeft);
  body.classList.toggle('hide-right', !L.showRight);
  body.classList.toggle('hide-status', !L.showStatus);
  $('left').style.width = L.leftW + 'px';
  $('props').style.width = L.rightW + 'px';
  // 도구 순서·숨김(찾기 앞의 구분선은 찾기가 보이고 앞에 다른 도구가 있을 때만)
  const hidden = new Set(L.toolHidden);
  const sep = rail.querySelector('.hsep');
  for (const id of L.toolOrder) {
    const el = toolEl(id);
    if (!el) continue;
    if (id === 'find') rail.appendChild(sep);
    rail.appendChild(el);
    el.style.display = hidden.has(id) ? 'none' : '';
  }
  const imgInput = $('imgFile');
  if (imgInput) rail.appendChild(imgInput);
  const visible = L.toolOrder.filter((id) => !hidden.has(id));
  sep.style.display = visible.includes('find') && visible[0] !== 'find' ? '' : 'none';
}

// 패널 가장자리 손잡이: 끌어서 너비, 두 번 누르면 기본 너비. onResize(side, width, done)
export function initSplitters(getLayout, onResize) {
  for (const sp of document.querySelectorAll('.split')) {
    // 손잡이가 붙은 패널: 화면에서 캔버스 바깥쪽에 있는 패널(좌우를 바꾸면 달라진다)
    const panelOf = () => {
      const L = getLayout();
      const leftSide = sp.dataset.edge === 'l';
      return (leftSide !== !!L.swap) ? { el: $('left'), key: 'leftW', def: LEFT_W, sign: leftSide ? 1 : -1 } : { el: $('props'), key: 'rightW', def: RIGHT_W, sign: leftSide ? 1 : -1 };
    };
    sp.addEventListener('mousedown', (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      const p = panelOf(), x0 = e.clientX, w0 = p.el.getBoundingClientRect().width;
      document.body.classList.add('resizing');
      let raf = 0, w = w0;
      const mm = (ev) => {
        w = clampW(w0 + (ev.clientX - x0) * p.sign, w0);
        if (!raf) raf = requestAnimationFrame(() => { raf = 0; p.el.style.width = w + 'px'; onResize(p.key, w, false); });
      };
      const mu = () => {
        window.removeEventListener('mousemove', mm); window.removeEventListener('mouseup', mu);
        document.body.classList.remove('resizing');
        cancelAnimationFrame(raf);
        p.el.style.width = w + 'px';
        onResize(p.key, w, true);
      };
      window.addEventListener('mousemove', mm);
      window.addEventListener('mouseup', mu);
    });
    sp.addEventListener('dblclick', () => { const p = panelOf(); p.el.style.width = p.def + 'px'; onResize(p.key, p.def, true); });
  }
}
