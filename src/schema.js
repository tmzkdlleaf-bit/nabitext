// ProseMirror 스키마. 마크 이름과 속성은 layout.js의 MARKS와 1:1로 대응한다.
// toDOM: 복사할 때 외부 프로그램(워드, 구글 문서, 브라우저)이 모양을 알아보도록 인라인 CSS로 내보낸다.
// parseDOM: 외부 HTML을 붙여넣을 때 쓴다. 이 프로그램끼리의 복사는 clipboard.js가 슬라이스 JSON으로 손실 없이 옮긴다.

import { Schema } from 'prosemirror-model';

const num = (v) => {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : null;
};

// CSS 길이 → px. px/pt만 받는다(em·%는 기준 크기를 알 수 없어 버린다).
const px = (v) => {
  const m = /^(-?[\d.]+)(px|pt)?$/.exec(String(v).trim());
  if (!m) return null;
  const n = parseFloat(m[1]);
  return m[2] === 'pt' ? +(n * 4 / 3).toFixed(2) : n;
};

// Chrome은 style 값을 읽을 때 색을 rgb()로 바꿔 준다 → 불투명색은 #rrggbb로 되돌린다
export const normColor = (v) => {
  if (v == null) return null;
  v = String(v).trim();
  const m = /^rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)(?:\s*[,/]\s*([\d.]+%?))?\s*\)$/.exec(v);
  if (!m) return v;
  const a = m[4] == null ? 1 : m[4].endsWith('%') ? parseFloat(m[4]) / 100 : parseFloat(m[4]);
  if (a < 1) return v;
  return '#' + [m[1], m[2], m[3]].map((n) => (+n).toString(16).padStart(2, '0')).join('');
};

const styleSpan = (css) => ['span', { style: css }, 0];

// 값 하나짜리 마크: CSS 속성 하나와 대응
const valueMark = (prop, def, parse, unit = '') => ({
  attrs: { value: { default: def } },
  toDOM: (m) => styleSpan(`${prop}: ${m.attrs.value}${unit}`),
  parseDOM: [{ style: prop, getAttrs: (v) => { const r = parse(v); return r == null ? false : { value: r }; } }],
});

// 밑줄/취소선/윗줄. 겹쳐 쓸 때 각자 선 스타일이 유지되도록 마크마다 span을 따로 만든다.
const DECO_STYLES = /^(solid|double|dotted|dashed|wavy)$/;
const decoMark = (line, tags) => ({
  attrs: { style: { default: 'solid' }, color: { default: null }, thickness: { default: null } },
  // 네 속성을 모두 적어야 브라우저가 text-decoration 단축 표기로 읽어 준다(parseDOM이 모양·색·두께를 되찾는 경로)
  toDOM: (m) => {
    const a = m.attrs;
    return styleSpan(`text-decoration-line: ${line}; text-decoration-style: ${a.style}; ` +
      `text-decoration-color: ${a.color || 'currentcolor'}; text-decoration-thickness: ${a.thickness != null ? a.thickness + 'px' : 'auto'}; ` +
      'text-decoration-skip-ink: none');
  },
  parseDOM: [
    ...tags.map((tag) => ({ tag })),
    // 순서 중요: ProseMirror는 두 규칙을 모두 적용하고 나중 것이 이긴다.
    // text-decoration-line(선 종류만)이 먼저, 단축 표기(모양·색·두께 포함, 모든 속성이 있을 때만 값이 나옴)가 나중.
    ...['text-decoration-line', 'text-decoration'].map((prop) => ({
      style: prop,
      getAttrs: (v) => {
        const toks = v.trim().split(/\s+(?![^(]*\))/);
        if (!toks.includes(line)) return false;
        const attrs = { style: 'solid', color: null, thickness: null };
        for (const t of toks) {
          if (DECO_STYLES.test(t)) attrs.style = t;
          else if (px(t) != null) attrs.thickness = px(t);
          else if (!/^(underline|overline|line-through|none|auto|from-font|currentcolor)$/i.test(t)) attrs.color = normColor(t);
        }
        return attrs;
      },
    })),
  ],
});

const blockAttrs = (dom) => {
  const s = dom.style;
  const attrs = {};
  const al = s.textAlign;
  if (/^(left|right|center|justify)$/.test(al)) attrs.align = al;
  const ind = px(s.textIndent);
  if (ind) attrs.indent = ind;
  // 이 프로그램이 내보낸 속성(단락 간격, 단락 스타일)은 data 속성에서 그대로 복원
  if (dom.dataset.leSpacing) attrs.spacing = num(dom.dataset.leSpacing);
  if (dom.dataset.leStyle) try { attrs.style = JSON.parse(dom.dataset.leStyle); } catch {}
  if (dom.dataset.lePreset) attrs.preset = String(dom.dataset.lePreset);
  return attrs;
};

