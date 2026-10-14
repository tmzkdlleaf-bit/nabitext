// 캔버스 위 직접 편집기.
//  - 문서 상태: ProseMirror EditorState (트랜잭션, 선택, 명령)
//  - 화면: 자체 레이아웃 엔진 결과 + 커서/선택/조합 밑줄 오버레이
//  - 입력: 커서를 따라다니는 숨긴 textarea (IME 후보창이 커서 옆에 뜨게 함)

import { EditorState, TextSelection, NodeSelection, Selection, AllSelection } from 'prosemirror-state';
import { Fragment, Slice } from 'prosemirror-model';
import { splitBlock, deleteSelection, joinBackward, joinForward, selectNodeBackward, selectNodeForward } from 'prosemirror-commands';
import { schema } from './schema.js';
import { layoutChain, BASE_STYLE, loadAsset, effectiveStyle } from './layout.js';
import { renderFrame } from './render.js';
import { Mapper } from './mapping.js';
import { History, TextEntry } from './history.js';
import { toggleMark, setMark, removeMark, clearMarks, stepSize, markState } from './commands.js';
import { createKeymap, lookup } from './keymap.js';
import { writeClipboard, parseHTML, parseText } from './clipboard.js';

const GRAPHEMES = new Intl.Segmenter('ko', { granularity: 'grapheme' });
const JSON_CACHE = new WeakMap(); // ProseMirror 블록 노드 → JSON
const PRESET_MARKS = ['font', 'size', 'bold', 'weight', 'italic', 'color', 'spacing', 'lineHeight'];
const WORDS = new Intl.Segmenter('ko', { granularity: 'word' });

const CSS = `
.ce-host{position:relative;cursor:text;user-select:none;-webkit-user-select:none}
.ce-overlay{position:absolute;inset:0;pointer-events:none}
.ce-sel{position:absolute;background:rgba(45,127,249,.28)}
.ce-node{position:absolute;outline:2px solid #2d7ff9;outline-offset:1px}
.ce-comp{position:absolute;height:0;border-bottom:2px solid #2d7ff9}
.ce-caret{position:absolute;width:2px;background:#111;animation:ce-blink 1.06s steps(1) infinite}
@keyframes ce-blink{50%{opacity:0}}
.ce-input{position:absolute;opacity:0;padding:0;border:0;margin:0;resize:none;overflow:hidden;
  white-space:pre;width:1px;caret-color:transparent;outline:none;pointer-events:none}
`;

let cssInjected = false;

export class CanvasEditor {
  // history: 전역 되돌리기 스택(없으면 이 편집기 전용으로 만든다)
  // keymap: createKeymap() 결과(사용자 재지정 포함)
  // externalMarks: 외부 HTML 붙여넣기 때 살릴 꾸밈 — 'basic'(굵게·기울임·선) | 'all'
  // nativePaste: 있으면 Mod+Shift+V에서 이 함수로 paste 이벤트를 부른다(Electron, platform.nativePaste)
  // toLocal(clientX, clientY): 화면 좌표 → 프레임 안 좌표. 캔버스 확대·요소 회전이 있을 때 편집기 화면(app/page-view.js)이 넘긴다.
  // importImage(src | File) → Promise<새 src | null>: 붙여넣은 이미지를 에셋 저장소로 가져오는 함수(편집기 화면이 넘김). 없으면 그대로 쓴다.
  // inputParent·inputAt: 숨긴 입력창을 둘 요소와 위치 계산(편집기 화면은 장 요소에 둔다. 이어진 글상자가 다른 장에 있어도 입력창이 화면에 남게)
  //   inputAt(글상자 번호, x, top, h) → inputParent 안 좌표 { x, y } | null(화면에 없음)
  constructor(host, { frame, built, doc, assets, onChange, history, keymap, externalMarks = 'basic', nativePaste = null, toLocal = null, importImage = null, inputParent = null, inputAt = null }) {
    if (!cssInjected) {
      document.head.insertAdjacentHTML('beforeend', `<style>${CSS}</style>`);
      cssInjected = true;
    }
    this.frame = frame;
    this.built = built;
    this.assets = assets;
    this.onChange = onChange || (() => {});
    this.history = history || new History();
    this.keymap = keymap || createKeymap();
    this.externalMarks = externalMarks;
    this.plainPaste = false; // Ctrl+Shift+V 직후의 paste는 텍스트로만
    this.nativePaste = nativePaste;
    this.toLocal = toLocal;
    this.importImage = importImage;
    this.inputAt = inputAt;
    this.offBeforeApply = this.history.beforeApply(() => { if (this.comp) this.commitComposition(); });
    this.debug = false;
    this.comp = null; // 조합 중인 문자열 { text }
    this.goalX = null; // 상/하 이동 시 유지할 x
    this.assoc = 1; // 줄바꿈 경계에서 커서를 어느 줄에 둘지
    this.focused = false;
    this.log = []; // 입력 이벤트 기록(검증용, 최근 200개만)

    this.host = host;
    this.more = [];     // 이어진 글상자(두 번째부터): { id, frame, built, host, frameEl, overlay, toLocal, toHost }
    this.stale = [];    // 글상자별: 화면에 없어서 아직 안 그림
    this.offsets = [0]; // 글상자마다 가상 좌표의 세로 시작점(여러 글상자를 한 줄 목록으로 다루려고 위아래로 쌓음)
    host.classList.add('ce-host');
    this.frameEl = document.createElement('div');
    this.overlay = document.createElement('div');
    this.overlay.className = 'ce-overlay';
    this.input = document.createElement('textarea');
    this.input.className = 'ce-input';
    for (const [k, v] of Object.entries({ autocomplete: 'off', autocorrect: 'off', autocapitalize: 'off', spellcheck: 'false', tabindex: '0' }))
      this.input.setAttribute(k, v);
    host.append(this.frameEl, this.overlay);
    (inputParent || host).appendChild(this.input);

    this.state = EditorState.create({ doc: schema.nodeFromJSON(doc) });
    this.commands = this.buildCommands();
    this.bindInput();
    this.bindClipboard();
    this.bindMouse(host, 0);
    this.update();
  }

