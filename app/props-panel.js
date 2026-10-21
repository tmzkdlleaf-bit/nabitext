// 속성 패널: 선택한 요소(없으면 장)의 속성.
//   배치: X·Y·W·H·회전 / 모양: 불투명도·혼합 모드 / 도형: 채움·테두리·모서리 / 이미지: 맞춤 / 글자: 글꼴·크기·꾸밈·색·자간·행간·정렬·여백
// 글자 속성은 글상자를 편집 중이면 편집기의 선택 범위에(빈 선택이면 다음 입력 글자에), 편집 중이 아니면 선택한 글상자 전체에 적용한다.
// 숫자 칸: Enter·칸 벗어남 = 적용, Esc = 취소, ↑↓ = 1씩(Shift = 10씩, 이어서 누르면 되돌리기 한 단위).

import { openSymbolPicker } from './symbols.js';
import { WRAP_TYPES, WRAP_SHAPES, WRAP_SIDES, cleanWrap } from './wrap.js';
import { BASE_STYLE } from '../src/layout.js';
import * as M from './model.js';
import { ColorField, MIXED, normHex } from './color.js';
import { FILTER_DEFAULTS } from './render-el.js';
import { esc } from './util.js';
import { isMaster, TOKENS } from './master.js';
import { icon } from './icons.js';
import { fontField, closeFontPicker } from './font-picker.js';
import { fontStack } from '../src/fonts.js';
import { SIZE_PRESETS, matchSize, sizeOf } from './sizes.js';

const ICON_TPL = new Map();
// 아이콘 DOM(같은 모양은 한 번 만들어 복제)
function iconEl(name, size, stroke) {
  const k = `${name}|${size}|${stroke}`;
  let t = ICON_TPL.get(k);
  if (!t) { t = document.createElement('template'); t.innerHTML = icon(name, size, stroke); ICON_TPL.set(k, t); }
  return t.content.firstChild.cloneNode(true);
}

export const PROPS_CSS = `
.pp{font-size:12.5px;color:var(--text,#23211e)}
.pp-head{padding:12px 14px 10px;border-bottom:1px solid var(--line,#e4e1dc)}
.pp-kind{display:flex;align-items:center;gap:7px;min-width:0}
.pp-kind b{font-size:14px;white-space:nowrap}
.pp-kind span{font-size:11.5px;color:var(--muted,#8a857d);overflow:hidden;white-space:nowrap;text-overflow:ellipsis}
.pp-acts{display:flex;gap:3px;margin-top:10px;flex-wrap:wrap}
.pp-acts button{width:32px;height:30px;display:grid;place-items:center;border-radius:6px;background:#fff;border:1px solid var(--line2,#ecebe7);color:#4a4640;cursor:pointer}
.pp-acts button:hover{border-color:#cfcac2}
.pp-acts button[aria-pressed="true"]{color:var(--accent,#2d6cdf);border-color:var(--accent,#2d6cdf)}
.pp-sec{border-bottom:1px solid var(--line,#e4e1dc);padding:10px 14px 10px}
.pp-h{display:flex;align-items:center;gap:6px;font-size:12.5px;font-weight:700;color:#3a3732;cursor:pointer;user-select:none;margin:0 0 8px;border:0;background:none;padding:0;width:100%;text-align:left}
.pp-h small{font-weight:400;color:var(--muted,#8a857d);font-size:11.5px}
.pp-sec.closed .pp-h{margin:0;color:#6d675e}
.pp-sec.closed .pp-body{display:none}
.pp .row{display:flex;align-items:center;gap:8px;margin:0 0 6px;flex-wrap:wrap}
.pp .row > *{flex:1 1 0;min-width:0}
.pp .row > button.tg, .pp .row > .seg{flex:0 0 auto}
.pp label.f{display:flex;align-items:center;gap:6px;height:30px;background:#fff;border:1px solid var(--line,#e4e1dc);border-radius:6px;padding:0 8px;box-sizing:border-box}
.pp label.f:focus-within{border-color:var(--accent,#2d6cdf)}
.pp label.f > span{color:var(--muted,#8a857d);font-size:11.5px;white-space:nowrap}
.pp label.f.ck{border:0;background:none;padding:0;height:auto;min-height:24px}
.pp label.f.ck > span{color:var(--text,#23211e);font-size:12.5px;white-space:normal}
.pp input.num{width:100%;min-width:0;font:inherit;border:0;outline:0;padding:0;background:none}
.pp input.txt{width:100%;min-width:0;font:inherit;border:0;outline:0;padding:0;background:none}
.pp select{font:inherit;border:0;outline:0;background:none;width:100%;min-width:0;padding:0}
.pp label.f .cf{flex:1;min-width:0}
.pp button.tg{font:inherit;font-size:12px;height:30px;padding:0 10px;border:1px solid var(--line,#e4e1dc);background:#fff;border-radius:6px;cursor:pointer;display:inline-flex;align-items:center;justify-content:center;gap:5px}
.pp button.tg:hover{border-color:#cfcac2}
.pp button.tg[aria-pressed="true"]{background:var(--accent,#2d6cdf);color:#fff;border-color:var(--accent,#2d6cdf)}
.pp button.tg[aria-pressed="mixed"]{background:#cfe0fd}
.pp .seg{display:inline-flex;background:var(--bg,#f4f3f0);border-radius:7px;padding:2px;gap:0}
.pp .seg button.tg{height:28px;min-width:32px;padding:0 6px;border:0;background:none;border-radius:5px;color:#4a4640}
.pp .seg button.tg[aria-pressed="true"]{background:#fff;color:var(--accent,#2d6cdf);box-shadow:0 1px 2px rgba(0,0,0,.12)}
.pp .seg button.tg[aria-pressed="mixed"]{background:#dfe7f7}
.pp .icorow{display:flex;gap:1px;margin:0 0 8px}
.pp .icorow button{width:29px;height:28px;display:grid;place-items:center;border:0;background:none;border-radius:6px;color:#4a4640;cursor:pointer}
.pp .icorow button:hover{background:var(--bg,#f4f3f0)}
.pp .icorow i{width:1px;height:18px;background:var(--line,#e4e1dc);margin:5px 4px}
.pp .note{color:var(--muted,#8a857d);margin:0 0 6px;line-height:1.5}
@media (pointer: coarse){.pp label.f{height:38px}.pp .seg button.tg{height:36px;min-width:38px}.pp .icorow button{width:38px;height:36px}.pp .row{gap:8px;margin-bottom:8px}.pp-h{min-height:34px}}
`;

const BLENDS = [['normal', '보통'], ['multiply', '곱하기'], ['screen', '스크린'], ['overlay', '오버레이'], ['darken', '어둡게'], ['lighten', '밝게'],
  ['color-dodge', '색상 닷지'], ['color-burn', '색상 번'], ['hard-light', '하드 라이트'], ['soft-light', '소프트 라이트'], ['difference', '차이'],
  ['exclusion', '제외'], ['hue', '색조'], ['saturation', '채도'], ['color', '색상'], ['luminosity', '광도']];

const TOGGLE_ICONS = { B: 'bold', I: 'italic', U: 'underline', S: 'strikethrough', '왼쪽': 'align-left', '가운데': 'align-center', '오른쪽': 'align-right', '양쪽': 'align-justify' };
const EDIT_CLOSED = new Set(['배치', '모양', '글상자 바탕', '글상자 모양', '글 흐름']); // 글상자 편집 중 처음에 접어 두는 칸
const CLOSED = new Set(['필터', '마스크']);                                // 그 밖에 처음에 접어 두는 칸
const CLOSED_PREF = 'nabitext.props.closed';

