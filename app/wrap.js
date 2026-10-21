// 글이 피해 가기(감싸기): 사진·도형에 wrap을 켜면 같은 장의 글상자가 그 자리를 비우고 둘레로 흐른다.
//   요소.wrap = { shape: 'box' | 'ellipse' | 'outline', gap(px), side: 'both' | 'jump' }
//     box      요소 상자(돌린 상자 그대로)
//     ellipse  상자에 꼭 맞는 원(타원)
//     outline  그림 윤곽선: 이미지는 투명한 곳을 빼고(투명 배경 PNG), 도형·패스는 그 모양대로, 도형 마스크를 씌운 이미지는 마스크 모양
//     gap      피하는 모양과 글 사이 거리
//     side     both = 양옆으로 흐름, jump = 그 높이에서는 글을 놓지 않음(위아래로만)
//   사진을 옮기거나 크기·회전을 바꾸면 글이 바로 다시 흐른다(글상자 영역을 다시 계산). 글상자 자신과 다른 글상자는 피하지 않는다.
// 여기서는 글상자 하나에 대한 '피할 것' 목록을 만든다. 실제 마스크 계산은 src/region.js(buildRegion의 opts.exclude).

import * as M from './model.js';
import { shapePathD } from './render-el.js';
import * as Pth from './paths.js';
import { aabb } from './geom.js';

export const WRAP_TYPES = new Set(['image', 'shape', 'path']);
export const WRAP_SHAPES = [['box', '사진 상자(네모)'], ['ellipse', '원'], ['outline', '그림 윤곽선']];
export const WRAP_SIDES = [['both', '양옆으로 흐름'], ['jump', '위아래로만(옆은 비움)']];
const num = (v, d = 0) => (Number.isFinite(+v) ? +v : d);
export const hasWrap = (n) => !!(n && n.wrap && WRAP_TYPES.has(n.type));
export function cleanWrap(w) {
  if (!w || typeof w !== 'object') return null;
  return { shape: ['box', 'ellipse', 'outline'].includes(w.shape) ? w.shape : 'box', gap: Math.max(0, Math.min(500, num(w.gap, 16))), side: w.side === 'jump' ? 'jump' : 'both' };
}

// 요소 좌표(0..w, 0..h) → 장 좌표 행렬
const toPage = (n) => new DOMMatrix().translate(num(n.x) + num(n.w) / 2, num(n.y) + num(n.h) / 2).rotate(num(n.rotation)).translate(-num(n.w) / 2, -num(n.h) / 2);
const r = (v) => Math.round(v * 100) / 100;

// 글상자 t가 피할 것들. elements: t가 놓인 장(또는 공통 장)의 요소 트리, images: src → 불러온 이미지(없으면 불러오는 중)
// 반환 { list(region.js opts.exclude), key(영역 다시 계산 판단용 글), pending(아직 불러오지 않은 이미지 주소들) }
export function wrapObstacles(t, elements, images) {
  const out = { list: [], key: '', pending: [] };
  if (!t || !elements) return out;
  const tb = aabb(t);
  const toFrame = toPage(t).inverse();
  const keys = [];
  M.walk(elements, (o, _p, _i, anc) => {
    if (o === t || !hasWrap(o) || M.isHidden(o, anc)) return;
    const w = cleanWrap(o.wrap);
    const ob = aabb(o);
    const g = w.gap;
    if (ob.x - g > tb.x + tb.w || ob.x + ob.w + g < tb.x || ob.y - g > tb.y + tb.h || ob.y + ob.h + g < tb.y) return; // 겹치지 않음
    const m = toFrame.multiply(toPage(o));
    const ow = num(o.w), oh = num(o.h);
    const d = { m: [m.a, m.b, m.c, m.d, m.e, m.f], w: ow, h: oh, shape: w.shape, gap: g, side: w.side };
    let k = '';
    if (w.shape === 'outline') {
      if (o.type === 'shape') d.d = shapePathD(o, ow, oh, Math.max(0, num(o.strokeWidth)));
      else if (o.type === 'path') d.d = Pth.scaleD(o.d || '', ow / (num(o.pw) || ow || 1), oh / (num(o.ph) || oh || 1));
      else if (o.type === 'image') {
        if (o.mask?.kind === 'shape' && o.mask.d) d.clip = Pth.scaleD(o.mask.d, ow / (num(o.mask.pw) || ow || 1), oh / (num(o.mask.ph) || oh || 1));
        const img = images?.get(o.src);
        if (img) {
          d.image = img;
          const c = o.crop;
          if (c && c.w > 0 && c.h > 0) { const W = ow / c.w, H = oh / c.h; d.drawRect = { x: -c.x * W, y: -c.y * H, w: W, h: H }; }
          else d.fit = ['contain', 'cover', 'fill'].includes(o.fit) ? o.fit : 'fill';
        } else if (img === undefined) { out.pending.push(o.src); d.shape = 'box'; }
        else d.shape = 'box'; // 이미지를 못 읽음 → 상자
        k = `${o.src}|${img ? 1 : 0}|${JSON.stringify([o.crop, o.fit, o.mask?.d])}`;
      }
      if (o.type !== 'image') k = d.d;
    }
    keys.push(JSON.stringify([o.id, d.m.map(r), r(ow), r(oh), d.shape, g, w.side]) + k);
    out.list.push(d);
  });
  out.key = keys.join(';');
  return out;
}
