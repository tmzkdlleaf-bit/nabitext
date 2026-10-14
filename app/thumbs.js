// 장 목록 미리보기(썸네일). 바뀐 장만, 사용자가 손을 멈춘 뒤 브라우저가 한가할 때 한 장씩 다시 그린다.
//   바뀜 판단: 장 요소(글상자 문서는 문서 객체 번호), 공통 장·쪽 번호, 프리셋, 글꼴·축소본 세대를 이은 문자열
//   그리기: 출력 경로(rasterize)와 같지만 이미지는 가장 긴 변 256px 사본, 글은 지금 배치 결과를 재사용, 글꼴은 넣지 않음

import * as M from './model.js';
import { rasterize } from '../src/export.js';
import { measureGen } from '../src/measure.js';
import { proxyGen } from '../src/image-src.js';

export const THUMB_W = 84;   // 미리보기 최대 너비·높이(화면 px). 장 비율대로 이 안에 맞춘다
export const THUMB_H = 84;
const QUIET_MS = 600;         // 마지막 변경·입력 뒤 이만큼 조용하면 시작(입력 중에는 절대 그리지 않는다)

const docIds = new WeakMap();
let docSeq = 0;
const docId = (d) => { if (!d || typeof d !== 'object') return 0; let i = docIds.get(d); if (!i) { i = ++docSeq; docIds.set(d, i); } return i; };

export class Thumbs {
  // view: PageView, app: { project }, onUpdate(page, url)
  constructor({ view, app, onUpdate }) {
    Object.assign(this, { view, app, onUpdate });
    this.map = new Map(); // 장 → { sig, url }
    this.enabled = true;
    this.timer = null;
    this.busy = false;
    this.gen = 0; // 작은 사본이 준비될 때 1 증가
    this.lastInput = 0;
    const mark = () => { this.lastInput = performance.now(); };
    for (const t of ['keydown', 'pointerdown', 'pointermove', 'wheel', 'beforeinput', 'compositionupdate']) window.addEventListener(t, mark, { capture: true, passive: true });
  }

  urlOf(page) { return this.map.get(page)?.url || null; }
  setEnabled(on) { this.enabled = on; if (on) this.touch(); }
  invalidateAll() { this.gen++; this.touch(); }
  // 무언가 바뀜: 조용해지면 바뀐 장을 찾아 다시 그린다
  touch() {
    if (!this.enabled) return;
    this.lastTouch = performance.now();
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.idle(), QUIET_MS);
  }
  idle() {
    this.timer = null;
    // 시간 제한 없이: 브라우저가 정말 한가할 때만(바쁘면 계속 미룬다)
    if (window.requestIdleCallback) requestIdleCallback((d) => this.step(d)); else setTimeout(() => this.step(null), 50);
  }
  // 끄는 중·한글 조합 중에는 미룬다
  interacting() {
    const v = this.view;
    return !!(v.drag || v.activeEditor?.comp) || performance.now() - Math.max(this.lastInput, this.lastTouch || 0) < QUIET_MS || !!navigator.scheduling?.isInputPending?.();
  }

  pages() {
    const p = this.app.project;
    return p.master ? [...p.pages, p.master] : [...p.pages];
  }
  sig(page) {
    const v = this.view;
    const s = M.serializePage(page, (sid) => { const ed = v.editors.get(sid); return ed ? { d: docId(ed.state.doc) } : undefined; });
    const m = v.masterFor(page);
    return JSON.stringify([page.w, page.h, page.background, page.bgImage, s.elements, m ? [M.serializePage(m, (sid) => { const ed = v.editors.get(sid); return ed ? { d: docId(ed.state.doc) } : undefined; }).elements, v.pageNumberOf(page)] : 0,
      v.presetsKey, measureGen, proxyGen, this.gen]);
  }

  async step(deadline) {
    if (!this.enabled || this.busy) return;
    if (this.interacting()) return this.touch();
    const live = new Set(this.pages());
    for (const [pg, t] of this.map) if (!live.has(pg)) { if (t.url) URL.revokeObjectURL(t.url); this.map.delete(pg); } // 지운 장
    // 바뀐 장 찾기(지금 장 먼저). 한가한 시간이 떨어지면 다음 기회로
    const order = [this.view.page, ...[...live].filter((p) => p !== this.view.page)].filter((p) => live.has(p));
    let target = null, sig = null;
    for (const pg of order) {
      if (deadline && deadline.timeRemaining() < 2) return this.idle();
      const sg = this.sig(pg);
      if (this.map.get(pg)?.sig !== sg) { target = pg; sig = sg; break; }
    }
    if (!target) return;
    this.busy = true;
    try {
      const url = await this.render(target);
      if (!url) { this.busy = false; return this.touch(); } // 그리는 사이 사용자가 손을 댐: 버리고 나중에
      const old = this.map.get(target)?.url;
      this.map.set(target, { sig, url });
      if (old) URL.revokeObjectURL(old);
      this.onUpdate?.(target, url);
    } catch (err) {
      this.map.set(target, { sig, url: this.map.get(target)?.url || null }); // 실패한 장은 다음 변경 때 다시
      console.warn('미리보기 실패', err);
    } finally { this.busy = false; }
    this.idle(); // 다음 장
  }

  async render(page) {
    const v = this.view;
    if (page !== v.page) v.ensurePage(page);
    const k = Math.min(THUMB_W / page.w, THUMB_H / page.h) * Math.min(2, window.devicePixelRatio || 1);
    // SVG 만들기·읽기(약 10ms)는 새 한가한 틈에서(장 DOM 만들기와 한 작업으로 이어 붙지 않게 → 작업 하나가 한 프레임을 넘지 않음)
    // 틈이 짧으면 다음 틈을 기다린다(버리고 처음부터 하지 않음). 사용자가 손을 대면 그만둔다
    const gate = () => new Promise((res) => {
      if (!window.requestIdleCallback) return res(!this.interacting());
      let tries = 0;
      const wait = () => requestIdleCallback((d) => {
        if (this.interacting()) return res(false);
        if (d.timeRemaining() > 12 || ++tries > 40) return res(true);
        wait();
      });
      wait();
    });
    const cv = await rasterize(v.exportPage(page, { mode: 'thumb' }), { scale: k, embedFonts: false, abort: () => this.interacting(), gate });
    if (!cv) return null;
    const blob = await new Promise((res, rej) => cv.toBlob((b) => (b ? res(b) : rej(new Error('인코딩 실패'))), 'image/webp', 0.85));
    return URL.createObjectURL(blob);
  }
}