const same = (vals) => (vals.length && vals.every((v) => v === vals[0]) ? vals[0] : MIXED);
const fmt = (v) => (v === MIXED || v == null ? '' : String(Math.round(v * 100) / 100));
const firstFamily = (f) => (f ? String(f).split(',')[0].trim().replace(/^["']|["']$/g, '') : '');


export class PropsPanel {
  // pickImage(): 이미지 파일을 골라 에셋으로 → { src, w, h } | null (패턴 채움·알파 마스크·이미지 외곽선 글상자용)
  // promptName(message, value) → Promise<문자열 | null>: 프리셋 이름 묻기(앱의 입력 창)
  constructor(root, view, { history, swatches, fonts = [], pickImage = null, promptName = null }) {
    Object.assign(this, { view, history, swatches, pickImage, promptName });
    this.el = document.createElement('div');
    this.el.className = 'pp';
    root.appendChild(this.el);
    this.fields = [];
    this.sig = null;
    this.cur = null;
    try { this.closedState = JSON.parse(localStorage.getItem(CLOSED_PREF) || '{}') || {}; } catch { this.closedState = {}; }
    // 글꼴 목록: 기본(defaultFonts) · 넣은 글꼴(projectFonts: [{ family, label, faces }]) · 시스템(systemFonts)
    // fontActions: { addFiles(), loadSystem(), remove(family) } — 앱(main.js)이 채운다
    this.defaultFonts = [...new Set(fonts)];
    this.projectFonts = [];
    this.systemFonts = [];
    this.fontActions = {};
    this.fontList = document.createElement('datalist'); // 전체 글꼴 이름(검증·다른 도구용)
    this.fontList.id = 'pp-fonts';
    root.appendChild(this.fontList);
    this.updateFontList();
  }

  get fonts() { return [...new Set([...this.defaultFonts, ...this.projectFonts.map((f) => f.family), ...this.systemFonts])]; }
  // 예전 방식(이름 목록 하나): 기본·넣은 글꼴이 아닌 이름은 시스템 글꼴로 본다
  setFonts(list) {
    const known = new Set([...this.defaultFonts, ...this.projectFonts.map((f) => f.family)]);
    this.setSystemFonts([...this.systemFonts, ...list.filter((n) => !known.has(n))]);
  }
  setProjectFonts(list) { this.projectFonts = list; this.updateFontList(); }
  setSystemFonts(list) { this.systemFonts = [...new Set(list)].sort((a, b) => a.localeCompare(b)); this.updateFontList(); }
  updateFontList() {
    this.fontList.innerHTML = this.fonts.map((f) => `<option value="${esc(f)}">`).join('');
  }
  fontSource() { return { project: this.projectFonts, defaults: this.defaultFonts, system: this.systemFonts }; }
  // 글꼴 칸(펼침 목록). set(이름)
  fontField(get, set) {
    return this.reg(fontField({ label: '글꼴', get, set, source: () => this.fontSource(), actions: this.fontActions, back: () => this.backToCanvas(), MIXED }));
  }

  // ---------- 대상 ----------
  // 그리는 동안에는 선택 목록을 한 번만 찾는다(요소가 많으면 찾기가 요소 수만큼 걸림)
  nodes() { return this.memo('ns', () => this.view.selectedNodes()); }
  leaves() { return this.memo('leaves', () => this.view.selectionLeaves()); }
  single() { const ns = this.nodes(); return ns.length === 1 && ns[0].type !== 'group' ? ns[0] : null; }
  box() { const s = this.single(); return s || this.view.selectionBounds(); }
  textTargets() { return this.memo('tt', () => this.textTargetsNow()); }
  textTargetsNow() {
    const v = this.view;
    if (v.editing) return { eds: [v.activeEditor], all: false, nodes: [v.node(v.editing)] };
    const nodes = this.leaves().filter((n) => n.type === 'text');
    return { eds: [...new Set(nodes.map((n) => v.editorOf(n)).filter(Boolean))], all: true, nodes };
  }
  // 마크 값: 모두 같으면 그 값, 섞이면 MIXED. 마크가 없는 글자는 fallback(글상자 기본 글자 스타일)
  // 한 번 그리는(또는 값 새로 채우는) 동안 같은 계산은 한 번만: 여러 칸이 같은 마크 상태를 묻고, 긴 글이면 비싸다
  memo(key, fn) {
    if (!this.cache) return fn();
    if (!this.cache.has(key)) this.cache.set(key, fn());
    return this.cache.get(key);
  }
  markStates(name) {
    return this.memo('ms:' + name, () => { const { eds, all } = this.textTargets(); return eds.map((ed) => [ed, ed.markStateOn(name, all)]); });
  }
  markValue(name, pick, fallback) {
    const vals = [];
    for (const [ed, st] of this.markStates(name)) {
      if (st.state === 'some') return MIXED;
      if (st.state === 'none') vals.push(fallback(ed));
      else for (const a of st.values) vals.push(pick(a));
    }
    return same(vals);
  }
  toggleState(name) {
    const states = this.markStates(name).map(([, st]) => st.state);
    return states.every((s) => s === 'all') ? 'true' : states.every((s) => s === 'none') ? 'false' : 'mixed';
  }
  frameStyle(ed, key) { return ed.frame.style?.[key] ?? BASE_STYLE[key]; }

  // 글자 명령을 대상 편집기 모두에 적용(되돌리기 한 단위). 편집 중이면 편집기로 포커스를 돌려준다.
  applyText(fn) {
    const { eds, all } = this.textTargets();
    if (!eds.length) return;
    this.history.batch(() => { for (const ed of eds) fn(ed, all); });
    if (this.view.editing) this.view.activeEditor.focus();
    this.refresh();
  }
  setMark(name, attrs) { this.applyText((ed, all) => (attrs == null ? ed.removeMarkOn(name, all) : ed.setMarkOn(name, attrs, all))); }
  toggle(name) {
    const on = this.toggleState(name) !== 'true';
    this.applyText((ed, all) => (on ? ed.setMarkOn(name, null, all) : ed.removeMarkOn(name, all)));
  }

  // ---------- 그리기 ----------
  render() { this.cached(() => this.renderNow()); }
  renderNow() {
    const v = this.view;
    const ns = this.nodes();
    const sig = JSON.stringify([v.selection, v.editing, !!v.crop, !!v.pathEdit, ns.map((n) => n.type),
      this.leaves().map((n) => [n.type, n.shape, typeof n.fill === 'object' ? n.fill?.type : 'solid', n.mask?.kind, n.area?.kind, n.area?.mode, !!n.crop, n.wrap?.shape || 0, !!(n.bg?.color && n.bg.color !== 'none'), !!n.locked]),
      this.flowSig(), v.presetsKey, v.crossPageLinks, ns.length ? null : [v.pageGuides().length, !!v.page.bgImage, isMaster(v.page), !!v.getMaster?.()]]);
    // 끄는 중(요소 옮기기·크기 바꾸기)에는 패널을 새로 만들지 않는다: 누르자마자 끌면 첫 프레임이 패널 만드는 시간만큼 밀린다.
    // 끄기가 끝나면(onChange) 다시 불려 만든다
    if (sig !== this.sig) { if (v.drag) return; this.sig = sig; this.build(); } else this.refresh();
  }

  // 글 흐름·프리셋 상태(바뀌면 패널을 다시 만든다: 버튼·안내가 달라짐)
  flowSig() {
    const v = this.view;
    const texts = this.leaves().filter((n) => n.type === 'text');
    if (!texts.length && !v.editing) return null;
    const { eds, all } = this.textTargets();
    return [texts.map((n) => { const ed = v.editorOf(n); return [M.storyOf(n), ed?.members?.length, ed?.overflow != null, Math.round((ed?.scale ?? 1) * 100)]; }),
      eds.map((ed) => ed.paragraphAttr('preset', all) ?? null), this.markValue('charStyle', (a) => a.id, () => null)];
  }

  refresh() { this.cached(() => { for (const f of this.fields) if (!f.el.contains(document.activeElement)) f.refresh(); }); }

  build() { this.cached(() => this.buildAll()); }
  // 캐시가 없을 때만 새로 만들고 끝나면 버린다(render 안에서 build·refresh를 부르면 같은 캐시를 씀)
  cached(fn) {
    const own = !this.cache;
    if (own) this.cache = new Map();
    try { return fn(); } finally { if (own) this.cache = null; }
  }
  buildAll() {
    this.fields = [];
    closeFontPicker();
    this.el.innerHTML = '';
    this.cur = null;
    const v = this.view;
    const ns = this.nodes();
    if (!ns.length) return this.buildPage();
    const leaves = this.leaves();
    const types = new Set(leaves.map((n) => n.type));
    const single = this.single();

    const KIND = { text: ['type', '글상자'], image: ['image', '이미지'], shape: ['square', '도형'], path: ['spline', '패스'], pathText: ['text-cursor', '경로 글자'], group: ['group', '그룹'] };
    const one = ns.length === 1 ? ns[0] : null;
    const [kIcon, kLabel] = one ? KIND[one.type] || ['square', '요소'] : ['copy', `${ns.length}개 선택`];
    const locked = one ? !!one.locked : false;
    this.head(kIcon, kLabel, v.editing ? '편집 중 · 선택한 글자에 적용' : one ? (one.name || '') : '', v.editing ? [] : [
      ['bring-to-front', '앞으로 (Ctrl+])', () => v.run('forward')], ['send-to-back', '뒤로 (Ctrl+[)', () => v.run('backward')],
      ns.length > 1 ? ['group', '그룹 (Ctrl+G)', () => v.run('group')] : one?.type === 'group' ? ['ungroup', '그룹 해제 (Ctrl+Shift+G)', () => v.run('ungroup')] : null,
      [locked ? 'lock' : 'unlock', '잠금 (Ctrl+Shift+L)', () => v.run('lock'), locked], ['eye-off', '숨김 (Ctrl+Shift+H)', () => v.run('hide')],
      ['copy', '복제 (Ctrl+D)', () => v.run('duplicate')], ['trash-2', '삭제 (Delete)', () => v.run('delete')],
    ].filter(Boolean));

    this.section('배치');
    this.iconRow([
      ['align-start-vertical', '왼쪽 맞춤', () => v.align('left')], ['align-center-vertical', '가로 가운데', () => v.align('hcenter')], ['align-end-vertical', '오른쪽 맞춤', () => v.align('right')],
      ['align-start-horizontal', '위쪽 맞춤', () => v.align('top')], ['align-center-horizontal', '세로 가운데', () => v.align('vcenter')], ['align-end-horizontal', '아래쪽 맞춤', () => v.align('bottom')], '|',
      ['align-horizontal-distribute-center', '가로 간격 같게(3개 이상)', () => v.distribute('h')], ['align-vertical-distribute-center', '세로 간격 같게(3개 이상)', () => v.distribute('v')],
    ]);
    const b = () => this.box();
    this.row(
      this.num('X', () => b()?.x, (x, live) => v.setBounds({ x }, live ? 'live:x' : 'bounds')),
      this.num('Y', () => b()?.y, (y, live) => v.setBounds({ y }, live ? 'live:y' : 'bounds')),
    );
    this.row(
      this.num('W', () => b()?.w, (w, live) => v.setBounds({ w }, live ? 'live:w' : 'bounds'), { min: 1 }),
      this.num('H', () => b()?.h, (h, live) => v.setBounds({ h }, live ? 'live:h' : 'bounds'), { min: 1 }),
    );
    if (single) this.row(this.num('회전', () => single.rotation || 0, (r, live) => v.setRotation(r, live ? 'live:rot' : 'rotate'), { suffix: '°' }));

    this.section('모양');
    this.row(
      this.num('불투명도', () => { const x = same(leaves.map((n) => n.opacity ?? 1)); return x === MIXED ? x : x * 100; },
        (o, live) => v.setProps({ opacity: Math.max(0, Math.min(100, o)) / 100 }, v.selection, live ? 'live:opacity' : 'props'), { suffix: '%', min: 0, max: 100 }),
      this.select('', BLENDS, () => same(leaves.map((n) => n.blend || 'normal')), (bl) => v.setProps({ blend: bl })),
    );

    const L = (label) => (live) => (live ? 'live:' + label : 'props');
    if (types.size === 1 && (types.has('shape') || types.has('path'))) {
      const isShape = types.has('shape');
      this.section(isShape ? '도형' : '패스');
      if (isShape) {
        this.row(this.select('모양', [['rect', '사각형'], ['ellipse', '원'], ['polygon', '다각형'], ['star', '별']], () => same(leaves.map((n) => n.shape || 'rect')), (shape) => v.setProps({ shape })));
        const kinds = new Set(leaves.map((n) => n.shape));
        if (kinds.has('polygon') || kinds.has('star')) this.row(
          this.num('꼭짓점', () => same(leaves.map((n) => n.sides || 6)), (k, live) => v.setProps({ sides: Math.max(3, Math.min(64, Math.round(k))) }, v.selection, L('sides')(live)), { min: 3, max: 64 }),
          kinds.has('star') ? this.num('안쪽', () => same(leaves.map((n) => Math.round((n.inner ?? 0.5) * 100))), (k, live) => v.setProps({ inner: Math.max(5, Math.min(100, k)) / 100 }, v.selection, L('inner')(live)), { suffix: '%', min: 5, max: 100 }) : null);
      }
      this.buildFill(leaves);
      this.row(this.color('테두리', () => same(leaves.map((n) => normHex(n.stroke) ?? n.stroke)), (c, live) => v.setProps({ stroke: c || '#000000' }, v.selection, L('stroke')(live))));
      this.row(
        this.num('두께', () => same(leaves.map((n) => n.strokeWidth || 0)), (w, live) => v.setProps({ strokeWidth: Math.max(0, w) }, v.selection, L('sw')(live)), { min: 0 }),
        isShape && leaves.every((n) => (n.shape || 'rect') === 'rect') ? this.num('모서리', () => same(leaves.map((n) => n.radius || 0)), (r, live) => v.setProps({ radius: Math.max(0, r) }, v.selection, L('radius')(live)), { min: 0 }) : null,
      );
      if (!isShape) this.row(this.select('선 끝', [['round', '둥글게'], ['butt', '평평하게'], ['square', '네모']], () => same(leaves.map((n) => n.cap || 'round')), (cap) => v.setProps({ cap })));
      if (ns.length === 1) this.row(
        !isShape ? this.button('점 편집', () => v.run('editPath'), '패스를 더블클릭해도 됩니다. Delete = 점 지우기, Enter·Esc = 끝') : null,
        this.button('경로 글자로', () => v.run('textOnPath'), '이 모양을 따라 글자를 씁니다(원래 요소는 경로 글자로 바뀜)'));
    }
    if (types.size === 1 && types.has('image')) {
      this.section('이미지');
      this.row(this.select('맞춤', [['fill', '늘이기'], ['contain', '맞추기'], ['cover', '채우기']], () => same(leaves.map((n) => n.fit || 'fill')), (fit) => v.setProps({ fit })));
      if (ns.length === 1) this.row(
        this.button(v.crop ? '자르기 끝' : '자르기', () => (v.crop ? v.exitCrop() : v.run('crop')), '이미지를 더블클릭해도 됩니다. 테두리 = 자를 범위, 안쪽 끌기 = 보이는 부분 옮기기'),
        leaves[0].crop ? this.button('자르기 해제', () => v.run('resetCrop')) : null);
      if (ns.length === 1 && this.pickImage) this.row(this.button('이미지 바꾸기…', async () => { const im = await this.pickImage(); if (im) v.replaceImage(leaves[0].id, im.src); }, '상자·필터·마스크는 그대로 두고 이미지만 바꿉니다(상자를 채우게 맞춤)'));
      this.section('필터');
      const F = [['brightness', '밝기', '%'], ['contrast', '대비', '%'], ['saturate', '채도', '%'], ['hue', '색조', '°'], ['blur', '흐림', 'px'], ['grayscale', '흑백', '%'], ['sepia', '세피아', '%'], ['invert', '반전', '%']];
      for (let i = 0; i < F.length; i += 2) this.row(...F.slice(i, i + 2).map(([k, label, suffix]) =>
        this.num(label, () => same(leaves.map((n) => (n.filters?.[k] ?? FILTER_DEFAULTS[k]))),
          (val, live) => v.setProps({ filters: { ...(leaves[0].filters || {}), [k]: val } }, v.selection, L('f-' + k)(live)), { suffix, min: k === 'hue' ? -360 : 0, max: k === 'hue' ? 360 : k === 'blur' ? 200 : ['brightness', 'contrast', 'saturate'].includes(k) ? 400 : 100 })));
      this.row(this.button('필터 초기화', () => v.setProps({ filters: null })));
      this.section('마스크');
      const mk = same(leaves.map((n) => n.mask?.kind || ''));
      this.note(mk === 'shape' ? '도형 마스크 적용 중' : mk === 'alpha' ? '알파 마스크 적용 중' : '이미지와 도형을 함께 선택하면 "도형으로 마스크"가 나옵니다.');
      this.row(
        this.pickImage ? this.button('알파 마스크 이미지…', async () => { const im = await this.pickImage(); if (im) v.setProps({ mask: { kind: 'alpha', src: im.src } }); }, '고른 이미지의 투명한 곳은 가려집니다') : null,
        mk && mk !== MIXED ? this.button('마스크 해제', () => v.setProps({ mask: null })) : null);
    }
    if (types.size === 1 && types.has('pathText')) this.buildPathText(leaves);
    if (!v.editing && leaves.length && leaves.every((n) => WRAP_TYPES.has(n.type))) this.buildWrap(leaves);
    // 두 요소 조합
    if (v.pairFor(['image'])) { this.section('조합'); this.row(this.button('도형으로 마스크', () => v.run('mask'), '도형 모양대로 이미지를 자르고 도형은 지웁니다')); }
    if (v.pairFor(['text'])) { this.section('조합'); this.row(this.button('도형 모양으로 글상자', () => v.run('areaFromShape'), '도형 모양 안에 글을 흘려 넣고 도형은 지웁니다')); }
    if (types.has('text') || v.editing) this.buildText();
    if (single && (single.type === 'image' || single.type === 'text') && !v.editing) {
      this.section('템플릿');
      this.row(this.check('슬롯(바꿔 넣을 자리)', () => !!single.slot, (on) => v.setProps({ slot: on || undefined }, [single.id])));
    }    // 글상자 편집 중에는 글자 칸이 먼저(배치·모양은 뒤로)
    if (v.editing) for (const t of ['배치', '모양']) { const sec = this.el.querySelector(`.pp-sec[data-sec="${t}"]`); if (sec) this.el.appendChild(sec); }
  }

  buildPage() {
    const v = this.view;
    this.head('layout-template', isMaster(v.page) ? '공통 장' : '장', `${v.page.w} × ${v.page.h}px`);
    this.section('장');
    // 크기 고르기(용지·SNS). 지금 방향(가로·세로)을 지킨다. 정사각에서 고르면 그 크기 본래 방향
    this.row(this.select('크기', [['custom', '직접 입력'], ...SIZE_PRESETS.map((p) => [p.id, `${p.group} · ${p.name}`])],
      () => matchSize(v.page.w, v.page.h)?.preset.id || 'custom',
      (id) => { if (id === 'custom') return; const { w, h } = v.page; const sz = sizeOf(id, w > h ? true : w < h ? false : null); if (sz) v.setPageProps(sz); }));
    this.row(this.button('가로·세로 바꾸기', () => v.setPageProps({ w: v.page.h, h: v.page.w }), '장의 너비와 높이를 맞바꿉니다(요소는 그 자리에)'));
    this.row(
      this.num('너비', () => v.page.w, (w) => v.setPageProps({ w: Math.max(1, Math.round(w)) }), { min: 1 }),
      this.num('높이', () => v.page.h, (h) => v.setPageProps({ h: Math.max(1, Math.round(h)) }), { min: 1 }),
    );
    this.row(this.color('배경', () => (v.page.background === 'transparent' ? '' : v.page.background),
      (c, live) => v.setPageProps({ background: c || 'transparent' }, live ? 'live:bg' : 'page'), true));
    // 배경 이미지는 늘 지금 장의 값을 읽는다(패널은 장을 바꿔도 다시 만들지 않고 값만 새로 채운다)
    const bgi = () => v.page.bgImage;
    const has = !!bgi();
    this.row(
      this.pickImage ? this.button(has ? '배경 이미지 바꾸기…' : '배경 이미지…', async () => { const im = await this.pickImage(); if (im) v.setPageProps({ bgImage: { src: im.src, fit: bgi()?.fit || 'cover' } }); }, '장 전체에 까는 이미지. 요소가 아니라 장 속성이라 선택·이동되지 않습니다') : null,
      has ? this.button('배경 이미지 빼기', () => v.setPageProps({ bgImage: undefined })) : null,
    );
    if (has) this.row(this.select('배경 맞춤', [['cover', '채우기'], ['contain', '맞추기'], ['fill', '늘이기'], ['tile', '바둑판']], () => bgi()?.fit || 'cover', (fit) => v.setPageProps({ bgImage: { ...bgi(), fit } })));
    // 공통 장
    if (isMaster(v.page)) {
      this.section('공통 장');
      this.note(`여기 놓은 요소는 모든 장의 맨 뒤에 깔립니다. 글상자에 ${TOKENS.page}를 쓰면 그 장의 쪽 번호, ${TOKENS.total}는 마지막 쪽 번호로 바뀝니다.`);
      this.row(this.num('첫 쪽 번호', () => v.pageStart?.() ?? 1, (n) => v.setPageStart?.(n), { step: 1 }));
    } else if (v.getMaster?.()) {
      this.section('공통 장');
      this.row(this.check('공통 요소 보이기', () => !v.page.noMaster, (on) => v.setPageProps({ noMaster: on ? undefined : true })));
    }
    this.section('격자·가이드');
    this.row(this.num('격자 간격', () => v.gridSize, (g) => v.setGridSize(Math.max(2, Math.min(500, Math.round(g)))), { suffix: 'px', min: 2, max: 500 }));
    const ng = v.pageGuides().length;
    this.note(ng ? `이 장의 가이드 ${ng}개` : '가이드: 눈금자에서 캔버스로 끌어 만듭니다.');
    if (ng) this.row(this.button('가이드 모두 지우기', () => v.clearGuides()));
    this.note('요소를 선택하면 요소 속성이 나옵니다.');
  }

  buildText() {
    const v = this.view;
    this.section(v.editing ? '글자 (선택한 글자에)' : '글자 (글상자 전체에)');
    this.row(this.fontField(() => this.markValue('font', (a) => firstFamily(a.value), (ed) => firstFamily(this.frameStyle(ed, 'fontFamily'))),
      (f) => this.setMark('font', f ? { value: fontStack(f) } : null)));
    this.row(
      this.num('크기', () => this.markValue('size', (a) => a.value, (ed) => this.frameStyle(ed, 'fontSize')), (s) => this.setMark('size', { value: Math.max(1, s) }), { min: 1 }),
      this.num('행간', () => this.markValue('lineHeight', (a) => a.value, (ed) => this.frameStyle(ed, 'lineHeight')), (s) => this.setMark('lineHeight', { value: Math.max(0.5, s) }), { step: 0.1 }),
      this.num('자간', () => this.markValue('spacing', (a) => a.value, () => 0), (s) => this.setMark('spacing', s ? { value: s } : null)),
    );
    // 문단 간격: Enter로 나눈 문단 사이에 더 띄우는 거리(글상자 전체, 이어진 글상자는 첫 글상자 값). 0이면 Enter = 줄 간격만큼
    const heads = () => { const v2 = this.view; return [...new Set(this.textTargets().nodes.map((n) => { const ed = v2.editorOf(n); return v2.node(ed?.members?.[0]) || n; }))]; };
    this.row(this.num('문단 간격', () => same(heads().map((n) => (Number.isFinite(+n.paraSpacing) ? +n.paraSpacing : 8))), (s) => this.view.setProps({ paraSpacing: Math.max(0, s) }, heads().map((n) => n.id)), { suffix: 'px', min: 0 }));
    const alignOf = () => { const { eds, all } = this.textTargets(); return same(eds.map((ed) => ed.paragraphAttr('align', all) ?? 'left')); };
    this.row(
      this.seg(...[['bold', 'B', '굵게'], ['italic', 'I', '기울임'], ['underline', 'U', '밑줄'], ['strike', 'S', '취소선']].map(([m, t, title]) =>
        this.toggleBtn(t, title, () => this.toggleState(m), () => this.toggle(m)))),
      this.seg(...[['left', '왼쪽'], ['center', '가운데'], ['right', '오른쪽'], ['justify', '양쪽']].map(([a, t]) =>
        this.toggleBtn(t, `${t} 정렬`, () => String(alignOf() === a), () => this.applyText((ed, all) => ed.setParagraphAttrs({ align: a === 'left' ? null : a }, all))))),
    );
    this.row(this.color('색', () => this.markValue('color', (a) => a.value, (ed) => this.frameStyle(ed, 'color')), (c) => this.setMark('color', { value: c })));
    this.row(this.color('형광펜', () => this.markValue('highlight', (a) => a.value, () => ''), (c) => this.setMark('highlight', c ? { value: c } : null), true));
    // 기호 넣기(말줄임표·가로선·괄호·도형…): 편집 중이면 커서 자리에, 아니면 고른 글상자 끝에
    const symBtn = this.button('기호 넣기 …— ※', () => openSymbolPicker({ anchor: symBtn.el, insert: (t) => this.insertSymbol(t) }), '말줄임표·가로선·괄호·도형·화살표 같은 기호를 눌러서 넣습니다');
    symBtn.el.dataset.field = '기호 넣기';
    this.row(symBtn);
    if (isMaster(v.page) && v.editing) {
      // 공통 장 글상자: 장마다 번호로 바뀌는 자리 표시
      const put = (t) => { const ed = v.activeEditor; if (ed) { ed.insertText(t); ed.focus(); } };
      this.row(this.button('쪽 번호 넣기', () => put(TOKENS.page), `${TOKENS.page} — 장마다 그 장의 쪽 번호로 바뀝니다`),
        this.button('전체 쪽수 넣기', () => put(TOKENS.total), `${TOKENS.total} — 마지막 쪽 번호로 바뀝니다`));
    }
    this.buildPresets();
    const { nodes } = this.textTargets();
    this.row(this.num('안쪽 여백', () => same(nodes.map((n) => n.padding || 0)), (p) => v.setProps({ padding: p }, nodes.map((n) => n.id)), { min: -200 }));
    this.buildTextBg(nodes);
    this.buildArea(nodes);
    this.buildFlow(nodes);
  }

  // 스타일 프리셋: 문단에 이름 붙은 글자 모양을 건다. 프리셋을 고치면 그 프리셋을 쓰는 모든 문단이 바뀐다
  buildPresets() {
    const v = this.view;
    const ps = v.presets || {};
    const ids = Object.keys(ps).filter((id) => ps[id].kind !== 'char'); // 문단 프리셋
    const cur = () => { const { eds, all } = this.textTargets(); return same(eds.map((ed) => ed.paragraphAttr('preset', all) ?? '__none')); };
    this.section('스타일 프리셋');
    this.row(this.select('프리셋', [['__none', '없음'], ...ids.map((id) => [id, esc(ps[id].name || '이름 없음')])], cur, (id) => {
      this.applyText((ed, all) => (id === '__none' ? ed.setParagraphAttrs({ preset: null }, all) : ed.applyPreset(id, all)));
    }));
    const now = cur();
    const pick = now && now !== MIXED && now !== '__none' && ps[now] ? now : null;
    this.row(
      this.button('새 프리셋', async () => {
        const { eds, all } = this.textTargets();
        if (!eds.length) return;
        const name = await this.ask('새 프리셋 이름', `프리셋 ${ids.length + 1}`);
        if (!name) return;
        const id = M.uid();
        this.history.batch(() => {
          v.definePreset(id, { name, ...eds[0].presetFromHere(all) });
          for (const ed of eds) ed.applyPreset(id, all);
        });
      }, '지금 글자 모양으로 프리셋을 만들고 이 문단에 겁니다'),
      pick ? this.button('다시 정의', () => { const { eds, all } = this.textTargets(); v.definePreset(pick, eds[0].presetFromHere(all)); }, '지금 글자 모양으로 이 프리셋을 고칩니다(이 프리셋을 쓰는 모든 문단이 바뀜)') : null,
    );
    if (pick) this.row(
      this.button('이름 바꾸기', async () => { const name = await this.ask('프리셋 이름', ps[pick].name); if (name) v.definePreset(pick, { name }); }),
      this.button('프리셋 지우기', () => v.deletePreset(pick), '이 프리셋을 쓰던 문단은 글상자 기본 모양으로 돌아갑니다'),
    );
    this.buildCharPresets();
  }

  // 글자 스타일 프리셋: 고른 글자에 건다(편집 중이 아니면 글상자 전체). 문단 프리셋 위에 덮이고, 개별 꾸밈이 그 위에 덮인다
  buildCharPresets() {
    const v = this.view;
    const ps = v.presets || {};
    const ids = Object.keys(ps).filter((id) => ps[id].kind === 'char');
    const cur = () => this.markValue('charStyle', (a) => a.id, () => '__none');
    this.row(this.select('글자 프리셋', [['__none', '없음'], ...ids.map((id) => [id, esc(ps[id].name || '이름 없음')])], cur, (id) => {
      this.applyText((ed, all) => ed.applyCharPreset(id === '__none' ? null : id, all));
    }));
    const now = cur();
    const pick = now && now !== MIXED && now !== '__none' && ps[now] ? now : null;
    const styleHere = () => { const { eds, all } = this.textTargets(); return { style: eds[0].presetFromHere(all).style }; };
    this.row(
      this.button('새 글자 프리셋', async () => {
        const { eds, all } = this.textTargets();
        if (!eds.length) return;
        const name = await this.ask('새 글자 프리셋 이름', `글자 프리셋 ${ids.length + 1}`);
        if (!name) return;
        const id = M.uid();
        this.history.batch(() => {
          v.definePreset(id, { name, kind: 'char', ...styleHere() });
          for (const ed of eds) ed.applyCharPreset(id, all);
        });
      }, '지금 글자 모양으로 글자 프리셋을 만들고 고른 글자에 겁니다'),
      pick ? this.button('글자 프리셋 다시 정의', () => v.definePreset(pick, styleHere()), '지금 글자 모양으로 이 글자 프리셋을 고칩니다(이 프리셋을 쓰는 모든 글자가 바뀜)') : null,
    );
    if (pick) this.row(
      this.button('글자 프리셋 이름', async () => { const name = await this.ask('글자 프리셋 이름', ps[pick].name); if (name) v.definePreset(pick, { name }); }),
      this.button('글자 프리셋 지우기', () => v.deletePreset(pick), '이 프리셋을 쓰던 글자는 문단 모양으로 돌아갑니다'),
    );
  }
  async ask(message, value) {
    const r = this.promptName ? await this.promptName(message, value) : window.prompt(message, value);
    return r && r.trim() ? r.trim() : null;
  }

  // 글 흐름: 이어진 글상자, 자동 축소
  buildFlow(nodes) {
    const v = this.view;
    if (!nodes.length) return;
    this.section('글 흐름');
    const heads = [...new Set(nodes.map((n) => v.storyMembers(M.storyOf(n))[0]).filter(Boolean))];
    this.row(this.check('넘치면 글자 줄이기', () => same(heads.map((h) => !!h.autoShrink)), (on) => v.setProps({ autoShrink: on }, heads.map((h) => h.id))),
      this.num('최소', () => same(heads.map((h) => Math.round((h.minScale ?? 0.5) * 100))), (x) => v.setProps({ minScale: Math.max(10, Math.min(100, x)) / 100 }, heads.map((h) => h.id)), { suffix: '%', min: 10, max: 100 }));
    const eds = [...new Set(nodes.map((n) => v.editorOf(n)).filter(Boolean))];
    if (eds.length === 1) {
      const ed = eds[0];
      const list = v.storyMembers(ed.storyId);
      const bits = [];
      if (list.length > 1 && nodes.length === 1) bits.push(`이어진 글상자 ${list.findIndex((n) => n.id === nodes[0].id) + 1}/${list.length}`);
      if (ed.scale < 1) bits.push(`글자 ${Math.round(ed.scale * 100)}%로 줄임`);
      bits.push(ed.overflow != null ? '글이 넘침' : '글이 모두 들어감');
      this.note(bits.join(' · '));
      if (list.length > 1 && nodes.length === 1 && !v.editing) this.row(this.button('이어짐에서 빼기', () => v.unlinkFrame(nodes[0].id), '이 글상자를 빼고 글은 나머지 글상자로 흐르게 합니다'));
      if (nodes.length === 1 && !v.editing && v.crossPageLinks !== false && !isMaster(v.page) && list[list.length - 1]?.id === nodes[0].id)
        this.row(this.button('다음 장으로 이어 쓰기', () => v.flowToNextPage(nodes[0].id), '다음 장(없으면 새 장)의 같은 자리에 같은 크기 글상자를 만들어 잇습니다'));
    }
    const sel = v.selection.map((id) => v.node(id));
    if (!v.editing && sel.length === 2 && sel.every((n) => n?.type === 'text') && M.storyOf(sel[0]) !== M.storyOf(sel[1]))
      this.row(this.button('글상자 잇기', () => v.linkFrames(sel[0].id, sel[1].id), '먼저 고른 글상자에서 넘친 글이 나중 고른 글상자로 이어집니다'));
    if (!v.editing) this.note('넘친 글상자의 빨간 +(출구)를 누르고 다른 글상자나 빈 곳을 누르면 이어집니다.');
  }

  // 글 피해 가기: 이 사진·도형 둘레로 같은 장의 글상자 글이 흐른다(사진을 옮기면 글도 따라 다시 흐름)
  buildWrap(leaves) {
    const v = this.view;
    const W = (k, d) => same(leaves.map((n) => (n.wrap ? cleanWrap(n.wrap)[k] : d)));
    const isOn = () => same(leaves.map((n) => !!n.wrap));
    const on = isOn();
    const setW = (patch, live) => v.change(live ? 'live:wrap' : 'props', () => { for (const n of leaves) n.wrap = patch === null ? undefined : { ...cleanWrap(n.wrap || {}), ...patch }; });
    this.section('글 피해 가기');
    this.row(this.check('글이 이 요소를 피해 흐르게', isOn, (yes) => setW(yes ? {} : null)));
    if (on === true) {
      const hasImg = leaves.some((n) => n.type === 'image');
      this.row(this.select('모양', WRAP_SHAPES.map(([k, t]) => [k, k === 'box' && !hasImg ? '상자(네모)' : k === 'outline' && hasImg ? '그림 윤곽선(투명 배경)' : t]), () => W('shape', 'box'), (shape) => setW({ shape })));
      this.row(this.num('간격', () => W('gap', 16), (gap, live) => setW({ gap: Math.max(0, Math.min(500, gap)) }, live), { suffix: 'px', min: 0, max: 500 }),
        this.select('', WRAP_SIDES, () => W('side', 'both'), (side) => setW({ side })));
      if (W('shape', 'box') === 'outline' && hasImg) this.note('그림 윤곽선: 투명한 곳(투명 배경 PNG)은 글이 들어옵니다. 배경이 꽉 찬 사진이면 상자와 같습니다.');
    } else this.note('켜면 같은 장의 글상자 글이 이 요소 둘레로 비켜 흐릅니다. 요소를 옮기면 글도 따라 다시 흐릅니다.');
  }

  // 기호 하나 넣기. 편집 중이 아니면 고른 글상자(첫 번째)를 편집 상태로 바꾸고 글 끝에 넣는다
  insertSymbol(t) {
    const v = this.view;
    let ed = v.editing ? v.activeEditor : null;
    if (!ed) {
      const n = this.textTargets().nodes[0];
      if (!n) return false;
      v.enterEdit(n.id);
      ed = v.activeEditor;
      if (!ed) return false;
      const end = Math.max(1, ed.state.doc.content.size - 1);
      ed.selectRange(end, end);
    }
    if (ed.comp) ed.commitComposition();
    ed.insertText(t);
    ed.focus();
    return true;
  }

  // 글상자 바탕: 색 채우기 + 불투명도, 모서리 둥글기, 테두리. 글상자 모양(원·도넛·자유형)을 따라 칠한다
  buildTextBg(nodes) {
    const v = this.view;
    if (!nodes.length) return;
    const B = (k, d) => same(nodes.map((n) => n.bg?.[k] ?? d));
    const on = () => same(nodes.map((n) => !!(n.bg?.color && n.bg.color !== 'none')));
    // 바탕 값 바꾸기. 끌며 바꾸는 중(live)이면 한 단위로 묶는다
    const setB = (patch, live, key = 'bg') => v.change(live ? 'live:' + key : 'props', () => {
      for (const n of nodes) {
        const b = { color: 'none', opacity: 1, radius: 0, ...(n.bg || {}), ...patch };
        n.bg = b.color === 'none' && !(b.strokeWidth > 0) ? undefined : b;
      }
    });
    this.section('글상자 바탕');
    this.row(this.color('바탕색', () => { const c = B('color', ''); return c === 'none' ? '' : c; }, (c, live) => setB({ color: c || 'none' }, live, 'bg-color'), true));
    const hasRect = nodes.some((n) => !n.area || n.area.kind === 'rect' || n.area.kind === 'image' || n.area.invert);
    this.row(
      this.num('불투명도', () => { const x = B('opacity', 1); return x === MIXED ? x : Math.round(x * 100); }, (o, live) => setB({ opacity: Math.max(0, Math.min(100, o)) / 100 }, live, 'bg-op'), { suffix: '%', min: 0, max: 100 }),
      hasRect ? this.num('모서리', () => B('radius', 0), (r, live) => setB({ radius: Math.max(0, r) }, live, 'bg-r'), { min: 0 }) : null,
    );
    this.row(
      this.color('테두리', () => B('stroke', '#000000'), (c, live) => c && setB({ stroke: c }, live, 'bg-stroke')),
      this.num('두께', () => B('strokeWidth', 0), (w, live) => setB({ strokeWidth: Math.max(0, w) }, live, 'bg-sw'), { min: 0 }),
    );
    if (on() !== true) this.note('바탕색을 고르면 글상자 뒤를 칠합니다. 불투명도를 낮추면 뒤 그림이 비쳐 보입니다.');
    else this.row(this.button('바탕 없애기', () => v.change('props', () => { for (const n of nodes) n.bg = undefined; }), '바탕색과 테두리를 모두 지웁니다'));
  }

  // 글상자 모양: 사각형 / 원 / 도넛 / 자유형(도형에서) / 이미지 외곽선. 여백(안쪽 여백)·다듬기·최소 구간·반전
  buildArea(nodes) {
    const v = this.view;
    const A = (k, d) => same(nodes.map((n) => n.area?.[k] ?? d));
    const setA = (patch, label = 'area') => v.change(label, () => { for (const n of nodes) n.area = { ...(n.area || { kind: 'rect' }), ...patch }; });
    this.section('글상자 모양');
    const kind = A('kind', 'rect');
    const opts = [['rect', '사각형'], ['ellipse', '원'], ['donut', '도넛'], ['image', '이미지 외곽선']];
    if (kind === 'path') opts.push(['path', '자유형(도형에서)']);
    this.row(this.select('모양', opts, () => A('kind', 'rect'), async (k) => {
      if (k === 'image') {
        const im = this.pickImage && await this.pickImage();
        if (!im) { this.refresh(); return; }
        setA({ kind: 'image', src: im.src, mode: 'alpha', show: true, opacity: 1, fit: 'contain' });
      } else setA({ kind: k });
    }));
    if (kind === 'donut') this.row(this.num('안쪽 구멍', () => { const x = A('inner', 0.45); return x === MIXED ? x : x * 100; }, (x) => setA({ inner: Math.max(5, Math.min(95, x)) / 100 }), { suffix: '%', min: 5, max: 95 }));
    if (kind === 'image') {
      this.row(this.select('판정', [['alpha', '투명도'], ['colorKey', '배경색']], () => A('mode', 'alpha'), (mode) => setA({ mode })),
        this.button('이미지 바꾸기…', async () => { const im = this.pickImage && await this.pickImage(); if (im) setA({ src: im.src }); }));
      if (A('mode', 'alpha') === 'colorKey') this.row(this.color('배경색', () => A('color', '#ffffff'), (c) => c && setA({ color: c })), this.num('허용 오차', () => A('tolerance', 40), (t) => setA({ tolerance: Math.max(0, Math.min(441, t)) }), { min: 0, max: 441 }));
      else this.row(this.num('임계값', () => A('threshold', 128), (t) => setA({ threshold: Math.max(1, Math.min(255, t)) }), { min: 1, max: 255 }));
      this.row(this.check('이미지 보이기', () => A('show', true), (on) => setA({ show: on })),
        this.num('불투명도', () => { const x = A('opacity', 1); return x === MIXED ? x : x * 100; }, (o) => setA({ opacity: Math.max(0, Math.min(100, o)) / 100 }), { suffix: '%', min: 0, max: 100 }));
    }
    this.row(this.num('다듬기', () => A('smooth', 0), (x) => setA({ smooth: Math.max(0, Math.min(40, x)) }), { min: 0, max: 40 }),
      this.num('최소 구간', () => A('minWidth', 8), (x) => setA({ minWidth: Math.max(1, x) }), { min: 1 }));
    this.row(this.check('반전(모양 바깥에 글)', () => A('invert', false), (on) => setA({ invert: on })));
  }

  // 채움: 단색 / 선형 그라디언트 / 원형 그라디언트 / 패턴(이미지 반복)
  buildFill(leaves) {
    const v = this.view;
    const typeOf = (f) => (f && typeof f === 'object' ? f.type : 'solid');
    const t = same(leaves.map((n) => typeOf(n.fill)));
    const first = leaves[0].fill;
    const setFill = (f, live) => v.setProps({ fill: f }, v.selection, live ? 'live:fill' : 'props');
    this.row(this.select('채움', [['solid', '단색'], ['linear', '선형 그라디언트'], ['radial', '원형 그라디언트'], ['pattern', '패턴']], () => t, async (nt) => {
      const cur = typeof first === 'string' && first !== 'none' ? first : '#d9d4ff';
      if (nt === 'solid') setFill(cur);
      else if (nt === 'linear' || nt === 'radial') setFill({ type: nt, angle: 90, stops: [{ o: 0, c: cur }, { o: 1, c: '#2b3a66' }] });
      else if (nt === 'pattern') {
        const im = this.pickImage && await this.pickImage();
        if (im) setFill({ type: 'pattern', src: im.src, w: im.w, h: im.h, scale: 1 }); else this.refresh();
      }
    }));
    if (t === 'solid') this.row(this.color('색', () => same(leaves.map((n) => normHex(n.fill) ?? n.fill)), (c, live) => setFill(c || 'none', live), true));
    if (t === 'linear' || t === 'radial') {
      const stop = (i) => same(leaves.map((n) => n.fill.stops?.[i]?.c));
      const setStop = (i, c, live) => { const f = JSON.parse(JSON.stringify(first)); f.stops[i].c = c; setFill(f, live); };
      this.row(this.color('시작 색', () => stop(0), (c, live) => c && setStop(0, c, live)));
      this.row(this.color('끝 색', () => stop(1), (c, live) => c && setStop(1, c, live)));
      if (t === 'linear') this.row(this.num('각도', () => same(leaves.map((n) => n.fill.angle ?? 90)), (a, live) => setFill({ ...JSON.parse(JSON.stringify(first)), angle: a }, live), { suffix: '°', min: -360, max: 360 }));
    }
    if (t === 'pattern') this.row(this.num('배율', () => same(leaves.map((n) => Math.round((n.fill.scale ?? 1) * 100))), (k, live) => setFill({ ...first, scale: Math.max(1, k) / 100 }, live), { suffix: '%', min: 1 }),
      this.button('이미지 바꾸기…', async () => { const im = this.pickImage && await this.pickImage(); if (im) setFill({ ...first, src: im.src, w: im.w, h: im.h }); }));
  }

  // 경로 글자: 글·글꼴·크기·색·굵게·시작 위치·정렬·경로 보이기
  buildPathText(leaves) {
    const v = this.view;
    const S = (k, d) => same(leaves.map((n) => n.style?.[k] ?? d));
    const setS = (patch, live) => v.change(live ? 'live:pts' : 'props', () => { for (const n of leaves) n.style = { ...(n.style || {}), ...patch }; });
    this.section('경로 글자');
    this.row(this.text('글', () => same(leaves.map((n) => n.text || '')), (t) => v.setProps({ text: t })));
    this.row(this.fontField(() => { const f = S('fontFamily', ''); return f === MIXED ? f : firstFamily(f) || 'Noto Sans KR'; }, (f) => setS({ fontFamily: f ? fontStack(f) : undefined })));
    this.row(this.num('크기', () => S('fontSize', 32), (x, live) => setS({ fontSize: Math.max(1, x) }, live), { min: 1 }),
      this.num('자간', () => S('letterSpacing', 0), (x, live) => setS({ letterSpacing: x }, live)));
    this.row(this.color('색', () => S('color', '#1f1f1f'), (c, live) => c && setS({ color: c }, live)),
      this.toggleBtn('B', '굵게', () => String(S('fontWeight', 400) >= 600), () => setS({ fontWeight: S('fontWeight', 400) >= 600 ? 400 : 700 })));
    this.row(this.num('시작 위치', () => same(leaves.map((n) => n.offset || 0)), (x, live) => v.setProps({ offset: Math.max(0, Math.min(100, x)) }, v.selection, live ? 'live:offset' : 'props'), { suffix: '%', min: 0, max: 100 }),
      this.select('', [['start', '시작점부터'], ['middle', '가운데'], ['end', '끝에 맞춤']], () => same(leaves.map((n) => n.anchor || 'start')), (anchor) => v.setProps({ anchor })));
    this.row(this.check('경로 보이기', () => same(leaves.map((n) => !!n.showPath)), (on) => v.setProps({ showPath: on })));
  }

  // ---------- 칸 만들기 ----------
  // 칸(접을 수 있음). 제목의 괄호 부분은 작은 글씨로. 접힘 상태는 이 컴퓨터에 기억하고,
  // 기억한 것이 없으면 글상자 편집 중에는 배치·모양·글상자 모양·글 흐름을 접어 둔다(글자에 집중)
  section(t) {
    const m = /^(.*?)\s*\((.*)\)$/.exec(t);
    const title = m ? m[1] : t, sub = m ? m[2] : '';
    const sec = document.createElement('section');
    sec.className = 'pp-sec';
    sec.dataset.sec = title;
    const closed = this.isClosed(title);
    if (closed) sec.classList.add('closed');
    const h = document.createElement('button');
    h.type = 'button';
    h.className = 'pp-h';
    const tt = document.createElement('span'); tt.textContent = title;
    h.append(iconEl(closed ? 'chevron-right' : 'chevron-down', 14), tt);
    if (sub) { const sm = document.createElement('small'); sm.textContent = sub; h.appendChild(sm); }
    h.addEventListener('mousedown', (e) => e.preventDefault());
    h.addEventListener('click', () => {
      const now = !sec.classList.contains('closed');
      sec.classList.toggle('closed', now);
      h.firstElementChild.replaceWith(iconEl(now ? 'chevron-right' : 'chevron-down', 14));
      this.setClosed(title, now);
    });
    const body = document.createElement('div');
    body.className = 'pp-body';
    sec.append(h, body);
    this.el.appendChild(sec);
    this.cur = body;
  }
  isClosed(title) {
    const key = (this.view.editing ? 'edit:' : '') + title;
    if (key in this.closedState) return this.closedState[key];
    return this.view.editing ? EDIT_CLOSED.has(title) : CLOSED.has(title);
  }
  setClosed(title, on) {
    this.closedState[(this.view.editing ? 'edit:' : '') + title] = on;
    try { localStorage.setItem(CLOSED_PREF, JSON.stringify(this.closedState)); } catch { /* 이번 실행에만 */ }
  }
  host() { return this.cur || this.el; }
  note(t) { const p = document.createElement('div'); p.className = 'note'; p.textContent = t; this.host().appendChild(p); }
  row(...items) {
    const r = document.createElement('div');
    r.className = 'row';
    for (const it of items) if (it) r.appendChild(it.el);
    this.host().appendChild(r);
    return r;
  }
  // 같은 종류 버튼 묶음(굵게·기울임…, 정렬)
  seg(...items) {
    const g = document.createElement('div');
    g.className = 'seg';
    for (const it of items) if (it) g.appendChild(it.el);
    return { el: g };
  }
  // 아이콘 버튼 줄(정렬·분배)
  iconRow(list) {
    const r = document.createElement('div');
    r.className = 'icorow';
    for (const it of list) {
      if (it === '|') { r.appendChild(document.createElement('i')); continue; }
      const [name, title, act] = it;
      const b = document.createElement('button');
      b.type = 'button'; b.title = title; b.dataset.field = title; b.appendChild(iconEl(name, 16));
      b.addEventListener('mousedown', (e) => e.preventDefault());
      b.addEventListener('click', act);
      r.appendChild(b);
    }
    this.host().appendChild(r);
  }
  // 맨 위: 무엇을 골랐는지 + 요소 명령(순서·그룹·잠금·숨김·복제·삭제)
  head(kindIcon, label, sub, acts = []) {
    const h = document.createElement('div');
    h.className = 'pp-head';
    const kind = document.createElement('div'); kind.className = 'pp-kind';
    const bl = document.createElement('b'); bl.textContent = label; const sp = document.createElement('span'); sp.textContent = sub || '';
    kind.append(iconEl(kindIcon, 16), bl, sp); h.appendChild(kind);
    if (acts.length) {
      const r = document.createElement('div');
      r.className = 'pp-acts';
      for (const [name, title, act, pressed] of acts) {
        const b = document.createElement('button');
        b.type = 'button'; b.title = title; b.dataset.field = title; b.appendChild(iconEl(name, 16));
        if (pressed != null) b.setAttribute('aria-pressed', String(pressed));
        b.addEventListener('mousedown', (e) => e.preventDefault());
        b.addEventListener('click', act);
        r.appendChild(b);
      }
      h.appendChild(r);
    }
    this.el.appendChild(h);
  }
  reg(f) { this.fields.push(f); f.refresh(); return f; }

  num(label, get, set, { suffix = '', min = -Infinity, max = Infinity, step = 1 } = {}) {
    const el = document.createElement('label');
    el.className = 'f';
    el.innerHTML = `<span>${label}</span><input class="num" type="text" inputmode="decimal" spellcheck="false">${suffix ? `<span>${suffix}</span>` : ''}`;
    const inp = el.querySelector('input');
    inp.dataset.field = label;
    const f = { el, refresh: () => { const val = get(); inp.value = fmt(val); inp.placeholder = val === MIXED ? '여러 값' : ''; } };
    const clamp = (x) => Math.min(max, Math.max(min, x));
    const commit = () => {
      const t = inp.value.trim();
      if (t === '' || !Number.isFinite(+t)) { f.refresh(); return; }
      const cur = get();
      if (cur !== MIXED && Math.abs(+t - cur) < 1e-9) return;
      set(clamp(+t), false);
      f.refresh();
    };
    inp.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); commit(); this.backToCanvas(); }
      else if (e.key === 'Escape') { e.preventDefault(); f.refresh(); this.backToCanvas(); }
      else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
        e.preventDefault();
        const cur = get();
        const base = cur === MIXED || cur == null ? (+inp.value || 0) : cur;
        const next = clamp(Math.round((base + (e.key === 'ArrowUp' ? 1 : -1) * step * (e.shiftKey ? 10 : 1)) * 1000) / 1000);
        set(next, true);
        inp.value = fmt(next);
      }
    });
    inp.addEventListener('change', commit);
    return this.reg(f);
  }

  text(label, get, set, list) {
    const el = document.createElement('label');
    el.className = 'f';
    el.innerHTML = `<span>${label}</span><input class="txt" type="text" spellcheck="false"${list ? ` list="${list}"` : ''}>`;
    const inp = el.querySelector('input');
    inp.dataset.field = label;
    const f = { el, refresh: () => { const val = get(); inp.value = val === MIXED ? '' : val ?? ''; inp.placeholder = val === MIXED ? '여러 값' : ''; } };
    const commit = () => { const val = get(); if (inp.value.trim() !== (val === MIXED ? '' : val)) set(inp.value.trim()); f.refresh(); };
    inp.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); commit(); this.backToCanvas(); }
      else if (e.key === 'Escape') { e.preventDefault(); f.refresh(); this.backToCanvas(); }
    });
    inp.addEventListener('change', commit);
    return this.reg(f);
  }

  select(label, options, get, set) {
    const el = document.createElement('label');
    el.className = 'f';
    el.innerHTML = `${label ? `<span>${label}</span>` : ''}<select>${options.map(([v, t]) => `<option value="${v}">${t}</option>`).join('')}<option value="" hidden>여러 값</option></select>`;
    const sel = el.querySelector('select');
    sel.dataset.field = label || 'blend';
    const f = { el, refresh: () => { const val = get(); sel.value = val === MIXED ? '' : val; } };
    sel.addEventListener('change', () => { if (sel.value) set(sel.value); this.backToCanvas(); });
    return this.reg(f);
  }

  color(label, get, set, allowNone = false) {
    const el = document.createElement('label');
    el.className = 'f';
    el.innerHTML = `<span>${label}</span>`;
    const cf = new ColorField({ swatches: this.swatches, allowNone, title: label, onInput: (c) => set(c, true), onChange: (c) => { set(c, false); this.backToCanvas(); } });
    cf.hex.dataset.field = label;
    el.appendChild(cf.el);
    for (const b of cf.el.querySelectorAll('button')) b.addEventListener('mousedown', (e) => e.preventDefault());
    const f = { el, cf, refresh: () => { const v = get(); cf.set(v === MIXED ? MIXED : normHex(v) ?? ''); } };
    return this.reg(f);
  }

  toggleBtn(text, title, get, act) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'tg';
    if (TOGGLE_ICONS[text]) b.appendChild(iconEl(TOGGLE_ICONS[text], 16, text === 'B' ? 2.4 : 1.75)); else b.textContent = text;
    b.title = title;
    b.dataset.field = title;
    b.addEventListener('mousedown', (e) => e.preventDefault()); // 편집기 포커스·선택 유지
    b.addEventListener('click', () => { act(); f.refresh(); });
    const f = { el: b, refresh: () => b.setAttribute('aria-pressed', get()) };
    return this.reg(f);
  }

  button(text, act, title = '') {
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'tg'; b.textContent = text; b.title = title; b.dataset.field = text;
    b.addEventListener('mousedown', (e) => e.preventDefault());
    b.addEventListener('click', () => act());
    return { el: b, refresh: () => {} };
  }
  check(label, get, set) {
    const el = document.createElement('label');
    el.className = 'f ck';
    el.innerHTML = `<input type="checkbox"><span>${label}</span>`;
    const box = el.querySelector('input');
    box.dataset.field = label;
    box.addEventListener('change', () => { set(box.checked); this.backToCanvas(); });
    return this.reg({ el, refresh: () => { const x = get(); box.indeterminate = x === MIXED; box.checked = x === true; } });
  }

  // 값을 적용한 뒤 키보드가 캔버스(또는 편집 중인 글상자)로 돌아가게
  backToCanvas() {
    if (this.view.editing) this.view.activeEditor.focus();
    else this.view.viewport.focus({ preventScroll: true });
  }
}
