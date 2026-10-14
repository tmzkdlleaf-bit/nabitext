// 레이아웃 엔진: ProseMirror 호환 문서 JSON + Region → 절대 위치 조각(piece) 목록.
// 위치(from/to)는 ProseMirror 문서 위치 규칙을 따른다(2단계 커서 매핑에서 사용).

import { textWidth, fontMetrics, measureGen } from './measure.js';
import { srcReady, srcDims } from './image-src.js';

export const BASE_STYLE = Object.freeze({
  fontFamily: '"Noto Sans KR", "Noto Sans CJK KR", "Malgun Gothic", sans-serif',
  fontSize: 18,
  fontWeight: 400,
  italic: false,
  color: '#1f1f1f',
  lineHeight: 1.6,
  letterSpacing: 0,
  underline: null,
  strike: null,
  overline: null,
  highlight: null,
  stroke: null,
  shadow: null,
  gradient: null,
});

const deco = (a) => ({ style: a.style || 'solid', color: a.color || null, thickness: a.thickness ?? null });

const MARKS = {
  bold: (s) => { s.fontWeight = 700; },
  weight: (s, a) => { s.fontWeight = a.value; },
  italic: (s) => { s.italic = true; },
  underline: (s, a) => { s.underline = deco(a); },
  strike: (s, a) => { s.strike = deco(a); },
  overline: (s, a) => { s.overline = deco(a); },
  color: (s, a) => { s.color = a.value; },
  highlight: (s, a) => { s.highlight = a.value; },
  size: (s, a) => { s.fontSize = a.value; },
  font: (s, a) => { s.fontFamily = a.value; },
  spacing: (s, a) => { s.letterSpacing = a.value; },
  lineHeight: (s, a) => { s.lineHeight = a.value; },
  stroke: (s, a) => { s.stroke = { width: a.width, color: a.color }; },
  shadow: (s, a) => { s.shadow = a.value; },
  gradient: (s, a) => { s.gradient = a.value; },
};

// 자동 축소 배율(layout 한 번 도는 동안만 바뀐다). 크기·자간 마크에도 같은 배율을 곱한다.
let SCALE = 1;
let PRESETS = null; // 글자 스타일 프리셋(layout 한 번 도는 동안 frame.presets)
function resolveStyle(base, marks) {
  const s = { ...base };
  for (const m of marks || []) {
    if (m.type === 'charStyle') { const st = PRESETS?.[m.attrs?.id]?.style; if (st) Object.assign(s, scaled(st)); continue; }
    MARKS[m.type]?.(s, m.attrs || {});
    if (SCALE !== 1 && m.type === 'size') s.fontSize = m.attrs.value * SCALE;
    if (SCALE !== 1 && m.type === 'spacing') s.letterSpacing = m.attrs.value * SCALE;
  }
  return s;
}
function scaled(st) {
  if (!st || SCALE === 1) return st;
  const o = { ...st };
  if (o.fontSize != null) o.fontSize *= SCALE;
  if (o.letterSpacing) o.letterSpacing *= SCALE;
  return o;
}

