// 요소 기하 계산. 요소는 { x, y, w, h, rotation(도) } — (x, y)는 회전 전 상자의 왼쪽 위, 회전 중심은 상자 중심.

export const rad = (deg) => (deg * Math.PI) / 180;
export const deg = (r) => (r * 180) / Math.PI;

export function rotatePt(p, a, c = { x: 0, y: 0 }) {
  const s = Math.sin(a), k = Math.cos(a);
  const dx = p.x - c.x, dy = p.y - c.y;
  return { x: c.x + dx * k - dy * s, y: c.y + dx * s + dy * k };
}

export const center = (e) => ({ x: e.x + e.w / 2, y: e.y + e.h / 2 });

// 회전을 적용한 네 꼭짓점(왼쪽 위부터 시계 방향)
export function corners(e) {
  const c = center(e), a = rad(e.rotation || 0);
  return [[e.x, e.y], [e.x + e.w, e.y], [e.x + e.w, e.y + e.h], [e.x, e.y + e.h]].map(([x, y]) => rotatePt({ x, y }, a, c));
}

// 축에 맞춘 외곽 상자 { x, y, w, h }
export function aabbOf(points) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const p of points) { x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y); x1 = Math.max(x1, p.x); y1 = Math.max(y1, p.y); }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}
export const aabb = (e) => aabbOf(corners(e));
export function union(boxes) {
  const pts = [];
  for (const b of boxes) pts.push({ x: b.x, y: b.y }, { x: b.x + b.w, y: b.y + b.h });
  return pts.length ? aabbOf(pts) : null;
}

// 페이지 좌표 → 요소 안 좌표(회전 전 상자 기준, 왼쪽 위 = 0,0)
export function toLocal(e, p) {
  const q = rotatePt(p, -rad(e.rotation || 0), center(e));
  return { x: q.x - e.x, y: q.y - e.y };
}
export function fromLocal(e, p) {
  return rotatePt({ x: e.x + p.x, y: e.y + p.y }, rad(e.rotation || 0), center(e));
}

export function contains(e, p) {
  const q = toLocal(e, p);
  return q.x >= 0 && q.y >= 0 && q.x <= e.w && q.y <= e.h;
}

export const intersects = (a, b) => a.x <= b.x + b.w && b.x <= a.x + a.w && a.y <= b.y + b.h && b.y <= a.y + a.h;

// 각도를 -180 < a <= 180으로
export function normAngle(a) {
  a %= 360;
  if (a > 180) a -= 360;
  if (a <= -180) a += 360;
  return a;
}

// 한 요소를 핸들로 리사이즈. 반대편 핸들(또는 Alt면 중심)을 고정한다.
// start: 시작 시 요소, hx/hy ∈ {-1,0,1}: 잡은 핸들, p: 포인터(페이지 좌표)
// opts: keepRatio(Shift), fromCenter(Alt), min(최소 크기)
export function resizeOne(start, hx, hy, p, { keepRatio = false, fromCenter = false, min = 1 } = {}) {
  const a = rad(start.rotation || 0);
  const c = center(start);
  const anchorLocal = fromCenter ? { x: 0, y: 0 } : { x: -hx * start.w / 2, y: -hy * start.h / 2 };
  const anchor = rotatePt({ x: c.x + anchorLocal.x, y: c.y + anchorLocal.y }, a, c);
  const q = rotatePt(p, -a, anchor); // 앵커 기준, 회전을 푼 포인터
  const k = fromCenter ? 2 : 1;
  let w = hx ? Math.max(min, hx * (q.x - anchor.x) * k) : start.w;
  let h = hy ? Math.max(min, hy * (q.y - anchor.y) * k) : start.h;
  if (keepRatio) {
    const r = start.w / start.h;
    if (hx && hy) { const s = Math.max(w / start.w, h / start.h); w = start.w * s; h = start.h * s; }
    else if (hx) h = w / r;
    else w = h * r;
  }
  return anchoredBox(start, hx, hy, w, h, fromCenter);
}

// 크기 w×h인 새 상자. start에서 잡은 핸들(hx, hy)의 반대편(fromCenter면 중심)이 같은 자리에 남는다.
export function anchoredBox(start, hx, hy, w, h, fromCenter = false) {
  const a = rad(start.rotation || 0);
  const c = center(start);
  if (fromCenter) return { x: c.x - w / 2, y: c.y - h / 2, w, h };
  const anchor = rotatePt({ x: c.x - hx * start.w / 2, y: c.y - hy * start.h / 2 }, a, c);
  const nc = rotatePt({ x: anchor.x + hx * w / 2, y: anchor.y + hy * h / 2 }, a, anchor);
  return { x: nc.x - w / 2, y: nc.y - h / 2, w, h };
}

// 여러 요소(잎)를 상자 b0 → b1로 늘리기(앵커 기준 배율). 회전된 요소는 자기 축 방향 배율로 근사.
export function scaleLeaf(e, b0, b1) {
  const sx = b1.w / (b0.w || 1), sy = b1.h / (b0.h || 1);
  const c = center(e);
  const nc = { x: b1.x + (c.x - b0.x) * sx, y: b1.y + (c.y - b0.y) * sy };
  const a = rad(e.rotation || 0), cs = Math.cos(a), sn = Math.sin(a);
  const w = e.w * Math.hypot(cs * sx, sn * sy);
  const h = e.h * Math.hypot(sn * sx, cs * sy);
  return { x: nc.x - w / 2, y: nc.y - h / 2, w, h };
}

// 잎 요소를 점 c 둘레로 da(도)만큼 회전
export function rotateLeaf(e, c, da) {
  const nc = rotatePt(center(e), rad(da), c);
  return { x: nc.x - e.w / 2, y: nc.y - e.h / 2, rotation: normAngle((e.rotation || 0) + da) };
}
