// 캔버스 화면(PageView)의 글상자 부분: 이야기(이어진 글상자)마다 편집기를 준비하고 프레임·영역을 맞춘다,
// 스타일 프리셋, 이미지 외곽선 이미지 불러오기, 출력용 장 DOM.
// page-view.js가 mixin으로 PageView에 붙인다.

import { CanvasEditor } from '../src/editor.js';
import { buildRegion } from '../src/region.js';
import * as G from './geom.js';
import * as M from './model.js';
import { pageCss, pageBgCss, boxCss, contentOf, textFrame } from './render-el.js';
import { mixin } from './util.js';
import { buildMasterLayer } from './master.js';
import { displaySrc, srcReady, srcDims, withOriginals, withThumbs } from '../src/image-src.js';

class StoryMethods {
  // 장의 모든 이야기(글상자·이어진 글상자)마다 편집기를 준비하고 프레임·영역을 요소 모양에 맞춘다.
  // 이야기가 다른 장에도 걸쳐 있으면 그 장의 글상자까지 함께 배치한다(흐르는 순서 = 장 순서)
  syncStories(page) {
    const all = this.stories();
    const here = new Set();
    M.walk(page.elements, (n) => { if (n.type === 'text') here.add(M.storyOf(n)); });
    for (const sid of here) { const ents = all.get(sid) || []; this.syncStory(sid, ents.map((e) => e.n), ents.map((e) => e.page)); }
  }
  syncStory(sid, list, pages) {
    const ed = this.editors.get(sid) || this.createEditor(sid, list);
    const head = list[0];
    const specs = list.map((n) => {
      const sp = textFrame(n, this.images);
      // 글자 기본값·자동 축소는 첫 글상자 것을 모든 글상자에 쓴다(한 이야기)
      sp.frame = { ...sp.frame, style: head.style || {}, paragraphSpacing: Math.max(0, Number.isFinite(+head.paraSpacing) ? +head.paraSpacing : 8), presets: this.presets, autoShrink: !!head.autoShrink, minScale: head.minScale ?? 0.5 };
      return sp;
    });
    const built = specs.map((sp, i) => {
      const n = list[i];
      const rk = JSON.stringify([sp.frame.w, sp.frame.h, n.padding, n.area, !!sp.pending]);
      let c = this.regions.get(n.id);
      if (!c || c.key !== rk) { c = { key: rk, built: buildRegion(sp.frame.w, sp.frame.h, sp.frame.source, sp.opts) }; this.regions.set(n.id, c); }
      return c.built;
    });
    const key = JSON.stringify([list.map((n, i) => [n.id, this.regions.get(n.id).key]), specs[0].frame.style, specs[0].frame.paragraphSpacing, head.autoShrink, head.minScale, this.presetsKey]);
    ed.members = list.map((n) => n.id);
    ed.memberPages = pages;
    if (ed._key !== key) {
      ed.frame = specs[0].frame;
      ed.built = built[0];
      const node = (id) => { const k = ed.members.indexOf(id); return k >= 0 ? M.find(ed.memberPages[k].elements, id)?.node : null; };
      ed.setChain(list.slice(1).map((n, i) => ({
        id: n.id, frame: specs[i + 1].frame, built: built[i + 1],
        toLocal: (cx, cy) => { const cur = node(n.id); return cur ? G.toLocal(cur, this.clientToPage(cx, cy)) : { x: 0, y: 0 }; },
        toHost: (x, y) => { const a = node(n.id), h0 = node(ed.members[0]); return a && h0 ? G.toLocal(h0, G.fromLocal(a, { x, y })) : { x, y }; },
      })));
      ed._key = key;
    }
    // 이미지 외곽선의 이미지가 오면 한 번만 다시 그린다(이미지마다 기다리는 곳 하나)
    for (const sp of specs) if (sp.pending && !this.waiting.has(sp.pending)) {
      this.waiting.add(sp.pending);
      const src = sp.pending;
      this.loadImage(src).then(() => {
        this.waiting.delete(src);
        for (const [id, c] of this.regions) if (c.key.includes(src)) this.regions.delete(id); // 그 이미지를 쓰는 영역만 다시 계산
        for (const e of this.editors.values()) e._key = null;
        this.render();
      });
    }
  }
  // 스타일 프리셋(프로젝트 전체): 바꾸면 이 프리셋을 쓰는 모든 문단이 다시 배치된다
  setPresets(presets) { this.presets = presets || {}; this.presetsKey = JSON.stringify(this.presets); this.onPresets?.(this.presets); this.render(); }
  changePresets(next, label = 'preset') {
    const before = JSON.parse(JSON.stringify(this.presets));
    this.setPresets(next);
    this.history.record(new PresetEntry(this, label, before, JSON.parse(JSON.stringify(next))));
    this.onChange(this);
  }
  definePreset(id, data) { return this.changePresets({ ...this.presets, [id]: { ...this.presets[id], ...data } }); }
  deletePreset(id) { const next = { ...this.presets }; delete next[id]; return this.changePresets(next, 'preset-delete'); }

