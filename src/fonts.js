// 글꼴 관리: 출력물(SVG 이미지, 인쇄 문서)에 넣을 @font-face를 만든다.
//
// SVG를 이미지로 그릴 때와 인쇄용 문서에서는 페이지에 불러온 웹 글꼴을 쓸 수 없다(시스템에 설치된 글꼴만 보임).
// 그래서 출력할 때 쓰인 글꼴의 파일을 data URL로 넣는다. 글꼴 출처는 두 가지:
//  1) register(): 사용자가 올린 글꼴 등 파일 내용을 직접 아는 글꼴
//  2) 페이지 스타일시트의 @font-face 규칙(구글 폰트 등). 교차 출처 스타일시트는 crossorigin 속성이 있어야 읽힌다.
// 글자 범위(unicode-range)가 나뉜 글꼴(구글 폰트의 한글 조각들)은 실제로 쓴 글자가 들어 있는 조각만 넣는다.

const bytesToDataURL = (bytes, mime) => new Promise((resolve, reject) => {
  const r = new FileReader();
  r.onload = () => resolve(r.result);
  r.onerror = () => reject(r.error);
  r.readAsDataURL(new Blob([bytes], { type: mime }));
});

const MIME = { woff2: 'font/woff2', woff: 'font/woff', ttf: 'font/ttf', otf: 'font/otf' };
const sniffMime = (bytes) => {
  const b = new Uint8Array(bytes, 0, 4);
  const tag = String.fromCharCode(...b);
  if (tag === 'wOF2') return MIME.woff2;
  if (tag === 'wOFF') return MIME.woff;
  if (tag === 'OTTO') return MIME.otf;
  return MIME.ttf;
};