  // ---------- 이어진 글상자 ----------
  // specs: 두 번째 글상자부터 [{ id, frame, built, toLocal(clientX, clientY) → 그 글상자 좌표, toHost(x, y) → 첫 글상자 좌표 }]
  // 각 글상자의 표시 요소(host)는 여기서 만들고, 편집기 화면이 해당 요소 안에 넣는다.
  setChain(specs) {
    const old = new Map(this.more.map((v) => [v.id, v]));
    this.more = specs.map((sp) => {
      let v = old.get(sp.id);
      if (!v) {
        v = { id: sp.id, host: document.createElement('div'), frameEl: document.createElement('div'), overlay: document.createElement('div') };
        v.host.className = 'ce-host';
        v.host.style.cssText = 'position:absolute;left:0;top:0';
        v.overlay.className = 'ce-overlay';
        v.host.append(v.frameEl, v.overlay);
        this.bindMouse(v.host, () => this.more.indexOf(v) + 1);
      }
      return Object.assign(v, sp);
    });
    this.update();
    return this.more;
  }
  // 이 글상자 이야기(story)의 배치 결과 전체(조합 미리보기 포함)
  get chainFrames() { return [{ frame: this.frame, region: this.built.region }, ...this.more.map((v) => ({ frame: v.frame, region: v.built.region }))]; }
  views() { return [{ frame: this.frame, built: this.built, frameEl: this.frameEl, overlay: this.overlay, host: this.host }, ...this.more]; }

  // ---------- 상태 ----------
  // input: 되돌리기 묶음 종류. 'type'(글자 입력·줄바꿈) | 'delete'(한 글자/단어 삭제) | 없음(단독 단위)
  dispatch(tr, { keepGoal = false, assoc = 1, input = null } = {}) {
    const selBefore = this.state.selection.toJSON();
    this.state = this.state.apply(tr);
    if (tr.docChanged && tr.getMeta('addToHistory') !== false) {
      this.history.record(new TextEntry(this, tr, input, selBefore));
    }
    if (!keepGoal) this.goalX = null;
    this.assoc = assoc;
    // 문서가 그대로면(커서·선택만 이동) 다시 배치하지 않고 커서·선택 표시만 다시 그린다
    if (tr.docChanged || this.comp) this.update(); else this.drawOverlay();
    if (tr.docChanged) this.onChange(this);
    this.onState?.(this); // 선택만 바뀌어도(도구 막대·속성 패널 갱신용)
  }

  setSelection(sel, opts) {
    this.dispatch(this.state.tr.setSelection(sel), opts);
  }

  // 되돌리기/다시 실행: 저장해 둔 step을 적용하고 선택을 복원한다(기록하지 않음)
  applySteps(steps, selJSON, focus = true) {
    const tr = this.state.tr;
    for (const st of steps) {
      const r = tr.maybeStep(st);
      if (r.failed) throw new Error('되돌리기 step 적용 실패: ' + r.failed);
    }
    try { tr.setSelection(Selection.fromJSON(tr.doc, selJSON)); } catch { /* 위치가 사라졌으면 매핑된 선택 유지 */ }
    tr.setMeta('addToHistory', false);
    this.dispatch(tr);
    if (focus) this.focus();
  }

  // ---------- 명령 ----------
  // 명령 이름 → 함수. 단축키(keymap)와 이후 도구 막대가 같은 이름으로 호출한다.
  buildCommands() {
    const pm = (cmd) => () => cmd(this.state, (tr) => this.dispatch(tr));
    const c = {
      undo: () => this.history.undo(),
      redo: () => this.history.redo(),
      selectAll: () => { this.setSelection(new AllSelection(this.state.doc)); return true; },
      clearMarks: pm(clearMarks()),
      sizeUp: pm(stepSize(1, (pos) => this.baseSizeAt(pos))),
      sizeDown: pm(stepSize(-1, (pos) => this.baseSizeAt(pos))),
    };
    for (const name of ['bold', 'italic', 'underline', 'strike', 'overline']) c[name] = pm(toggleMark(name));
    return c;
  }

  run(name) {
    const fn = this.commands[name];
    return fn ? fn() !== false : false;
  }

  // 외부(도구 막대·속성 패널)용
  toggleMark(name, attrs) { return toggleMark(name, attrs)(this.state, (tr) => this.dispatch(tr)); }
  setMark(name, attrs) { return setMark(name, attrs)(this.state, (tr) => this.dispatch(tr)); }
  removeMark(name) { return removeMark(name)(this.state, (tr) => this.dispatch(tr)); }
  markState(name) { return markState(this.state, name); }

