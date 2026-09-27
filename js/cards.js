/* 카드뉴스: 구분선(hr)마다 글을 잘라 정사각/세로 카드로 조판하고 PNG로 내보낸다. */
NT.cards = (() => {
  const W = 360; // 화면 표시 폭. 내보낼 때 1080px이 되도록 3배로 그린다.
  const RATIOS = { '1:1': 1, '4:5': 1.25, '9:16': 16 / 9 };
  // 배경을 바꾸면 글자색 등도 함께 바꿔야 해서, 테마가 인라인으로 건 변수를 덮어쓴다
  const onColor = { '--nt-fg': '#ffffff', '--nt-muted': 'rgba(255,255,255,0.75)', '--nt-quote-bg': 'rgba(255,255,255,0.15)',
    '--nt-mark': 'rgba(255,255,255,0.3)', '--nt-code-bg': 'rgba(0,0,0,0.15)', '--nt-rule': 'rgba(255,255,255,0.3)' };
  const BG_VARS = {
    accent: onColor,
    gradient: onColor,
    paper: { '--nt-bg': '#f4ecd8', '--nt-fg': '#3a2f23', '--nt-muted': '#7a6a55', '--nt-quote-bg': '#ebe0c6', '--nt-code-bg': '#ebe0c6', '--nt-rule': '#d9ccb0' }
  };

  function split(editorEl) {
    const groups = [[]];
    for (const el of editorEl.children) {
      if (el.tagName === 'HR') { groups.push([]); continue; }
      if (el.tagName === 'P' && !el.textContent.trim() && !el.querySelector('img')) continue;
      groups[groups.length - 1].push(el);
    }
    return groups.filter(g => g.length);
  }

  function render(editorEl, design, opts, title) {
    const wrap = NT.$('#cards');
    wrap.innerHTML = '';
    const groups = split(editorEl);
    if (!groups.length) {
      wrap.innerHTML = '<p class="cards-empty">본문이 비어 있어요. 글을 쓰고 구분선(<code>---</code> 또는 <code>/구분선</code>)으로 카드를 나눠 보세요.</p>';
      return;
    }
    const H = Math.round(W * RATIOS[opts.ratio]);
    groups.forEach((blocks, i) => {
      const frame = document.createElement('div');
      frame.className = 'card-frame';
      const card = document.createElement('div');
      NT.design.applyTo(card, design);
      card.classList.add('card', 'bg-' + opts.bg, 'valign-' + opts.align);
      for (const [k, v] of Object.entries(BG_VARS[opts.bg] || {})) card.style.setProperty(k, v);
      card.style.width = W + 'px'; card.style.height = H + 'px';
      const isCover = i === 0 && blocks.length <= 3 && /^H[12]$/.test(blocks[0].tagName);
      if (isCover) card.classList.add('cover');
      const doc = document.createElement('div');
      doc.className = 'nt-doc card-doc';
      blocks.forEach(b => {
        const c = NT.convert.cleanClone(b);
        c.removeAttribute('class');
        if (b.classList.contains('pull')) c.className = 'pull';
        if (b.classList.contains('callout')) c.className = 'callout';
        doc.appendChild(c);
      });
      card.appendChild(doc);
      if (opts.num) {
        const foot = document.createElement('div');
        foot.className = 'card-foot';
        foot.innerHTML = `<span>${NT.escapeHtml(title || '')}</span><span>${i + 1} / ${groups.length}</span>`;
        card.appendChild(foot);
      }
      frame.appendChild(card);
      const save = document.createElement('button');
      save.className = 'btn small ghost card-save';
      save.textContent = `${i + 1}번 카드 PNG`;
      save.addEventListener('click', () => exportCard(card, i + 1, title));
      frame.appendChild(save);
      wrap.appendChild(frame);
      fit(card, doc, isCover);
    });
    // 웹폰트가 늦게 도착하면 글자 폭이 바뀌므로 한 번 더 맞춘다
    if (document.fonts && document.fonts.status !== 'loaded') {
      const token = (render.token = (render.token || 0) + 1);
      document.fonts.ready.then(() => {
        if (token !== render.token) return;
        NT.$$('#cards .card').forEach(c => fit(c, NT.$('.card-doc', c), c.classList.contains('cover')));
      });
    }
  }

  /* 글이 카드를 넘치면 글자 크기를 줄이고, 짧으면 키운다 */
  function fit(card, doc, isCover) {
    const avail = () => card.clientHeight - (parseFloat(getComputedStyle(card).paddingTop) + parseFloat(getComputedStyle(card).paddingBottom)) - 18;
    let lo = 9, hi = isCover ? 30 : 22, best = lo;
    for (let k = 0; k < 10; k++) {
      const mid = (lo + hi) / 2;
      doc.style.fontSize = mid + 'px';
      if (doc.scrollHeight <= avail()) { best = mid; lo = mid; } else hi = mid;
    }
    doc.style.fontSize = best.toFixed(2) + 'px';
    card.parentElement.classList.toggle('crowded', best < 11.5 || doc.scrollHeight > avail() + 1);
  }

  async function exportCard(card, n, title) {
    if (!window.htmlToImage) { NT.toast('이미지 변환 모듈을 불러오지 못했어요.'); return; }
    try {
      await document.fonts.ready;
      const opt = { pixelRatio: 1080 / W, cacheBust: true, backgroundColor: getComputedStyle(card).backgroundColor };
      let url;
      try { url = await htmlToImage.toPng(card, opt); }
      catch { url = await htmlToImage.toPng(card, { ...opt, skipFonts: true }); } // 웹폰트를 못 가져오면 시스템 글꼴로라도
      const a = document.createElement('a');
      a.href = url; a.download = `${NT.safeFilename(title)}-${String(n).padStart(2, '0')}.png`;
      document.body.appendChild(a); a.click(); a.remove();
    } catch (e) {
      console.error(e);
      NT.toast('PNG로 저장하지 못했어요: ' + (e.message || e));
    }
  }

  async function exportAll(title) {
    const cards = NT.$$('#cards .card');
    if (!cards.length) return;
    NT.toast(`카드 ${cards.length}장을 저장하는 중…`, 4000);
    for (let i = 0; i < cards.length; i++) {
      await exportCard(cards[i], i + 1, title);
      await new Promise(r => setTimeout(r, 350)); // 연속 다운로드 차단을 피하려고 잠깐 쉰다
    }
  }

  return { render, exportAll };
})();
