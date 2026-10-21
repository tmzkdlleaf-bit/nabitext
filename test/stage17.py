"""17단계(0.18) 검증: 잠금·잠금 해제(캔버스에서 고르기·자물쇠 단추·오른쪽 클릭/길게 누르기 메뉴), 글 피해 가기(사진·도형 둘레로 글이 흐름).
사용: python3 test/stage17.py. V=1이면 항목마다 결과를 바로 찍는다. 입력은 CDP로 실제 마우스·손가락 이벤트.
"""
import json, os, io, time, base64, zipfile, threading, functools
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from playwright.sync_api import sync_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'test', 'out'); os.makedirs(OUT, exist_ok=True)

class Quiet(SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
srv = ThreadingHTTPServer(('127.0.0.1', 0), functools.partial(Quiet, directory=ROOT))
threading.Thread(target=srv.serve_forever, daemon=True).start()
ORIGIN = f'http://127.0.0.1:{srv.server_port}'

results = []
def check(name, ok, detail=''):
    results.append((name, bool(ok), detail))
    if os.environ.get('V'): print(('ok ' if ok else 'XX ') + name[:70] + ('' if ok else '  ' + json.dumps(detail, ensure_ascii=False, default=str)[:900]), flush=True)

HELPERS = r"""
(() => {
  const N = __nabi, V = N.view, M = N.M;
  window.T = {
    reset: () => { N.app.project.pages = [M.newPage({ w: 1000, h: 1000 })]; N.app.current = null; N.app.switchPage(N.app.project.pages[0]); N.history.clear(); N.flush(); V.setView(0.8, 20, 20); },
    add: (type, box, extra = {}) => { const n = M.makeElement(type, extra); Object.assign(n, box); V.change('create', () => { V.page.elements.push(n); }); N.flush(); return n.id; },
    longText: (box) => T.add('text', box, { style: { fontSize: 24 }, doc: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: '글이 피해 흐르는지 보는 글입니다. '.repeat(60) }] }] } }),
    circlePng: async () => { const c = new OffscreenCanvas(300, 300); const x = c.getContext('2d'); x.fillStyle = '#e44'; x.beginPath(); x.arc(150, 150, 140, 0, 7); x.fill(); return (await N.assets.add(await c.convertToBlob({ type: 'image/png' }))).url; },
    pieces: (id) => { const t = V.node(id), ed = V.editorOf(t); return ed.results.flatMap((r, k) => r.lines.flatMap((l) => l.pieces.filter((p) => p.text.trim()).map((p) => { const n = V.node(ed.members[k]); return { x: n.x + p.x, y: n.y + p.top, w: p.w, h: p.h }; }))); },
    overlap: (id, b) => T.pieces(id).filter((p) => p.x < b.x + b.w && p.x + p.w > b.x && p.y < b.y + b.h && p.y + p.h > b.y).length,
    view: (p) => { const r = V.rect(), q = V.pageToView(p); return { x: q.x + r.left, y: q.y + r.top }; },
    menu: () => [...document.querySelectorAll('.cm button')].map((b) => [b.textContent.replace(/\s+/g, ' ').trim(), b.disabled]),
    menuClick: (label) => { const b = [...document.querySelectorAll('.cm button')].find((x) => x.textContent.includes(label)); b.click(); },
  };
  return true;
})()
"""

with sync_playwright() as p:
    b = p.chromium.launch(args=['--disable-lcd-text'])
    ctx = b.new_context(viewport={'width': 1600, 'height': 1000})
    errors = []
    pg = ctx.new_page()
    pg.route('**/fonts.googleapis.com/**', lambda r: r.abort())
    pg.on('pageerror', lambda e: errors.append(str(e)))
    pg.goto(ORIGIN + '/index.html')
    pg.wait_for_function('window.__nabi && window.__nabi.ready', timeout=30000)
    time.sleep(0.3)
    if pg.evaluate("!!document.querySelector('.modal-bg')"): pg.click('.modal-bg [data-v=discard]')
    pg.evaluate(HELPERS)
    E = lambda js, arg=None: pg.evaluate(js, arg) if arg is not None else pg.evaluate(js)
    mouse = pg.mouse
    def click(pt, **kw): mouse.click(pt['x'], pt['y'], **kw)

    # ============ K. 잠금 ============
    E("T.reset()")
    bg = E("T.add('shape', { x: 0, y: 0, w: 1000, h: 1000 }, { fill: '#eeeeee' })")
    sq = E("T.add('shape', { x: 300, y: 300, w: 200, h: 200 }, { fill: '#4466aa' })")
    E(f"__nabi.view.select(['{bg}']); __nabi.view.run('lock')")
    check('K1 잠가도 선택은 그대로 + 캔버스에 자물쇠 단추', E("__nabi.view.selection.join()") == bg and E("!!document.querySelector('.lock-badge')"), [E("__nabi.view.selection"), E("!!document.querySelector('.lock-badge')")])
    E("__nabi.view.select([])")
    click(E("T.view({ x: 100, y: 100 })")); time.sleep(0.1)
    check('K2 잠긴 요소를 캔버스에서 누르면 골라짐(움직이지는 않음)', E("__nabi.view.selection.join()") == bg, E("__nabi.view.selection"))
    pt = E("T.view({ x: 100, y: 100 })"); mouse.move(pt['x'], pt['y']); mouse.down(); mouse.move(pt['x'] + 80, pt['y'] + 80, steps=5); mouse.up(); time.sleep(0.1)
    check('K3 잠긴 요소 위에서 끌면 움직이지 않음', E(f"[__nabi.view.node('{bg}').x, __nabi.view.node('{bg}').y]") == [0, 0], E(f"__nabi.view.node('{bg}')"))
    # 범위 선택: 잠긴 배경 위에서 끌어 그 위의 사각형 고르기
    a, z = E("T.view({ x: 250, y: 250 })"), E("T.view({ x: 550, y: 550 })")
    mouse.move(a['x'], a['y']); mouse.down(); mouse.move(z['x'], z['y'], steps=8); mouse.up(); time.sleep(0.1)
    check('K4 잠긴 배경 위에서 끌기 = 범위 선택(위에 놓인 요소가 골라짐)', E("__nabi.view.selection.join()") == sq, E("__nabi.view.selection"))
    click(E(f"T.view({{ x: 400, y: 400 }})")); time.sleep(0.1)
    check('K5 잠기지 않은 요소가 위에 있으면 그것이 먼저 골라짐', E("__nabi.view.selection.join()") == sq, E("__nabi.view.selection"))
    # 자물쇠 단추로 풀기
    click(E("T.view({ x: 100, y: 100 })")); time.sleep(0.1)
    badge = E("(() => { const b = __nabi.view.lockBadge(); const r = __nabi.view.rect(); return { x: b.x + r.left, y: b.y + r.top }; })()")
    click(badge); time.sleep(0.15)
    check('K6 캔버스의 자물쇠 단추를 누르면 잠금 해제(선택 유지)', not E(f"!!__nabi.view.node('{bg}').locked") and E("__nabi.view.selection.join()") == bg and not E("!!document.querySelector('.lock-badge')"), E(f"__nabi.view.node('{bg}').locked"))
    E("__nabi.history.undo()"); time.sleep(0.05)
    check('K7 잠금 해제도 되돌리기 가능', E(f"!!__nabi.view.node('{bg}').locked"), E(f"__nabi.view.node('{bg}').locked"))
    # 오른쪽 클릭 메뉴
    E("__nabi.view.select([])")
    click(E("T.view({ x: 400, y: 400 })"), button='right'); time.sleep(0.2)
    m1 = E("T.menu()")
    check('K8 오른쪽 클릭 → 그 요소가 골라지고 메뉴(잠그기·복제·순서·숨기기·삭제)', E("__nabi.view.selection.join()") == sq and m1[0][0].startswith('잠그기') and any('삭제' in x[0] for x in m1), m1)
    E("T.menuClick('잠그기')"); time.sleep(0.1)
    check('K9 메뉴 "잠그기" → 잠김', E(f"!!__nabi.view.node('{sq}').locked") and not E("!!document.querySelector('.cm')"), E(f"__nabi.view.node('{sq}').locked"))
    click(E("T.view({ x: 400, y: 400 })"), button='right'); time.sleep(0.2)
    m2 = E("T.menu()")
    check('K10 잠긴 요소 메뉴: "잠금 해제", 복제·삭제는 흐리게', m2[0][0].startswith('잠금 해제') and [x for x in m2 if x[0].startswith('삭제')][0][1] and [x for x in m2 if x[0].startswith('복제')][0][1], m2)
    E("T.menuClick('잠금 해제')"); time.sleep(0.1)
    check('K11 메뉴 "잠금 해제" → 풀림', not E(f"!!__nabi.view.node('{sq}').locked"), E(f"__nabi.view.node('{sq}').locked"))
    # 빈 곳(장 밖) 오른쪽 클릭 → 이 장의 잠금 모두 풀기
    E(f"__nabi.view.select(['{sq}']); __nabi.view.run('lock')")
    click(E("T.view({ x: 1100, y: 500 })"), button='right'); time.sleep(0.2)
    m3 = E("T.menu()")
    E("T.menuClick('잠금 모두 풀기')"); time.sleep(0.1)
    check('K12 빈 곳 오른쪽 클릭 → "이 장의 잠금 모두 풀기 (2개)"', '2개' in m3[0][0] and not E(f"!!__nabi.view.node('{sq}').locked || !!__nabi.view.node('{bg}').locked"), m3)
    # Esc로 메뉴 닫기
    click(E("T.view({ x: 400, y: 400 })"), button='right'); time.sleep(0.15); pg.keyboard.press('Escape'); time.sleep(0.1)
    check('K13 메뉴는 Esc로 닫힘(선택은 그대로)', not E("!!document.querySelector('.cm')") and E("__nabi.view.selection.join()") == sq, E("__nabi.view.selection"))
    # 손가락 길게 누르기 → 메뉴
    cdp = ctx.new_cdp_session(pg)
    pt = E("T.view({ x: 700, y: 700 })")
    cdp.send('Input.dispatchTouchEvent', {'type': 'touchStart', 'touchPoints': [{'x': pt['x'], 'y': pt['y']}]}); time.sleep(0.8)
    lp = E("T.menu()")
    cdp.send('Input.dispatchTouchEvent', {'type': 'touchEnd', 'touchPoints': []}); time.sleep(0.2)
    check('K14 손가락으로 길게 누르기 → 메뉴(그 자리 요소 = 잠기지 않은 배경 사각형이 골라짐), 손을 떼도 메뉴 유지', len(lp) > 3 and E("__nabi.view.selection.join()") == bg and E("!!document.querySelector('.cm')"), [lp, E("__nabi.view.selection")])
    pg.keyboard.press('Escape')
    pt2 = E("T.view({ x: 700, y: 700 })")
    cdp.send('Input.dispatchTouchEvent', {'type': 'touchStart', 'touchPoints': [{'x': pt2['x'], 'y': pt2['y']}]}); time.sleep(0.15)
    cdp.send('Input.dispatchTouchEvent', {'type': 'touchEnd', 'touchPoints': []}); time.sleep(0.8)
    check('K15 짧게 톡 → 메뉴 없음', not E("!!document.querySelector('.cm')"), E("T.menu()"))
    mouse.move(10, 10)

    # ============ W. 글 피해 가기 ============
    E("T.reset()")
    tid = E("T.longText({ x: 60, y: 60, w: 880, h: 880 })")
    url = E("T.circlePng()")
    im = E(f"T.add('image', {{ x: 350, y: 300, w: 300, h: 300 }}, {{ src: '{url}', fit: 'fill' }})")
    time.sleep(0.3)
    before = E(f"T.overlap('{tid}', {{ x: 350, y: 300, w: 300, h: 300 }})")
    # 속성 패널로 켜기
    E(f"__nabi.view.select(['{im}'])"); E("__nabi.flush()")
    cb = E("(() => { const l = [...document.querySelectorAll('#props .pp-sec[data-sec=\"글 피해 가기\"] label')].find((x) => x.textContent.includes('피해 흐르게')); l.scrollIntoView({ block: 'center' }); const r = l.querySelector('input').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()")
    click(cb); time.sleep(0.4)
    box_ov = E(f"T.overlap('{tid}', {{ x: 340, y: 290, w: 320, h: 320 }})")
    check('W1 사진 고르고 "글이 이 요소를 피해 흐르게" → 사진 상자(+간격 16) 안에 글 없음(켜기 전에는 겹침)', before > 10 and box_ov == 0 and E(f"__nabi.view.node('{im}').wrap.shape") == 'box', [before, box_ov, E(f"__nabi.view.node('{im}').wrap")])
    # 옮기면 따라 다시 흐름(실제 마우스 끌기)
    a, z = E("T.view({ x: 500, y: 450 })"), E("T.view({ x: 500, y: 650 })")
    mouse.move(a['x'], a['y']); mouse.down(); mouse.move(z['x'], z['y'], steps=10); mouse.up(); time.sleep(0.3)
    nb = E(f"(() => {{ const n = __nabi.view.node('{im}'); return {{ x: n.x, y: n.y, w: n.w, h: n.h }}; }})()")
    check('W2 사진을 끌어 옮기면 글이 새 자리를 피해 다시 흐름(옛 자리에는 다시 글이 들어옴)', nb['y'] == 500 and E(f"T.overlap('{tid}', {{ x: 350, y: 500, w: 300, h: 300 }})") == 0 and E(f"T.overlap('{tid}', {{ x: 350, y: 300, w: 300, h: 180 }})") > 5, nb)
    # 원 / 윤곽선 / 위아래로만 / 간격
    E(f"__nabi.view.change('props', () => {{ const n = __nabi.view.node('{im}'); n.y = 300; n.wrap = {{ shape: 'ellipse', gap: 0, side: 'both' }}; }})"); time.sleep(0.2)
    corner_e = E(f"T.overlap('{tid}', {{ x: 352, y: 302, w: 40, h: 40 }})")
    center_e = E(f"T.overlap('{tid}', {{ x: 460, y: 410, w: 80, h: 80 }})")
    check('W3 모양 "원" → 원 안은 비고, 상자 모서리(원 바깥)에는 글이 들어옴', center_e == 0 and corner_e > 0, [center_e, corner_e])
    E(f"__nabi.view.change('props', () => {{ __nabi.view.node('{im}').wrap = {{ shape: 'outline', gap: 0, side: 'both' }}; }})"); time.sleep(0.4)
    check('W4 모양 "그림 윤곽선"(투명 배경 PNG) → 그려진 원 안은 비고, 투명한 모서리에는 글', E(f"T.overlap('{tid}', {{ x: 460, y: 410, w: 80, h: 80 }})") == 0 and E(f"T.overlap('{tid}', {{ x: 352, y: 302, w: 40, h: 40 }})") > 0)
    E(f"__nabi.view.change('props', () => {{ __nabi.view.node('{im}').wrap = {{ shape: 'box', gap: 40, side: 'both' }}; }})"); time.sleep(0.2)
    g40 = E(f"T.overlap('{tid}', {{ x: 315, y: 265, w: 370, h: 370 }})")
    check('W5 간격 40 → 사진 둘레 40px 안에도 글 없음', g40 == 0, g40)
    E(f"__nabi.view.change('props', () => {{ __nabi.view.node('{im}').wrap = {{ shape: 'box', gap: 0, side: 'jump' }}; }})"); time.sleep(0.2)
    side = E(f"T.overlap('{tid}', {{ x: 60, y: 310, w: 280, h: 280 }}) + T.overlap('{tid}', {{ x: 660, y: 310, w: 280, h: 280 }})")
    check('W6 "위아래로만" → 사진 높이의 양옆에도 글 없음', side == 0, side)
    # 돌린 사진
    E(f"__nabi.view.change('props', () => {{ const n = __nabi.view.node('{im}'); n.rotation = 45; n.wrap = {{ shape: 'box', gap: 0, side: 'both' }}; }})"); time.sleep(0.2)
    rot = E(f"T.overlap('{tid}', {{ x: 470, y: 420, w: 60, h: 60 }})")
    corner = E(f"T.overlap('{tid}', {{ x: 352, y: 302, w: 30, h: 30 }})")
    check('W7 45° 돌린 사진 → 돌린 모양대로 피함(가운데는 비고, 돌려서 빈 원래 모서리에는 글)', rot == 0 and corner > 0, [rot, corner])
    pg.screenshot(path=os.path.join(OUT, 'stage17-wrap.png'))
    # 끄기 + 되돌리기
    E(f"__nabi.view.change('props', () => {{ const n = __nabi.view.node('{im}'); n.rotation = 0; n.wrap = undefined; }})"); time.sleep(0.2)
    off = E(f"T.overlap('{tid}', {{ x: 350, y: 300, w: 300, h: 300 }})")
    E("__nabi.history.undo()"); time.sleep(0.2)
    check('W8 끄면 다시 사진 위로 글, 되돌리면 다시 피함', off > 10 and E(f"T.overlap('{tid}', {{ x: 470, y: 420, w: 60, h: 60 }})") == 0, off)
    # 도형도 피하게(오른쪽 클릭 메뉴로)
    sh = E("T.add('shape', { x: 100, y: 700, w: 200, h: 150 }, { fill: '#4a8' })")
    click(E("T.view({ x: 200, y: 775 })"), button='right'); time.sleep(0.2)
    E("T.menuClick('피해 흐르게')"); time.sleep(0.3)
    check('W9 도형: 오른쪽 클릭 메뉴 "글이 이 요소를 피해 흐르게" → 도형 자리 비움', E(f"!!__nabi.view.node('{sh}').wrap") and E(f"T.overlap('{tid}', {{ x: 100, y: 700, w: 200, h: 150 }})") == 0, E(f"__nabi.view.node('{sh}').wrap"))
    # 출력·저장
    import PIL.Image as Image
    u = E("""async () => { const EX = await import('/src/export.js'); return (await EX.rasterize(__nabi.view.exportPage(), { scale: 0.5 })).toDataURL(); }""")
    Image.open(io.BytesIO(base64.b64decode(u.split(',', 1)[1]))).save(os.path.join(OUT, 'stage17-export.png'))
    saved = E("""(async () => { const { bytes } = await __nabi.P.toZip(__nabi.app.project, { assets: __nabi.assets, docOf: __nabi.view.docOf, swatches: [] }); let s = ''; for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000)); return btoa(s); })()""")
    pj = json.loads(zipfile.ZipFile(io.BytesIO(base64.b64decode(saved))).read('project.json'))
    E("(b) => __nabi.openBytes(Uint8Array.from(atob(b), (c) => c.charCodeAt(0)), null, '감싸기.nabi')", saved); time.sleep(1.2)
    tid2 = E("__nabi.view.page.elements.find((n) => n.type === 'text').id")
    check('W10 저장 → 다시 열기: 피해 가기 설정 유지, 글도 그대로 피함', sum(1 for n in pj['pages'][0]['elements'] if n.get('wrap')) == 2 and E(f"T.overlap('{tid2}', {{ x: 470, y: 420, w: 60, h: 60 }})") == 0, [n.get('wrap') for n in pj['pages'][0]['elements']])

    # ============ P. 문단 간격(0.18.1): 문단마다 따로 정한 간격(템플릿 글)도 칸에서 바꿈 ============
    E("T.reset()")
    pid = E("""T.add('text', { x: 100, y: 100, w: 600, h: 400 }, { style: { fontSize: 32, lineHeight: 1.6 }, doc: { type: 'doc', content: [
      { type: 'paragraph', attrs: { spacing: 30 }, content: [{ type: 'text', text: '첫 문단' }] }, { type: 'paragraph', attrs: { spacing: 30 }, content: [{ type: 'text', text: '둘째 문단' }] }] } })""")
    ys = lambda: E(f"__nabi.view.editorOf(__nabi.view.node('{pid}')).results[0].lines.map((l) => Math.round(l.y))")
    E(f"__nabi.view.select(['{pid}'])"); E("__nabi.flush()")
    fld = E("(() => { const f = document.querySelector('#props [data-field=\"문단 간격\"]'); f.scrollIntoView({ block: 'center' }); const r = f.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2, v: f.value }; })()")
    y30 = ys()
    check('P1 문단마다 간격 30이 들어 있는 글(템플릿 글 등) → 칸에 30으로 보임, 문단 사이 51+30', fld['v'] == '30' and y30[1] - y30[0] == 81, [fld['v'], y30])
    click(fld); pg.keyboard.press('Control+a'); pg.keyboard.type('0'); pg.keyboard.press('Enter'); time.sleep(0.2)
    y0 = ys()
    check('P2 칸에 0 → 문단마다 정한 간격도 지워져 Enter 간격 = 줄 간격(51px)', y0[1] - y0[0] == 51, y0)
    E("__nabi.history.undo()"); time.sleep(0.1)
    check('P3 되돌리기 한 번에 원래 간격(30)으로', ys()[1] - ys()[0] == 81, ys())

    print('page errors:', errors[:5])
    b.close()

ok = sum(1 for r in results if r[1])
for name, good, detail in results:
    print(('PASS ' if good else 'FAIL ') + name + ('' if good else '\n     ' + json.dumps(detail, ensure_ascii=False, default=str)[:1500]))
print(f'{ok}/{len(results)} passed')