export const schema = new Schema({
  nodes: {
    doc: { content: 'block+' },
    paragraph: {
      group: 'block',
      content: 'inline*',
      attrs: { align: { default: null }, indent: { default: 0 }, spacing: { default: null }, style: { default: null }, preset: { default: null } },
      toDOM: (n) => {
        const a = n.attrs;
        const attrs = {};
        let css = '';
        if (a.align) css += `text-align: ${a.align};`;
        if (a.indent) css += `text-indent: ${a.indent}px;`;
        if (css) attrs.style = css;
        if (a.spacing != null) attrs['data-le-spacing'] = String(a.spacing);
        if (a.style) attrs['data-le-style'] = JSON.stringify(a.style);
        if (a.preset) attrs['data-le-preset'] = a.preset; // 스타일 프리셋 id(같은 프로젝트 안에서만 의미 있음)
        return ['p', attrs, 0];
      },
      parseDOM: [
        { tag: 'p', getAttrs: blockAttrs },
        ...['h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'li', 'dt', 'dd', 'pre'].map((tag) => ({ tag, getAttrs: blockAttrs })),
      ],
    },
    image: {
      group: 'block',
      atom: true,
      selectable: true,
      attrs: { src: {}, width: { default: null }, radius: { default: 0 }, align: { default: null }, spacing: { default: null } },
      toDOM: (n) => {
        const a = n.attrs;
        const attrs = { src: a.src };
        if (a.width) attrs.width = String(a.width);
        if (a.radius) attrs.style = `border-radius: ${a.radius}px`;
        if (a.align) attrs['data-le-align'] = a.align;
        if (a.spacing != null) attrs['data-le-spacing'] = String(a.spacing);
        return ['img', attrs];
      },
      parseDOM: [{
        tag: 'img[src]',
        getAttrs: (dom) => ({
          src: dom.getAttribute('src'),
          width: num(dom.getAttribute('width')),
          radius: px(dom.style.borderRadius) || 0,
          align: dom.dataset.leAlign || null,
          spacing: dom.dataset.leSpacing != null ? num(dom.dataset.leSpacing) : null,
        }),
      }],
    },
    hard_break: {
      group: 'inline', inline: true, selectable: false, leafText: () => '\n',
      toDOM: () => ['br'], parseDOM: [{ tag: 'br' }],
    },
    text: { group: 'inline' },
  },
  marks: {
    // 글자 스타일 프리셋(프로젝트의 프리셋 id). 맨 앞에 두어 레이아웃이 먼저 적용하고, 뒤의 개별 마크가 덮어쓴다
    charStyle: {
      attrs: { id: {} },
      toDOM: (m) => ['span', { 'data-le-cstyle': m.attrs.id }, 0],
      parseDOM: [{ tag: 'span[data-le-cstyle]', getAttrs: (dom) => ({ id: dom.dataset.leCstyle }) }],
    },
    // bold와 weight는 둘 다 굵기를 정하므로 한 글자에 하나만 둔다
    bold: {
      excludes: 'bold weight',
      toDOM: () => ['strong', 0],
      parseDOM: [
        { tag: 'strong' },
        // 구글 문서는 전체를 <b style="font-weight:normal">로 감싼다
        { tag: 'b', getAttrs: (dom) => dom.style.fontWeight !== 'normal' && null },
        { style: 'font-weight', getAttrs: (v) => /^(bold(er)?|700)$/.test(v.trim()) && null },
      ],
    },
    weight: {
      excludes: 'bold weight',
      attrs: { value: { default: 400 } },
      toDOM: (m) => styleSpan(`font-weight: ${m.attrs.value}`),
      parseDOM: [{
        style: 'font-weight',
        getAttrs: (v) => {
          const n = parseInt(v, 10);
          return n && n !== 400 && n !== 700 ? { value: n } : false;
        },
      }],
    },
    italic: {
      toDOM: () => ['em', 0],
      parseDOM: [{ tag: 'i' }, { tag: 'em' }, { style: 'font-style', getAttrs: (v) => /italic|oblique/.test(v) && null }],
    },
    underline: decoMark('underline', ['u', 'ins']),
    strike: decoMark('line-through', ['s', 'del', 'strike']),
    overline: decoMark('overline', []),
    // transparent는 그라디언트 글자(background-clip:text)의 일부라 색으로 보지 않는다
    color: valueMark('color', null, (v) => (/^(transparent|rgba\(0, 0, 0, 0\))$/.test(v.trim()) ? null : normColor(v) || null)),
    highlight: {
      attrs: { value: { default: null } },
      toDOM: (m) => styleSpan(`background-color: ${m.attrs.value}`),
      parseDOM: [
        { tag: 'mark', getAttrs: (dom) => ({ value: normColor(dom.style.backgroundColor) || '#fff27a' }) },
        { style: 'background-color', getAttrs: (v) => (/^(transparent|initial|inherit|none|rgba\(0, 0, 0, 0\))$/.test(v.trim()) ? false : { value: normColor(v) }) },
      ],
    },
    size: valueMark('font-size', null, px, 'px'),
    font: valueMark('font-family', null, (v) => v.trim() || null),
    spacing: valueMark('letter-spacing', 0, px, 'px'),
    lineHeight: valueMark('line-height', null, (v) => (/^[\d.]+$/.test(v.trim()) ? num(v) : null)),
    stroke: {
      attrs: { width: { default: 1 }, color: { default: '#000' } },
      toDOM: (m) => styleSpan(`-webkit-text-stroke: ${m.attrs.width}px ${m.attrs.color}; paint-order: stroke fill`),
      parseDOM: [{
        style: '-webkit-text-stroke',
        getAttrs: (v) => {
          const m = /^([\d.]+(?:px|pt)?)\s+(.+)$/.exec(v.trim());
          return m ? { width: px(m[1]), color: normColor(m[2]) } : false;
        },
      }],
    },
    shadow: valueMark('text-shadow', null, (v) => (v.trim() && v.trim() !== 'none' ? v.trim() : null)),
    gradient: {
      attrs: { value: { default: null } },
      toDOM: (m) => styleSpan(`background-image: ${m.attrs.value}; -webkit-background-clip: text; background-clip: text; color: transparent`),
      parseDOM: [{ style: 'background-image', getAttrs: (v) => (/gradient\(/.test(v) ? { value: v.trim() } : false) }],
    },
  },
});

// 외부 HTML에서 기본으로 살리는 마크(글자 모양의 '의미'에 해당하는 것). 나머지는 프레임 스타일을 따른다.
export const BASIC_MARKS = new Set(['bold', 'weight', 'italic', 'underline', 'strike', 'overline']);
