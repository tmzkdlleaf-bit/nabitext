// 글자 폭·폰트 메트릭 측정. 캔버스 measureText 기반, 결과는 캐시한다.
// 폭은 DOM 렌더 결과와 일치해야 하며 verify.js에서 차이를 측정한다.

const ctx = new OffscreenCanvas(8, 8).getContext('2d');
const widthCache = new Map();
const metricCache = new Map();
const WIDTH_CACHE_MAX = 60000; // 자동 축소처럼 크기가 연속으로 바뀌면 열쇠가 끝없이 늘어나므로 넘치면 비운다
// 측정 캐시 세대: 글꼴이 늦게 도착해 캐시를 비우면 1 증가(레이아웃 메모가 이 값으로 무효화된다)
export let measureGen = 0;

export function fontOf(s) {
  return `${s.italic ? 'italic ' : ''}${s.fontWeight} ${s.fontSize}px ${s.fontFamily}`;
}

function setup(s) {
  ctx.font = fontOf(s);
  ctx.letterSpacing = `${s.letterSpacing || 0}px`;
  ctx.fontKerning = 'normal';
}

export function textWidth(text, s) {
  const key = fontOf(s) + '|' + (s.letterSpacing || 0) + '|' + text;
  let w = widthCache.get(key);
  if (w === undefined) {
    setup(s);
    w = ctx.measureText(text).width;
    if (widthCache.size >= WIDTH_CACHE_MAX) widthCache.clear();
    widthCache.set(key, w);
  }
  return w;
}

// CSS 콘텐츠 영역과 같은 기준(폰트 전체의 ascent/descent)
export function fontMetrics(s) {
  const key = fontOf(s);
  let m = metricCache.get(key);
  if (!m) {
    setup(s);
    const t = ctx.measureText('가Hg');
    m = { ascent: t.fontBoundingBoxAscent, descent: t.fontBoundingBoxDescent };
    metricCache.set(key, m);
  }
  return m;
}

export function clearMeasureCache() {
  widthCache.clear();
  metricCache.clear();
  measureGen++;
}