  // ---------- 글상자 전체에 적용(속성 패널: 편집 중이 아닐 때) ----------
  // 선택을 바꾸지 않고, 문서 전체를 선택한 상태에서 명령을 실행한 결과 step만 가져와 적용한다.
  allState() { return this.state.apply(this.state.tr.setSelection(new AllSelection(this.state.doc))); }
  applyToAll(cmd) {
    let out = null;
    cmd(this.allState(), (tr) => { out = tr; });
    if (!out || !out.docChanged) return false;
    const tr = this.state.tr;
    for (const st of out.steps) tr.step(st);
    this.dispatch(tr);
    return true;
  }
  // all: true면 문서 전체, 아니면 현재 선택(빈 선택이면 다음 입력 글자)
  setMarkOn(name, attrs, all) { return all ? this.applyToAll(setMark(name, attrs)) : this.setMark(name, attrs); }
  removeMarkOn(name, all) { return all ? this.applyToAll(removeMark(name)) : this.removeMark(name); }
  toggleMarkOn(name, all) { return all ? this.applyToAll(toggleMark(name)) : this.toggleMark(name); }
  markStateOn(name, all) { return markState(all ? this.allState() : this.state, name); }

  // 문단 속성(정렬 등): all이면 모든 문단, 아니면 선택이 걸친 문단
  setParagraphAttrs(attrs, all) {
    const st = all ? this.allState() : this.state;
    const { from, to } = st.selection;
    const tr = this.state.tr;
    st.doc.nodesBetween(from, Math.max(to, from + 1), (n, pos) => {
      if (n.type.name !== 'paragraph') return;
      tr.setNodeMarkup(pos, null, { ...n.attrs, ...attrs });
      return false;
    });
    if (!tr.docChanged) return false;
    this.dispatch(tr);
    return true;
  }
  // 선택이 걸친 문단들의 속성 값(모두 같으면 그 값, 섞였으면 undefined)
  paragraphAttr(name, all) {
    const st = all ? this.allState() : this.state;
    const { from, to } = st.selection;
    const vals = new Set();
    st.doc.nodesBetween(from, Math.max(to, from + 1), (n) => { if (n.type.name === 'paragraph') { vals.add(n.attrs[name] ?? null); return false; } });
    return vals.size === 1 ? [...vals][0] : undefined;
  }

  // ---------- 스타일 프리셋 ----------
  // 선택이 걸친 문단(all이면 모든 문단)에 프리셋을 건다. 문단 자체 스타일·정렬·간격·들여쓰기와
  // 글자 모양 마크(글꼴·크기·굵기·기울임·색·자간·행간)는 지워 프리셋대로 보이게 한다. 밑줄·형광펜 같은 꾸밈은 남긴다.
  applyPreset(id, all) {
    const st = all ? this.allState() : this.state;
    const { from, to } = st.selection;
    const tr = this.state.tr;
    const clear = PRESET_MARKS.map((n) => schema.marks[n]).filter(Boolean);
    st.doc.nodesBetween(from, Math.max(to, from + 1), (n, pos) => {
      if (n.type.name !== 'paragraph') return;
      tr.setNodeMarkup(pos, null, { ...n.attrs, preset: id, style: null, align: null, spacing: null, indent: 0 });
      for (const m of clear) tr.removeMark(pos + 1, pos + 1 + n.content.size, m);
      return false;
    });
    if (!tr.docChanged) return false;
    tr.setStoredMarks(null);
    this.dispatch(tr);
    return true;
  }
  // 글자 스타일 프리셋: 선택한 글자(all이면 문서 전체, 빈 선택이면 다음 입력 글자)에 건다. 글자 모양 마크는 지워 프리셋대로 보이게.
  // id = null이면 프리셋 마크만 뗀다
  applyCharPreset(id, all) {
    const st = all ? this.allState() : this.state;
    const { from, to, empty } = st.selection;
    const tr = this.state.tr;
    const cs = schema.marks.charStyle;
    const clear = PRESET_MARKS.map((n) => schema.marks[n]).filter(Boolean);
    if (empty && !all) {
      let marks = (this.state.storedMarks || this.state.selection.$from.marks()).filter((m) => m.type !== cs && !clear.includes(m.type));
      if (id) marks = cs.create({ id }).addToSet(marks);
      tr.setStoredMarks(marks);
      this.dispatch(tr);
      return true;
    }
    tr.removeMark(from, to, cs);
    if (id) { for (const m of clear) tr.removeMark(from, to, m); tr.addMark(from, to, cs.create({ id })); }
    if (!tr.docChanged) return false;
    this.dispatch(tr);
    return true;
  }
  // 커서(all이면 문서 처음) 자리 글자의 실제 모양 → 프리셋 내용
  presetFromHere(all) {
    const pos = all ? Selection.atStart(this.state.doc).from : this.state.selection.from;
    const $p = this.state.doc.resolve(pos);
    const para = $p.parent.type.name === 'paragraph' ? $p.parent.attrs : {};
    const marks = (this.state.storedMarks || $p.marks()).map((m) => ({ type: m.type.name, attrs: m.attrs }));
    const e = effectiveStyle(this.frame, para, marks);
    const style = {};
    for (const k of ['fontFamily', 'fontSize', 'fontWeight', 'italic', 'color', 'lineHeight', 'letterSpacing']) style[k] = e.style[k];
    return { style, align: e.align, spacing: e.spacing, indent: e.indent };
  }

  // 크기 마크가 없을 때의 글자 크기: 문단 스타일 → 프레임 스타일 → 기본값
  baseSizeAt(pos) {
    const $p = this.state.doc.resolve(pos);
    return $p.parent.attrs.style?.fontSize ?? this.frame.style?.fontSize ?? BASE_STYLE.fontSize;
  }

