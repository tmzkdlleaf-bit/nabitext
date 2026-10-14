"""11단계 검증: 여러 장에 흐르는 글(켜고 끄기 포함), 글자 스타일 프리셋, 선택한 장 내보내기, 장 배경 이미지, 단축키 설정.
사용: python3 test/stage11.py  (proto 폴더 기준)
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
        scr.save(os.path.join(OUT, f'stage11-{tag}-screen.png')); out.save(os.path.join(OUT, f'stage11-{tag}-export.png'))
        return m

    # ============ A. 여러 장에 흐르는 글 ============
    E("T.reset(700, 500)")
    p1 = E("__nabi.app.current.id")
    a = E(f"T.add('text', {{ x: 40, y: 40, w: 300, h: 160, style: {{ fontSize: 20 }}, doc: T.longDoc({json.dumps(LONG2)}) }})")
    E("__nabi.app.addPage()"); p2 = E("__nabi.app.current.id")
    bb = E("T.add('text', { x: 60, y: 60, w: 320, h: 180, style: { fontSize: 20 } })")
    click(E(f"T.rowPt('{p1}')")); time.sleep(0.1)
    E(f"T.V.select(['{a}'])")
    click(E(f"T.port('{a}')"))
    click(E(f"T.rowPt('{p2}')")); time.sleep(0.2)
    mouse.move(*E("T.C(500, 400)").values())
    hint = [t for t in E("T.overText()") if '잇는 중' in t]
    click(E(f"T.L('{bb}', 100, 80)"))
    gb = E(f"T.el('{bb}')")
    placed = E(f"T.splaced('{a}')")
    src = ''.join(LONG2.split())
    check('A1 1장 글상자의 출구 → 장 목록에서 2장으로 → 2장 글상자 클릭 = 장을 넘어 이어짐(잇는 중 표시, 두 글상자의 글을 이으면 원문 앞부분 그대로)',
          gb['story'] == a and hint and E(f"T.sed('{a}').members") == [a, bb] and src.startswith(''.join(placed)) and len(placed[1]) > 20, {'hint': hint, 'placed': [len(x) for x in placed]})
    E(f"T.V.select(['{bb}'])")
    lab2 = E("T.overText()")
    click(E(f"T.rowPt('{p1}')")); time.sleep(0.1)
    E(f"T.V.select(['{a}'])")
    nxt = E("[...T.V.overlay.querySelectorAll('[data-next-page]')].map((g) => g.dataset.nextPage)")
    check('A2 흐름 표시: 1장 글상자 옆 "→ 2장", 2장 글상자 옆 "1장에서 →", 순서 1/2·2/2', nxt == ['2'] and '1장에서 →' in lab2 and '2/2' in lab2, {'p2': lab2, 'next': nxt})
    # 다음 장으로 이어 쓰기
    click(E(f"T.rowPt('{p2}')")); time.sleep(0.1)
    E(f"T.V.select(['{bb}'])")
    n_hist = E("__nabi.history.done.length")
    ok = E("T.btn('다음 장으로 이어 쓰기')")
    time.sleep(0.2)
    pages3 = E("T.pageIds()")
    cc = E("T.V.selection[0]")
    gc = E(f"T.el('{cc}')")
    check('A3 2장 글상자에서 "다음 장으로 이어 쓰기" → 3장이 새로 생기고 같은 자리·크기 글상자가 셋째로 이어짐, 화면은 3장, 되돌리기 한 단위',
          ok and len(pages3) == 3 and E("T.cur()") == 2 and E(f"T.sed('{a}').members") == [a, bb, cc] and gc['x'] == 60 and gc['w'] == 320 and gc['h'] == 180 and E("__nabi.history.done.length") == n_hist + 1, {'pages': len(pages3), 'members': E(f"T.sed('{a}').members")})
    E("__nabi.history.undo()")
    check('A4 되돌리기 → 3장과 셋째 글상자 모두 사라짐', len(E("T.pageIds()")) == 2 and E(f"T.sed('{a}').members") == [a, bb])
    E("__nabi.history.redo()")
    time.sleep(0.1)
    p3 = E("T.pageIds()")[2]
    cc = E(f"T.sed('{a}').members")[2]
    # 편집 중 ↓로 다음 장 글상자로
    click(E(f"T.rowPt('{p2}')")); time.sleep(0.1)
    E(f"T.V.select(['{bb}'])"); kb.press('Enter')
    E(f"(() => {{ const ed = T.sed('{a}'); const r = ed.results[1]; const l = r.lines[r.lines.length - 1]; const TS = ed.state.selection.constructor; ed.setSelection(TS.create(ed.state.doc, l.from + 1)); }})()")
    kb.press('ArrowDown')
    st = E(f"(() => {{ const ed = T.sed('{a}'); return {{ cur: T.cur(), editing: T.V.editing, view: ed.caret.view, focus: document.activeElement === ed.input, head: ed.state.selection.head, from2: ed.results[2].lines[0].from, to2: ed.results[2].lines[0].to }}; }})()")
    check('A5 편집 중 2장 글상자 마지막 줄에서 ↓ → 편집을 이어 가며 3장으로 넘어감(커서는 3장 글상자 첫 줄, 입력창 포커스 유지)',
          st['cur'] == 2 and st['editing'] == cc and st['view'] == 2 and st['focus'] and st['from2'] <= st['head'] <= st['to2'], st)
    cdp.send('Input.imeSetComposition', {'text': '가', 'selectionStart': 1, 'selectionEnd': 1})
    ta = E(f"""(() => {{ const ed = T.sed('{a}'); const r = ed.input.getBoundingClientRect(); const c = ed.caret; const cl = T.L('{cc}', c.x, c.top + c.h / 2); return {{ tx: r.left, ty: r.top + r.height / 2, cx: cl.x, cy: cl.y }}; }})()""")
    cdp.send('Input.insertText', {'text': '가'})
    h2 = E(f"T.sed('{a}').state.selection.head")
    check('A6 3장 글상자에서 한글 조합: 입력창이 커서 자리(±3px), 확정하면 그 자리에 들어감', math.dist((ta['tx'], ta['ty']), (ta['cx'], ta['cy'])) < 3 and h2 == st['head'] + 1 and E(f"T.sed('{a}').state.doc.textBetween({st['head']}, {st['head'] + 1})") == '가', ta)
    kb.press('Control+z'); kb.press('Escape')
    # 장 순서를 바꾸면 흐름 순서도
    E(f"__nabi.app.movePage(__nabi.app.project.pages[2], 1)")
    mem = E(f"T.sed('{a}').members")
    first_c = E(f"T.sed('{a}').results[1].lines[0].pieces[0].text")
    check('A7 장 순서 바꾸기(3장 → 2번째) → 흐름도 장 순서를 따름(1장 → 옮긴 장 → 원래 2장)', mem == [a, cc, bb], mem)
    E("__nabi.history.undo()")
    check('A8 되돌리기 → 원래 흐름', E(f"T.sed('{a}').members") == [a, bb, cc])
    # 앞쪽 장으로는 잇지 않음
    click(E(f"T.rowPt('{p3}')")); time.sleep(0.1)
    E(f"T.V.select(['{cc}'])")
    click(E(f"T.port('{cc}')"))
    click(E(f"T.rowPt('{p1}')")); time.sleep(0.1)
    x1 = E("T.add('text', { x: 400, y: 300, w: 200, h: 100, style: { fontSize: 16 }, doc: T.longDoc('앞 장 글상자') })")
    E("T.V.linking && (T.V.linking.cur = null)")
    click(E(f"T.L('{x1}', 50, 50)"))
    check('A9 뒤쪽 장(3장)에서 시작한 잇기는 앞쪽 장(1장) 글상자로 잇지 않음(잇기 취소, 흐름 그대로)', E(f"T.sed('{a}').members") == [a, bb, cc] and E(f"T.el('{x1}').story") is None and not E("T.V.linking"))
    # 설정: 다른 장 잇기 끄기
    click(E("(() => { const r = document.getElementById('settings').getBoundingClientRect(); return { x: r.left + 5, y: r.top + 5 }; })()"))
    time.sleep(0.2)
    pg.click('.settings [data-opt=crossPageLinks]')
    off = E("T.V.crossPageLinks")
    pg.click('.settings [data-v=close]')
    E(f"T.V.select(['{x1}'])")
    click(E(f"T.port('{x1}')")) if E(f"T.port('{x1}')") else None
    click(E(f"T.rowPt('{p2}')")); time.sleep(0.1)
    click(E(f"T.L('{bb}', 100, 80)"))
    click(E(f"T.rowPt('{p3}')")); time.sleep(0.1)
    E(f"T.V.select(['{cc}'])")
    btn_hidden = not E("T.hasBtn('다음 장으로 이어 쓰기')")
    still = E(f"T.sed('{a}').members")
    check('A10 설정 "다른 장의 글상자와 잇기" 끄기 → 다른 장 글상자로 잇기 안 됨, "다음 장으로 이어 쓰기" 버튼 없음, 이미 이어진 흐름은 그대로',
          off is False and E(f"T.V.nodeAny('{x1}').n.story ?? null") is None and btn_hidden and still == [a, bb, cc], {'off': off, 'members': still})
    click(E("(() => { const r = document.getElementById('settings').getBoundingClientRect(); return { x: r.left + 5, y: r.top + 5 }; })()"))
    time.sleep(0.2); pg.click('.settings [data-opt=crossPageLinks]'); pg.click('.settings [data-v=close]')
    check('A11 다시 켜기 → 설정이 이 컴퓨터에 저장됨', E("T.V.crossPageLinks") is True and E("JSON.parse(localStorage.getItem('nabitext.settings')).crossPageLinks") is True)
    # 저장·열기
    j0 = json.loads(E("T.snap()"))
    docs = {e['id']: ('doc' in e) for pgj in j0['pages'] for e in pgj['elements'] if e['type'] == 'text'}
    zipb = E("(async () => { const { bytes } = await __nabi.P.toZip(__nabi.app.project, { assets: __nabi.assets, docOf: T.V.docOf, swatches: [] }); return Array.from(bytes); })()")
    l0 = E(f"T.sed('{a}').results.map((r) => r.lines.map((l) => [l.from, l.to]))")
    pg2 = open_page()
    pg2.evaluate("(z) => __nabi.openBytes(new Uint8Array(z), null, 'flow.nabi')", zipb)
    j1 = json.loads(pg2.evaluate("T.snap()"))
    for pid in [p2, p3]: pg2.evaluate(f"__nabi.view.ensurePage(__nabi.app.project.pages.find((p) => p.id === '{pid}'))")
    l1 = pg2.evaluate(f"T.sed('{a}').results.map((r) => r.lines.map((l) => [l.from, l.to]))")
    pg2.close()
    check('A12 저장 파일: 이야기의 첫 글상자(1장)만 문서를 가짐, 다른 창에서 열기 → JSON·장별 줄 배치 일치', docs[a] and not docs[bb] and not docs[cc] and j0['pages'] == j1['pages'] and l0 == l1, docs)
    # 출력: 2장만 내보내면 이어지는 글
    E(f"__nabi.app.switchPage(__nabi.app.project.pages[1])")
    m = screen_vs_export('flow-p2')
    check(f'A13 2장 출력 = 화면(앞 장에서 넘어온 글, 16 초과 {m.get("pct16")}%)', same_as_screen(m), m)
    html = E("(async () => __EX.buildPrintHTML(__nabi.app.project.pages.map((p) => T.V.exportPage(p)), { title: 't' }))()")
    vp = ctx.new_page(); vp.set_content(html, wait_until='load'); vp.evaluate("document.fonts.ready")
    pdfp = os.path.join(TMP, 'flow.pdf'); vp.pdf(path=pdfp, prefer_css_page_size=True, print_background=True); vp.close()
    import subprocess
    pdftxt = ''.join(subprocess.run(['pdftotext', pdfp, '-'], capture_output=True, text=True).stdout.split())
    allp = ''.join(E(f"T.splaced('{a}')"))
    import difflib
    pdftxt = pdftxt.replace('앞장글상자', '')  # 1장에 따로 있는 글상자(A9에서 만든 것)
    sm = difflib.SequenceMatcher(None, allp, pdftxt)
    check('A14 벡터 PDF(3장): 장을 넘어 이어진 글이 순서대로 들어 있음', allp and allp in pdftxt, [len(allp), len(pdftxt), [(t, allp[i1:i2], pdftxt[j1:j2]) for t, i1, i2, j1, j2 in sm.get_opcodes() if t != 'equal']])
    # 첫 장 지우기 → 둘째 장 글상자가 처음부터
    E("__nabi.app.switchPage(__nabi.app.project.pages[0])"); E("__nabi.app.deletePage()")
    ed_after = E(f"(() => {{ const ed = T.V.editors.get('{a}'); return {{ m: ed.members, first: ed.results[0].lines[0].pieces.map((p) => p.text).join('') }}; }})()")
    check('A15 1장(이야기의 첫 글상자가 있는 장)을 지우면 2장 글상자가 글을 처음부터 이어 받음', ed_after['m'] == [bb, cc] and LONG2.startswith(ed_after['first'].strip()), ed_after)
    E("__nabi.history.undo()")
    check('A16 되돌리기 → 1장과 흐름 복원', E(f"T.sed('{a}').members") == [a, bb, cc] and len(E("T.pageIds()")) == 3)

    # ============ B. 글자 스타일 프리셋 ============
    E("T.reset(900, 600)")
    E("__nabi.app.promptText = async (msg, v) => window.__nextName || v")
    t1 = E("T.add('text', { x: 40, y: 40, w: 400, h: 200, style: { fontSize: 20 }, doc: T.paras(['강조할 단어가 있는 문장입니다']) })")
    t2 = E("T.add('text', { x: 460, y: 40, w: 400, h: 200, style: { fontSize: 20 }, doc: T.paras(['다른 글상자의 문장']) })")
    E(f"T.V.select(['{t1}'])"); kb.press('Enter')
    E(f"(() => {{ const ed = T.ed('{t1}'); const TS = ed.state.selection.constructor; ed.setSelection(TS.create(ed.state.doc, 1, 4)); ed.setMark('size', {{ value: 28 }}); ed.setMark('color', {{ value: '#c0392b' }}); ed.toggleMark('bold'); }})()")
    E("window.__nextName = '강조'")
    E("T.btn('새 글자 프리셋')"); time.sleep(0.2)
    ps = E("T.V.presets")
    cid = next((k for k, v in ps.items() if v.get('kind') == 'char'), None)
    mk = E(f"(() => {{ const d = T.ed('{t1}').state.doc; const out = new Set(); d.nodesBetween(1, 4, (n) => {{ if (n.isText) n.marks.forEach((m) => out.add(m.type.name)); }}); return [...out].sort(); }})()")
    st0 = E(f"T.ed('{t1}').results[0].lines[0].pieces[0].style")
    check('C1 고른 글자(굵게·28px·빨강)로 "새 글자 프리셋" → 글자 프리셋(종류 글자)에 모양이 담기고, 그 글자는 프리셋 마크만(모양 마크는 지움), 보이는 모양 그대로',
          cid and ps[cid]['style']['fontSize'] == 28 and ps[cid]['style']['fontWeight'] == 700 and mk == ['charStyle'] and st0['fontSize'] == 28 and st0['color'] == '#c0392b', {'ps': ps, 'marks': mk})
    kb.press('Escape')
    E(f"T.V.select(['{t2}'])"); kb.press('Enter')
    E(f"(() => {{ const ed = T.ed('{t2}'); const TS = ed.state.selection.constructor; ed.setSelection(TS.create(ed.state.doc, 1, 3)); }})()")
    E(f"T.setSel('글자 프리셋', '{cid}')")
    s2 = E(f"T.ed('{t2}').results[0].lines[0].pieces[0].style")
    check('C2 다른 글상자의 글자에 글자 프리셋 적용 → 28px·굵게·빨강, 나머지 글자는 그대로 20px', s2['fontSize'] == 28 and s2['fontWeight'] == 700 and E(f"T.fontSizes('{t2}')") == [20, 28] or sorted(E(f"T.fontSizes('{t2}')")) == [20, 28], s2)
    kb.press('Escape')
    E(f"T.V.definePreset('{cid}', {{ style: {{ ...T.V.presets['{cid}'].style, fontSize: 34 }} }})")
    check('C3 글자 프리셋을 34px로 다시 정의 → 두 글상자의 그 글자 모두 34px', E(f"T.ed('{t1}').results[0].lines[0].pieces[0].style.fontSize") == 34 and E(f"T.ed('{t2}').results[0].lines[0].pieces[0].style.fontSize") == 34)
    E("__nabi.history.undo()")
    check('C4 되돌리기 → 28px', E(f"T.ed('{t2}').results[0].lines[0].pieces[0].style.fontSize") == 28)
    # 문단 프리셋 위에 글자 프리셋, 그 위에 개별 꾸밈
    E(f"T.V.definePreset('para1', {{ name: '본문', style: {{ fontSize: 18, color: '#333333' }} }})")
    E(f"T.ed('{t2}').applyPreset('para1', true)")
    E(f"(() => {{ const ed = T.ed('{t2}'); const TS = ed.state.selection.constructor; ed.setSelection(TS.create(ed.state.doc, 1, 2)); ed.setMark('color', {{ value: '#0000ff' }}); }})()")
    ps_ = E(f"T.ed('{t2}').results[0].lines[0].pieces.map((p) => [p.text, p.style.fontSize, p.style.color])")
    check('C5 겹침 순서: 문단 프리셋(18px) < 글자 프리셋(28px) < 개별 꾸밈(파랑)', ps_[0][1] == 28 and ps_[0][2] == '#0000ff' and any(x[1] == 18 and x[2] == '#333333' for x in ps_), ps_)
    # 자동 축소도 글자 프리셋 크기에 배율
    E(f"T.V.setProps({{ autoShrink: true, h: 30 }}, ['{t1}'])")
    sc = E(f"T.ed('{t1}').scale")
    fs1 = E(f"T.ed('{t1}').results[0].lines[0].pieces[0].style.fontSize")
    check('C6 자동 축소 배율이 글자 프리셋 크기에도 곱해짐', sc < 1 and close(fs1, 28 * sc, 0.002), [sc, fs1])
    E(f"T.V.setProps({{ autoShrink: false, h: 200 }}, ['{t1}'])")
    j0 = json.loads(E("T.snap()"))
    zipb = E("(async () => { const { bytes } = await __nabi.P.toZip(__nabi.app.project, { assets: __nabi.assets, docOf: T.V.docOf, swatches: [] }); return Array.from(bytes); })()")
    pg2 = open_page(); pg2.evaluate("(z) => __nabi.openBytes(new Uint8Array(z), null, 'c.nabi')", zipb)
    j1 = json.loads(pg2.evaluate("T.snap()"))
    fsr = pg2.evaluate(f"T.ed('{t2}').results[0].lines[0].pieces[0].style.fontSize")
    pg2.close()
    check('C7 저장·열기 → 글자 프리셋(종류 포함)·글자의 프리셋 연결 그대로, 열린 창에서도 28px', j0['styles'] == j1['styles'] and j1['styles'][cid].get('kind') == 'char' and j0['pages'] == j1['pages'] and fsr == 28)
    E(f"T.V.deletePreset('{cid}')")
    check('C8 글자 프리셋 지우기 → 그 글자는 문단 모양(18px)으로', E(f"T.ed('{t2}').results[0].lines[0].pieces[0].style.fontSize") == 18)

    # ============ D. 선택한 장 내보내기 ============
    E("T.reset(400, 300)")
    ids = [E("__nabi.app.current.id")]
    for _ in range(3): E("__nabi.app.addPage()"); ids.append(E("__nabi.app.current.id"))
    click(E(f"T.rowPt('{ids[0]}')")); time.sleep(0.1)
    kb.down('Control'); click(E(f"T.rowPt('{ids[2]}')")); click(E(f"T.rowPt('{ids[3]}')")); kb.up('Control')
    time.sleep(0.1)
    sel = E("__nabi.app.selectedPages().map((p) => p.id)")
    marked = E("[...document.querySelectorAll('#pagesList .pg-row.sel')].map((r) => r.dataset.id)")
    label = E("document.getElementById('exRange').options[2].textContent")
    check('D1 장 목록 Ctrl+클릭으로 1·3·4장 선택 → 표시되고, 내보내기 범위에 "선택한 장 (3)"', sel == [ids[0], ids[2], ids[3]] and marked == sel and label == '선택한 장 (3)', {'sel': sel, 'label': label})
    E("""(() => { window.__written = {}; window.showDirectoryPicker = async () => ({ getFileHandle: async (n) => ({ createWritable: async () => ({ write: async (b) => { __written[n] = b.size; }, close: async () => {} }) }) }); })()""")
    if pg.evaluate("document.getElementById('exportPop')?.hidden === true"): pg.click('#exportBtn')  # 내보내기 설정은 내보내기 창 안(12단계 개편)
    pg.select_option('#exRange', 'selected'); pg.select_option('#exFormat', 'png'); pg.select_option('#exScale', '1')
    E("document.getElementById('exRun').click()")
    pg.wait_for_function("Object.keys(window.__written).length === 3", timeout=20000)
    names = sorted(E("Object.keys(__written)"))
    check('D2 "선택한 장" 내보내기 → 선택한 3장만, 파일 이름의 장 번호는 프로젝트 순서(_1, _3, _4)', names == ['제목 없음_1.png', '제목 없음_3.png', '제목 없음_4.png'], names)
    click(E(f"T.rowPt('{ids[1]}')")); time.sleep(0.1)
    check('D3 그냥 클릭 → 그 장 하나만 선택', E("__nabi.app.selectedPages().map((p) => p.id)") == [ids[1]])
    kb.down('Shift'); click(E(f"T.rowPt('{ids[3]}')")); kb.up('Shift'); time.sleep(0.1)
    check('D4 Shift+클릭 → 범위 선택(2–4장)', E("__nabi.app.selectedPages().map((p) => p.id)") == ids[1:])
    if pg.evaluate("document.getElementById('exportPop')?.hidden === true"): pg.click('#exportBtn')  # 내보내기 설정은 내보내기 창 안(12단계 개편)
    pg.select_option('#exRange', 'current')

    # ============ E. 장 배경 이미지 ============
    E("T.reset(600, 400)")
    ph = E("T.photo(300, 300, '#e63946', '#1d3557')")
    E(f"__nabi.app.pickImage = async () => ({{ src: {json.dumps(ph['src'])}, w: 300, h: 300 }})")
    E("T.V.select([])")
    E("T.btn('배경 이미지…')"); time.sleep(0.2)
    bgi = E("T.V.page.bgImage")
    A = np.asarray(img(E("T.raster()")).convert('RGB'))
    check('E1 장 속성 "배경 이미지…" → 장 배경에 이미지(채우기): 출력 네 귀퉁이도 흰색이 아님', bgi and bgi['src'] == ph['src'] and bgi['fit'] == 'cover' and all(A[y, x].tolist() != [255, 255, 255] for y, x in [(2, 2), (2, 597), (397, 2), (397, 597)]), bgi)
    E("T.add('text', { x: 40, y: 40, w: 300, h: 100, style: { fontSize: 28, color: '#ffffff' }, doc: T.longDoc('배경 위 글') })")
    m = screen_vs_export('bg-cover')
    check(f'E2 배경 이미지 + 글상자 출력 = 화면 ({m.get("pct16")}%)', same_as_screen(m), m)
    E("T.setSel('배경 맞춤', 'contain')")
    A = np.asarray(img(E("T.raster()")).convert('RGB'))
    check('E3 배경 맞춤 = 맞추기 → 좌우 빈 곳은 장 배경색(흰색), 가운데는 이미지', A[200, 10].tolist() == [255, 255, 255] and A[200, 300].tolist() != [255, 255, 255], [A[200, 10].tolist(), A[200, 300].tolist()])
    tr_ = np.asarray(img(E("(async () => (await __EX.rasterize(T.V.exportPage(), { scale: 1, transparent: true })).toDataURL())()")).convert('RGBA'))
    check('E4 투명 출력 → 장 배경색만 빠지고 배경 이미지는 남음', tr_[200, 10, 3] == 0 and tr_[200, 300, 3] == 255, [int(tr_[200, 10, 3]), int(tr_[200, 300, 3])])
    zipb = E("(async () => { const { bytes, json } = await __nabi.P.toZip(__nabi.app.project, { assets: __nabi.assets, docOf: T.V.docOf, swatches: [] }); window.__pj = JSON.stringify(json); return Array.from(bytes); })()")
    pj = json.loads(E("window.__pj"))
    pg2 = open_page(); pg2.evaluate("(z) => __nabi.openBytes(new Uint8Array(z), null, 'bg.nabi')", zipb)
    fit2 = pg2.evaluate("__nabi.view.page.bgImage && __nabi.view.page.bgImage.fit")
    B = np.asarray(img(pg2.evaluate("T.raster()")).convert('RGB'))
    pg2.close()
    check('E5 저장: 배경 이미지가 에셋(assets/…)으로, 다른 창에서 열면 같은 출력', pj['pages'][0]['bgImage']['src'].startswith('assets/') and fit2 == 'contain' and np.abs(A.astype(int) - B.astype(int)).max() == 0, pj['pages'][0].get('bgImage'))
    E("T.btn('배경 이미지 빼기')")
    E("__nabi.history.undo()")
    check('E6 배경 이미지 빼기 → 되돌리기로 복원', E("!!T.V.page.bgImage"))
    # 배경 맞춤을 바꾼 뒤에도 패널이 새 값을 보여야 함(예전: 패널이 만들 때의 배경 객체를 붙잡아 옛 값으로 되돌아감)
    E("T.setSel('배경 맞춤', 'tile')"); E("T.setSel('배경 맞춤', 'fill')")
    E("(() => { __nabi.flush(); })()")
    fv = E("[document.querySelector('#props [data-field=\"배경 맞춤\"]').value, T.V.page.bgImage.fit]")
    check('E7 배경 맞춤을 두 번 바꿔도 패널 값 = 장 값(늘이기)', fv == ['fill', 'fill'], fv)
    # 장을 바꾸면 패널은 새로 만들지 않고 값만 그 장 것으로
    E("(() => { const A = __nabi.app; A.addPage ? A.addPage() : T.V.addPageAfter(T.V.page); })()")
    E("(() => { const A = __nabi.app, p2 = A.project.pages[A.project.pages.length - 1]; p2.w = 321; A.switchPage(p2); })()")
    E("(() => { __nabi.flush(); })()")
    wv = E("[document.querySelector('#props [data-field=\"너비\"]').value, !!document.querySelector('#props [data-field=\"배경 맞춤\"]')]")
    E("__nabi.app.switchPage(__nabi.app.project.pages[0])"); E("(() => { __nabi.flush(); })()")
    wv0 = E("[document.querySelector('#props [data-field=\"너비\"]').value, document.querySelector('#props [data-field=\"배경 맞춤\"]')?.value]")
    check('E8 장을 오가면 장 속성 패널이 그 장 값(너비 321 / 배경 이미지 없음 ↔ 원래 장 너비·늘이기)', wv == ['321', False] and wv0[1] == 'fill' and wv0[0] != '321', [wv, wv0])

    # ============ F. 단축키 설정 ============
    E("T.reset(600, 400)")
    r1 = E("T.add('shape', { x: 50, y: 50, w: 100, h: 80 })")
    def open_settings():
        click(E("(() => { const r = document.getElementById('settings').getBoundingClientRect(); return { x: r.left + 5, y: r.top + 5 }; })()")); time.sleep(0.2)
    def row_btn(scope, cmd, what):
        pg.click(f'.settings .st-row[data-scope="{scope}"][data-cmd="{cmd}"] [data-{what}]')
    open_settings()
    row_btn('app', 'duplicate', 'add')
    kb.press('Control+j')
    note = E("document.querySelector('.st-note').textContent")
    chips = E("[...document.querySelectorAll('.st-row[data-scope=app][data-cmd=duplicate] .st-key')].map((k) => k.dataset.key)")
    pg.click('.settings [data-v=close]')
    E(f"T.V.select(['{r1}'])"); E("T.V.viewport.focus()")
    n0 = len(E("T.ids()")); kb.press('Control+j'); n1 = len(E("T.ids()"))
    check('F1 설정 → "복제"에 키 추가 → Ctrl+J 누름 → 목록에 Ctrl+J, 캔버스에서 Ctrl+J = 복제', 'Mod-j' in chips and n1 == n0 + 1, {'chips': chips, 'note': note, 'n': [n0, n1]})
    open_settings()
    pg.click('.settings .st-row[data-scope="app"][data-cmd="duplicate"] .st-key[data-key="Mod-d"] [data-del]')
    pg.click('.settings [data-v=close]')
    E("T.V.viewport.focus()"); n0 = len(E("T.ids()")); kb.press('Control+d'); n1 = len(E("T.ids()"))
    check('F2 기본 키 Ctrl+D를 빼면 Ctrl+D로 복제되지 않음', n1 == n0, [n0, n1])
    open_settings()
    row_btn('app', 'duplicate', 'add'); kb.press('Control+g')
    note = E("document.querySelector('.st-note').textContent")
    grp = E("[...document.querySelectorAll('.st-row[data-scope=app][data-cmd=group] .st-key')].length")
    check('F3 다른 명령(그룹)에 쓰던 Ctrl+G를 복제에 걸면 그룹에서 빠지고 안내가 나옴', '그룹' in note and grp == 0, note)
    row_btn('edit', 'bold', 'add'); kb.press('b')
    note_b = E("document.querySelector('.st-note').textContent")
    capturing = E("!!document.querySelector('.st-capture')")
    kb.press('Control+Shift+b')
    bold_keys = E("[...document.querySelectorAll('.st-row[data-scope=edit][data-cmd=bold] .st-key')].map((k) => k.dataset.key)")
    check('F4 글 편집 단축키에 수식키 없는 글자(B)는 거절(안내 후 계속 기다림), Ctrl+Shift+B는 받음', '쓸 수 없습니다' in note_b and capturing and 'Mod-Shift-b' in bold_keys and 'Mod-b' in bold_keys, [note_b, bold_keys])
    pg.click('.settings [data-v=close]')
    t = E("T.add('text', { x: 200, y: 200, w: 300, h: 80, style: { fontSize: 24 }, doc: T.longDoc('굵게 시험') })")
    E(f"T.V.select(['{t}'])"); kb.press('Enter'); kb.press('Control+a'); kb.press('Control+Shift+b')
    bst = E(f"T.ed('{t}').markStateOn('bold', true).state")
    kb.press('Escape')
    check('F5 편집 중 Ctrl+Shift+B = 굵게(새로 건 키)', bst == 'all', bst)
    pg.reload(); pg.wait_for_function('window.__nabi && window.__nabi.ready'); time.sleep(0.3)
    if E("!!document.querySelector('.modal-bg')"): pg.click('.modal-bg [data-v=discard]')
    pg.evaluate(HELPERS)
    kept = E("[__nabi.appKeymap.get('Mod-j'), __nabi.appKeymap.get('Mod-d') ?? null, __nabi.appKeymap.get('Mod-g'), __nabi.keymap.get('Mod-Shift-b')]")
    check('F6 새로 열어도 재지정 유지(이 컴퓨터에 저장)', kept == ['duplicate', None, 'duplicate', 'bold'], kept)
    open_settings()
    pg.click('.settings [data-reset=app]'); pg.click('.settings [data-reset=edit]')
    pg.click('.settings [data-v=close]')
    back = E("[__nabi.appKeymap.get('Mod-j') ?? null, __nabi.appKeymap.get('Mod-d'), __nabi.appKeymap.get('Mod-g'), __nabi.keymap.get('Mod-Shift-b') ?? null]")
    check('F7 "모두 기본값으로" → 기본 배치로 돌아감', back == [None, 'duplicate', 'group', None], back)

    check('Z 검증 전체 동안 페이지 오류 없음', not errors, errors)
    b.close()

for name, ok, detail in results:
    print(('PASS ' if ok else 'FAIL ') + name + ('' if ok else '  ' + json.dumps(detail, ensure_ascii=False, default=str)[:600]))
print('metrics:', json.dumps(metrics, ensure_ascii=False))
print(f"{sum(ok for _, ok, _ in results)}/{len(results)} passed")
