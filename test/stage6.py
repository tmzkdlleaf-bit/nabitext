"""6단계 검증: 편집기 화면(index.html) — 요소 만들기·선택·이동·리사이즈·회전·스냅·그룹·순서·정렬·분배·
잠금·숨김·복제·삭제·요소 복사/붙여넣기, 글상자 편집 모드(회전·확대 상태 포함), 확대/이동, 되돌리기 통합, 출력.
사용: python3 test/stage6.py  (proto 폴더 기준, poppler-utils 필요)
입력은 CDP로 실제 마우스·키 이벤트를 보낸다(Playwright mouse/keyboard). 한글 조합은 Input.imeSetComposition.
기대값은 페이지가 실제로 받은 이벤트 좌표(clientX/Y)로 계산한다(CDP가 좌표를 정수로 맞추므로).
"""
import json, os, io, math, time, base64, subprocess, tempfile, threading, functools
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
    return {'max': int(d.max()), 'mean': round(float(d.mean()), 3), 'pct16': pct(d > 16), 'nb_max': int(nb.max()), 'nb_pct64': pct(nb > 64)}
same_as_screen = lambda m: m.get('nb_pct64', 1) < 0.05 and m.get('pct16', 100) < 0.3
close = lambda a, b, eps=0.01: abs(a - b) <= eps

JS = r"""
(() => {
  const V = __nabi.view, M = __nabi.M;
  window.__evs = [];
  for (const t of ['mousedown', 'mouseup']) window.addEventListener(t, (e) => __evs.push({ t, x: e.clientX, y: e.clientY }), true);
  window.T = {
    V, M,
    reset: (w = 1080, h = 1080) => { V.setPage(M.newPage({ w, h })); __nabi.history.done.length = 0; __nabi.history.undone.length = 0; __nabi.history.emit(); },
    add: (type, props) => { const n = M.makeElement(type, props); V.change('create', () => { V.page.elements.push(n); }); return n.id; },
    el: (id) => { const n = V.node(id); return n && JSON.parse(JSON.stringify(n, (k, v) => (k === 'doc' ? undefined : v))); },
    ids: () => V.page.elements.map((n) => n.id),
    tree: () => JSON.stringify(V.page.elements, (k, v) => (k === 'doc' ? undefined : v)),
    full: () => JSON.stringify(V.serialize().elements),
    C: (x, y) => V.pageToClient({ x, y }),
    L: (id, x, y) => V.pageToClient(__G.fromLocal(V.node(id), { x, y })),
    P: (e) => V.clientToPage(e.x, e.y),
    lastDown: () => [...__evs].reverse().find((e) => e.t === 'mousedown'),
    lastUp: () => [...__evs].reverse().find((e) => e.t === 'mouseup'),
    handle: (hx, hy) => { const h = V.handles().find((h) => h.kind === (hx === 'rot' ? 'rotate' : 'resize') && (hx === 'rot' || (h.hx === hx && h.hy === hy))); const r = V.viewport.getBoundingClientRect(); return { x: h.x + r.left, y: h.y + r.top }; },
    text: (id) => V.editors.get(id).text,
    domOrder: () => [...V.pageEl.children].filter((c) => c.style.display !== 'none').map((c) => c.dataset.id),
  };
  return true;
})()
"""