  setRegion(built) { this.built = built; this.update(); }
  setFrame(frame) { this.frame = frame; this.update(); }
  setDebug(on) { this.debug = on; this.update(); }

  update() {
    const t0 = performance.now();
    let doc = this.state.doc;
    let compRange = null;
    if (this.comp && this.comp.text) {
      // 조합 중인 글자를 문서에 확정하지 않고 화면에만 반영
      const from = this.state.selection.from;
      doc = this.state.tr.insertText(this.comp.text).doc;
      compRange = { from, to: from + this.comp.text.length };
    }
    const ch = layoutChain(this.docJSON(doc), this.chainFrames, this.assets, { autoShrink: !!this.frame.autoShrink, minScale: this.frame.minScale ?? 0.5 });
    this.results = ch.results;
    this.result = ch.results[0];
    this.scale = ch.scale;         // 자동 축소 배율(1 = 원래 크기)
    this.overflow = ch.overflow;   // 마지막 글상자까지 넣고도 남은 곳(null = 다 들어감)
    const t1 = performance.now();
    const views = this.views();
    // lazyRender(편집기 화면이 켬): 화면에 붙어 있지 않은 글상자(다른 장)는 그리지 않고 표시만 해 둔다 → 붙을 때 renderPending
    views.forEach((v, k) => {
      if (this.lazyRender && !v.frameEl.isConnected) { this.stale[k] = true; return; }
      this.stale[k] = false;
      renderFrame(v.frameEl, v.frame, v.built, ch.results[k], { debug: this.debug });
    });
    this.mapper = new Mapper(this.combine(ch.results, views));
    this.drawOverlay(compRange);
    this.lastLayoutMs = t1 - t0;
    this.lastUpdateMs = performance.now() - t0;
  }

  // 미뤄 둔 글상자 그리기(화면에 붙은 것만)
  renderPending() {
    if (!this.results) return;
    this.views().forEach((v, k) => {
      if (!this.stale[k] || !v.frameEl.isConnected) return;
      this.stale[k] = false;
      renderFrame(v.frameEl, v.frame, v.built, this.results[k], { debug: this.debug });
    });
  }

  // 문서 JSON. 바뀌지 않은 문단은 전에 만든 JSON 객체를 그대로 쓴다(ProseMirror 노드는 바뀌지 않으면 같은 객체) →
  // 레이아웃 엔진이 문단 배치 메모를 재사용할 수 있다
  docJSON(doc) {
    const content = [];
    doc.forEach((n) => { let j = JSON_CACHE.get(n); if (!j) { j = n.toJSON(); JSON_CACHE.set(n, j); } content.push(j); });
    return { type: 'doc', content };
  }

  // 글상자별 결과를 가상 좌표(글상자 k는 offsets[k]만큼 아래)의 한 목록으로 합친다 → Mapper가 글상자 사이를 오간다
  combine(results, views) {
    if (results.length === 1) { this.offsets = [0]; return results[0]; }
    const GAP = 100000;
    const offsets = [];
    let y = 0;
    const lines = [], images = [];
    results.forEach((r, k) => {
      offsets.push(y);
      const dy = y;
      for (const ln of r.lines) lines.push({ ...ln, y: ln.y + dy, baseline: ln.baseline + dy, caretTop: ln.caretTop != null ? ln.caretTop + dy : ln.caretTop, pieces: ln.pieces.map((p) => ({ ...p, top: p.top + dy })) });
      for (const im of r.images) images.push({ ...im, y: im.y + dy });
      y += views[k].frame.h + GAP;
    });
    this.offsets = offsets;
    return { lines, images };
  }
  // 가상 y → [글상자 번호, 그 글상자 안 y]
  viewAt(y) {
    let k = 0;
    while (k + 1 < this.offsets.length && this.offsets[k + 1] <= y) k++;
    return [k, y - this.offsets[k]];
  }

  drawOverlay(compRange) {
    const sel = this.state.selection;
    const m = this.mapper;
    const views = this.views();
    const html = views.map(() => '');
    const put = (x, y, fn) => { const [k, ly] = this.viewAt(y); html[k] += fn(x, ly); };
    let caret = null;

    if (sel instanceof NodeSelection) {
      const im = m.images.find((i) => i.pos === sel.from);
      if (im) put(im.x, im.y, (x, y) => `<div class="ce-node" style="left:${x}px;top:${y}px;width:${im.w}px;height:${im.h}px"></div>`);
      caret = im ? { x: im.x + im.w, top: im.y, h: 20 } : null;
    } else if (compRange) {
      for (const r of m.selectionRects(compRange.from, compRange.to))
        put(r.x, r.y, (x, y) => `<div class="ce-comp" style="left:${x}px;top:${y + r.h - 3}px;width:${r.w}px"></div>`);
      caret = m.coordsAt(compRange.to, -1);
    } else {
      if (!sel.empty) {
        for (const r of m.selectionRects(sel.from, sel.to))
          put(r.x, r.y, (x, y) => `<div class="ce-sel" style="left:${x}px;top:${y}px;width:${r.w}px;height:${r.h}px"></div>`);
      }
      caret = m.coordsAt(sel.head, this.assoc);
    }
    if (caret && this.focused && !(sel instanceof NodeSelection))
      put(caret.x, caret.top, (x, y) => `<div class="ce-caret" style="left:${x - 1}px;top:${y}px;height:${caret.h}px"></div>`);
    views.forEach((v, k) => { v.overlay.innerHTML = html[k]; });
    // caret: 글상자 번호(view)와 그 글상자 안 좌표
    if (caret) { const [k, top] = this.viewAt(caret.top); caret = { ...caret, top, view: k }; }
    this.caret = caret;

    // 입력창을 커서 위치로 → IME 후보창이 커서 옆에 뜬다(다른 글상자면 첫 글상자 좌표로 옮겨서)
    if (caret) {
      const s = this.input.style;
      const at = this.inputAt ? this.inputAt(caret.view, caret.x, caret.top, caret.h)
        : caret.view > 0 && this.more[caret.view - 1]?.toHost ? this.more[caret.view - 1].toHost(caret.x, caret.top) : { x: caret.x, y: caret.top };
      if (at) {
        s.left = `${at.x}px`;
        s.top = `${at.y}px`;
      }
      s.height = `${caret.h}px`;
      s.fontSize = `${Math.max(8, caret.h * 0.75)}px`;
      s.lineHeight = `${caret.h}px`;
    }
  }

