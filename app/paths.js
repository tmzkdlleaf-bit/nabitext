// 패스(베지어 경로) 도우미. 이 앱이 만드는 경로는 절대 좌표 M·L·C·Z 명령만 쓴다.
// 요소의 패스는 요소 안 좌표(pw×ph 기준)로 저장하고, 그릴 때 지금 크기(w×h)에 맞춰 늘린다(scaleD).

import { r3 } from './util.js';

// d → [{ c: 'M'|'L'|'C'|'Z', p: [x, y, …] }]. 소문자(상대 좌표)·H·V·Q도 읽어 절대 좌표 M·L·C로 바꾼다.
export function parseD(d) {
  const toks = String(d || '').match(/[a-zA-Z]|-?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?/g) || [];
  const out = [];
  let i = 0, cmd = null, cx = 0, cy = 0, sx = 0, sy = 0;
  const num = () => +toks[i++];
  while (i < toks.length) {
    if (/[a-zA-Z]/.test(toks[i])) cmd = toks[i++];
    const rel = cmd === cmd.toLowerCase();
    const C = cmd.toUpperCase();
    const ox = rel ? cx : 0, oy = rel ? cy : 0;
    if (C === 'Z') { out.push({ c: 'Z', p: [] }); cx = sx; cy = sy; continue; }
    if (C === 'M') { cx = ox + num(); cy = oy + num(); sx = cx; sy = cy; out.push({ c: 'M', p: [cx, cy] }); cmd = rel ? 'l' : 'L'; continue; }
    if (C === 'L') { cx = ox + num(); cy = oy + num(); out.push({ c: 'L', p: [cx, cy] }); continue; }
    if (C === 'H') { cx = ox + num(); out.push({ c: 'L', p: [cx, cy] }); continue; }
    if (C === 'V') { cy = oy + num(); out.push({ c: 'L', p: [cx, cy] }); continue; }
    if (C === 'C') { const p = [ox + num(), oy + num(), ox + num(), oy + num(), ox + num(), oy + num()]; out.push({ c: 'C', p }); cx = p[4]; cy = p[5]; continue; }
    if (C === 'Q') { // 2차 → 3차
      const qx = ox + num(), qy = oy + num(), x = ox + num(), y = oy + num();
      out.push({ c: 'C', p: [cx + (qx - cx) * 2 / 3, cy + (qy - cy) * 2 / 3, x + (qx - x) * 2 / 3, y + (qy - y) * 2 / 3, x, y] });
      cx = x; cy = y; continue;
    }
    i++; // 모르는 명령(A 등)은 건너뜀 — 이 앱은 만들지 않는다
  }
  return out;
}
export const buildD = (segs) => segs.map((s) => s.c + (s.p.length ? s.p.map(r3).join(' ') : '')).join('');

// 모든 점에 f([x, y]) → [x', y'] (아핀 변환이면 베지어 모양이 정확히 보존된다)
export function mapD(d, f) {
  return buildD(parseD(d).map((s) => {
    const p = [];
    for (let k = 0; k < s.p.length; k += 2) p.push(...f([s.p[k], s.p[k + 1]]));
    return { c: s.c, p };
  }));
}
export const scaleD = (d, sx, sy) => (sx === 1 && sy === 1 ? d : mapD(d, ([x, y]) => [x * sx, y * sy]));
export const translateD = (d, dx, dy) => mapD(d, ([x, y]) => [x + dx, y + dy]);