with sync_playwright() as p:
    b = p.chromium.launch(args=['--disable-lcd-text'])
    ctx = b.new_context(viewport={'width': 1400, 'height': 1000})
    ctx.grant_permissions(['clipboard-read', 'clipboard-write'], origin=ORIGIN)
    pg = ctx.new_page()
    pg.route('**/fonts.googleapis.com/**', lambda r: r.abort())
    errors = []
    pg.on('pageerror', lambda e: errors.append(str(e)))
    pg.on('console', lambda m: m.type == 'error' and 'ERR_FAILED' not in m.text and errors.append(m.text))
    pg.goto(ORIGIN + '/index.html')
    pg.wait_for_function('window.__nabi && window.__nabi.ready', timeout=30000)
    pg.evaluate("(async () => { window.__G = await import('/app/geom.js'); })()")
    pg.evaluate(JS)
    E = lambda js, arg=None: pg.evaluate(js, arg) if arg is not None else pg.evaluate(js)
    mouse, kb = pg.mouse, pg.keyboard
    cdp = ctx.new_cdp_session(pg)

    def drag(a, c, steps=8, mods=()):
        for m in mods: kb.down(m)
        mouse.move(a['x'], a['y']); mouse.down(); mouse.move(c['x'], c['y'], steps=steps); mouse.up()
        for m in reversed(mods): kb.up(m)
        return E("T.P(T.lastDown())"), E("T.P(T.lastUp())")
    def click(pt, mods=(), count=1):
        for m in mods: kb.down(m)
        mouse.click(pt['x'], pt['y'], click_count=count)
        for m in reversed(mods): kb.up(m)
    def key_ko(key, code, vk, mods=0):
        # 한글 자판 상태의 키(예: key='ㄱ', code='KeyR')
        for t in ('rawKeyDown', 'keyUp'):
            cdp.send('Input.dispatchKeyEvent', {'type': t, 'key': key, 'code': code, 'windowsVirtualKeyCode': vk, 'modifiers': mods})

    # ============ A. 시작 ============
    st = E("({ w: T.V.page.w, h: T.V.page.h, z: T.V.z, px: T.V.px, py: T.V.py, vw: T.V.viewport.clientWidth, vh: T.V.viewport.clientHeight, title: document.title })")
    fits = st['px'] >= 0 and st['py'] >= 0 and st['px'] * 2 + st['w'] * st['z'] <= st['vw'] + 1 and st['py'] * 2 + st['h'] * st['z'] <= st['vh'] + 1
    check('A1 편집기 로드: 제목 "제목 없음 — 나비글쓰기", 기본 장 1080×1080, 화면에 맞춰 가운데, 오류 없음', st['title'] == '제목 없음 — 나비글쓰기' and st['w'] == 1080 and fits and not errors, {**st, 'errors': errors})
    tools = []
    for k in ['t', 'r', 'o', 'v']: kb.press(k); tools.append(E("T.V.tool"))
    key_ko('ㄱ', 'KeyR', 82); tools.append(E("T.V.tool")); kb.press('Escape')
    check('A2 도구 단축키 T/R/O/V, 한글 자판 상태(ㄱ = R 키) → 사각형 도구, Esc → 선택 도구', tools == ['text', 'rect', 'ellipse', 'select', 'rect'] and E("T.V.tool") == 'select', tools)

    # ============ B. 만들기 ============
    kb.press('r')
    p0, p1 = drag(E("T.C(100, 120)"), E("T.C(420, 330)"))
    r1 = E("T.el(T.ids()[0])")
    check('B1 사각형 도구로 끌기 → 받은 이벤트 좌표 그대로 상자(±0.01), 만든 뒤 선택 도구로 돌아옴',
          r1['shape'] == 'rect' and close(r1['x'], p0['x']) and close(r1['y'], p0['y']) and close(r1['w'], p1['x'] - p0['x']) and close(r1['h'], p1['y'] - p0['y']) and E("T.V.tool") == 'select' and E("T.V.selection")[0] == r1['id'], r1)
    kb.press('o')
    drag(E("T.C(600, 150)"), E("T.C(760, 230)"), mods=['Shift'])
    e1 = E("T.el(T.ids()[1])")
    check('B2 원 도구 + Shift 끌기 → 정원(w = h)', e1['shape'] == 'ellipse' and close(e1['w'], e1['h']) and e1['w'] > 100, e1)
    kb.press('t')
    click(E("T.C(150, 500)"))
    tid = E("T.ids()[2]")
    tx = E(f"T.el('{tid}')")
    ed_on = E("T.V.editing") == tid
    cdp.send('Input.imeSetComposition', {'text': 'ㅎ', 'selectionStart': 1, 'selectionEnd': 1})
    cdp.send('Input.imeSetComposition', {'text': '하', 'selectionStart': 1, 'selectionEnd': 1})
    cdp.send('Input.imeSetComposition', {'text': '한', 'selectionStart': 1, 'selectionEnd': 1})
    comp_mid = E(f"T.text('{tid}')")
    cdp.send('Input.insertText', {'text': '한'})
    cdp.send('Input.insertText', {'text': '글 상자'})
    txt = E(f"T.text('{tid}')")
    kb.press('Escape')
    down = E("T.lastDown()"); pd = E("T.P(T.lastDown())")
    check('B3 글상자 도구 클릭 → 기본 360×120 글상자, 곧바로 편집 모드, 한글 조합(조합 중 문서 불변) 후 "한글 상자", Esc → 편집 끝·그 글상자 선택',
          ed_on and tx['w'] == 360 and tx['h'] == 120 and close(tx['x'], pd['x']) and comp_mid == '' and txt == '한글 상자' and E("T.V.editing") is None and E("T.V.selection") == [tid],
          {'tx': tx, 'comp': comp_mid, 'txt': txt})
    n_before = len(E("T.ids()"))
    E("__nabi.history.undo()"); E("__nabi.history.undo()")
    after_undo = (E("T.ids()"), E(f"T.V.node('{tid}') && T.text('{tid}')"))
    E("__nabi.history.redo()"); E("__nabi.history.redo()")
    check('B4 만들기·입력이 각각 되돌리기 단위: 되돌리기 2회 → 글상자 없음, 다시 실행 2회 → 글상자와 글자 복원',
          len(after_undo[0]) == n_before - 1 and E(f"T.text('{tid}')") == '한글 상자' and E("T.ids()")[-1] == tid, after_undo)

    # ============ C. 선택·이동 ============
    rid, eid = E("T.ids()[0]"), E("T.ids()[1]")
    click(E("T.C(200, 200)"))
    s1 = E("T.V.selection")
    click(E("T.C(900, 900)"))
    s2 = E("T.V.selection")
    click(E("T.C(200, 200)")); click(E("T.C(680, 230)"), mods=['Shift'])
    s3 = E("T.V.selection")
    click(E("T.C(680, 230)"), mods=['Shift'])
    s4 = E("T.V.selection")
    check('C1 클릭 선택 / 빈 곳 클릭 해제 / Shift+클릭 추가·빼기', s1 == [rid] and s2 == [] and s3 == [rid, eid] and s4 == [rid], [s1, s2, s3, s4])
    g0 = E(f"T.el('{rid}')")
    p0, p1 = drag(E("T.C(250, 250)"), E("T.C(303, 377)"), mods=['Alt'])
    g1 = E(f"T.el('{rid}')")
    check('C2 끌어 옮기기(Alt = 스냅 끔): 이동량 = 포인터 이동량(±0.01)', close(g1['x'] - g0['x'], p1['x'] - p0['x']) and close(g1['y'] - g0['y'], p1['y'] - p0['y']), {'g0': g0, 'g1': g1})
    E("__nabi.history.undo()"); u = E(f"T.el('{rid}')"); E("__nabi.history.redo()"); r_ = E(f"T.el('{rid}')")
    check('C3 이동 되돌리기/다시 실행', close(u['x'], g0['x']) and close(r_['x'], g1['x']) and close(r_['y'], g1['y']))
    g0 = E(f"T.el('{rid}')")
    drag(E(f"T.C({g0['x'] + 50}, {g0['y'] + 50})"), E(f"T.C({g0['x'] + 150}, {g0['y'] + 80})"), mods=['Shift', 'Alt'])
    g1 = E(f"T.el('{rid}')")
    check('C4 Shift 끌기 → 한 축으로만(세로 이동 0)', g1['y'] == g0['y'] and g1['x'] > g0['x'], {'g0': g0, 'g1': g1})
    click(E("T.C(1000, 1000)"))
    kb.press('Escape')
    drag(E("T.C(590, 100)"), E("T.C(800, 260)"))
    s5 = E("T.V.selection")
    check('C5 빈 곳에서 끌어 범위 선택 → 걸친 요소만(원만)', s5 == [eid], s5)
    g0 = E(f"T.el('{eid}')")
    for k in ['ArrowRight', 'ArrowRight', 'ArrowDown', 'Shift+ArrowLeft']: kb.press(k)
    g1 = E(f"T.el('{eid}')")
    E("__nabi.history.undo()")
    g2 = E(f"T.el('{eid}')")
    check('C6 방향키 1px·Shift 10px, 이어진 방향키는 되돌리기 1단위', close(g1['x'] - g0['x'], -8) and close(g1['y'] - g0['y'], 1) and close(g2['x'], g0['x']) and close(g2['y'], g0['y']), {'d': [g1['x'] - g0['x'], g1['y'] - g0['y']]})

    # ============ D. 스냅 ============
    E("T.reset()")
    a = E("T.add('shape', { x: 100, y: 100, w: 200, h: 100 })")
    b_ = E("T.add('shape', { x: 500, y: 400, w: 120, h: 80 })")
    click(E("T.C(560, 440)"))
    # 원래 중심 560 → 장 중심 540에 가깝게(차이 20 → 끌어서 3px 이내로)
    drag(E("T.C(560, 440)"), E("T.C(542.5, 542)"))
    g = E(f"T.el('{b_}')")
    gl = E("T.V.overlay.querySelectorAll('line.guide').length")
    check('D1 장 가운데 근처로 옮기면 중심이 정확히 540,540에 맞음', close(g['x'] + g['w'] / 2, 540, 1e-9) and close(g['y'] + g['h'] / 2, 540, 1e-9), g)
    # 끌기 도중 안내선 확인
    mouse.move(*E(f"[T.C(540, 540).x, T.C(540, 540).y]")); mouse.down(); mouse.move(*E("[T.C(544, 380).x, T.C(544, 380).y]"), steps=4)
    gl = E("T.V.overlay.querySelectorAll('line.guide').length")
    mouse.up()
    g2 = E(f"T.el('{b_}')")
    check('D2 끌기 도중 안내선 표시(분홍 선), 가로 4px 어긋나게 끌어도 장 세로 중심선(x=540)에 붙어 있음', gl >= 1 and (close(g2['x'] + g2['w'] / 2, 540, 1e-9)), {'guides': gl, 'g': g2})
    E(f"T.V.select(['{b_}'])")
    # 오른쪽 변(현재 x + w)이 다른 요소의 오른쪽 변 300에서 2.5px 떨어진 곳으로 끈다(스냅 범위 안)
    dxm = 300 - (g2['x'] + g2['w']) + 2.5
    drag(E(f"T.C({g2['x'] + 60}, {g2['y'] + 40})"), E(f"T.C({g2['x'] + 60 + dxm}, {g2['y'] + 40})"))
    g3 = E(f"T.el('{b_}')")
    check('D3 다른 요소의 오른쪽 변(x=300)에 오른쪽 변이 맞음', close(g3['x'] + g3['w'], 300, 1e-9), g3)
    dz = 4 / E("T.V.z")  # 화면 4px: 끌기로 인정(3px 넘음) + 스냅 범위(6px) 안
    drag(E(f"T.C({g3['x'] + 60}, {g3['y'] + 40})"), E(f"T.C({g3['x'] + 60 + dz}, {g3['y'] + 40})"), mods=['Alt'])
    g4 = E(f"T.el('{b_}')")
    check('D4 Alt를 누르면 스냅하지 않음(포인터만큼만 이동)', not close(g4['x'] + g4['w'], 300, 1e-6), g4)

    # ============ E. 리사이즈·회전 ============
    E("T.reset()")
    a = E("T.add('shape', { x: 200, y: 200, w: 300, h: 200 })")
    E(f"T.V.select(['{a}'])")
    h = E("T.handle(1, 1)")
    mouse.move(h['x'], h['y']); mouse.down(); mouse.move(*E("[T.C(613, 457).x, T.C(613, 457).y]"), steps=6); mouse.up()
    pu = E("T.P(T.lastUp())"); ga = E(f"T.el('{a}')")
    check('E1 오른쪽 아래 핸들 → 왼쪽 위 고정, 크기 = 포인터까지(±0.01)', close(ga['x'], 200) and close(ga['y'], 200) and close(ga['w'], pu['x'] - 200) and close(ga['h'], pu['y'] - 200), {'g': ga, 'up': pu})
    w0, h0 = ga['w'], ga['h']
    drag(E("T.handle(1, 1)"), E(f"T.C({200 + w0 + 90}, {200 + h0 + 5})"), mods=['Shift'])
    gb = E(f"T.el('{a}')")
    check('E2 Shift → 비율 유지', close(gb['w'] / gb['h'], w0 / h0, 1e-6) and gb['w'] > w0 + 50, gb)
    c0 = (gb['x'] + gb['w'] / 2, gb['y'] + gb['h'] / 2)
    drag(E("T.handle(1, 0)"), E(f"T.C({gb['x'] + gb['w'] + 40}, {gb['y'] + gb['h'] / 2})"), mods=['Alt'])
    gc = E(f"T.el('{a}')")
    check('E3 Alt → 중심 고정(양쪽으로 늘어남)', close(gc['x'] + gc['w'] / 2, c0[0]) and close(gc['y'] + gc['h'] / 2, c0[1]) and gc['w'] > gb['w'] + 60, gc)
    E(f"T.V.setProps({{ rotation: 30 }}, ['{a}'])")
    gd = E(f"T.el('{a}')")
    west = E(f"__G.fromLocal(T.V.node('{a}'), {{ x: 0, y: {gd['h']} / 2 }})")
    hE = E("T.handle(1, 0)")
    # 회전된 오른쪽 변 핸들을 요소 축 방향(30°)으로 끌기
    tgt = {'x': hE['x'] + 80 * math.cos(math.radians(30)), 'y': hE['y'] + 80 * math.sin(math.radians(30))}
    mouse.move(hE['x'], hE['y']); mouse.down(); mouse.move(tgt['x'], tgt['y'], steps=6); mouse.up()
    ge = E(f"T.el('{a}')")
    west2 = E(f"__G.fromLocal(T.V.node('{a}'), {{ x: 0, y: {ge['h']} / 2 }})")
    check('E4 30° 회전 요소의 오른쪽 핸들 → 왼쪽 변 중점이 제자리(±0.01), 높이 불변, 회전 유지',
          close(west['x'], west2['x']) and close(west['y'], west2['y']) and close(ge['h'], gd['h']) and ge['rotation'] == 30 and ge['w'] > gd['w'] + 50, {'before': west, 'after': west2, 'g': ge})
    c = E(f"__G.center(T.V.node('{a}'))")
    hr = E("T.handle('rot')")
    tgtc = E(f"T.C({c['x'] + 150}, {c['y'] + 90})")
    mouse.move(hr['x'], hr['y']); mouse.down(); mouse.move(tgtc['x'], tgtc['y'], steps=8); mouse.up()
    gr = E(f"T.el('{a}')")
    pd_, pu_ = E("T.P(T.lastDown())"), E("T.P(T.lastUp())")
    want = 30 + math.degrees(math.atan2(pu_['y'] - c['y'], pu_['x'] - c['x']) - math.atan2(pd_['y'] - c['y'], pd_['x'] - c['x']))
    want = (want + 180) % 360 - 180
    c2 = E(f"__G.center(T.V.node('{a}'))")
    check('E5 회전 핸들 → 각도 = 포인터 각도 변화(±0.01°), 중심 고정', close(gr['rotation'], want) and close(c['x'], c2['x']) and close(c['y'], c2['y']), {'rot': gr['rotation'], 'want': want})
    hr = E("T.handle('rot')")
    drag(hr, E(f"T.C({c['x'] + 100}, {c['y'] + 130})"), mods=['Shift'])
    gs = E(f"T.el('{a}')")
    check('E6 Shift 회전 → 15° 단위', close(gs['rotation'] / 15, round(gs['rotation'] / 15), 1e-9), gs['rotation'])
    # 여러 개: 상자 늘리기와 함께 회전
    E("T.reset()")
    a = E("T.add('shape', { x: 100, y: 100, w: 100, h: 100 })"); b_ = E("T.add('shape', { x: 300, y: 200, w: 100, h: 50 })")
    E(f"T.V.select(['{a}', '{b_}'])")
    h = E("T.handle(1, 1)")
    mouse.move(h['x'], h['y']); mouse.down(); mouse.move(*E("[T.C(500, 348).x, T.C(500, 348).y]"), steps=5); mouse.up()
    pu = E("T.P(T.lastUp())")
    ga, gb = E(f"T.el('{a}')"), E(f"T.el('{b_}')")
    sx, sy = (pu['x'] - 100) / 300, (pu['y'] - 100) / 150
    check('E7 여러 요소 리사이즈 → 선택 상자 기준 배율로 위치·크기가 함께 늘어남(±0.01)',
          close(ga['w'], 100 * sx) and close(ga['h'], 100 * sy) and close(gb['x'], 100 + 200 * sx) and close(gb['y'] + gb['h'], pu['y']), {'a': ga, 'b': gb, 'up': pu})
    d0 = math.dist((ga['x'] + ga['w'] / 2, ga['y'] + ga['h'] / 2), (gb['x'] + gb['w'] / 2, gb['y'] + gb['h'] / 2))
    drag(E("T.handle('rot')"), E("T.C(700, 250)"))
    ga2, gb2 = E(f"T.el('{a}')"), E(f"T.el('{b_}')")
    d1 = math.dist((ga2['x'] + ga2['w'] / 2, ga2['y'] + ga2['h'] / 2), (gb2['x'] + gb2['w'] / 2, gb2['y'] + gb2['h'] / 2))
    check('E8 여러 요소 회전 → 두 요소가 같은 각도로 돌고 중심 사이 거리 유지', close(ga2['rotation'], gb2['rotation']) and abs(ga2['rotation']) > 1 and close(d0, d1, 1e-6), {'rot': [ga2['rotation'], gb2['rotation']], 'd': [d0, d1]})
    # 글상자 리사이즈: 정수 크기, 다시 흘려 넣기
    E("T.reset()")
    t = E("""T.add('text', { x: 100, y: 100, w: 500, h: 300, doc: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: '글상자 크기를 줄이면 줄이 다시 나뉘어야 합니다. 가나다라마바사 아자차카타파하 ABC DEF GHI' }] }] } })""")
    E(f"T.V.select(['{t}'])")
    lines0 = E(f"T.V.editors.get('{t}').result.lines.length")
    drag(E("T.handle(1, 1)"), E("T.C(353.4, 377.7)"))
    gt = E(f"T.el('{t}')"); lines1 = E(f"T.V.editors.get('{t}').result.lines.length")
    fr = E(f"(() => {{ const f = T.V.editors.get('{t}').frame; return [f.w, f.h]; }})()")
    check('E9 글상자 리사이즈 → 크기는 정수 px, 왼쪽 위 고정, 편집기 프레임 크기 반영, 줄 수 증가(다시 흘려 넣음)',
          gt['w'] == int(gt['w']) and gt['h'] == int(gt['h']) and close(gt['x'], 100) and close(gt['y'], 100) and fr == [gt['w'], gt['h']] and lines1 > lines0, {'g': gt, 'lines': [lines0, lines1], 'frame': fr})
    E(f"T.V.setProps({{ rotation: 40 }}, ['{t}'])")
    wl = E(f"__G.fromLocal(T.V.node('{t}'), {{ x: 0, y: 0 }})")
    hh = E("T.handle(1, 1)")
    mouse.move(hh['x'], hh['y']); mouse.down(); mouse.move(hh['x'] + 37.3, hh['y'] + 11.6, steps=4); mouse.up()
    wl2 = E(f"__G.fromLocal(T.V.node('{t}'), {{ x: 0, y: 0 }})"); gt2 = E(f"T.el('{t}')")
    check('E10 회전된 글상자 리사이즈 → 정수 크기로 반올림해도 반대쪽 꼭짓점 고정(±0.01)', close(wl['x'], wl2['x']) and close(wl['y'], wl2['y']) and gt2['w'] == int(gt2['w']), {'a': wl, 'b': wl2, 'g': gt2})

    # ============ F. 그룹·순서·복제·삭제·잠금·숨김 ============
    E("T.reset()")
    ids = [E(f"T.add('shape', {{ x: {100 + i * 150}, y: 100, w: 100, h: 100 }})") for i in range(4)]
    E(f"T.V.select(['{ids[1]}', '{ids[2]}'])")
    kb.press('Control+g')
    top = E("T.ids()")
    grp = E(f"T.V.node(T.ids()[1])")
    check('F1 Ctrl+G → 그룹 1개(자식 순서 유지, 원래 자리)', len(top) == 3 and grp['type'] == 'group' and [c['id'] for c in grp['children']] == ids[1:3] and top[0] == ids[0] and top[2] == ids[3], top)
    gid = top[1]
    click(E("T.C(300, 150)"))
    selg = E("T.V.selection")
    before = [E(f"T.el('{i}')") for i in ids[1:3]]
    drag(E("T.C(300, 150)"), E("T.C(331, 190)"), mods=['Alt'])
    after = [E(f"T.el('{i}')") for i in ids[1:3]]
    pd_, pu_ = E("T.P(T.lastDown())"), E("T.P(T.lastUp())")
    dx = pu_['x'] - pd_['x']
    check('F2 그룹 자식 클릭 → 그룹 선택, 끌면 자식이 함께 이동', selg == [gid] and all(close(a2['x'] - b2['x'], dx) for a2, b2 in zip(after, before)), selg)
    kb.press('Control+Shift+g')
    check('F3 Ctrl+Shift+G → 그룹 해제, 자식이 같은 자리·순서로 최상위에', E("T.ids()") == ids and E("T.V.selection") == ids[1:3])
    E(f"T.V.select(['{ids[0]}'])"); kb.press('Control+]'); o1 = E("T.ids()")
    kb.press('Control+Shift+]'); o2 = E("T.ids()")
    kb.press('Control+['); o3 = E("T.ids()")
    kb.press('Control+Shift+['); o4 = E("T.ids()")
    dom = E("T.domOrder()")
    check('F4 Ctrl+] 앞으로 / Ctrl+Shift+] 맨 앞 / Ctrl+[ 뒤로 / Ctrl+Shift+[ 맨 뒤, 화면 DOM 순서도 같음',
          o1 == [ids[1], ids[0], ids[2], ids[3]] and o2 == [ids[1], ids[2], ids[3], ids[0]] and o3 == [ids[1], ids[2], ids[0], ids[3]] and o4 == ids and dom == ids, [o1, o2, o3, o4, dom])
    t = E("""T.add('text', { x: 100, y: 400, w: 400, h: 100, doc: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: '복제할 글' }] }] } })""")
    E(f"T.V.select(['{t}'])"); kb.press('Control+d')
    dup = E("T.V.selection")[0]
    gd = E(f"T.el('{dup}')")
    E(f"T.V.enterEdit('{dup}')"); cdp.send('Input.insertText', {'text': '새 '}); kb.press('Escape')
    check('F5 Ctrl+D → 원본 바로 위에 +10px 복사본, 글도 복사되고 따로 편집됨', gd['x'] == 110 and gd['y'] == 410 and E("T.ids()").index(dup) == E("T.ids()").index(t) + 1 and E(f"T.text('{t}')") == '복제할 글' and E(f"T.text('{dup}')").endswith('복제할 글') and E(f"T.text('{dup}')") != '복제할 글',
          [E(f"T.text('{t}')"), E(f"T.text('{dup}')")])
    E(f"T.V.enterEdit('{t}')"); cdp.send('Input.insertText', {'text': '가'}); time.sleep(1.1); kb.press('Escape')
    edobj = E(f"(() => {{ window.__edRef = T.V.editors.get('{t}'); return 1; }})()")
    E(f"T.V.select(['{t}'])"); kb.press('Delete')
    gone = E(f"T.V.node('{t}') === null")
    E("__nabi.history.undo()")
    back = E(f"T.V.node('{t}') !== null && T.text('{t}')")
    same_ed = E(f"T.V.editors.get('{t}') === window.__edRef")
    E("__nabi.history.undo()")
    after_text_undo = E(f"T.text('{t}')")
    check('F6 Delete → 삭제, 되돌리기 → 같은 편집기로 글까지 복원, 더 되돌리면 그 전의 글 입력도 취소됨', gone and back and back.startswith('가') and same_ed and not after_text_undo.startswith('가'), [back, after_text_undo])
    E(f"T.V.select(['{ids[3]}'])"); kb.press('Control+Shift+l')
    click(E("T.C(600, 150)"))
    lk = E("T.V.selection")
    kb.press('Escape'); drag(E("T.C(20, 20)"), E("T.C(1000, 300)"))
    lk2 = E("T.V.selection")
    E(f"T.V.select(['{ids[2]}'])"); kb.press('Control+Shift+h')
    hid = E(f"T.V.nodes.get('{ids[2]}').style.display")
    click(E("T.C(450, 150)")); hsel = E("T.V.selection")
    exp_ids = E("(() => { const el = T.V.exportPage().render(); return el.children.length; })()")
    check('F7 Ctrl+Shift+L 잠금 → 클릭·범위 선택에서 제외 / Ctrl+Shift+H 숨김 → 화면·클릭·출력에서 제외',
          ids[3] not in lk and ids[3] not in lk2 and hid == 'none' and ids[2] not in hsel and exp_ids == len(E("T.ids()")) - 1, {'lk': lk, 'lk2': lk2, 'hid': hid, 'exp': exp_ids})

    # ============ G. 정렬·분배 ============
    E("T.reset()")
    ids = [E(f"T.add('shape', {{ x: {x}, y: {y}, w: {w}, h: {h} }})") for x, y, w, h in [(100, 100, 80, 60), (300, 250, 120, 40), (700, 180, 60, 100)]]
    E(f"T.V.select({json.dumps(ids)})")
    res = {}
    for how in ['left', 'right', 'hcenter', 'top', 'bottom', 'vcenter']:
        E(f"T.V.align('{how}')"); res[how] = [E(f"T.el('{i}')") for i in ids]; E("__nabi.history.undo()")
    ok = all(close(g['x'], 100) for g in res['left']) and all(close(g['x'] + g['w'], 760) for g in res['right']) and all(close(g['x'] + g['w'] / 2, 430) for g in res['hcenter']) \
        and all(close(g['y'], 100) for g in res['top']) and all(close(g['y'] + g['h'], 290) for g in res['bottom']) and all(close(g['y'] + g['h'] / 2, 195) for g in res['vcenter'])
    check('G1 정렬 6종(여러 개 → 선택 전체 상자 기준)', ok)
    E(f"T.V.select(['{ids[1]}'])"); E("T.V.align('hcenter')"); E("T.V.align('vcenter')")
    g = E(f"T.el('{ids[1]}')")
    check('G2 하나만 선택 → 장 기준 가운데(540, 540)', close(g['x'] + g['w'] / 2, 540) and close(g['y'] + g['h'] / 2, 540), g)
    E("__nabi.history.undo()"); E("__nabi.history.undo()")
    E(f"T.V.select({json.dumps(ids)})"); E("T.V.distribute('h')")
    gs = sorted([E(f"T.el('{i}')") for i in ids], key=lambda g: g['x'])
    gaps = [gs[i + 1]['x'] - (gs[i]['x'] + gs[i]['w']) for i in range(2)]
    check('G3 가로 분배 → 양 끝 고정, 간격 같음', close(gaps[0], gaps[1], 1e-9) and close(gs[0]['x'], 100) and close(gs[2]['x'], 700), gaps)
    # 회전된 요소의 정렬은 회전 반영 외곽 상자 기준
    E(f"T.V.setProps({{ rotation: 45 }}, ['{ids[0]}'])"); E(f"T.V.select({json.dumps(ids)})"); E("T.V.align('left')")
    bb = E(f"T.M.boundsOf(T.V.node('{ids[0]}'))")
    check('G4 회전된 요소는 회전을 반영한 외곽 상자로 정렬', close(bb['x'], E(f"T.M.boundsOf(T.V.node('{ids[1]}')).x")), bb)

    # ============ H. 글상자 편집 모드 ============
    E("T.reset()")
    t = E("""T.add('text', { x: 200, y: 200, w: 420, h: 220, rotation: 25, doc: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: '회전한 글상자에서도 클릭한 글자 사이에 커서가 놓여야 합니다. Rotation test 가나다' }] }] } })""")
    # 170%로 확대하고 글상자 중심을 화면 가운데로
    E(f"(() => {{ const c = __G.center(T.V.node('{t}')); const w = T.V.viewport.clientWidth, h = T.V.viewport.clientHeight; T.V.setView(1.7, w / 2 - c.x * 1.7, h / 2 - c.y * 1.7); }})()")
    # 편집기 매핑에서 글자 경계 좌표를 구해 화면 좌표로 바꾼 뒤 더블클릭(편집 진입) → 클릭
    pts = E(f"""(() => {{ const ed = T.V.editors.get('{t}'); const out = []; const size = ed.state.doc.content.size;
      for (const pos of [3, 9, 17, 25, 33, 41]) {{ if (pos >= size) continue; const c = ed.mapper.coordsAt(pos, 1); if (!c) continue;
        const cl = T.L('{t}', c.x, c.top + c.h / 2); out.push({{ pos, x: cl.x, y: cl.y }}); }} return out; }})()""")
    click(pts[0], count=2)
    entered = E("T.V.editing") == t
    hits = []
    for q in pts:
        click(q)
        hits.append([q['pos'], E(f"T.V.editors.get('{t}').state.selection.head")])
    check(f'H1 회전(25°)·확대(170%) 상태: 더블클릭 → 편집 모드, 글자 경계 {len(pts)}곳을 클릭하면 그 위치에 커서', entered and len(pts) >= 5 and all(a2 == b2 for a2, b2 in hits), {'hits': hits, 'entered': entered, 'pts': pts, 'vp': E("T.V.viewport.getBoundingClientRect().toJSON()"), 'log': E(f"T.V.editors.get('{t}').log.slice(-6)")})
    cdp.send('Input.imeSetComposition', {'text': '한', 'selectionStart': 1, 'selectionEnd': 1})
    ta = E(f"""(() => {{ const ed = T.V.editors.get('{t}'); const r = ed.input.getBoundingClientRect(); const c = ed.caret; const cl = T.L('{t}', c.x, c.top + c.h / 2); return {{ tx: r.left + r.width / 2, ty: r.top + r.height / 2, cx: cl.x, cy: cl.y }}; }})()""")
    cdp.send('Input.insertText', {'text': '한'})
    check('H2 조합 중 숨긴 입력창이 커서 자리에 있음(IME 후보창 위치, 회전·확대 반영 ±6px)', math.dist((ta['tx'], ta['ty']), (ta['cx'], ta['cy'])) < 6, ta)
    n_el = len(E("T.ids()"))
    kb.press('Control+d'); kb.press('Delete'); kb.type('v')
    check('H3 편집 중에는 캔버스 단축키 무시(Ctrl+D 복제 안 됨, Delete·V는 글자 편집)', len(E("T.ids()")) == n_el and 'v' in E(f"T.text('{t}')") and E("T.V.tool") == 'select', E(f"T.text('{t}')")[:40])
    click(E("(() => { const r = T.V.viewport.getBoundingClientRect(); return { x: r.left + 20, y: r.bottom - 20 }; })()"))  # 화면 안 빈 곳
    check('H4 편집 중 글상자 밖 클릭 → 편집 끝, 선택 해제', E("T.V.editing") is None and E("T.V.selection") == [])
    E("T.V.zoomFit()")
    E(f"T.V.select(['{t}'])"); kb.press('Enter')
    check('H5 글상자 선택 후 Enter → 편집 모드(커서는 글 끝)', E("T.V.editing") == t and E(f"T.V.editors.get('{t}').state.selection.head") == E(f"T.V.editors.get('{t}').state.doc.content.size") - 1)
    kb.press('Escape')
    small = E("""T.add('text', { x: 700, y: 700, w: 120, h: 40, doc: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: '넘치는 글상자입니다 넘치는 글상자입니다' }] }] } })""")
    ov1 = E(f"!!T.V.overlay.querySelector('[data-overflow=\"{small}\"]')")
    E(f"T.V.setProps({{ w: 600, h: 200 }}, ['{small}'])")
    ov2 = E(f"!!T.V.overlay.querySelector('[data-overflow=\"{small}\"]')")
    check('H6 넘친 글상자에 빨간 + 표시, 키우면 사라짐', ov1 and not ov2, [ov1, ov2])

    # ============ I. 확대·이동 ============
    E("T.reset()")
    E("T.V.zoomFit()")
    pt = E("T.C(300, 400)"); pt = {'x': round(pt['x']), 'y': round(pt['y'])}  # 마우스 이벤트 좌표는 정수
    before_pt = E(f"T.V.clientToPage({pt['x']}, {pt['y']})")
    mouse.move(pt['x'], pt['y'])
    kb.down('Control'); mouse.wheel(0, -240); kb.up('Control')
    z1 = E("T.V.z"); back = E(f"T.V.clientToPage({pt['x']}, {pt['y']})")
    check('I1 Ctrl+휠 확대 → 커서 아래 장 좌표 고정(±0.01)', z1 > st['z'] * 1.3 and close(back['x'], before_pt['x']) and close(back['y'], before_pt['y']), {'z': z1, 'p': back, 'before': before_pt})
    kb.press('Control+1'); z100 = E("T.V.z")
    kb.press('Control+='); z125 = E("T.V.z")
    kb.press('Control+0'); zf = E("T.V.z")
    check('I2 Ctrl+1 = 100%, Ctrl+= = ×1.25, Ctrl+0 = 화면에 맞춤', close(z100, 1) and close(z125, 1.25) and close(zf, st['z']), [z100, z125, zf])
    px0, py0 = E("T.V.px"), E("T.V.py")
    kb.down(' '); drag(E("T.C(500, 500)"), E("T.C(600, 560)")); kb.up(' ')
    d = E("T.lastUp()"), E("T.lastDown()")
    px1, py1 = E("T.V.px"), E("T.V.py")
    check('I3 Space+끌기 → 화면 이동(끈 만큼), 요소는 만들어지지 않음', close(px1 - px0, d[0]['x'] - d[1]['x']) and close(py1 - py0, d[0]['y'] - d[1]['y']) and E("T.ids()") == [], [px1 - px0, py1 - py0])
    mouse.wheel(0, 100); py2 = E("T.V.py")
    check('I4 휠 → 세로 스크롤', close(py2, py1 - 100), [py1, py2])
    a = E("T.add('shape', { x: 100, y: 100, w: 100, h: 100 })"); E(f"T.V.select(['{a}'])")
    sizes = []
    for z in [0.25, 1, 4]:
        E(f"T.V.setView({z}, 10, 10)"); sizes.append(E("T.V.overlay.querySelector('rect[data-h]').getAttribute('width')"))
    check('I5 핸들 크기는 확대와 무관하게 8px', sizes == ['8', '8', '8'], sizes)
    E("T.V.zoomFit()")

    # ============ J. 되돌리기 통합 ============
    E("T.reset()")
    init = E("T.full()")
    kb.press('r'); drag(E("T.C(100, 100)"), E("T.C(300, 260)"))
    kb.press('t'); click(E("T.C(400, 400)")); cdp.send('Input.insertText', {'text': '되돌리기 통합 시험'}); time.sleep(1.1)
    kb.press('Enter'); cdp.send('Input.insertText', {'text': '둘째 줄'}); kb.press('Escape')
    tt = E("T.V.selection[0]")
    drag(E("T.C(450, 420)"), E("T.C(480, 470)"), mods=['Alt'])
    drag(E("T.handle(1, 1)"), E("T.C(900, 700)"))
    drag(E("T.handle('rot')"), E("T.C(900, 300)"))
    kb.press('Control+a'); kb.press('Control+g')
    kb.press('ArrowRight'); kb.press('ArrowRight'); kb.press('ArrowRight')
    kb.press('Control+Shift+g')
    E(f"T.V.select(['{tt}'])"); kb.press('Enter'); cdp.send('Input.insertText', {'text': '!'}); kb.press('Escape')
    kb.press('Delete')
    final = E("T.full()")
    n = 0
    while E("__nabi.history.canUndo"): E("__nabi.history.undo()"); n += 1
    all_undone = E("T.full()")
    while E("__nabi.history.canRedo"): E("__nabi.history.redo()")
    all_redone = E("T.full()")
    check(f'J1 섞인 작업(만들기·글 입력·이동·리사이즈·회전·그룹·방향키·해제·글 추가·삭제) {n}단위 → 모두 되돌리면 처음, 모두 다시 하면 마지막(글 내용 포함 JSON 일치)',
          all_undone == init and all_redone == final and n >= 10, {'n': n})
    E("__nabi.history.undo()")
    restored = E(f"T.text('{tt}')")
    check('J2 삭제 되돌리기 후 글상자 글 = 삭제 직전 글', restored == '되돌리기 통합 시험\n둘째 줄!', restored)

    # ============ K. 요소 복사/붙여넣기 ============
    E("T.reset()")
    a = E("T.add('shape', { x: 100, y: 100, w: 100, h: 100, fill: '#ff8800' })")
    t = E("""T.add('text', { x: 300, y: 100, w: 300, h: 100, doc: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: '복사될 글' }] }] } })""")
    E(f"T.V.select(['{a}', '{t}'])"); pg.focus('.pv-viewport')
    kb.press('Control+c'); kb.press('Control+v')
    ids1 = E("T.ids()"); sel1 = E("T.V.selection")
    kb.press('Control+v')
    ids2 = E("T.ids()"); sel2 = E("T.V.selection")
    g1 = E(f"T.el('{sel1[0]}')"); g2 = E(f"T.el('{sel2[0]}')")
    check('K1 Ctrl+C → Ctrl+V 두 번: 요소 2개씩 새로 생김(+10px, +20px), 글 내용 복사',
          len(ids1) == 4 and len(ids2) == 6 and g1['x'] == 110 and g2['x'] == 120 and g1['fill'] == '#ff8800' and E(f"T.text('{sel1[1]}')") == '복사될 글', {'g1': g1, 'g2': g2})
    E(f"T.V.select(['{t}'])"); kb.press('Control+x')
    cut_gone = E(f"T.V.node('{t}') === null")
    kb.press('Control+v')
    pasted = E("T.V.selection")[0]
    check('K2 Ctrl+X → 지워짐, Ctrl+V → 같은 글상자가 새로 생김', cut_gone and E(f"T.text('{pasted}')") == '복사될 글')
    E("navigator.clipboard.writeText('붙여넣은 글\\n두 줄')"); E("T.V.select([])")
    kb.press('Control+v')
    newt = E("T.V.selection")[0]
    check('K3 편집 중이 아닐 때 글자 붙여넣기 → 새 글상자', E(f"T.V.node('{newt}').type") == 'text' and E(f"T.text('{newt}')") == '붙여넣은 글\n두 줄')
    E("""(async () => { const c = new OffscreenCanvas(40, 30); const x = c.getContext('2d'); x.fillStyle = '#0a8'; x.fillRect(0, 0, 40, 30);
       const b = await c.convertToBlob({ type: 'image/png' }); await navigator.clipboard.write([new ClipboardItem({ 'image/png': b })]); })()""")
    kb.press('Control+v')
    time.sleep(0.4)
    im = E("T.V.node(T.V.selection[0])")
    check('K4 이미지 붙여넣기 → 이미지 요소(원본 크기 40×30, 장 가운데)', im and im['type'] == 'image' and close(im['w'], 40) and close(im['x'] + im['w'] / 2, 540), im and {k: im[k] for k in ('type', 'x', 'w', 'h')})

    # ============ L. 출력 = 화면 ============
    E("T.reset(800, 600)")
    E("""(async () => {
      const c = new OffscreenCanvas(120, 80); const x = c.getContext('2d');
      const g = x.createLinearGradient(0, 0, 120, 0); g.addColorStop(0, '#f60'); g.addColorStop(1, '#06f'); x.fillStyle = g; x.fillRect(0, 0, 120, 80);
      const url = URL.createObjectURL(await c.convertToBlob({ type: 'image/png' }));
      T.add('shape', { x: 40, y: 40, w: 300, h: 180, fill: '#ffe08a', stroke: '#8a5a00', strokeWidth: 6, radius: 24 });
      T.add('shape', { shape: 'ellipse', x: 420, y: 60, w: 220, h: 220, fill: '#b9e3ff', rotation: 15 });
      T.add('image', { src: url, x: 300, y: 200, w: 240, h: 160, rotation: -20, opacity: 0.8, blend: 'multiply' });
      T.add('text', { x: 60, y: 320, w: 420, h: 220, rotation: 8, doc: { type: 'doc', content: [
        { type: 'paragraph', content: [{ type: 'text', text: '출력과 화면 비교 ', marks: [{ type: 'bold' }] }, { type: 'text', text: '회전 글상자', marks: [{ type: 'color', attrs: { value: '#c0392b' } }, { type: 'underline', attrs: { style: 'wavy' } }] }] },
        { type: 'paragraph', content: [{ type: 'text', text: 'Mixed 영문과 한글 텍스트' }] }] } });
      T.add('shape', { x: 600, y: 400, w: 100, h: 100, fill: '#000', hidden: true });
      await new Promise((r) => setTimeout(r, 200));
    })()""")
    E("T.V.select([]); T.V.setView(1, 20, 20)")
    mouse.move(5, 995)
    time.sleep(0.2)
    rr = E("(() => { const r = T.V.pageEl.getBoundingClientRect(); return { x: r.left, y: r.top }; })()")
    scr = Image.open(io.BytesIO(pg.screenshot(clip={'x': rr['x'], 'y': rr['y'], 'width': 800, 'height': 600})))
    u = E("(async () => { const EX = await import('/src/export.js'); return (await EX.rasterize(T.V.exportPage(), { scale: 1 })).toDataURL(); })()")
    out = Image.open(io.BytesIO(base64.b64decode(u.split(',')[1])))
    m = compare(scr, out)
    metrics['export-vs-screen'] = m
    scr.save(os.path.join(OUT, 'stage6-screen.png')); out.save(os.path.join(OUT, 'stage6-export.png'))
    check(f'L1 장 출력(PNG 1x) = 화면: 둥근 사각형+테두리, 회전 원, 회전·투명도·곱하기 혼합 이미지, 회전 글상자(꾸밈), 숨긴 요소 제외 (16 초과 {m.get("pct16")}%, 이웃 허용 64 초과 {m.get("nb_pct64")}%)', same_as_screen(m), m)
    u2 = E("(async () => { const EX = await import('/src/export.js'); return (await EX.rasterize(T.V.exportPage(), { scale: 2 })).toDataURL(); })()")
    im2 = Image.open(io.BytesIO(base64.b64decode(u2.split(',')[1])))
    check('L2 배율 2 출력 크기 1600×1200', im2.size == (1600, 1200), im2.size)
    html = E("(async () => { const EX = await import('/src/export.js'); return EX.buildPrintHTML([T.V.exportPage()], { title: 't' }); })()")
    vp = ctx.new_page(); vp.set_content(html, wait_until='load'); vp.evaluate("document.fonts.ready")
    pdfp = os.path.join(TMP, 'p.pdf'); vp.pdf(path=pdfp, prefer_css_page_size=True, print_background=True); vp.close()
    info = subprocess.run(['pdfinfo', pdfp], capture_output=True, text=True).stdout
    txt = subprocess.run(['pdftotext', pdfp, '-'], capture_output=True, text=True).stdout
    flat = ''.join(txt.split())
    # 회전된 줄은 pdftotext가 글자마다 끊어 읽으므로 글자 단위로 확인
    check('L3 벡터 PDF: 쪽 600×450pt, 회전 글상자의 글자 추출 가능(회전된 줄은 추출기가 글자 단위로 끊어 읽음)', '600 x 450 pts' in info and '출력과화면비교' in flat and all(ch in flat for ch in '회전글상자영문한글텍스트'), {'size': [l for l in info.splitlines() if 'size' in l], 'text': txt[:200]})

    # ============ P. 속도 ============
    E("T.reset()")
    E("for (let i = 0; i < 60; i++) T.add(i % 3 ? 'shape' : 'text', { x: 40 + (i % 10) * 100, y: 40 + Math.floor(i / 10) * 160, w: 90, h: 120 })")
    E("""(() => { const V = T.V; const orig = V.render.bind(V); window.__rt = []; V.render = () => { const t0 = performance.now(); orig(); __rt.push(performance.now() - t0); }; })()""")
    kb.press('Control+a')
    E("__rt.length = 0")
    drag(E("T.C(80, 80)"), E("T.C(380, 330)"), steps=40, mods=['Alt'])
    rt = E("__rt")
    metrics['drag60-render-ms'] = {'avg': round(sum(rt) / len(rt), 2), 'max': round(max(rt), 2), 'n': len(rt)}
    t = E("T.add('text', { x: 100, y: 100, w: 500, h: 400, doc: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: '글상자 리사이즈 속도 '.repeat(40) }] }] } })")
    E(f"T.V.select(['{t}'])"); E("__rt.length = 0")
    drag(E("T.handle(1, 1)"), E("T.C(900, 900)"), steps=40)
    rt2 = E("__rt")
    metrics['text-resize-render-ms'] = {'avg': round(sum(rt2) / len(rt2), 2), 'max': round(max(rt2), 2), 'n': len(rt2)}
    check(f'P1 요소 60개 끌기: 한 번 다시 그리기 평균 {metrics["drag60-render-ms"]["avg"]}ms / 긴 글상자 리사이즈 평균 {metrics["text-resize-render-ms"]["avg"]}ms (기준 16ms)',
          metrics['drag60-render-ms']['avg'] < 16 and metrics['text-resize-render-ms']['avg'] < 16, metrics)

    check('Z 검증 전체 동안 페이지 오류 없음', not errors, errors)
    b.close()

srv.shutdown()
json.dump(metrics, open(os.path.join(OUT, 'stage6-metrics.json'), 'w'), ensure_ascii=False, indent=1)
fails = [r for r in results if not r[1]]
for name, ok, detail in results:
    print(('PASS ' if ok else 'FAIL ') + name + ('' if ok else '  ' + json.dumps(detail, ensure_ascii=False, default=str)[:700]))
print('metrics:', json.dumps(metrics, ensure_ascii=False))
print(f'{len(results) - len(fails)}/{len(results)} passed')