  logEvent(t) { this.log.push(t); if (this.log.length > 400) this.log.splice(0, 200); }

  // ---------- 키보드 / IME ----------
  bindInput() {
    const inp = this.input;
    inp.addEventListener('focus', () => { this.focused = true; this.drawOverlay(); });
    inp.addEventListener('blur', () => { this.focused = false; this.drawOverlay(); });

    inp.addEventListener('compositionstart', () => {
      this.logEvent('compositionstart');
      this.skipEnd = null;
      // 선택 위에 조합 시작: 선택 삭제는 뒤따르는 입력과 한 단위로 묶는다
      if (!this.state.selection.empty) this.dispatch(this.state.tr.deleteSelection(), { input: 'type' });
      this.comp = { text: '' };
    });
    inp.addEventListener('compositionupdate', (e) => {
      this.logEvent('compositionupdate:' + e.data);
      if (!this.comp) this.comp = { text: '' };
      this.comp.text = e.data;
      this.update();
    });
    inp.addEventListener('compositionend', (e) => {
      this.logEvent('compositionend:' + e.data);
      if (this.skipEnd !== null && this.skipEnd !== undefined) {
        // 이미 강제 확정한 조합의 늦은 종료 이벤트 → 중복 삽입 방지
        this.skipEnd = null;
        inp.value = '';
        return;
      }
      this.comp = null;
      inp.value = '';
      if (e.data) this.dispatch(this.state.tr.insertText(e.data), { input: 'type' });
      else this.update();
    });
    inp.addEventListener('beforeinput', (e) => {
      if (e.isComposing || e.inputType === 'insertCompositionText') return; // 조합은 composition 이벤트에서 처리
      this.logEvent('beforeinput:' + e.inputType);
      if (e.inputType === 'historyUndo' || e.inputType === 'historyRedo') {
        // 메뉴(Electron의 편집 메뉴 등)에서 들어온 되돌리기: 입력창 자체 기록 대신 전역 스택
        e.preventDefault();
        this.run(e.inputType === 'historyUndo' ? 'undo' : 'redo');
        return;
      }
      // compositionend 없이 조합 외 입력이 들어오면(조합 중 Enter 등) 조합 글자를 먼저 확정
      if (this.comp) this.commitComposition();
      if (e.inputType === 'insertText' || e.inputType === 'insertReplacementText') {
        e.preventDefault();
        const text = e.data ?? e.dataTransfer?.getData('text/plain');
        if (text) this.dispatch(this.state.tr.insertText(text), { input: 'type' });
      } else if (e.inputType === 'insertLineBreak' || e.inputType === 'insertParagraph') {
        // 조합 중 Enter: IME가 확정한 뒤 줄바꿈이 keydown 없이 여기로 들어온다
        e.preventDefault();
        splitBlock(this.state, (tr) => this.dispatch(tr, { input: 'type' }));
      } else if (e.inputType === 'deleteContentBackward' || e.inputType === 'deleteContentForward') {
        e.preventDefault();
        this.del(e.inputType === 'deleteContentBackward' ? -1 : 1, 'char');
      }
    });
    inp.addEventListener('input', () => {
      if (!this.comp) inp.value = ''; // 입력창에 글자가 남지 않게
    });
    inp.addEventListener('keydown', (e) => {
      // 조합 중 키(keyCode 229)는 IME 몫. 조합 중 Enter/방향키가 두 번 처리되는 것을 막는다.
      if (e.isComposing || e.keyCode === 229 || this.comp) { this.logEvent('keydown(ime):' + e.key); return; }
      this.logEvent('keydown:' + e.key);
      // Ctrl+Shift+V: 뒤따르는 paste 이벤트를 서식 없이 처리(기본 동작은 막지 않아야 paste가 온다)
      this.plainPaste = (e.ctrlKey || e.metaKey) && e.shiftKey && e.code === 'KeyV';
      // Electron: 운영체제별 기본 키 동작에 기대지 않고 직접 paste 이벤트를 부른다(platform.nativePaste)
      if (this.plainPaste && this.nativePaste) { e.preventDefault(); this.nativePaste(); return; }
      const cmd = lookup(this.keymap, e);
      if (cmd && this.commands[cmd]) {
        e.preventDefault();
        this.run(cmd);
        return;
      }
      if (this.handleKey(e)) e.preventDefault();
    });
  }