// 금칙: 줄 머리에 올 수 없는 문자 / 줄 끝에 올 수 없는 문자
const NO_START = /^[,.!?:;)\]}」』》〉〕…、。，．！？：；％%’”~]/;
const NO_END = /^[(\[{「『《〈〔‘“]+$/;

const WORDS = new Intl.Segmenter('ko', { granularity: 'word' });
const GRAPHEMES = new Intl.Segmenter('ko', { granularity: 'grapheme' });

const STEP = 2; // 들어갈 구간이 없을 때 아래로 내려가는 단위(px)

const sizeMemo = new WeakMap();
export function nodeSize(node) {
  if (node.type === 'text') return node.text.length;
  if (node.type === 'hard_break' || node.type === 'image') return 1;
  let s = sizeMemo.get(node);
  if (s !== undefined) return s;
  s = 2;
  for (const c of node.content || []) s += nodeSize(c);
  sizeMemo.set(node, s);
  return s;
}

// ---- 문단 준비: 문자열 평탄화 → 단어 분절 → 스타일 경계 분할 → 금칙 → 측정 → 묶음(group)
function prepareParagraph(node, pbase) {
  let str = '';
  const runs = [];
  for (const c of node.content || []) {
    if (c.type === 'text') {
      runs.push({ start: str.length, end: str.length + c.text.length, style: resolveStyle(pbase, c.marks) });
      str += c.text;
    } else if (c.type === 'hard_break') {
      runs.push({ start: str.length, end: str.length + 1, style: pbase, brk: true });
      str += '\n';
    }
  }

  const units = [];
  let ri = 0;
  for (const { segment, index } of WORDS.segment(str)) {
    const end = index + segment.length;
    while (runs[ri].end <= index) ri++;
    if (runs[ri].brk) {
      units.push({ brk: true, text: '\n', from: index, to: end, style: runs[ri].style });
      continue;
    }
    const space = /^\s+$/.test(segment);
    let s = index;
    let first = true;
    let rj = ri;
    while (s < end) {
      while (runs[rj].end <= s) rj++;
      const e = Math.min(end, runs[rj].end);
      units.push({ text: str.slice(s, e), from: s, to: e, style: runs[rj].style, space, glue: !first });
      first = false;
      s = e;
    }
  }

  for (let i = 1; i < units.length; i++) {
    const u = units[i], p = units[i - 1];
    if (u.space || u.brk || p.space || p.brk) continue;
    if (NO_START.test(u.text) || NO_END.test(p.text)) u.glue = true;
  }

  for (const u of units) measureUnit(u);

  const groups = [];
  let g = null;
  for (const u of units) {
    if (u.brk) { groups.push({ brk: true, units: [u], width: 0 }); g = null; continue; }
    if (u.space) { groups.push({ space: true, units: [u], width: u.w }); g = null; continue; }
    if (g && u.glue) { g.units.push(u); g.width += u.w; }
    else { g = { units: [u], width: u.w }; groups.push(g); }
  }
  return groups;
}

function measureUnit(u) {
  u.w = u.brk ? 0 : textWidth(u.text, u.style);
  const m = fontMetrics(u.style);
  u.A = m.ascent;
  u.D = m.descent;
  u.L = u.style.fontSize * u.style.lineHeight;
}

// 한 구간보다 긴 단어는 글자(grapheme) 단위로 쪼갠다. 금칙은 다시 적용해 문장부호가 떨어지지 않게 한다.
function splitGraphemes(g) {
  const us = [];
  for (const u of g.units) {
    for (const { segment, index } of GRAPHEMES.segment(u.text)) {
      const nu = { ...u, text: segment, from: u.from + index, to: u.from + index + segment.length, glue: false };
      measureUnit(nu);
      us.push(nu);
    }
  }
  for (let i = 1; i < us.length; i++) if (NO_START.test(us[i].text) || NO_END.test(us[i - 1].text)) us[i].glue = true;
  const out = [];
  for (const u of us) {
    const last = out[out.length - 1];
    if (last && u.glue) { last.units.push(u); last.width += u.w; }
    else out.push({ units: [u], width: u.w, fine: true });
  }
  return out;
}

const graphemeCount = (g) => {
  let n = 0;
  for (const u of g.units) for (const _ of GRAPHEMES.segment(u.text)) if (++n > 1) return n;
  return n;
};

// CSS 인라인 박스 규칙: 줄 박스 = max(A + 반행간) + max(D + 반행간)
function lineMetrics(units, fallback) {
  let up = 0, down = 0, any = false;
  for (const u of units) {
    if (u.brk) continue;
    const half = (u.L - (u.A + u.D)) / 2;
    up = Math.max(up, u.A + half);
    down = Math.max(down, u.D + half);
    any = true;
  }
  if (!any) return fallback;
  return { baseline: up, lh: up + down };
}

function defaultMetrics(style) {
  const m = fontMetrics(style);
  const L = style.fontSize * style.lineHeight;
  const half = (L - (m.ascent + m.descent)) / 2;
  return { baseline: m.ascent + half, lh: L, ascent: m.ascent, descent: m.descent };
}

// ---- 한 띠의 구간들을 좌→우로 채운다
// maxW(): 현재 줄부터 두 줄 높이 이내에서 가장 넓은 구간 폭(필요할 때만 계산).
// 이보다 긴 단어만 글자 단위로 쪼갠다. 짧은 단어는 다음 구간/다음 줄로 넘긴다.
function fillBand(ints, groups, gi, indent, maxW) {
  let maxWv;
  const frags = [];
  let indentUsed = false;
  for (const [a, b] of ints) {
    if (gi >= groups.length) break;
    const ind = !indentUsed && indent ? indent : 0;
    const avail = b - a - ind;
    if (avail <= 0) continue;
    const save = gi;
    while (gi < groups.length && groups[gi].space) gi++;
    const units = [];
    let w = 0, content = false, endBrk = false;
    while (gi < groups.length) {
      const g = groups[gi];
      if (g.brk) { gi++; endBrk = true; break; }
      if (g.space) { units.push(...g.units); w += g.width; gi++; continue; }
      if (w + g.width <= avail + 0.01) { units.push(...g.units); w += g.width; gi++; content = true; continue; }
      if (!content && !g.fine && g.width > (maxWv ??= maxW()) && graphemeCount(g) > 1) { groups.splice(gi, 1, ...splitGraphemes(g)); continue; }
      break;
    }
    while (units.length && units[units.length - 1].space) units.pop();
    if (units.length || endBrk) {
      frags.push({ x0: a, x1: b, indent: ind, units, endBrk, brkFrom: endBrk ? groups[gi - 1].units[0].from : null });
      indentUsed = true;
    } else {
      gi = save; // 이 구간에는 아무것도 못 넣음 → 다음 구간에서 다시
    }
  }
  return { frags, gi };
}

function bandHeight(frags, dm) {
  let lh = 0;
  for (const f of frags) lh = Math.max(lh, lineMetrics(f.units, dm).lh);
  return lh || dm.lh;
}

function commitBand(res, y, lh, align, paraEnd, dm, cs, out) {
  res.frags.forEach((f, k) => {
    if (!f.units.length) {
      // 강제 줄바꿈만 있는 빈 줄: 커서 위치만 기록
      out.lines.push(emptyLine(f.x0 + f.indent, f.x1, y, lh, align, dm, cs + f.brkFrom, f.x0, f.x1));
      return;
    }
    const last = paraEnd && k === res.frags.length - 1;
    const avail = f.x1 - f.x0 - f.indent;
    let w = 0, spaces = 0;
    for (const u of f.units) { w += u.w; if (u.space) spaces++; }
    let off = 0, extra = 0;
    if (align === 'center') off = (avail - w) / 2;
    else if (align === 'right') off = avail - w;
    else if (align === 'justify' && !last && !f.endBrk && spaces) extra = (avail - w) / spaces;
    off = Math.max(0, off);

    const lm = lineMetrics(f.units, dm);
    let x = f.x0 + f.indent + off;
    const pieces = [];
    for (const u of f.units) {
      if (u.brk) continue;
      const adv = u.w + (u.space ? extra : 0);
      pieces.push({
        text: u.text, style: u.style, space: !!u.space,
        x, w: u.w, adv, top: y + lm.baseline - u.A, h: u.A + u.D,
        from: cs + u.from, to: cs + u.to,
      });
      x += adv;
    }
    const first = f.units[0], lastU = f.units[f.units.length - 1];
    out.lines.push({
      x0: f.x0, x1: f.x1, y, h: lh, baseline: y + lm.baseline, pieces,
      from: first ? cs + first.from : null, to: lastU ? cs + lastU.to : null,
    });
  });
}

function emptyLine(a, b, y, lh, align, dm, pos, x0, x1) {
  const caretX = align === 'center' ? (a + b) / 2 : align === 'right' ? b : a;
  return {
    x0, x1, y, h: lh, baseline: y + dm.baseline, pieces: [], from: pos, to: pos, empty: true,
    caretX, caretTop: y + dm.baseline - dm.ascent, caretH: dm.ascent + dm.descent,
  };
}

// skip: 문단 안 이 글자 위치부터 배치(앞 글상자에서 넘친 곳에서 이어 쓰기). 0이면 문단 처음부터.
function layoutParagraph(node, cs, base, region, frame, state, out, skip = 0) {
  const a = node.attrs || {};
  const pre = (a.preset && frame.presets?.[a.preset]) || null; // 스타일 프리셋(문단 속성이 우선)
  const pbase = pre?.style || a.style ? { ...base, ...scaled(pre?.style), ...scaled(a.style) } : base;
  const dm = defaultMetrics(pbase);
  const align = a.align || pre?.align || frame.align || 'left';
  const spacing = a.spacing ?? pre?.spacing ?? frame.paragraphSpacing ?? pbase.fontSize * 0.6;
  const indent = a.indent || pre?.indent || 0;
  const minW = frame.minWidth ?? pbase.fontSize * 2;
  const H = region.h;
  // 단어 나누기·폭 재기는 문단 내용과 글자 모양에만 달렸다(영역·위치와 무관) → 메모. 배열은 fillBand가 고치므로 복사해서 쓴다
  const groups = preparedGroups(node, pbase, state.psig).slice();

  // 내용이 없는 줄(빈 문단, 문단 끝의 강제 줄바꿈 뒤)을 영역 안에 한 줄 확보한다
  const pushEmpty = (pos, indent) => {
    for (;;) {
      if (state.y + dm.lh > H) return false;
      const ints = region.intervalsAt(state.y, state.y + dm.lh, minW);
      if (ints.length) {
        const [x0, x1] = ints[0];
        out.lines.push(emptyLine(x0 + indent, x1, state.y, dm.lh, align, dm, pos, x0, x1));
        state.y += dm.lh;
        return true;
      }
      state.y += STEP;
    }
  };

  if (!groups.length) {
    if (!pushEmpty(cs, indent)) return cs;
    state.y += spacing;
    return null;
  }

  let gi = 0, first = true;
  if (skip > 0) {
    first = false; // 이어지는 줄: 첫 줄 들여쓰기 없음
    for (;;) {
      while (gi < groups.length && groups[gi].units[groups[gi].units.length - 1].to <= skip) gi++;
      const g = groups[gi];
      if (g && g.units[0].from < skip && graphemeCount(g) > 1) { groups.splice(gi, 1, ...splitGraphemes(g)); continue; } // 쪼개진 단어 중간
      break;
    }
  }
  while (gi < groups.length) {
    if (onlySpaces(groups, gi)) break; // 남은 게 공백뿐이면 배치할 내용 없음
    let lh = dm.lh;
    for (let k = gi; k < groups.length; k++) {
      if (!groups[k].space) { lh = lineMetrics(groups[k].units, dm).lh; break; }
    }
    let res = null;
    for (let it = 0; it < 6; it++) {
      if (state.y + lh > H) return cs + firstFrom(groups, gi);
      const ints = region.intervalsAt(state.y, state.y + lh, minW);
      const y0 = state.y, bandH = lh;
      const maxW = () => {
        let m = 0;
        for (let yy = y0; yy <= y0 + 2 * bandH && yy + bandH <= H; yy += 2 * STEP)
          for (const [x0, x1] of region.intervalsAt(yy, yy + bandH)) m = Math.max(m, x1 - x0);
        return m;
      };
      res = ints.length ? fillBand(ints, groups, gi, first ? indent : 0, maxW) : null;
      if (!res || !res.frags.length) break;
      const need = bandHeight(res.frags, dm);
      if (need > lh + 0.5) { lh = need; res = null; continue; } // 더 높은 띠로 다시 질의
      break;
    }
    if (!res || !res.frags.length) { state.y += STEP; continue; }
    commitBand(res, state.y, lh, align, res.gi >= groups.length, dm, cs, out);
    gi = res.gi;
    first = false;
    state.y += lh;
  }
  const lastG = groups[groups.length - 1];
  if (first && !pushEmpty(cs, indent)) return cs; // 공백만 있는 문단
  if (lastG.brk && !pushEmpty(cs + lastG.units[0].to, 0)) return cs + lastG.units[0].to;
  state.y += spacing;
  return null;
}

function onlySpaces(groups, gi) {
  for (let k = gi; k < groups.length; k++) if (!groups[k].space) return false;
  return true;
}

function firstFrom(groups, gi) {
  for (let k = gi; k < groups.length; k++) if (!groups[k].space) return groups[k].units[0].from;
  return 0;
}

function layoutImage(node, pos, region, frame, state, out, assets) {
  const a = node.attrs || {};
  const nat = assets.get(a.src);
  if (!nat) return null;
  const w = a.width || nat.w;
  const h = (w * nat.h) / nat.w;
  const spacing = a.spacing ?? frame.paragraphSpacing ?? 10;
  for (;;) {
    if (state.y + h > region.h) return pos;
    const hit = region.intervalsAt(state.y, state.y + h).find(([x0, x1]) => x1 - x0 >= w);
    if (hit) {
      const k = a.align === 'left' ? 0 : a.align === 'right' ? 1 : 0.5;
      out.images.push({ src: a.src, x: hit[0] + (hit[1] - hit[0] - w) * k, y: state.y, w, h, radius: a.radius || 0, pos });
      state.y += h + spacing;
      return null;
    }
    state.y += STEP;
  }
}

// ---- 문단 준비(단어·폭) 메모: 문단 JSON → Map(스타일 열쇠 → groups)
const prepMemo = new WeakMap();
function preparedGroups(node, pbase, psig) {
  if (psig == null) return prepareParagraph(node, pbase);
  let m = prepMemo.get(node);
  const g = m?.get(psig);
  if (g) return g;
  const groups = prepareParagraph(node, pbase);
  if (!m) { m = new Map(); prepMemo.set(node, m); }
  if (m.size >= 4) m.delete(m.keys().next().value);
  m.set(psig, groups);
  return groups;
}

// ---- 문단 배치 메모
// 같은 문단(문서 JSON의 문단 객체가 같음 = 내용이 안 바뀜)을 같은 자리(y)·같은 영역·같은 스타일로 배치하면 결과가 같다.
// 글을 한 글자 고치면 바뀐 문단만 다시 배치하고, 앞뒤 문단은 이 메모에서 가져온다(문서 위치만 옮겨서).
// 편집기는 바뀌지 않은 문단의 JSON 객체를 그대로 재사용한다(src/editor.js docJSON).
const paraMemo = new WeakMap(); // 문단 JSON → Map(열쇠 → { cs, lines, endY, over })
const MEMO_PER_PARA = 6;
const ids = new WeakMap();
let nextId = 1;
const idOf = (o) => { if (!o) return 0; let v = ids.get(o); if (!v) { v = nextId++; ids.set(o, v); } return v; };
function memoLayoutParagraph(node, cs, base, region, frame, state, out, skip, sig) {
  let m = paraMemo.get(node);
  const key = `${state.y}|${skip}|${sig}`;
  const hit = m?.get(key);
  if (hit) {
    const d = cs - hit.cs;
    for (const ln of hit.lines) out.lines.push(d ? shiftLine(ln, d) : ln);
    state.y = hit.endY;
    return hit.over === null ? null : hit.over + d;
  }
  const tmp = { lines: [], images: out.images };
  const y0 = state.y;
  const over = layoutParagraph(node, cs, base, region, frame, state, tmp, skip);
  for (const ln of tmp.lines) { ln.vis ||= {}; out.lines.push(ln); } // vis: 화면 모양이 같은 줄끼리 나누는 표(렌더러가 DOM 재사용에 씀)
  if (!m) { m = new Map(); paraMemo.set(node, m); }
  if (m.size >= MEMO_PER_PARA) m.delete(m.keys().next().value);
  m.set(`${y0}|${skip}|${sig}`, { cs, lines: tmp.lines, endY: state.y, over });
  return over;
}
function shiftLine(ln, d) {
  return { ...ln, from: ln.from == null ? ln.from : ln.from + d, to: ln.to == null ? ln.to : ln.to + d, pieces: ln.pieces.map((p) => ({ ...p, from: p.from + d, to: p.to + d })) };
}

// 반환: { lines, images, overflow: 넘친 지점의 문서 위치 | null, ms }
// start: 이 문서 위치부터 배치(이어진 글상자: 앞 글상자의 overflow). scale: 글자 크기 배율(자동 축소)
export function layout(doc, frame, region, assets = new Map(), { start = null, scale = 1 } = {}) {
  const t0 = performance.now();
  const out = { lines: [], images: [], overflow: null, ms: 0, scale };
  SCALE = scale;
  PRESETS = frame.presets || null;
  try {
    const base = { ...BASE_STYLE, ...scaled(frame.style || {}) };
    if (scale !== 1 && !frame.style?.fontSize) base.fontSize = BASE_STYLE.fontSize * scale;
    // 메모 열쇠: psig = 글자 모양에 영향을 주는 것(글상자 스타일·프리셋·배율·측정 세대), sig = 여기에 영역·문단 설정까지
    const psig = `${idOf(frame.presets)}|${JSON.stringify(frame.style || null)}|${scale}|${measureGen}`;
    const sig = `${idOf(region)}|${psig}|${JSON.stringify([frame.align, frame.paragraphSpacing, frame.minWidth])}`;
    const state = { y: 0, psig };
    let pos = 0;
    for (const node of doc.content || []) {
      const size = nodeSize(node);
      if (start != null && pos + size <= start && !(node.type === 'image' && pos === start)) { pos += size; continue; }
      let over = null;
      if (node.type === 'paragraph') over = memoLayoutParagraph(node, pos + 1, base, region, frame, state, out, start != null ? Math.max(0, start - pos - 1) : 0, sig);
      else if (node.type === 'image') over = layoutImage(node, pos, region, frame, state, out, assets);
      start = null;
      if (over !== null) { out.overflow = over; break; }
      pos += size;
    }
  } finally { SCALE = 1; PRESETS = null; }
  out.ms = performance.now() - t0;
  return out;
}

// 이어진 글상자 전체 배치 + 자동 축소. frames: [{ frame, region }] (문서 순서)
// autoShrink: 넘치면 글자 크기 배율을 줄여(최소 minScale) 모두 들어가게 한다. 반환: { results, scale, overflow }
export function layoutChain(doc, frames, assets, { autoShrink = false, minScale = 0.5 } = {}) {
  const run = (scale) => {
    const results = [];
    let start = 0;
    for (const f of frames) {
      if (start == null) { results.push({ lines: [], images: [], overflow: null, ms: 0, scale, empty: true }); continue; }
      const r = layout(doc, f.frame, f.region, assets, { start: results.length ? start : null, scale });
      results.push(r);
      start = r.overflow;
    }
    return { results, scale, overflow: start };
  };
  let best = run(1);
  if (!autoShrink || best.overflow == null) return best;
  const low = run(minScale);
  if (low.overflow != null) return low; // 최소 배율로도 넘침
  let lo = minScale, hi = 1;
  best = low;
  for (let i = 0; i < 8; i++) { // 1/256 정밀도(글자 크기 0.1px 안쪽)
    const mid = (lo + hi) / 2;
    const r = run(mid);
    if (r.overflow == null) { lo = mid; best = r; } else hi = mid;
  }
  return best;
}

export async function loadImages(doc) {
  const map = new Map();
  const jobs = [];
  for (const n of doc.content || []) {
    if (n.type !== 'image' || map.has(n.attrs.src)) continue;
    map.set(n.attrs.src, null);
    const img = new Image();
    img.src = n.attrs.src;
    jobs.push(img.decode().then(() => map.set(n.attrs.src, { w: img.naturalWidth, h: img.naturalHeight })));
  }
  await Promise.all(jobs);
  return map;
}

// 이미지 하나를 불러와 원본 크기를 assets에 등록. 실패하면 null(시간 제한 timeout ms).
// 에셋 라이브러리(해시 중복 제거)가 생기면 이 자리를 대체한다.
export async function loadAsset(src, assets, timeout = 8000) {
  const have = assets.get(src);
  if (have) return have;
  // 큰 사진: 원본을 풀지 않고 저장소가 아는 원본 크기를 쓴다
  await srcReady(src);
  const known = srcDims(src);
  if (known) { assets.set(src, known); return known; }
  const img = new Image();
  img.src = src;
  try {
    await Promise.race([img.decode(), new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), timeout))]);
  } catch {
    return null;
  }
  const nat = { w: img.naturalWidth, h: img.naturalHeight };
  assets.set(src, nat);
  return nat;
}

// 글자 한 곳의 실제 스타일(프리셋·문단 스타일·마크 반영). 프리셋 만들기에 쓴다.
export function effectiveStyle(frame, paraAttrs = {}, marks = []) {
  const pre = (paraAttrs.preset && frame.presets?.[paraAttrs.preset]) || null;
  const base = { ...BASE_STYLE, ...(frame.style || {}), ...(pre?.style || {}), ...(paraAttrs.style || {}) };
  PRESETS = frame.presets || null;
  let st;
  try { st = resolveStyle(base, marks); } finally { PRESETS = null; }
  return { style: st, align: paraAttrs.align || pre?.align || frame.align || null, spacing: paraAttrs.spacing ?? pre?.spacing ?? null, indent: paraAttrs.indent || pre?.indent || 0 };
}

export function docText(doc) {
  let s = '';
  for (const n of doc.content || []) for (const c of n.content || []) if (c.type === 'text') s += c.text;
  return s;
}
