"""9단계 검증: 펜·선·다각형 도구, 패스 점 편집, 이미지 자르기·필터·마스크, 그라디언트·패턴 채움,
글상자 모양(원·도넛·자유형·이미지 외곽선), 경로 글자, 저장·열기 왕복, 되돌리기.
사용: python3 test/stage9.py  (proto 폴더 기준, poppler-utils 필요)
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
  window.__P = await import('/app/paths.js');
  window.__EX = await import('/src/export.js');
  window.__VF = await import('/src/verify.js');
  const N = __nabi, V = N.view, M = N.M;
  window.__evs = [];
  for (const t of ['mousedown', 'mouseup']) window.addEventListener(t, (e) => __evs.push({ t, x: e.clientX, y: e.clientY }), true);
  const canvasBlob = async (w, h, draw, type = 'image/png') => { const c = new OffscreenCanvas(w, h); draw(c.getContext('2d'), w, h); return c.convertToBlob({ type }); };
  window.T = {
    N, V, M,
    reset: (w = 800, h = 600) => { N.app.project.pages = [M.newPage({ w, h })]; N.app.current = null; N.app.switchPage(N.app.project.pages[0]); N.history.clear(); N.flush(); },
    add: (type, props) => { const n = M.makeElement(type, props); V.change('create', () => { V.page.elements.push(n); }); return n.id; },
    el: (id) => { const n = V.node(id); return n && JSON.parse(JSON.stringify(n, (k, v) => (k === 'doc' ? undefined : v))); },
    ids: () => V.page.elements.map((n) => n.id),
    C: (x, y) => V.pageToClient({ x, y }),
    L: (id, x, y) => V.pageToClient(__G.fromLocal(V.node(id), { x, y })),
    P: (e) => V.clientToPage(e.x, e.y),
    lastDown: () => [...__evs].reverse().find((e) => e.t === 'mousedown'),
    lastUp: () => [...__evs].reverse().find((e) => e.t === 'mouseup'),
    field: (label) => { N.flush(); const f = document.querySelector(`#props [data-field="${label}"]`); f?.scrollIntoView({ block: 'center' }); if (!f) return null; const b = f.getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2, value: f.value }; },
    setSel: (label, value) => { N.flush(); const s = document.querySelector(`#props [data-field="${label}"]`); s.value = value; s.dispatchEvent(new Event('change')); },
    btn: (label) => { N.flush(); const b = document.querySelector(`#props button[data-field="${label}"]`); b.click(); return !!b; },
    // 이미지 만들기(에셋)
    photo: async (w, h) => { const b = await canvasBlob(w, h, (x, W, H) => { const g = x.createLinearGradient(0, 0, W, H); g.addColorStop(0, '#f60'); g.addColorStop(1, '#06f'); x.fillStyle = g; x.fillRect(0, 0, W, H); x.fillStyle = '#fff'; x.fillRect(W * 0.4, H * 0.4, W * 0.2, H * 0.2); }); const a = await N.assets.add(b); return { src: a.url, w, h }; },
    starImg: async (w, h, bg = null) => { const b = await canvasBlob(w, h, (x, W, H) => { if (bg) { x.fillStyle = bg; x.fillRect(0, 0, W, H); } x.fillStyle = '#2b3a66'; x.beginPath(); for (let i = 0; i < 10; i++) { const a = -Math.PI / 2 + i * Math.PI / 5, r = i % 2 ? W * 0.2 : W * 0.48; x.lineTo(W / 2 + Math.cos(a) * r, H / 2 + Math.sin(a) * r); } x.closePath(); x.fill(); }); const a = await N.assets.add(b); return { src: a.url, w, h }; },
    circleImg: async (w, h) => { const b = await canvasBlob(w, h, (x, W, H) => { x.fillStyle = '#000'; x.beginPath(); x.arc(W / 2, H / 2, W * 0.4, 0, Math.PI * 2); x.fill(); }); const a = await N.assets.add(b); return { src: a.url, w, h }; },
    tile: async () => { const b = await canvasBlob(20, 20, (x) => { x.fillStyle = '#fff3c4'; x.fillRect(0, 0, 20, 20); x.fillStyle = '#e07a5f'; x.fillRect(0, 0, 10, 10); x.fillRect(10, 10, 10, 10); }); const a = await N.assets.add(b); return { src: a.url, w: 20, h: 20 }; },
    raster: async (opts = {}) => (await __EX.rasterize(V.exportPage(), { scale: 1, ...opts })).toDataURL(),
    verifyText: (id) => { const ed = V.editors.get(id); return __VF.verify(ed.frameEl, ed.frame, ed.built, { ...ed.result, assets: ed.assets }, ed.state.doc.toJSON()); },
    longDoc: (t) => ({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: t }] }] }),
    snap: async () => { const r = await N.P.toJSON(N.app.project, { assets: N.assets, docOf: V.docOf, swatches: N.swatches.list }); delete r.json.savedAt; delete r.json.name; return JSON.stringify(r.json); },
  };
  return true;
})()
"""
LONG = '글상자 모양 시험 문장입니다. 원이나 도넛이나 별 모양 안에 글이 흘러 들어가야 하고 바깥으로 나가면 안 됩니다. Shape flow test text goes here. ' * 4

