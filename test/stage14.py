"""14단계 검증: 태블릿(갤럭시 탭 등 안드로이드 크롬)에서 손가락·펜으로 쓰기.
사용: python3 test/stage14.py  (proto 폴더 기준). V=1이면 항목마다 결과를 바로 찍는다.
손가락은 CDP Input.dispatchTouchEvent(실제 터치 이벤트, 여러 손가락), 펜은 Input.dispatchMouseEvent(pointerType: 'pen')로 보낸다.
화면은 탭 가로(1280×800)·세로(800×1280), 기기 배율 2, 터치 화면(pointer: coarse).
"""
import json, os, io, time, base64, threading, functools, subprocess, socket
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from playwright.sync_api import sync_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'test', 'out'); os.makedirs(OUT, exist_ok=True)
class Quiet(SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
srv = ThreadingHTTPServer(('127.0.0.1', 0), functools.partial(Quiet, directory=ROOT))
threading.Thread(target=srv.serve_forever, daemon=True).start()
ORIGIN = f'http://127.0.0.1:{srv.server_port}'
# 웹판 배포 폴더(서비스 워커 시험): localhost 주소여야 서비스 워커가 등록된다
subprocess.run(['node', os.path.join(ROOT, 'scripts', 'build-web.mjs')], check=True, capture_output=True)
srv2 = ThreadingHTTPServer(('localhost', 0), functools.partial(Quiet, directory=os.path.join(ROOT, 'dist', 'web')))
threading.Thread(target=srv2.serve_forever, daemon=True).start()
WEB = f'http://localhost:{srv2.server_port}'

results = []
def check(name, ok, detail=''):
    results.append((name, bool(ok), detail))
    if os.environ.get('V'): print(('ok ' if ok else 'XX ') + name[:70] + ('' if ok else '  ' + json.dumps(detail, ensure_ascii=False, default=str)[:900]), flush=True)
near = lambda a, b, eps: a is not None and b is not None and abs(a - b) <= eps

HELPERS = r"""
(() => {
  const N = __nabi, V = N.view, M = N.M;
  window.T = {
    N, V, M,
    reset: () => { N.app.project.pages = [M.newPage({ w: 900, h: 700 })]; N.app.current = null; N.app.switchPage(N.app.project.pages[0]); N.history.clear(); N.flush(); V.setView(0.8, 40, 40); },
    add: (type, props) => { const n = M.makeElement(type, props); V.change('create', () => { V.page.elements.push(n); }); return n.id; },
    text: (t, x, y, w, h) => T.add('text', { doc: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: t }] }] }, x, y, w, h }),
    el: (id) => { const n = V.node(id); return n && { x: n.x, y: n.y, w: n.w, h: n.h, rotation: n.rotation || 0 }; },
    C: (x, y) => V.pageToClient({ x, y }),
    handle: (hx, hy) => { const r = V.rect(); const h = V.handles().find((h) => h.kind === 'resize' && h.hx === hx && h.hy === hy); return h && { x: r.left + h.x, y: r.top + h.y }; },
    rot: () => { const r = V.rect(); const h = V.handles().find((h) => h.kind === 'rotate'); return h && { x: r.left + h.x, y: r.top + h.y }; },
    ed: (id) => V.editorOf(V.node(id)),
    sel: (id) => { const s = T.ed(id).state.selection; return [s.from, s.to]; },
    // 글자 k번째(0부터)의 화면 좌표(가운데)
    charPt: (id, k) => { const ed = T.ed(id); const c = ed.mapper.coordsAt(k + 1, 1), c2 = ed.mapper.coordsAt(k + 2, -1); const n = V.node(id); const G = window.__G;
      return V.pageToClient(G.fromLocal(n, { x: (c.x + c2.x) / 2, y: c.top + c.h / 2 })); },
    rect: (sel) => { const e = typeof sel === 'string' ? document.querySelector(sel) : sel; if (!e) return null; const r = e.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width, h: r.height, left: r.left, right: r.right, top: r.top, bottom: r.bottom }; },
    status: () => document.getElementById('status').textContent,
  };
  return import('/app/geom.js').then((G) => { window.__G = G; return true; });
})()
"""

with sync_playwright() as p:
    b = p.chromium.launch(args=['--disable-lcd-text'])
    errors = []
    def make(w, h, origin=ORIGIN, path='/index.html'):
        ctx = b.new_context(viewport={'width': w, 'height': h}, has_touch=True, is_mobile=True, device_scale_factor=2)
        pg = ctx.new_page()
        pg.route('**/fonts.googleapis.com/**', lambda r: r.abort())
        pg.on('pageerror', lambda e: errors.append(str(e)))
        pg.on('console', lambda m: m.type == 'error' and 'ERR_FAILED' not in m.text and errors.append(m.text))
        pg.goto(origin + path)
        pg.wait_for_function('window.__nabi && window.__nabi.ready', timeout=30000)
        time.sleep(0.3)
        if pg.evaluate("!!document.querySelector('.modal-bg')"): pg.click('.modal-bg [data-v=discard]')
        pg.evaluate(HELPERS)
        return ctx, pg

    ctx, pg = make(1280, 800)
    E = lambda js, arg=None: pg.evaluate(js, arg) if arg is not None else pg.evaluate(js)
    cdp = ctx.new_cdp_session(pg)
    def touch(kind, pts):
        cdp.send('Input.dispatchTouchEvent', {'type': kind, 'touchPoints': [{'x': x, 'y': y, 'id': i, 'radiusX': 4, 'radiusY': 4, 'force': 1} for i, (x, y) in pts]})
    def tap(pt, n=1, gap=0.08):
        for k in range(n):
            touch('touchStart', [(0, (pt['x'], pt['y']))]); time.sleep(0.03); touch('touchEnd', [])
            if k < n - 1: time.sleep(gap)
        time.sleep(0.15)
    def drag(a, c, steps=12, hold=0.0, dt=0.016):
        touch('touchStart', [(0, (a['x'], a['y']))])
        if hold: time.sleep(hold)
        for i in range(1, steps + 1):
            touch('touchMove', [(0, (a['x'] + (c['x'] - a['x']) * i / steps, a['y'] + (c['y'] - a['y']) * i / steps))]); time.sleep(dt)
        touch('touchEnd', []); time.sleep(0.15)
    def two(a0, b0, a1, b1, steps=10, dt=0.016, stagger=0.0):
        touch('touchStart', [(0, a0)])
        if stagger: time.sleep(stagger)
        touch('touchStart', [(0, a0), (1, b0)])
        for i in range(1, steps + 1):
            f = i / steps
            touch('touchMove', [(0, (a0[0] + (a1[0] - a0[0]) * f, a0[1] + (a1[1] - a0[1]) * f)), (1, (b0[0] + (b1[0] - b0[0]) * f, b0[1] + (b1[1] - b0[1]) * f))]); time.sleep(dt)
        touch('touchEnd', []); time.sleep(0.15)
    def ntap(pts):
        touch('touchStart', [(i, pt) for i, pt in enumerate(pts)]); time.sleep(0.05); touch('touchEnd', []); time.sleep(0.2)

    # ============ L. 화면 ============
    lay = E("""(() => ({ meta: !!document.querySelector('meta[name=viewport]'), sw: document.documentElement.scrollWidth, iw: innerWidth,
      ib: document.getElementById('undo').getBoundingClientRect().height, coarse: matchMedia('(pointer: coarse)').matches,
      toggles: [...document.querySelectorAll('.panel-toggle')].map((b) => getComputedStyle(b).display),
      over: getComputedStyle(document.body).overscrollBehaviorY, ta: getComputedStyle(document.querySelector('.pv-viewport')).touchAction,
      canvasW: document.getElementById('canvas').getBoundingClientRect().width }))()""")
    pg.screenshot(path=os.path.join(OUT, 'stage14-landscape.png'))
    check('L1 탭 가로 1280×800: 화면 크기 맞춤(viewport), 가로로 넘치지 않음, 단추 40px 이상, 패널 단추 보임, 당겨서 새로 고침 막힘, 캔버스는 브라우저 확대·스크롤 안 함',
          lay['meta'] and lay['sw'] <= lay['iw'] and lay['ib'] >= 40 and lay['coarse'] and all(t == 'grid' for t in lay['toggles']) and lay['over'] == 'none' and lay['ta'] == 'none' and lay['canvasW'] > 600, lay)

    # ============ C. 캔버스: 한 손가락 ============
    E("T.reset()")
    sid = E("T.add('shape', { x: 100, y: 100, w: 200, h: 150 })")
    E("T.N.history.clear(); T.V.select([])")
    tap(E("T.C(200, 175)"))
    check('C1 톡 → 고르기', E("T.V.selection") == [sid], E("T.V.selection"))
    tap(E("T.C(700, 600)"))
    check('C2 빈 곳 톡 → 선택 해제', E("T.V.selection") == [], E("T.V.selection"))
    z = E("T.V.z")
    drag(E("T.C(200, 175)"), E("T.C(200, 175)") | {'x': E("T.C(200, 175)")['x'] + 80, 'y': E("T.C(200, 175)")['y'] + 40})
    el = E(f"T.el('{sid}')")
    check('C3 끌기 → 옮기기(손가락 이동 ÷ 확대 비율), 되돌리기 한 단위', near(el['x'], 100 + 80 / z, 1.5) and near(el['y'], 100 + 40 / z, 1.5) and E("T.N.history.undoStack?.length ?? T.N.history.stack?.length ?? 1") >= 1, [el, z])
    E("T.N.history.undo()"); time.sleep(0.1)
    check('C3b 되돌리면 제자리', E(f"T.el('{sid}')")['x'] == 100, E(f"T.el('{sid}')"))
    hd = E("[T.V.touchMode, document.querySelector('.pv-overlay rect[data-h], svg rect[data-h]')?.getAttribute('width')]")
    h = E("T.handle(1, 1)")
    # 손잡이 가운데가 아니라 15px 떨어진 곳을 눌러도 잡힌다(손가락 크기)
    drag({'x': h['x'] + 12, 'y': h['y'] + 12}, {'x': h['x'] + 72, 'y': h['y'] + 42})
    el = E(f"T.el('{sid}')")
    check('C4 손가락이면 손잡이를 크게(14px) 그리고 12px 떨어져 눌러도 잡힘 → 크기 조절', hd[0] and hd[1] == '14' and near(el['w'], 200 + 60 / z, 2) and near(el['h'], 150 + 30 / z, 2), [hd, el])
    iid = E("""(async () => { const c = new OffscreenCanvas(200, 100); c.getContext('2d').fillRect(0, 0, 200, 100); const n = await T.V.addImage(await c.convertToBlob({ type: 'image/png' }), { x: 500, y: 150 }); T.V.select([n.id]); T.N.flush(); return n.id; })()""")
    e0 = E(f"T.el('{iid}')")
    h = E("T.handle(1, 1)")
    drag(h, {'x': h['x'] + 90, 'y': h['y'] + 10})
    e1 = E(f"T.el('{iid}')")
    check('C5 사진 모서리를 손가락으로 끌면 비율 유지(Shift 대신)', near(e1['w'] / e1['h'], e0['w'] / e0['h'], 0.01) and e1['w'] > e0['w'] + 20, [e0, e1])
    E(f"T.V.select(['{sid}'])"); E("T.N.flush()")
    r = E("T.rot()")
    c = E(f"(() => {{ const n = T.V.node('{sid}'); return T.C(n.x + n.w / 2, n.y + n.h / 2); }})()")
    drag(r, {'x': c['x'] + (c['y'] - r['y']), 'y': c['y']})
    check('C6 회전 손잡이 끌기 → 회전(약 90°)', near(E(f"T.el('{sid}')")['rotation'] % 360, 90, 6), E(f"T.el('{sid}')"))
    E("T.N.history.undo()")
    drag(E("T.C(20, 20)"), E("T.C(880, 340)"))
    check('C7 빈 곳에서 끌기 → 범위 선택(걸친 요소 모두)', sorted(E("T.V.selection")) == sorted([sid, iid]), E("T.V.selection"))
    # 펜(S펜): pointerType pen
    E(f"T.V.select([])")
    a = E("T.C(200, 175)"); x0 = E(f"T.el('{sid}')")['x']
    cdp.send('Input.dispatchMouseEvent', {'type': 'mousePressed', 'x': a['x'], 'y': a['y'], 'button': 'left', 'buttons': 1, 'clickCount': 1, 'pointerType': 'pen'})
    for i in range(1, 9): cdp.send('Input.dispatchMouseEvent', {'type': 'mouseMoved', 'x': a['x'] + i * 8, 'y': a['y'], 'button': 'left', 'buttons': 1, 'pointerType': 'pen'}); time.sleep(0.016)
    cdp.send('Input.dispatchMouseEvent', {'type': 'mouseReleased', 'x': a['x'] + 64, 'y': a['y'], 'button': 'left', 'buttons': 0, 'clickCount': 1, 'pointerType': 'pen'}); time.sleep(0.2)
    check('C8 펜(S펜)으로 끌기 → 옮기기(스냅으로 몇 px 붙을 수 있음)', near(E(f"T.el('{sid}')")['x'], x0 + 64 / z, 8), [x0, E(f"T.el('{sid}')")])

    # ============ G. 두 손가락 ============
    E("T.V.select([]); T.V.setView(0.8, 40, 40)")
    r = E("T.V.rect()")
    m = (r['left'] + 500, r['top'] + 350)
    before_pt = E(f"T.V.clientToPage({m[0]}, {m[1]})")
    two((m[0] - 60, m[1]), (m[0] + 60, m[1]), (m[0] - 120, m[1]), (m[0] + 120, m[1]))
    after_pt = E(f"T.V.clientToPage({m[0]}, {m[1]})")
    check('G1 두 손가락 벌리기 → 확대(약 2배), 손가락 사이 지점은 그대로', near(E("T.V.z"), 1.6, 0.12) and near(after_pt['x'], before_pt['x'], 3) and near(after_pt['y'], before_pt['y'], 3), [E("T.V.z"), before_pt, after_pt])
    px, py = E("[T.V.px, T.V.py]")
    two((m[0] - 60, m[1]), (m[0] + 60, m[1]), (m[0] - 60 + 100, m[1] + 50), (m[0] + 60 + 100, m[1] + 50))
    check('G2 두 손가락 함께 끌기 → 화면 이동(확대 비율 그대로)', near(E("T.V.px") - px, 100, 3) and near(E("T.V.py") - py, 50, 3) and near(E("T.V.z"), 1.6, 0.12), [E("[T.V.px - " + str(px) + ", T.V.py - " + str(py) + ", T.V.z]")])
    E("T.V.setView(0.8, 40, 40)")
    # 요소 위에서 한 손가락이 먼저 닿고(아직 안 움직임) 두 번째 손가락 → 요소는 그대로, 확대만
    x0 = E(f"T.el('{sid}')")['x']
    a = E("T.C(200, 175)")
    two((a['x'], a['y']), (a['x'] + 150, a['y']), (a['x'] - 40, a['y']), (a['x'] + 190, a['y']), stagger=0.05)
    check('G3 요소 위 한 손가락 + 곧 두 번째 손가락 → 요소는 움직이지 않고 확대', E(f"T.el('{sid}')")['x'] == x0 and E("T.V.z") > 0.85, [x0, E(f"T.el('{sid}')"), E("T.V.z")])
    E("T.V.setView(0.8, 40, 40)")
    # 두 손가락 톡 = 되돌리기, 세 손가락 톡 = 다시 실행
    drag(E("T.C(200, 175)"), {'x': E("T.C(200, 175)")['x'] + 50, 'y': E("T.C(200, 175)")['y']})
    moved = E(f"T.el('{sid}')")['x']
    ntap([(600, 400), (700, 400)])
    undone = E(f"T.el('{sid}')")['x']
    ntap([(600, 400), (700, 400), (800, 400)])
    redone = E(f"T.el('{sid}')")['x']
    check('G4 두 손가락 톡 = 되돌리기, 세 손가락 톡 = 다시 실행', undone == x0 and near(redone, moved, 0.01) and moved != x0, [x0, moved, undone, redone, E("T.status()")])

    # ============ T. 글상자 편집 ============
    E("T.reset()")
    tid = E("T.text('가나다라 마바사 아자차카', 100, 100, 500, 160)")
    E("T.V.select([]); T.N.flush()")
    tap(E(f"T.charPt('{tid}', 2)"), n=2)
    check('T1 글상자 두 번 톡 → 편집, 누른 자리에 커서', E("T.V.editing") == tid and E(f"T.sel('{tid}')")[0] in (3, 4), [E("T.V.editing"), E(f"T.sel('{tid}')")])
    time.sleep(0.1)
    check('T2 손을 떼면 화면 자판용 입력칸에 포커스(자판은 이때 뜸)', E("document.activeElement === T.ed(T.V.editing)?.input"), E("document.activeElement.className"))
    tap(E(f"T.charPt('{tid}', 6)"))
    check('T3 편집 중 톡 → 그 자리로 커서', E(f"T.sel('{tid}')") in ([7, 7], [8, 8]), E(f"T.sel('{tid}')"))
    drag(E(f"T.charPt('{tid}', 0)"), E(f"T.charPt('{tid}', 3)"))
    s = E(f"T.sel('{tid}')")
    check('T4 편집 중 끌기 → 글자 범위 선택(캔버스는 움직이지 않음)', s[0] in (1, 2) and s[1] in (4, 5) and E(f"T.el('{tid}')")['x'] == 100, [s, E(f"T.el('{tid}')")])
    tap(E(f"T.charPt('{tid}', 6)"), n=2)
    check('T5 두 번 톡 → 낱말 선택("마바사")', E(f"T.ed('{tid}').state.doc.textBetween(...T.sel('{tid}'))") == '마바사', E(f"T.sel('{tid}')"))
    tap(E(f"T.charPt('{tid}', 6)"), n=3)
    check('T6 세 번 톡 → 문단 선택', E(f"T.ed('{tid}').state.doc.textBetween(...T.sel('{tid}'))") == '가나다라 마바사 아자차카', E(f"T.sel('{tid}')"))
    tap(E(f"T.charPt('{tid}', 1)"))
    at = E(f"T.sel('{tid}')")[0] - 1  # 커서 자리(문단 안 글자 수)
    cdp.send('Input.imeSetComposition', {'text': 'ㅎ', 'selectionStart': 1, 'selectionEnd': 1}); time.sleep(0.05)
    cdp.send('Input.imeSetComposition', {'text': '하', 'selectionStart': 1, 'selectionEnd': 1}); time.sleep(0.05)
    cdp.send('Input.imeSetComposition', {'text': '한', 'selectionStart': 1, 'selectionEnd': 1}); time.sleep(0.05)
    cdp.send('Input.insertText', {'text': '한'}); time.sleep(0.2)
    t0 = '가나다라 마바사 아자차카'
    check('T7 손가락으로 커서를 놓은 뒤 한글 조합 입력(커서 자리에 "한" 한 번)', at in (1, 2) and E(f"T.ed('{tid}').text") == t0[:at] + '한' + t0[at:], [at, E(f"T.ed('{tid}').text")])
    # 화면 자판이 올라와 캔버스가 줄어도(창 높이 800 → 420) 커서가 보이는 곳에
    tap(E(f"T.charPt('{tid}', 10)"))
    E("T.V.setView(1.6, 40, 40 - 300)")
    pg.set_viewport_size({'width': 1280, 'height': 420}); time.sleep(0.6)
    cv = E("(() => { const c = T.ed(T.V.editing).input.getBoundingClientRect(), r = T.V.rect(); return { c: [c.top, c.bottom], r: [r.top, r.bottom], z: T.V.z, editing: !!T.V.editing }; })()")
    check('T8 화면 자판이 올라와 캔버스가 줄면 확대 비율은 그대로, 커서는 캔버스 안에 보이게', cv['editing'] and cv['c'][0] >= cv['r'][0] and cv['c'][1] <= cv['r'][1] and near(cv['z'], 1.6, 0.01), cv)
    pg.set_viewport_size({'width': 1280, 'height': 800}); time.sleep(0.4)
    out_pt = E("(() => { const r = T.V.rect(); return { x: r.right - 40, y: r.bottom - 40 }; })()")
    tap(out_pt)
    check('T9 글상자 밖 톡 → 편집 끝', not E("T.V.editing"), E("T.V.editing"))
    tap(E(f"T.charPt('{tid}', 1)"))  # 고르기
    tap(E(f"T.charPt('{tid}', 1)"), gap=0)  # 이미 고른 글상자를 다시 톡
    time.sleep(0.45)
    check('T10 고른 글상자를 다시 톡 → 편집', E("T.V.editing") == tid, E("T.V.editing"))
    tap(out_pt)

    # ============ P. 패널·눈금자 ============
    E("T.reset()")
    E("T.add('shape', { x: 50, y: 50, w: 100, h: 100, name: '하나' }); T.add('shape', { x: 200, y: 50, w: 100, h: 100, name: '둘' }); T.add('shape', { x: 350, y: 50, w: 100, h: 100, name: '셋' }); T.V.select([]); T.N.flush()")
    E("document.querySelector('.tabs [data-tab=layers]').click(); T.N.flush()")
    time.sleep(0.2)
    rows = E("[...document.querySelectorAll('#layers .lp-row')].map((r) => T.rect(r))")
    ids = E("T.V.page.elements.map((n) => n.id)")
    tap(rows[0])
    check('P1 레이어 줄 톡 → 그 요소 고르기', E("T.V.selection") == [ids[2]], E("T.V.selection"))
    touch('touchStart', [(0, (rows[2]['x'], rows[2]['y']))]); time.sleep(0.6); touch('touchEnd', []); time.sleep(0.2)
    check('P2 레이어 줄 길게 누르기 → 선택에 더하기', sorted(E("T.V.selection")) == sorted([ids[2], ids[0]]), E("T.V.selection"))
    E("T.V.select([])"); E("T.N.flush()")
    rows = E("[...document.querySelectorAll('#layers .lp-row')].map((r) => T.rect(r))")
    drag(rows[0], {'x': rows[0]['x'], 'y': rows[2]['bottom'] - 4}, hold=0.6)
    after = E("T.V.page.elements.map((n) => n.id)")
    check('P3 레이어 줄 길게 누른 채 끌기 → 순서 바꾸기(맨 위 → 맨 아래)', after[0] == ids[2] and len(after) == 3, [ids, after])
    E("T.N.history.undo()")
    E("document.querySelector('.tabs [data-tab=pages]').click()")
    E("T.N.app.addPage(); T.N.app.addPage(); T.N.flush()"); time.sleep(0.3)
    pids = E("T.N.app.project.pages.map((p) => p.id)")
    prow = lambda i: E(f"T.rect(document.querySelector('#pagesList .pg-row[data-id=\"{pids[i]}\"]'))")
    tap(prow(0))
    check('P4 장 톡 → 그 장으로', E("T.N.app.current.id") == pids[0], E("T.N.app.current.id"))
    drag(prow(0), {'x': prow(0)['x'], 'y': prow(2)['bottom'] - 3}, hold=0.6)
    check('P5 장 길게 누른 채 끌기 → 장 순서 바꾸기', E("T.N.app.project.pages.map((p) => p.id)")[-1] == pids[0], [pids, E("T.N.app.project.pages.map((p) => p.id)")])
    E("T.reset()")
    ng = E("T.V.page.guides?.length || 0")
    rt = E("T.rect('.pv-ruler.top')")
    drag({'x': rt['x'], 'y': rt['y']}, {'x': rt['x'], 'y': rt['y'] + 200})
    check('P6 눈금자에서 손가락으로 끌어 가이드 만들기', (E("T.V.page.guides?.length || 0")) == ng + 1, E("T.V.page.guides"))
    w0 = E("document.getElementById('props').getBoundingClientRect().width")
    sp = E("T.rect('.split[data-edge=r]')")
    drag(sp, {'x': sp['x'] - 60, 'y': sp['y']})
    check('P7 패널 손잡이를 손가락으로 끌어 너비 바꾸기', near(E("document.getElementById('props').getBoundingClientRect().width"), w0 + 60, 3), [w0, E("document.getElementById('props').getBoundingClientRect().width")])
    E("(() => { const s = JSON.parse(localStorage.getItem('nabitext.settings') || '{}'); })()")
    # 글꼴 목록 손가락으로
    tid = E("T.text('글꼴 시험', 100, 100, 400, 100)"); E(f"T.V.select(['{tid}']); T.N.flush()")
    E("document.querySelector('#props [data-field=\"글꼴\"]').scrollIntoView({ block: 'center' })"); time.sleep(0.2)
    tap(E("T.rect(document.querySelector('#props [data-field=\"글꼴\"]').parentElement.querySelector('.fp-open'))")); time.sleep(0.2)
    it = E("(() => { const e = [...document.querySelectorAll('.fp-it')].find((x) => x.querySelector('.fp-name').textContent === 'serif'); e?.scrollIntoView({ block: 'nearest' }); return e && T.rect(e); })()")
    if it: tap(it)
    fm = E(f"(() => {{ let v = null; T.ed('{tid}').state.doc.descendants((n) => {{ if (n.isText) v = (n.marks.find((m) => m.type.name === 'font') || {{}}).attrs?.value; }}); return v; }})()")
    check('P8 글꼴 목록을 손가락으로 열고 골라 적용(항목 높이 40px)', it and it['h'] >= 40 and fm == 'serif', [it, fm])
    check('P9 손가락 화면에서 단추·줄 크기(레이어 줄·장 줄 40px, 속성 칸 38px)', E("document.querySelector('#props label.f').getBoundingClientRect().height") >= 38 and E("T.rect('#pagesList .pg-row:not([data-master])').h") >= 40, [E("document.querySelector('#props label.f').getBoundingClientRect().height"), E("T.rect('#pagesList .pg-row:not([data-master])')")])
    # 마우스로 돌아오면 핸들 원래 크기
    a = E("T.C(250, 150)")
    pg.mouse.click(a['x'], a['y']); time.sleep(0.2)
    check('P10 마우스를 쓰면 다시 작은 핸들(8px)', not E("T.V.touchMode") and E("document.querySelector('svg rect[data-h]')?.getAttribute('width')") == '8', [E("T.V.touchMode")])
    ctx.close()

    # ============ V. 세로 화면 ============
    ctx, pg = make(800, 1280)
    E = lambda js, arg=None: pg.evaluate(js, arg) if arg is not None else pg.evaluate(js)
    cdp = ctx.new_cdp_session(pg)
    v0 = E("({ left: T.rect('#left'), canvas: T.rect('#canvas'), sw: document.documentElement.scrollWidth, iw: innerWidth })")
    tap(E("T.rect('#leftToggle')")); time.sleep(0.35)
    v1 = E("T.rect('#left')")
    pg.screenshot(path=os.path.join(OUT, 'stage14-portrait-drawer.png'))
    tap({'x': v0['canvas']['x'], 'y': v0['canvas']['y']}); time.sleep(0.35)
    v2 = E("T.rect('#left')")
    pg.screenshot(path=os.path.join(OUT, 'stage14-portrait.png'))
    check('V1 탭 세로 800×1280: 장·레이어 패널은 숨긴 서랍, 캔버스 450px 이상, 가로로 넘치지 않음',
          v0['left']['right'] <= 0 and v0['canvas']['w'] >= 450 and v0['sw'] <= v0['iw'], v0)
    check('V2 패널 단추 → 서랍이 캔버스 위로 열림, 캔버스 누르면 닫힘', v1['left'] >= -1 and v1['right'] > 150 and v2['right'] <= 0, [v1, v2])
    ctx.close()

    # ============ W. 홈 화면 앱(PWA)·인터넷 없이 ============
    ctx, pg = make(1280, 800, origin=WEB)
    E = lambda js, arg=None: pg.evaluate(js, arg) if arg is not None else pg.evaluate(js)
    ok_sw = False
    try: pg.wait_for_function("navigator.serviceWorker.controller || (navigator.serviceWorker.ready.then(() => (window.__swReady = true)), window.__swReady)", timeout=20000); ok_sw = True
    except Exception: pass
    man = E("fetch('manifest.webmanifest').then((r) => r.json()).then((m) => [m.display, m.icons.map((i) => i.sizes)])")
    time.sleep(1.5)
    ctx.set_offline(True)
    pg.reload()
    try: pg.wait_for_function('window.__nabi && window.__nabi.ready', timeout=20000); off = True
    except Exception: off = False
    check('W1 배포 폴더: 앱 정보(manifest: 전체 화면 앱, 192·512 아이콘), 서비스 워커 등록', ok_sw and man[0] == 'standalone' and '192x192' in man[1] and '512x512' in man[1], [ok_sw, man])
    check('W2 인터넷이 끊겨도 다시 열면 편집기가 뜸', off, off)
    ctx.close()
    b.close()

fails = [r for r in results if not r[1]]
for n, ok, d in results: print(('PASS ' if ok else 'FAIL ') + n + ('' if ok else '\n     ' + json.dumps(d, ensure_ascii=False, default=str)[:1200]))
print('page errors:', errors[:8])
print(f'{len(results) - len(fails)}/{len(results)} passed')
