/* 글 분석: 통계, 긴 문장, 군더더기·번역투 표현, 반복 낱말.
 * 본문 표시는 CSS Custom Highlight API로 해서 DOM을 전혀 바꾸지 않는다. */
NT.PHRASES = [
  { re: /에\s?(대해|대하여|대한)(서)?/g, label: '~에 대해/대한', tip: '목적어로 바로 쓰면 짧아져요. “문제에 대해 논의했다” → “문제를 논의했다”' },
  { re: /에\s?있어(서)?/g, label: '~에 있어서', tip: '번역투예요. “~에서”, “~할 때”로 바꿔 보세요.' },
  { re: /(을|를)\s?통해(서)?/g, label: '~를 통해', tip: '“~로”, “~해서”가 더 자연스러울 때가 많아요.' },
  { re: /(으)?로\s?인(해|한)/g, label: '~로 인해', tip: '“~때문에”, “~로”로 줄일 수 있어요.' },
  { re: /에\s?의(해|한)/g, label: '~에 의해', tip: '피동 표현이에요. 주어를 살려 능동문으로 써 보세요.' },
  { re: /되어지|되어진|되어져|(보|쓰|만들|주)여지|지게\s?되/g, label: '이중 피동', tip: '“되어지다” → “되다”, “만들어지게 되다” → “만들어지다”' },
  { re: /(가지고|갖고)\s?있/g, label: '~를 가지고 있다', tip: '영어 have의 직역이에요. “~가 있다”로 충분해요.' },
  { re: /(할|될|볼|갈|있을)\s?수\s?있/g, label: '~할 수 있다', tip: '반복되면 글이 흐려져요. 단정할 수 있으면 단정하세요.' },
  { re: /(하는|있는|되는|한|된)\s?것(이다|입니다|이었다|이며|은|이)/g, label: '~하는 것이다', tip: '“것”을 빼고 서술어로 끝내면 힘이 생겨요.' },
  { re: /[가-힣]+적(인|으로)\s/g, label: '~적인/~적으로', tip: '“-적”은 대부분 빼도 뜻이 통해요.' },
  { re: /(매우|정말|너무|아주|굉장히|엄청|진짜)\s/g, label: '꾸밈말 남용', tip: '강조 부사는 자주 쓸수록 약해져요.' },
  { re: /하도록\s?하(겠|였|자)/g, label: '~하도록 하겠습니다', tip: '“~하겠습니다”로 줄이세요.' },
  { re: /(라고|이라고)\s?(할|말할)\s?수\s?있/g, label: '~라고 할 수 있다', tip: '말끝을 흐리는 표현이에요. 그냥 “~다”라고 쓰세요.' }
];

NT.STOPWORDS = new Set(['그리고', '하지만', '그래서', '그러나', '그런데', '또한', '있다', '있는', '없다', '없는', '하는', '했다', '한다', '합니다', '입니다', '있습니다', '것이', '것은', '것을', '이런', '그런', '저런', '이것', '그것', '우리', '때문', '때문에', '통해', '대해', '위해', '정말', '너무', '아주', '매우', '있어요', '있게', '있고', '있을', '합니다', '해요', '하고', '하면', '하게', '같은', '없이', '되는', '된다', '이다', 'the', 'and', 'for', 'that', 'with', 'this']);

