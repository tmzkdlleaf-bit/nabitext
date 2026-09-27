/* 실행 취소 기록. 브라우저 기본 undo는 직접 바꾼 DOM(다듬기, 블록 이동 등)을 추적하지 못해서
 * 본문 HTML 스냅숏과 캐럿 위치를 직접 쌓는다. */
NT.History = class {
  constructor(root, onRestore) {
    this.root = root; this.onRestore = onRestore;
    this.stack = []; this.index = -1; this.limit = 200;
  }
  reset() {
    this.stack = [{ html: this.root.innerHTML, caret: { i: 0, o: 0 } }];
    this.index = 0;
  }
  record() {
    const html = this.root.innerHTML;
    const cur = this.stack[this.index];
    if (cur && cur.html === html) { cur.caret = NT.getCaretPos(this.root) || cur.caret; return; }
    this.stack = this.stack.slice(0, this.index + 1);
    this.stack.push({ html, caret: NT.getCaretPos(this.root) });
    if (this.stack.length > this.limit) this.stack.shift();
    this.index = this.stack.length - 1;
  }
  undo() { this.record(); if (this.index > 0) this.apply(--this.index); }
  redo() { if (this.index < this.stack.length - 1) this.apply(++this.index); }
  apply(i) {
    const s = this.stack[i];
    this.root.innerHTML = s.html;
    this.root.focus();
    NT.setCaretPos(this.root, s.caret);
    this.onRestore && this.onRestore();
  }
};
