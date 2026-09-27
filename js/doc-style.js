/* 문서(글 자체)의 스타일. 편집 화면, HTML 내보내기, 카드뉴스가 모두 이 CSS를 공유한다.
 * 값은 .nt-page 에 걸린 CSS 변수(--nt-*)로 조절하고, 테마별 장식은 .theme-* 클래스로 준다. */
window.NT = window.NT || {};

NT.FONT_LINKS = [
  'https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/variable/pretendardvariable-dynamic-subset.min.css',
  'https://fonts.googleapis.com/css2?family=Noto+Serif+KR:wght@400;600;700&family=Nanum+Myeongjo:wght@400;700;800&family=Gowun+Batang:wght@400;700&family=Gowun+Dodum&family=IBM+Plex+Sans+KR:wght@400;600;700&family=Nanum+Pen+Script&family=Black+Han+Sans&family=Do+Hyeon&family=Song+Myung&family=Hahmlet:wght@400;600;700&family=Diphylleia&family=Gasoek+One&family=Bagel+Fat+One&display=swap'
];

NT.DOC_CSS = `
.nt-page {
  --nt-font-body: "Pretendard Variable", Pretendard, -apple-system, "Apple SD Gothic Neo", "Malgun Gothic", sans-serif;
  --nt-font-head: var(--nt-font-body);
  --nt-fs: 17px; --nt-lh: 1.8; --nt-ls: -0.01em; --nt-pg: 1.1em; --nt-w: 680px;
  --nt-accent: #3b5bdb; --nt-bg: #ffffff; --nt-fg: #1f2328; --nt-muted: #6b7280;
  --nt-rule: #e5e7eb; --nt-quote-bg: #f5f6f8; --nt-code-bg: #f3f4f6; --nt-mark: #fff3a3;
  --nt-align: left; --nt-indent: 0;
  background: var(--nt-bg); color: var(--nt-fg);
}
.nt-doc {
  max-width: var(--nt-w); margin: 0 auto;
  font-family: var(--nt-font-body); font-size: var(--nt-fs); line-height: var(--nt-lh);
  letter-spacing: var(--nt-ls); text-align: var(--nt-align);
  overflow-wrap: break-word; -webkit-font-smoothing: antialiased;
}
.nt-page.opt-keepall .nt-doc { word-break: keep-all; }
.nt-doc > * { margin: 0 0 var(--nt-pg); }
.nt-doc > *:last-child { margin-bottom: 0; }
.nt-doc p { text-indent: var(--nt-indent); text-wrap: pretty; }
.nt-doc h1, .nt-doc h2, .nt-doc h3 {
  font-family: var(--nt-font-head); line-height: 1.3; letter-spacing: -0.02em;
  text-align: left; text-indent: 0; font-weight: 700;
}
.nt-page.opt-balance .nt-doc h1, .nt-page.opt-balance .nt-doc h2, .nt-page.opt-balance .nt-doc h3 { text-wrap: balance; }
.nt-doc h1 { font-size: 2em; margin-top: 0.4em; margin-bottom: 0.6em; }
.nt-doc h2 { font-size: 1.45em; margin-top: 1.6em; margin-bottom: 0.6em; }
.nt-doc h3 { font-size: 1.15em; margin-top: 1.3em; margin-bottom: 0.4em; }
.nt-doc > h1:first-child, .nt-doc > h2:first-child, .nt-doc > h3:first-child { margin-top: 0; }
.nt-doc a { color: var(--nt-accent); text-decoration: underline; text-underline-offset: 0.2em; }
.nt-doc strong, .nt-doc b { font-weight: 700; }
.nt-doc mark { background: var(--nt-mark); color: inherit; padding: 0 0.1em; border-radius: 2px; }
.nt-doc .accent { color: var(--nt-accent); }
.nt-doc code { font-family: ui-monospace, "SF Mono", Menlo, Consolas, monospace; font-size: 0.88em;
  background: var(--nt-code-bg); padding: 0.1em 0.35em; border-radius: 4px; }
.nt-doc pre { background: var(--nt-code-bg); padding: 1em 1.2em; border-radius: 8px; overflow-x: auto;
  font-family: ui-monospace, "SF Mono", Menlo, Consolas, monospace; font-size: 0.85em; line-height: 1.6;
  white-space: pre-wrap; text-align: left; letter-spacing: 0; }
.nt-doc pre code { background: none; padding: 0; font-size: 1em; }
.nt-doc blockquote { border-left: 3px solid var(--nt-accent); padding: 0.2em 0 0.2em 1.1em; color: var(--nt-muted); }
.nt-doc blockquote p { text-indent: 0; }
.nt-doc blockquote.pull { border: 0; border-top: 2px solid var(--nt-fg); border-bottom: 2px solid var(--nt-fg);
  padding: 1em 0.5em; text-align: center; font-family: var(--nt-font-head); font-size: 1.3em;
  line-height: 1.5; color: var(--nt-fg); font-weight: 600; margin: 1.6em 0; }
.nt-doc aside.callout { background: var(--nt-quote-bg); border-radius: 10px; padding: 1em 1.2em 1em 3em;
  position: relative; text-indent: 0; }
.nt-doc aside.callout::before { content: attr(data-icon); position: absolute; left: 1em; top: 0.95em; }
.nt-doc ul, .nt-doc ol { padding-left: 1.4em; text-align: left; }
.nt-doc li { margin: 0.25em 0; }
.nt-doc li::marker { color: var(--nt-accent); }
.nt-doc hr { border: 0; height: auto; margin: 2.2em 0; text-align: center; overflow: visible; color: var(--nt-muted); }
.nt-doc hr::after { content: "·  ·  ·"; letter-spacing: 0.4em; font-size: 1.1em; }
.nt-doc figure { margin-left: 0; margin-right: 0; text-align: center; }
.nt-doc img { max-width: 100%; height: auto; border-radius: 6px; display: block; margin: 0 auto; }
.nt-doc figcaption { font-size: 0.82em; color: var(--nt-muted); margin-top: 0.6em; text-indent: 0; }

/* 드롭캡: 첫 문단 첫 글자 */
.nt-page.opt-dropcap .nt-doc > p:first-of-type::first-letter {
  float: left; font-family: var(--nt-font-head); font-size: 3.4em; line-height: 0.9;
  padding: 0.08em 0.12em 0 0; color: var(--nt-accent); font-weight: 700;
}

/* ─ 테마별 장식 ─ */
.theme-magazine .nt-doc h1 { font-size: 2.4em; font-weight: 800; letter-spacing: -0.03em; }
.theme-magazine .nt-doc h2 { text-transform: none; border-top: 3px solid var(--nt-fg); padding-top: 0.5em; }
.theme-magazine .nt-doc h3 { color: var(--nt-accent); }
.theme-magazine .nt-doc hr::after { content: "■"; font-size: 0.7em; color: var(--nt-accent); }

.theme-essay .nt-doc h1, .theme-essay .nt-doc h2 { text-align: center; font-weight: 600; }
.theme-essay .nt-doc h1 { font-size: 1.9em; margin-bottom: 1.4em; }
.theme-essay .nt-doc h1::after { content: ""; display: block; width: 2.2em; height: 1px; background: var(--nt-fg); margin: 0.9em auto 0; }
.theme-essay .nt-doc blockquote { border-left: 0; text-align: center; font-style: normal; padding: 0.4em 1.5em; }
.theme-essay .nt-doc hr::after { content: "❦"; font-size: 1.4em; letter-spacing: 0; }

.theme-note { background-image: linear-gradient(var(--nt-bg) calc(100% - 1px), var(--nt-rule) 1px);
  background-size: 100% calc(var(--nt-fs) * var(--nt-lh)); }
.theme-note .nt-doc h1, .theme-note .nt-doc h2 { color: var(--nt-accent); }
.theme-note .nt-doc mark { background: linear-gradient(transparent 55%, var(--nt-mark) 55%); }

.theme-dark .nt-doc hr::after { color: var(--nt-accent); }

.theme-retro .nt-doc h1, .theme-retro .nt-doc h2 { border-bottom: 2px dashed var(--nt-fg); padding-bottom: 0.25em; }
.theme-retro .nt-doc blockquote { border-left: 4px double var(--nt-fg); }
.theme-retro .nt-doc hr::after { content: "* * *"; }

.theme-letter .nt-doc { font-size: calc(var(--nt-fs) * 1.35); }
.theme-letter .nt-doc h1, .theme-letter .nt-doc h2, .theme-letter .nt-doc h3 { font-weight: 400; color: var(--nt-accent); }
.theme-letter .nt-doc hr::after { content: "♡"; letter-spacing: 0; color: var(--nt-accent); }

.theme-newsletter .nt-doc h1 { background: var(--nt-accent); color: #fff; padding: 0.6em 0.7em; border-radius: 8px; font-size: 1.7em; }
.theme-newsletter .nt-doc h2 { color: var(--nt-accent); }
.theme-newsletter .nt-doc h2::before { content: ""; display: inline-block; width: 0.35em; height: 1em; background: var(--nt-accent);
  vertical-align: -0.12em; margin-right: 0.45em; border-radius: 2px; }
.theme-newsletter .nt-doc blockquote { background: var(--nt-quote-bg); border-radius: 0 8px 8px 0; padding: 0.8em 1.1em; }
`;

(() => {
  const style = document.createElement('style');
  style.id = 'nt-doc-style';
  style.textContent = NT.DOC_CSS;
  document.head.appendChild(style);
})();