  // 조합 중인 글자를 강제로 확정한다. IME 쪽 조합은 입력창 포커스를 잠깐 옮겨 끝낸다.
  commitComposition() {
    const text = this.comp?.text;
    this.comp = null;
    if (!text) return;
    this.skipEnd = text;
    this.dispatch(this.state.tr.insertText(text), { input: 'type' });
    this.input.blur();
    this.input.value = '';
    this.input.focus({ preventScroll: true });
  }

  handleKey(e) {
    const mod = e.ctrlKey || e.metaKey;
    const shift = e.shiftKey;
    switch (e.key) {
      case 'ArrowLeft': return this.moveH(-1, mod ? 'word' : 'char', shift);
      case 'ArrowRight': return this.moveH(1, mod ? 'word' : 'char', shift);
      case 'ArrowUp': return this.moveV(-1, shift);
      case 'ArrowDown': return this.moveV(1, shift);
      case 'Home': return this.moveLineEdge(-1, shift, mod);
      case 'End': return this.moveLineEdge(1, shift, mod);
      case 'Backspace': return this.del(-1, mod ? 'word' : 'char');
      case 'Delete': return this.del(1, mod ? 'word' : 'char');
      case 'Enter':
        if (shift) this.dispatch(this.state.tr.replaceSelectionWith(schema.nodes.hard_break.create()), { input: 'type' });
        else splitBlock(this.state, (tr) => this.dispatch(tr, { input: 'type' }));
        return true;
      case 'Tab':
        return true;
    }
    return false;
  }

  // 텍스트 블록 안에서 글자(grapheme)/단어 단위 다음 경계. 블록 끝이면 null.
  stepInBlock(pos, dir, unit) {
    const $p = this.state.doc.resolve(pos);
    if (!$p.parent.isTextblock) return null;
    const text = $p.parent.textBetween(0, $p.parent.content.size, '', '\n');
    const off = $p.parentOffset;
    if ((dir > 0 && off >= text.length) || (dir < 0 && off <= 0)) return null;
    const segs = [...(unit === 'word' ? WORDS : GRAPHEMES).segment(text)];
    let b;
    if (dir > 0) {
      const s = segs.find((s) => s.index + s.segment.length > off && (unit !== 'word' || s.isWordLike));
      b = s ? s.index + s.segment.length : text.length;
    } else {
      const s = segs.filter((s) => s.index < off && (unit !== 'word' || s.isWordLike)).pop();
      b = s ? s.index : 0;
    }
    return $p.start() + b;
  }

  // 한 단계 이동한 Selection. 블록 경계에서는 다음/이전 블록(이미지는 노드 선택)으로.
  stepSelection(from, dir, unit, textOnly) {
    const pos = this.stepInBlock(from, dir, unit);
    if (pos !== null) return TextSelection.create(this.state.doc, pos);
    const $p = this.state.doc.resolve(from);
    const edge = $p.depth > 0 ? (dir > 0 ? $p.after() : $p.before()) : from;
    return Selection.findFrom(this.state.doc.resolve(edge), dir, textOnly) || null;
  }

  moveH(dir, unit, extend) {
    const sel = this.state.selection;
    const doc = this.state.doc;
    if (!extend && !sel.empty && !(sel instanceof NodeSelection)) {
      this.setSelection(TextSelection.create(doc, dir > 0 ? sel.to : sel.from));
      return true;
    }
    if (sel instanceof NodeSelection && !extend) {
      const next = Selection.findFrom(doc.resolve(dir > 0 ? sel.to : sel.from), dir);
      if (next) this.setSelection(next);
      return true;
    }
    const next = this.stepSelection(sel.head, dir, unit, extend);
    if (!next) return true;
    if (extend) this.setSelection(TextSelection.create(doc, sel.anchor, next.head));
    else this.setSelection(next);
    return true;
  }

  moveV(dir, extend) {
    const sel = this.state.selection;
    const head = sel instanceof NodeSelection ? (dir > 0 ? sel.to : sel.from) : sel.head;
    const c = this.mapper.coordsAt(head, this.assoc);
    if (!c) return true;
    if (this.goalX === null) this.goalX = c.x;
    const t = this.mapper.vertical(head, this.assoc, dir, this.goalX);
    if (!t) return true;
    const doc = this.state.doc;
    const s = extend ? TextSelection.create(doc, sel.anchor, t.pos) : TextSelection.create(doc, t.pos);
    this.setSelection(s, { keepGoal: true, assoc: t.assoc });
    return true;
  }

  moveLineEdge(dir, extend, docEdge) {
    const sel = this.state.selection;
    const doc = this.state.doc;
    let pos;
    if (docEdge) pos = dir > 0 ? Selection.atEnd(doc).head : Selection.atStart(doc).head;
    else {
      const b = this.mapper.lineBounds(sel.head, this.assoc);
      if (!b) return true;
      pos = dir > 0 ? b.to : b.from;
    }
    const s = extend ? TextSelection.create(doc, sel.anchor, pos) : TextSelection.create(doc, pos);
    this.setSelection(s, { assoc: dir > 0 ? -1 : 1 });
    return true;
  }

  del(dir, unit) {
    const st = this.state;
    const sel = st.selection;
    const run = (cmd) => cmd(st, (tr) => this.dispatch(tr, { input: 'delete' }));
    if (!sel.empty) return deleteSelection(st, (tr) => this.dispatch(tr)), true;
    const target = this.stepInBlock(sel.head, dir, unit);
    if (target === null) {
      // 블록 경계: 문단 합치기, 또는 이웃 이미지 선택
      if (dir < 0) run(joinBackward) || run(selectNodeBackward);
      else run(joinForward) || run(selectNodeForward);
      return true;
    }
    const [a, b] = dir < 0 ? [target, sel.head] : [sel.head, target];
    this.dispatch(st.tr.delete(a, b), { input: 'delete' });
    return true;
  }

