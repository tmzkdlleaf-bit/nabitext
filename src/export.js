// 출력: 장(page) → PNG/JPG/WebP, 래스터 PDF(pdf-lib), 벡터 PDF(인쇄 CSS).
//
// 장은 { w, h, render(): Element } 모양이면 된다(편집기의 exportPage() 참고).
// render()는 커서·선택·조합 미리보기·디버그 표시가 없는 새 DOM을 만든다.
//
// 래스터화 원리: 장 DOM을 SVG <foreignObject> 안에 넣어 이미지로 불러온 뒤 캔버스에 그린다.
// 화면과 같은 브라우저 렌더러가 그리므로 CSS 꾸밈이 그대로 나온다. 조건은 SVG 이미지가 외부 자원을
// 불러오지 못한다는 것 → 이미지와 글꼴을 모두 data URL로 넣는다.

import { PDFDocument } from 'pdf-lib';
import { zipSync } from 'fflate';
import { fonts as defaultFonts, parseFamilies } from './fonts.js';

// Chrome 캔버스 한계(가로·세로 32767px, 넓이 268,435,456px)
const MAX_SIDE = 32767, MAX_AREA = 268435456;

const blobToDataURL = (blob) => new Promise((resolve, reject) => {
  const r = new FileReader();
  r.onload = () => resolve(r.result);
  r.onerror = () => reject(r.error);
  r.readAsDataURL(blob);
});

const urlCache = new Map();
async function toDataURL(url) {
  if (url.startsWith('data:')) return url;
  let p = urlCache.get(url);
  if (!p) {
    p = fetch(url).then((r) => { if (!r.ok) throw new Error(`${r.status} ${url}`); return r.blob(); }).then(blobToDataURL);
    p.catch(() => urlCache.delete(url)); // 실패한 것은 다음에 다시 시도
    if (urlCache.size >= 64) urlCache.delete(urlCache.keys().next().value); // 큰 data URL이 쌓이지 않게
    urlCache.set(url, p);
  }
  return p;
}

// 이미지 src, SVG image href, style 속성 안 url(...)을 data URL로 바꾼다(제자리 수정)
async function inlineResources(root) {
  const jobs = [];
  for (const img of root.querySelectorAll('img[src]')) {
    jobs.push(toDataURL(img.src).then((d) => { img.setAttribute('src', d); img.removeAttribute('srcset'); }));
  }
  for (const im of root.querySelectorAll('image')) {
    const h = im.getAttribute('href') || im.getAttribute('xlink:href');
    if (h) jobs.push(toDataURL(new URL(h, location.href).href).then((d) => im.setAttribute('href', d)));
  }
  for (const el of [root, ...root.querySelectorAll('[style*="url("]')]) {
    const st = el.getAttribute('style');
    if (!st || !st.includes('url(')) continue;
    const urls = [...st.matchAll(/url\(\s*["']?([^"')]+)["']?\s*\)/g)].map((m) => m[1]).filter((u) => !u.startsWith('data:'));
    if (!urls.length) continue;
    jobs.push(Promise.all(urls.map((u) => toDataURL(new URL(u, location.href).href))).then((ds) => {
      let s = el.getAttribute('style');
      urls.forEach((u, i) => { s = s.split(u).join(ds[i]); });
      el.setAttribute('style', s);
    }));
  }
  await Promise.all(jobs);
}

// 쓰인 글꼴 이름과 글자 모으기(unicode-range 조각 선택용)
function collectFonts(root) {
  const families = new Set();
  let text = '';
  for (const el of [root, ...root.querySelectorAll('*')]) {
    const ff = el.style?.fontFamily;
    if (ff) for (const f of parseFamilies(ff)) families.add(f);
    if (el.childNodes) for (const n of el.childNodes) if (n.nodeType === 3) text += n.data;
  }
  return { families, text };
}

// 장 DOM → 출력용 DOM(자원 넣기 완료) + 글꼴 CSS
async function preparePage(page, { transparent = false, fontRegistry = defaultFonts, embedFonts = true } = {}) {
  const el = page.render();
  el.style.position = 'relative';
  el.style.margin = '0';
  if (transparent) el.style.backgroundColor = 'transparent'; // 배경 이미지는 남김(장 배경색만 뺌)
  await inlineResources(el);
  const { families, text } = collectFonts(el);
  const fontCSS = embedFonts ? await fontRegistry.cssFor(families, text) : '';
  return { el, fontCSS };
}

const XHTML = 'http://www.w3.org/1999/xhtml';

