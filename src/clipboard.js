// 복사/붙여넣기 변환.
//  - 복사: text/html(인라인 CSS, 외부 프로그램용) + text/plain. HTML 안에 슬라이스 JSON을 넣어
//    이 프로그램끼리는 마크·문단 속성이 손실 없이 옮겨진다(OS 클립보드를 거쳐도 HTML 속성은 유지됨).
//  - 붙여넣기 우선순위: 이 프로그램의 슬라이스 → 이미지 파일 → HTML → 텍스트

import { DOMParser as PMParser, DOMSerializer, Fragment, Slice } from 'prosemirror-model';
import { schema, BASIC_MARKS } from './schema.js';

const SLICE_ATTR = 'data-le-slice';
const serializer = DOMSerializer.fromSchema(schema);
const parser = PMParser.fromSchema(schema);

export function sliceToText(slice) {
  return slice.content.textBetween(0, slice.content.size, '\n');
}

export function sliceToHTML(slice) {
  const wrap = document.createElement('div');
  wrap.appendChild(serializer.serializeFragment(slice.content));
  wrap.setAttribute(SLICE_ATTR, JSON.stringify(slice.toJSON() ?? { content: [] }));
  return wrap.outerHTML;
}

export function writeClipboard(dt, slice) {
  dt.clearData();
  dt.setData('text/html', sliceToHTML(slice));
  dt.setData('text/plain', sliceToText(slice));
}

// 슬라이스 안 모든 글자에서 허용하지 않는 마크를 뺀다
function filterMarks(fragment, keep) {
  const out = [];
  fragment.forEach((node) => {
    if (node.isText) out.push(node.mark(node.marks.filter((m) => keep(m.type.name))));
    else if (node.content.size) out.push(node.copy(filterMarks(node.content, keep)));
    else out.push(node);
  });
  return Fragment.fromArray(out);
}

// HTML 문자열 → Slice.
// opts.externalMarks: 'basic'(굵게·기울임·선 종류만) | 'all'(색·크기·글꼴 등 전부) — 외부 HTML에만 적용
export function parseHTML(html, { externalMarks = 'basic' } = {}) {
  const dom = new window.DOMParser().parseFromString(html, 'text/html');
  const own = dom.querySelector(`[${SLICE_ATTR}]`);
  if (own) {
    try {
      return { slice: Slice.fromJSON(schema, JSON.parse(own.getAttribute(SLICE_ATTR))), internal: true };
    } catch (err) {
      console.warn('슬라이스 복원 실패, HTML로 해석합니다', err);
    }
  }
  // 문서 파서가 버리는 요소 정리
  for (const el of dom.querySelectorAll('script, style, meta, link, title, template, noscript')) el.remove();
  let slice = parser.parseSlice(dom.body, { preserveWhitespace: false });
  if (externalMarks !== 'all') {
    slice = new Slice(filterMarks(slice.content, (n) => BASIC_MARKS.has(n)), slice.openStart, slice.openEnd);
  }
  return { slice, internal: false };
}

// 텍스트 → Slice. 줄바꿈마다 문단. 글자는 커서 위치의 마크를, 새 문단은 현재 문단 속성을 이어받는다.
export function parseText(text, $from, marks) {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  const para = $from.parent.type === schema.nodes.paragraph ? $from.parent : null;
  const nodes = lines.map((line) => schema.nodes.paragraph.create(
    para ? para.attrs : null,
    line ? schema.text(line, marks) : null,
  ));
  return new Slice(Fragment.fromArray(nodes), 1, 1);
}
