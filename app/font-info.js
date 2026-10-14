// 글꼴 파일 안의 이름·굵기·기울임 읽기(글꼴 넣기용).
//   TTF·OTF·TTC(첫 글꼴)·WOFF는 파일 안 이름표(name 표)와 OS/2 표를 직접 읽는다.
//   WOFF2는 압축(brotli)을 풀 수 없어 파일 이름으로 짐작한다.
// 결과: { family(글꼴 이름, CSS에 쓰는 이름), label(화면에 보일 이름: 한글 이름이 있으면 한글), weight('100'–'900'), style('normal'|'italic'), source('name'|'file') }
// 같은 글꼴의 굵기별 파일(Pretendard-Regular, Pretendard-Bold…)은 같은 family + 다른 weight로 묶인다.

import { unzlibSync } from 'fflate';

// 굵기 이름 → 값(긴 이름부터 맞춰 본다)
const WEIGHT_WORDS = [
  ['extralight', 200], ['ultralight', 200], ['extrabold', 800], ['ultrabold', 800], ['semibold', 600], ['demibold', 600],
  ['hairline', 100], ['thin', 100], ['light', 300], ['regular', 400], ['normal', 400], ['book', 400], ['roman', 400],
  ['medium', 500], ['bold', 700], ['heavy', 900], ['black', 900],
];
const WEIGHT_RE = new RegExp(`[\\s_-]*(extra|ultra|semi|demi)?[\\s_-]?(hairline|thin|light|regular|normal|book|roman|medium|bold|heavy|black)$`, 'i');

// "Pretendard-SemiBoldItalic" → { family: 'Pretendard', weight: 600, italic: true }
export function guessFromName(name) {
  let s = String(name || '').replace(/\.(ttf|otf|ttc|woff2?)$/i, '').trim();
  let italic = false, weight = 400;
  if (/[\s_-]?(italic|oblique)$/i.test(s)) { italic = true; s = s.replace(/[\s_-]?(italic|oblique)$/i, ''); }
  else if (/[\s_-]it$/i.test(s)) { italic = true; s = s.replace(/[\s_-]it$/i, ''); }
  const m = WEIGHT_RE.exec(s);
  if (m && m.index > 0) {
    const word = ((m[1] || '') + m[2]).toLowerCase();
    weight = (WEIGHT_WORDS.find(([w]) => w === word) || WEIGHT_WORDS.find(([w]) => w === m[2].toLowerCase()))[1];
    s = s.slice(0, m.index);
  }
  const num = /[\s_-]([1-9]00)$/.exec(s); // 웹 글꼴 이름 "…-600"
  if (num && num.index > 0) { weight = +num[1]; s = s.slice(0, num.index); }
  s = s.replace(/[\s_-]+$/, '').trim();
  return { family: s || String(name || '').trim() || '넣은 글꼴', weight, italic };
}

// ---------- sfnt 읽기 ----------
const tag = (dv, o) => String.fromCharCode(dv.getUint8(o), dv.getUint8(o + 1), dv.getUint8(o + 2), dv.getUint8(o + 3));

// 표 목록 → { 이름: Uint8Array }
function sfntTables(u8, base = 0) {
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  const n = dv.getUint16(base + 4);
  const out = {};
  for (let i = 0; i < n; i++) {
    const r = base + 12 + i * 16;
    const t = tag(dv, r), off = dv.getUint32(r + 8), len = dv.getUint32(r + 12);
    if (off + len <= u8.length) out[t] = u8.subarray(off, off + len);
  }
  return out;
}
function woffTables(u8) {
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  const n = dv.getUint16(12);
  const out = {};
  for (let i = 0; i < n; i++) {
    const r = 44 + i * 20;
    const t = tag(dv, r), off = dv.getUint32(r + 4), comp = dv.getUint32(r + 8), orig = dv.getUint32(r + 12);
    if (!['name', 'OS/2', 'head'].includes(t) || off + comp > u8.length) continue;
    const raw = u8.subarray(off, off + comp);
    out[t] = comp < orig ? unzlibSync(raw) : raw;
  }
  return out;
}

