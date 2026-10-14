// 검증: 엔진 계산값과 실제 DOM 렌더 결과를 대조한다.
//  - 폭/위치 오차: 캔버스 측정값 vs DOM getBoundingClientRect
//  - 영역 이탈: 렌더된 글자 박스가 마스크 밖으로 나간 픽셀 수, 구간 오른쪽 끝 초과 수
//  - 텍스트 누락: 배치된 글자(공백 제외)가 원문의 앞부분과 정확히 일치하는지

import { layout, docText } from './layout.js';

export function verify(el, frame, built, result, doc) {
  const fr = el.getBoundingClientRect();
  const region = built.region;
  let maxDw = 0, maxDx = 0, maxDy = 0, outside = 0, overrun = 0, n = 0;

  for (const sp of el.querySelectorAll('.piece')) {
    const ln = result.lines[+sp.dataset.l];
    const p = ln.pieces[+sp.dataset.p];
    const r = sp.getBoundingClientRect();
    const x = r.left - fr.left, y = r.top - fr.top;
    if (!p.space) maxDw = Math.max(maxDw, Math.abs(r.width - p.w));
    maxDx = Math.max(maxDx, Math.abs(x - p.x));
    maxDy = Math.max(maxDy, Math.abs(y - p.top));
    if (x + r.width > ln.x1 + 0.5) overrun++;
    for (let xx = Math.ceil(x); xx < x + r.width - 0.5; xx++) {
      for (const yy of [y + 1, y + r.height / 2, y + r.height - 1]) if (!region.contains(xx, yy)) outside++;
    }
    n++;
  }

  const strip = (t) => t.replace(/\s+/g, '');
  let kinsoku = 0;
  for (const ln of result.lines) {
    const ps = ln.pieces.filter((p) => !p.space);
    if (!ps.length) continue;
    if (/^[,.!?:;)\]}」』》〉〕…、。，．！？：；％%’”~]/.test(ps[0].text)) kinsoku++;
    if (/[(\[{「『《〈〔‘“]$/.test(ps[ps.length - 1].text)) kinsoku++;
  }
  const src = strip(docText(doc));
  const placed = strip(result.lines.flatMap((l) => l.pieces.map((p) => p.text)).join(''));
  const textOk = result.overflow === null ? placed === src : src.startsWith(placed) && placed.length < src.length;

  // 캐시가 찬 상태에서 재배치 1회 비용(키 입력 1회 상황의 상한 근사)
  const iters = 30;
  const t0 = performance.now();
  for (let i = 0; i < iters; i++) layout(doc, frame, region, result.assets);
  const relayoutMs = (performance.now() - t0) / iters;

  return {
    pieces: n,
    lines: result.lines.length,
    maxWidthErrPx: +maxDw.toFixed(3),
    maxXErrPx: +maxDx.toFixed(3),
    maxYErrPx: +maxDy.toFixed(3),
    pixelsOutsideMask: outside,
    intervalOverruns: overrun,
    textIntact: textOk,
    kinsokuViolations: kinsoku,
    placedChars: placed.length,
    sourceChars: src.length,
    overflow: result.overflow !== null,
    firstLayoutMs: +result.ms.toFixed(2),
    relayoutMs: +relayoutMs.toFixed(2),
  };
}
