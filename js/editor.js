/* 본문 편집기: 블록 변환, 슬래시 메뉴, 마크다운 단축 입력, 플로팅 툴바, 붙여넣기 정리 */
NT.cleanHtml = html => html.replace(/\s?\bis-current\b/g, '').replace(/ class=""/g, '');

NT.BLOCKS = [
  { id: 'p', label: '본문', icon: '¶', keys: 'p text paragraph 본문 문단 텍스트' },
  { id: 'h1', label: '제목 1', icon: 'H1', keys: 'h1 heading title 제목 큰제목' },
  { id: 'h2', label: '제목 2', icon: 'H2', keys: 'h2 heading 제목 중간제목 소제목' },
  { id: 'h3', label: '제목 3', icon: 'H3', keys: 'h3 heading 제목 작은제목' },
  { id: 'blockquote', label: '인용', icon: '❝', keys: 'quote blockquote 인용 인용구' },
  { id: 'pull', label: '강조 인용', icon: '❞', keys: 'pull quote 강조 인용 큰인용 발췌' },
  { id: 'ul', label: '글머리 목록', icon: '•', keys: 'ul list bullet 목록 리스트 글머리' },
  { id: 'ol', label: '번호 목록', icon: '1.', keys: 'ol list number 목록 번호 순서' },
  { id: 'callout', label: '콜아웃 상자', icon: '💡', keys: 'callout box note 상자 박스 메모 팁 강조' },
  { id: 'pre', label: '코드', icon: '</>', keys: 'code pre 코드 프로그램' },
  { id: 'hr', label: '구분선 · 카드 나누기', icon: '—', keys: 'hr divider line 구분선 줄 카드 나누기' },
  { id: 'image', label: '이미지', icon: '🖼', keys: 'image img picture photo 이미지 사진 그림' }
];

