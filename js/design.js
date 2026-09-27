/* 디자인 패널: 테마·글꼴·조판 값을 문서(.nt-page)에 CSS 변수로 입힌다. */
NT.design = (() => {
  let state = null, onChange = null;

  const SLIDERS = [
    { key: 'fs', out: v => v + 'px' },
    { key: 'lh', out: v => Math.round(v * 100) + '%' },
    { key: 'ls', out: v => (v > 0 ? '+' : '') + Number(v).toFixed(3) + 'em' },
    { key: 'pg', out: v => Number(v).toFixed(1) + 'em' },
    { key: 'w', out: v => v + 'px' }
  ];
  const IDS = { fs: 'd-fs', lh: 'd-lh', ls: 'd-ls', pg: 'd-pg', w: 'd-w' };
  const OUTS = { fs: 'o-fs', lh: 'o-lh', ls: 'o-ls', pg: 'o-pg', w: 'o-w' };
  const CHECKS = { indent: 'd-indent', dropcap: 'd-dropcap', keepall: 'd-keepall', balance: 'd-balance' };

  function defaults(themeId) {
    const t = NT.themeById(themeId);
    return { theme: t.id, ...t.design };
  }

  /* 어떤 요소(.nt-page)에 디자인 값을 입힌다 — 편집 화면과 카드뉴스가 같이 쓴다 */
  function applyTo(el, d) {
    const t = NT.themeById(d.theme);
    el.classList.forEach(c => { if (/^(theme-|opt-)/.test(c)) el.classList.remove(c); });
    el.classList.add('nt-page', 'theme-' + t.id);
    if (d.dropcap) el.classList.add('opt-dropcap');
    if (d.keepall) el.classList.add('opt-keepall');
    if (d.balance) el.classList.add('opt-balance');
    const c = t.colors;
    const vars = {
      '--nt-font-body': NT.fontById(d.fontBody).stack,
      '--nt-font-head': NT.fontById(d.fontHead).stack,
      '--nt-fs': d.fs + 'px', '--nt-lh': d.lh, '--nt-ls': d.ls + 'em', '--nt-pg': d.pg + 'em', '--nt-w': d.w + 'px',
      '--nt-align': d.align, '--nt-indent': d.indent ? '1em' : '0', '--nt-accent': d.accent,
      '--nt-bg': c.bg, '--nt-fg': c.fg, '--nt-muted': c.muted, '--nt-rule': c.rule,
      '--nt-quote-bg': c.quoteBg, '--nt-code-bg': c.codeBg, '--nt-mark': c.mark
    };
    for (const [k, v] of Object.entries(vars)) el.style.setProperty(k, v);
  }

  function render() {
    applyTo(NT.$('#page'), state);
    // 포커스·미리보기 모드에서 화면 전체를 종이색으로 칠할 때 쓴다
    document.documentElement.style.setProperty('--nt-page-bg', NT.themeById(state.theme).colors.bg);
    NT.$$('.theme-card').forEach(b => b.classList.toggle('active', b.dataset.theme === state.theme));
    NT.$('#d-font-body').value = state.fontBody;
    NT.$('#d-font-head').value = state.fontHead;
    for (const s of SLIDERS) {
      NT.$('#' + IDS[s.key]).value = state[s.key];
      NT.$('#' + OUTS[s.key]).textContent = s.out(state[s.key]);
    }
    NT.$$('[data-align]').forEach(b => b.classList.toggle('active', b.dataset.align === state.align));
    NT.$$('.swatch').forEach(b => b.classList.toggle('active', b.dataset.color === state.accent));
    NT.$('#custom-accent').value = state.accent;
    for (const [k, id] of Object.entries(CHECKS)) NT.$('#' + id).checked = !!state[k];
  }

  function update(patch) {
    state = { ...state, ...patch };
    render();
    onChange && onChange(state);
  }

  function buildUI() {
    NT.$('#theme-grid').innerHTML = NT.THEMES.map(t => `
      <button class="theme-card" data-theme="${t.id}" title="${t.desc}"
        style="--tb:${t.colors.bg};--tf:${t.colors.fg};--ta:${t.design.accent};--tfont:${NT.fontById(t.design.fontHead).stack.replace(/"/g, '&quot;')}">
        <span class="theme-sample"><b>가나</b><i></i></span>
        <span class="theme-name">${t.name}</span>
      </button>`).join('');
    const opts = NT.FONTS.map(f => `<option value="${f.id}" style="font-family:${f.stack.replace(/"/g, '&quot;')}">${f.name}</option>`).join('');
    NT.$('#d-font-body').innerHTML = opts;
    NT.$('#d-font-head').innerHTML = opts;
    NT.$('#swatches').innerHTML = NT.ACCENTS.map(c => `<button class="swatch" data-color="${c}" style="--c:${c}" aria-label="강조색 ${c}"></button>`).join('')
      + '<label class="swatch custom" title="직접 고르기"><input type="color" id="custom-accent"></label>';

    NT.$('#theme-grid').addEventListener('click', e => {
      const b = e.target.closest('.theme-card');
      if (b) update(defaults(b.dataset.theme));
    });
    NT.$('#d-font-body').addEventListener('change', e => update({ fontBody: e.target.value }));
    NT.$('#d-font-head').addEventListener('change', e => update({ fontHead: e.target.value }));
    for (const s of SLIDERS) NT.$('#' + IDS[s.key]).addEventListener('input', e => update({ [s.key]: parseFloat(e.target.value) }));
    NT.$$('[data-align]').forEach(b => b.addEventListener('click', () => update({ align: b.dataset.align })));
    NT.$('#swatches').addEventListener('click', e => { const b = e.target.closest('.swatch[data-color]'); if (b) update({ accent: b.dataset.color }); });
    NT.$('#custom-accent').addEventListener('input', e => update({ accent: e.target.value }));
    for (const [k, id] of Object.entries(CHECKS)) NT.$('#' + id).addEventListener('change', e => update({ [k]: e.target.checked }));
    NT.$('#btn-reset-design').addEventListener('click', () => update(defaults(state.theme)));
  }

  return {
    init(cb) { onChange = cb; buildUI(); },
    set(d) { state = { ...defaults(d && d.theme), ...(d || {}) }; render(); },
    get: () => state,
    defaults, applyTo
  };
})();
