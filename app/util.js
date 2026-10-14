// 여러 모듈이 같이 쓰는 작은 도우미.

// 소수 셋째 자리까지(SVG·CSS 숫자 문자열용)
export const r3 = (v) => Math.round(v * 1000) / 1000;

// HTML 글자 이스케이프(속성·본문 모두)
export const esc = (t) => String(t).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

// 클래스 본문으로 쓴 메서드 묶음을 다른 클래스의 prototype에 붙인다(게터 포함).
// 큰 클래스(PageView)를 파일 여러 개로 나누는 데 쓴다.
export function mixin(Target, Source) {
  for (const k of Object.getOwnPropertyNames(Source.prototype)) {
    if (k === 'constructor') continue;
    Object.defineProperty(Target.prototype, k, Object.getOwnPropertyDescriptor(Source.prototype, k));
  }
}

// 파일 고르기 창(취소하면 null). accept: 'image/*', '.nabitpl,.nabi' 등
export function pickFile(accept, { multiple = false } = {}) {
  return new Promise((resolve) => {
    const inp = document.createElement('input');
    inp.type = 'file';
    inp.accept = accept;
    inp.multiple = multiple;
    inp.onchange = () => resolve(multiple ? [...inp.files] : inp.files[0] || null);
    inp.addEventListener('cancel', () => resolve(multiple ? [] : null));
    inp.click();
  });
}

// 창 전체 드래그 추적: move(ev), up(ev). 반환값을 부르면 중간에 그만둔다
export function trackPointer(move, up) {
  const mm = (ev) => move(ev);
  const mu = (ev) => { stop(); up?.(ev); };
  const stop = () => { window.removeEventListener('mousemove', mm); window.removeEventListener('mouseup', mu); };
  window.addEventListener('mousemove', mm);
  window.addEventListener('mouseup', mu);
  return stop;
}

// 앱 안 창 틀: 화면을 덮는 배경(.modal-bg) + 상자(.modal). 문서에 붙여서 배경 요소를 돌려준다
export function modal(inner, cls = '') {
  const bg = document.createElement('div');
  bg.className = 'modal-bg';
  bg.innerHTML = `<div class="modal${cls ? ' ' + cls : ''}" role="dialog">${inner}</div>`;
  document.body.appendChild(bg);
  return bg;
}