// 배율은 viewBox로 준다(CSS zoom도 시험했으나 배치 반올림이 달라져 화면과의 차이가 더 컸음).
function pageSVG(el, w, h, scale, fontCSS) {
  const wrap = document.createElementNS(XHTML, 'div');
  wrap.setAttribute('xmlns', XHTML);
  wrap.style.cssText = `width:${w}px;height:${h}px;margin:0;padding:0;overflow:hidden;`;
  // 문서 언어(lang="ko")를 같이 넘긴다. 없으면 이미지 안에서는 언어가 비어 한글 글꼴·글리프 선택이 화면과 달라질 수 있다(경로 글자에서 확인)
  wrap.setAttribute('lang', document.documentElement.lang || 'ko');
  wrap.appendChild(el);
  const body = new XMLSerializer().serializeToString(wrap);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${Math.round(w * scale)}" height="${Math.round(h * scale)}" viewBox="0 0 ${w} ${h}">` +
    `<defs>${fontCSS ? `<style><![CDATA[${fontCSS}]]></style>` : ''}</defs>` +
    `<foreignObject x="0" y="0" width="${w}" height="${h}">${body}</foreignObject></svg>`;
}

// 장 하나 → 캔버스. background: 투명이 아닐 때 밑에 깔 색(JPG용)
// abort: 미리보기처럼 미뤄도 되는 그리기에서, 무거운 단계 직전마다 물어 true면 그만둔다(null 반환)
// gate: 무거운 단계(SVG 만들기·읽기) 직전에 기다렸다가 false면 그만둔다(null 반환). 미리보기는 여기서 한가한 틈을 기다려 작업을 쪼갠다
export async function rasterize(page, { scale = 1, transparent = false, matte = null, fontRegistry, embedFonts, abort = null, gate = null } = {}) {
  const W = Math.round(page.w * scale), H = Math.round(page.h * scale);
  if (W > MAX_SIDE || H > MAX_SIDE || W * H > MAX_AREA)
    throw new Error(`출력 크기 ${W}×${H}px가 브라우저 캔버스 한계를 넘습니다. 배율을 낮춰 주십시오.`);
  const { el, fontCSS } = await preparePage(page, { transparent, fontRegistry, embedFonts });
  if (abort?.()) return null;
  if (gate && !(await gate())) return null;
  const svg = pageSVG(el, page.w, page.h, scale, fontCSS);
  // blob: 주소로 불러온 foreignObject SVG는 Chrome이 캔버스를 오염시켜(toBlob 불가) data URL로 불러온다
  const img = new Image();
  img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
  await img.decode();
  if (abort?.()) return null;
  const cv = document.createElement('canvas');
  cv.width = W;
  cv.height = H;
  const ctx = cv.getContext('2d');
  if (matte) { ctx.fillStyle = matte; ctx.fillRect(0, 0, W, H); }
  ctx.drawImage(img, 0, 0, W, H);
  return cv;
}

const MIMES = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp' };

export function encode(canvas, format = 'png', quality = 0.92) {
  const type = MIMES[format];
  if (!type) throw new Error('지원하지 않는 형식: ' + format);
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('인코딩 실패'))), type, quality));
}

// 이미지 하나로 내보내기. JPG는 투명을 지원하지 않으므로 흰 바탕을 깐다.
export async function exportImage(page, { format = 'png', scale = 1, transparent = false, quality = 0.92, ...rest } = {}) {
  const jpg = format === 'jpg' || format === 'jpeg';
  const cv = await rasterize(page, { scale, transparent: transparent && !jpg, matte: jpg ? '#ffffff' : null, ...rest });
  return encode(cv, format, quality);
}

// 래스터 PDF: 장마다 이미지 한 장. 페이지 크기는 CSS px 기준(1px = 1/96in = 0.75pt), 해상도 = 96 × 배율 dpi.
// imageFormat: 'png'(무손실, 기본) | 'jpg'(용량 작음)
export async function exportRasterPDF(pages, { scale = 2, imageFormat = 'png', quality = 0.92, title, ...rest } = {}) {
  const pdf = await PDFDocument.create();
  if (title) pdf.setTitle(title);
  pdf.setCreator('layout-engine');
  for (const page of pages) {
    const jpg = imageFormat === 'jpg';
    const cv = await rasterize(page, { scale, matte: jpg ? '#ffffff' : null, ...rest });
    const bytes = new Uint8Array(await (await encode(cv, jpg ? 'jpg' : 'png', quality)).arrayBuffer());
    const image = jpg ? await pdf.embedJpg(bytes) : await pdf.embedPng(bytes);
    const pw = page.w * 0.75, ph = page.h * 0.75;
    const p = pdf.addPage([pw, ph]);
    p.drawImage(image, { x: 0, y: 0, width: pw, height: ph });
  }
  return new Blob([await pdf.save()], { type: 'application/pdf' });
}

