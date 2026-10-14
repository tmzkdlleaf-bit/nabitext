// 문서 위치 ↔ 화면 좌표 매핑과 줄 탐색. 레이아웃 결과(lines)만 보고 동작한다.
// lines는 문서 순서(= 띠 순서, 띠 안에서는 좌→우)로 정렬되어 있다.

import { textWidth } from './measure.js';

const GRAPHEMES = new Intl.Segmenter('ko', { granularity: 'grapheme' });

export class Mapper {
  constructor(result) {
    this.lines = result.lines;
    this.images = result.images;
  }

  // pos가 속한 줄. 줄바꿈 경계(앞 줄 끝 = 다음 줄 시작)에서는 assoc<0이면 앞 줄, 아니면 다음 줄.
  // 줄 끝에서 잘린 공백 위치는 앞 줄 끝으로 본다.
  lineIndex(pos, assoc = 1) {
    const L = this.lines;
    if (!L.length) return -1;
    let lo = 0, hi = L.length - 1, idx = 0;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (L[mid].from <= pos) { idx = mid; lo = mid + 1; } else hi = mid - 1;
    }
    if (assoc < 0 && idx > 0 && L[idx].from === pos && L[idx - 1].to === pos && !L[idx].empty) idx--;
    return idx;
  }

  xAt(line, pos) {
    if (line.empty) return line.caretX;
    if (pos <= line.from) return line.pieces[0].x;
    for (const p of line.pieces) {
      if (pos > p.to) continue;
      if (pos === p.to) return p.x + p.adv;
      const k = pos - p.from;
      return p.x + (p.space ? (p.adv * k) / p.text.length : textWidth(p.text.slice(0, k), p.style));
    }
    const last = line.pieces[line.pieces.length - 1];
    return last.x + last.adv;
  }

  // 커서 사각형 { x, top, h, line }
  coordsAt(pos, assoc = 1) {
    const i = this.lineIndex(pos, assoc);
    if (i < 0) return null;
    const ln = this.lines[i];
    if (ln.empty) return { x: ln.caretX, top: ln.caretTop, h: ln.caretH, line: i };
    const p = Math.min(Math.max(pos, ln.from), ln.to);
    // 커서 높이는 왼쪽 글자(이어서 입력될 스타일) 기준
    let piece = ln.pieces.find((q) => q.from < p && p <= q.to) || ln.pieces.find((q) => q.from <= p) || ln.pieces[0];
    return { x: this.xAt(ln, p), top: piece.top, h: piece.h, line: i };
  }

  // 줄 안의 x에 가장 가까운 글자 경계
  posInLine(ln, x) {
    if (ln.empty) return { pos: ln.from, assoc: 1 };
    const ps = ln.pieces;
    if (x <= ps[0].x) return { pos: ln.from, assoc: 1 };
    for (const p of ps) {
      if (x >= p.x + p.adv) continue;
      let best = p.from, bestD = Math.abs(x - p.x), acc = 0;
      if (p.space) {
        for (let k = 1; k <= p.text.length; k++) {
          const bx = p.x + (p.adv * k) / p.text.length;
          if (Math.abs(x - bx) < bestD) { bestD = Math.abs(x - bx); best = p.from + k; }
        }
      } else {
        for (const { segment, index } of GRAPHEMES.segment(p.text)) {
          acc = index + segment.length;
          const bx = p.x + textWidth(p.text.slice(0, acc), p.style);
          const d = Math.abs(x - bx);
          if (d < bestD) { bestD = d; best = p.from + acc; }
          if (bx > x) break;
        }
      }
      return { pos: best, assoc: best === ln.to ? -1 : 1 };
    }
    return { pos: ln.to, assoc: -1 };
  }

  // 화면 좌표 → 문서 위치. 세로 거리를 우선하고, 같은 띠 안에서는 가로 거리로 구간을 고른다.
  posAt(x, y) {
    let best = null, bestD = Infinity;
    for (const ln of this.lines) {
      const dy = y < ln.y ? ln.y - y : y >= ln.y + ln.h ? y - (ln.y + ln.h) + 1 : 0;
      const dx = x < ln.x0 ? ln.x0 - x : x > ln.x1 ? x - ln.x1 : 0;
      const d = dy * 10000 + dx;
      if (d < bestD) { bestD = d; best = ln; }
    }
    return best ? this.posInLine(best, x) : null;
  }

  imageAt(x, y) {
    return this.images.find((im) => x >= im.x && x <= im.x + im.w && y >= im.y && y <= im.y + im.h) || null;
  }

  // 위/아래 띠로 이동. 목표 x를 유지하고, 띠 안에 구간이 여러 개면 목표 x에 가장 가까운 구간.
  vertical(pos, assoc, dir, goalX) {
    const L = this.lines;
    const i = this.lineIndex(pos, assoc);
    if (i < 0) return null;
    const y = L[i].y;
    let bandY = null;
    if (dir > 0) {
      for (let j = i + 1; j < L.length; j++) if (L[j].y > y) { bandY = L[j].y; break; }
    } else {
      for (let j = i - 1; j >= 0; j--) if (L[j].y < y) { bandY = L[j].y; break; }
    }
    if (bandY === null) return dir > 0 ? { pos: L[L.length - 1].to, assoc: -1, edge: true } : { pos: L[0].from, assoc: 1, edge: true };
    let best = null, bestD = Infinity;
    for (const ln of L) {
      if (ln.y !== bandY) continue;
      const d = goalX < ln.x0 ? ln.x0 - goalX : goalX > ln.x1 ? goalX - ln.x1 : 0;
      if (d < bestD) { bestD = d; best = ln; }
    }
    return this.posInLine(best, goalX);
  }

  lineBounds(pos, assoc) {
    const ln = this.lines[this.lineIndex(pos, assoc)];
    return ln ? { from: ln.from, to: ln.to } : null;
  }

  // 선택 영역 사각형(줄마다 하나)
  selectionRects(from, to) {
    const rects = [];
    for (const ln of this.lines) {
      if (ln.to < from || ln.from > to) continue;
      if (ln.empty ? !(from <= ln.from && ln.from < to) : ln.to === from || ln.from === to) continue;
      const a = Math.max(from, ln.from), b = Math.min(to, ln.to);
      const xa = this.xAt(ln, a);
      let xb = this.xAt(ln, b);
      if (to > ln.to) xb += 5; // 줄 끝을 넘어 선택이 이어짐을 표시
      rects.push({ x: xa, y: ln.y, w: Math.max(1, xb - xa), h: ln.h });
    }
    return rects;
  }
}
