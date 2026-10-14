import { buildRegion } from '../src/region.js';
import { loadImages, docText, BASE_STYLE } from '../src/layout.js';
import { verify } from '../src/verify.js';
import { clearMeasureCache, fontOf } from '../src/measure.js';
import { CanvasEditor } from '../src/editor.js';
import { History } from '../src/history.js';
import { exportPages } from '../src/export.js';
import * as platform from '../src/platform.js';
import { fonts } from '../src/fonts.js';
import { createKeymap, lookup } from '../src/keymap.js';
import { makeImages, donutPath, sampleDoc } from './fixtures.js';

const W = 560, H = 560;
const $ = (id) => document.getElementById(id);

const imgs = await makeImages();
const doc = sampleDoc(imgs.block.src);
const assets = await loadImages(doc);

const frames = [
  { id: 'donut', title: '도넛 (SVG 경로, 구멍 포함)',
    source: { kind: 'path', d: donutPath(W, H, 272, 96) }, shapeFill: '#f1ece2' },
  { id: 'alpha', title: '투명 PNG 외곽선 (별 + 구멍)',
    source: { kind: 'alpha', image: imgs.alpha, fit: 'contain' }, imageOpacity: 0.18, smoothable: true },
  { id: 'colorKey', title: '흰 배경 JPG, 배경색 지정 (초승달 + 원)',
    source: { kind: 'colorKey', image: imgs.jpg, fit: 'contain', color: '#ffffff', tolerance: 60 }, imageOpacity: 0.22, smoothable: true },
  { id: 'invert', title: '반전: 도형 바깥에 글 채우기',
    source: { kind: 'alpha', image: imgs.alpha, fit: 'contain', scale: 0.55 }, invert: true, imageOpacity: 1, smoothable: true },
].map((f) => ({ ...f, w: W, h: H, minWidth: 28, paragraphSpacing: 8 }));

const grid = $('grid');
for (const f of frames) {
  grid.insertAdjacentHTML('beforeend',
    `<section class="card"><h2><label><input type="checkbox" class="pick" data-id="${f.id}"> ${f.title}</label></h2><div class="frame" id="f-${f.id}"></div><p class="stat" id="s-${f.id}"></p></section>`);
}

const buildFor = (f) => buildRegion(W, H, f.source, {
  offset: +$('offset').value, smooth: f.smoothable ? +$('smooth').value : 0, invert: !!f.invert,
});

const stat = (ed) => {
  const r = ed.result;
  $('s-' + ed.frame.id).textContent =
    `갱신 ${ed.lastUpdateMs.toFixed(1)}ms · ${r.lines.length}줄 · ${r.overflow === null ? '넘침 없음' : '넘침 @' + r.overflow}`;
};

async function ensureFonts(size) {
  const text = docText(doc);
  const jobs = [];
  for (const w of [400, 700]) for (const it of [false, true])
    jobs.push(document.fonts.load(fontOf({ ...BASE_STYLE, fontSize: size, fontWeight: w, italic: it }), text));
  await Promise.allSettled(jobs);
}

function syncLabels() {
  $('offsetV').textContent = $('offset').value;
  $('smoothV').textContent = $('smooth').value;
  $('sizeV').textContent = $('size').value;
}

await ensureFonts(+$('size').value);
clearMeasureCache();
syncLabels();

const editors = new Map();
const history = new History();
const keymap = createKeymap(); // 사용자 재지정: createKeymap({ 'Mod-Shift-s': 'strike', 'Mod-Shift-x': null })
for (const f of frames) {
  f.style = { fontSize: +$('size').value };
  const ed = new CanvasEditor($('f-' + f.id), { frame: f, built: buildFor(f), doc, assets, onChange: stat, history, keymap, nativePaste: platform.nativePaste });
  const orig = ed.update.bind(ed);
  ed.update = () => { orig(); stat(ed); };
  ed.update();
  editors.set(f.id, ed);
}

$('debug').onchange = () => { for (const ed of editors.values()) ed.setDebug($('debug').checked); };
$('offset').oninput = $('smooth').oninput = () => {
  syncLabels();
  for (const ed of editors.values()) ed.setRegion(buildFor(ed.frame));
};
$('size').oninput = async () => {
  syncLabels();
  await ensureFonts(+$('size').value);
  for (const ed of editors.values()) ed.setFrame({ ...ed.frame, style: { fontSize: +$('size').value } });
};
document.fonts.addEventListener('loadingdone', () => { clearMeasureCache(); for (const ed of editors.values()) ed.update(); });

function verifyAll() {
  const out = {};
  for (const [id, ed] of editors) {
    const r = { ...ed.result, assets };
    out[id] = verify(ed.frameEl, ed.frame, ed.built, r, ed.state.doc.toJSON());
  }
  return out;
}
$('verify').onclick = () => { $('report').textContent = JSON.stringify(verifyAll(), null, 2); };