// 벡터 PDF용 인쇄 문서(HTML 문자열). 글자는 글자로, 도형은 벡터로 인쇄된다.
// 장마다 크기가 다를 수 있어 이름 붙은 @page를 장마다 하나씩 만든다.
// 웹판: printVector()가 숨긴 iframe에서 인쇄 대화상자를 연다(사용자가 'PDF로 저장' 선택).
// Electron: 이 HTML을 불러와 webContents.printToPDF({ preferCSSPageSize: true })로 바로 저장(5단계).
export async function buildPrintHTML(pages, { title = '', ...rest } = {}) {
  let css = '', body = '';
  const faces = new Set();
  for (let i = 0; i < pages.length; i++) {
    const pg = pages[i];
    const { el, fontCSS } = await preparePage(pg, rest);
    if (fontCSS) faces.add(fontCSS);
    css += `@page p${i}{size:${pg.w}px ${pg.h}px;margin:0}.p${i}{page:p${i};width:${pg.w}px;height:${pg.h}px}\n`;
    body += `<div class="page p${i}">${el.outerHTML}</div>\n`;
  }
  const esc = (t) => t.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]);
  return `<!doctype html><html lang="${esc(document.documentElement.lang || 'ko')}"><head><meta charset="utf-8"><title>${esc(title)}</title><style>
${[...faces].join('\n')}
html,body{margin:0;padding:0}
*{-webkit-print-color-adjust:exact;print-color-adjust:exact}
.page{position:relative;overflow:hidden;break-after:page}
.page:last-child{break-after:auto}
${css}</style></head><body>
${body}</body></html>`;
}

export async function printVector(pages, opts = {}) {
  const html = await buildPrintHTML(pages, opts);
  const frame = document.createElement('iframe');
  frame.style.cssText = 'position:fixed;width:0;height:0;border:0;left:-10000px';
  document.body.appendChild(frame);
  await new Promise((res) => { frame.onload = res; frame.srcdoc = html; });
  const d = frame.contentDocument;
  await d.fonts.ready;
  await Promise.all([...d.images].map((im) => im.decode().catch(() => {})));
  frame.contentWindow.print();
  setTimeout(() => frame.remove(), 1000);
  return html;
}

// ---------- 파일 이름과 저장 ----------

// {프로젝트명}_{장번호}.{확장자}. 장 수가 10장 이상이면 자릿수를 맞춘다(01, 02 …) — 파일 목록 정렬용
export function fileName(project, index, total, ext) {
  const safe = safeProject(project);
  const n = String(index + 1).padStart(String(total).length, '0');
  return `${safe}_${n}.${ext}`;
}

const safeProject = (project) => (project || '제목 없음').replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').trim() || '제목 없음';
// PDF 한 파일의 이름: {프로젝트명}.pdf
export const pdfName = (project) => `${safeProject(project)}.pdf`;

// 여러 파일 저장(웹판). 폴더 선택(File System Access API) → 없으면 파일 하나는 그대로, 여러 개는 zip으로 내려받기.
// Electron판은 platform.js의 saveFiles가 네이티브 대화상자로 처리한다.
export async function saveFiles(files, { project = '제목 없음', preferDirectory = true } = {}) {
  if (preferDirectory && files.length > 1 && window.showDirectoryPicker) {
    try {
      const dir = await window.showDirectoryPicker({ mode: 'readwrite' });
      for (const f of files) {
        const h = await dir.getFileHandle(f.name, { create: true });
        const w = await h.createWritable();
        await w.write(f.blob);
        await w.close();
      }
      return { mode: 'directory', count: files.length };
    } catch (err) {
      if (err.name === 'AbortError') return { mode: 'cancelled' };
      console.warn('폴더 저장 실패, 내려받기로 전환', err);
    }
  }
  if (files.length === 1) {
    download(files[0].blob, files[0].name);
    return { mode: 'download', count: 1 };
  }
  const entries = {};
  for (const f of files) entries[f.name] = [new Uint8Array(await f.blob.arrayBuffer()), { level: 0 }]; // 이미 압축된 형식이라 저장만
  const zip = new Blob([zipSync(entries)], { type: 'application/zip' });
  const name = `${safeProject(project)}.zip`;
  download(zip, name);
  return { mode: 'zip', count: files.length, zip };
}

export function download(blob, name) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 10000);
}

// 여러 장을 한 번에: format png|jpg|webp → 파일 목록, pdf → 파일 하나
export async function exportPages(pages, { project = '제목 없음', format = 'png', indices, ...opts } = {}) {
  const idx = indices ?? pages.map((_, i) => i);
  const sel = idx.map((i) => pages[i]);
  if (format === 'pdf') {
    const blob = await exportRasterPDF(sel, { title: project, ...opts });
    return [{ name: pdfName(project), blob }];
  }
  const ext = format === 'jpeg' ? 'jpg' : format;
  const out = [];
  for (let k = 0; k < sel.length; k++) {
    out.push({ name: fileName(project, idx[k], pages.length, ext), blob: await exportImage(sel[k], { format, ...opts }) });
  }
  return out;
}