  // 글상자 모양(이미지 외곽선)에 쓰는 이미지를 불러 둔다
  // 큰 사진은 축소본을 기다렸다가 그것으로 외곽선을 계산한다(열 때마다 같은 축소본 → 같은 줄 배치). 원본 주소는 dataset.orig(출력용)
  loadImage(src) {
    if (!this.imageJobs) this.imageJobs = new Map();
    let job = this.imageJobs.get(src);
    if (!job) {
      // 실패하면 false로 표시(글상자는 사각형 영역으로 되돌아감). null로 두면 계속 '불러오는 중'이라 다시 그리기를 반복한다
      job = srcReady(src).then(() => {
        const img = new Image();
        img.src = displaySrc(src);
        img.dataset.orig = src;
        return img.decode().then(() => img);
      }).then((img) => { this.images.set(src, img); return img; }).catch(() => { this.images.set(src, false); return null; });
      this.imageJobs.set(src, job);
    }
    return job;
  }
  // 이미지 원본 크기: 축소본을 만든 큰 사진은 저장소가 알고, 아니면 불러서 잰다
  async imageSize(src) {
    await srcReady(src);
    const d = srcDims(src);
    if (d) return d;
    const img = new Image();
    img.src = src;
    await img.decode();
    return { w: img.naturalWidth, h: img.naturalHeight };
  }

  // 이야기 편집기. 문서 초기값 = 이야기의 첫 글상자(저장 파일에서는 첫 글상자만 문서를 가짐)
  createEditor(sid, list) {
    const host = document.createElement('div');
    host.style.cssText = 'position:absolute;left:0;top:0';
    const head = list[0];
    const spec = textFrame(head, this.images);
    const f = spec.frame;
    const holder = {}; // 편집기 생성자 안에서 inputAt이 먼저 불린다
    const ed = new CanvasEditor(host, {
      frame: f, built: buildRegion(f.w, f.h, f.source, spec.opts), doc: list.find((n) => n.doc)?.doc || M.emptyDoc(), assets: this.assets,
      history: this.history, keymap: this.keymap, nativePaste: this.nativePaste, importImage: this.importImage,
      toLocal: (cx, cy) => { const cur = this.node(ed.members[0]); return cur ? G.toLocal(cur, this.clientToPage(cx, cy)) : { x: 0, y: 0 }; },
      onChange: () => { this.drawOverlay(); this.onChange(this); },
      // 입력창은 장 요소에: 커서가 있는 글상자(어느 이어진 글상자든)의 커서 가운데가 입력창 가운데에 오게
      inputParent: this.inputLayer,
      inputAt: (k, x, top, h) => {
        const n = holder.ed && this.node(holder.ed.members[k]);
        if (!n) return null;
        const c = G.fromLocal(n, { x, y: top + h / 2 });
        return { x: c.x, y: c.y - h / 2 };
      },
    });
    holder.ed = ed;
    ed.lazyRender = true;
    ed._key = null; // 곧바로 syncStory가 맞춘다
    ed.storyId = sid;
    ed.members = list.map((n) => n.id);
    Object.defineProperty(ed, 'elementId', { get: () => ed.members[0] });
    const mine = () => this.editing && this.editorOf(this.node(this.editing)) === ed;
    ed.onState = () => { if (mine()) { this.followCaret(ed); if (this.touchMode) this.revealCaret(); this.onChange(this); } }; // 커서·선택 이동 → 속성 패널 갱신(손가락 편집이면 커서가 보이게)
    // 되돌리기가 이 편집기의 글자를 바꾸면 편집기가 포커스를 가져간다 → 커서가 있는 글상자 편집 모드로(다른 장이면 그 장으로)
    ed.input.addEventListener('focus', () => {
      if (mine()) return; // 이미 이 이야기를 편집 중(편집 모드로 들어가며 포커스를 준 경우)
      const id = ed.members[ed.caret?.view ?? 0] || ed.members[0];
      if (!this.node(id)) this.onForeignEditor?.(id);
      if (!mine() && this.node(id)) this.enterEdit(id, null, true);
    });
    this.editors.set(sid, ed);
    return ed;
  }

