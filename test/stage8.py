"""8단계 검증(웹판): 여러 장, 프로젝트 저장·열기(zip), 에셋 라이브러리(해시·중복 제거), 업로드 글꼴 포함,
자동 저장·비정상 종료 복구, 저장 안 한 변경 확인.
사용: python3 test/stage8.py  (proto 폴더 기준)
파일 저장·열기 창(File System Access API)은 메모리 파일로 바꿔 끼운다(실제 창은 사람이 확인).
"""
import json, os, io, time, base64, zipfile, threading, functools, hashlib
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from playwright.sync_api import sync_playwright
from PIL import Image
import numpy as np

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
UPLOAD_FONT = '/usr/share/texmf/fonts/opentype/public/tex-gyre/texgyrecursor-regular.otf'
class Quiet(SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
srv = ThreadingHTTPServer(('127.0.0.1', 0), functools.partial(Quiet, directory=ROOT))
threading.Thread(target=srv.serve_forever, daemon=True).start()
ORIGIN = f'http://127.0.0.1:{srv.server_port}'

results, metrics = [], {}
def check(name, ok, detail=''):
    results.append((name, bool(ok), detail))

HELPERS = r"""
(() => {
  const N = __nabi, V = N.view, M = N.M;
  window.T = {
    N, V, M,
    add: (type, props) => { const n = M.makeElement(type, props); V.change('create', () => { V.page.elements.push(n); }); return n.id; },
    pages: () => N.app.project.pages.map((p) => ({ id: p.id, name: p.name, n: p.elements.length, w: p.w })),
    cur: () => N.app.project.pages.indexOf(N.app.current),
    rows: () => { N.flush(); return [...document.querySelectorAll('#pagesList .pg-row:not(.pg-master)')].map((r) => ({ id: r.dataset.id, cur: r.classList.contains('cur'), name: r.querySelector('.pg-name').textContent })); },
    rowPt: (id, fy = 0.5) => { N.flush(); const r = document.querySelector(`#pagesList .pg-row[data-id="${id}"]`).getBoundingClientRect(); return { x: r.left + 40, y: r.top + r.height * fy }; },
    btn: (id) => { const r = document.getElementById(id).getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; },
    domIds: () => [...V.pageEl.children].filter((c) => c.parentNode).map((c) => c.dataset.id),
    // 프로젝트 비교용 JSON(에셋 주소는 해시 기반 경로라 열기 전후가 같아야 함)
    snap: async () => { const r = await N.P.toJSON(N.app.project, { assets: N.assets, docOf: V.docOf, swatches: N.swatches.list }); const j = r.json; delete j.savedAt; return JSON.stringify(j); },
    b64: (u8) => { let s = ''; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode(...u8.subarray(i, i + 0x8000)); return btoa(s); },
    fromB64: (s) => { const b = atob(s), u = new Uint8Array(b.length); for (let i = 0; i < b.length; i++) u[i] = b.charCodeAt(i); return u; },
    raster: async (i) => { const EX = await import('/src/export.js'); return (await EX.rasterize(V.exportPage(N.app.project.pages[i]), { scale: 1 })).toDataURL(); },
    modal: () => { const m = document.querySelector('.modal-bg'); return m && { text: m.querySelector('p').textContent, buttons: [...m.querySelectorAll('button')].map((b) => b.textContent) }; },
    press: (label) => { const b = [...document.querySelectorAll('.modal-bg button')].find((x) => x.textContent === label); b.click(); },
    // 파일 저장·열기 창을 메모리 파일로
    mockFS: () => {
      window.__fs = { saves: 0, opens: 0, pickerSaves: 0, bytes: null, openBytes: null };
      window.showSaveFilePicker = async (o) => { __fs.pickerSaves++; __fs.suggested = o.suggestedName; return {
        name: o.suggestedName, createWritable: async () => ({ write: async (b) => { __fs.bytes = new Uint8Array(await new Blob([b]).arrayBuffer()); __fs.saves++; }, close: async () => {} }) }; };
      window.showOpenFilePicker = async () => { __fs.opens++; return [{ getFile: async () => new File([__fs.openBytes], __fs.openName || '열 파일.nabi') }]; };
    },
    idb: () => new Promise((res) => { const r = indexedDB.open('nabitext', 1); r.onsuccess = () => { const d = r.result; const g = d.transaction('recovery').objectStore('recovery').getAll(); g.onsuccess = () => { const x = g.result.sort((a, b) => b.savedAt - a.savedAt)[0]; res(x ? { name: x.name, savedAt: x.savedAt, pages: x.json.pages.length } : null); }; }; r.onerror = () => res('err'); }),
  };
  return true;
})()
"""

def img(u): return Image.open(io.BytesIO(base64.b64decode(u.split(',', 1)[1])))
def cmp(a, b):
    A = np.asarray(a.convert('RGB')).astype(int); B = np.asarray(b.convert('RGB')).astype(int)
    d = np.abs(A - B).max(axis=2)
    nb = None
    for dy in (-1, 0, 1):
        for dx in (-1, 0, 1):
            e = np.abs(A - np.roll(np.roll(B, dy, 0), dx, 1)).max(axis=2)
            nb = e if nb is None else np.minimum(nb, e)
    return {'max': int(d.max()), 'px16': int((d > 16).sum()), 'pct16': round(float((d > 16).mean()) * 100, 4), 'nb_pct64': round(float((nb[1:-1, 1:-1] > 64).mean()) * 100, 4)}
def maxdiff(a, b):
    A = np.asarray(a.convert('RGB')).astype(int); B = np.asarray(b.convert('RGB')).astype(int)
    return int(np.abs(A - B).max()) if A.shape == B.shape else 999

with sync_playwright() as p:
    b = p.chromium.launch(args=['--disable-lcd-text'])
    ctx = b.new_context(viewport={'width': 1500, 'height': 1000}, accept_downloads=True)
    errors = []
    def open_page():
        pg = ctx.new_page()
        pg.route('**/fonts.googleapis.com/**', lambda r: r.abort())
        pg.on('pageerror', lambda e: errors.append(str(e)))
        pg.on('console', lambda m: m.type == 'error' and 'ERR_FAILED' not in m.text and errors.append(m.text))
        pg.goto(ORIGIN + '/index.html')
        pg.wait_for_function('window.__nabi && window.__nabi.ready', timeout=30000)
        pg.evaluate(HELPERS)
        return pg
    pg = open_page()
    E = lambda js, arg=None: pg.evaluate(js, arg) if arg is not None else pg.evaluate(js)
    mouse, kb = pg.mouse, pg.keyboard
    def click(pt, count=1): mouse.click(pt['x'], pt['y'], click_count=count)

    # ============ A. 여러 장 ============
    p1 = E("T.pages()[0].id")
    check('A1 시작: 장 1개, 장 목록에 1개(현재 장 강조), 장 삭제 버튼 꺼짐', len(E("T.pages()")) == 1 and E("T.rows()")[0]['cur'] and E("document.getElementById('pageDel').disabled"))
    a1 = E("T.add('shape', { x: 100, y: 100, w: 200, h: 200, fill: '#ff8800' })")
    click(E("T.btn('pageAdd')"))
    pgs = E("T.pages()")
    p2 = pgs[1]['id']
    check('A2 ＋ → 지금 장 뒤에 같은 크기의 새 장, 그 장으로 이동, 캔버스는 빈 장', len(pgs) == 2 and E("T.cur()") == 1 and pgs[1]['w'] == 1080 and E("T.domIds()") == [], pgs)
    t2 = E("T.add('text', { x: 100, y: 400, w: 500, h: 120, doc: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: '둘째 장의 글' }] }] } })")
    click(E(f"T.rowPt('{p1}')"))
    d1 = E("T.domIds()")
    click(E(f"T.rowPt('{p2}')"))
    d2 = E("T.domIds()")
    check('A3 장 목록 클릭으로 전환, 장마다 자기 요소만 그림', d1 == [a1] and d2 == [t2] and E("T.cur()") == 1, [d1, d2])
    click(E("T.btn('pageDup')"))
    pgs = E("T.pages()")
    p3 = pgs[2]['id']
    t3 = E("T.V.page.elements[0].id")
    E(f"T.V.enterEdit('{t3}')"); pg.keyboard.type('!'); kb.press('Escape')
    check('A4 복제 → 바로 뒤에 새 id의 복사본(글 포함), 복사본 글을 고쳐도 원본은 그대로',
          len(pgs) == 3 and pgs[2]['name'] == '' and t3 != t2 and E(f"T.V.editors.get('{t3}').text") != '둘째 장의 글' and E(f"T.V.editors.get('{t2}').text") == '둘째 장의 글', pgs)
    # 끌어서 순서 바꾸기: 셋째 장을 맨 앞으로
    mouse.move(**E(f"T.rowPt('{p3}')")); mouse.down(); mouse.move(**E(f"T.rowPt('{p1}', 0.1)"), steps=8); mouse.up()
    order = [x['id'] for x in E("T.pages()")]
    E("__nabi.history.undo()")
    order2 = [x['id'] for x in E("T.pages()")]
    check('A5 장 끌어 놓기로 순서 변경, 되돌리기로 원래 순서', order == [p3, p1, p2] and order2 == [p1, p2, p3], [order, order2])
    click(E(f"T.rowPt('{p2}')")); click(E("T.btn('pageDel')"))
    after_del = [x['id'] for x in E("T.pages()")]
    E("__nabi.history.undo()")
    back = [x['id'] for x in E("T.pages()")]
    check('A6 장 삭제 → 되돌리기로 내용까지 복원', after_del == [p1, p3] and back == [p1, p2, p3] and E(f"T.V.editors.get('{t2}').text") == '둘째 장의 글', [after_del, back])
    # 다른 장의 변경을 되돌리면 그 장으로 이동
    click(E(f"T.rowPt('{p1}')"))
    E(f"T.V.select(['{a1}']); T.V.nudge(15, 0)")
    click(E(f"T.rowPt('{p3}')"))
    E("__nabi.history.undo()")
    cur_after = E("T.cur()"); ax = E(f"T.V.node('{a1}') && T.V.node('{a1}').x")
    check('A7 다른 장에서 되돌리기 → 그 변경이 있던 장으로 이동해 되돌림', cur_after == 0 and ax == 100, [cur_after, ax])
    click(E(f"T.rowPt('{p3}')"))
    E(f"T.V.enterEdit('{t3}')"); pg.keyboard.type('?'); kb.press('Escape')
    click(E(f"T.rowPt('{p1}')"))
    E("__nabi.history.undo()")
    check('A8 다른 장의 글 입력을 되돌리면 그 장으로 이동', E("T.cur()") == 2 and not E(f"T.V.editors.get('{t3}').text").endswith('?'), [E("T.cur()"), E(f"T.V.editors.get('{t3}').text")])
    click(E(f"T.rowPt('{p1}')"), count=2); time.sleep(0.1); kb.type('표지'); kb.press('Enter')
    check('A9 장 이름 더블클릭 → 바꾸기', E("T.pages()[0].name") == '표지' and E("T.rows()")[0]['name'] == '표지')
    # 내보내기: 모든 장 → 폴더(메모리), 현재 장 → 장 번호 유지
    E("""(() => { window.__written = {}; window.showDirectoryPicker = async () => ({ getFileHandle: async (n) => ({ createWritable: async () => ({ write: async (b) => { __written[n] = b.size; }, close: async () => {} }) }) }); })()""")
    if pg.evaluate("document.getElementById('exportPop')?.hidden === true"): pg.click('#exportBtn')  # 내보내기 설정은 내보내기 창 안(12단계 개편)
    pg.select_option('#exRange', 'all'); pg.select_option('#exFormat', 'png'); pg.select_option('#exScale', '1')
    click(E("T.btn('exRun')"))
    pg.wait_for_function("Object.keys(window.__written).length === 3", timeout=20000)
    names = sorted(E("Object.keys(__written)"))
    click(E(f"T.rowPt('{p3}')"))
    if pg.evaluate("document.getElementById('exportPop')?.hidden === true"): pg.click('#exportBtn')  # 내보내기 설정은 내보내기 창 안(12단계 개편)
    pg.select_option('#exRange', 'current')
    with pg.expect_download() as dl: click(E("T.btn('exRun')"))
    check('A10 모든 장 내보내기 → 제목 없음_1–3.png, 현재 장(3번째)만 → 제목 없음_3.png', names == ['제목 없음_1.png', '제목 없음_2.png', '제목 없음_3.png'] and dl.value.suggested_filename == '제목 없음_3.png', [names, dl.value.suggested_filename])

    # ============ B. 에셋·저장·열기 ============
    E("T.mockFS()")
    # 같은 PNG를 두 번 넣고(중복 제거), 글상자 안 이미지, 원격(같은 출처 http) 이미지, 업로드 글꼴
    click(E(f"T.rowPt('{p1}')"))
    E("""(async () => {
      const c = new OffscreenCanvas(60, 40); const x = c.getContext('2d'); x.fillStyle = '#2b3a66'; x.fillRect(0, 0, 60, 40); x.fillStyle = '#f4b942'; x.fillRect(10, 10, 20, 20);
      const blob = await c.convertToBlob({ type: 'image/png' });
      window.__i1 = await T.V.addImage(blob, { x: 300, y: 300 });
      window.__i2 = await T.V.addImage(new Blob([await blob.arrayBuffer()], { type: 'image/png' }), { x: 500, y: 300 });
      window.__i3 = await T.V.addImage('/res/icon.png', { x: 700, y: 300 });
      const a = await __nabi.assets.add(blob);
      window.__ti = T.add('text', { x: 100, y: 600, w: 600, h: 300, doc: { type: 'doc', content: [
        { type: 'paragraph', content: [{ type: 'text', text: 'Upload font 글꼴', marks: [{ type: 'font', attrs: { value: '"TeX Gyre Cursor"' } }, { type: 'bold' }] }] },
        { type: 'image', attrs: { src: a.url, width: 60 } }] } });
    })()""")
    pg.set_input_files('#fontFile', UPLOAD_FONT)
    pg.wait_for_function("__nabi.app.project.fonts.length === 1", timeout=10000)
    time.sleep(0.3)
    E("__nabi.swatches.add('#123abc')")
    same_asset = E("T.V.node(__i1.id).src === T.V.node(__i2.id).src && T.V.node(__i1.id).src.startsWith('blob:')")
    remote_to_asset = E("T.V.node(__i3.id).src.startsWith('blob:') && !!__nabi.assets.ofUrl(T.V.node(__i3.id).src)")
    check('B1 같은 이미지 두 번 → 에셋 하나(같은 주소), 원격(http) 이미지도 에셋으로 가져옴', same_asset and remote_to_asset, [same_asset, remote_to_asset])
    title_dirty = E("document.title")
    kb.press('Control+s')
    pg.wait_for_function("window.__fs.saves === 1", timeout=20000)
    time.sleep(0.2)
    saved = base64.b64decode(E("T.b64(__fs.bytes)"))
    z = zipfile.ZipFile(io.BytesIO(saved))
    names = sorted(z.namelist())
    pj = json.loads(z.read('project.json'))
    assets = [n for n in names if n.startswith('assets/')]
    hashes_ok = all(hashlib.sha256(z.read(n)).hexdigest()[:32] == n.split('/')[1].split('.')[0] for n in assets)
    pj_text = z.read('project.json').decode()
    exts = sorted(n.rsplit('.', 1)[1] for n in assets)
    check(f'B2 Ctrl+S → 저장 창 1번, zip = project.json + 에셋 {len(assets)}개(PNG 2종 + 글꼴 1개, 같은 PNG는 하나), 파일 이름 = 내용 해시, project.json에 blob: 주소 없음',
          E("__fs.suggested") == '제목 없음.nabi' and exts == ['otf', 'png', 'png'] and hashes_ok and 'blob:' not in pj_text and pj['format'] == 'nabitext' and len(pj['pages']) == 3 and pj['fonts'][0]['family'] == 'TeX Gyre Cursor' and '#123abc' in pj['swatches'],
          {'names': names, 'fonts': pj['fonts'], 'hashes_ok': hashes_ok})
    doc_img = [n for n in pj['pages'][0]['elements'] if n['type'] == 'text'][0]['doc']['content'][1]['attrs']['src']
    check('B3 글상자 문서 안 이미지도 assets/ 경로로 저장(요소 이미지와 같은 에셋)', doc_img.startswith('assets/') and doc_img in [n['src'] for n in pj['pages'][0]['elements'] if n['type'] == 'image'], doc_img)
    check('B4 제목 표시: 변경 있음 ● → 저장 후 사라짐 → 다시 바꾸면 ●', title_dirty.startswith('●') and not E("document.title").startswith('●'), [title_dirty, E("document.title")])
    E(f"T.V.select([__i1.id]); T.V.nudge(1, 0)")
    dirty_again = E("document.title").startswith('●')
    kb.press('Control+s')
    pg.wait_for_function("window.__fs.saves === 2", timeout=20000)
    check('B5 두 번째 Ctrl+S는 창 없이 같은 파일에 저장', E("__fs.pickerSaves") == 1 and dirty_again and not E("document.title").startswith('●'), E("[__fs.pickerSaves, __fs.saves]"))
    saved = base64.b64decode(E("T.b64(__fs.bytes)"))
    snap0 = E("T.snap()")
    ras0 = [E(f"T.raster({i})") for i in range(3)]
    # 새 창에서 열기
    pg2 = open_page()
    E2 = lambda js, arg=None: pg2.evaluate(js, arg) if arg is not None else pg2.evaluate(js)
    E2("T.mockFS()")
    E2("(b) => { __fs.openBytes = T.fromB64(b); __fs.openName = '다른 이름.nabi'; }", base64.b64encode(saved).decode())
    pg2.keyboard.press('Control+o')
    pg2.wait_for_function("__nabi.app.project.pages.length === 3", timeout=20000)
    time.sleep(0.5)
    snap1 = E2("T.snap()")
    ras1 = [E2(f"T.raster({i})") for i in range(3)]
    diffs = [maxdiff(img(x), img(y)) for x, y in zip(ras0, ras1)]
    for i, d in enumerate(diffs):
        if d: img(ras0[i]).save(os.path.join(ROOT, 'test', 'out', f'stage8-p{i}-orig.png')); img(ras1[i]).save(os.path.join(ROOT, 'test', 'out', f'stage8-p{i}-open.png'))
    j0, j1 = json.loads(snap0), json.loads(snap1)
    check('B6 다른 창에서 Ctrl+O로 열기 → 장·요소·글(꾸밈 포함)·에셋 경로·글꼴·스와치가 같음, 프로젝트 이름 = 파일 이름',
          j0['pages'] == j1['pages'] and j0['fonts'] == j1['fonts'] and j0['swatches'] == j1['swatches'] and E2("__nabi.app.project.name") == '다른 이름' and not E2("document.title").startswith('●'),
          {'name': E2("__nabi.app.project.name")})
    pc = f"(() => {{ const ed = T.V.editors.get('{t3}'); return [ed.state.doc.toJSON(), ed.result.lines[0].pieces.slice(0, 3).map((p) => [p.text, p.x, p.w, p.style.fontFamily, p.style.fontSize])]; }})()"
    self_diff = [maxdiff(img(E(f"T.raster({i})")), img(ras0[i])) for i in range(3)]
    open_self = [maxdiff(img(E2(f"T.raster({i})")), img(ras1[i])) for i in range(3)]
    dom = "(async () => { const pg = __nabi.app.project.pages[2]; const el = T.V.exportPage(pg).render(); const fams = new Set(); for (const e of [el, ...el.querySelectorAll('*')]) if (e.style.fontFamily) fams.add(e.style.fontFamily); const css = await __nabi.fonts.cssFor([...fams].flatMap((f) => f.split(',').map((x) => x.trim().replace(/^\"|\"$/g, ''))), el.textContent); return [el.outerHTML, css.length, [...fams], [...document.fonts].map((f) => f.family + ':' + f.status)]; })()"
    d0, d1 = E(dom), E2(dom)
    metrics['reopen-dom'] = {'same_html': d0[0] == d1[0], 'css': [d0[1], d1[1]], 'fams': d0[2], 'docfonts': [d0[3], d1[3]]}
    if d0[0] != d1[0]:
        import difflib; metrics['reopen-dom']['diff'] = [l for l in difflib.unified_diff(d0[0].split('><'), d1[0].split('><'), lineterm='')][:12]
    metrics['reopen-raster-diff'] = {'orig-vs-open': diffs, 'orig-again': self_diff, 'open-again': open_self}
    cm = [cmp(img(x), img(y)) for x, y in zip(ras0, ras1)]
    metrics['reopen-compare'] = cm
    # 같은 창에서는 몇 번을 그려도 같지만, 창이 다르면 글자 하나의 가장자리가 다른 경우가 있었다(DOM·글꼴 CSS·등록 글꼴은 같음, 원인 미확정).
    # 그래서 위치(1px 이웃 허용 64 초과 0)와 다른 픽셀 수를 본다.
    check(f'B7 연 프로젝트의 장 3개 출력 = 원래 창 출력: 위치 일치(이웃 허용 차이 0), 16 넘게 다른 픽셀 {[c["px16"] for c in cm]}개(최대 차이 {diffs}) — 업로드 글꼴·이미지 포함',
          all(c['nb_pct64'] == 0 and c['pct16'] < 0.01 for c in cm), {'cmp': cm, 'self': [self_diff, open_self]})
    ff = E2("[...document.fonts].some((f) => f.family.replace(/\"/g, '') === 'TeX Gyre Cursor' && f.status === 'loaded')")
    check('B8 연 창에 업로드 글꼴이 등록되고 글꼴 목록에 들어감', ff and E2("[...document.querySelectorAll('#pp-fonts option')].some((o) => o.value === 'TeX Gyre Cursor')"))
    # 손상 파일
    zb = io.BytesIO(); zi = zipfile.ZipFile(io.BytesIO(saved))
    with zipfile.ZipFile(zb, 'w') as zo:
        for n in zi.namelist():
            data = zi.read(n)
            if n.endswith('.png') and n.startswith('assets/'): data = data[:-10] + b'0123456789'
            zo.writestr(n, data)
    E2("(b) => { __fs.openBytes = T.fromB64(b); }", base64.b64encode(zb.getvalue()).decode())
    pg2.keyboard.press('Control+o')
    pg2.wait_for_function("!!document.querySelector('.modal-bg')", timeout=10000)
    m = E2("T.modal()")
    E2("T.press('확인')")
    still = E2("__nabi.app.project.name")
    check('B9 에셋 내용이 바뀐 파일 → "열 수 없습니다" 알림, 지금 프로젝트는 그대로', '열 수 없습니다' in m['text'] and '맞지 않습니다' in m['text'] and still == '다른 이름', m)
    E2("(b) => { __fs.openBytes = T.fromB64(b); }", base64.b64encode(b'not a zip').decode())
    pg2.keyboard.press('Control+o')
    pg2.wait_for_function("!!document.querySelector('.modal-bg')", timeout=10000)
    m2 = E2("T.modal()"); E2("T.press('확인')")
    check('B10 zip이 아닌 파일 → 알림', 'zip' in m2['text'], m2)
    # 저장 안 한 변경이 있을 때 새로 만들기
    E2("(() => { const V = T.V; V.select([V.page.elements[0].id]); V.nudge(3, 0); })()")
    pg2.click('#fileMenuBtn'); pg2.click('#fileNew')  # 12단계 개편: 파일 메뉴(≡) 안
    pg2.wait_for_function("!!document.querySelector('.modal-bg')", timeout=5000)
    m3 = E2("T.modal()"); E2("T.press('취소')")
    kept = E2("__nabi.app.project.pages.length")
    pg2.click('#fileMenuBtn'); pg2.click('#fileNew'); pg2.wait_for_function("!!document.querySelector('.modal-bg')", timeout=5000); E2("T.press('저장하지 않음')")  # 12단계 개편: 파일 메뉴(≡) 안
    pg2.wait_for_function("__nabi.app.project.pages.length === 1", timeout=5000)
    check('B11 변경이 있을 때 새로 만들기 → 저장/저장하지 않음/취소 확인, 취소면 그대로, 저장하지 않음이면 빈 새 프로젝트',
          m3['buttons'] == ['저장', '저장하지 않음', '취소'] and kept == 3 and E2("__nabi.app.project.name") == '제목 없음' and E2("T.V.page.elements.length") == 0 and E2("__nabi.assets.byId.size") == 0 and not E2("[...document.fonts].some((f) => f.family.replace(/\"/g, '') === 'TeX Gyre Cursor')"),
          [m3, kept])
    pg2.close()

    # ============ C. 자동 저장·복구 ============
    E("(() => { T.V.select([T.V.page.elements[0].id]); T.V.nudge(5, 5); })()")
    E("(() => { const id = T.add('text', { x: 50, y: 900, w: 400, h: 100, doc: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: '복구될 글' }] }] } }); window.__rt = id; })()")
    time.sleep(2.8)
    rec = E("T.idb()")
    check('C1 변경 후 2초 조용하면 자동 저장(IndexedDB에 복구용 사본, 장 3개)', rec and rec['pages'] == 3 and time.time() * 1000 - rec['savedAt'] < 5000, rec)
    snap_before = E("T.snap()")
    ras_before = E("T.raster(0)")
    pg.close()  # 비정상 종료처럼(저장·정리 없이 닫음)
    pg = open_page()
    E = lambda js, arg=None: pg.evaluate(js, arg) if arg is not None else pg.evaluate(js)
    mouse, kb = pg.mouse, pg.keyboard
    pg.wait_for_function("!!document.querySelector('.modal-bg')", timeout=10000)
    m = E("T.modal()")
    E("T.press('복구')")
    pg.wait_for_function("__nabi.app.project.pages.length === 3", timeout=20000)
    time.sleep(0.5)
    snap_after = E("T.snap()")
    ja, jb = json.loads(snap_before), json.loads(snap_after)
    rd = maxdiff(img(ras_before), img(E("T.raster(0)")))
    check('C2 다시 열면 "저장하지 않은 작업" 확인 → 복구: 장·요소·글·이미지·글꼴·스와치가 닫기 직전과 같음, 출력도 같음, 아직 저장 안 됨(●)',
          '저장하지 않은 작업' in m['text'] and m['buttons'] == ['복구', '버리기'] and ja['pages'] == jb['pages'] and ja['fonts'] == jb['fonts'] and ja['swatches'] == jb['swatches'] and rd == 0 and E("document.title").startswith('●'),
          {'modal': m, 'rasterdiff': rd})
    E("T.mockFS()")
    kb.press('Control+s')
    pg.wait_for_function("window.__fs.saves === 1", timeout=20000)
    time.sleep(0.3)
    check('C3 저장하면 복구용 사본을 지움', E("T.idb()") is None)
    E("(() => { T.V.select([T.V.page.elements[0].id]); T.V.nudge(1, 1); })()"); time.sleep(2.6)
    pg.close()
    pg = open_page(); E = lambda js, arg=None: pg.evaluate(js, arg) if arg is not None else pg.evaluate(js); mouse, kb = pg.mouse, pg.keyboard
    pg.wait_for_function("!!document.querySelector('.modal-bg')", timeout=10000)
    E("T.press('버리기')")
    time.sleep(0.3)
    none1 = E("T.idb()")
    pg.close()
    pg = open_page(); E = lambda js, arg=None: pg.evaluate(js, arg) if arg is not None else pg.evaluate(js); mouse, kb = pg.mouse, pg.keyboard
    time.sleep(1)
    check('C4 버리기 → 복구용 사본 삭제, 다음 실행에는 묻지 않음', none1 is None and E("T.modal()") is None and E("__nabi.app.project.pages.length") == 1)

    # ============ P. 속도 ============
    E("""(async () => { for (let i = 0; i < 10; i++) { const c = new OffscreenCanvas(1600, 1200); const x = c.getContext('2d');
        for (let k = 0; k < 400; k++) { x.fillStyle = `hsl(${(k * 37 + i * 11) % 360},70%,50%)`; x.fillRect(Math.random() * 1600, Math.random() * 1200, 80, 80); }
        await T.V.addImage(await c.convertToBlob({ type: 'image/png' }), { x: 50 + i * 20, y: 50 + i * 20 }); } })()""")
    t0 = time.time(); E("(async () => { await __nabi.P.toZip(__nabi.app.project, { assets: __nabi.assets, docOf: T.V.docOf, swatches: __nabi.swatches.list }); })()"); tz = time.time() - t0
    size = E("(async () => (await __nabi.P.toZip(__nabi.app.project, { assets: __nabi.assets, docOf: T.V.docOf, swatches: __nabi.swatches.list })).bytes.length)()")
    t0 = time.time(); E("__nabi.autosave()"); ta = time.time() - t0
    t0 = time.time(); E("__nabi.autosave()"); ta2 = time.time() - t0
    metrics['zip-10-images'] = {'ms': round(tz * 1000), 'bytes': size}
    metrics['autosave-ms'] = {'first': round(ta * 1000), 'second': round(ta2 * 1000)}
    check(f'P1 1600×1200 PNG 10장 프로젝트({size / 1e6:.1f}MB): zip 만들기 {round(tz * 1000)}ms, 자동 저장 첫 번째 {round(ta * 1000)}ms → 두 번째 {round(ta2 * 1000)}ms(에셋은 한 번만 씀)', tz < 3 and (ta2 < ta or ta2 < 0.05), metrics)  # 두 번째가 50ms 안쪽이면 통과(첫 번째가 이미 자동 저장으로 에셋을 써 둔 경우 두 값이 비슷함)

    check('Z 검증 전체 동안 페이지 오류 없음', not errors, errors)
    b.close()

srv.shutdown()
fails = [r for r in results if not r[1]]
for name, ok, detail in results:
    print(('PASS ' if ok else 'FAIL ') + name + ('' if ok else '  ' + json.dumps(detail, ensure_ascii=False, default=str)[:900]))
print('metrics:', json.dumps(metrics, ensure_ascii=False))
print(f'{len(results) - len(fails)}/{len(results)} passed')