// 편집기 밖에 포커스가 있을 때도 되돌리기 단축키가 전역 스택에 닿게 한다
document.addEventListener('keydown', (e) => {
  if (e.target.classList?.contains('ce-input')) return; // 편집기가 직접 처리
  const cmd = lookup(keymap, e);
  if (cmd === 'undo' || cmd === 'redo') { e.preventDefault(); history[cmd](); }
});
const syncHistoryButtons = () => {
  $('undo').disabled = !history.canUndo; $('redo').disabled = !history.canRedo;
  platform.setMenuState({ undo: history.canUndo, redo: history.canRedo }); // Electron 편집 메뉴
};
history.onChange(syncHistoryButtons);
syncHistoryButtons();
// mousedown 기본 동작을 막아 편집기 포커스(와 조합 상태)를 빼앗지 않는다
for (const id of ['undo', 'redo']) {
  $(id).addEventListener('mousedown', (e) => e.preventDefault());
  $(id).addEventListener('click', () => history[id]());
}

// ---------- 출력 ----------
// 데모에서는 프레임 하나를 '장' 하나로 본다. 현재 장 = 마지막으로 편집한 프레임.
const PROJECT = '레이아웃 데모';
let current = frames[0].id;
for (const ed of editors.values()) ed.input.addEventListener('focus', () => { current = ed.frame.id; });
const pages = () => [...editors.values()].map((ed) => ed.exportPage());
function rangeIndices() {
  const ids = [...editors.keys()];
  const r = $('exRange').value;
  if (r === 'current') return [ids.indexOf(current)];
  if (r === 'selected') return ids.map((id, i) => (document.querySelector(`.pick[data-id="${id}"]`).checked ? i : -1)).filter((i) => i >= 0);
  return ids.map((_, i) => i);
}
$('exRun').onclick = async () => {
  const indices = rangeIndices();
  if (!indices.length) { $('exStatus').textContent = '선택한 장이 없습니다'; return; }
  const format = $('exFormat').value;
  const t0 = performance.now();
  $('exStatus').textContent = '만드는 중…';
  try {
    if (format === 'vector') {
      const all = pages();
      const r = await platform.saveVectorPDF(indices.map((i) => all[i]), { project: PROJECT });
      $('exStatus').textContent = r.mode === 'print-dialog' ? '인쇄 대화상자에서 "PDF로 저장"을 선택하십시오'
        : r.mode === 'cancelled' ? '취소함' : `저장함 · ${r.paths[0]}`;
      return;
    }
    const files = await exportPages(pages(), { project: PROJECT, format, indices, scale: +$('exScale').value, transparent: $('exTransparent').checked });
    const r = await platform.saveFiles(files, { project: PROJECT });
    $('exStatus').textContent = r.mode === 'cancelled' ? '취소함'
      : `${r.mode} · ${r.count}개 · ${(performance.now() - t0).toFixed(0)}ms${r.dir ? ' · ' + r.dir : r.paths ? ' · ' + r.paths[0] : ''}`;
  } catch (err) {
    console.error(err);
    $('exStatus').textContent = '실패: ' + err.message;
  }
};

// ---------- Electron 메뉴 명령 · 시스템 글꼴 ----------
// 포커스가 편집기 입력창에 있으면 그 편집기, 아니면 null
const activeEditor = () => [...editors.values()].find((ed) => ed.input === document.activeElement) ?? null;
platform.onMenu((cmd) => {
  const ed = activeEditor();
  if (cmd === 'undo' || cmd === 'redo') history[cmd]();         // 조합 중이면 History가 먼저 확정한다(beforeApply)
  else if (cmd === 'selectAll') ed?.run('selectAll');
  else if (cmd === 'pastePlain' && ed) { ed.plainPaste = true; platform.nativePaste(); }
  else if (cmd === 'export') $('exRun').click();
});

// 시스템 글꼴(Local Font Access API): 목록을 불러와 고르면 현재 장의 선택 범위에 글꼴 꾸밈을 적용
$('sysFonts').onclick = async () => {
  try {
    const list = await platform.listSystemFonts();
    if (!list) { $('sysFontStatus').textContent = '이 환경에는 시스템 글꼴 API가 없습니다'; return; }
    $('sysFontPick').innerHTML = '<option value="">글꼴 선택</option>' +
      list.map((g) => `<option>${g.family.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`)}</option>`).join('');
    $('sysFontStatus').textContent = list.length ? `${list.length}개 글꼴` : '0개 (권한이 거부되었거나 글꼴을 읽을 수 없음)';
  } catch (err) { $('sysFontStatus').textContent = '실패: ' + err.name; }
};
$('sysFontPick').onchange = () => {
  const fam = $('sysFontPick').value;
  if (!fam) return;
  const ed = editors.get(current);
  ed.setMark('font', { value: `"${fam.replace(/["\\]/g, '')}"` });
  ed.focus();
};

window.__app = { ready: true, editors, verifyAll, frames, history, keymap, fonts, pages, platform };
