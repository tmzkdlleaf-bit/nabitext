// 프로젝트 = 장 목록 + 스와치 + 업로드 글꼴. 파일 형식은 zip:
//   project.json            { format: 'nabitext', version, name, pages, swatches, fonts, styles(스타일 프리셋), grid, master(공통 장), pageStart(첫 쪽 번호), savedAt }
//   assets/<id>.<확장자>     이미지·글꼴 원본(id = 내용 해시, app/assets.js)
// 모델 안의 이미지 주소(이미지 요소 src, 글상자 문서의 이미지 노드 src)와 글꼴 파일은 저장할 때 'assets/…'로, 열 때 blob: 주소로 바꾼다.

import { zipSync, unzipSync, strToU8, strFromU8 } from 'fflate';
import * as M from './model.js';
import { extOf, mimeOfExt } from './assets.js';

export const FORMAT = 'nabitext';
export const VERSION = 1;
export const FILE_EXT = 'nabi';

export function newProject(name = '제목 없음') {
  return { name, pages: [M.newPage()], swatches: null, fonts: [], styles: {}, grid: { size: 20 } }; // fonts: [{ family, weight, style, asset }]
}

// 스타일 프리셋 정리(열 때·저장할 때): id → { name, style: { 글자 모양 }, align, spacing, indent }
const STYLE_KEYS = { fontFamily: 'string', fontSize: 'number', fontWeight: 'number', italic: 'boolean', color: 'string', lineHeight: 'number', letterSpacing: 'number' };
export function cleanStyles(obj) {
  const out = {};
  if (!obj || typeof obj !== 'object') return out;
  for (const [id, p] of Object.entries(obj)) {
    if (!p || typeof p !== 'object' || !/^[\w-]{1,40}$/.test(id)) continue;
    const style = {};
    for (const [k, t] of Object.entries(STYLE_KEYS)) if (typeof p.style?.[k] === t && (t !== 'number' || Number.isFinite(p.style[k]))) style[k] = p.style[k];
    out[id] = { name: String(p.name || '이름 없음').slice(0, 80), style, ...(p.kind === 'char' ? { kind: 'char' } : {}),
      align: ['left', 'center', 'right', 'justify'].includes(p.align) ? p.align : null,
      spacing: Number.isFinite(p.spacing) ? p.spacing : null, indent: Number.isFinite(p.indent) ? p.indent : 0 };
  }
  return out;
}
const cleanGrid = (g) => ({ size: Math.max(2, Math.min(500, Math.round(Number(g?.size) || 20))) });

// 장 JSON 안의 모든 이미지 주소에 fn(src) → 새 src를 적용(제자리 수정)
async function mapSrcs(pages, fn) {
  const jobs = [];
  const doc = (d) => {
    if (!d || typeof d !== 'object') return;
    if (d.type === 'image' && d.attrs?.src) jobs.push(fn(d.attrs.src).then((s) => { d.attrs.src = s; }));
    if (Array.isArray(d.content)) d.content.forEach(doc);
  };
  const field = (obj, key) => { if (obj && typeof obj[key] === 'string' && obj[key]) jobs.push(fn(obj[key]).then((s) => { obj[key] = s; })); };
  const walk = (list) => {
    for (const n of list || []) {
      if (n.type === 'image' && n.src) jobs.push(fn(n.src).then((s) => { n.src = s; }));
      if (n.mask?.kind === 'alpha') field(n.mask, 'src');           // 알파 마스크 이미지
      if (n.fill?.type === 'pattern') field(n.fill, 'src');         // 패턴 채움 이미지
      if (n.area?.kind === 'image') field(n.area, 'src');           // 이미지 외곽선 글상자
      if (n.type === 'text') doc(n.doc);
      if (n.type === 'group') walk(n.children);
    }
  };
  for (const p of pages) { walk(p.elements); if (p.bgImage) field(p.bgImage, 'src'); } // 장 배경 이미지
  await Promise.all(jobs);
}

const assetPath = (a) => `assets/${a.id}.${extOf(a.type)}`;