// 경로의 외곽 상자(곡선은 촘촘히 표본을 찍어 계산)
export function boundsD(d) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  const add = (x, y) => { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); };
  let cx = 0, cy = 0;
  for (const s of parseD(d)) {
    if (s.c === 'M' || s.c === 'L') { cx = s.p[0]; cy = s.p[1]; add(cx, cy); }
    if (s.c === 'C') {
      const [a, b, c, e, x, y] = s.p;
      for (let t = 0; t <= 1; t += 1 / 32) {
        const u = 1 - t;
        add(u * u * u * cx + 3 * u * u * t * a + 3 * u * t * t * c + t * t * t * x, u * u * u * cy + 3 * u * u * t * b + 3 * u * t * t * e + t * t * t * y);
      }
      cx = x; cy = y;
    }
  }
  return x0 === Infinity ? { x: 0, y: 0, w: 0, h: 0 } : { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

// ---------- 도형 → 경로 ----------
const K = 0.5522847498; // 원을 3차 베지어 4개로 그릴 때의 제어점 비율
export function ellipseD(cx, cy, rx, ry, reverse = false) {
  const kx = rx * K, ky = ry * K;
  const f = [
    `M${r3(cx + rx)} ${r3(cy)}`,
    `C${r3(cx + rx)} ${r3(cy + ky)} ${r3(cx + kx)} ${r3(cy + ry)} ${r3(cx)} ${r3(cy + ry)}`,
    `C${r3(cx - kx)} ${r3(cy + ry)} ${r3(cx - rx)} ${r3(cy + ky)} ${r3(cx - rx)} ${r3(cy)}`,
    `C${r3(cx - rx)} ${r3(cy - ky)} ${r3(cx - kx)} ${r3(cy - ry)} ${r3(cx)} ${r3(cy - ry)}`,
    `C${r3(cx + kx)} ${r3(cy - ry)} ${r3(cx + rx)} ${r3(cy - ky)} ${r3(cx + rx)} ${r3(cy)}Z`,
  ].join('');
  return reverse ? reverseD(f) : f;
}
// 경로 글자용 타원: 9시 방향에서 시작해 위쪽을 지나 시계 방향으로 돈다(시작 위치 25% = 맨 위, 글자가 바로 선다)
export function ellipseTextD(cx, cy, rx, ry) {
  const kx = rx * K, ky = ry * K;
  return [
    `M${r3(cx - rx)} ${r3(cy)}`,
    `C${r3(cx - rx)} ${r3(cy - ky)} ${r3(cx - kx)} ${r3(cy - ry)} ${r3(cx)} ${r3(cy - ry)}`,
    `C${r3(cx + kx)} ${r3(cy - ry)} ${r3(cx + rx)} ${r3(cy - ky)} ${r3(cx + rx)} ${r3(cy)}`,
    `C${r3(cx + rx)} ${r3(cy + ky)} ${r3(cx + kx)} ${r3(cy + ry)} ${r3(cx)} ${r3(cy + ry)}`,
    `C${r3(cx - kx)} ${r3(cy + ry)} ${r3(cx - rx)} ${r3(cy + ky)} ${r3(cx - rx)} ${r3(cy)}Z`,
  ].join('');
}
export function rectD(w, h, r = 0) {
  r = Math.max(0, Math.min(r, w / 2, h / 2));
  if (!r) return `M0 0L${r3(w)} 0L${r3(w)} ${r3(h)}L0 ${r3(h)}Z`;
  const k = r * (1 - K);
  return `M${r3(r)} 0L${r3(w - r)} 0C${r3(w - k)} 0 ${r3(w)} ${r3(k)} ${r3(w)} ${r3(r)}L${r3(w)} ${r3(h - r)}C${r3(w)} ${r3(h - k)} ${r3(w - k)} ${r3(h)} ${r3(w - r)} ${r3(h)}` +
    `L${r3(r)} ${r3(h)}C${r3(k)} ${r3(h)} 0 ${r3(h - k)} 0 ${r3(h - r)}L0 ${r3(r)}C0 ${r3(k)} ${r3(k)} 0 ${r3(r)} 0Z`;
}
// 정다각형(sides개 꼭짓점) / 별(inner = 안쪽 꼭짓점 반지름 비율). 위쪽 꼭짓점부터 시계 방향, w×h 상자에 내접
export function polygonD(w, h, sides = 5, inner = null) {
  const n = Math.max(3, Math.round(sides));
  const pts = [];
  const count = inner ? n * 2 : n;
  for (let i = 0; i < count; i++) {
    const a = -Math.PI / 2 + (i * 2 * Math.PI) / count;
    const k = inner && i % 2 ? inner : 1;
    pts.push([w / 2 + (Math.cos(a) * w / 2) * k, h / 2 + (Math.sin(a) * h / 2) * k]);
  }
  return 'M' + pts.map(([x, y]) => `${r3(x)} ${r3(y)}`).join('L') + 'Z';
}
// 도넛: 바깥 원 + 안쪽 원(반대 방향, even-odd로 구멍)
export const donutD = (w, h, inner = 0.45) => ellipseD(w / 2, h / 2, w / 2, h / 2) + ellipseD(w / 2, h / 2, (w / 2) * inner, (h / 2) * inner, true);

export function reverseD(d) {
  // 한 개의 닫힌 하위 경로(M … Z)를 반대 방향으로
  const segs = parseD(d).filter((s) => s.c !== 'Z');
  const pts = [];
  let cur = null;
  for (const s of segs) {
    if (s.c === 'M') { cur = [s.p[0], s.p[1]]; continue; }
    pts.push({ from: cur, s });
    cur = [s.p[s.p.length - 2], s.p[s.p.length - 1]];
  }
  if (!pts.length) return d;
  let out = `M${r3(cur[0])} ${r3(cur[1])}`;
  for (let i = pts.length - 1; i >= 0; i--) {
    const { from, s } = pts[i];
    if (s.c === 'L') out += `L${r3(from[0])} ${r3(from[1])}`;
    else out += `C${r3(s.p[2])} ${r3(s.p[3])} ${r3(s.p[0])} ${r3(s.p[1])} ${r3(from[0])} ${r3(from[1])}`;
  }
  return out + 'Z';
}

// 요소의 외곽선 경로(요소 안 좌표, 지금 w×h 기준). 마스크·글상자 모양·경로 글자 만들 때 쓴다.
export function outlineOf(n) {
  if (n.type === 'path' || n.type === 'pathText') return scaleD(n.d, n.w / (n.pw || n.w || 1), n.h / (n.ph || n.h || 1));
  if (n.type === 'shape') {
    if (n.shape === 'ellipse') return ellipseD(n.w / 2, n.h / 2, n.w / 2, n.h / 2);
    if (n.shape === 'polygon') return polygonD(n.w, n.h, n.sides || 5);
    if (n.shape === 'star') return polygonD(n.w, n.h, n.sides || 5, n.inner || 0.5);
    return rectD(n.w, n.h, n.radius || 0);
  }
  return rectD(n.w, n.h);
}

// ---------- 펜 도구의 점 목록 ↔ 경로 ----------
// 점: { x, y, i: [x, y] | null (들어오는 핸들), o: [x, y] | null (나가는 핸들) }
export function nodesToD(nodes, closed) {
  if (!nodes.length) return '';
  let d = `M${r3(nodes[0].x)} ${r3(nodes[0].y)}`;
  const seg = (a, b) => (!a.o && !b.i ? `L${r3(b.x)} ${r3(b.y)}`
    : `C${r3((a.o || [a.x, a.y])[0])} ${r3((a.o || [a.x, a.y])[1])} ${r3((b.i || [b.x, b.y])[0])} ${r3((b.i || [b.x, b.y])[1])} ${r3(b.x)} ${r3(b.y)}`);
  for (let k = 1; k < nodes.length; k++) d += seg(nodes[k - 1], nodes[k]);
  if (closed && nodes.length > 2) d += seg(nodes[nodes.length - 1], nodes[0]) + 'Z';
  return d;
}
// 이 앱이 만든 경로(하위 경로 하나) → 점 목록
export function dToNodes(d) {
  const segs = parseD(d);
  const nodes = [];
  let closed = false;
  for (const s of segs) {
    if (s.c === 'M') nodes.push({ x: s.p[0], y: s.p[1], i: null, o: null });
    else if (s.c === 'L') nodes.push({ x: s.p[0], y: s.p[1], i: null, o: null });
    else if (s.c === 'C') {
      const prev = nodes[nodes.length - 1];
      if (prev && (s.p[0] !== prev.x || s.p[1] !== prev.y)) prev.o = [s.p[0], s.p[1]];
      nodes.push({ x: s.p[4], y: s.p[5], i: s.p[2] !== s.p[4] || s.p[3] !== s.p[5] ? [s.p[2], s.p[3]] : null, o: null });
    } else if (s.c === 'Z') closed = true;
  }
  // 닫힌 경로의 마지막 구간이 첫 점으로 돌아오는 곡선이면 첫 점과 합친다
  if (closed && nodes.length > 1) {
    const a = nodes[0], b = nodes[nodes.length - 1];
    if (Math.abs(a.x - b.x) < 1e-6 && Math.abs(a.y - b.y) < 1e-6) { a.i = b.i; nodes.pop(); }
  }
  return { nodes, closed };
}