NT.analyze = (() => {
  const hasHighlight = typeof CSS !== 'undefined' && CSS.highlights && typeof Highlight !== 'undefined';
  let last = null;

  function blocks(root) {
    return NT.$$('p, li, h1, h2, h3, figcaption, blockquote, aside', root).filter(el => {
      if (el.closest('pre')) return false;
      if ((el.tagName === 'BLOCKQUOTE' || el.tagName === 'ASIDE') && el.querySelector('p, li')) return false;
      if (el.tagName === 'LI' && el.querySelector('p')) return false;
      return el.textContent.trim().length > 0;
    });
  }

  function sentences(text) {
    const out = [];
    const re = /[^.!?…。\n]+(?:[.!?…。]+["”’')\]]*|(?=\n)|$)/g;
    let m;
    while ((m = re.exec(text))) {
      const raw = m[0];
      const lead = raw.length - raw.trimStart().length;
      const t = raw.trim();
      if (t.length) out.push({ start: m.index + lead, end: m.index + lead + t.length, text: t });
      if (m[0].length === 0) re.lastIndex++;
    }
    return out;
  }

  function stripParticle(w) {
    return w.replace(/(에서는|으로는|에게서|이라는|이라고|에서|에게|으로|부터|까지|처럼|보다|이나|이다|라는|하고|은|는|이|가|을|를|의|에|로|와|과|도|만)$/, '');
  }

  function run(root) {
    const bl = blocks(root);
    const all = bl.map(b => b.textContent).join('\n');
    const noSpace = all.replace(/\s/g, '');
    const words = all.trim() ? all.trim().split(/\s+/).length : 0;

    const longs = [], phraseHits = new Map(), wordCount = new Map();
    let sentenceCount = 0;
    const warnRanges = [], badRanges = [], phraseRanges = [];

    for (const b of bl) {
      const map = NT.textMap(b);
      const isHeading = /^H\d$/.test(b.tagName);
      if (!isHeading) {
        for (const s of sentences(map.text)) {
          sentenceCount++;
          const len = s.text.length;
          if (len > 70) {
            const range = NT.rangeFromMap(map, s.start, s.end);
            const level = len > 100 ? 'bad' : 'warn';
            longs.push({ text: s.text, len, level, range });
            (level === 'bad' ? badRanges : warnRanges).push(range);
          }
        }
      }
      for (const p of NT.PHRASES) {
        p.re.lastIndex = 0;
        let m;
        while ((m = p.re.exec(map.text))) {
          const range = NT.rangeFromMap(map, m.index, m.index + m[0].trimEnd().length);
          if (!phraseHits.has(p.label)) phraseHits.set(p.label, { ...p, ranges: [] });
          phraseHits.get(p.label).ranges.push(range);
          phraseRanges.push(range);
        }
      }
      for (const w of map.text.match(/[가-힣A-Za-z]{2,}/g) || []) {
        const k = stripParticle(w.toLowerCase());
        if (k.length < 2 || NT.STOPWORDS.has(k) || NT.STOPWORDS.has(w)) continue;
        wordCount.set(k, (wordCount.get(k) || 0) + 1);
      }
    }

    const repeats = [...wordCount.entries()].filter(([, n]) => n >= 3).sort((a, b) => b[1] - a[1]).slice(0, 12);
    last = {
      stats: {
        chars: all.replace(/\n/g, '').length,
        charsNoSpace: noSpace.length,
        words, sentences: sentenceCount, paragraphs: bl.length,
        manuscript: Math.ceil(all.replace(/\n/g, '').length / 200),
        minutes: Math.max(noSpace.length ? 1 : 0, Math.round(noSpace.length / 500))
      },
      longs, phrases: [...phraseHits.values()].sort((a, b) => b.ranges.length - a.ranges.length), repeats,
      warnRanges, badRanges, phraseRanges
    };
    return last;
  }

  function paint(on) {
    if (!hasHighlight) return;
    CSS.highlights.delete('nt-warn'); CSS.highlights.delete('nt-bad'); CSS.highlights.delete('nt-phrase');
    if (!on || !last) return;
    CSS.highlights.set('nt-warn', new Highlight(...last.warnRanges.filter(Boolean)));
    CSS.highlights.set('nt-bad', new Highlight(...last.badRanges.filter(Boolean)));
    CSS.highlights.set('nt-phrase', new Highlight(...last.phraseRanges.filter(Boolean)));
  }

  function focusRanges(ranges) {
    if (!ranges.length || !ranges[0]) return;
    if (hasHighlight) {
      CSS.highlights.set('nt-focus', new Highlight(...ranges.filter(Boolean)));
      clearTimeout(focusRanges.t);
      focusRanges.t = setTimeout(() => CSS.highlights.delete('nt-focus'), 2500);
    }
    const r = ranges[0];
    const el = r.startContainer.parentElement;
    el && el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    const sel = window.getSelection();
    sel.removeAllRanges(); sel.addRange(r.cloneRange());
  }

  function wordRanges(root, word) {
    const out = [];
    for (const b of blocks(root)) {
      const map = NT.textMap(b);
      let i = -1;
      while ((i = map.text.toLowerCase().indexOf(word, i + 1)) !== -1) out.push(NT.rangeFromMap(map, i, i + word.length));
    }
    return out;
  }

  return { run, paint, focusRanges, wordRanges, hasHighlight, get last() { return last; } };
})();
