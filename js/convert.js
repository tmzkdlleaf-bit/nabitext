/* 형식 변환: Markdown ↔ HTML, 텍스트, 단독 HTML 파일, 서식 포함 복사 */
NT.convert = (() => {
  /* ─ HTML → Markdown ─ */
  function inlineMd(node) {
    let out = '';
    for (const n of node.childNodes) {
      if (n.nodeType === 3) { out += n.data.replace(/\u00a0/g, ' '); continue; }
      if (n.nodeType !== 1) continue;
      const inner = inlineMd(n);
      switch (n.tagName) {
        case 'B': case 'STRONG': out += wrap(inner, '**'); break;
        case 'I': case 'EM': out += wrap(inner, '*'); break;
        case 'S': case 'DEL': case 'STRIKE': out += wrap(inner, '~~'); break;
        case 'MARK': out += wrap(inner, '=='); break;
        case 'CODE': out += '`' + n.textContent + '`'; break;
        case 'A': out += `[${inner}](${n.getAttribute('href') || ''})`; break;
        case 'BR': out += '  \n'; break;
        case 'IMG': out += `![${n.alt || ''}](${n.getAttribute('src')})`; break;
        default: out += inner;
      }
    }
    return out;
  }
  const wrap = (s, m) => {
    const t = s.trim();
    if (!t) return s;
    const lead = s.slice(0, s.indexOf(t[0])), tail = s.slice(s.lastIndexOf(t[t.length - 1]) + 1);
    return lead + m + t + m + tail;
  };

  function toMarkdown(root) {
    const parts = [];
    for (const el of root.children) {
      const t = el.tagName;
      if (t === 'H1' || t === 'H2' || t === 'H3') parts.push('#'.repeat(+t[1]) + ' ' + inlineMd(el).trim());
      else if (t === 'P') { const s = inlineMd(el).trim(); if (s) parts.push(s); }
      else if (t === 'BLOCKQUOTE' || t === 'ASIDE') {
        const inner = el.querySelector('p') ? Array.from(el.children).map(c => inlineMd(c).trim()).join('\n\n') : inlineMd(el).trim();
        const prefix = t === 'ASIDE' ? `${el.dataset.icon || '💡'} ` : '';
        parts.push((prefix + inner).split('\n').map(l => '> ' + l).join('\n'));
      }
      else if (t === 'UL' || t === 'OL') parts.push(Array.from(el.children).map((li, i) => (t === 'OL' ? `${i + 1}. ` : '- ') + inlineMd(li).trim()).join('\n'));
      else if (t === 'PRE') parts.push('```\n' + el.textContent.replace(/\n$/, '') + '\n```');
      else if (t === 'HR') parts.push('---');
      else if (t === 'FIGURE') {
        const img = el.querySelector('img'), cap = el.querySelector('figcaption');
        if (img) parts.push(`![${cap ? cap.textContent.trim() : img.alt || ''}](${img.getAttribute('src')})`);
      }
      else { const s = inlineMd(el).trim(); if (s) parts.push(s); }
    }
    return parts.join('\n\n') + '\n';
  }

  /* ─ Markdown → HTML ─ */
  function mdInline(s) {
    s = NT.escapeHtml(s);
    const codes = [];
    s = s.replace(/`([^`]+)`/g, (_, c) => { codes.push(c); return `\u0000${codes.length - 1}\u0000`; });
    s = s
      .replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, (_, alt, src) => /^(https?:|data:image\/)/i.test(src) ? `<img src="${src}" alt="${alt}">` : alt)
      .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, text, href) => /^(https?:|mailto:|#)/i.test(href) ? `<a href="${href}">${text}</a>` : text)
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/__([^_]+)__/g, '<strong>$1</strong>')
      .replace(/(^|[^*])\*([^*\s][^*]*)\*/g, '$1<em>$2</em>')
      .replace(/(^|[^\w])_([^_\s][^_]*)_(?!\w)/g, '$1<em>$2</em>')
      .replace(/~~([^~]+)~~/g, '<s>$1</s>')
      .replace(/==([^=]+)==/g, '<mark>$1</mark>')
      .replace(/ {2}$/g, '<br>');
    return s.replace(/\u0000(\d+)\u0000/g, (_, i) => `<code>${codes[i]}</code>`);
  }

  function fromMarkdown(md) {
    const lines = md.replace(/\r\n?/g, '\n').split('\n');
    const out = [];
    let para = [], list = null, quote = [];
    const flushPara = () => { if (para.length) { out.push('<p>' + para.map(mdInline).join('<br>') + '</p>'); para = []; } };
    const flushList = () => { if (list) { out.push(`<${list.type}>` + list.items.map(i => `<li>${mdInline(i)}</li>`).join('') + `</${list.type}>`); list = null; } };
    const flushQuote = () => {
      if (!quote.length) return;
      const inner = quote.join('\n').split(/\n{2,}/).map(p => '<p>' + p.split('\n').map(mdInline).join('<br>') + '</p>').join('');
      out.push('<blockquote>' + inner + '</blockquote>'); quote = [];
    };
    const flushAll = () => { flushPara(); flushList(); flushQuote(); };

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      let m;
      if (/^```/.test(line)) {
        flushAll();
        const code = [];
        while (++i < lines.length && !/^```/.test(lines[i])) code.push(lines[i]);
        out.push('<pre><code>' + NT.escapeHtml(code.join('\n')) + '</code></pre>');
      } else if ((m = line.match(/^(#{1,6})\s+(.*)$/))) {
        flushAll(); const lv = Math.min(3, m[1].length); out.push(`<h${lv}>${mdInline(m[2])}</h${lv}>`);
      } else if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) {
        flushAll(); out.push('<hr>');
      } else if ((m = line.match(/^>\s?(.*)$/))) {
        flushPara(); flushList(); quote.push(m[1]);
      } else if ((m = line.match(/^\s*[-*+]\s+(.*)$/))) {
        flushPara(); flushQuote();
        if (!list || list.type !== 'ul') { flushList(); list = { type: 'ul', items: [] }; }
        list.items.push(m[1]);
      } else if ((m = line.match(/^\s*\d+[.)]\s+(.*)$/))) {
        flushPara(); flushQuote();
        if (!list || list.type !== 'ol') { flushList(); list = { type: 'ol', items: [] }; }
        list.items.push(m[1]);
      } else if (!line.trim()) {
        flushPara(); flushList();
        if (quote.length && lines[i + 1] && /^>/.test(lines[i + 1])) quote.push(''); else flushQuote();
      } else {
        flushList(); flushQuote();
        const img = line.trim().match(/^!\[([^\]]*)\]\(([^)\s]+)\)$/);
        if (img) { flushPara(); out.push(`<figure>${mdInline(line.trim())}${img[1] ? `<figcaption>${NT.escapeHtml(img[1])}</figcaption>` : ''}</figure>`); }
        else para.push(line);
      }
    }
    flushAll();
    return out.join('') || '<p><br></p>';
  }

  function fromText(txt) {
    const paras = txt.replace(/\r\n?/g, '\n').split(/\n{2,}/);
    // 빈 줄 없이 한 줄씩 쓴 글이면 줄마다 문단으로
    const chunks = paras.length === 1 ? paras[0].split('\n') : paras;
    return chunks.map(p => p.trim() ? '<p>' + p.split('\n').map(NT.escapeHtml).join('<br>') + '</p>' : '').join('') || '<p><br></p>';
  }

  function toText(root) {
    return Array.from(root.children).map(el => {
      if (el.tagName === 'HR') return '* * *';
      if (el.tagName === 'UL' || el.tagName === 'OL') return Array.from(el.children).map((li, i) => (el.tagName === 'OL' ? `${i + 1}. ` : '• ') + li.innerText.trim()).join('\n');
      return el.innerText.replace(/\n+$/, '');
    }).filter(s => s.trim()).join('\n\n') + '\n';
  }

  /* 편집용 속성을 걷어낸 사본 */
  function cleanClone(pageEl) {
    const page = pageEl.cloneNode(true);
    page.removeAttribute('id');
    NT.$$('[contenteditable]', page).forEach(el => el.removeAttribute('contenteditable'));
    NT.$$('[id]', page).forEach(el => el.removeAttribute('id'));
    NT.$$('[spellcheck],[data-placeholder],[aria-label]', page).forEach(el => {
      el.removeAttribute('spellcheck'); el.removeAttribute('data-placeholder'); el.removeAttribute('aria-label');
    });
    page.classList.remove('page', 'focus-mode', 'is-empty', 'lint-on');
    NT.$$('.is-current, .lint-on, .is-empty', page).forEach(el => el.classList.remove('is-current', 'lint-on', 'is-empty'));
    NT.$('.editor', page)?.classList.remove('editor');
    return page;
  }

  function toHtmlFile(title, pageEl) {
    const page = cleanClone(pageEl);
    const bg = getComputedStyle(pageEl).getPropertyValue('--nt-bg').trim() || '#fff';
    return `<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${NT.escapeHtml(title || '나비텍스트')}</title>
${NT.FONT_LINKS.map(h => `<link rel="stylesheet" href="${h}">`).join('\n')}
<style>
html, body { margin: 0; background: ${bg}; }
.nt-page { min-height: 100vh; padding: 64px 20px 96px; box-sizing: border-box; }
${NT.DOC_CSS}
</style>
</head>
<body>
${page.outerHTML}
</body>
</html>
`;
  }

  /* 서식 포함 복사: 계산된 스타일을 인라인으로 박아 블로그·메일 편집기에서도 모양이 유지되게 한다. */
  const PROPS = ['font-family', 'font-size', 'font-weight', 'font-style', 'line-height', 'letter-spacing', 'color', 'background-color',
    'text-align', 'text-indent', 'text-decoration-line', 'margin-top', 'margin-bottom', 'margin-left', 'margin-right',
    'padding-top', 'padding-bottom', 'padding-left', 'padding-right', 'border-left', 'border-top', 'border-bottom',
    'border-radius', 'word-break'];

  function inlineStyled(pageEl) {
    const src = NT.$('.nt-doc', pageEl);
    const clone = src.cloneNode(true);
    const a = [src, ...src.querySelectorAll('*')], b = [clone, ...clone.querySelectorAll('*')];
    a.forEach((el, i) => {
      const cs = getComputedStyle(el);
      const style = PROPS.map(p => {
        const v = cs.getPropertyValue(p);
        if (!v || v === 'none' || v === 'normal' && p !== 'font-style' || /^0px none/.test(v) || v === 'rgba(0, 0, 0, 0)') return '';
        return `${p}:${v}`;
      }).filter(Boolean).join(';');
      b[i].setAttribute('style', style);
      b[i].removeAttribute('class'); b[i].removeAttribute('contenteditable'); b[i].removeAttribute('id');
      b[i].removeAttribute('spellcheck'); b[i].removeAttribute('data-placeholder'); b[i].removeAttribute('aria-label');
    });
    // 구분선의 ::after 장식은 복사되지 않으므로 글자로 바꿔 둔다
    NT.$$('hr', clone).forEach(hr => {
      const p = document.createElement('p');
      p.setAttribute('style', `text-align:center;color:${getComputedStyle(pageEl).getPropertyValue('--nt-muted')};letter-spacing:0.4em;margin:2em 0`);
      p.textContent = '·  ·  ·';
      hr.replaceWith(p);
    });
    const bg = getComputedStyle(pageEl).backgroundColor;
    return `<div style="background:${bg};padding:24px">${clone.outerHTML}</div>`;
  }

  return { toMarkdown, fromMarkdown, fromText, toText, toHtmlFile, inlineStyled, cleanClone };
})();
