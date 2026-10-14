"""12단계 검증: 큰 사진 축소본, 공통 장·쪽 번호, 찾기·바꾸기, 장 목록 미리보기, 가벼운 되돌리기 기록, 자동 업데이트 설정.
사용: python3 test/stage12.py  (proto 폴더 기준)
입력은 CDP로 실제 마우스·키 이벤트를 보낸다(Playwright mouse/keyboard). 한글 조합은 Input.imeSetComposition.
"""
import json, os, io, math, time, base64, tempfile, threading, functools
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from playwright.sync_api import sync_playwright
from PIL import Image
import numpy as np

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'test', 'out'); os.makedirs(OUT, exist_ok=True)
TMP = tempfile.mkdtemp()
class Quiet(SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
srv = ThreadingHTTPServer(('127.0.0.1', 0), functools.partial(Quiet, directory=ROOT))
threading.Thread(target=srv.serve_forever, daemon=True).start()
ORIGIN = f'http://127.0.0.1:{srv.server_port}'

results, metrics = [], {}
def check(name, ok, detail=''):
    results.append((name, bool(ok), detail))
    if os.environ.get('V'): print(('ok ' if ok else 'XX ') + name[:60] + ('' if ok else '  ' + json.dumps(detail, ensure_ascii=False, default=str)[:700]), flush=True)
close = lambda a, b, eps=0.01: a is not None and b is not None and abs(a - b) <= eps

def compare(a, b):
    A = np.asarray(a.convert('RGB')).astype(int); B = np.asarray(b.convert('RGB')).astype(int)
    if A.shape != B.shape: return {'shape': [A.shape, B.shape]}
    d = np.abs(A - B).max(axis=2)
    nb = None
    for dy in (-1, 0, 1):
        for dx in (-1, 0, 1):
            e = np.abs(A - np.roll(np.roll(B, dy, 0), dx, 1)).max(axis=2)
            nb = e if nb is None else np.minimum(nb, e)
    nb = nb[1:-1, 1:-1]
    pct = lambda m: round(float(m.mean()) * 100, 4)
    return {'max': int(d.max()), 'mean': round(float(d.mean()), 3), 'pct16': pct(d > 16), 'nb_pct64': pct(nb > 64)}
same_as_screen = lambda m: m.get('nb_pct64', 1) < 0.05 and m.get('pct16', 100) < 0.3
img = lambda u: Image.open(io.BytesIO(base64.b64decode(u.split(',', 1)[1])))

HELPERS = r"""
(async () => {
  window.__G = await import('/app/geom.js');
  window.__EX = await import('/src/export.js');
  window.__VF = await import('/src/verify.js');
  window.__TPL = await import('/app/templates.js');
  const N = __nabi, V = N.view, M = N.M;
  window.__evs = [];
  for (const t of ['mousedown', 'mouseup']) window.addEventListener(t, (e) => __evs.push({ t, x: e.clientX, y: e.clientY }), true);
  const canvasBlob = async (w, h, draw) => { const c = new OffscreenCanvas(w, h); draw(c.getContext('2d'), w, h); return c.convertToBlob({ type: 'image/png' }); };
  window.T = {
    N, V, M,
    reset: (w = 900, h = 700) => { N.app.project.pages = [M.newPage({ w, h })]; N.app.current = null; N.app.switchPage(N.app.project.pages[0]); N.history.clear(); N.flush(); V.setView(1, 30, 30); },
    add: (type, props) => { const n = M.makeElement(type, props); V.change('create', () => { V.page.elements.push(n); }); return n.id; },
    el: (id) => { const n = V.node(id); return n && JSON.parse(JSON.stringify(n, (k, v) => (k === 'doc' ? undefined : v))); },
    ids: () => V.page.elements.map((n) => n.id),
    C: (x, y) => V.pageToClient({ x, y }),
    L: (id, x, y) => V.pageToClient(__G.fromLocal(V.node(id), { x, y })),
    P: (e) => V.clientToPage(e.x, e.y),
    lastDown: () => [...__evs].reverse().find((e) => e.t === 'mousedown'),
    field: (label) => { N.flush(); const f = document.querySelector(`#props [data-field="${label}"]`); f?.scrollIntoView({ block: 'center' }); if (!f) return null; const b = f.getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2, value: f.value }; },
    setSel: (label, value) => { N.flush(); const s = document.querySelector(`#props [data-field="${label}"]`); s.value = value; s.dispatchEvent(new Event('change')); },
    btn: (label) => { N.flush(); const b = document.querySelector(`#props button[data-field="${label}"]`); if (!b) return false; b.click(); return true; },
    hasBtn: (label) => { N.flush(); return !!document.querySelector(`#props button[data-field="${label}"]`); },
    ed: (id) => V.editorOf(V.node(id)),
    text: (id) => V.editorOf(V.node(id)).text,
    // 이야기의 글상자별로 배치된 글(공백 빼고)
    placed: (id) => T.ed(id).results.map((r) => r.lines.flatMap((l) => l.pieces.map((p) => p.text)).join('').replace(/\s+/g, '')),
    // 글상자별 검증(영역 밖 픽셀·구간 초과)
    verifyChain: (id) => { const ed = T.ed(id); return ed.views().map((v, k) => { const r = __VF.verify(v.frameEl, v.frame, v.built, { ...ed.results[k], assets: ed.assets }, ed.state.doc.toJSON()); return { lines: r.lines, outside: r.pixelsOutsideMask, overrun: r.intervalOverruns, dx: r.maxXErrPx, dy: r.maxYErrPx }; }); },
    port: (id) => { const g = V.overlay.querySelector(`[data-port="${id}"] rect`); if (!g) return null; const b = g.getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2 }; },
    raster: async () => (await __EX.rasterize(V.exportPage(), { scale: 1 })).toDataURL(),
    longDoc: (t) => ({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: t }] }] }),
    paras: (ts) => ({ type: 'doc', content: ts.map((t) => ({ type: 'paragraph', content: [{ type: 'text', text: t }] })) }),
    snap: async () => { const r = await N.P.toJSON(N.app.project, { assets: N.assets, docOf: V.docOf, swatches: N.swatches.list }); delete r.json.savedAt; delete r.json.name; return JSON.stringify(r.json); },
    photo: async (w, h, c1 = '#f60', c2 = '#06f') => { const b = await canvasBlob(w, h, (x, W, H) => { const g = x.createLinearGradient(0, 0, W, H); g.addColorStop(0, c1); g.addColorStop(1, c2); x.fillStyle = g; x.fillRect(0, 0, W, H); }); const a = await N.assets.add(b); return { src: a.url, w, h, blob: b }; },
    cur: () => N.app.project.pages.indexOf(N.app.current),
    pageIds: () => N.app.project.pages.map((p) => p.id),
    rowPt: (id) => { N.flush(); const r = document.querySelector(`#pagesList .pg-row[data-id="${id}"]`).getBoundingClientRect(); return { x: r.left + 40, y: r.top + r.height / 2 }; },
    sed: (sid) => V.editors.get(sid),
    stext: (sid) => V.editors.get(sid).text,
    splaced: (sid) => V.editors.get(sid).results.map((r) => r.lines.flatMap((l) => l.pieces.map((p) => p.text)).join('').replace(/\s+/g, '')),
    overText: () => [...V.overlay.querySelectorAll('text')].map((t) => t.textContent),
    fontSizes: (id) => [...new Set(T.ed(id).results.flatMap((r) => r.lines.flatMap((l) => l.pieces.map((p) => Math.round(p.style.fontSize * 1000) / 1000))))],
  };
  return true;
})()
"""
LONG = '이어지는 글상자 시험 문장입니다. 첫 글상자에 다 들어가지 못한 글은 다음 글상자로 흘러가야 하고, 글자가 빠지거나 겹치면 안 됩니다. Linked frames flow test. ' * 3


LONG2 = LONG * 3
with sync_playwright() as p:
    b = p.chromium.launch(args=['--disable-lcd-text'])
    ctx = b.new_context(viewport={'width': 1600, 'height': 1000}, accept_downloads=True)
    errors = []
    def open_page():
        pg = ctx.new_page()
        pg.route('**/fonts.googleapis.com/**', lambda r: r.abort())
        pg.on('pageerror', lambda e: errors.append(str(e)))
        pg.on('console', lambda m: m.type == 'error' and 'ERR_FAILED' not in m.text and errors.append(m.text))
        pg.goto(ORIGIN + '/index.html')
        pg.wait_for_function('window.__nabi && window.__nabi.ready', timeout=30000)
        time.sleep(0.3)
        if pg.evaluate("!!document.querySelector('.modal-bg')"): pg.click('.modal-bg [data-v=discard]')
        pg.evaluate(HELPERS)
        return pg
    pg = open_page()
    E = lambda js, arg=None: pg.evaluate(js, arg) if arg is not None else pg.evaluate(js)
    mouse, kb = pg.mouse, pg.keyboard
    cdp = ctx.new_cdp_session(pg)
    def click(pt, count=1): mouse.click(pt['x'], pt['y'], click_count=count)
    def drag(a, c, steps=10, mods=()):
        for m in mods: kb.down(m)
        mouse.move(a['x'], a['y']); mouse.down(); mouse.move(c['x'], c['y'], steps=steps); mouse.up()
        for m in reversed(mods): kb.up(m)
    def screen_vs_export(tag, page_js='T.V.exportPage()'):
        E("T.V.select([]); T.V.setView(1, 30, 30); T.V.overlay.style.visibility = 'hidden'")
        mouse.move(5, 995); time.sleep(0.25)
        rr = E("(() => { const r = T.V.pageEl.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; })()")
        scr = Image.open(io.BytesIO(pg.screenshot(clip={'x': rr['x'], 'y': rr['y'], 'width': rr['w'], 'height': rr['h']})))
        E("T.V.overlay.style.visibility = ''")
        out = img(E(f"(async () => (await __EX.rasterize({page_js}, {{ scale: 1 }})).toDataURL())()"))
        m = compare(scr, out)
        metrics[f'export/{tag}'] = m
        scr.save(os.path.join(OUT, f'stage12-{tag}-screen.png')); out.save(os.path.join(OUT, f'stage12-{tag}-export.png'))
        return m

    # ============ A. 큰 사진 축소본 ============
    E("T.reset(900, 700)")
    big = E("""(async () => { const b = await (async () => { const c = new OffscreenCanvas(4000, 3000); const x = c.getContext('2d'); const g = x.createLinearGradient(0, 0, 4000, 3000); g.addColorStop(0, '#f60'); g.addColorStop(1, '#06f'); x.fillStyle = g; x.fillRect(0, 0, 4000, 3000); x.fillStyle = '#fff'; x.fillRect(1900, 1400, 200, 200); return c.convertToBlob({ type: 'image/png' }); })();
      const t0 = performance.now(); const n = await T.V.addImage(b); const ms = performance.now() - t0;
      const a = T.N.assets.ofUrl(n.src); T.N.flush();
      const scr = T.V.nodes.get(n.id).querySelector('img').getAttribute('src');
      const ex = T.V.exportPage().render().querySelector('img').getAttribute('src');
      return { id: n.id, w: n.w, h: n.h, proxy: a.proxy && [a.proxy.w, a.proxy.h], dims: [a.w, a.h], scrIsProxy: scr === a.proxy?.url, exIsOrig: ex === a.url, ms }; })()""")
    check('A1 4000×3000 사진 넣기 → 화면은 2560×1920 축소본, 출력 DOM은 원본, 요소 비율 4:3(원본 크기 기준)',
          big['proxy'] == [2560, 1920] and big['dims'] == [4000, 3000] and big['scrIsProxy'] and big['exIsOrig'] and close(big['w'] / big['h'], 4 / 3, 0.001), big)
    small = E("""(async () => { const p = await T.photo(800, 600); const n = await T.V.addImage(p.blob); const a = T.N.assets.ofUrl(n.src); T.N.flush();
      return { proxy: a.proxy, src: T.V.nodes.get(n.id).querySelector('img').getAttribute('src') === a.url }; })()""")
    check('A2 800×600 사진 → 축소본 없음, 화면도 원본', small['proxy'] is None and small['src'], small)
    # EXIF 방향(6 = 90° 회전) JPEG: 가로 3000×2000으로 저장되어 있지만 세로로 보여야 함
    from PIL import Image as PImage
    im = PImage.new('RGB', (3000, 2000), (200, 80, 40))
    ex_ = im.getexif(); ex_[0x0112] = 6
    buf = io.BytesIO(); im.save(buf, 'JPEG', exif=ex_.tobytes(), quality=80)
    rot = E("""(async (b64) => { const u8 = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)); const n = await T.V.addImage(new Blob([u8], { type: 'image/jpeg' }));
      const a = T.N.assets.ofUrl(n.src); const im = new Image(); im.src = a.url; await im.decode();
      return { w: n.w, h: n.h, nat: [im.naturalWidth, im.naturalHeight], proxy: a.proxy && [a.proxy.w, a.proxy.h] }; })""", base64.b64encode(buf.getvalue()).decode())
    check('A3 EXIF 방향 6인 3000×2000 JPEG → 세로(2000×3000 비율)로 들어가고 축소본도 세로(1707×2560)', rot['nat'] == [2000, 3000] and rot['proxy'] == [1707, 2560] and close(rot['w'] / rot['h'], 2 / 3, 0.001), rot)
    # 출력 = 화면(축소본과 원본 차이는 화면 크기에서 보이지 않아야)
    E("T.reset(900, 700)")
    E("""(async () => { const c = new OffscreenCanvas(4000, 3000); const x = c.getContext('2d'); const g = x.createLinearGradient(0, 0, 4000, 3000); g.addColorStop(0, '#f60'); g.addColorStop(1, '#06f'); x.fillStyle = g; x.fillRect(0, 0, 4000, 3000); x.fillStyle = '#fff'; x.fillRect(1900, 1400, 200, 200);
      const n = await T.V.addImage(await c.convertToBlob({ type: 'image/png' })); T.V.setProps({ x: 50, y: 50, w: 800, h: 600 }, [n.id]); })()""")
    time.sleep(0.4)
    m = screen_vs_export('proxy')
    check(f'A4 큰 사진 장 출력 = 화면 (16 초과 {m.get("pct16")}%)', same_as_screen(m), m)
    # 이미지 외곽선 글상자: 축소본으로 외곽선 계산, 출력에 보이는 이미지는 원본
    ar = E("""(async () => { const c = new OffscreenCanvas(3000, 3000); const x = c.getContext('2d'); x.fillStyle = '#c33'; x.beginPath(); x.arc(1500, 1500, 1400, 0, 7); x.fill();
      const a = await T.N.assets.add(await c.convertToBlob({ type: 'image/png' })); await a.ready;
      const id = T.add('text', { x: 10, y: 10, w: 400, h: 400, doc: T.longDoc('외곽선 글상자 '.repeat(60)), area: { kind: 'image', src: a.url, mode: 'alpha', fit: 'contain', show: true, opacity: 1 } });
      for (let i = 0; i < 40 && !T.V.images.get(a.url); i++) await new Promise((r) => setTimeout(r, 50));
      await new Promise((r) => setTimeout(r, 100)); T.V.render();
      const im = T.V.images.get(a.url);
      const scr = T.V.nodes.get(id).querySelector('img')?.getAttribute('src');
      const ex = T.V.exportPage().render().querySelector(`img[src="${a.url}"]`);
      const ed = T.ed(id);
      return { usesProxy: im && im.src === a.proxy.url, scr: scr === a.proxy.url, ex: !!ex, lines: ed.results[0].lines.length, orig: im?.dataset.orig === a.url }; })()""")
    check('A5 3000px 원 이미지 외곽선 글상자 → 외곽선은 축소본으로 계산(줄 배치됨), 화면은 축소본·출력은 원본', ar['usesProxy'] and ar['scr'] and ar['ex'] and ar['orig'] and ar['lines'] > 5, ar)
    # 열기: 축소본은 뒤에서 만들어지고, 준비되면 화면이 바뀜(그 전에는 빈 그림)
    E("T.reset(900, 700)")
    E("""(async () => { const c = new OffscreenCanvas(3200, 2400); const x = c.getContext('2d'); x.fillStyle = '#396'; x.fillRect(0, 0, 3200, 2400); const n = await T.V.addImage(await c.convertToBlob({ type: 'image/png' })); window.__bigId = n.id; })()""")
    zipb = E("(async () => { const { bytes } = await __nabi.P.toZip(__nabi.app.project, { assets: __nabi.assets, docOf: T.V.docOf, swatches: [] }); return Array.from(bytes); })()")
    pg2 = open_page()
    seq = pg2.evaluate("""(async (z) => { const opened = __nabi.openBytes(new Uint8Array(z), null, 'big.nabi'); await opened; const V = __nabi.view; const n = V.page.elements[0];
      const first = V.nodes.get(n.id)?.querySelector('img')?.getAttribute('src');
      const a = __nabi.assets.ofUrl(n.src); await a.ready; await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      const after = V.nodes.get(n.id).querySelector('img').getAttribute('src');
      return { firstBlankOrProxy: first && (first.startsWith('data:image/gif') || first === a.proxy.url), afterProxy: after === a.proxy.url, proxy: [a.proxy.w, a.proxy.h] }; })""", zipb)
    pg2.close()
    check('A6 저장한 프로젝트 열기 → 축소본을 뒤에서 만들고(그동안 원본을 풀지 않음), 준비되면 화면이 축소본으로', seq['firstBlankOrProxy'] and seq['afterProxy'] and seq['proxy'] == [2560, 1920], seq)

    # ============ B. 공통 장·쪽 번호 ============
    E("T.reset(600, 400)")
    E("(() => { T.N.app.project.master = null; T.N.app.project.pageStart = 1; T.N.app.addPage(); T.N.app.addPage(); T.N.app.switchPage(T.N.app.project.pages[0]); })()")
    click(E("(() => { T.N.flush(); const r = document.querySelector('#pagesList .pg-master').getBoundingClientRect(); return { x: r.left + 40, y: r.top + r.height / 2 }; })()"))
    mst = E("(() => { const m = T.N.app.project.master; return { cur: T.N.app.current === m, w: m.w, h: m.h, kind: m.kind, row: document.querySelector('#pagesList .pg-master').classList.contains('cur') }; })()")
    check('B1 장 목록 "공통 장" 클릭 → 공통 장을 만들고(첫 장 크기) 그리로 감', mst['cur'] and mst['w'] == 600 and mst['h'] == 400 and mst['kind'] == 'master', mst)
    rect_id = E("T.add('shape', { x: 0, y: 360, w: 600, h: 40, fill: '#335' })")
    num_id = E("T.add('text', { x: 20, y: 358, w: 300, h: 40, padding: 0, style: { fontSize: 16 }, doc: T.longDoc('{쪽} / {전체쪽}') })")
    E("T.N.app.switchPage(T.N.app.project.pages[1])"); E("T.N.flush()")
    lay = E("(() => { const m = T.V.pageEl.querySelector('.pv-master'); return { first: T.V.pageEl.firstChild === m, text: m?.textContent.replace(/\\s+/g, ''), pe: m && getComputedStyle(m).pointerEvents }; })()")
    check('B2 2장: 공통 층이 맨 뒤(첫 자식)에 깔리고 글상자의 {쪽} / {전체쪽} → "2/3"', lay['first'] and lay['text'] == '2/3' and lay['pe'] == 'none', lay)
    E("T.N.app.switchPage(T.N.app.project.pages[2])")
    t3 = E("T.V.pageEl.querySelector('.pv-master').textContent.replace(/\\s+/g, '')")
    check('B3 3장 → "3/3"', t3 == '3/3', t3)
    # 공통 요소는 선택되지 않음
    click(T_pt := E("T.C(300, 380)"))
    check('B4 장에서 공통 요소 자리를 클릭해도 선택되지 않음(편집은 공통 장에서만)', E("T.V.selection.length") == 0, E("T.V.selection"))
    # 출력 = 화면
    m = screen_vs_export('master-p3')
    ex_txt = E("T.V.exportPage().render().querySelector('.pv-master').textContent.replace(/\\s+/g, '')")
    check(f'B5 3장 출력에 공통 요소·쪽 번호 포함, 출력 = 화면 ({m.get("pct16")}%)', ex_txt == '3/3' and same_as_screen(m), [ex_txt, m])
    # 장마다 끄기 + 되돌리기
    E("T.N.app.switchPage(T.N.app.project.pages[0])")
    E("T.N.flush()"); click(E("T.field('공통 요소 보이기')"))
    off = E("[!!T.V.pageEl.querySelector('.pv-master'), T.V.page.noMaster === true]")
    E("T.N.history.undo()")
    on = E("[!!T.V.pageEl.querySelector('.pv-master'), !T.V.page.noMaster]")
    check('B6 1장 속성 "공통 요소 보이기" 끄기 → 1장에만 안 보임, 되돌리기 → 다시 보임', off == [False, True] and on == [True, True], [off, on])
    # 시작 번호
    E("T.N.app.openMaster()"); E("T.N.flush()")
    f = E("T.field('첫 쪽 번호')"); click(f, 3); kb.type('5'); kb.press('Enter')
    E("T.N.app.switchPage(T.N.app.project.pages[0])")
    t1 = E("T.V.pageEl.querySelector('.pv-master').textContent.replace(/\\s+/g, '')")
    check('B7 공통 장 속성 "첫 쪽 번호" 5 → 1장은 "5/7"', t1 == '5/7', t1)
    # 장 순서 바꾸면 번호도
    E("(() => { const A = T.N.app, ps = A.project.pages; A.movePage(ps[2], 0); A.switchPage(A.project.pages[0]); })()")
    t_mv = E("T.V.pageEl.querySelector('.pv-master').textContent.replace(/\\s+/g, '')")
    E("T.N.history.undo()")
    check('B8 장 순서 바꾸기 → 맨 앞으로 온 장이 "5/7"', t_mv == '5/7', t_mv)
    # 공통 장 글상자 편집: 실제 클릭·입력 + "쪽 번호 넣기" 버튼
    E("T.N.app.openMaster()")
    E(f"T.V.select(['{num_id}'])"); kb.press('Enter')
    E(f"(() => {{ const ed = T.ed('{num_id}'); const TS = ed.state.selection.constructor; ed.setSelection(TS.create(ed.state.doc, ed.state.doc.content.size - 1)); }})()")
    kb.insert_text(' 쪽 ')
    E("T.N.flush()")
    click(E("(() => { const b = document.querySelector('#props button[data-field=\"쪽 번호 넣기\"]').getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2 }; })()"))
    mt = E(f"T.text('{num_id}')")
    kb.press('Escape')
    E("T.N.app.switchPage(T.N.app.project.pages[1])")
    t2 = E("T.V.pageEl.querySelector('.pv-master').textContent.replace(/\\s+/g, '')")
    check('B9 공통 장 글상자 편집(입력 + "쪽 번호 넣기") → 2장에 "6/7쪽6"', mt == '{쪽} / {전체쪽} 쪽 {쪽}' and t2 == '6/7쪽6', [mt, t2])
    # 공통 장에서는 다음 장으로 이어 쓰기 없음
    E("T.N.app.openMaster()")
    fl = E(f"T.V.flowToNextPage('{num_id}')")
    check('B10 공통 장 글상자는 다른 장으로 잇지 않음(다음 장으로 이어 쓰기 거절)', fl is False, fl)
    # 되돌리기: 다른 장에서 공통 장 편집을 되돌리면 공통 장으로
    E("T.N.app.switchPage(T.N.app.project.pages[2])")
    E("T.N.history.undo()")
    back = E("[T.N.app.current === T.N.app.project.master, T.text(arguments[0])]".replace('arguments[0]', repr(num_id)))
    check('B11 3장에서 되돌리기 → 공통 장으로 가서 마지막 편집을 되돌림', back[0] and back[1] != mt, back)
    # 저장·열기
    E("T.N.app.switchPage(T.N.app.project.pages[0])"); E("T.N.app.project.pages[1].noMaster = true")
    zipb = E("(async () => { const { bytes, json } = await __nabi.P.toZip(__nabi.app.project, { assets: __nabi.assets, docOf: T.V.docOf, swatches: [] }); window.__pj = json; return Array.from(bytes); })()")
    pj = E("({ master: !!window.__pj.master, n: window.__pj.master?.elements.length, start: window.__pj.pageStart, no: window.__pj.pages.map((p) => !!p.noMaster) })")
    A_ = img(E("T.raster()"))
    pg2 = open_page()
    r2 = pg2.evaluate("""(async (z) => { await __nabi.openBytes(new Uint8Array(z), null, 'm.nabi'); const A = __nabi.app;
      const t = __nabi.view.pageEl.querySelector('.pv-master')?.textContent.replace(/\\s+/g, ''); A.switchPage(A.project.pages[1]);
      const t2 = !!__nabi.view.pageEl.querySelector('.pv-master'); A.switchPage(A.project.pages[0]);
      return { t, t2, start: A.project.pageStart, kind: A.project.master.kind, img: await T.raster() }; })""", zipb)
    B_ = img(r2['img']); pg2.close()
    mm = compare(A_, B_)
    check('B12 저장·열기 → 공통 장·첫 쪽 번호·장별 끄기 유지, 1장 출력 같음', pj['master'] and pj['n'] == 2 and pj['start'] == 5 and pj['no'] == [False, True, False] and r2['t'] and r2['t'].startswith('5/7') and r2['t2'] is False and r2['kind'] == 'master' and mm['max'] <= 8, [pj, {k: v for k, v in r2.items() if k != 'img'}, mm])
    E("T.N.app.project.master = null; T.N.app.project.pageStart = 1")

    # ============ C. 찾기·바꾸기 ============
    E("T.reset(600, 400)")
    E("(() => { T.N.app.addPage(); T.N.app.addPage(); T.N.app.switchPage(T.N.app.project.pages[0]); })()")
    FT = '사과 나무 아래. ' * 30 + '끝에 사과.'
    a1 = E(f"T.add('text', {{ x: 20, y: 20, w: 300, h: 120, style: {{ fontSize: 16 }}, doc: T.longDoc({json.dumps(FT)}) }})")
    E("T.N.app.switchPage(T.N.app.project.pages[1])")
    a2 = E("T.add('text', { x: 20, y: 20, w: 300, h: 300, style: { fontSize: 16 } })")
    E(f"T.V.linkFrames('{a1}', '{a2}')")
    E("T.N.app.switchPage(T.N.app.project.pages[2])")
    pt = E("T.add('pathText', { x: 20, y: 200, w: 300, h: 60, d: 'M0 30 L300 30', pw: 300, ph: 60, text: '사과길 Apple apple', style: { fontSize: 20, color: '#222' } })")
    E("(() => { T.N.app.openMaster(); T.add('text', { x: 400, y: 360, w: 180, h: 30, padding: 0, style: { fontSize: 14 }, doc: T.longDoc('사과 출판사') }); T.N.app.switchPage(T.N.app.project.pages[0]); })()")
    expected = E(f"(() => {{ const t = T.stext('{a1}'); return t.split('사과').length - 1 + 1 + 1; }})()")
    E("T.V.viewport.focus()")
    kb.press('Control+f')
    opened = E("!!document.querySelector('.fb') && document.activeElement === document.querySelector('.fb [data-f=q]')")
    kb.insert_text('사과')
    cnt = E("document.querySelector('.fb [data-f=count]').textContent")
    check(f'C1 Ctrl+F → 찾기 창(입력칸에 포커스), "사과" → 프로젝트 전체(이어진 글 2장·경로 글자·공통 장) {expected}곳', opened and cnt == f'–/{expected}', [opened, cnt])
    kb.press('Enter')
    st1 = E(f"(() => {{ const ed = T.sed('{a1}'); const s = ed.state.selection; return {{ editing: T.V.editing, text: ed.state.doc.textBetween(s.from, s.to), focus: document.activeElement === document.querySelector('.fb [data-f=q]'), cnt: document.querySelector('.fb [data-f=count]').textContent }}; }})()")
    check('C2 Enter → 첫 곳: 그 글상자 편집 + 그 글자 선택, 포커스는 찾기 입력칸에 그대로, "1/N"', st1['editing'] == a1 and st1['text'] == '사과' and st1['focus'] and st1['cnt'] == f'1/{expected}', st1)
    # 2장 글상자로 넘어가는 곳까지 다음
    seen = None
    for i in range(expected):
        kb.press('Enter')
        r = E("[T.cur(), T.V.editing]")
        if r[1] == a2: seen = r; break
    check('C3 다음을 누르다 보면 이어진 글의 2장 부분 → 2장으로 넘어가 2장 글상자를 편집', seen == [1, a2], seen)
    for i in range(expected):
        kb.press('Enter')
        r = E("[T.cur(), T.V.selection, T.V.editing]")
        if r[1] == [pt]: break
    check('C4 경로 글자의 "사과" → 3장으로 가서 그 요소 선택', r[0] == 2 and r[1] == [pt] and r[2] is None, r)
    kb.press('Shift+Enter')
    back_prev = E("[T.cur(), T.V.editing]")
    check('C5 Shift+Enter = 이전 → 앞 장의 글로 돌아감', back_prev[0] == 1 and back_prev[1] == a2, back_prev)
    # 한 곳 바꾸기
    pg.click('.fb [data-f=r]'); kb.insert_text('배')
    before_txt = E(f"T.stext('{a1}')")
    pg.click('.fb [data-f=one]')
    after_txt = E(f"T.stext('{a1}')")
    cnt2 = E("document.querySelector('.fb [data-f=count]').textContent")
    check('C6 "바꾸기" → 지금 곳 하나만 "배"로, 다음 곳으로 이동, 개수 1 줄어듦', after_txt.count('사과') == before_txt.count('사과') - 1 and after_txt.count('배') == before_txt.count('배') + 1 and cnt2.endswith(f'/{expected - 1}'), [cnt2])
    # 모두 바꾸기 + 되돌리기 한 번
    snap0 = E("T.snap()")
    pg.click('.fb [data-f=all]')
    res = E(f"(() => ({{ t: T.stext('{a1}'), p: T.V.nodeAny('{pt}').n.text, m: T.N.app.project.master.elements[0], cnt: document.querySelector('.fb [data-f=count]').textContent, note: document.querySelector('.fb [data-f=note]').textContent }}))()")
    mtext = E("T.V.editors.get(T.N.M.storyOf(T.N.app.project.master.elements[0])).text")
    check('C7 "모두 바꾸기" → 글상자·경로 글자·공통 장 모두 "배", 남은 곳 없음', '사과' not in res['t'] and res['p'] == '배길 Apple apple' and mtext == '배 출판사' and res['cnt'] == '없음', [res['p'], mtext, res['cnt'], res['note']])
    E("T.N.history.undo()")
    snap1 = E("T.snap()")
    check('C8 되돌리기 한 번 → 모두 바꾸기 전으로(프로젝트 전체 같음)', snap0 == snap1, len(snap0))
    # 대소문자
    pg.fill('.fb [data-f=q]', 'apple')
    c_ins = E("document.querySelector('.fb [data-f=count]').textContent")
    pg.click('.fb [data-f=case]')
    c_cs = E("document.querySelector('.fb [data-f=count]').textContent")
    check('C9 "apple": 대소문자 무시 2곳 → 구분 1곳', c_ins == '–/2' and c_cs == '–/1', [c_ins, c_cs])
    # 글자 모양이 섞인 단어도 찾고, 줄바꿈을 넘어서는 찾지 않음
    unit = E("""(async () => { const F = await import('/app/find.js'); const { schema } = await import('/src/schema.js');
      const b = schema.marks.bold.create();
      const d = schema.node('doc', null, [schema.node('paragraph', null, [schema.text('사', [b]), schema.text('과와 사'), schema.node('hard_break'), schema.text('과')])]);
      return F.findInDoc(d, '사과'); })()""")
    check('C10 굵게가 섞인 "사과"는 찾고, 강제 줄바꿈을 넘는 "사/과"는 찾지 않음', unit == [[1, 3]], unit)
    kb.press('Escape')
    check('C11 Esc → 찾기 창 닫힘', E("!document.querySelector('.fb')"))

    # ============ D. 장 목록 미리보기 ============
    E("T.reset(600, 400)")
    E("""(() => { const A = T.N.app; A.project.master = null; A.addPage(); A.addPage(); const cs = ['#e00000', '#00c000', '#0000e0'];
      A.project.pages.forEach((p, i) => { A.switchPage(p); T.add('shape', { x: 0, y: 0, w: 600, h: 400, fill: cs[i] }); }); A.switchPage(A.project.pages[0]); })()""")
    mouse.move(5, 995)
    TH = """(async () => { const out = []; for (const row of document.querySelectorAll('#pagesList .pg-row:not(.pg-master)')) { const im = row.querySelector('.pg-thumb img'); const src = im.getAttribute('src');
      if (!src) { out.push(null); continue; } await im.decode(); const c = new OffscreenCanvas(im.naturalWidth, im.naturalHeight); const x = c.getContext('2d'); x.drawImage(im, 0, 0);
      out.push({ src, w: im.naturalWidth, h: im.naturalHeight, c: [...x.getImageData(im.naturalWidth / 2 | 0, im.naturalHeight / 2 | 0, 1, 1).data].slice(0, 3), shown: im.getBoundingClientRect().width }); } return out; })()"""
    def wait_thumbs(cond, t=8):
        for _ in range(int(t / 0.2)):
            r = E(TH)
            if cond(r): return r
            time.sleep(0.2)
        return r
    th = wait_thumbs(lambda r: all(r))
    okc = th and all(r and abs(r['c'][0] - e[0]) < 20 and abs(r['c'][1] - e[1]) < 20 and abs(r['c'][2] - e[2]) < 20 for r, e in zip(th, [(224, 0, 0), (0, 192, 0), (0, 0, 224)]))
    check('D1 장 목록 미리보기: 장마다 그 장 모습(빨강·초록·파랑), 84×56 크기로 보임(가로 84 안에 장 비율)', okc and all(r['shown'] == 84 for r in th), th)
    # 한 장만 바뀌면 그 장만 다시
    E("(() => { T.N.app.switchPage(T.N.app.project.pages[1]); T.V.setProps({ fill: '#e0e000' }, [T.V.page.elements[0].id]); })()")
    th2 = wait_thumbs(lambda r: r[1] and r[1]['src'] != th[1]['src'])
    check('D2 2장만 바꿈(노랑) → 2장 미리보기만 새로(다른 장은 그대로)', th2[0]['src'] == th[0]['src'] and th2[2]['src'] == th[2]['src'] and th2[1]['src'] != th[1]['src'] and th2[1]['c'][0] > 200 and th2[1]['c'][1] > 200, [x['c'] for x in th2])
    # 끄는 동안에는 그리지 않음
    E("(() => { T.N.app.switchPage(T.N.app.project.pages[0]); T.add('shape', { x: 200, y: 100, w: 200, h: 200, fill: '#ffffff' }); })()")
    a = E("T.C(100, 50)"); mouse.move(a['x'], a['y']); mouse.down()
    for i in range(60):
        mouse.move(a['x'] + (i % 10), a['y'] + (i % 7)); time.sleep(0.025)
    mid = E(TH)[0]['src']
    mouse.up(); mouse.move(5, 995)
    E("T.N.history.undo()")
    th3 = wait_thumbs(lambda r: r[0] and r[0]['src'] != mid, 6)
    check('D3 요소를 끄는 동안(1.5초)에는 미리보기를 그리지 않고, 놓은 뒤에 그림', mid == th2[0]['src'] and th3[0]['src'] != mid, [mid == th2[0]['src'], th3[0]['src'] != mid])
    # 공통 장 미리보기 + 장 미리보기에 공통 요소
    E("(() => { T.N.app.openMaster(); T.add('shape', { x: 0, y: 0, w: 600, h: 400, fill: '#ff8000', opacity: 1 }); T.N.app.switchPage(T.N.app.project.pages[2]); T.V.setProps({ opacity: 0 }, [T.V.page.elements[0].id]); })()")
    t4 = time.time()
    th4 = wait_thumbs(lambda r: r[2] and r[2]['c'][0] > 200 and r[2]['c'][1] > 100 and E("!!document.querySelector('#pagesList .pg-master .pg-thumb img').getAttribute('src')"), 20)
    metrics['thumbs-4-pages-s'] = round(time.time() - t4, 1)
    mrow = E("!!document.querySelector('#pagesList .pg-master .pg-thumb img').getAttribute('src')")
    check('D4 공통 장 미리보기가 생기고, 3장 미리보기에 공통 요소(주황)가 비침', mrow and th4[2]['c'][0] > 200 and 100 < th4[2]['c'][1] < 160, [mrow, th4[2]['c']])
    # 큰 사진이 있는 장의 미리보기는 256px 사본으로
    tiny = E("""(async () => { T.N.app.switchPage(T.N.app.project.pages[0]); const c = new OffscreenCanvas(4000, 3000); const x = c.getContext('2d'); x.fillStyle = '#123456'; x.fillRect(0, 0, 4000, 3000);
      const n = await T.V.addImage(await c.convertToBlob({ type: 'image/png' })); const a = T.N.assets.ofUrl(n.src);
      for (let i = 0; i < 60 && !a.tiny; i++) await new Promise((r) => setTimeout(r, 100));
      const bm = a.tiny && await createImageBitmap(a.tiny.blob); return a.tiny ? { w: bm.width, h: bm.height, bytes: a.tiny.blob.size } : null; })()""")
    check('D5 큰 사진이 든 장의 미리보기는 가장 긴 변 256px 사본으로 그림(원본·화면용 축소본을 다시 풀지 않음)', tiny and tiny['w'] == 256 and tiny['h'] == 192, tiny)
    # 설정에서 끄기
    pg.click('#settings'); time.sleep(0.2)
    offv = E("(() => { const b = document.querySelector('.settings [data-opt=pageThumbs]'); b.click(); return [b.checked, document.querySelector('#pagesList .pg-list').classList.contains('thumbs'), getComputedStyle(document.querySelector('#pagesList .pg-thumb')).display]; })()")
    onv = E("(() => { const b = document.querySelector('.settings [data-opt=pageThumbs]'); b.click(); return [b.checked, document.querySelector('#pagesList .pg-list').classList.contains('thumbs')]; })()")
    pg.click('.settings [data-v=close]')
    check('D6 설정 "장 목록 미리보기" 끄기 → 목록이 한 줄씩(미리보기 숨김), 켜기 → 다시', offv == [False, False, 'none'] and onv == [True, True], [offv, onv])
    E("T.N.app.project.master = null")

    # ============ E. 가벼운 되돌리기 기록 ============
    E("T.reset(900, 700)")
    E("(() => { const V = T.V, M = T.N.M; for (let i = 0; i < 300; i++) V.page.elements.push(M.makeElement('shape', { x: (i % 20) * 30, y: (i / 20 | 0) * 30, w: 25, h: 25, fill: { type: 'linear', angle: 30, stops: [{ o: 0, c: '#f00' }, { o: 1, c: '#00f' }] } })); V.render(); T.N.history.clear(); })()")
    s0 = E("T.snap()")
    # 여러 종류 변경을 섞어 기록: 속성·순서·지우기·만들기·그룹·방향키 이동(합쳐짐)
    E("""(() => { const V = T.V, ids = V.page.elements.map((n) => n.id);
      V.setProps({ x: 500, fill: '#123456' }, [ids[3]]);
      V.select([ids[10]]); V.run('front');
      V.select([ids[20], ids[21]]); V.run('delete');
      T.add('shape', { x: 1, y: 2, w: 3, h: 4 });
      V.select([ids[30], ids[31], ids[32]]); V.run('group');
      V.select([ids[40]]); })()""")
    for _ in range(5): kb.press('ArrowRight')
    s1 = E("T.snap()")
    n_undo = E("T.N.history.done.length")
    for _ in range(n_undo): E("T.N.history.undo()")
    s_back = E("T.snap()")
    for _ in range(n_undo): E("T.N.history.redo()")
    s_fwd = E("T.snap()")
    check(f'E1 속성·순서·지우기·만들기·그룹·방향키 5번(한 단위로 합쳐짐) → 되돌리기 {n_undo}번 = 처음과 같음, 다시 실행 = 끝과 같음', s_back == s0 and s_fwd == s1 and n_undo == 6, n_undo)
    mem = E("""(() => { const V = T.V; const ids = V.page.elements.map((n) => n.id); T.N.history.clear();
      const one = new T.N.M.ModelEntry(V, 'x', V.snapshot(), (() => { const s = V.snapshot(); s.elements[5] = { ...s.elements[5], x: 999 }; return s; })(), [], []);
      return { stored: one.d.b.size + one.d.a.size, total: V.page.elements.length }; })()""")
    check('E2 요소 300개 장에서 요소 하나를 바꾼 기록은 그 요소 전/후 2개만 담음(예전: 장 전체 전/후)', mem['stored'] == 2, mem)
    # 여러 장을 한 번에 바꾼 기록(장을 넘는 잇기)도 그대로
    E("T.reset(600, 400)")
    E("(() => { T.N.app.addPage(); T.N.app.switchPage(T.N.app.project.pages[0]); })()")
    x1 = E("T.add('text', { x: 20, y: 20, w: 200, h: 60, style: { fontSize: 16 }, doc: T.longDoc('여러 장 되돌리기 시험 '.repeat(20)) })")
    E("T.N.app.switchPage(T.N.app.project.pages[1])")
    x2 = E("T.add('text', { x: 20, y: 20, w: 200, h: 200, style: { fontSize: 16 } })")
    s2 = E("T.snap()")
    E(f"T.V.linkFrames('{x1}', '{x2}')")
    linked = E(f"T.sed('{x1}').members")
    E("T.N.history.undo()")
    s3 = E("T.snap()")
    E("T.N.history.redo()")
    check('E3 장을 넘는 잇기(두 장을 함께 바꾼 기록) → 되돌리기 = 잇기 전, 다시 실행 = 이어짐', linked == [x1, x2] and s3 == s2 and E(f"T.sed('{x1}').members") == [x1, x2], linked)

    # ============ G. 화면 배치(사용자 편집) ============
    geo = lambda: E("""(() => { const r = (id) => { const e = document.getElementById(id); const b = e.getBoundingClientRect(); return getComputedStyle(e).display === 'none' ? null : [Math.round(b.left), Math.round(b.top), Math.round(b.width)]; };
      return { rail: r('rail'), railIn: document.getElementById('rail').parentNode.id, left: r('left'), props: r('props'), canvas: r('canvas'), status: r('statusbar'), cls: document.body.className }; })()""")
    g0 = geo()
    check('G1 기본: 도구 막대는 위 막대 가운데, 장·레이어 왼쪽 · 캔버스 · 속성 오른쪽', g0['railIn'] == 'toolSlot' and g0['rail'][1] < 46 and g0['left'][0] < g0['canvas'][0] < g0['props'][0], g0)
    pg.click('#settings'); time.sleep(0.2)
    pg.click('.settings input[data-lay=tools][value=left]'); pg.click('.settings input[data-lay=swap][value=true]')
    g1 = geo()
    check('G2 설정 → 도구 막대 왼쪽 + 패널 좌우 바꾸기 → 도구 세로 줄이 맨 왼쪽, 속성 · 캔버스 · 장·레이어 순', g1['railIn'] == 'main' and g1['rail'][0] == 0 and g1['rail'][0] < g1['props'][0] < g1['canvas'][0] < g1['left'][0], g1)
    pg.click('.settings input[data-lay=tools][value=right]')
    pg.click('.settings .st-tool[data-tool-id=line] input[data-toolshow]')
    pg.click('.settings .st-tool[data-tool-id=text] [data-toolmove="-1"]')
    tl = E("[...document.querySelectorAll('#rail > button, #rail > .wrap')].filter((b) => getComputedStyle(b).display !== 'none').map((b) => b.dataset.tool || b.id)")
    g2 = geo()
    check('G3 도구 막대 오른쪽, "선" 숨김, "글상자"를 앞으로 → 도구 순서 글상자·선택·도형·펜·이미지·찾기, 맨 오른쪽', tl == ['text', 'select', 'shapeWrap', 'pen', 'addImage', 'findBtn'] and g2['rail'][0] > g2['left'][0], [tl, g2])
    pg.click('.settings [data-v=close]')
    kept = E("JSON.parse(localStorage.getItem('nabitext.settings')).layout")
    pg2 = open_page(); g_re = pg2.evaluate("[document.getElementById('rail').parentNode.id, document.body.classList.contains('swap'), [...document.querySelectorAll('#rail > button, #rail > .wrap')].filter((b) => getComputedStyle(b).display !== 'none').length]"); pg2.close()
    check('G4 새로 열어도 배치 유지(이 컴퓨터에 저장)', kept['tools'] == 'right' and kept['swap'] is True and 'line' in kept['toolHidden'] and g_re == ['main', True, 6], [kept, g_re])
    # 패널 가장자리 끌기(지금 왼쪽 패널 = 속성 패널)
    w0 = E("document.getElementById('props').getBoundingClientRect().width")
    sp = E("(() => { const b = document.querySelector('.split[data-edge=l]').getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + 300 }; })()")
    mouse.move(sp['x'], sp['y']); mouse.down(); mouse.move(sp['x'] + 60, sp['y'], steps=6); mouse.up(); time.sleep(0.2)
    w1 = E("document.getElementById('props').getBoundingClientRect().width"); sw = E("JSON.parse(localStorage.getItem('nabitext.settings')).layout.rightW")
    click({'x': sp['x'] + 60, 'y': sp['y']}, 2); time.sleep(0.2)
    w2 = E("document.getElementById('props').getBoundingClientRect().width")
    check('G5 패널 가장자리를 60px 끌면 그 패널이 60px 넓어지고 저장, 두 번 누르면 기본 너비(292)', abs(w1 - w0 - 60) <= 1 and sw == round(w1) and w2 == 292, [w0, w1, sw, w2])
    # 숨기기(단축키)
    E("T.V.viewport.focus()"); kb.press('Control+Backslash'); time.sleep(0.2)
    gh = geo(); z_hidden = E("T.V.viewport.getBoundingClientRect().width")
    kb.press('Control+Backslash'); time.sleep(0.2)
    gs = geo()
    check('G6 Ctrl+\\ → 두 패널 숨김(캔버스가 넓어짐), 다시 누르면 보임', gh['left'] is None and gh['props'] is None and z_hidden > 1300 and gs['left'] and gs['props'], [gh, gs])
    # 기본값으로
    pg.click('#settings'); time.sleep(0.2); pg.click('.settings [data-layreset]'); pg.click('.settings [data-v=close]')
    g3 = geo()
    check('G7 화면 배치 "기본값으로" → 처음 배치', g3['railIn'] == 'toolSlot' and 'swap' not in g3['cls'] and g3['left'][2] == 236 and g3['props'][2] == 292, g3)

    check('Z 검증 전체 동안 페이지 오류 없음', not errors, errors[:5])
    b.close()

fails = [r for r in results if not r[1]]
for name, ok, detail in results:
    print(('PASS ' if ok else 'FAIL ') + name + ('' if ok else '  ' + json.dumps(detail, ensure_ascii=False, default=str)[:1500]))
print('metrics:', json.dumps(metrics, ensure_ascii=False))
print(f'{len(results) - len(fails)}/{len(results)} passed')
srv.shutdown()