NT.Editor = class {
  constructor(el, { onChange, isEditable }) {
    this.el = el; this.onChange = onChange; this.isEditable = isEditable;
    this.bubble = NT.$('#bubble');
    this.slashEl = NT.$('#slash');
    this.slash = null;
    this.history = new NT.History(el, () => this.changed(true));
    this.history.root = el;
    const origRecord = this.history.record.bind(this.history);
    this.history.record = () => { this.stripCurrent(); origRecord(); this.markCurrent(); };
    this.recordSoon = NT.debounce(() => this.history.record(), 500);

    try { document.execCommand('defaultParagraphSeparator', false, 'p'); } catch { /* 무시 */ }

    el.addEventListener('keydown', e => this.onKeydown(e));
    el.addEventListener('beforeinput', e => this.onBeforeInput(e));
    el.addEventListener('input', e => this.onInput(e));
    el.addEventListener('paste', e => this.onPaste(e));
    el.addEventListener('drop', e => this.onDrop(e));
    el.addEventListener('click', e => {
      const a = e.target.closest('a');
      if (a && (e.metaKey || e.ctrlKey)) window.open(a.href, '_blank', 'noopener');
    });
    document.addEventListener('selectionchange', () => this.onSelection());
    window.addEventListener('resize', () => this.onSelection());
    NT.$('#workspace').addEventListener('scroll', () => this.positionBubble(), { passive: true });

    this.bubble.addEventListener('mousedown', e => { if (e.target.tagName !== 'SELECT') e.preventDefault(); });
    this.bubble.addEventListener('click', e => {
      const b = e.target.closest('button[data-cmd]');
      if (b) this.inline(b.dataset.cmd);
    });
    NT.$('#bubble-block').addEventListener('change', e => { this.restoreSel(); this.setBlock(e.target.value); });
    NT.$('#bubble-block').addEventListener('mousedown', () => this.saveSel());

    this.slashEl.addEventListener('mousedown', e => e.preventDefault());
    this.slashEl.addEventListener('click', e => {
      const it = e.target.closest('[data-block]');
      if (it) this.applySlash(it.dataset.block);
    });

    NT.$('#file-image').addEventListener('change', e => {
      const f = e.target.files[0]; e.target.value = '';
      if (f) this.insertImage(f);
    });
  }

  /* ─ 내용 ─ */
  get html() { return NT.cleanHtml(this.el.innerHTML); }
  set html(v) {
    this.el.innerHTML = v || '<p><br></p>';
    this.normalize();
    this.history.reset();
    this.changed(false);
  }
  changed(record) {
    this.normalize();
    this.el.classList.toggle('is-empty', this.el.children.length <= 1 && !this.el.textContent.trim() && !this.el.querySelector('img, hr'));
    if (record) this.recordSoon();
    this.onChange && this.onChange();
  }
  normalize() {
    const el = this.el;
    if (!el.firstChild) { el.innerHTML = '<p><br></p>'; return; }
    for (const n of Array.from(el.childNodes)) {
      if (n.nodeType === 3) {
        if (!n.data.trim()) { if (el.childNodes.length > 1) n.remove(); continue; }
        const p = document.createElement('p'); n.replaceWith(p); p.appendChild(n);
      } else if (n.nodeType === 1 && (n.tagName === 'DIV' || n.tagName === 'SPAN' || n.tagName === 'FONT' || n.tagName === 'B' || n.tagName === 'I')) {
        const p = document.createElement('p');
        if (n.tagName === 'DIV') { while (n.firstChild) p.appendChild(n.firstChild); } else p.appendChild(n.cloneNode(true));
        n.replaceWith(p);
      } else if (n.nodeType === 1 && n.tagName === 'BR' && el.childNodes.length > 1) n.remove();
    }
    // 구분선·이미지로 끝나면 이어 쓸 문단을 붙인다
    const last = el.lastElementChild;
    if (last && /^(HR|FIGURE|PRE)$/.test(last.tagName)) el.appendChild(Object.assign(document.createElement('p'), { innerHTML: '<br>' }));
    // 크롬이 붙이는 인라인 스타일 span 제거
    NT.$$('span[style], font', el).forEach(s => s.replaceWith(...s.childNodes));
    NT.$$('[style]', el).forEach(s => s.removeAttribute('style'));
  }

  /* ─ 선택 영역 도우미 ─ */
  topBlock(node) {
    if (!node || !this.el.contains(node) || node === this.el) return null;
    while (node.parentNode !== this.el) node = node.parentNode;
    return node.nodeType === 1 ? node : null;
  }
  currentBlock() {
    const sel = window.getSelection();
    return sel.rangeCount ? this.topBlock(sel.getRangeAt(0).startContainer) : null;
  }
  inEditor() {
    const sel = window.getSelection();
    return sel.rangeCount > 0 && this.el.contains(sel.anchorNode);
  }
  saveSel() { const s = window.getSelection(); this.saved = s.rangeCount ? s.getRangeAt(0).cloneRange() : null; }
  restoreSel() {
    if (!this.saved) return;
    const s = window.getSelection(); s.removeAllRanges(); s.addRange(this.saved);
  }
  caretAtEnd(block) {
    const sel = window.getSelection();
    if (!sel.rangeCount || !sel.isCollapsed) return false;
    const r = document.createRange();
    r.selectNodeContents(block);
    r.setStart(sel.getRangeAt(0).endContainer, sel.getRangeAt(0).endOffset);
    return r.toString().replace(/\u200b/g, '') === '';
  }
  textBeforeCaret(block) {
    const sel = window.getSelection();
    const r = document.createRange();
    r.selectNodeContents(block);
    r.setEnd(sel.getRangeAt(0).startContainer, sel.getRangeAt(0).startOffset);
    return r.toString();
  }
  focusStart(el) { this.el.focus(); const n = NT.textNodes(el)[0]; n ? NT.placeCaret(n, 0) : NT.placeCaret(el, 0); }
  focusEnd(el) {
    this.el.focus();
    const ns = NT.textNodes(el);
    if (ns.length) NT.placeCaret(ns[ns.length - 1], ns[ns.length - 1].length); else NT.placeCaret(el, 0);
  }

  /* ─ 블록 변환 ─ */
  makeBlock(type, contentFrom) {
    let el, holder;
    switch (type) {
      case 'pull': el = document.createElement('blockquote'); el.className = 'pull'; holder = el; break;
      case 'callout': el = document.createElement('aside'); el.className = 'callout'; el.dataset.icon = '💡'; holder = el; break;
      case 'ul': case 'ol': el = document.createElement(type); holder = el.appendChild(document.createElement('li')); break;
      default: el = document.createElement(type); holder = el;
    }
    if (contentFrom) {
      const src = contentFrom.tagName === 'UL' || contentFrom.tagName === 'OL'
        ? Array.from(contentFrom.children).map(li => li.innerHTML).join('<br>')
        : contentFrom.tagName === 'BLOCKQUOTE' && contentFrom.querySelector('p')
          ? Array.from(contentFrom.children).map(p => p.innerHTML).join('<br>')
          : contentFrom.innerHTML;
      holder.innerHTML = type === 'pre' ? NT.escapeHtml(contentFrom.innerText) : src;
    }
    if (!holder.textContent && !holder.querySelector('br, img')) holder.innerHTML = '<br>';
    return { el, holder };
  }

  setBlock(type) {
    const block = this.currentBlock();
    if (!block) return;
    this.history.record();
    const caret = NT.getCaretOffset(block) || 0;
    const same = (type === 'pull' && block.matches('blockquote.pull')) || (type === 'callout' && block.matches('aside.callout'))
      || (block.tagName.toLowerCase() === type && !block.classList.contains('pull'));
    const target = same && type !== 'p' ? 'p' : type; // 같은 종류를 다시 고르면 본문으로 되돌린다
    let first;
    if (block.tagName === 'UL' || block.tagName === 'OL') {
      // 목록은 항목마다 문단으로 풀어준다
      if (target === 'ul' || target === 'ol') {
        first = document.createElement(target);
        first.innerHTML = block.innerHTML; block.replaceWith(first);
      } else {
        const items = Array.from(block.children).map(li => this.makeBlock(target, li).el);
        block.replaceWith(...items);
        first = items[0];
      }
    } else {
      first = this.makeBlock(target, block).el;
      block.replaceWith(first);
    }
    this.el.focus();
    if (first) NT.setCaretOffset(first, caret);
    this.changed(true);
  }

  insertAfter(block, el) {
    if (block) block.after(el); else this.el.appendChild(el);
    return el;
  }

  insertBlock(type) {
    const block = this.currentBlock();
    const empty = block && block.tagName === 'P' && !block.textContent.trim() && !block.querySelector('img');
    this.history.record();
    if (type === 'hr') {
      const hr = document.createElement('hr');
      if (empty) block.replaceWith(hr); else this.insertAfter(block, hr);
      let next = hr.nextElementSibling;
      if (!next || next.tagName !== 'P') next = this.insertAfter(hr, Object.assign(document.createElement('p'), { innerHTML: '<br>' }));
      this.focusStart(next);
    } else if (type === 'image') {
      this.imageTarget = empty ? block : null;
      this.imageAfter = block;
      NT.$('#file-image').click();
      return;
    } else if (empty || !block) {
      if (block) this.setBlock(type); else this.insertAfter(null, this.makeBlock(type).el);
      return;
    } else {
      const { el, holder } = this.makeBlock(type);
      this.insertAfter(block, el);
      this.focusStart(holder);
    }
    this.changed(true);
  }

  async insertImage(file) {
    if (!file.type.startsWith('image/')) return;
    const src = await NT.Editor.shrinkImage(file);
    const fig = document.createElement('figure');
    fig.innerHTML = `<img src="${src}" alt=""><figcaption><br></figcaption>`;
    this.history.record();
    if (this.imageTarget && this.imageTarget.isConnected) this.imageTarget.replaceWith(fig);
    else this.insertAfter(this.imageAfter && this.imageAfter.isConnected ? this.imageAfter : this.currentBlock(), fig);
    this.imageTarget = this.imageAfter = null;
    if (!fig.nextElementSibling) this.insertAfter(fig, Object.assign(document.createElement('p'), { innerHTML: '<br>' }));
    this.focusStart(fig.querySelector('figcaption'));
    this.changed(true);
  }

  static shrinkImage(file, max = 1600) {
    return new Promise(resolve => {
      const reader = new FileReader();
      reader.onload = () => {
        const img = new Image();
        img.onload = () => {
          if (img.width <= max || file.type === 'image/gif' || file.type === 'image/svg+xml') return resolve(reader.result);
          const c = document.createElement('canvas');
          c.width = max; c.height = Math.round(img.height * max / img.width);
          c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
          resolve(c.toDataURL(file.type === 'image/png' ? 'image/png' : 'image/jpeg', 0.86));
        };
        img.onerror = () => resolve(reader.result);
        img.src = reader.result;
      };
      reader.readAsDataURL(file);
    });
  }

  moveBlock(dir) {
    const block = this.currentBlock();
    if (!block) return;
    const sib = dir < 0 ? block.previousElementSibling : block.nextElementSibling;
    if (!sib) return;
    this.history.record();
    const caret = NT.getCaretOffset(block) || 0;
    if (dir < 0) sib.before(block); else sib.after(block);
    this.el.focus();
    NT.setCaretOffset(block, caret);
    block.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    this.changed(true);
  }

  /* ─ 글자 서식 ─ */
  leafBlocks(range) {
    const sel = 'p, h1, h2, h3, li, figcaption, pre, blockquote, aside';
    return NT.$$(sel, this.el).filter(el => range.intersectsNode(el) && !el.querySelector(sel));
  }

  toggleWrap(tag, cls) {
    const sel = window.getSelection();
    if (!sel.rangeCount || sel.isCollapsed) return;
    const range = sel.getRangeAt(0);
    const selector = tag + (cls ? '.' + cls : '');
    const startEl = range.startContainer.nodeType === 1 ? range.startContainer : range.startContainer.parentElement;
    const enclosing = startEl.closest(selector);
    this.history.record();
    if (enclosing && this.el.contains(enclosing)) {
      enclosing.replaceWith(...enclosing.childNodes);
    } else {
      let any = false;
      const leaves = this.leafBlocks(range);
      for (const leaf of leaves.length ? leaves : [null]) {
        const r = range.cloneRange();
        if (leaf) {
          if (!leaf.contains(range.startContainer)) r.setStart(leaf, 0);
          if (!leaf.contains(range.endContainer)) r.setEnd(leaf, leaf.childNodes.length);
        }
        if (r.collapsed || !r.toString().trim()) continue;
        const frag = r.extractContents();
        const inside = frag.querySelectorAll(selector);
        // 선택한 글자가 모두 이미 같은 서식이면 해제, 일부만이면 전체에 입힌다
        const allWrapped = NT.textNodes(frag).filter(t => t.data.trim()).every(t => t.parentElement && t.parentElement.closest(selector));
        inside.forEach(n => n.replaceWith(...n.childNodes));
        if (inside.length && allWrapped) { r.insertNode(frag); any = true; continue; }
        const w = document.createElement(tag);
        if (cls) w.className = cls;
        w.appendChild(frag);
        r.insertNode(w);
        any = true;
        if (leaves.length <= 1) { const nr = document.createRange(); nr.selectNodeContents(w); sel.removeAllRanges(); sel.addRange(nr); }
      }
      if (!any) return;
    }
    this.changed(true);
  }

  inline(cmd) {
    if (!this.inEditor()) this.restoreSel();
    switch (cmd) {
      case 'bold': case 'italic': case 'underline': case 'strikeThrough':
        this.history.record(); document.execCommand(cmd); this.changed(true); break;
      case 'mark': this.toggleWrap('mark'); break;
      case 'accent': this.toggleWrap('span', 'accent'); break;
      case 'code': this.toggleWrap('code'); break;
      case 'link': this.link(); break;
      case 'clear': {
        const sel = window.getSelection();
        if (!sel.rangeCount) return;
        this.history.record();
        const range = sel.getRangeAt(0);
        document.execCommand('removeFormat');
        document.execCommand('unlink');
        NT.$$('mark, span.accent, code', this.el).filter(n => range.intersectsNode(n) && !n.closest('pre')).forEach(n => n.replaceWith(...n.childNodes));
        this.changed(true);
      }
    }
    this.onSelection();
  }

  async link() {
    const sel = window.getSelection();
    if (!sel.rangeCount) return;
    const a = (sel.anchorNode.nodeType === 1 ? sel.anchorNode : sel.anchorNode.parentElement).closest('a');
    this.saveSel();
    const url = await NT.ui.ask('링크', { value: a ? a.getAttribute('href') : 'https://', placeholder: 'https://', hint: '비워 두면 링크를 해제해요.', okLabel: '적용' });
    this.el.focus();
    this.restoreSel();
    if (url === null) return;
    this.history.record();
    if (!url.trim() || url.trim() === 'https://') {
      if (a) a.replaceWith(...a.childNodes); else document.execCommand('unlink');
    } else {
      const href = /^(https?:|mailto:|#)/i.test(url.trim()) ? url.trim() : 'https://' + url.trim();
      if (a) a.setAttribute('href', href);
      else if (sel.isCollapsed) document.execCommand('insertHTML', false, `<a href="${NT.escapeHtml(href)}">${NT.escapeHtml(href)}</a>`);
      else document.execCommand('createLink', false, href);
    }
    this.changed(true);
  }

  /* ─ 이벤트 ─ */
  onBeforeInput(e) {
    if (e.inputType === 'historyUndo') { e.preventDefault(); this.history.undo(); }
    if (e.inputType === 'historyRedo') { e.preventDefault(); this.history.redo(); }
  }

  onKeydown(e) {
    const mod = e.ctrlKey || e.metaKey;
    const k = e.key.toLowerCase();

    if (this.slash && !e.isComposing) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); this.moveSlash(e.key === 'ArrowDown' ? 1 : -1); return; }
      if (e.key === 'Enter' || e.key === 'Tab') {
        const it = this.slashItems[this.slashIndex];
        if (it) { e.preventDefault(); this.applySlash(it.id); return; }
      }
      if (e.key === 'Escape') { e.preventDefault(); this.closeSlash(); return; }
    }

    if (mod && k === 'z') { e.preventDefault(); e.shiftKey ? this.history.redo() : this.history.undo(); return; }
    if (mod && k === 'y') { e.preventDefault(); this.history.redo(); return; }
    if (mod && k === 'k') { e.preventDefault(); this.link(); return; }
    if (mod && e.shiftKey && k === 'h') { e.preventDefault(); this.inline('mark'); return; }
    if (mod && e.altKey && /^[0-3]$/.test(e.key)) { e.preventDefault(); this.setBlock(e.key === '0' ? 'p' : 'h' + e.key); return; }
    if (e.altKey && !mod && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) { e.preventDefault(); this.moveBlock(e.key === 'ArrowUp' ? -1 : 1); return; }

    const block = this.currentBlock();
    if (!block) return;

    if (e.key === 'Tab') {
      if (block.tagName === 'UL' || block.tagName === 'OL') { e.preventDefault(); this.history.record(); document.execCommand(e.shiftKey ? 'outdent' : 'indent'); this.changed(true); }
      else if (block.tagName === 'PRE') { e.preventDefault(); document.execCommand('insertText', false, '  '); }
      return;
    }

    if (e.key === 'Enter' && !e.isComposing && !mod) {
      // 마크다운식 --- / ``` 뒤 엔터
      if (block.tagName === 'P' && !e.shiftKey) {
        const t = block.textContent.trim();
        if (/^(-{3,}|\*{3,}|_{3,})$/.test(t)) {
          e.preventDefault(); this.history.record();
          const hr = document.createElement('hr'); block.replaceWith(hr);
          const p = this.insertAfter(hr, Object.assign(document.createElement('p'), { innerHTML: '<br>' }));
          this.focusStart(p); this.changed(true); return;
        }
        if (t === '```') {
          e.preventDefault(); this.history.record();
          const pre = document.createElement('pre'); pre.innerHTML = '<br>'; block.replaceWith(pre);
          this.focusStart(pre); this.changed(true); return;
        }
      }
      // 인용·강조 인용·콜아웃·코드: 엔터는 줄바꿈, 빈 줄에서 한 번 더 누르면 빠져나온다
      if (/^(BLOCKQUOTE|ASIDE|PRE)$/.test(block.tagName) && !block.querySelector('p')) {
        e.preventDefault();
        const atEnd = this.caretAtEnd(block);
        const endsWithBreak = /(<br>\s*)+(<\/code>)?$/.test(block.innerHTML) && block.innerHTML.replace(/<br>/g, '').trim() !== '';
        const empty = !block.textContent.trim();
        if (atEnd && (empty || endsWithBreak) && !e.shiftKey) {
          this.history.record();
          const host = block.querySelector('code') || block;
          while (host.lastChild && (host.lastChild.nodeName === 'BR' || (host.lastChild.nodeType === 3 && !host.lastChild.data.trim()))) host.lastChild.remove();
          const p = Object.assign(document.createElement('p'), { innerHTML: '<br>' });
          if (empty) block.replaceWith(p); else this.insertAfter(block, p);
          this.focusStart(p); this.changed(true); return;
        }
        document.execCommand('insertLineBreak');
        this.changed(true);
        return;
      }
    }

    if (e.key === 'Backspace' && !mod) {
      // 빈 제목·인용 맨 앞에서 지우면 먼저 본문으로 바꾼다 (노션과 같은 동작)
      const sel = window.getSelection();
      if (sel.isCollapsed && /^(H1|H2|H3|BLOCKQUOTE|ASIDE|PRE)$/.test(block.tagName) && this.textBeforeCaret(block) === '' ) {
        e.preventDefault(); this.setBlock('p'); return;
      }
    }
  }

  onInput(e) {
    const block = this.currentBlock();
    if (block && e.inputType === 'insertText' && e.data === ' ' && block.tagName === 'P') {
      const before = this.textBeforeCaret(block).replace(/\u00a0/g, ' ');
      const map = { '# ': 'h1', '## ': 'h2', '### ': 'h3', '> ': 'blockquote', '- ': 'ul', '* ': 'ul', '1. ': 'ol', '" ': 'pull', '! ': 'callout' };
      const type = map[before];
      if (type) {
        const first = NT.textNodes(block)[0];
        if (first) {
          first.data = first.data.slice(before.length);
          if (!block.textContent) block.innerHTML = '<br>';
          NT.placeCaret(block, 0);
          this.setBlock(type);
          return;
        }
      }
    }
    this.updateSlash();
    this.changed(true);
    this.typewriter();
  }

  onPaste(e) {
    const cd = e.clipboardData;
    if (!cd) return;
    e.preventDefault();
    const file = Array.from(cd.files || []).find(f => f.type.startsWith('image/'));
    if (file) { this.imageAfter = this.currentBlock(); this.insertImage(file); return; }
    const block = this.currentBlock();
    const html = cd.getData('text/html');
    const text = cd.getData('text/plain');
    this.history.record();
    if (block && block.tagName === 'PRE') { document.execCommand('insertText', false, text); this.changed(true); return; }
    let out;
    if (html) out = NT.sanitize(html);
    else if (/^(#{1,3} |> |[-*] |\d+\. |```)/m.test(text) || /\*\*[^*]+\*\*/.test(text)) out = NT.convert.fromMarkdown(text);
    else if (/\n/.test(text)) out = NT.convert.fromText(text);
    if (out == null) document.execCommand('insertText', false, text);
    else {
      // 한 문단짜리 조각이면 현재 문단 안에 그대로 끼워 넣는다
      const single = out.match(/^<p>([\s\S]*)<\/p>$/);
      document.execCommand('insertHTML', false, single && !single[1].includes('<p>') ? single[1] : out);
    }
    this.changed(true);
  }

  onDrop(e) {
    const file = Array.from(e.dataTransfer?.files || []).find(f => f.type.startsWith('image/'));
    if (!file) return;
    e.preventDefault(); e.stopPropagation();
    const pos = document.caretRangeFromPoint ? document.caretRangeFromPoint(e.clientX, e.clientY) : null;
    this.imageAfter = pos ? this.topBlock(pos.startContainer) : null;
    this.insertImage(file);
  }

  onSelection() {
    if (!this.inEditor() || !this.isEditable()) { this.hideBubble(); this.markCurrent(true); return; }
    this.markCurrent();
    const sel = window.getSelection();
    if (sel.isCollapsed || !sel.toString().trim()) { this.hideBubble(); return; }
    const block = this.currentBlock();
    const tag = block ? (block.matches('blockquote.pull') ? 'blockquote' : block.tagName.toLowerCase()) : 'p';
    const select = NT.$('#bubble-block');
    select.value = Array.from(select.options).some(o => o.value === tag) ? tag : 'p';
    this.bubble.hidden = false;
    this.positionBubble();
  }
  positionBubble() {
    if (this.bubble.hidden) return;
    const sel = window.getSelection();
    if (!sel.rangeCount) return;
    const rect = sel.getRangeAt(0).getBoundingClientRect();
    if (!rect.width && !rect.height) return;
    const bw = this.bubble.offsetWidth, bh = this.bubble.offsetHeight;
    let left = rect.left + rect.width / 2 - bw / 2;
    left = Math.max(8, Math.min(window.innerWidth - bw - 8, left));
    let top = rect.top - bh - 10;
    if (top < 56) top = rect.bottom + 10;
    this.bubble.style.left = left + 'px';
    this.bubble.style.top = top + 'px';
  }
  hideBubble() { this.bubble.hidden = true; }

  /* 포커스 모드용: 지금 쓰는 블록 표시 (저장되는 HTML에서는 빠진다) */
  markCurrent(clear) {
    const cur = clear ? null : this.currentBlock();
    for (const el of this.el.querySelectorAll(':scope > .is-current')) if (el !== cur) { el.classList.remove('is-current'); if (!el.className) el.removeAttribute('class'); }
    if (cur && !cur.classList.contains('is-current')) cur.classList.add('is-current');
  }
  stripCurrent() {
    for (const el of this.el.querySelectorAll(':scope > .is-current')) { el.classList.remove('is-current'); if (!el.className) el.removeAttribute('class'); }
  }
  typewriter() {
    if (!document.body.classList.contains('focus-mode')) return;
    const sel = window.getSelection();
    if (!sel.rangeCount) return;
    const rect = sel.getRangeAt(0).getClientRects()[0];
    if (!rect) return;
    const ws = NT.$('#workspace');
    const wsRect = ws.getBoundingClientRect();
    const delta = rect.top - (wsRect.top + wsRect.height * 0.45);
    if (Math.abs(delta) > 40) ws.scrollBy({ top: delta, behavior: 'smooth' });
  }

  /* ─ 슬래시 메뉴 ─ */
  updateSlash() {
    const sel = window.getSelection();
    if (!sel.rangeCount || !sel.isCollapsed) return this.closeSlash();
    const node = sel.anchorNode;
    if (node.nodeType !== 3 || node.parentElement.closest('pre, code')) return this.closeSlash();
    const before = node.data.slice(0, sel.anchorOffset);
    const m = before.match(/(?:^|[\s\u00a0])\/([^\s\u00a0/]{0,12})$/);
    if (!m) return this.closeSlash();
    const q = m[1].toLowerCase();
    const items = NT.BLOCKS.filter(b => !q || b.keys.includes(q) || b.label.includes(q));
    if (!items.length) return this.closeSlash();
    this.slash = { node, start: sel.anchorOffset - m[1].length - 1, end: sel.anchorOffset };
    this.slashItems = items;
    this.slashIndex = 0;
    this.renderSlash();
    const rect = sel.getRangeAt(0).getBoundingClientRect();
    const r = rect.height ? rect : node.parentElement.getBoundingClientRect();
    const h = this.slashEl.offsetHeight;
    const below = r.bottom + 6 + h < window.innerHeight;
    this.slashEl.style.left = Math.min(window.innerWidth - 270, r.left) + 'px';
    this.slashEl.style.top = (below ? r.bottom + 6 : r.top - h - 6) + 'px';
  }
  renderSlash() {
    this.slashEl.hidden = false;
    this.slashEl.innerHTML = '<div class="slash-head">블록 넣기</div>' + this.slashItems.map((b, i) =>
      `<div class="slash-item${i === this.slashIndex ? ' active' : ''}" data-block="${b.id}" role="option"><span class="slash-icon">${b.icon}</span>${b.label}</div>`).join('');
  }
  moveSlash(d) {
    this.slashIndex = (this.slashIndex + d + this.slashItems.length) % this.slashItems.length;
    this.renderSlash();
    NT.$('.slash-item.active', this.slashEl)?.scrollIntoView({ block: 'nearest' });
  }
  closeSlash() { this.slash = null; this.slashEl.hidden = true; }
  applySlash(id) {
    const s = this.slash;
    this.closeSlash();
    if (s && s.node.isConnected) {
      s.node.deleteData(s.start, Math.min(s.end, s.node.length) - s.start);
      NT.placeCaret(s.node, s.start);
      const block = this.topBlock(s.node);
      if (block && !block.textContent && !block.querySelector('br, img')) block.innerHTML = '<br>';
      if (block && !block.textContent) NT.placeCaret(block, 0);
    }
    const block = this.currentBlock();
    const empty = block && !block.textContent.trim();
    if (id === 'hr' || id === 'image' || !empty) this.insertBlock(id);
    else this.setBlock(id);
  }
};
