/* 글 이미지 모드: 본문을 종이 질감·틀·모눈·장식이 있는 긴 이미지(또는 여러 장)로 조판한다. */
NT.poster = (() => {
  const { $, $$ } = NT;
  const A = NT.posterAssets;
  let state = null, onChange = null, editorEl = null, getTitle = () => '';
  let selected = null, zoom = 'fit', renderToken = 0, pagesMeta = [];

  /* ─ 템플릿 ─ */
  const st = (gen, x, y, w, extra = {}) => ({ id: NT.uid(), kind: 'builtin', gen, seed: Math.floor(Math.random() * 1e6) + 1, params: {}, x, y, w,
    anchor: 'top', yb: 0, rot: 0, opacity: 1, flip: false, flipY: false, layer: 'front', pages: 'all', tint: 'none', c1: '#bfe3f2', c2: '#d6b8f2', angle: 0, knock: false, ...extra });
  const bottom = (yb, o) => ({ anchor: 'bottom', yb, ...o });

  const PRESETS = {
    ink: { name: '먹과 매화', swatch: ['#f1efeb', '#d93a3a', '#1b1b1b'], make: () => ({
      page: { w: 1200, h: 0, minH: 2000 },
      bg: { color: '#f1efeb', texture: 'linen', image: null, imageOpacity: 1, imageGray: false, border: 'none', borderColor: '#111111' },
      frame: { style: 'single', color: '#262626', width: 1.6, x: 115, top: 278, bottom: 125, fill: '#ffffff', fillOpacity: 0, grid: true, gridSize: 13, gridColor: '#8f8f8f', gridOpacity: 0.45 },
      title: { show: true, font: 'black-han', size: 64, color: '#111111', y: 160, every: true },
      body: { font: 'nanum-myeongjo', size: 23, lh: 1.82, ls: -0.03, indent: 0, align: 'justify', gap: 1.3, color: '#222222', padX: 92, padTop: 76, padBottom: 90, divider: 'flower', dividerColor: '#f2a7b8', quoteColor: '#8a8a8a', count: false },
      stickers: [
        st('plum', -40, -40, 520, { params: { branch: '#1b1b1b', petals: ['#e03b3b', '#1b1b1b', '#e8665a'] } }),
        st('plum', 790, 40, 450, { flip: true, params: { branch: '#1b1b1b', petals: ['#d93a3a', '#1b1b1b'] } }),
        st('cloud', 930, 560, 300, { params: { color: '#8a847e' } }),
        st('cloudline', -60, 520, 250, { params: { color: '#a19b95' } }),
        st('cloud', -40, 0, 340, bottom(430, { params: { color: '#8a847e' } })),
        st('cloudline', 1000, 0, 240, bottom(640, { params: { color: '#a19b95' } }))
      ]
    }) },
    spring: { name: '봄빛 수채', swatch: ['#f6f3f1', '#f6a3c8', '#aee3f2'], make: () => ({
      page: { w: 1200, h: 0, minH: 2000 },
      bg: { color: '#f5f2f0', texture: 'linen', image: null, imageOpacity: 1, imageGray: false, border: 'none', borderColor: '#111111' },
      frame: { style: 'single', color: '#1e1e1e', width: 1.8, x: 115, top: 300, bottom: 110, fill: '#ffffff', fillOpacity: 0, grid: false, gridSize: 13, gridColor: '#8f8f8f', gridOpacity: 0.4 },
      title: { show: true, font: 'black-han', size: 62, color: '#111111', y: 180, every: true },
      body: { font: 'nanum-myeongjo', size: 23, lh: 2.0, ls: -0.02, indent: 0, align: 'justify', gap: 1.2, color: '#1f1f1f', padX: 95, padTop: 72, padBottom: 90, divider: 'flower', dividerColor: '#f6a8c8', quoteColor: '#8a8a8a', count: false },
      stickers: [
        st('watercolor', -60, -40, 560, { layer: 'back' }),
        st('watercolor', 740, -50, 520, { flip: true, layer: 'back', params: { petals: ['#f7a1d0', '#fbc4df', '#e7b9f5'], branch: '#e3b5d8' } }),
        st('cloud', 950, 560, 290, { layer: 'back', params: { color: '#c2ecf6' } }),
        st('cloudline', -50, 500, 260, { layer: 'back', params: { color: '#c9eef7' } }),
        st('cloud', -40, 0, 300, bottom(470, { layer: 'back', params: { color: '#b3e5f3' } })),
        st('cloudline', 960, 0, 260, bottom(330, { layer: 'back', params: { color: '#c9eef7' } }))
      ]
    }) },
    woodcut: { name: '목판 액자', swatch: ['#ffffff', '#111111', '#777777'], make: () => ({
      page: { w: 1200, h: 0, minH: 1900 },
      bg: { color: '#ffffff', texture: 'none', image: null, imageOpacity: 1, imageGray: false, border: 'woodcut', borderColor: '#111111' },
      frame: { style: 'none', color: '#111111', width: 1.5, x: 70, top: 110, bottom: 130, fill: '#ffffff', fillOpacity: 1, grid: false, gridSize: 13, gridColor: '#8f8f8f', gridOpacity: 0.4 },
      title: { show: false, font: 'song-myung', size: 56, color: '#111111', y: 60, every: false },
      body: { font: 'nanum-myeongjo', size: 23, lh: 2.0, ls: -0.02, indent: 1, align: 'left', gap: 0.9, color: '#111111', padX: 48, padTop: 95, padBottom: 100, divider: 'blank', dividerColor: '#111111', quoteColor: '#8a8a8a', count: false },
      stickers: []
    }) },
    silver: { name: '은빛 실루엣', swatch: ['#d2d2d6', '#bfe0f0', '#d7b8f2'], make: () => ({
      page: { w: 1200, h: 0, minH: 2000 },
      bg: { color: '#cfcfd3', texture: 'botanical', image: null, imageOpacity: 1, imageGray: false, border: 'none', borderColor: '#111111' },
      frame: { style: 'none', color: '#111111', width: 1.5, x: 100, top: 290, bottom: 60, fill: '#ffffff', fillOpacity: 0, grid: false, gridSize: 13, gridColor: '#8f8f8f', gridOpacity: 0.4 },
      title: { show: true, font: 'black-han', size: 58, color: '#111111', y: 160, every: true },
      body: { font: 'gowun-batang', size: 24, lh: 1.95, ls: -0.02, indent: 0.5, align: 'justify', gap: 1.2, color: '#161616', padX: 0, padTop: 30, padBottom: 330, divider: 'ornament', dividerColor: '#b9c9f2', quoteColor: '#555555', count: false },
      stickers: [
        st('tree', 40, 0, 470, { layer: 'back', tint: 'gradient', c1: '#bfe3f2', c2: '#cbb7f0', angle: 0 }),
        st('plum', 760, 0, 470, { flip: true, layer: 'back', tint: 'gradient', c1: '#e4c2f5', c2: '#f3d0f7', angle: 0, params: { branch: '#000', petals: ['#000'] } }),
        st('lattice', 0, 0, 1200, bottom(280, { tint: 'gradient', c1: '#a9dcf2', c2: '#dcb6f5', angle: 0 }))
      ]
    }) },
    plain: { name: '깔끔한 원고', swatch: ['#fbfaf7', '#333333', '#c9c3b6'], make: () => ({
      page: { w: 1200, h: 0, minH: 1600 },
      bg: { color: '#fbfaf7', texture: 'hanji', image: null, imageOpacity: 1, imageGray: false, border: 'none', borderColor: '#111111' },
      frame: { style: 'double', color: '#b8b0a0', width: 1.5, x: 80, top: 250, bottom: 80, fill: '#ffffff', fillOpacity: 0, grid: false, gridSize: 13, gridColor: '#8f8f8f', gridOpacity: 0.4 },
      title: { show: true, font: 'song-myung', size: 58, color: '#2b2b2b', y: 120, every: true },
      body: { font: 'gowun-batang', size: 23, lh: 1.95, ls: -0.01, indent: 1, align: 'justify', gap: 0.6, color: '#2b2b2b', padX: 90, padTop: 80, padBottom: 90, divider: 'dots', dividerColor: '#a39b8b', quoteColor: '#8a8277', count: true },
      stickers: [st('corner', 94, 264, 150, { params: { color: '#b8a57f' } }), st('corner', 956, 264, 150, { flip: true, params: { color: '#b8a57f' } })]
    }) }
  };

  const TEXTURES = { none: '없음', linen: '리넨', paper: '종이', hanji: '한지', botanical: '잎 무늬' };
  const DIVIDERS = { flower: '꽃', ornament: '장식 무늬', dots: '점 세 개', line: '짧은 선', blank: '빈 줄' };

  /* ─ 도우미 ─ */
  const get = (o, path) => path.split('.').reduce((a, k) => a && a[k], o);
  const set = (o, path, v) => { const ks = path.split('.'); const last = ks.pop(); ks.reduce((a, k) => a[k], o)[last] = v; };
  const rgba = (hex, a) => { const n = parseInt(hex.slice(1), 16); return `rgba(${n >> 16 & 255},${n >> 8 & 255},${n & 255},${a})`; };
  const font = id => NT.fontById(id).stack;

  const geom = () => {
    const f = state.frame, b = state.body;
    return { left: f.x + b.padX, right: f.x + b.padX, top: f.top + b.padTop, bottom: f.bottom + b.padBottom };
  };

  /* ─ 페이지 만들기 ─ */
  function makePage(stageEl, idx) {
    const s = state, g = geom();
    const wrap = document.createElement('div');
    wrap.className = 'pp-wrap';
    const page = document.createElement('div');
    page.className = 'pp';
    page.dataset.index = idx;
    page.style.width = s.page.w + 'px';
    page.style.backgroundColor = s.bg.color;
    const tex = A.texture(s.bg.texture, s.bg.color);
    if (tex) page.style.backgroundImage = `url("${tex}")`;
    page.innerHTML = `<div class="pp-bgimg"></div><div class="pp-border"></div><div class="pp-layer pp-back"></div><div class="pp-frame"></div><h1 class="pp-title"></h1><div class="pp-body"></div><div class="pp-layer pp-front"></div>`;

    if (s.bg.image) {
      const bi = page.querySelector('.pp-bgimg');
      bi.style.backgroundImage = `url("${s.bg.image}")`;
      bi.style.opacity = s.bg.imageOpacity;
      if (s.bg.imageGray) bi.style.filter = 'grayscale(1)';
    }
    const fr = page.querySelector('.pp-frame'), f = s.frame;
    Object.assign(fr.style, { left: f.x + 'px', right: f.x + 'px', top: f.top + 'px', bottom: f.bottom + 'px' });
    if (f.style === 'single') fr.style.border = `${f.width}px solid ${f.color}`;
    if (f.style === 'double') fr.style.border = `${Math.max(3, f.width * 3)}px double ${f.color}`;
    const bgs = [];
    if (f.grid) {
      const gc = rgba(f.gridColor, f.gridOpacity), gm = rgba(f.gridColor, Math.min(1, f.gridOpacity * 1.9)), n = f.gridSize;
      bgs.push(`linear-gradient(${gm} 1px, transparent 1px) 0 0 / ${n * 3}px ${n * 3}px`,
        `linear-gradient(90deg, ${gm} 1px, transparent 1px) 0 0 / ${n * 3}px ${n * 3}px`,
        `linear-gradient(${gc} 1px, transparent 1px) 0 0 / ${n}px ${n}px`,
        `linear-gradient(90deg, ${gc} 1px, transparent 1px) 0 0 / ${n}px ${n}px`);
    }
    if (f.fillOpacity > 0) bgs.push(rgba(f.fill, f.fillOpacity));
    if (bgs.length) fr.style.background = bgs.join(',');

    const t = page.querySelector('.pp-title');
    if (s.title.show && (idx === 0 || s.title.every) && getTitle()) {
      t.textContent = getTitle();
      Object.assign(t.style, { top: s.title.y + 'px', fontFamily: font(s.title.font), fontSize: s.title.size + 'px', color: s.title.color });
    } else t.remove();

    const body = page.querySelector('.pp-body'), b = s.body;
    Object.assign(body.style, {
      left: g.left + 'px', right: g.right + 'px', top: g.top + 'px',
      fontFamily: font(b.font), fontSize: b.size + 'px', lineHeight: b.lh, letterSpacing: b.ls + 'em',
      color: b.color, textAlign: b.align
    });
    body.style.setProperty('--pp-indent', b.indent + 'em');
    body.style.setProperty('--pp-gap', b.gap + 'em');
    body.style.setProperty('--pp-quote', b.quoteColor);
    body.style.setProperty('--pp-accent', b.dividerColor);

    wrap.appendChild(page);
    stageEl.appendChild(wrap);
    return { wrap, page, body };
  }

  /* 본문 블록을 복제해 글 이미지용으로 바꾼다 */
  let dividerSrc = '';
  function collectBlocks() {
    const out = [];
    for (const el of editorEl.children) {
      if (el.tagName === 'HR') {
        const d = document.createElement('div');
        d.className = 'pp-div pp-div-' + state.body.divider;
        if (state.body.divider === 'flower' || state.body.divider === 'ornament') {
          const img = new Image(); img.src = dividerSrc; img.alt = '';
          d.appendChild(img);
        } else if (state.body.divider === 'dots') d.textContent = '·  ·  ·';
        out.push(d); continue;
      }
      if (el.tagName === 'H1' && el === editorEl.firstElementChild && el.textContent.trim() === getTitle()) continue; // 제목과 같은 첫 제목은 중복이라 뺀다
      const c = NT.convert.cleanClone(el);
      if (c.tagName === 'P' && !c.textContent.trim() && !c.querySelector('img')) c.classList.add('pp-blank');
      out.push(c);
    }
    // 앞뒤 빈 줄 정리
    while (out.length && out[0].classList.contains('pp-blank')) out.shift();
    while (out.length && out[out.length - 1].classList.contains('pp-blank')) out.pop();
    if (state.body.count) {
      const n = Array.from(editorEl.children).reduce((a, el) => a + (el.tagName === 'HR' ? 0 : el.textContent.length), 0);
      let last = [...out].reverse().find(e => e.tagName === 'P' && !e.classList.contains('pp-blank'));
      if (!last) { last = document.createElement('p'); out.push(last); }
      last.append(` (${n.toLocaleString()}자.)`);
    }
    return out;
  }

  /* 블록의 [s, e) 글자만 남긴 사본 */
  function slice(el, s, e) {
    const c = el.cloneNode(true);
    let pos = 0;
    for (const n of NT.textNodes(c)) {
      const ns = pos, ne = pos + n.length; pos = ne;
      const a = Math.max(s, ns) - ns, b = Math.min(e, ne) - ns;
      if (b <= a) n.remove(); else n.data = n.data.slice(a, b);
    }
    for (const x of Array.from(c.querySelectorAll('*')).reverse()) if (!/^(BR|IMG)$/.test(x.tagName) && !x.textContent && !x.querySelector('img')) x.remove();
    return c;
  }

  /* 남은 높이에 들어가는 만큼 문단을 자른다. 어절 경계에서 끊는다. */
  function splitToFit(body, el, maxH) {
    const text = el.textContent, total = text.length;
    let lo = 0, hi = total, best = 0;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      const part = slice(el, 0, mid);
      body.appendChild(part);
      const ok = body.scrollHeight <= maxH + 0.5;
      part.remove();
      if (ok) { best = mid; lo = mid + 1; } else hi = mid - 1;
    }
    if (best <= 0 || best >= total) return null;
    let cut = best;
    for (let k = best; k > best - 30 && k > 0; k--) if (/\s/.test(text[k])) { cut = k; break; }
    let restStart = cut;
    while (restStart < total && /\s/.test(text[restStart])) restStart++;
    const first = slice(el, 0, cut), rest = slice(el, restStart, total);
    first.classList.add('pp-split');
    rest.classList.add('pp-cont');
    return [first, rest];
  }

  /* ─ 장식 ─ */
  async function stickerSrc(s) {
    const base = s.kind === 'upload' ? s.data : A.builtinSrc(s.gen, s.params, s.seed);
    try { return await A.process(base, { knock: s.knock, tint: s.tint, c1: s.c1, c2: s.c2, angle: s.angle }); }
    catch { return base; }
  }
  const stickerTop = (s, H) => s.anchor === 'bottom' ? H - s.yb : s.y;
  function showsOn(s, idx, count) {
    return s.pages === 'all' || (s.pages === 'first' && idx === 0) || (s.pages === 'last' && idx === count - 1);
  }
  function placeSticker(node, s, H) {
    Object.assign(node.style, {
      left: s.x + 'px', top: stickerTop(s, H) + 'px', width: s.w + 'px', opacity: s.opacity,
      transform: `rotate(${s.rot}deg) scale(${s.flip ? -1 : 1}, ${s.flipY ? -1 : 1})`
    });
    node.classList.toggle('selected', s.id === selected);
  }
  function drawStickers(srcs) {
    const count = pagesMeta.length;
    pagesMeta.forEach(({ page, H }, idx) => {
      const back = page.querySelector('.pp-back'), front = page.querySelector('.pp-front');
      back.innerHTML = ''; front.innerHTML = '';
      state.stickers.forEach((s, i) => {
        if (!showsOn(s, idx, count)) return;
        const node = document.createElement('div');
        node.className = 'pp-st';
        node.dataset.id = s.id;
        node.innerHTML = `<img alt="" draggable="false" src="${srcs[i]}"><span class="h h-rot" title="돌리기"></span><span class="h h-size" title="크기"></span>`;
        placeSticker(node, s, H);
        (s.layer === 'back' ? back : front).appendChild(node);
      });
    });
  }
  function refreshStickerPositions() {
    pagesMeta.forEach(({ page, H }) => $$('.pp-st', page).forEach(n => {
      const s = state.stickers.find(x => x.id === n.dataset.id);
      if (s) placeSticker(n, s, H);
    }));
  }

  /* ─ 전체 그리기 ─ */
  async function render() {
    const token = ++renderToken;
    const stage = $('#pp-stage');
    const srcs = await Promise.all(state.stickers.map(stickerSrc));
    const divBase = state.body.divider === 'ornament' ? A.ornament({ color: '#000' }) : A.flower({ color: '#000', center: '#000' });
    dividerSrc = await A.process(divBase, { tint: 'solid', c1: state.body.dividerColor });
    if (state.body.divider === 'flower') dividerSrc = A.flower({ color: state.body.dividerColor, center: shade(state.body.dividerColor) });
    let borderSrc = null;
    if (token !== renderToken) return;

    stage.innerHTML = '';
    pagesMeta = [];
    const blocks = collectBlocks();
    const g = geom(), W = state.page.w;
    const finish = (p, H) => {
      p.page.style.height = H + 'px';
      if (state.bg.border === 'woodcut') {
        borderSrc = A.woodcutFrame(W, H, { color: state.bg.borderColor });
        p.page.querySelector('.pp-border').style.backgroundImage = `url("${borderSrc}")`;
      }
      pagesMeta.push({ ...p, H });
    };

    if (!state.page.h) {
      const p = makePage(stage, 0);
      blocks.forEach(b => p.body.appendChild(b));
      finish(p, Math.max(state.page.minH, Math.ceil(g.top + p.body.scrollHeight + g.bottom)));
    } else {
      const H = state.page.h, maxH = Math.max(80, H - g.top - g.bottom);
      let p = makePage(stage, 0), queue = blocks.slice(), guard = 0;
      while (queue.length && guard++ < 2000) {
        const b = queue.shift();
        if (!p.body.children.length && b.classList.contains('pp-blank')) continue;
        p.body.appendChild(b);
        if (p.body.scrollHeight <= maxH + 0.5) continue;
        b.remove();
        const parts = /^(P|BLOCKQUOTE|H2|H3|ASIDE)$/.test(b.tagName) ? splitToFit(p.body, b, maxH) : null;
        if (parts) { p.body.appendChild(parts[0]); queue.unshift(parts[1]); }
        else if (!p.body.children.length) { p.body.appendChild(b); } // 한 장에도 안 들어가면 그대로 둔다
        else queue.unshift(b);
        finish(p, H);
        p = makePage(stage, pagesMeta.length);
      }
      if (p.body.children.length || !pagesMeta.length) finish(p, H); else p.wrap.remove();
      // 제목을 첫 장에만 보이게 했다면 이후 장의 제목을 지운다 (makePage가 이미 처리)
    }
    drawStickers(srcs);
    applyZoom();
    $('#pp-info').textContent = `${pagesMeta.length}장 · ${W} × ${pagesMeta.map(m => m.H).join(', ')}px`;
  }
  const shade = hex => { const n = parseInt(hex.slice(1), 16); const k = 0.55; return '#' + [n >> 16 & 255, n >> 8 & 255, n & 255].map(v => Math.round(v * k).toString(16).padStart(2, '0')).join(''); };

  let raf = 0;
  function renderSoon() { cancelAnimationFrame(raf); raf = requestAnimationFrame(() => render()); }
  function changed(full = true) {
    onChange && onChange();
    if (full) renderSoon(); else refreshStickerPositions();
  }

  function scale() {
    const stage = $('#pp-stage');
    if (zoom !== 'fit') return +zoom;
    return Math.min(1, (stage.clientWidth - 40) / state.page.w);
  }
  function applyZoom() {
    const k = scale();
    pagesMeta.forEach(({ wrap, page, H }) => {
      page.style.transform = `scale(${k})`;
      wrap.style.width = state.page.w * k + 'px';
      wrap.style.height = H * k + 'px';
    });
  }

  /* ─ 장식 끌기 / 크기 / 회전 ─ */
  function bindStage() {
    const stage = $('#pp-stage');
    let drag = null;
    stage.addEventListener('pointerdown', e => {
      const node = e.target.closest('.pp-st');
      if (!node) { if (e.target.closest('.pp') || e.target === stage) select(null); return; }
      e.preventDefault();
      const s = state.stickers.find(x => x.id === node.dataset.id);
      select(s.id);
      const pageEl = node.closest('.pp'), meta = pagesMeta[+pageEl.dataset.index];
      const k = scale(), rect = node.getBoundingClientRect();
      drag = {
        s, H: meta.H, k, mode: e.target.classList.contains('h-size') ? 'size' : e.target.classList.contains('h-rot') ? 'rot' : 'move',
        sx: e.clientX, sy: e.clientY, x0: s.x, top0: stickerTop(s, meta.H), w0: s.w,
        cx: rect.left + rect.width / 2, cy: rect.top + rect.height / 2, hPx: node.offsetHeight
      };
      stage.setPointerCapture(e.pointerId);
    });
    stage.addEventListener('pointermove', e => {
      if (!drag) return;
      const { s, k } = drag, dx = (e.clientX - drag.sx) / k, dy = (e.clientY - drag.sy) / k;
      if (drag.mode === 'move') {
        s.x = Math.round(drag.x0 + dx);
        const top = Math.round(drag.top0 + dy);
        if (s.anchor === 'bottom') s.yb = drag.H - top; else s.y = top;
      } else if (drag.mode === 'size') {
        s.w = Math.max(16, Math.round(drag.w0 + dx));
      } else {
        const a = Math.atan2(e.clientY - drag.cy, e.clientX - drag.cx) * 180 / Math.PI + 90;
        s.rot = Math.round(e.shiftKey ? a : Math.round(a / 5) * 5);
      }
      refreshStickerPositions();
      syncStickerPanel();
    });
    const end = () => {
      if (!drag) return;
      const { s, H, hPx } = drag;
      // 아래쪽 절반에 놓인 장식은 아래 가장자리를 기준으로 붙어 있게 한다 (글 길이가 바뀌어도 따라감)
      const top = stickerTop(s, H);
      if (top + hPx / 2 > H / 2) { s.anchor = 'bottom'; s.yb = H - top; } else { s.anchor = 'top'; s.y = top; }
      drag = null;
      changed(false);
    };
    stage.addEventListener('pointerup', end);
    stage.addEventListener('pointercancel', end);
    window.addEventListener('resize', () => { if (document.body.dataset.mode === 'poster') applyZoom(); });
    document.addEventListener('keydown', e => {
      if (document.body.dataset.mode !== 'poster' || !selected || e.target.closest('input, select, textarea, [contenteditable="true"]')) return;
      const s = state.stickers.find(x => x.id === selected);
      if (!s) return;
      const step = e.shiftKey ? 10 : 1;
      if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); removeSticker(); return; }
      const mv = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key];
      if (!mv) return;
      e.preventDefault();
      s.x += mv[0];
      if (s.anchor === 'bottom') s.yb -= mv[1]; else s.y += mv[1];
      changed(false);
    });
  }

  function select(id) {
    selected = id;
    refreshStickerPositions();
    $('#pp-sel').hidden = !id;
    $('#pp-sel-empty').hidden = !!id;
    syncStickerPanel();
  }
  function removeSticker() {
    state.stickers = state.stickers.filter(s => s.id !== selected);
    select(null);
    changed();
  }

  /* ─ 설정 패널 ─ */
  const fontOptions = () => NT.FONTS.map(f => `<option value="${f.id}">${f.name}</option>`).join('');
  const opts = o => Object.entries(o).map(([k, v]) => `<option value="${k}">${v}</option>`).join('');
  const range = (k, label, min, max, step, unit = '') => `<label class="slider">${label} <output data-o="${k}" data-unit="${unit}"></output><input type="range" id="pp-${k.replace(/\./g, '-')}" data-k="${k}" min="${min}" max="${max}" step="${step}"></label>`;
  const color = (k, label) => `<label class="row">${label} <input type="color" id="pp-${k.replace(/\./g, '-')}" data-k="${k}"></label>`;
  const check = (k, label) => `<label class="check"><input type="checkbox" id="pp-${k.replace(/\./g, '-')}" data-k="${k}"> ${label}</label>`;
  const select_ = (k, label, html) => `<label class="row">${label} <select id="pp-${k.replace(/\./g, '-')}" data-k="${k}">${html}</select></label>`;

  function buildPanel() {
    const P = $('#pp-panel');
    P.innerHTML = `
      <details open><summary>템플릿</summary>
        <div class="pp-presets">${Object.entries(PRESETS).map(([id, p]) => `<button class="pp-preset" data-preset="${id}"><span style="background:${p.swatch[0]}"><i style="background:${p.swatch[1]}"></i><i style="background:${p.swatch[2]}"></i></span>${p.name}</button>`).join('')}</div>
        <p class="desc small">템플릿을 고르면 배경·틀·글꼴·장식이 한꺼번에 바뀌어요.</p>
      </details>
      <details open><summary>장식</summary>
        <div class="pp-adds">${Object.entries(A.BUILTINS).map(([id, b]) => `<button class="chip" data-add="${id}">+ ${b.name}</button>`).join('')}
          <button class="chip strong" id="pp-upload-btn">+ 내 이미지</button></div>
        <p class="desc small" id="pp-sel-empty">장식을 누르면 선택돼요. 끌어서 옮기고, 오른쪽 아래 점으로 크기, 위쪽 점으로 방향을 바꿉니다.</p>
        <div id="pp-sel" hidden>
          ${range('st.w', '크기', 16, 1400, 1, 'px')}
          ${range('st.rot', '회전', -180, 180, 1, '°')}
          ${range('st.opacity', '불투명도', 0.05, 1, 0.05)}
          <div class="row">좌우·상하 뒤집기 <span><label class="check inline"><input type="checkbox" id="pp-st-flip" data-k="st.flip"> ↔</label> <label class="check inline"><input type="checkbox" id="pp-st-flipY" data-k="st.flipY"> ↕</label></span></div>
          ${select_('st.layer', '겹침', opts({ front: '글 위', back: '틀 뒤' }))}
          ${select_('st.pages', '나오는 장', opts({ all: '모든 장', first: '첫 장만', last: '마지막 장만' }))}
          ${select_('st.tint', '색 입히기', opts({ none: '원래 색', solid: '단색', gradient: '그라데이션' }))}
          <div class="row" id="pp-tint-colors">색 <span><input type="color" id="pp-st-c1" data-k="st.c1"> <input type="color" id="pp-st-c2" data-k="st.c2"></span></div>
          ${range('st.angle', '그라데이션 방향', 0, 360, 5, '°')}
          ${check('st.knock', '흰 배경 지우기 (스캔한 그림·사진용)')}
          <div class="pp-sel-actions">
            <button class="btn small" data-act="mirror">좌우 대칭 복제</button>
            <button class="btn small" data-act="dup">복제</button>
            <button class="btn small" data-act="reseed" id="pp-reseed">다시 그리기</button>
            <button class="btn small" data-act="front">맨 앞으로</button>
            <button class="btn small danger" data-act="del">삭제</button>
          </div>
        </div>
      </details>
      <details open><summary>판형</summary>
        ${select_('page.w', '폭', opts({ 1080: '1080px', 1200: '1200px', 1280: '1280px' }))}
        ${select_('page.h', '길이', opts({ 0: '한 장 (글 길이에 맞춤)', 1350: '1350px씩 나누기 (4:5)', 1600: '1600px씩 나누기', 2000: '2000px씩 나누기', 2400: '2400px씩 나누기' }))}
        ${range('page.minH', '최소 길이 (한 장일 때)', 800, 3000, 50, 'px')}
      </details>
      <details><summary>배경</summary>
        ${color('bg.color', '바탕색')}
        ${select_('bg.texture', '질감', opts(TEXTURES))}
        ${select_('bg.border', '테두리', opts({ none: '없음', woodcut: '목판화' }))}
        ${color('bg.borderColor', '테두리 색')}
        <div class="row">배경 사진 <span><button class="btn small" id="pp-bg-btn">올리기</button> <button class="btn small ghost" id="pp-bg-del">지우기</button></span></div>
        ${range('bg.imageOpacity', '사진 불투명도', 0.05, 1, 0.05)}
        ${check('bg.imageGray', '사진 흑백으로')}
      </details>
      <details><summary>틀과 모눈</summary>
        ${select_('frame.style', '선', opts({ none: '없음', single: '한 줄', double: '두 줄' }))}
        ${color('frame.color', '선 색')}
        ${range('frame.width', '선 굵기', 0.5, 6, 0.1, 'px')}
        ${range('frame.x', '좌우 여백', 0, 300, 1, 'px')}
        ${range('frame.top', '위 여백', 0, 700, 1, 'px')}
        ${range('frame.bottom', '아래 여백', 0, 700, 1, 'px')}
        ${color('frame.fill', '안쪽 칠')}
        ${range('frame.fillOpacity', '안쪽 칠 불투명도', 0, 1, 0.05)}
        ${check('frame.grid', '모눈 그리기')}
        ${range('frame.gridSize', '모눈 칸', 6, 40, 1, 'px')}
        ${color('frame.gridColor', '모눈 색')}
        ${range('frame.gridOpacity', '모눈 진하기', 0.05, 1, 0.05)}
      </details>
      <details><summary>제목</summary>
        ${check('title.show', '제목 넣기 (문서 제목)')}
        ${check('title.every', '나눈 장마다 제목 넣기')}
        ${select_('title.font', '글꼴', fontOptions())}
        ${range('title.size', '크기', 24, 140, 1, 'px')}
        ${range('title.y', '위치 (위에서)', 0, 600, 1, 'px')}
        ${color('title.color', '색')}
      </details>
      <details open><summary>본문</summary>
        ${select_('body.font', '글꼴', fontOptions())}
        ${range('body.size', '크기', 14, 40, 0.5, 'px')}
        ${range('body.lh', '행간', 1.2, 2.6, 0.02)}
        ${range('body.ls', '자간', -0.08, 0.1, 0.005, 'em')}
        ${select_('body.align', '정렬', opts({ justify: '양쪽 정렬', left: '왼쪽 정렬', center: '가운데' }))}
        ${range('body.indent', '첫 줄 들여쓰기', 0, 3, 0.25, 'em')}
        ${range('body.gap', '문단 사이', 0, 3, 0.1, 'em')}
        ${range('body.padX', '틀 안 좌우 여백', 0, 200, 1, 'px')}
        ${range('body.padTop', '틀 안 위 여백', 0, 300, 1, 'px')}
        ${range('body.padBottom', '틀 안 아래 여백', 0, 500, 1, 'px')}
        ${color('body.color', '글자색')}
        ${color('body.quoteColor', '인용 글자색')}
        ${select_('body.divider', '구분선(—) 모양', opts(DIVIDERS))}
        ${color('body.dividerColor', '구분선 색')}
        ${check('body.count', '끝에 글자 수 붙이기 (1,136자.)')}
      </details>`;

    P.addEventListener('input', onField);
    P.addEventListener('change', onField);
    P.addEventListener('click', e => {
      const pre = e.target.closest('[data-preset]');
      if (pre) { applyPreset(pre.dataset.preset); return; }
      const add = e.target.closest('[data-add]');
      if (add) { addBuiltin(add.dataset.add); return; }
      const act = e.target.closest('[data-act]');
      if (act) stickerAction(act.dataset.act);
    });
    $('#pp-upload-btn').addEventListener('click', () => $('#pp-file').click());
    $('#pp-bg-btn').addEventListener('click', () => $('#pp-bgfile').click());
    $('#pp-bg-del').addEventListener('click', () => { state.bg.image = null; changed(); });
    $('#pp-file').addEventListener('change', async e => {
      const f = e.target.files[0]; e.target.value = '';
      if (!f) return;
      const data = await A.shrinkUpload(f);
      const img = await A.loadImg(data);
      const w = Math.min(500, img.naturalWidth);
      const s = st('upload', Math.round((state.page.w - w) / 2), 40, w, { kind: 'upload', data, knock: /jpe?g/i.test(f.type) });
      delete s.gen;
      state.stickers.push(s);
      select(s.id);
      changed();
    });
    $('#pp-bgfile').addEventListener('change', async e => {
      const f = e.target.files[0]; e.target.value = '';
      if (!f) return;
      state.bg.image = await A.shrinkUpload(f, 1600);
      changed();
    });
  }

  function onField(e) {
    const el = e.target;
    const k = el.dataset && el.dataset.k;
    if (!k) return;
    let v = el.type === 'checkbox' ? el.checked : el.type === 'range' || el.type === 'number' ? parseFloat(el.value) : el.value;
    if (k === 'page.w' || k === 'page.h') v = parseInt(v, 10);
    if (k.startsWith('st.')) {
      const s = state.stickers.find(x => x.id === selected);
      if (!s) return;
      s[k.slice(3)] = v;
      const posOnly = /^st\.(w|rot|opacity|flip|flipY)$/.test(k);
      changed(!posOnly);
    } else {
      set(state, k, v);
      changed();
    }
    syncOutputs();
    if (k === 'st.tint') syncStickerPanel();
  }

  function syncOutputs() {
    $$('#pp-panel [data-o]').forEach(o => {
      const k = o.dataset.o;
      const v = k.startsWith('st.') ? (state.stickers.find(x => x.id === selected) || {})[k.slice(3)] : get(state, k);
      if (v == null) return;
      o.textContent = (typeof v === 'number' && !Number.isInteger(v) ? v.toFixed(2).replace(/0$/, '') : v) + (o.dataset.unit || '');
    });
  }
  function syncPanel() {
    $$('#pp-panel [data-k]').forEach(el => {
      const k = el.dataset.k;
      if (k.startsWith('st.')) return;
      const v = get(state, k);
      if (el.type === 'checkbox') el.checked = !!v; else el.value = v;
    });
    syncOutputs();
    syncStickerPanel();
  }
  function syncStickerPanel() {
    const s = state && state.stickers.find(x => x.id === selected);
    if (!s) return;
    $$('#pp-panel [data-k^="st."]').forEach(el => {
      const v = s[el.dataset.k.slice(3)];
      if (el.type === 'checkbox') el.checked = !!v; else if (v != null) el.value = v;
    });
    $('#pp-tint-colors').hidden = s.tint === 'none';
    $('#pp-st-c2').hidden = s.tint !== 'gradient';
    $('#pp-st-angle').closest('label').hidden = s.tint !== 'gradient';
    $('#pp-reseed').hidden = s.kind !== 'builtin' || s.gen === 'flower' || s.gen === 'ornament' || s.gen === 'corner';
    syncOutputs();
  }

  function applyPreset(id) {
    const keepUploads = state ? state.stickers.filter(s => s.kind === 'upload') : [];
    state = { preset: id, ...PRESETS[id].make() };
    state.stickers.push(...keepUploads);
    select(null);
    syncPanel();
    $$('.pp-preset').forEach(b => b.classList.toggle('active', b.dataset.preset === id));
    changed();
  }

  function addBuiltin(gen) {
    const b = A.BUILTINS[gen];
    const w = Math.min(b.w, state.page.w);
    const s = st(gen, Math.round((state.page.w - w) / 2), 60, w);
    state.stickers.push(s);
    select(s.id);
    changed();
  }

  function stickerAction(act) {
    const i = state.stickers.findIndex(x => x.id === selected);
    if (i < 0) return;
    const s = state.stickers[i];
    if (act === 'del') return removeSticker();
    if (act === 'dup' || act === 'mirror') {
      const c = { ...s, id: NT.uid(), params: { ...s.params } };
      if (act === 'mirror') { c.x = state.page.w - s.x - s.w; c.flip = !s.flip; c.rot = -s.rot; }
      else { c.x += 30; if (c.anchor === 'bottom') c.yb -= 30; else c.y += 30; }
      state.stickers.push(c);
      select(c.id);
    }
    if (act === 'reseed') s.seed = Math.floor(Math.random() * 1e6) + 1;
    if (act === 'front') { state.stickers.splice(i, 1); state.stickers.push(s); }
    changed();
  }

  /* ─ 내보내기 ─ */
  async function exportPng(ratio) {
    if (!window.htmlToImage) { NT.toast('이미지 변환 모듈을 불러오지 못했어요.'); return; }
    const prevSel = selected;
    select(null);
    NT.toast(`${pagesMeta.length}장을 이미지로 만드는 중…`, 5000);
    await document.fonts.ready;
    const title = NT.safeFilename(getTitle());
    const imgs = [];
    for (let i = 0; i < pagesMeta.length; i++) {
      const { page, H } = pagesMeta[i];
      const prev = page.style.transform;
      page.style.transform = 'none';
      const opt = { pixelRatio: ratio, width: state.page.w, height: H, cacheBust: true };
      let url;
      try { url = await htmlToImage.toPng(page, opt); }
      catch { try { url = await htmlToImage.toPng(page, { ...opt, skipFonts: true }); } catch (e) { NT.toast('이미지로 만들지 못했어요: ' + (e.message || e)); } }
      page.style.transform = prev;
      if (!url) continue;
      const name = `${title}${pagesMeta.length > 1 ? '-' + String(i + 1).padStart(2, '0') : ''}.png`;
      if (NT.embedded) imgs.push({ src: url, name });
      else {
        const a = document.createElement('a');
        a.href = url; a.download = name;
        document.body.appendChild(a); a.click(); a.remove();
        await new Promise(r => setTimeout(r, 350));
      }
    }
    if (imgs.length) NT.ui.showImages(imgs);
    if (prevSel) select(prevSel);
  }

  return {
    PRESETS,
    init({ editor, title, onChange: cb }) {
      editorEl = editor; getTitle = title; onChange = cb;
      buildPanel();
      bindStage();
      $('#pp-zoom').addEventListener('change', e => { zoom = e.target.value; applyZoom(); });
      $('#pp-export').addEventListener('click', () => exportPng(parseFloat($('#pp-ratio').value)));
    },
    set(p) {
      state = p && p.stickers ? JSON.parse(JSON.stringify(p)) : { preset: 'ink', ...PRESETS.ink.make() };
      selected = null;
      if ($('#pp-panel').children.length) {
        syncPanel();
        $$('.pp-preset').forEach(b => b.classList.toggle('active', b.dataset.preset === state.preset));
        $('#pp-sel').hidden = true; $('#pp-sel-empty').hidden = false;
      }
    },
    get: () => state,
    render,
    applyZoom
  };
})();
