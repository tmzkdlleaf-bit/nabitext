// 화면용 이미지 주소. 큰 사진은 화면에 축소본(미리보기)을 쓰고, 출력·저장에는 원본을 쓴다.
//   모델에는 늘 원본 주소(에셋 blob:)가 들어 있고, 화면을 그리는 곳에서만 displaySrc()로 바꿔 쓴다.
//   축소본을 만드는 쪽(app/assets.js)이 setImageSource로 연결한다. 연결이 없으면(엔진 데모) 원본 그대로.

let source = null; // { display(src) → 주소, thumb(src) → 주소 | null, ready(src) → Promise, dims(src) → { w, h } | null }
let exporting = 0, thumbing = 0;
// 축소본이 새로 준비될 때마다 1 증가(내용 열쇠에 넣어 화면 요소를 다시 만들게 한다)
export let proxyGen = 0;
export const BLANK = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';

export function setImageSource(s) { source = s; }
export function bumpProxy() { proxyGen++; }

// 화면에 쓸 주소(출력 중이면 원본)
export function displaySrc(src) {
  if (!src || exporting || !source) return src;
  if (thumbing) return source.thumb?.(src) ?? BLANK; // 미리보기용 아주 작은 사본(만드는 중이면 빈 그림)
  return source.display(src) ?? src;
}
// 축소본 준비를 기다린다(필요 없는 이미지는 바로)
export function srcReady(src) { return source?.ready(src) ?? Promise.resolve(); }
// 원본 크기(알면). 방향(EXIF) 반영
export function srcDims(src) { return source?.dims(src) ?? null; }

// fn 안에서는 원본 주소를 쓴다(출력용 DOM 만들기)
export function withOriginals(fn) {
  exporting++;
  try { return fn(); } finally { exporting--; }
}
export function isExporting() { return exporting > 0; }
// fn 안에서는 아주 작은 사본을 쓴다(장 목록 미리보기)
export function withThumbs(fn) {
  thumbing++;
  try { return fn(); } finally { thumbing--; }
}
export function isThumbing() { return thumbing > 0 && !exporting; }