// 프로젝트 → project.json 내용 + 쓰인 에셋 id. 에셋이 아닌 주소(붙여넣은 원격 이미지 등)는 가져와 에셋으로 만든다.
// 가져오지 못한 주소는 그대로 두고 missing에 모은다.
export async function toJSON(project, { assets, docOf, swatches, app = '' }) {
  const firsts = M.storyFirsts(project.pages);
  const pages = JSON.parse(JSON.stringify(project.pages.map((p) => M.serializePage(p, docOf, firsts))));
  // 공통 장: 요소가 있을 때만 저장(공통 장 안의 이어진 글은 공통 장 안에서만)
  const master = project.master?.elements.length ? JSON.parse(JSON.stringify(M.serializePage(project.master, docOf))) : null;
  const used = new Set(), missing = [];
  await mapSrcs(master ? [...pages, master] : pages, async (src) => {
    const a = await assets.importSrc(src);
    if (!a) { missing.push(src); return src; }
    used.add(a.id);
    return assetPath(a);
  });
  const fonts = [];
  for (const f of project.fonts) {
    const a = assets.get(f.asset);
    if (!a) continue;
    used.add(a.id);
    fonts.push({ family: f.family, weight: f.weight, style: f.style, file: assetPath(a), ...(f.label ? { label: f.label } : {}) });
  }
  const json = { format: FORMAT, version: VERSION, app, name: project.name, savedAt: new Date().toISOString(), pages, swatches: swatches ?? project.swatches ?? [], fonts, styles: cleanStyles(project.styles), grid: cleanGrid(project.grid),
    ...(master ? { master } : {}), ...(project.pageStart && project.pageStart !== 1 ? { pageStart: project.pageStart } : {}) };
  return { json, used: [...used], missing };
}

// 이미 압축된 형식은 다시 압축하지 않는다(시간만 듦)
const STORED = new Set(['png', 'jpg', 'webp', 'gif', 'avif', 'woff', 'woff2']);

export async function toZip(project, ctx) {
  const { json, used, missing } = await toJSON(project, ctx);
  const entries = { 'project.json': [strToU8(JSON.stringify(json)), { level: 6 }] };
  for (const id of used) {
    const a = ctx.assets.get(id);
    const ext = extOf(a.type);
    entries[`assets/${id}.${ext}`] = [new Uint8Array(await a.blob.arrayBuffer()), { level: STORED.has(ext) ? 0 : 6 }];
  }
  return { bytes: zipSync(entries), missing, json };
}

// project.json 내용 + 에셋 읽기 함수 → 프로젝트. readAsset(path) → Uint8Array | Blob | null
export async function fromParts(json, readAsset, { assets }) {
  if (!json || json.format !== FORMAT) throw new Error('나비글쓰기 프로젝트 파일이 아닙니다');
  if (json.version > VERSION) throw new Error(`더 새로운 버전(${json.app || json.version})에서 만든 파일이라 열 수 없습니다`);
  const urls = new Map();
  const load = async (path) => {
    if (urls.has(path)) return urls.get(path);
    const m = /^assets\/([0-9a-f]{32})\.([a-z0-9]+)$/.exec(path || '');
    if (!m) return null;
    const data = await readAsset(path);
    if (!data) return null;
    const a = await assets.add(data, { expectId: m[1], type: mimeOfExt(m[2]) });
    urls.set(path, a);
    return a;
  };
  const pages = (Array.isArray(json.pages) ? json.pages : []).map(cleanPage);
  if (!pages.length) pages.push(M.newPage());
  const master = json.master && typeof json.master === 'object' ? { ...cleanPage(json.master), kind: 'master' } : null;
  await mapSrcs(master ? [...pages, master] : pages, async (src) => (await load(src))?.url ?? src);
  const fonts = [];
  for (const f of json.fonts || []) {
    const a = await load(f.file);
    if (!a || !f.family) continue;
    const weight = /^[1-9]00$/.test(String(f.weight)) ? String(f.weight) : '400';
    fonts.push({ family: String(f.family).slice(0, 100), weight, style: f.style === 'italic' ? 'italic' : 'normal', asset: a.id,
      ...(typeof f.label === 'string' && f.label ? { label: f.label.slice(0, 100) } : {}) });
  }
  return { name: String(json.name || '제목 없음'), pages, swatches: Array.isArray(json.swatches) ? json.swatches.filter((c) => typeof c === 'string' && /^#[0-9a-f]{3,8}$/i.test(c)) : null, fonts,
    styles: cleanStyles(json.styles), grid: cleanGrid(json.grid),
    ...(master ? { master } : {}), ...(Number.isFinite(json.pageStart) ? { pageStart: Math.round(json.pageStart) } : {}) };
}

export async function fromZip(bytes, ctx) {
  let files;
  try { files = unzipSync(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)); } catch { throw new Error('프로젝트 파일을 읽을 수 없습니다(zip 형식이 아님)'); }
  if (!files['project.json']) throw new Error('프로젝트 파일에 project.json이 없습니다');
  let json;
  try { json = JSON.parse(strFromU8(files['project.json'])); } catch { throw new Error('project.json을 읽을 수 없습니다'); }
  return fromParts(json, (p) => files[p] || null, ctx);
}