  // ---------- 클립보드 ----------
  bindClipboard() {
    const inp = this.input;
    const copy = (e, cut) => {
      const sel = this.state.selection;
      if (sel.empty) return; // 선택이 없으면 아무것도 하지 않음(클립보드 유지)
      e.preventDefault();
      writeClipboard(e.clipboardData, sel.content());
      if (cut) this.dispatch(this.state.tr.deleteSelection());
    };
    inp.addEventListener('copy', (e) => copy(e, false));
    inp.addEventListener('cut', (e) => copy(e, true));
    inp.addEventListener('paste', (e) => {
      e.preventDefault();
      const plain = this.plainPaste;
      this.plainPaste = false;
      if (this.comp) this.commitComposition();
      this.pasteData(e.clipboardData, { plain }).catch((err) => console.error('붙여넣기 실패', err));
    });
  }

  // DataTransfer(또는 같은 모양의 객체) → 문서에 삽입. 이미지 로딩 때문에 비동기.
  async pasteData(dt, { plain = false } = {}) {
    const html = dt.getData('text/html');
    const text = dt.getData('text/plain');
    const files = [...(dt.files || [])].filter((f) => f.type.startsWith('image/'));

    if (!plain && html) {
      const { slice, internal } = parseHTML(html, { externalMarks: this.externalMarks });
      // 파일과 HTML이 같이 오면(브라우저의 '이미지 복사') 파일 쪽이 확실하다
      if (internal || !files.length) {
        const ready = await this.prepareImages(slice);
        if (ready.content.size) this.dispatch(this.state.tr.replaceSelection(ready).scrollIntoView());
        return;
      }
    }
    if (!plain && files.length) {
      const nodes = [];
      for (const f of files) {
        const src = (this.importImage && await this.importImage(f)) || URL.createObjectURL(f);
        const nat = await loadAsset(src, this.assets);
        if (!nat) continue;
        // 기본 폭: 원본 폭과 프레임 폭의 절반 중 작은 값(영역에 들어가도록)
        nodes.push(schema.nodes.image.create({ src, width: Math.round(Math.min(nat.w, this.frame.w / 2)) }));
      }
      if (!nodes.length) return;
      const tr = this.state.tr;
      for (const n of nodes) tr.replaceSelectionWith(n, false);
      this.dispatch(tr);
      return;
    }
    if (text) {
      const $from = this.state.selection.$from;
      const marks = this.state.storedMarks || (this.state.selection.empty ? $from.marks() : $from.marksAcross(this.state.selection.$to) || []);
      if (!/[\r\n]/.test(text)) this.dispatch(this.state.tr.insertText(text));
      else this.dispatch(this.state.tr.replaceSelection(parseText(text, $from, marks)));
    }
  }

  // 슬라이스 안 이미지를 미리 불러오고, 불러오지 못한 이미지는 뺀다(영역 배치에 크기가 필요)
  async prepareImages(slice) {
    const srcs = new Set();
    slice.content.descendants((n) => { if (n.type === schema.nodes.image) srcs.add(n.attrs.src); });
    if (!srcs.size) return slice;
    if (this.importImage) {
      // 에셋 저장소로 가져와 주소를 바꾼다(원격 이미지도 이때 가져옴. 실패하면 원래 주소로 시도)
      const map = new Map();
      await Promise.all([...srcs].map(async (s) => { const n = await this.importImage(s); if (n && n !== s) map.set(s, n); }));
      if (map.size) {
        const swap = (frag) => {
          const out = [];
          frag.forEach((n) => out.push(n.type === schema.nodes.image && map.has(n.attrs.src) ? n.type.create({ ...n.attrs, src: map.get(n.attrs.src) }) : n.isLeaf ? n : n.copy(swap(n.content))));
          return Fragment.fromArray(out);
        };
        slice = new Slice(swap(slice.content), slice.openStart, slice.openEnd);
        srcs.clear();
        slice.content.descendants((n) => { if (n.type === schema.nodes.image) srcs.add(n.attrs.src); });
      }
    }
    const ok = new Set();
    await Promise.all([...srcs].map(async (s) => { if (await loadAsset(s, this.assets)) ok.add(s); }));
    if (ok.size === srcs.size) return slice;
    const drop = (frag) => {
      const out = [];
      frag.forEach((n) => {
        if (n.type === schema.nodes.image && !ok.has(n.attrs.src)) return;
        out.push(n.isLeaf ? n : n.copy(drop(n.content)));
      });
      return Fragment.fromArray(out);
    };
    return new Slice(drop(slice.content), slice.openStart, slice.openEnd);
  }

  // ---------- 마우스 ----------
  // 글상자 k 안 좌표(가상 좌표 = 세로로 offsets[k]만큼 내림)
  localIn(k, e) {
    let p;
    if (k === 0) {
      if (this.toLocal) p = this.toLocal(e.clientX, e.clientY);
      else { const r = this.frameEl.getBoundingClientRect(); p = { x: e.clientX - r.left, y: e.clientY - r.top }; }
    } else p = this.more[k - 1].toLocal(e.clientX, e.clientY);
    return { x: p.x, y: p.y + (this.offsets[k] ?? 0), ly: p.y };
  }
  local(e) { return this.localIn(0, e); }
  // 끌기 중: 포인터가 들어간 글상자 기준(어느 글상자에도 없으면 누른 글상자)
  localAny(e, k0) {
    const views = this.views();
    for (let k = 0; k < views.length; k++) {
      const p = this.localIn(k, e);
      if (p.x >= 0 && p.ly >= 0 && p.x <= views[k].frame.w && p.ly <= views[k].frame.h) return p;
    }
    return this.localIn(k0, e);
  }

