/* 글 다듬기 규칙. 텍스트 노드 단위로 적용해 굵게·링크 같은 서식을 보존한다. */
NT.TIDY_RULES = [
  { id: 'spaces', name: '연속 공백을 하나로', example: '글이  너무   띄어져  →  글이 너무 띄어져',
    fn: s => s.replace(/[ \u00a0]{2,}/g, ' ') },
  { id: 'fullwidth-space', name: '전각 공백(\u3000)을 일반 공백으로', example: '가\u3000나 → 가 나',
    fn: s => s.replace(/\u3000/g, ' ') },
  { id: 'punct-before', name: '문장부호 앞 공백 없애기', example: '좋다 . 정말 ? → 좋다. 정말?',
    fn: s => s.replace(/([^\s])[ ]+([.,!?;:…)\]’”])/g, '$1$2') },
  { id: 'punct-after', name: '문장부호 뒤에 띄어쓰기', example: '좋다.그리고,또 → 좋다. 그리고, 또',
    fn: s => s.replace(/([가-힣][.!?,])(?=[가-힣A-Za-z“‘"'(])/g, '$1 ') },
  { id: 'ellipsis', name: '말줄임표 통일 (… )', example: '그런데... / 그런데。。。 → 그런데…',
    fn: s => s.replace(/\.{3,}|。{2,}|·{3,}|…{2,}/g, '…') },
  { id: 'quotes', name: '곧은 따옴표를 둥근 따옴표로', example: '"안녕" \'음\' → “안녕” ‘음’',
    fn: s => s
      .replace(/(^|[\s(\[{<—–-])"/g, '$1“').replace(/"/g, '”')
      .replace(/([A-Za-z0-9가-힣])'([A-Za-z])/g, '$1’$2')
      .replace(/(^|[\s(\[{<—–-])'/g, '$1‘').replace(/'/g, '’') },
  { id: 'repeat-punct', name: '반복 문장부호 줄이기', example: '진짜!!!! 왜??? → 진짜! 왜?',
    fn: s => s.replace(/!{2,}/g, '!').replace(/\?{2,}/g, '?').replace(/([?!])[?!]{2,}/g, '$1').replace(/,{2,}/g, ',').replace(/~{2,}/g, '~') },
  { id: 'paren-space', name: '괄호 안쪽 공백 없애기', example: '( 참고 ) → (참고)',
    fn: s => s.replace(/([(\[「『“‘])[ ]+/g, '$1').replace(/[ ]+([)\]」』”’])/g, '$1') },
  { id: 'trim', name: '문단 앞뒤 공백 없애기', example: '  문단  → 문단', block: true },
  { id: 'empty', name: '연달아 있는 빈 문단 없애기', example: '빈 줄 여러 개 → 없앰', block: true }
];

NT.tidy = {
  /* 적용 결과를 계산한다. dryRun이면 개수만 센다. */
  run(root, ruleIds, dryRun) {
    const rules = NT.TIDY_RULES.filter(r => ruleIds.includes(r.id));
    const counts = Object.fromEntries(rules.map(r => [r.id, 0]));
    const textRules = rules.filter(r => r.fn);

    for (const node of NT.textNodes(root)) {
      if (node.parentElement.closest('pre, code')) continue;
      let s = node.data;
      for (const r of textRules) {
        const next = r.fn(s);
        if (next !== s) { counts[r.id] += NT.tidy.diffCount(s, next); s = next; }
      }
      if (!dryRun && s !== node.data) node.data = s;
    }

    if (ruleIds.includes('trim')) {
      for (const block of NT.$$(':scope > p, :scope > h1, :scope > h2, :scope > h3, li', root)) {
        const nodes = NT.textNodes(block);
        if (!nodes.length) continue;
        const first = nodes[0], last = nodes[nodes.length - 1];
        const lead = first.data.match(/^[ \u00a0\u3000]+/), tail = last.data.match(/[ \u00a0\u3000]+$/);
        if (lead && first.data.length > lead[0].length) { counts.trim++; if (!dryRun) first.data = first.data.slice(lead[0].length); }
        if (tail && last.data.trim()) { counts.trim++; if (!dryRun) last.data = last.data.slice(0, -tail[0].length); }
      }
    }

    if (ruleIds.includes('empty')) {
      const isEmpty = el => el.tagName === 'P' && !el.textContent.trim() && !el.querySelector('img');
      const kids = Array.from(root.children);
      kids.forEach((el, i) => {
        if (isEmpty(el) && (i === 0 || isEmpty(kids[i - 1])) && kids.length > 1) {
          counts.empty++;
          if (!dryRun) el.remove();
        }
      });
      if (!dryRun && !root.children.length) root.innerHTML = '<p><br></p>';
    }
    return counts;
  },
  /* 대략적인 변경 개수: 달라진 구간 수 */
  diffCount(a, b) {
    let n = 0, i = 0, j = 0;
    while (i < a.length || j < b.length) {
      if (a[i] === b[j]) { i++; j++; continue; }
      n++;
      // 다시 맞아떨어지는 지점까지 건너뛴다
      let found = false;
      for (let k = 0; k < 4 && !found; k++) for (let l = 0; l < 4; l++) {
        if (a[i + k] !== undefined && a[i + k] === b[j + l] && a.slice(i + k, i + k + 2) === b.slice(j + l, j + l + 2)) {
          i += k; j += l; found = true; break;
        }
      }
      if (!found) { i++; j++; }
    }
    return n;
  }
};

/* 붙여넣기 정리: 허용한 태그만 남기고 스타일·클래스를 모두 걷어낸다. */
NT.sanitize = (() => {
  const BLOCK = new Set(['P', 'H1', 'H2', 'H3', 'BLOCKQUOTE', 'UL', 'OL', 'LI', 'PRE', 'HR', 'FIGURE', 'FIGCAPTION', 'IMG', 'ASIDE']);
  const INLINE = new Set(['B', 'STRONG', 'I', 'EM', 'U', 'S', 'DEL', 'A', 'BR', 'CODE', 'MARK', 'SPAN']);
  const RENAME = { H4: 'H3', H5: 'H3', H6: 'H3', DIV: 'P', SECTION: 'P', ARTICLE: 'P', HEADER: 'P', FOOTER: 'P', STRIKE: 'S', TD: 'SPAN', TH: 'SPAN' };
  const DROP = new Set(['SCRIPT', 'STYLE', 'META', 'LINK', 'TITLE', 'NOSCRIPT', 'IFRAME', 'OBJECT', 'SVG', 'BUTTON', 'INPUT', 'TEXTAREA', 'SELECT', 'HEAD']);

  function clean(node, doc) {
    const frag = doc.createDocumentFragment();
    for (const child of Array.from(node.childNodes)) {
      if (child.nodeType === 3) { frag.appendChild(doc.createTextNode(child.data)); continue; }
      if (child.nodeType !== 1) continue;
      let tag = child.tagName;
      if (DROP.has(tag)) continue;
      tag = RENAME[tag] || tag;
      const inner = clean(child, doc);
      if (!BLOCK.has(tag) && !INLINE.has(tag)) { frag.appendChild(inner); continue; }
      const el = doc.createElement(tag);
      if (tag === 'A') {
        const href = child.getAttribute('href') || '';
        if (!/^(https?:|mailto:|#)/i.test(href)) { frag.appendChild(inner); continue; }
        el.setAttribute('href', href);
      }
      if (tag === 'IMG') {
        const src = child.getAttribute('src') || '';
        if (!/^(https?:|data:image\/)/i.test(src)) continue;
        el.setAttribute('src', src);
        if (child.alt) el.setAttribute('alt', child.alt);
        frag.appendChild(el); continue;
      }
      if (tag === 'BLOCKQUOTE' && child.classList.contains('pull')) el.className = 'pull';
      if (tag === 'ASIDE' && child.classList.contains('callout')) { el.className = 'callout'; el.dataset.icon = child.dataset.icon || '💡'; }
      if (tag === 'SPAN' && child.classList.contains('accent')) el.className = 'accent';
      el.appendChild(inner);
      if (tag === 'SPAN' && !el.className) { frag.appendChild(styleToTags(child, unwrap(el))); continue; }
      // 구글 문서 등은 굵게를 <b style="font-weight:normal">로 감싼다
      if (tag === 'B' && /font-weight:\s*(normal|400)/.test(child.getAttribute('style') || '')) { frag.appendChild(unwrap(el)); continue; }
      frag.appendChild(el);
    }
    return frag;
  }
  /* 워드·구글 문서는 굵게/기울임을 style 속성으로만 표시하므로 의미 있는 태그로 바꿔 살린다 */
  function styleToTags(src, content) {
    const st = src.getAttribute('style') || '';
    let out = content;
    const wrapIn = tag => { const w = document.createElement(tag); w.appendChild(out); out = w; };
    if (/font-weight:\s*(bold|[6-9]00)/i.test(st)) wrapIn('strong');
    if (/font-style:\s*italic/i.test(st)) wrapIn('em');
    if (/text-decoration[^;]*underline/i.test(st)) wrapIn('u');
    if (/text-decoration[^;]*line-through/i.test(st)) wrapIn('s');
    return out;
  }
  function unwrap(el) {
    const f = document.createDocumentFragment();
    while (el.firstChild) f.appendChild(el.firstChild);
    return f;
  }
  return html => {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const wrap = document.createElement('div');
    wrap.appendChild(clean(doc.body, document));
    // 블록 밖에 떠 있는 인라인 조각을 <p>로 감싼다
    const out = document.createElement('div');
    let p = null;
    for (const n of Array.from(wrap.childNodes)) {
      const isBlock = n.nodeType === 1 && BLOCK.has(n.tagName);
      if (isBlock) { p = null; out.appendChild(n); continue; }
      if (n.nodeType === 3 && !n.data.trim() && !p) continue;
      if (!p) { p = document.createElement('p'); out.appendChild(p); }
      p.appendChild(n);
    }
    // 블록 안에 블록이 중첩된 <p> 정리 (div→p 변환 결과)
    NT.$$('p', out).forEach(el => {
      if (el.querySelector('p, h1, h2, h3, ul, ol, blockquote, pre, figure, aside')) el.replaceWith(...el.childNodes);
    });
    NT.$$('p', out).forEach(el => { if (!el.textContent.trim() && !el.querySelector('img, br')) el.remove(); });
    return out.innerHTML;
  };
})();