  // 편집 중 커서가 있는 글상자를 따라간다: 같은 장이면 편집 대상만 바꾸고, 다른 장이면 편집을 유지한 채 그 장으로 넘어간다
  followCaret(ed) {
    const k = ed.caret?.view ?? 0;
    const id = ed.members[k];
    if (!id || id === this.editing) return;
    const pg = ed.memberPages?.[k];
    if (pg && pg !== this.page && this.showPage) {
      this.keepEditing = id;
      try { this.showPage(pg); } finally { this.keepEditing = null; }
    } else if (this.node(id)) {
      this.editing = id;
      this.selection = [id];
      this.drawOverlay();
    }
  }

  // 화면에 띄우지 않은 장의 글상자 편집기를 준비(출력·저장용). 크기가 바뀐 편집기 프레임도 맞춘다.
  ensurePage(page) {
    this.syncStories(page);
    M.walk(page.elements, (n) => {
      if (n.type !== 'text') return;
      const el = this.nodes.get(n.id) || this.createNodeEl(n);
      if (page !== this.page) this.syncNodeEl(el, n, false);
    });
  }

  // 출력용 장: 화면과 같은 요소 DOM을 새로 만든다(선택·핸들·커서 없음). page: 다른 장도 가능
  // mode: 'original'(출력, 기본) | 'display'(화면용 축소본: 템플릿 미리보기) | 'thumb'(아주 작은 사본 + 지금 배치 재사용: 장 목록 미리보기)
  exportPage(page = this.page, { mode = 'original' } = {}) {
    if (page !== this.page) this.ensurePage(page);
    const build = () => {
      const root = document.createElement('div');
      root.style.cssText = pageCss(page) + pageBgCss(page);
      const m = this.masterFor(page);
      if (m) root.appendChild(buildMasterLayer(m, this.pageNumberOf(page), this.masterCtx()));
      M.walk(page.elements, (n, _p, _i, anc) => {
        if (n.type === 'group' || M.isHidden(n, anc)) return;
        const el = document.createElement('div');
        el.style.cssText = boxCss(n);
        if (n.type !== 'text') { const c = contentOf(n); if (c) el.appendChild(c); }
        else {
          const ed = this.editorOf(n);
          const k = ed ? ed.members.indexOf(n.id) : -1;
          if (k >= 0) el.appendChild(ed.exportFrame(k, { reuse: mode === 'thumb' }).render());
        }
        root.appendChild(el);
      });
      return root;
    };
    return { w: page.w, h: page.h, render: () => (mode === 'display' ? build() : mode === 'thumb' ? withThumbs(build) : withOriginals(build)) };
  }

}

// 프리셋 목록 변경의 되돌리기 항목
class PresetEntry {
  constructor(view, label, before, after) { Object.assign(this, { view, label, before, after }); }
  undo() { this.view.setPresets(JSON.parse(JSON.stringify(this.before))); this.view.onChange(this.view); }
  redo() { this.view.setPresets(JSON.parse(JSON.stringify(this.after))); this.view.onChange(this.view); }
}

export function installStories(PV) { mixin(PV, StoryMethods); }
