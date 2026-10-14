// 마크(글자 꾸밈) 명령. 모두 (state, dispatch?) => boolean 형태의 ProseMirror 명령이다.
// 선택이 비어 있으면 '다음에 입력할 글자'의 꾸밈(stored marks)을 바꾼다.

import { schema } from './schema.js';

// 켜고 끄는 마크. 나머지는 값을 가진 마크(setMark로 지정).
export const TOGGLE_MARKS = ['bold', 'italic', 'underline', 'strike', 'overline'];

// 글자 크기 단계(Ctrl+Shift+> / <)
export const SIZE_STEPS = [8, 9, 10, 11, 12, 13, 14, 16, 18, 20, 22, 24, 28, 32, 36, 40, 48, 56, 64, 72, 96, 128, 160, 200];

const typeOf = (name) => {
  const t = schema.marks[name];
  if (!t) throw new Error(`알 수 없는 마크: ${name}`);
  return t;
};

// 선택 범위 안의 글자 노드마다 콜백. 이미지 같은 블록 노드는 건너뛴다.
function eachText(state, fn) {
  for (const { $from, $to } of state.selection.ranges) {
    state.doc.nodesBetween($from.pos, $to.pos, (node, pos) => {
      if (!node.isText) return;
      const from = Math.max(pos, $from.pos), to = Math.min(pos + node.nodeSize, $to.pos);
      if (from < to) fn(node, from, to);
    });
  }
}

const cursorMarks = (state) => state.storedMarks || state.selection.$from.marks();

// 마크 상태: { state: 'all' | 'some' | 'none', values: [attrs...] } — 도구 막대·속성 패널 표시용
export function markState(state, name) {
  const type = typeOf(name);
  const values = [];
  const seen = new Set();
  const add = (m) => {
    const k = JSON.stringify(m.attrs);
    if (!seen.has(k)) { seen.add(k); values.push(m.attrs); }
  };
  if (state.selection.empty) {
    const m = type.isInSet(cursorMarks(state));
    if (m) add(m);
    return { state: m ? 'all' : 'none', values };
  }
  let has = 0, total = 0;
  eachText(state, (node, from, to) => {
    total += to - from;
    const m = type.isInSet(node.marks);
    if (m) { has += to - from; add(m); }
  });
  return { state: !has ? 'none' : has === total ? 'all' : 'some', values };
}

// 켜기/끄기. 선택 전체에 이미 있으면 끄고, 일부에만 있거나 없으면 전체에 켠다(워드·구글 문서와 같은 규칙).
export const toggleMark = (name, attrs = null) => (state, dispatch) => {
  const on = markState(state, name).state === 'all';
  return on ? removeMark(name)(state, dispatch) : setMark(name, attrs)(state, dispatch);
};

// 값 지정. 같은 종류 마크는 새 값으로 바뀐다.
export const setMark = (name, attrs = null) => (state, dispatch) => {
  const type = typeOf(name);
  const mark = type.create(attrs);
  const sel = state.selection;
  if (sel.empty) {
    if (!sel.$from.parent.inlineContent) return false;
    if (dispatch) dispatch(state.tr.addStoredMark(mark));
    return true;
  }
  let applies = false;
  eachText(state, () => { applies = true; });
  if (!applies) return false;
  if (dispatch) {
    const tr = state.tr;
    for (const { $from, $to } of sel.ranges) tr.addMark($from.pos, $to.pos, mark);
    dispatch(tr);
  }
  return true;
};

export const removeMark = (name) => (state, dispatch) => {
  const type = typeOf(name);
  const sel = state.selection;
  if (sel.empty) {
    if (!type.isInSet(cursorMarks(state))) return false;
    if (dispatch) dispatch(state.tr.removeStoredMark(type));
    return true;
  }
  if (markState(state, name).state === 'none') return false;
  if (dispatch) {
    const tr = state.tr;
    for (const { $from, $to } of sel.ranges) tr.removeMark($from.pos, $to.pos, type);
    dispatch(tr);
  }
  return true;
};

// 모든 꾸밈 해제
export const clearMarks = () => (state, dispatch) => {
  const sel = state.selection;
  if (sel.empty) {
    if (!cursorMarks(state).length) return false;
    if (dispatch) dispatch(state.tr.setStoredMarks([]));
    return true;
  }
  let any = false;
  eachText(state, (node) => { if (node.marks.length) any = true; });
  if (!any) return false;
  if (dispatch) {
    const tr = state.tr;
    for (const { $from, $to } of sel.ranges) tr.removeMark($from.pos, $to.pos, null);
    dispatch(tr);
  }
  return true;
};

const nextSize = (cur, dir) => {
  if (dir > 0) return SIZE_STEPS.find((s) => s > cur + 0.01) ?? Math.round(cur * 1.25);
  const smaller = SIZE_STEPS.filter((s) => s < cur - 0.01);
  return smaller.length ? smaller[smaller.length - 1] : Math.max(1, Math.round(cur * 0.8));
};

// 글자 크기 한 단계 키우기/줄이기. 글자마다 현재 크기(마크 또는 문단·프레임 기본값)에서 다음 단계로.
// baseSizeAt(pos): 마크가 없을 때의 크기(편집기가 문단 스타일·프레임 스타일로 계산해 넘긴다)
export const stepSize = (dir, baseSizeAt) => (state, dispatch) => {
  const type = schema.marks.size;
  const sel = state.selection;
  if (sel.empty) {
    if (!sel.$from.parent.inlineContent) return false;
    const cur = type.isInSet(cursorMarks(state))?.attrs.value ?? baseSizeAt(sel.from);
    if (dispatch) dispatch(state.tr.addStoredMark(type.create({ value: nextSize(cur, dir) })));
    return true;
  }
  const tr = state.tr;
  eachText(state, (node, from, to) => {
    const cur = type.isInSet(node.marks)?.attrs.value ?? baseSizeAt(from);
    tr.addMark(from, to, type.create({ value: nextSize(cur, dir) }));
  });
  if (!tr.docChanged) return false;
  if (dispatch) dispatch(tr);
  return true;
};