// name 표 → [{ platform, lang, id, text }]
function nameRecords(t) {
  const dv = new DataView(t.buffer, t.byteOffset, t.byteLength);
  const count = dv.getUint16(2), strOff = dv.getUint16(4);
  const out = [];
  for (let i = 0; i < count; i++) {
    const r = 6 + i * 12;
    const platform = dv.getUint16(r), enc = dv.getUint16(r + 2), lang = dv.getUint16(r + 4), id = dv.getUint16(r + 6), len = dv.getUint16(r + 8), off = dv.getUint16(r + 10);
    const s = strOff + off;
    if (s + len > t.length) continue;
    let text = '';
    if (platform === 3 || platform === 0) { for (let k = 0; k + 1 < len; k += 2) text += String.fromCharCode(dv.getUint16(s + k)); }
    else if (platform === 1 && enc === 0) { for (let k = 0; k < len; k++) text += String.fromCharCode(dv.getUint8(s + k)); }
    else continue;
    text = text.replace(/\0/g, '').trim();
    if (text) out.push({ platform, lang, id, text });
  }
  return out;
}

// nameID들 중 첫 번째로 있는 것. 영어(Windows 0x409 → 다른 Windows 영어 → Mac 영어 → 아무거나) 우선, ko=true면 한국어만
function pickName(recs, ids, ko = false) {
  for (const id of ids) {
    const c = recs.filter((r) => r.id === id);
    if (!c.length) continue;
    if (ko) { const k = c.find((r) => r.platform === 3 && r.lang === 0x412); if (k) return k.text; continue; }
    const r = c.find((r) => r.platform === 3 && r.lang === 0x409) || c.find((r) => r.platform === 3 && (r.lang & 0xff) === 0x09)
      || c.find((r) => r.platform === 1 && r.lang === 0) || c.find((r) => /^[\x20-\x7e]+$/.test(r.text)) || c[0];
    return r.text;
  }
  return null;
}

function fromTables(tables) {
  if (!tables.name) return null;
  const recs = nameRecords(tables.name);
  const typo = pickName(recs, [16]);
  let family = typo || pickName(recs, [1]);
  if (!family) return null;
  let label = pickName(recs, [16, 1], true) || null;
  let weight = 400, italic = false;
  if (tables['OS/2']?.length >= 64) {
    const dv = new DataView(tables['OS/2'].buffer, tables['OS/2'].byteOffset, tables['OS/2'].byteLength);
    weight = dv.getUint16(4);
    if (weight > 0 && weight < 10) weight *= 100; // 오래된 글꼴(1–9)
    italic = !!(dv.getUint16(62) & 1);
  }
  if (!italic && tables.head?.length >= 46) italic = !!(new DataView(tables.head.buffer, tables.head.byteOffset).getUint16(44) & 2);
  // 굵기별로 이름이 갈린 오래된 글꼴("NanumGothic ExtraBold"): 같은 글꼴로 묶이게 끝의 굵기 이름을 뗀다
  if (!typo) {
    const g = guessFromName(family);
    if (g.family !== family && g.weight === weight && (g.weight !== 400 || g.italic)) {
      family = g.family;
      if (label) label = guessFromName(label).family;
    }
  }
  return { family, label: label && label !== family ? label : null, weight, italic };
}

// 파일 내용 → 글꼴 정보(읽지 못하면 null)
export function readFontInfo(buf) {
  try {
    const u8 = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
    if (u8.length < 12) return null;
    const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
    const t = tag(dv, 0);
    if (t === 'wOFF') return fromTables(woffTables(u8));
    if (t === 'ttcf') return fromTables(sfntTables(u8, dv.getUint32(12))); // 모음 파일: 첫 글꼴
    if (t === 'OTTO' || t === 'true' || dv.getUint32(0) === 0x00010000) return fromTables(sfntTables(u8));
  } catch { /* 깨진 파일 → 이름으로 짐작 */ }
  return null;
}

const clampWeight = (w) => String(Math.max(100, Math.min(900, Math.round((Number(w) || 400) / 100) * 100)));

// 파일(이름 + 내용) → { family, label, weight, style, source }
export function fontInfo(fileName, buf) {
  const r = readFontInfo(buf);
  if (r) return { family: r.family.slice(0, 100), label: r.label ? r.label.slice(0, 100) : null, weight: clampWeight(r.weight), style: r.italic ? 'italic' : 'normal', source: 'name' };
  const g = guessFromName(fileName);
  return { family: g.family.slice(0, 100), label: null, weight: clampWeight(g.weight), style: g.italic ? 'italic' : 'normal', source: 'file' };
}

// 굵기 숫자 → 이름
export const WEIGHT_NAMES = { 100: '가늘게(100)', 200: '아주 얇게(200)', 300: '얇게(300)', 400: '보통(400)', 500: '중간(500)', 600: '약간 굵게(600)', 700: '굵게(700)', 800: '아주 굵게(800)', 900: '가장 굵게(900)' };