  bindMouse(host, kOf) {
    const idx = typeof kOf === 'function' ? kOf : () => kOf;
    host.addEventListener('mousedown', (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      this.input.focus({ preventScroll: true });
      if (this.comp) return; // 조합 중 클릭은 무시(IME가 확정 처리)
      const k0 = idx();
      const { x, y } = this.localIn(k0, e);
      const doc = this.state.doc;

      const im = this.mapper.imageAt(x, y);
      if (im && !e.shiftKey) {
        this.setSelection(NodeSelection.create(doc, im.pos));
        return;
      }
      const hit = this.mapper.posAt(x, y);
      if (!hit) return;

      if (e.detail === 2 || e.detail === 3) {
        const $p = doc.resolve(hit.pos);
        if (e.detail === 3) {
          this.setSelection(TextSelection.create(doc, $p.start(), $p.end()));
        } else {
          const text = $p.parent.textBetween(0, $p.parent.content.size, '', '\n');
          const off = $p.parentOffset;
          const seg = [...WORDS.segment(text)].find((s) => s.index <= off && off < s.index + s.segment.length)
            || [...WORDS.segment(text)].pop();
          if (seg) this.setSelection(TextSelection.create(doc, $p.start() + seg.index, $p.start() + seg.index + seg.segment.length));
        }
        return;
      }

      const anchor = e.shiftKey ? this.state.selection.anchor : hit.pos;
      this.setSelection(TextSelection.create(doc, anchor, hit.pos), { assoc: hit.assoc });

      const move = (ev) => {
        const p = this.localAny(ev, k0);
        const h = this.mapper.posAt(p.x, p.y);
        if (h) this.setSelection(TextSelection.create(this.state.doc, anchor, h.pos), { assoc: h.assoc });
      };
      const up = () => {
        window.removeEventListener('mousemove', move);
        window.removeEventListener('mouseup', up);
      };
      window.addEventListener('mousemove', move);
      window.addEventListener('mouseup', up);
    });
  }

  // 출력용: 확정된 문서만으로 새로 배치·렌더(커서·선택·조합 미리보기·디버그 표시 없음). k: 이어진 글상자 번호
  // reuse: 지금 배치 결과를 그대로 쓴다(미리보기처럼 빨리 그릴 때. 출력은 새로 배치)
  exportFrame(k = 0, { reuse = false } = {}) {
    const views = this.views();
    const v = views[k];
    return {
      w: v.frame.w,
      h: v.frame.h,
      render: () => {
        const el = document.createElement('div');
        if (reuse && this.results?.[k]) { renderFrame(el, v.frame, v.built, this.results[k], { debug: false }); return el; }
        const ch = layoutChain(this.docJSON(this.state.doc), this.chainFrames, this.assets, { autoShrink: !!this.frame.autoShrink, minScale: this.frame.minScale ?? 0.5 });
        renderFrame(el, v.frame, v.built, ch.results[k], { debug: false });
        return el;
      },
    };
  }
  exportPage() { return this.exportFrame(0); }

  focus() { this.input.focus({ preventScroll: true }); }
  // 커서 자리에 글자 넣기(선택이 있으면 바꿈). 글자 모양은 커서 자리 것을 따른다
  insertText(t) { this.dispatch(this.state.tr.insertText(t)); }
  // 찾기·바꾸기: 범위 선택, 여러 범위를 한 번에 바꾸기(되돌리기 한 단위). ranges: [[from, to], …]
  selectRange(from, to) { this.setSelection(TextSelection.create(this.state.doc, from, to)); }
  replaceRanges(ranges, text) {
    const tr = this.state.tr;
    for (const [f, t] of [...ranges].sort((a, b) => b[0] - a[0])) tr.insertText(text, f, t);
    if (tr.docChanged) this.dispatch(tr);
    return tr.docChanged;
  }
  // 이 문서 위치가 놓인 글상자 번호(넘쳐서 어디에도 없으면 마지막 글상자, 그때 overflow = true)
  memberOfPos(pos) {
    const rs = this.results || [];
    for (let k = 0; k < rs.length; k++) {
      const ls = rs[k].lines.filter((l) => l.from != null);
      if (ls.length && pos >= ls[0].from && pos <= ls[ls.length - 1].to) return { k, overflow: false };
    }
    return { k: Math.max(0, rs.length - 1), overflow: true };
  }
  // 더 쓰지 않는 편집기 정리(새 프로젝트·열기): 전역 되돌리기 훅과 입력창을 뗀다
  destroy() {
    this.offBeforeApply?.();
    this.input.remove();
    this.host.remove();
    for (const v of this.more) v.host.remove();
  }
  // 프레임 안 좌표에 커서를 놓는다(편집 모드로 들어갈 때 클릭한 자리). k: 이어진 글상자 번호
  placeCaretAt(x, y, k = 0) {
    const hit = this.mapper.posAt(x, y + (this.offsets[k] ?? 0));
    if (hit) this.setSelection(TextSelection.create(this.state.doc, hit.pos), { assoc: hit.assoc });
    return !!hit;
  }
  get text() { return this.state.doc.textBetween(0, this.state.doc.content.size, '\n', '\n'); }
}
