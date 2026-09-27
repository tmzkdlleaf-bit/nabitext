/* 페이지 안 대화상자. 다른 페이지 안에 임베드되면(예: claude.ai 아티팩트) prompt()/confirm()과
 * 파일 다운로드가 막히므로, 입력·확인·내보내기 결과를 모두 여기서 보여 준다. */
NT.embedded = (() => { try { return window.self !== window.top; } catch { return true; } })();

NT.ui = (() => {
  let root = null;

  function ensure() {
    if (root) return root;
    root = document.createElement('div');
    root.className = 'modal-back';
    root.hidden = true;
    root.innerHTML = '<div class="modal" role="dialog" aria-modal="true"><h2 class="modal-title"></h2><div class="modal-body"></div><div class="modal-actions"></div></div>';
    document.body.appendChild(root);
    return root;
  }

  function open({ title, body, actions, onKey }) {
    const r = ensure();
    const prevFocus = document.activeElement;
    r.querySelector('.modal-title').textContent = title;
    const bodyEl = r.querySelector('.modal-body');
    bodyEl.innerHTML = '';
    if (body) bodyEl.appendChild(body);
    const act = r.querySelector('.modal-actions');
    act.innerHTML = '';
    return new Promise(resolve => {
      const close = value => {
        r.hidden = true;
        document.removeEventListener('keydown', key, true);
        if (prevFocus && prevFocus.focus) prevFocus.focus();
        resolve(value);
      };
      const key = e => {
        if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(null); }
        else if (onKey) onKey(e, close);
      };
      for (const a of actions) {
        const b = document.createElement('button');
        b.className = 'btn' + (a.primary ? ' primary' : '') + (a.danger ? ' danger' : '');
        b.textContent = a.label;
        b.addEventListener('click', () => a.onClick ? a.onClick(close, b) : close(a.value));
        act.appendChild(b);
      }
      r.onclick = e => { if (e.target === r) close(null); };
      document.addEventListener('keydown', key, true);
      r.hidden = false;
      const focusable = bodyEl.querySelector('input, textarea') || act.querySelector('.primary') || act.lastChild;
      focusable && focusable.focus();
    });
  }

  /* 확인 → true / 취소 → null */
  function confirm(title, message, okLabel = '확인', danger = false) {
    const p = document.createElement('p');
    p.textContent = message;
    return open({ title, body: p, actions: [{ label: '취소', value: null }, { label: okLabel, value: true, primary: !danger, danger }] });
  }

  /* 한 줄 입력 → 문자열 / 취소 → null */
  function ask(title, { value = '', placeholder = '', hint = '', okLabel = '확인' } = {}) {
    const wrap = document.createElement('div');
    const input = document.createElement('input');
    input.className = 'modal-input'; input.value = value; input.placeholder = placeholder; input.id = 'modal-input';
    wrap.appendChild(input);
    if (hint) { const s = document.createElement('small'); s.className = 'modal-hint'; s.textContent = hint; wrap.appendChild(s); }
    setTimeout(() => input.select(), 0);
    return open({
      title, body: wrap,
      actions: [{ label: '취소', value: null }, { label: okLabel, primary: true, onClick: close => close(input.value) }],
      onKey: (e, close) => { if (e.key === 'Enter' && e.target === input) { e.preventDefault(); close(input.value); } }
    });
  }

  async function copyText(text, btn) {
    try { await navigator.clipboard.writeText(text); }
    catch {
      const ta = root.querySelector('textarea');
      if (ta) { ta.focus(); ta.select(); document.execCommand('copy'); }
    }
    if (btn) { const t = btn.textContent; btn.textContent = '복사했어요'; setTimeout(() => { btn.textContent = t; }, 1500); }
  }

  /* 파일로 저장할 수 없을 때: 내용을 보여 주고 복사하게 한다 */
  function showText(filename, text) {
    const wrap = document.createElement('div');
    wrap.innerHTML = '<p class="modal-hint">이 화면에서는 파일을 바로 내려받을 수 없어요. 아래 내용을 복사해 <b></b> 파일로 저장하세요.</p>';
    wrap.querySelector('b').textContent = filename;
    const ta = document.createElement('textarea');
    ta.className = 'modal-text'; ta.readOnly = true; ta.value = text; ta.id = 'modal-text';
    wrap.appendChild(ta);
    return open({
      title: '내보내기', body: wrap,
      actions: [{ label: '닫기', value: null }, { label: '전체 복사', primary: true, onClick: (close, b) => copyText(text, b) }]
    });
  }

  function showImages(items) {
    const wrap = document.createElement('div');
    wrap.innerHTML = '<p class="modal-hint">이 화면에서는 파일을 바로 내려받을 수 없어요. 이미지를 길게 누르거나 오른쪽 버튼으로 눌러 저장하세요.</p>';
    const grid = document.createElement('div');
    grid.className = 'modal-images';
    for (const it of items) {
      const fig = document.createElement('figure');
      const img = new Image(); img.src = it.src; img.alt = it.name;
      const cap = document.createElement('figcaption'); cap.textContent = it.name;
      fig.append(img, cap); grid.appendChild(fig);
    }
    wrap.appendChild(grid);
    return open({ title: `카드 이미지 ${items.length}장`, body: wrap, actions: [{ label: '닫기', value: null, primary: true }] });
  }

  return { confirm, ask, showText, showImages };
})();