with sync_playwright() as p:
    b = p.chromium.launch(args=['--disable-lcd-text'])
    ctx = b.new_context(viewport={'width': 1600, 'height': 1000})
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
    def drag(a, c, steps=8, mods=()):
        for m in mods: kb.down(m)
        mouse.move(a['x'], a['y']); mouse.down(); mouse.move(c['x'], c['y'], steps=steps); mouse.up()
        for m in reversed(mods): kb.up(m)
    def export_vs_screen(tag, transparent=False):
        E("T.V.select([]); T.V.setView(1, 20, 20); T.V.overlay.style.visibility = 'hidden'")
        mouse.move(5, 995); time.sleep(0.25)
        rr = E("(() => { const r = T.V.pageEl.getBoundingClientRect(), v = T.V.viewport.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height, fits: r.right <= v.right && r.bottom <= v.bottom }; })()")
        assert rr['fits'], f'{tag}: 장이 화면 영역보다 큼 {rr}'
        scr = Image.open(io.BytesIO(pg.screenshot(clip={'x': rr['x'], 'y': rr['y'], 'width': rr['w'], 'height': rr['h']})))
        E("T.V.overlay.style.visibility = ''")
        out = img(E("T.raster()"))
        m = compare(scr, out)
        metrics[f'export/{tag}'] = m
        scr.save(os.path.join(OUT, f'stage9-{tag}-screen.png')); out.save(os.path.join(OUT, f'stage9-{tag}-export.png'))
        return m

    # ============ A. 도구 ============
    E("T.reset(900, 800)")
    kb.press('p')
    pts = [(200, 200), (500, 180), (560, 460)]
    for x, y in pts[:2]: click(E(f"T.C({x}, {y})"))
    drag(E(f"T.C({pts[2][0]}, {pts[2][1]})"), E("T.C(640, 560)"))
    click(E("T.C(260, 480)"))
    click(E(f"T.C({pts[0][0]}, {pts[0][1]})"))  # 첫 점 → 닫기
    pid = E("T.ids()[0]")
    pe = E(f"T.el('{pid}')")
    anchors = E(f"(() => {{ const n = T.V.node('{pid}'); const {{ nodes, closed }} = __P.dToNodes(__P.scaleD(n.d, n.w / n.pw, n.h / n.ph)); return {{ closed, pts: nodes.map((q) => __G.fromLocal(n, {{ x: q.x, y: q.y }})), curved: nodes.filter((q) => q.i || q.o).length }}; }})()")
    want = [E(f"T.P(T.V.pageToClient({{ x: {x}, y: {y} }}))") for x, y in pts + [(260, 480)]]
    ok = anchors['closed'] and len(anchors['pts']) == 4 and all(abs(a['x'] - w['x']) < 1.5 and abs(a['y'] - w['y']) < 1.5 for a, w in zip(anchors['pts'], want)) and anchors['curved'] == 1
    check('A1 펜 도구(P): 클릭 3점 + 끌어서 곡선 점 1개 + 첫 점 클릭으로 닫기 → 닫힌 패스, 점 4개가 누른 자리(±1.5px, 화면 좌표 정수화), 곡선 점 1개, 선택 도구로 복귀',
          pe['type'] == 'path' and pe['closed'] and ok and E("T.V.tool") == 'select', {'el': {k: pe[k] for k in ('x', 'y', 'w', 'h')}, 'anchors': anchors})
    kb.press('p')
    click(E("T.C(700, 600)")); click(E("T.C(860, 660)"), count=2)
    op = E("T.el(T.ids()[1])")
    check('A2 펜: 더블클릭으로 열린 패스로 끝내기', op['type'] == 'path' and not op['closed'] and len(E(f"__P.dToNodes(T.V.node('{op['id']}').d).nodes")) == 2, op.get('d'))
    kb.press('l')
    drag(E("T.C(100, 700)"), E("T.C(300, 580)"), mods=['Shift'])
    ln = E("T.el(T.ids()[2])")
    ang = E(f"(() => {{ const n = T.V.node('{ln['id']}'); const s = __P.parseD(n.d); return Math.atan2(s[1].p[1] - s[0].p[1], s[1].p[0] - s[0].p[0]) * 180 / Math.PI; }})()")
    check('A3 선 도구(L) + Shift → 45° 단위 직선 패스', ln['type'] == 'path' and close(ang, -45, 1e-6), ang)
    pg.click('#shapeBtn'); pg.click('#shapeMenu [data-tool=polygon]')  # 12단계 개편: 다각형은 왼쪽 도구 줄의 도형 메뉴 안
    drag(E("T.C(600, 100)"), E("T.C(800, 300)"))
    pgid = E("T.ids()[3]")
    E("T.setSel('모양', 'star')")
    st = E(f"T.el('{pgid}')")
    check('A4 다각형 도구 → 6각형, 속성 패널 모양 = 별 → 별(안쪽 50%)', st['type'] == 'shape' and st['shape'] == 'star' and st['sides'] == 6 and st['inner'] == 0.5, {k: st.get(k) for k in ('shape', 'sides', 'inner')})
    # 점 편집: 더블클릭 → 둘째 점을 끌기
    a1 = anchors['pts'][1]
    E("T.V.select([])")
    c0 = E(f"__G.center(T.V.node('{pid}'))")
    click(E(f"T.C({c0['x']}, {c0['y']})"), count=2)
    in_edit = E("!!T.V.pathEdit")
    down_pt = E(f"T.V.pageToClient({{ x: {a1['x']}, y: {a1['y']} }})")
    drag(down_pt, E("T.C(560, 120)"))
    pd, pu0 = E("T.P(T.lastDown())"), E("T.P(T.lastUp())")
    pu = {'x': a1['x'] + pu0['x'] - pd['x'], 'y': a1['y'] + pu0['y'] - pd['y']}  # 점은 포인터가 움직인 만큼 옮겨진다
    anch2 = E(f"(() => {{ const n = T.V.node('{pid}'); const {{ nodes }} = __P.dToNodes(__P.scaleD(n.d, n.w / n.pw, n.h / n.ph)); return nodes.map((q) => __G.fromLocal(n, {{ x: q.x, y: q.y }})); }})()")
    moved_ok = close(anch2[1]['x'], pu['x'], 0.02) and close(anch2[1]['y'], pu['y'], 0.02)
    others_ok = all(close(anch2[k]['x'], anchors['pts'][k]['x'], 0.02) and close(anch2[k]['y'], anchors['pts'][k]['y'], 0.02) for k in (0, 2, 3))
    kb.press('Escape')
    E("__nabi.history.undo()")
    back = E(f"(() => {{ const n = T.V.node('{pid}'); const {{ nodes }} = __P.dToNodes(__P.scaleD(n.d, n.w / n.pw, n.h / n.ph)); return nodes.map((q) => __G.fromLocal(n, {{ x: q.x, y: q.y }})); }})()")
    check('A5 패스 더블클릭 → 점 편집, 점 끌기 → 그 점만 포인터 자리로(±0.02px), 나머지 점은 장 위치 그대로(상자는 경로에 맞게 다시 잡힘), 되돌리기',
          in_edit and moved_ok and others_ok and close(back[1]['x'], anchors['pts'][1]['x'], 0.02), {'moved': anch2[1], 'up': pu})
    m = export_vs_screen('tools')
    check(f'A6 펜 패스(곡선)·열린 패스·직선·별 출력 = 화면 (16 초과 {m.get("pct16")}%, 이웃 허용 {m.get("nb_pct64")}%)', same_as_screen(m), m)

    # ============ B. 이미지: 자르기·필터·마스크 ============
    E("T.reset()")
    ph = E("T.photo(800, 600)")
    im = E(f"T.add('image', {{ src: {json.dumps(ph['src'])}, x: 100, y: 100, w: 400, h: 300 }})")
    E("T.V.setView(1, 20, 20)")
    click(E("T.C(300, 250)"), count=2)
    in_crop = E("!!T.V.crop")
    h = E(f"T.L('{im}', 400, 150)")
    drag(h, {'x': h['x'] - 100, 'y': h['y']})
    g1 = E(f"T.el('{im}')")
    ghost = E(f"(() => {{ const n = T.V.node('{im}'); const c = n.crop; const W = n.w / c.w; return __G.fromLocal(n, {{ x: -c.x * W, y: -c.y * (n.h / c.h) }}); }})()")
    check('B1 이미지 더블클릭 → 자르기 모드, 오른쪽 핸들을 100px 안으로 → 폭 300, 자르기 폭 0.75, 원본 위치(왼쪽 위) 그대로',
          in_crop and close(g1['w'], 300, 0.01) and close(g1['crop']['w'], 0.75, 1e-6) and close(ghost['x'], 100) and close(ghost['y'], 100), {'g': g1, 'ghost': ghost})
    drag(E("T.C(200, 250)"), E("T.C(260, 250)"))
    g2 = E(f"T.el('{im}')")
    check('B2 안쪽 끌기 → 보이는 부분만 옮김(상자 그대로, 원본 밖으로는 못 감: x 0 → 0)', close(g2['x'], 100) and close(g2['w'], 300) and close(g2['crop']['x'], 0, 1e-9), g2['crop'])
    drag(E("T.C(260, 250)"), E("T.C(160, 250)"))
    g3 = E(f"T.el('{im}')")
    check('B3 반대로 끌기 → 원본 오른쪽 끝까지만(자르기 x = 0.25)', close(g3['crop']['x'], 0.25, 1e-9), g3['crop'])
    h = E(f"T.L('{im}', 300, 150)")
    drag(h, {'x': h['x'] + 400, 'y': h['y']})
    g4 = E(f"T.el('{im}')")
    check('B4 핸들을 원본 밖까지 끌어도 원본 끝에서 멈춤(자르기 x + w = 1)', close(g4['crop']['x'] + g4['crop']['w'], 1, 1e-6), g4['crop'])
    kb.press('Enter')
    m = export_vs_screen('crop')
    check(f'B5 자른 이미지 출력 = 화면 ({m.get("pct16")}%)', same_as_screen(m), m)
    gh = E(f"(() => {{ const n = T.V.node('{im}'); const c = n.crop; return __G.fromLocal(n, {{ x: -c.x * n.w / c.w, y: -c.y * n.h / c.h }}); }})()")
    E(f"T.V.select(['{im}'])"); E("T.btn('자르기 해제')")
    g5 = E(f"T.el('{im}')")
    check('B6 자르기 해제 → 원본 전체 크기(400×300), 원본이 있던 자리 그대로', g5['crop'] is None and close(g5['w'], 400) and close(g5['h'], 300) and close(g5['x'], gh['x']) and close(g5['y'], gh['y']), {'g': g5, 'ghost': gh})
    E(f"T.V.select(['{im}'])")
    click(E("(() => { __nabi.flush(); const h = document.querySelector('#props .pp-sec[data-sec=\"필터\"] .pp-h'); const b = h.getBoundingClientRect(); return { x: b.left + 30, y: b.top + b.height / 2 }; })()"))  # 12단계 개편: 필터 칸은 처음에 접혀 있음 → 펼침
    for lbl, val in [('밝기', 150), ('흑백', 100), ('흐림', 2)]:
        f = E(f"T.field('{lbl}')"); click(f); kb.press('Control+a'); kb.type(str(val)); kb.press('Enter')
    flt = E(f"T.V.nodes.get('{im}').querySelector('img').style.filter")
    check('B7 필터 밝기 150·흑백 100·흐림 2 → 이미지에 CSS 필터', 'brightness(150%)' in flt and 'grayscale(100%)' in flt and 'blur(2px)' in flt, flt)
    m = export_vs_screen('filter')
    check(f'B8 필터 적용 출력 = 화면 ({m.get("pct16")}%)', same_as_screen(m), m)
    E(f"T.V.setProps({{ filters: null }}, ['{im}'])")
    el_ = E("T.add('shape', { shape: 'ellipse', x: 150, y: 120, w: 300, h: 260, fill: '#000' })")
    E(f"T.V.select(['{im}', '{el_}'])")
    ok_btn = E("T.btn('도형으로 마스크')")
    g6 = E(f"T.el('{im}')")
    check('B9 이미지 + 원 선택 → "도형으로 마스크" → 이미지에 도형 마스크, 원은 지워짐', ok_btn and g6['mask']['kind'] == 'shape' and E(f"T.V.node('{el_}')") is None, g6.get('mask', {}).get('kind'))
    E("T.V.page.background = 'transparent'; T.V.render()")
    tr = img(E("T.raster()")).convert('RGBA')
    A = np.asarray(tr)
    corner, center = int(A[102, 102, 3]), int(A[250, 300, 3])
    check('B10 마스크 바깥(이미지 모서리)은 투명, 안쪽은 불투명(투명 배경 출력)', corner == 0 and center == 255, [corner, center])
    E("T.V.page.background = '#ffffff'; T.V.render()")
    m = export_vs_screen('mask')
    check(f'B11 도형 마스크 출력 = 화면 ({m.get("pct16")}%)', same_as_screen(m), m)
    E("(async () => { const c = await T.circleImg(200, 200); __nabi.app.pickImage = async () => c; })()")
    E(f"T.V.select(['{im}'])"); E("T.btn('마스크 해제')"); E("T.btn('알파 마스크 이미지…')")
    time.sleep(0.3)
    g7 = E(f"T.el('{im}')")
    E("T.V.page.background = 'transparent'; T.V.render()")
    A = np.asarray(img(E("T.raster()")).convert('RGBA'))
    corner, center = int(A[102, 102, 3]), int(A[250, 300, 3])
    E("T.V.page.background = '#ffffff'; T.V.render()")
    check('B12 알파 마스크(가운데 원만 불투명한 이미지) → 이미지 모서리 투명, 가운데 불투명', g7['mask']['kind'] == 'alpha' and corner == 0 and center == 255, [g7['mask']['kind'], corner, center])
    m = export_vs_screen('alphamask')
    check(f'B13 알파 마스크 출력 = 화면 ({m.get("pct16")}%)', same_as_screen(m), m)

    # ============ C. 채움 ============
    E("T.reset()")
    r = E("T.add('shape', { x: 100, y: 100, w: 400, h: 200, fill: '#ff0000' })")
    E(f"T.V.select(['{r}'])"); E("T.setSel('채움', 'linear')")
    E(f"T.V.setProps({{ fill: {{ type: 'linear', angle: 0, stops: [{{ o: 0, c: '#ff0000' }}, {{ o: 1, c: '#0000ff' }}] }} }}, ['{r}'])")
    A = np.asarray(img(E("T.raster()")).convert('RGB'))
    left, right = A[200, 104].tolist(), A[200, 495].tolist()
    check('C1 선형 그라디언트(0° = 왼쪽→오른쪽, 빨강→파랑): 왼쪽 끝 빨강·오른쪽 끝 파랑', left[0] > 240 and left[2] < 15 and right[2] > 240 and right[0] < 15, [left, right])
    m = export_vs_screen('linear')
    check(f'C2 그라디언트 출력 = 화면 ({m.get("pct16")}%)', same_as_screen(m), m)
    E("(async () => { const t = await T.tile(); __nabi.app.pickImage = async () => t; })()")
    E(f"T.V.select(['{r}'])"); E("T.setSel('채움', 'pattern')")
    time.sleep(0.3)
    pf = E(f"T.el('{r}').fill")
    A = np.asarray(img(E("T.raster()")).convert('RGB'))
    check('C3 패턴 채움(20px 체크무늬 반복): 칸마다 색이 번갈아 나옴', pf['type'] == 'pattern' and A[105, 105].tolist() != A[105, 115].tolist() and A[105, 105].tolist() == A[125, 125].tolist(), [pf.get('type'), A[105, 105].tolist(), A[105, 115].tolist()])
    m = export_vs_screen('pattern')
    check(f'C4 패턴 출력 = 화면 ({m.get("pct16")}%)', same_as_screen(m), m)
    E(f"T.V.setProps({{ fill: {{ type: 'radial', stops: [{{ o: 0, c: '#ffffff' }}, {{ o: 1, c: '#2b3a66' }}] }} }}, ['{r}'])")
    m = export_vs_screen('radial')
    check(f'C5 원형 그라디언트 출력 = 화면 ({m.get("pct16")}%)', same_as_screen(m), m)

    # ============ D. 글상자 모양 ============
    E("T.reset(940, 700)")
    t = E(f"T.add('text', {{ x: 50, y: 50, w: 420, h: 420, style: {{ fontSize: 20 }}, doc: T.longDoc({json.dumps(LONG)}) }})")
    E(f"T.V.select(['{t}'])"); E("T.setSel('모양', 'ellipse')")
    E("T.V.setView(1, 20, 20)")
    v1 = E(f"T.verifyText('{t}')")
    check(f'D1 원 모양 글상자: {v1["lines"]}줄, 모양 밖 글자 픽셀 0, 구간 초과 0, 글 순서 유지', v1['pixelsOutsideMask'] == 0 and v1['intervalOverruns'] == 0 and v1['textIntact'] and v1['lines'] > 5, v1)
    E("T.setSel('모양', 'donut')")
    v2 = E(f"T.verifyText('{t}')")
    two = E(f"(() => {{ const r = T.V.editors.get('{t}').result; const byY = {{}}; for (const l of r.lines) (byY[Math.round(l.y)] ||= []).push(l); return Object.values(byY).filter((a) => a.length >= 2).length; }})()")
    check(f'D2 도넛 모양: 모양 밖 0, 한 띠에 구간 2개(구멍 양쪽)인 줄 {two}개', v2['pixelsOutsideMask'] == 0 and v2['intervalOverruns'] == 0 and v2['textIntact'] and two >= 3, v2)
    E(f"T.V.setProps({{ padding: 12 }}, ['{t}'])"); E(f"T.V.change('a', () => {{ T.V.node('{t}').area = {{ ...T.V.node('{t}').area, smooth: 4 }}; }})")
    v2b = E(f"T.verifyText('{t}')")
    check('D3 도넛 + 여백 12 + 다듬기 4: 모양 밖 0', v2b['pixelsOutsideMask'] == 0 and v2b['intervalOverruns'] == 0, v2b)
    E(f"T.V.setProps({{ padding: 0 }}, ['{t}'])")
    s = E("T.add('shape', { shape: 'star', sides: 5, inner: 0.5, x: 490, y: 40, w: 430, h: 430 })")
    t2 = E(f"T.add('text', {{ x: 490, y: 40, w: 430, h: 430, style: {{ fontSize: 16 }}, doc: T.longDoc({json.dumps(LONG)}) }})")
    E(f"T.V.select(['{t2}', '{s}'])"); E("T.btn('도형 모양으로 글상자')")
    v3 = E(f"T.verifyText('{t2}')")
    check(f'D4 글상자 + 별 → "도형 모양으로 글상자": 별 안에만 글({v3["lines"]}줄, 모양 밖 0), 별 요소는 지워짐', E(f"T.el('{t2}').area.kind") == 'path' and E(f"T.V.node('{s}')") is None and v3['pixelsOutsideMask'] == 0 and v3['intervalOverruns'] == 0 and v3['lines'] > 3, v3)
    m = export_vs_screen('areas')
    check(f'D5 원·도넛·별 글상자 출력 = 화면 ({m.get("pct16")}%)', same_as_screen(m), m)
    E("T.reset(940, 700)")
    E("(async () => { const s = await T.starImg(400, 400); __nabi.app.pickImage = async () => s; })()")
    t3 = E(f"T.add('text', {{ x: 50, y: 50, w: 400, h: 400, style: {{ fontSize: 14 }}, doc: T.longDoc({json.dumps(LONG * 2)}) }})")
    E(f"T.V.select(['{t3}'])"); E("T.setSel('모양', 'image')")
    pg.wait_for_function(f"T.V.editors.get('{t3}').built.drawRect", timeout=5000)
    E("T.V.setView(1, 20, 20)")
    v4 = E(f"T.verifyText('{t3}')")
    shown = E(f"!!T.V.editors.get('{t3}').frameEl.querySelector('img')")
    check(f'D6 이미지 외곽선(투명 PNG 별): 별 안에만 글({v4["lines"]}줄, 모양 밖 0), 원본 이미지 표시', v4['pixelsOutsideMask'] == 0 and v4['intervalOverruns'] == 0 and v4['lines'] > 5 and shown, v4)
    E(f"T.V.select(['{t3}'])")
    kb_box = E("T.field('반전(모양 바깥에 글)')"); click(kb_box)
    v5 = E(f"T.verifyText('{t3}')")
    check('D7 반전 → 별 바깥에 글(모양 밖 0 = 뒤집힌 영역 기준)', E(f"T.el('{t3}').area.invert") is True and v5['pixelsOutsideMask'] == 0 and v5['lines'] > 5, v5)
    E(f"T.V.change('a', () => {{ T.V.node('{t3}').area.invert = false; }})")
    E("(async () => { const s = await T.starImg(400, 400, '#ffffff'); __nabi.app.pickImage = async () => s; })()")
    E(f"T.V.select(['{t3}'])"); E("T.btn('이미지 바꾸기…')"); time.sleep(0.3)
    E("T.setSel('판정', 'colorKey')")
    pg.wait_for_function(f"T.V.editors.get('{t3}').built.drawRect", timeout=5000)
    v6 = E(f"T.verifyText('{t3}')")
    check('D8 흰 배경 이미지 + 배경색 판정: 별 안에만 글(모양 밖 0)', E(f"T.el('{t3}').area.mode") == 'colorKey' and v6['pixelsOutsideMask'] == 0 and v6['lines'] > 5, v6)
    m = export_vs_screen('imgarea')
    check(f'D9 이미지 외곽선 글상자 출력 = 화면 ({m.get("pct16")}%)', same_as_screen(m), m)
    rs = E(f"""(() => {{ const V = T.V, n = V.node('{t3}'); const t0 = performance.now(); for (let i = 0; i < 10; i++) {{ n.w = 400 + i; V.render(); }} return (performance.now() - t0) / 10; }})()""")
    metrics['image-area-resize-ms'] = round(rs, 2)
    check(f'D10 이미지 외곽선 글상자 크기 바꿀 때 한 번 다시 그리기 {rs:.1f}ms(기준 16ms)', rs < 16, rs)

    # ============ E. 경로 글자 ============
    E("T.reset()")
    ce = E("T.add('shape', { shape: 'ellipse', x: 150, y: 100, w: 500, h: 360 })")
    E(f"T.V.select(['{ce}'])"); E("T.btn('경로 글자로')")
    ptx = E("T.V.selection[0]")
    g = E(f"T.el('{ptx}')")
    check('E1 원 → "경로 글자로" → 같은 자리의 경로 글자(원은 바뀜), SVG textPath', g['type'] == 'pathText' and E(f"T.V.node('{ce}')") is None and E(f"!!T.V.nodes.get('{ptx}').querySelector('textPath')") and close(g['w'], 500), g['type'])
    f = E("T.field('글')"); click(f); kb.press('Control+a'); kb.type('둥글게 도는 글자 Path text 나비글쓰기'); kb.press('Enter')
    f = E("T.field('시작 위치')"); click(f); kb.press('Control+a'); kb.type('25'); kb.press('Enter')
    E("(() => { const s = [...document.querySelectorAll('#props select')].find((x) => [...x.options].some((o) => o.value === 'middle')); s.value = 'middle'; s.dispatchEvent(new Event('change')); })()")
    g = E(f"T.el('{ptx}')")
    check('E2 속성 패널: 글·시작 위치 25%·가운데 정렬', g['text'] == '둥글게 도는 글자 Path text 나비글쓰기' and g['offset'] == 25 and g['anchor'] == 'middle', {k: g[k] for k in ('text', 'offset', 'anchor')})
    m = export_vs_screen('pathtext')
    check(f'E3 경로 글자 출력 = 화면 ({m.get("pct16")}%)', same_as_screen(m), m)
    A = np.asarray(img(E("T.raster()")).convert('L'))
    ys, xs = np.nonzero(A < 128)
    tl = E(f"T.V.nodes.get('{ptx}').querySelector('text').getAttribute('textLength')")
    check(f'E5 원에서 만든 경로 글자는 위쪽 가운데에 바로 선 글(글 픽셀 y {ys.min()}–{ys.max()} < 원 중심 280, 가운데 x {xs.mean():.0f} ≈ 400), 글꼴 설계 폭으로 textLength={tl}',
          ys.max() < 280 and abs(xs.mean() - 400) < 20 and tl is not None, [int(ys.min()), int(ys.max()), float(xs.mean()), tl])
    html = E("(async () => __EX.buildPrintHTML([T.V.exportPage()], { title: 't' }))()")
    vp = ctx.new_page(); vp.set_content(html, wait_until='load'); vp.evaluate("document.fonts.ready")
    pdfp = os.path.join(TMP, 'pt.pdf'); vp.pdf(path=pdfp, prefer_css_page_size=True, print_background=True); vp.close()
    txt = ''.join(subprocess.run(['pdftotext', pdfp, '-'], capture_output=True, text=True).stdout.split())
    check('E4 벡터 PDF에서 경로 글자도 글자로 추출됨', all(ch in txt for ch in '둥글게도는글자나비글쓰기'), txt[:80])

    # ============ F. 저장·열기 왕복, 되돌리기 ============
    E("T.reset(900, 700)")
    E("""(async () => {
      const ph = await T.photo(300, 200), circ = await T.circleImg(100, 100), tile = await T.tile(), star = await T.starImg(200, 200);
      const im = T.add('image', { src: ph.src, x: 20, y: 20, w: 300, h: 200, crop: { x: 0.1, y: 0.1, w: 0.8, h: 0.8 }, filters: { sepia: 60 }, mask: { kind: 'alpha', src: circ.src } });
      T.add('shape', { shape: 'star', x: 350, y: 20, w: 200, h: 200, fill: { type: 'pattern', src: tile.src, w: 20, h: 20, scale: 1.5 } });
      T.add('shape', { x: 600, y: 20, w: 250, h: 150, fill: { type: 'linear', angle: 45, stops: [{ o: 0, c: '#f4b942' }, { o: 1, c: '#2b3a66' }] } });
      T.add('path', { x: 20, y: 300, w: 200, h: 100, d: 'M0 100C50 0 150 0 200 100', pw: 200, ph: 100, stroke: '#e07a5f', strokeWidth: 6 });
      T.add('pathText', { x: 250, y: 300, w: 300, h: 150, d: __P.ellipseD(150, 75, 150, 75), pw: 300, ph: 150, text: '경로 글자 저장', offset: 10 });
      T.add('text', { x: 600, y: 250, w: 250, h: 250, style: { fontSize: 14 }, area: { kind: 'image', src: star.src, mode: 'alpha', show: true, opacity: 0.4 }, doc: T.longDoc('이미지 외곽선 글상자 저장 시험 '.repeat(8)) });
      await new Promise((r) => setTimeout(r, 400));
    })()""")
    snap0 = E("T.snap()")
    ras0 = E("T.raster()")
    zip64 = E("(async () => { const r = await __nabi.P.toZip(__nabi.app.project, { assets: __nabi.assets, docOf: T.V.docOf, swatches: __nabi.swatches.list }); let s = ''; for (let i = 0; i < r.bytes.length; i += 0x8000) s += String.fromCharCode(...r.bytes.subarray(i, i + 0x8000)); return btoa(s); })()")
    import zipfile
    z = zipfile.ZipFile(io.BytesIO(base64.b64decode(zip64)))
    pj = z.read('project.json').decode()
    n_assets = len([n for n in z.namelist() if n.startswith('assets/')])
    check(f'F1 저장: 알파 마스크·패턴·이미지 외곽선 글상자 이미지까지 에셋으로({n_assets}개), project.json에 blob: 없음', n_assets == 4 and 'blob:' not in pj, n_assets)
    pg2 = open_page()
    pg2.evaluate("(b) => __nabi.openBytes(Uint8Array.from(atob(b), (c) => c.charCodeAt(0)), null, '왕복.nabi')", zip64)
    pg2.wait_for_function("__nabi.app.project.pages[0].elements.length === 6", timeout=20000)
    time.sleep(0.8)
    snap1 = pg2.evaluate("T.snap()")
    ras1 = pg2.evaluate("T.raster()")
    j0, j1 = json.loads(snap0), json.loads(snap1)
    cm = compare(img(ras0), img(ras1))
    check(f'F2 다른 창에서 열기 → 모든 새 속성(자르기·필터·마스크·채움·패스·경로 글자·글상자 모양) JSON 일치, 출력 위치 일치 (16 초과 {cm.get("pct16")}%)', j0['pages'] == j1['pages'] and cm.get('nb_pct64', 1) == 0, cm)
    pg2.close()
    n = 0
    fin = E("T.snap()")
    while E("__nabi.history.canUndo"): E("__nabi.history.undo()"); n += 1
    empty = E("T.V.page.elements.length")
    while E("__nabi.history.canRedo"): E("__nabi.history.redo()")
    check(f'F3 되돌리기 {n}단위 → 빈 장, 다시 실행 → 같은 결과', empty == 0 and E("T.snap()") == fin, n)

    check('Z 검증 전체 동안 페이지 오류 없음', not errors, errors)
    b.close()

srv.shutdown()
json.dump(metrics, open(os.path.join(OUT, 'stage9-metrics.json'), 'w'), ensure_ascii=False, indent=1)
fails = [r for r in results if not r[1]]
for name, ok, detail in results:
    print(('PASS ' if ok else 'FAIL ') + name + ('' if ok else '  ' + json.dumps(detail, ensure_ascii=False, default=str)[:900]))
print('metrics:', json.dumps(metrics, ensure_ascii=False))
print(f'{len(results) - len(fails)}/{len(results)} passed')