// 불러온 장·요소를 최소한으로 정리(모르는 종류는 빼고, 숫자·배열 형식 보정)
const TYPES = new Set(['text', 'image', 'shape', 'group', 'path', 'pathText']);
const nz = (v, d) => (Number.isFinite(+v) ? +v : d);
// id·이야기 id는 화면 HTML 속성에 들어가므로 영문·숫자·_-만 받는다(파일에 다른 값이 있으면 새 id)
const cleanId = (v) => (typeof v === 'string' && /^[\w-]{1,64}$/.test(v) ? v : M.uid());
export function cleanNode(n) {
  if (!n || typeof n !== 'object' || !TYPES.has(n.type)) return null;
  const c = { ...n, id: cleanId(n.id), x: nz(n.x, 0), y: nz(n.y, 0), w: Math.max(0, nz(n.w, 1)), h: Math.max(0, nz(n.h, 1)), rotation: nz(n.rotation, 0), opacity: nz(n.opacity, 1) };
  if (n.type === 'group') c.children = (Array.isArray(n.children) ? n.children : []).map(cleanNode).filter(Boolean);
  if (n.type === 'text' && n.doc && n.doc.type !== 'doc') c.doc = M.emptyDoc();
  if (n.type === 'text' && n.story != null && (typeof n.story !== 'string' || !/^[\w-]{1,64}$/.test(n.story))) delete c.story;
  if (typeof c.name !== 'string') delete c.name;
  return c;
}
function cleanPage(p) {
  return { id: cleanId(p?.id), name: String(p?.name || ''), w: Math.max(1, Math.round(nz(p?.w, 1080))), h: Math.max(1, Math.round(nz(p?.h, 1080))),
    background: typeof p?.background === 'string' ? p.background : '#ffffff', elements: (Array.isArray(p?.elements) ? p.elements : []).map(cleanNode).filter(Boolean),
    ...(p?.bgImage && typeof p.bgImage.src === 'string' ? { bgImage: { src: p.bgImage.src, fit: ['cover', 'contain', 'fill', 'tile'].includes(p.bgImage.fit) ? p.bgImage.fit : 'cover' } } : {}),
    ...(p?.noMaster ? { noMaster: true } : {}),
    ...(Array.isArray(p?.guides) ? { guides: p.guides.filter((g) => (g?.axis === 'x' || g?.axis === 'y') && Number.isFinite(+g.pos)).map((g) => ({ axis: g.axis, pos: +g.pos })) } : {}) };
}

// 장 복제: 새 id, 글상자 문서는 편집기 상태에서 복사
export function duplicatePage(page, docOf) {
  const s = M.serializePage(page, docOf);
  const ctx = { stories: new Map() };
  return { ...s, id: M.uid(), name: page.name ? `${page.name} 복사본` : '', elements: s.elements.map((n) => M.duplicateNode(n, docOf, ctx)) };
}

// 장 목록 변경(추가·삭제·순서·복제)의 되돌리기 항목. 장 객체는 그대로 두고 배열만 바꾼다.
export class PagesEntry {
  constructor(app, before, after, curBefore, curAfter) { Object.assign(this, { app, before, after, curBefore, curAfter }); }
  undo() { this.app.setPages(this.before, this.curBefore); }
  redo() { this.app.setPages(this.after, this.curAfter); }
}
