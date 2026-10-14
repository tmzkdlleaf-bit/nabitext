// 공통 장(마스터): 프로젝트에 하나. 공통 장의 요소는 모든 장의 맨 뒤에 깔린다(장마다 "공통 요소 보이기"를 끌 수 있음).
// 공통 장 글상자의 {쪽}·{전체쪽}은 그 장의 쪽 번호·마지막 쪽 번호로 바뀐다(공통 장 자체를 편집할 때는 글자 그대로 보임).
//   쪽 번호 = 장 순서 + 시작 번호 - 1 (project.pageStart, 기본 1)
// 화면의 공통 층은 편집할 수 없다(선택·클릭은 그 장의 요소만). 고치려면 장 목록의 "공통 장"으로 간다.

import * as M from './model.js';
import { buildRegion } from '../src/region.js';
import { layoutChain } from '../src/layout.js';
import { renderFrame } from '../src/render.js';
import { measureGen } from '../src/measure.js';
import { proxyGen } from '../src/image-src.js';
import { boxCss, contentOf, textFrame } from './render-el.js';

export const TOKENS = { page: '{쪽}', total: '{전체쪽}' };
export const MASTER_KIND = 'master';
export const isMaster = (page) => page?.kind === MASTER_KIND;

export function newMaster(like = {}) {
  return { ...M.newPage({ w: like.w, h: like.h, background: 'transparent' }), name: '공통 장', kind: MASTER_KIND };
}

// 문서 JSON의 글자 안 {쪽}·{전체쪽}을 숫자로(새 객체). 바꿀 것이 없으면 원래 객체
export function fillTokens(doc, num, total) {
  if (!doc) return doc;
  const text = JSON.stringify(doc);
  if (!text.includes(TOKENS.page) && !text.includes(TOKENS.total)) return doc;
  const walk = (n) => {
    if (n.type === 'text' && typeof n.text === 'string') return { ...n, text: n.text.split(TOKENS.total).join(String(total)).split(TOKENS.page).join(String(num)) };
    return n.content ? { ...n, content: n.content.map(walk) } : n;
  };
  return walk(doc);
}

// 장의 쪽 번호
export function pageNumber(pages, page, start = 1) {
  const i = pages.indexOf(page);
  return { num: i < 0 ? 0 : i + start, total: pages.length + start - 1 };
}

// 공통 층 DOM 만들기. ctx: { docOf, images, presets, assets(이미지 크기), loadImage }
// 공통 장 글상자는 한 글상자 = 한 문서(공통 장 안에서만 이어짐). 이어진 글상자는 순서대로 흘린다.
export function buildMasterLayer(master, { num, total }, ctx) {
  const root = document.createElement('div');
  root.className = 'pv-master';
  root.style.cssText = 'position:absolute;left:0;top:0;width:100%;height:100%;pointer-events:none;';
  const stories = M.storyFrames(master.elements);
  const placed = new Map(); // 글상자 id → 그 글상자의 배치 결과 DOM
  for (const [sid, list] of stories) {
    const head = list[0];
    const specs = list.map((n) => textFrame(n, ctx.images));
    for (const sp of specs) if (sp.pending) ctx.loadImage?.(sp.pending);
    const frames = specs.map((sp) => ({ frame: { ...sp.frame, style: head.style || {}, presets: ctx.presets, autoShrink: !!head.autoShrink, minScale: head.minScale ?? 0.5 },
      built: buildRegion(sp.frame.w, sp.frame.h, sp.frame.source, sp.opts) }));
    const doc = fillTokens(ctx.docOf?.(sid) ?? head.doc ?? M.emptyDoc(), num, total);
    const ch = layoutChain(doc, frames.map((f) => ({ frame: f.frame, region: f.built.region })), ctx.assets, { autoShrink: !!head.autoShrink, minScale: head.minScale ?? 0.5 });
    list.forEach((n, k) => {
      const el = document.createElement('div');
      renderFrame(el, frames[k].frame, frames[k].built, ch.results[k], { debug: false });
      placed.set(n.id, el);
    });
  }
  M.walk(master.elements, (n, _p, _i, anc) => {
    if (n.type === 'group' || M.isHidden(n, anc)) return;
    const el = document.createElement('div');
    el.style.cssText = boxCss(n);
    if (n.type === 'text') { const t = placed.get(n.id); if (t) el.appendChild(t); } else { const c = contentOf(n); if (c) el.appendChild(c); }
    root.appendChild(el);
  });
  return root;
}

// 화면용: 내용이 같으면 전에 만든 층을 그대로 쓴다
export function masterKey(master, pn, ctx) {
  return JSON.stringify([M.serializePage(master, ctx.docOf, new Set([...M.storyFrames(master.elements).values()].map((l) => l[0].id))).elements, pn.num, pn.total, ctx.presetsKey, measureGen, proxyGen, ctx.images.size]);
}
