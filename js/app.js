/* 앱 조립: 문서 관리, 모드 전환, 패널, 내보내기 */
(() => {
  const { $, $$ } = NT;
  const editorEl = $('#editor');
  const titleEl = $('#doc-title');
  let doc = null;
  let mode = 'edit';

  const SAMPLE = `
<h1>나비텍스트에 오신 것을 환영해요</h1>
<p>나비텍스트는 <strong>글을 쓰는 곳</strong>과 <mark>글을 꾸미는 곳</mark>을 하나로 합친 편집기예요. 오른쪽 <span class="accent">디자인</span> 패널에서 테마를 바꾸면 이 글의 모양이 바로 달라집니다.</p>
<h2>이렇게 써 보세요</h2>
<ul><li>빈 줄에서 <code>/</code>를 누르면 제목·인용·목록·콜아웃·구분선을 넣을 수 있어요.</li><li><code># </code>, <code>&gt; </code>, <code>- </code>, <code>1. </code>처럼 마크다운으로 시작해도 바로 바뀝니다.</li><li>글자를 드래그하면 서식 툴바가 떠요. 형광펜과 강조색도 있어요.</li><li><code>Alt + ↑/↓</code>로 문단을 위아래로 옮길 수 있어요.</li></ul>
<aside class="callout" data-icon="💡">붙여넣은 글이 지저분하다면 <strong>다듬기</strong> 탭에서 공백·따옴표·말줄임표를 한 번에 정리하세요.</aside>
<blockquote class="pull">좋은 글은 읽기 쉬운 모양에서 시작한다.</blockquote>
<h2>문장 점검</h2>
<p>이 문단은 일부러 길게 쓴 문장을 담고 있는데요, 점검 탭을 열어 보면 칠십 자가 넘는 문장은 노란색으로, 백 자가 넘는 문장은 빨간색으로 표시되기 때문에 어디를 끊어 쓰면 좋을지 한눈에 알 수 있게 되어지는 것이다.</p>
<p>또한 “~에 대해”, “~를 통해”, “되어지다” 같은 번역투와 군더더기 표현도 찾아 줍니다.</p>
<hr>
<h2>카드뉴스로 만들기</h2>
<p>위에 있는 구분선을 기준으로 글이 카드 한 장씩 나뉘어요. 상단의 <strong>카드뉴스</strong> 버튼을 눌러 보세요.</p>
<p>1:1, 4:5, 9:16 비율을 고르고 PNG로 저장할 수 있어요.</p>
`;

  /* ─ 글 이미지 ─ */
  NT.poster.init({ editor: editorEl, title: () => titleEl.value.trim(), onChange: () => markDirty(), onDocChange: () => editor.changed(true) });

  /* ─ 편집기 ─ */
  const editor = new NT.Editor(editorEl, {
    onChange: () => { markDirty(); analyzeSoon(); },
    isEditable: () => mode === 'edit'
  });

  /* ─ 저장 ─ */
  const saveState = $('#save-state');
  function markDirty() { saveState.textContent = '저장 중…'; saveSoon(); }
  function save() {
    if (!doc) return;
    doc.html = editor.html;
    doc.title = titleEl.value.trim();
    doc.design = NT.design.get();
    doc.poster = NT.poster.get();
    const ok = NT.store.save(doc);
    saveState.textContent = ok ? '저장됨' : (NT.store.isPersistent ? '저장 실패' : '임시 저장(이 탭에서만)');
    renderDocList();
  }
  const saveSoon = NT.debounce(save, 600);

  function newDoc(html, title, design) {
    return { id: NT.uid(), title: title || '', html: html || '<p><br></p>', design: design || NT.design.defaults('clean'), updatedAt: Date.now() };
  }

  function openDoc(d) {
    if (doc) save();
    doc = d;
    titleEl.value = d.title || '';
    NT.design.set(d.design);
    NT.poster.set(d.poster);
    editor.html = d.html;
    save();
    if (mode === 'cards') renderCards();
    if (mode === 'poster') NT.poster.render();
    runAnalysis();
    document.title = (d.title ? d.title + ' — ' : '') + '나비텍스트';
  }

  function renderDocList() {
    const list = NT.store.list();
    $('#doc-list').innerHTML = list.map(d => `
      <li class="${doc && d.id === doc.id ? 'active' : ''}" data-id="${d.id}">
        <button class="doc-open"><span class="doc-name">${NT.escapeHtml(d.title || '제목 없는 문서')}</span>
          <small>${new Date(d.updatedAt).toLocaleString('ko-KR', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</small></button>
        <button class="doc-del" title="삭제" aria-label="삭제">×</button>
      </li>`).join('');
  }

  $('#doc-list').addEventListener('click', async e => {
    const li = e.target.closest('li');
    if (!li) return;
    const id = li.dataset.id;
    if (e.target.closest('.doc-del')) {
      const d = NT.store.load(id);
      if (!await NT.ui.confirm('문서 삭제', `“${(d && d.title) || '제목 없는 문서'}”을(를) 지울까요? 되돌릴 수 없어요.`, '삭제', true)) return;
      NT.store.remove(id);
      if (doc && doc.id === id) {
        doc = null;
        const next = NT.store.list()[0];
        openDoc(next ? NT.store.load(next.id) : newDoc());
      }
      renderDocList();
      return;
    }
    const d = NT.store.load(id);
    if (d) openDoc(d);
  });

  $('#btn-new').addEventListener('click', () => {
    openDoc(newDoc('<p><br></p>', '', { ...NT.design.get() }));
    titleEl.focus();
  });
  $('#btn-docs').addEventListener('click', () => { const s = $('#sidebar'); s.hidden = !s.hidden; renderDocList(); });
  titleEl.addEventListener('input', () => { markDirty(); document.title = (titleEl.value ? titleEl.value + ' — ' : '') + '나비텍스트'; });
  titleEl.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); editor.focusStart(editorEl.firstElementChild || editorEl); } });

  /* ─ 모드 ─ */
  function setMode(m) {
    mode = m;
    document.body.dataset.mode = m;
    $$('[data-mode]').forEach(b => b.classList.toggle('active', b.dataset.mode === m));
    editorEl.contentEditable = m === 'edit' ? 'true' : 'false';
    $('#page-wrap').hidden = m === 'cards' || m === 'poster';
    $('#cards-wrap').hidden = m !== 'cards';
    $('#poster-wrap').hidden = m !== 'poster';
    editor.hideBubble(); editor.closeSlash();
    if (m === 'cards') renderCards();
    if (m === 'poster') NT.poster.render();
  }
  $$('[data-mode]').forEach(b => b.addEventListener('click', () => setMode(b.dataset.mode)));

  function cardOpts() {
    return { ratio: $('#card-ratio').value, bg: $('#card-bg').value, align: $('#card-align').value, num: $('#card-num').checked };
  }
  function renderCards() { NT.cards.render(editorEl, NT.design.get(), cardOpts(), titleEl.value.trim()); }
  ['#card-ratio', '#card-bg', '#card-align', '#card-num'].forEach(s => $(s).addEventListener('change', () => {
    NT.store.setPrefs({ cards: cardOpts() }); renderCards();
  }));
  $('#btn-cards-png').addEventListener('click', () => NT.cards.exportAll(titleEl.value.trim()));

  /* ─ 패널 ─ */
  $$('.tab').forEach(t => t.addEventListener('click', () => showTab(t.dataset.tab)));
  function showTab(name) {
    $$('.tab').forEach(t => t.classList.toggle('active', t.dataset.tab === name));
    $$('[data-tab-body]').forEach(b => { b.hidden = b.dataset.tabBody !== name; });
    if (name === 'tidy') previewTidy();
    if (name === 'check') runAnalysis();
    NT.store.setPrefs({ tab: name });
  }
  $('#btn-panel').addEventListener('click', () => {
    const hidden = document.body.classList.toggle('panel-closed');
    $('#btn-panel').classList.toggle('on', !hidden);
    NT.store.setPrefs({ panelClosed: hidden });
  });

  /* ─ 다듬기 ─ */
  const tidyOff = new Set(NT.store.prefs().tidyOff || []);
  $('#tidy-list').innerHTML = NT.TIDY_RULES.map(r => `
    <li><label class="check">
      <input type="checkbox" data-rule="${r.id}" ${tidyOff.has(r.id) ? '' : 'checked'}>
      <span><span class="rule-name">${r.name}</span> <span class="count" data-count="${r.id}"></span>
      <small>${NT.escapeHtml(r.example)}</small></span>
    </label></li>`).join('');
  const selectedRules = () => $$('#tidy-list input:checked').map(i => i.dataset.rule);
  function previewTidy() {
    const counts = NT.tidy.run(editorEl, NT.TIDY_RULES.map(r => r.id), true);
    let total = 0;
    for (const r of NT.TIDY_RULES) {
      const n = counts[r.id] || 0;
      const on = selectedRules().includes(r.id);
      if (on) total += n;
      $(`[data-count="${r.id}"]`).textContent = n ? n + '곳' : '';
    }
    $('#tidy-total').textContent = total ? `${total}곳을 고칠 수 있어요` : '고칠 곳이 없어요 ✓';
  }
  $('#tidy-list').addEventListener('change', () => {
    NT.store.setPrefs({ tidyOff: $$('#tidy-list input:not(:checked)').map(i => i.dataset.rule) });
    previewTidy();
  });
  $('#btn-tidy').addEventListener('click', () => {
    editor.history.record();
    const counts = NT.tidy.run(editorEl, selectedRules(), false);
    const total = Object.values(counts).reduce((a, b) => a + b, 0);
    editor.changed(true);
    editor.history.record();
    NT.toast(total ? `${total}곳을 다듬었어요` : '고칠 곳이 없었어요');
    previewTidy();
  });

  /* ─ 점검 ─ */
  function runAnalysis() {
    const res = NT.analyze.run(editorEl);
    const s = res.stats;
    $('#stats').innerHTML = [
      ['글자', s.chars.toLocaleString()], ['공백 빼고', s.charsNoSpace.toLocaleString()],
      ['원고지', s.manuscript + '매'], ['읽는 시간', s.minutes ? '약 ' + s.minutes + '분' : '-'],
      ['문장', s.sentences], ['문단', s.paragraphs]
    ].map(([k, v]) => `<div class="stat"><b>${v}</b><span>${k}</span></div>`).join('');

    $('#long-list').innerHTML = res.longs.length
      ? res.longs.map((l, i) => `<li class="issue ${l.level}" data-long="${i}"><span class="badge">${l.len}자</span><span class="snip">${NT.escapeHtml(l.text.slice(0, 60))}${l.text.length > 60 ? '…' : ''}</span></li>`).join('')
      : '<li class="ok">긴 문장이 없어요 ✓</li>';
    $('#phrase-list').innerHTML = res.phrases.length
      ? res.phrases.map((p, i) => `<li class="issue phrase" data-phrase="${i}"><span class="badge">${p.ranges.length}</span><span><b>${p.label}</b><small>${p.tip}</small></span></li>`).join('')
      : '<li class="ok">눈에 띄는 군더더기 표현이 없어요 ✓</li>';
    $('#repeat-list').innerHTML = res.repeats.length
      ? res.repeats.map(([w, n]) => `<button class="chip" data-word="${NT.escapeHtml(w)}">${NT.escapeHtml(w)} <b>${n}</b></button>`).join('')
      : '<span class="muted">세 번 이상 반복된 낱말이 없어요</span>';
    NT.analyze.paint($('#c-highlight').checked);
    if (!NT.analyze.hasHighlight) $('#c-highlight').closest('label').title = '이 브라우저는 본문 표시를 지원하지 않아요';
  }
  const analyzeSoon = NT.debounce(runAnalysis, 400);
  $('#c-highlight').addEventListener('change', e => { NT.analyze.paint(e.target.checked); editorEl.classList.toggle('lint-on', e.target.checked); NT.store.setPrefs({ lint: e.target.checked }); });
  $('#long-list').addEventListener('click', e => {
    const li = e.target.closest('[data-long]');
    if (li) NT.analyze.focusRanges([NT.analyze.last.longs[+li.dataset.long].range]);
  });
  $('#phrase-list').addEventListener('click', e => {
    const li = e.target.closest('[data-phrase]');
    if (li) NT.analyze.focusRanges(NT.analyze.last.phrases[+li.dataset.phrase].ranges);
  });
  $('#repeat-list').addEventListener('click', e => {
    const b = e.target.closest('[data-word]');
    if (b) NT.analyze.focusRanges(NT.analyze.wordRanges(editorEl, b.dataset.word));
  });

  /* ─ 디자인 ─ */
  NT.design.init(() => { markDirty(); if (mode === 'cards') renderCards(); });

  /* ─ 내보내기 ─ */
  const menu = $('#export-menu');
  $('#btn-export').addEventListener('click', e => { e.stopPropagation(); menu.hidden = !menu.hidden; });
  document.addEventListener('click', e => { if (!e.target.closest('.menu-wrap')) menu.hidden = true; });
  menu.addEventListener('click', async e => {
    const b = e.target.closest('[data-export]');
    if (!b) return;
    menu.hidden = true;
    save();
    const title = titleEl.value.trim();
    const name = NT.safeFilename(title);
    switch (b.dataset.export) {
      case 'html': NT.download(name + '.html', NT.convert.toHtmlFile(title, $('#page')), 'text/html;charset=utf-8'); break;
      case 'md': NT.download(name + '.md', (title ? `# ${title}\n\n` : '') + NT.convert.toMarkdown(editorEl), 'text/markdown;charset=utf-8'); break;
      case 'txt': NT.download(name + '.txt', (title ? title + '\n\n' : '') + NT.convert.toText(editorEl)); break;
      case 'pdf': setMode('read'); setTimeout(() => window.print(), 100); break;
      case 'open': $('#file-open').click(); break;
      case 'copy-rich': await copyRich(); break;
    }
  });

  async function copyRich() {
    const html = NT.convert.inlineStyled($('#page'));
    const text = NT.convert.toText(editorEl);
    try {
      await navigator.clipboard.write([new ClipboardItem({
        'text/html': new Blob([html], { type: 'text/html' }),
        'text/plain': new Blob([text], { type: 'text/plain' })
      })]);
    } catch {
      // 오래된 브라우저: 화면 밖에 그려 놓고 선택해서 복사
      const holder = document.createElement('div');
      holder.style.cssText = 'position:fixed;left:-9999px;top:0';
      holder.innerHTML = html;
      document.body.appendChild(holder);
      const r = document.createRange(); r.selectNodeContents(holder);
      const sel = window.getSelection(); sel.removeAllRanges(); sel.addRange(r);
      document.execCommand('copy');
      sel.removeAllRanges(); holder.remove();
    }
    NT.toast('서식과 함께 복사했어요. 블로그나 메일 편집기에 붙여넣으세요.');
  }

  /* ─ 파일 열기 / 끌어놓기 ─ */
  function importFile(file) {
    const reader = new FileReader();
    reader.onload = () => {
      const txt = String(reader.result);
      const base = file.name.replace(/\.[^.]+$/, '');
      let html, title = base;
      if (/\.html?$/i.test(file.name)) {
        const parsed = new DOMParser().parseFromString(txt, 'text/html');
        const body = parsed.querySelector('.nt-doc') || parsed.body;
        html = NT.sanitize(body.innerHTML);
        title = parsed.title || base;
      } else if (/\.(md|markdown)$/i.test(file.name)) {
        let md = txt;
        const h = md.match(/^#\s+(.+)\n+/);
        if (h) { title = h[1].trim(); md = md.slice(h[0].length); }
        html = NT.convert.fromMarkdown(md);
      } else html = NT.convert.fromText(txt);
      openDoc(newDoc(html, title, { ...NT.design.get() }));
      NT.toast(`“${file.name}”을(를) 새 문서로 열었어요`);
    };
    reader.readAsText(file);
  }
  $('#file-open').addEventListener('change', e => { const f = e.target.files[0]; e.target.value = ''; if (f) importFile(f); });
  window.addEventListener('dragover', e => { if (e.dataTransfer.types.includes('Files')) e.preventDefault(); });
  window.addEventListener('drop', e => {
    const f = Array.from(e.dataTransfer.files || []).find(f => /\.(md|markdown|txt|html?)$/i.test(f.name));
    if (f) { e.preventDefault(); importFile(f); }
    else if (!e.target.closest('#editor')) e.preventDefault();
  });

  /* ─ 도구 버튼과 단축키 ─ */
  $('#btn-undo').addEventListener('click', () => editor.history.undo());
  $('#btn-redo').addEventListener('click', () => editor.history.redo());
  function toggleFocus(force) {
    const on = document.body.classList.toggle('focus-mode', force);
    $('#btn-focus').classList.toggle('on', on);
    if (on) { setMode('edit'); editorEl.focus(); NT.toast('포커스 모드 — Esc로 나가기'); }
  }
  $('#btn-focus').addEventListener('click', () => toggleFocus());
  function setUiTheme(t) {
    if (t) document.documentElement.dataset.theme = t; else delete document.documentElement.dataset.theme;
    NT.store.setPrefs({ ui: t || null });
  }
  $('#btn-ui-theme').addEventListener('click', () => {
    const dark = document.documentElement.dataset.theme
      ? document.documentElement.dataset.theme === 'dark'
      : matchMedia('(prefers-color-scheme: dark)').matches;
    setUiTheme(dark ? 'light' : 'dark');
  });

  document.addEventListener('keydown', e => {
    const mod = e.ctrlKey || e.metaKey;
    if (mod && e.key.toLowerCase() === 's') { e.preventDefault(); save(); NT.toast('저장했어요'); }
    else if (mod && e.key === '.') { e.preventDefault(); toggleFocus(); }
    else if (mod && e.shiftKey && e.key.toLowerCase() === 'o') { e.preventDefault(); $('#btn-docs').click(); }
    else if (e.key === 'Escape' && document.body.classList.contains('focus-mode') && !editor.slash) toggleFocus(false);
    else if (e.key === 'Escape' && mode !== 'edit') setMode('edit');
    // 편집기 밖(버튼 등)에 포커스가 있을 때도 실행 취소가 되도록
    else if (mod && e.key.toLowerCase() === 'z' && !e.target.closest('input, textarea, select, #editor')) {
      e.preventDefault(); e.shiftKey ? editor.history.redo() : editor.history.undo();
    }
  });
  window.addEventListener('beforeunload', save);
  window.addEventListener('afterprint', () => setMode('edit'));

  /* ─ 시작 ─ */
  if (NT.embedded) $('[data-export="pdf"]').hidden = true; // 임베드된 화면에서는 인쇄 창을 열 수 없다
  const prefs = NT.store.prefs();
  if (prefs.ui) document.documentElement.dataset.theme = prefs.ui;
  if (prefs.panelClosed || window.innerWidth < 900) document.body.classList.add('panel-closed');
  $('#btn-panel').classList.toggle('on', !document.body.classList.contains('panel-closed'));
  if (prefs.cards) {
    for (const [k, id] of [['ratio', '#card-ratio'], ['bg', '#card-bg'], ['align', '#card-align']]) if (prefs.cards[k]) $(id).value = prefs.cards[k];
    if (prefs.cards.num === false) $('#card-num').checked = false;
  }
  if (prefs.lint === false) $('#c-highlight').checked = false;
  editorEl.classList.toggle('lint-on', $('#c-highlight').checked);

  const lastId = NT.store.currentId();
  const last = lastId && NT.store.load(lastId);
  if (last) openDoc(last);
  else if (NT.store.list().length) openDoc(NT.store.load(NT.store.list()[0].id));
  else openDoc(newDoc(SAMPLE.trim(), '나비텍스트 둘러보기'));
  showTab(prefs.tab || 'design');
  setMode('edit');
  renderDocList();
})();
