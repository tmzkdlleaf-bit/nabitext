// 전역 되돌리기 스택. 프로젝트 전체에 하나만 둔다.
// 항목은 { undo(), redo() }만 구현하면 된다. 지금은 텍스트 편집(TextEntry)만 있고,
// 요소 이동·리사이즈·속성 변경도 같은 인터페이스로 이 스택에 쌓는다.
//
// 묶기: 새 항목이 merge(prev)로 직전 항목에 흡수되면 한 단위가 된다.
// 연속 텍스트 입력의 묶기 조건은 TextEntry.canMerge 참고.

export class History {
  constructor({ limit = 500, groupDelay = 1000 } = {}) {
    this.limit = limit;
    this.groupDelay = groupDelay; // 이 시간(ms) 넘게 쉬면 입력 묶음을 끊는다
    this.done = [];
    this.undone = [];
    this.closed = false; // true면 다음 항목은 무조건 새 단위
    this.busy = false; // undo/redo 적용 중에는 기록하지 않음
    this.listeners = new Set();
    this.beforeHooks = new Set();
  }

  record(entry) {
    if (this.busy) return;
    const prev = this.done[this.done.length - 1];
    if (!this.closed && prev && prev.canMerge?.(entry, this.groupDelay)) prev.merge(entry);
    else {
      this.done.push(entry);
      if (this.done.length > this.limit) this.done.shift();
    }
    this.closed = false;
    this.undone.length = 0;
    this.emit();
  }

  // 전부 비우기(새 프로젝트·열기)
  clear() { this.done.length = 0; this.undone.length = 0; this.closed = true; this.emit(); }

  // 다음 기록을 새 단위로 시작하게 한다(예: 요소 선택이 바뀔 때)
  closeGroup() { this.closed = true; }

  // fn 안에서 기록된 항목을 한 단위로 묶는다(예: 속성 패널에서 글상자 여러 개의 글자 크기를 한 번에 바꿀 때)
  batch(fn) {
    if (this.collecting) return fn(); // 이미 묶는 중이면 바깥 묶음에 합친다
    const items = [];
    this.collecting = items;
    const realRecord = this.record;
    this.record = (e) => { if (!this.busy) items.push(e); };
    let r;
    try { r = fn(); } finally { this.record = realRecord; this.collecting = null; }
    if (items.length === 1) this.record(items[0]);
    else if (items.length > 1) { this.closed = true; this.record(new BatchEntry(items)); this.closed = true; }
    return r;
  }

  get canUndo() { return this.done.length > 0; }
  get canRedo() { return this.undone.length > 0; }

  undo() { return this.move(this.done, this.undone, 'undo'); }
  redo() { return this.move(this.undone, this.done, 'redo'); }

  move(from, to, op) {
    for (const h of this.beforeHooks) h(); // 예: 조합 중인 한글을 먼저 확정
    const entry = from.pop();
    if (!entry) return false;
    this.onApply?.(entry, op); // 예: 다른 장의 항목이면 그 장으로 전환
    this.busy = true;
    try { entry[op](); } finally { this.busy = false; }
    to.push(entry);
    this.closed = true;
    this.emit();
    return true;
  }

  onChange(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  beforeApply(fn) { this.beforeHooks.add(fn); return () => this.beforeHooks.delete(fn); }
  emit() { for (const fn of this.listeners) fn(this); }
}

// 여러 항목을 한 단위로
export class BatchEntry {
  constructor(items) { this.items = items; }
  get page() { return this.items[0]?.page; }
  get editor() { return this.items[0]?.editor; }
  undo() { for (let i = this.items.length - 1; i >= 0; i--) this.items[i].undo(); }
  redo() { for (const e of this.items) e.redo(); }
}

// 한 편집기(텍스트 프레임)의 문서 변경. 뒤집은 step을 저장해 되돌린다.
// 편집기 문서는 모두 이 스택을 거쳐서만 바뀌므로, 스택 순서대로 적용하면 step이 항상 맞는다.
export class TextEntry {
  constructor(editor, tr, kind, selBefore) {
    this.editor = editor;
    this.kind = kind; // 'type' | 'delete' | null(묶지 않음)
    this.steps = tr.steps.slice();
    this.inverted = tr.steps.map((s, i) => s.invert(tr.docs[i])).reverse();
    this.selBefore = selBefore;
    this.selAfter = tr.selection.toJSON();
    this.time = Date.now();
    // 편집 중(입력창 포커스)에 생긴 변경만 되돌릴 때 그 글상자로 포커스를 옮긴다.
    // 속성 패널에서 글상자 전체에 적용한 변경은 되돌려도 편집 모드로 들어가지 않는다.
    this.focus = editor.focused !== false && editor.input === document.activeElement;
  }

  // 같은 편집기, 같은 종류(입력/삭제), 커서가 직전 결과 위치 그대로, 시간 간격 이내
  canMerge(next, delay) {
    return this.kind && next.kind === this.kind && next.editor === this.editor &&
      next.time - this.time <= delay &&
      JSON.stringify(next.selBefore) === JSON.stringify(this.selAfter);
  }

  merge(next) {
    this.steps.push(...next.steps);
    this.inverted = next.inverted.concat(this.inverted);
    this.selAfter = next.selAfter;
    this.time = next.time;
  }

  undo() { this.editor.applySteps(this.inverted, this.selBefore, this.focus); }
  redo() { this.editor.applySteps(this.steps, this.selAfter, this.focus); }
}