// 글꼴 꾸밈에 넣는 값: 고른 글꼴 + 한글 대체 글꼴.
// 고른 글꼴에 없는 글자(라틴 전용 글꼴의 한글 등)는 브라우저 기본 글꼴(명조체일 때가 많음) 대신 이 순서로 찾는다.
// sans-serif·serif 같은 일반 이름은 따옴표를 붙이면 그 이름의 글꼴을 찾게 되어(없음) 따옴표 없이 둔다.
export const GENERIC_FAMILIES = new Set(['serif', 'sans-serif', 'monospace', 'cursive', 'fantasy', 'system-ui', 'ui-serif', 'ui-sans-serif', 'ui-monospace', 'ui-rounded', 'math', 'emoji', 'fangsong']);
export const FALLBACK_STACK = '"Noto Sans KR", "Noto Sans CJK KR", "Malgun Gothic", sans-serif';
export function fontStack(family) {
  const f = String(family || '').replace(/["\\;{}<>]/g, '').trim();
  if (!f) return null;
  if (GENERIC_FAMILIES.has(f.toLowerCase())) return f.toLowerCase();
  return `"${f}", ${FALLBACK_STACK}`;
}

// "a, 'b c', "d"" → ['a', 'b c', 'd']
export function parseFamilies(list) {
  return (list || '').split(/,(?=(?:[^"']|"[^"]*"|'[^']*')*$)/).map((s) => s.trim().replace(/^["']|["']$/g, '')).filter(Boolean);
}

// unicode-range → [[a, b], ...]
function parseRanges(v) {
  if (!v) return null;
  return v.split(',').map((r) => {
    r = r.trim().replace(/^U\+/i, '');
    if (r.includes('?')) return [parseInt(r.replace(/\?/g, '0'), 16), parseInt(r.replace(/\?/g, 'F'), 16)];
    const [a, b] = r.split('-');
    return [parseInt(a, 16), parseInt(b ?? a, 16)];
  });
}
const coversAny = (ranges, codes) => !ranges || codes.some((c) => ranges.some(([a, b]) => c >= a && c <= b));

export class FontRegistry {
  constructor() {
    this.registered = []; // { family, weight, style, unicodeRange, bytes }
    this.cache = new Map(); // url → data URL
  }

  // 글꼴 파일 등록(업로드 글꼴). 화면에서도 쓰이도록 document.fonts에도 넣는다.
  // lib: 내 글꼴(이 컴퓨터에 보관한 글꼴) — 다른 프로젝트를 열어도(unregisterAll) 남는다
  async register(family, bytes, { weight = '400', style = 'normal', unicodeRange, lib = false } = {}) {
    const face = new FontFace(family, bytes, { weight: String(weight), style, ...(unicodeRange ? { unicodeRange } : {}) });
    await face.load();
    document.fonts.add(face);
    this.registered.push({ family, weight: String(weight), style, unicodeRange: unicodeRange || null, bytes, face, lib: !!lib });
    return face;
  }

  // 같은 이름·굵기·기울임이 등록되어 있는지
  has(family, weight = '400', style = 'normal') {
    return this.registered.some((f) => f.family === family && f.weight === String(weight) && f.style === style);
  }
  // 한 글꼴(이름이 같은 굵기 전부) 해제
  unregister(family) {
    for (const f of this.registered.filter((x) => x.family === family)) { if (f.face) document.fonts.delete(f.face); }
    this.registered = this.registered.filter((x) => x.family !== family);
  }

  // 프로젝트 글꼴 모두 해제(다른 프로젝트를 열 때). 내 글꼴(lib)은 남긴다
  unregisterAll() {
    for (const f of this.registered) if (f.face && !f.lib) document.fonts.delete(f.face);
    this.registered = this.registered.filter((f) => f.lib);
  }

  // 페이지 스타일시트의 @font-face 규칙 목록
  sheetFaces() {
    const out = [];
    const walk = (rules, base) => {
      for (const r of rules) {
        if (r instanceof CSSFontFaceRule) out.push({ rule: r, base });
        else if (r instanceof CSSImportRule && r.styleSheet) walk(safeRules(r.styleSheet), r.styleSheet.href || base);
        else if (r.cssRules) walk(r.cssRules, base);
      }
    };
    for (const sh of document.styleSheets) walk(safeRules(sh), sh.href || location.href);
    return out;
  }

  // families에 속하고 text의 글자를 하나라도 포함하는 글꼴만 @font-face CSS로. 파일은 data URL로 넣는다.
  async cssFor(families, text) {
    const want = new Set([...families].map((f) => f.toLowerCase()));
    const codes = [...new Set([...text].map((c) => c.codePointAt(0)))];
    const parts = [], seen = new Set();
    for (const f of this.registered) {
      if (!want.has(f.family.toLowerCase()) || !coversAny(parseRanges(f.unicodeRange), codes)) continue;
      const k = `${f.family}|${f.weight}|${f.style}|${f.unicodeRange}`;
      if (seen.has(k)) continue; // 내 글꼴과 프로젝트 글꼴에 같은 것이 있으면 한 번만
      seen.add(k);
      const url = await bytesToDataURL(f.bytes, sniffMime(f.bytes));
      parts.push(`@font-face{font-family:${JSON.stringify(f.family)};font-weight:${f.weight};font-style:${f.style};` +
        `${f.unicodeRange ? `unicode-range:${f.unicodeRange};` : ''}src:url(${url});}`);
    }
    for (const { rule, base } of this.sheetFaces()) {
      const st = rule.style;
      const fam = parseFamilies(st.getPropertyValue('font-family'))[0];
      if (!fam || !want.has(fam.toLowerCase())) continue;
      if (!coversAny(parseRanges(st.getPropertyValue('unicode-range')), codes)) continue;
      const src = await this.inlineSrc(st.getPropertyValue('src'), base);
      if (!src) continue;
      let css = '';
      for (let i = 0; i < st.length; i++) {
        const p = st[i];
        if (p !== 'src') css += `${p}:${st.getPropertyValue(p)};`;
      }
      parts.push(`@font-face{${css}src:${src};}`);
    }
    return parts.join('\n');
  }

  // src 값의 url(...)을 data URL로. local(...)은 그대로. 첫 번째로 받아진 url만 남긴다.
  async inlineSrc(src, base) {
    const items = src.split(/,(?![^(]*\))/).map((s) => s.trim());
    const keep = [];
    for (const it of items) {
      const m = /url\(\s*["']?([^"')]+)["']?\s*\)(\s*format\([^)]*\))?/.exec(it);
      if (!m) { if (/^local\(/.test(it)) keep.push(it); continue; }
      const abs = new URL(m[1], base).href;
      try {
        let data = this.cache.get(abs);
        if (!data) {
          if (abs.startsWith('data:')) data = abs;
          else {
            const res = await fetch(abs);
            if (!res.ok) throw new Error(res.status);
            const buf = await res.arrayBuffer();
            data = await bytesToDataURL(buf, sniffMime(buf));
          }
          this.cache.set(abs, data);
        }
        keep.push(`url(${data})${m[2] || ''}`);
        break;
      } catch (err) {
        console.warn('글꼴을 받지 못함', abs, err);
      }
    }
    return keep.length ? keep.join(',') : null;
  }
}

function safeRules(sheet) {
  try { return sheet.cssRules || []; } catch { return []; } // 교차 출처(crossorigin 없음)
}

export const fonts = new FontRegistry();
