// 끌기 추적과 손가락·펜 입력(태블릿). 편집기 엔진(src/editor.js)과 편집기 화면(app/)이 같이 쓴다.
// ---------- 손가락·펜 입력(태블릿) ----------
// 마우스는 예전대로 mouse* 이벤트로 받는다. 손가락·펜은 pointer* 이벤트로 받아(pressEvent) 같은 처리 함수에 넘긴다.
// 지금 눌려 있는 손가락·펜(가장 최근 것). trackPointer가 이 손가락을 따라간다
let touchDown = null;
if (typeof window !== 'undefined') {
  window.addEventListener('pointerdown', (e) => { if (e.pointerType !== 'mouse') touchDown = e; }, true);
  const clear = (e) => { if (touchDown?.pointerId === e.pointerId) touchDown = null; };
  window.addEventListener('pointerup', clear, true);
  window.addEventListener('pointercancel', clear, true);
}
export const touchActive = () => !!touchDown;

// 탭 횟수(두 번 탭 = 더블클릭). 손가락의 pointerdown은 detail이 늘 0이라 직접 센다. 같은 이벤트는 한 번만 센다
const TAP_MS = 350, TAP_PX = 24;
let lastTap = { t: -1e9, x: 0, y: 0, n: 0 };
const tapSeen = new WeakMap();
export function tapCount(e) {
  if (tapSeen.has(e)) return tapSeen.get(e);
  const near = e.timeStamp - lastTap.t < TAP_MS && Math.hypot(e.clientX - lastTap.x, e.clientY - lastTap.y) < TAP_PX;
  const n = near ? Math.min(3, lastTap.n + 1) : 1;
  lastTap = { t: e.timeStamp, x: e.clientX, y: e.clientY, n };
  tapSeen.set(e, n);
  return n;
}
// 손가락·펜 pointerdown → 마우스 눌림과 같은 모양(왼쪽 단추, 수정 키 없음, detail = 탭 횟수)
export function pressEvent(e, detail = tapCount(e)) {
  return {
    clientX: e.clientX, clientY: e.clientY, button: 0, buttons: 1, detail,
    shiftKey: false, altKey: false, ctrlKey: false, metaKey: false,
    target: e.target, pointerType: e.pointerType, pointerId: e.pointerId, timeStamp: e.timeStamp, touch: true, original: e,
    preventDefault: () => e.preventDefault(), stopPropagation: () => e.stopPropagation(),
  };
}

// 창 전체 드래그 추적: move(ev), up(ev). 반환값을 부르면 중간에 그만둔다.
// 손가락·펜으로 누른 중이면 그 손가락의 pointer 이벤트를, 아니면 마우스 이벤트를 따라간다.
let tracking = null; // 지금 따라가는 손가락 { stop, moved }
export function trackPointer(move, up) {
  const t = touchDown;
  if (t) {
    const id = t.pointerId, x0 = t.clientX, y0 = t.clientY;
    const cur = { moved: false, stop: null };
    const pm = (ev) => { if (ev.pointerId !== id) return; if (!cur.moved && Math.hypot(ev.clientX - x0, ev.clientY - y0) >= 6) cur.moved = true; move(ev); };
    const pu = (ev) => { if (ev.pointerId !== id) return; stop(); up?.(ev); };
    const stop = () => {
      window.removeEventListener('pointermove', pm); window.removeEventListener('pointerup', pu); window.removeEventListener('pointercancel', pu);
      if (tracking === cur) tracking = null;
    };
    cur.stop = stop;
    tracking = cur;
    window.addEventListener('pointermove', pm);
    window.addEventListener('pointerup', pu);
    window.addEventListener('pointercancel', pu); // 브라우저가 가져가면(스크롤 등) 그 자리에서 끝낸 것으로
    return stop;
  }
  const mm = (ev) => move(ev);
  const mu = (ev) => { stop(); up?.(ev); };
  const stop = () => { window.removeEventListener('mousemove', mm); window.removeEventListener('mouseup', mu); };
  window.addEventListener('mousemove', mm);
  window.addEventListener('mouseup', mu);
  return stop;
}
// 손가락 끌기를 (아직 움직이지 않았으면) 놓은 처리 없이 그만둔다 — 두 번째 손가락이 닿아 확대·이동으로 바뀔 때
export function abortTrack() {
  if (!tracking || tracking.moved) return false;
  tracking.stop();
  return true;
}

// 손가락으로 끄는 동안 패널이 스크롤되지 않게(길게 눌러 끌기)
let scrollLock = false;
if (typeof document !== 'undefined') document.addEventListener('touchmove', (e) => { if (scrollLock && e.cancelable) e.preventDefault(); }, { passive: false });
export function lockTouchScroll(on) { scrollLock = !!on; }

// 길게 누르기(손가락·펜만): ms 동안 거의 움직이지 않으면 handler(pressEvent). 그 손가락을 놓을 때까지 스크롤을 막는다.
// 패널처럼 손가락으로 스크롤해야 하는 곳에서 끌기(순서 바꾸기)를 시작할 때 쓴다. 짧게 누르면(탭) 평소처럼 클릭.
let suppressUntil = 0;
export function onLongPress(el, handler, { ms = 420, filter = () => true, mod = false } = {}) {
  for (const t of ['mousedown', 'mouseup', 'click', 'dblclick']) el.addEventListener(t, (e) => { if (performance.now() < suppressUntil) { e.stopImmediatePropagation(); e.preventDefault(); } }, true);
  el.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'mouse' || !e.isPrimary || !filter(e)) return;
    const x0 = e.clientX, y0 = e.clientY, id = e.pointerId;
    const cancel = () => { clearTimeout(timer); window.removeEventListener('pointermove', pm, true); window.removeEventListener('pointerup', cancel, true); window.removeEventListener('pointercancel', cancel, true); };
    const pm = (ev) => { if (ev.pointerId === id && Math.hypot(ev.clientX - x0, ev.clientY - y0) > 8) cancel(); };
    const timer = setTimeout(() => {
      cancel();
      if (touchDown?.pointerId !== id) return;
      lockTouchScroll(true);
      const off = (ev) => { if (ev.pointerId !== id) return; lockTouchScroll(false); window.removeEventListener('pointerup', off, true); window.removeEventListener('pointercancel', off, true); };
      window.addEventListener('pointerup', off, true);
      window.addEventListener('pointercancel', off, true);
      navigator.vibrate?.(12);
      suppressUntil = performance.now() + 900; // 길게 누른 뒤 브라우저가 덧붙이는 탭(호환 마우스 이벤트)은 무시
      handler(mod ? { ...pressEvent(e, 1), ctrlKey: true } : pressEvent(e, 1));
    }, ms);
    window.addEventListener('pointermove', pm, true);
    window.addEventListener('pointerup', cancel, true);
    window.addEventListener('pointercancel', cancel, true);
  });
  el.addEventListener('contextmenu', (e) => { if (touchDown || e.pointerType === 'touch' || e.pointerType === 'pen') e.preventDefault(); });
}

