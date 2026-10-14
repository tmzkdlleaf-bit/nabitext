// 템플릿: 장 하나를 틀로 저장해 두고, 새 장을 그 틀로 만든다.
//   저장 위치: 이 컴퓨터의 템플릿 보관함(IndexedDB 'nabitext-templates'). 프로젝트 파일과 따로다.
//   형식: 프로젝트 파일과 같은 zip(project.json + assets/). 장 한 개 + 그 장이 쓰는 스타일 프리셋·업로드 글꼴
//   파일로 주고받기: 확장자 .nabitpl(내용은 .nabi와 같은 형식이라 프로젝트로 열어도 된다)
//   슬롯: 요소의 slot 속성(true). 템플릿으로 만든 장에서 바꿔 넣을 자리임을 표시한다
//     - 이미지 슬롯: "이미지 바꾸기…" 또는 이미지 파일을 끌어다 놓으면 같은 상자에 채워 넣는다(맞춤 = 채우기)
//     - 글 슬롯: 글상자를 편집해 글만 바꾼다(글자 모양은 그대로)

import * as M from './model.js';
import * as P from './project.js';
import { AssetStore } from './assets.js';
import { openDB, req } from './idb.js';

export const TEMPLATE_EXT = 'nabitpl';
const STORE = 'templates';
const db = () => openDB('nabitext-templates', 1, (d) => d.createObjectStore(STORE, { keyPath: 'id' }));

// 보관함: { id, name, w, h, thumb(data URL), savedAt, bytes(Uint8Array zip) }
export async function listTemplates() {
  const d = await db();
  const all = await req(d.transaction(STORE).objectStore(STORE).getAll());
  return all.sort((a, b) => (b.savedAt || '').localeCompare(a.savedAt || ''));
}
export async function getTemplate(id) { const d = await db(); return req(d.transaction(STORE).objectStore(STORE).get(id)); }
export async function putTemplate(rec) { const d = await db(); await req(d.transaction(STORE, 'readwrite').objectStore(STORE).put(rec)); return rec; }
export async function deleteTemplate(id) { const d = await db(); await req(d.transaction(STORE, 'readwrite').objectStore(STORE).delete(id)); }

// 장 → 템플릿 zip. 장이 쓰는 스타일 프리셋과 업로드 글꼴만 담는다.
export async function pageToZip(page, { name, project, assets, docOf }) {
  const s = M.serializePage(page, docOf);
  const text = JSON.stringify(s);
  const styles = {};
  const uses = (id) => text.includes(`"preset":"${id}"`) || text.includes(`"type":"charStyle","attrs":{"id":"${id}"}`);
  for (const [id, p] of Object.entries(project.styles || {})) if (uses(id)) styles[id] = p;
  const families = new Set();
  for (const p of Object.values(styles)) if (p.style?.fontFamily) families.add(p.style.fontFamily);
  const fonts = (project.fonts || []).filter((f) => text.includes(f.family) || [...families].some((x) => x.includes(f.family)));
  const tpl = { name, pages: [s], styles, fonts, grid: project.grid };
  const { bytes } = await P.toZip(tpl, { assets, docOf: null, swatches: [] });
  return bytes;
}

// 템플릿 zip → 새 장(모든 id 새로). 에셋은 assets(프로젝트 저장소)로 옮기고, 프리셋 id가 겹치면 새 id로 바꾼다.
// 반환: { page, styles(프로젝트에 더할 프리셋), fonts([{ family, weight, style, asset, blob }]) }
export async function zipToPage(bytes, { assets, projectStyles = {} }) {
  const temp = new AssetStore({ proxies: false });
  const tpl = await P.fromZip(bytes, { assets: temp });
  const moved = new Map();
  for (const a of temp.byId.values()) { const b = await assets.add(a.blob, { type: a.type }); moved.set(a.url, b); }
  temp.clear();
  let src = tpl.pages[0];
  // 프리셋: 같은 id에 내용도 같으면 그대로, 내용이 다르면 새 id
  const styles = {};
  let json = JSON.stringify(src);
  for (const [id, p] of Object.entries(tpl.styles || {})) {
    const have = projectStyles[id];
    if (have && JSON.stringify(have) === JSON.stringify(p)) continue;
    const nid = have ? M.uid() : id;
    if (nid !== id) json = json.split(`"preset":"${id}"`).join(`"preset":"${nid}"`).split(`"type":"charStyle","attrs":{"id":"${id}"}`).join(`"type":"charStyle","attrs":{"id":"${nid}"}`);
    styles[nid] = p;
  }
  // 에셋 주소: 임시 저장소 blob: → 프로젝트 저장소 blob:
  for (const [from, a] of moved) json = json.split(JSON.stringify(from).slice(1, -1)).join(a.url);
  src = JSON.parse(json);
  const page = P.duplicatePage(src, null);
  delete page.id; page.id = M.uid();
  page.name = '';
  const fonts = (tpl.fonts || []).map((f) => { const a = [...moved.values()].find((x) => x.id === f.asset); return a ? { ...f, asset: a.id, blob: a.blob } : null; }).filter(Boolean);
  return { page, styles, fonts, name: tpl.name };
}

// 슬롯 목록(장 안 순서)
export function slotsOf(page) {
  const out = [];
  M.walk(page.elements, (n) => { if (n.slot && (n.type === 'image' || n.type === 'text')) out.push(n); });
  return out;
}
