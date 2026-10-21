"""16단계(0.17) 검증: 내 글꼴(넣은 글꼴이 앱을 다시 켜도·새 프로젝트에서도 남음), 기호 넣기, 글상자 바탕(색·불투명도·모서리·테두리).
사용: python3 test/stage16.py. V=1이면 항목마다 결과를 바로 찍는다. 입력은 CDP로 실제 마우스·키 이벤트(Playwright mouse/keyboard).
시험 글꼴: DejaVu Serif(리눅스 시스템 글꼴).
"""
import json, os, io, time, base64, zipfile, threading, functools
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from playwright.sync_api import sync_playwright
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'test', 'out'); os.makedirs(OUT, exist_ok=True)
FONT_R = '/usr/share/fonts/truetype/dejavu/DejaVuSerif.ttf'

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
    reset: () => { N.app.project.pages = [M.newPage({ w: 900, h: 700, background: '#ffffff' })]; N.app.current = null; N.app.switchPage(N.app.project.pages[0]); N.history.clear(); N.flush(); V.setView(1, 30, 30); },
    addText: (t, x = 100, y = 100, w = 600, h = 200, extra = {}) => { const n = M.makeElement('text', { doc: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: t }] }] }, ...extra }); Object.assign(n, { x, y, w, h }); V.change('create', () => { V.page.elements.push(n); }); V.select([n.id]); N.flush(); return n.id; },
    text: (id) => V.editorOf(V.node(id)).state.doc.textContent,
    ctr: (sel) => { N.flush(); const e = document.querySelector(sel); if (!e) return null; e.scrollIntoView({ block: 'center' }); const r = e.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; },
    libNames: () => N.app.fontLibrary.map((f) => [f.family, f.weight]),
    projFonts: () => N.app.project.fonts.map((f) => [f.family, f.weight]),
    loaded: (fam) => [...document.fonts].filter((f) => f.family.replace(/"/g, '') === fam && f.status === 'loaded').length,
    b64: (u8) => { let s = ''; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode(...u8.subarray(i, i + 0x8000)); return btoa(s); },
    popItems: async () => { const f = document.querySelector('#props [data-field="글꼴"]'); f.scrollIntoView({ block: 'center' }); f.parentElement.querySelector('.fp-open').click(); await new Promise((r) => setTimeout(r, 150));
      const out = [...document.querySelectorAll('.fp-pop .fp-it .fp-name')].map((e) => e.textContent); const heads = [...document.querySelectorAll('.fp-pop .fp-h')].map((e) => e.textContent); f.parentElement.querySelector('.fp-open').click(); return { out, heads }; },
  };
  return true;
})()
"""

with sync_playwright() as p:
    b = p.chromium.launch(args=['--disable-lcd-text'])
    ctx = b.new_context(viewport={'width': 1600, 'height': 1000})
    errors = []
    def open_page():
        pg = ctx.new_page()
        pg.route('**/fonts.googleapis.com/**', lambda r: r.abort())
        pg.on('pageerror', lambda e: errors.append(str(e)))
        pg.goto(ORIGIN + '/index.html')
        pg.wait_for_function('window.__nabi && window.__nabi.ready', timeout=30000)
        time.sleep(0.3)
        if pg.evaluate("!!document.querySelector('.modal-bg')"): pg.click('.modal-bg [data-v=discard]')
        pg.evaluate(HELPERS)
        return pg
    pg = open_page()
    E = lambda js, arg=None: pg.evaluate(js, arg) if arg is not None else pg.evaluate(js)
    def click(pt): pg.mouse.click(pt['x'], pt['y'])
    def wait(js, t=10):
        try: pg.wait_for_function(js, timeout=t * 1000); return True
        except Exception: return False

    # ============ L. 내 글꼴 ============
    E("T.reset()")
    pg.set_input_files('#fontFile', [FONT_R])
    wait("__nabi.app.fontLibrary.length === 1")
    time.sleep(0.4)
    check('L1 글꼴 파일 넣기 → 내 글꼴(이 컴퓨터)과 프로젝트 둘 다에 들어감, 상태 줄 안내', E("T.libNames()") == [['DejaVu Serif', '400']] and E("T.projFonts()") == [['DejaVu Serif', '400']] and '이 컴퓨터에 보관' in E("document.getElementById('status').textContent"),
          [E("T.libNames()"), E("T.projFonts()"), E("document.getElementById('status').textContent")])
    # 앱을 다시 켬(새 탭 = 새로 시작)
    pg.close(); pg = open_page(); E = lambda js, arg=None: pg.evaluate(js, arg) if arg is not None else pg.evaluate(js)
    E("T.reset()"); E("T.addText('가나다 Hello')")
    pop = E("T.popItems()")
    check('L2 앱을 다시 켜도(새 프로젝트) 넣은 글꼴이 목록 맨 위에 있고 화면에 불러와져 있음', E("T.libNames()") == [['DejaVu Serif', '400']] and pop['out'][0] == 'DejaVu Serif' and pop['heads'][0].startswith('넣은 글꼴') and E("T.loaded('DejaVu Serif')") >= 1 and E("T.projFonts()") == [],
          [E("T.libNames()"), pop, E("T.loaded('DejaVu Serif')")])
    E("__nabi.newProject(); 0"); time.sleep(0.5)
    if E("!!document.querySelector('.modal-bg')"): E("document.querySelector('.modal-bg [data-v=discard]').click()"); time.sleep(0.4)
    check('L3 새로 만들기 뒤에도 그대로 등록됨', E("T.loaded('DejaVu Serif')") >= 1 and E("T.libNames()") == [['DejaVu Serif', '400']], E("T.loaded('DejaVu Serif')"))
    # 새 프로젝트에서 내 글꼴을 쓰고 저장 → 파일 안에 글꼴이 들어감 / 안 쓰면 안 들어감
    E("T.reset()"); tid = E("T.addText('Hello World')")
    saved0 = E("""(async () => { const { json } = await __nabi.P.toJSON(__nabi.app.project, { assets: __nabi.assets, docOf: __nabi.view.docOf, swatches: [], extraFonts: __nabi.app.fontLibrary }); return json.fonts.map((f) => f.family); })()""")
    E("__nabi.props.setMark('font', { value: '\"DejaVu Serif\", \"Noto Sans KR\", sans-serif' })"); time.sleep(0.2)
    saved = E("""(async () => { const { bytes } = await __nabi.P.toZip(__nabi.app.project, { assets: __nabi.assets, docOf: __nabi.view.docOf, swatches: [], extraFonts: __nabi.app.fontLibrary }); return T.b64(bytes); })()""")
    z = zipfile.ZipFile(io.BytesIO(base64.b64decode(saved)))
    pj = json.loads(z.read('project.json'))
    check('L4 저장: 쓴 내 글꼴만 파일에 같이 들어감(안 쓰면 빠짐) → 다른 컴퓨터에서도 같은 글꼴', saved0 == [] and [f['family'] for f in pj['fonts']] == ['DejaVu Serif'] and pj['fonts'][0]['file'] in z.namelist(), [saved0, pj['fonts'], z.namelist()])
    # 실제 저장 경로(app.save가 쓰는 ctx)도 extraFonts를 넘기는지: 자동 저장 기록에 글꼴이 있음
    E("__nabi.autosave()"); time.sleep(0.5)
    rec = E("""(async () => { const d = await new Promise((r) => { const q = indexedDB.open('nabitext', 1); q.onsuccess = () => r(q.result); });
      const all = await new Promise((r) => { const q = d.transaction('recovery').objectStore('recovery').getAll(); q.onsuccess = () => r(q.result); }); return all.map((x) => (x.json.fonts || []).map((f) => f.family)); })()""")
    check('L5 자동 저장(복구본)에도 쓴 내 글꼴이 들어감', any('DejaVu Serif' in r for r in rec), rec)
    # 빼기: 확인 후 내 글꼴에서도 지워지고, 다시 켜도 없음
    E("__nabi.props.fontActions.remove('DejaVu Serif'); 0"); time.sleep(0.3)
    E("document.querySelector('.modal-bg [data-v=remove]').click()"); time.sleep(0.5)
    pg.close(); pg = open_page(); E = lambda js, arg=None: pg.evaluate(js, arg) if arg is not None else pg.evaluate(js)
    check('L6 목록 ×로 빼면 내 글꼴에서도 지워짐(다시 켜도 없음)', E("T.libNames()") == [] and E("T.loaded('DejaVu Serif')") == 0, [E("T.libNames()"), E("T.loaded('DejaVu Serif')")])

    # ============ Y. 기호 넣기 ============
    E("T.reset()"); tid = E("T.addText('그래서')")
    click(E("T.ctr('#props button[data-field=\"기호 넣기\"]')")); time.sleep(0.3)
    opened = E("!!document.querySelector('.sym-pop')")
    tabs = E("[...document.querySelectorAll('.sym-tabs button')].map((b) => b.textContent)")
    click(E("T.ctr('.sym-grid button[data-i=\"0\"]')")); time.sleep(0.15)   # …
    click(E("T.ctr('.sym-grid button[data-i=\"4\"]')")); time.sleep(0.15)   # —
    editing = E("!!__nabi.view.editing && document.activeElement.classList.contains('ce-input')")
    pg.keyboard.type('ab'); time.sleep(0.2)
    check('Y1 글상자를 고르고 "기호 넣기" → 목록(말줄임·가로선 등 칸), 누르면 글 끝에 이어서 들어가고 편집 상태·포커스 유지',
          opened and '말줄임·가로선' in tabs and '구분선' in tabs and E(f"T.text('{tid}')") == '그래서…—ab' and editing, [tabs, E(f"T.text('{tid}')"), editing])
    pg.keyboard.press('Escape'); time.sleep(0.2)
    check('Y2 Esc → 목록만 닫힘(글상자 편집은 계속)', not E("!!document.querySelector('.sym-pop')") and E("!!__nabi.view.editing"), E("!!__nabi.view.editing"))
    # 한글 조합 중에 기호를 누르면 조합 글자를 먼저 확정하고 뒤에 넣는다
    cdp = ctx.new_cdp_session(pg)
    cdp.send('Input.imeSetComposition', {'text': '가', 'selectionStart': 1, 'selectionEnd': 1}); time.sleep(0.15)
    click(E("T.ctr('#props button[data-field=\"기호 넣기\"]')")); time.sleep(0.3)
    E("document.querySelector('.sym-tabs [data-tab=\"0\"]').click()"); time.sleep(0.1)
    recent = E("[...document.querySelectorAll('.sym-grid button')].map((b) => b.textContent)")
    click(E("T.ctr('.sym-grid button[data-i=\"0\"]')")); time.sleep(0.2)
    check('Y3 최근 칸에 방금 쓴 기호(최근 것 먼저) · 한글 조합 중에 눌러도 조합 글자 확정 뒤에 들어감', recent[:2] == ['—', '…'] and E(f"T.text('{tid}')") == '그래서…—ab가—', [recent, E(f"T.text('{tid}')")])
    E("__nabi.history.undo()"); time.sleep(0.1)
    check('Y4 기호 넣기는 되돌리기 가능', E(f"T.text('{tid}')") == '그래서…—ab가', E(f"T.text('{tid}')"))
    pg.keyboard.press('Escape'); pg.keyboard.press('Escape')

    # ============ B. 글상자 바탕 ============
    E("T.reset()"); E("__nabi.view.setPageProps({ background: '#000000' })")
    tid = E("T.addText('바탕', 100, 100, 300, 200)")
    E("__nabi.view.exitEdit && __nabi.view.exitEdit()"); E(f"__nabi.view.select(['{tid}'])"); E("__nabi.flush()")
    secs = E("[...document.querySelectorAll('#props .pp-sec')].map((e) => e.dataset.sec)")
    # 속성 패널로 색 넣기(HEX 칸에 치고 Enter)
    click(E("T.ctr('#props [data-field=\"바탕색\"]')")); pg.keyboard.press('Control+a'); pg.keyboard.type('#ff0000'); pg.keyboard.press('Enter'); time.sleep(0.3)
    bg1 = E(f"__nabi.view.node('{tid}').bg")
    click(E("""(() => { const all = [...document.querySelectorAll('#props .pp-sec[data-sec="글상자 바탕"] input')]; const e = all.find((i) => i.dataset.field === '불투명도'); e.scrollIntoView({ block: 'center' }); const r = e.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()"""))
    pg.keyboard.press('Control+a'); pg.keyboard.type('50'); pg.keyboard.press('Enter'); time.sleep(0.3)
    bg2 = E(f"__nabi.view.node('{tid}').bg")
    u = E("""async () => { const EX = await import('/src/export.js'); return (await EX.rasterize(__nabi.view.exportPage(), { scale: 1 })).toDataURL(); }""")
    im = Image.open(io.BytesIO(base64.b64decode(u.split(',', 1)[1]))).convert('RGB')
    px_in, px_out = im.getpixel((380, 280)), im.getpixel((450, 280))
    check('B1 속성 "글상자 바탕": 바탕색 → 칠해짐, 불투명도 50% → 검은 장 위에서 절반 빨강(출력에서도)',
          '글상자 바탕' in secs and bg1 and bg1['color'] == '#ff0000' and bg2['opacity'] == 0.5 and abs(px_in[0] - 128) <= 3 and px_in[1] < 5 and px_out == (0, 0, 0), [secs, bg1, bg2, px_in, px_out])
    E("__nabi.history.undo()"); time.sleep(0.1)
    check('B2 되돌리기 → 불투명도 100%로', E(f"__nabi.view.node('{tid}').bg.opacity") == 1, E(f"__nabi.view.node('{tid}').bg"))
    # 원 모양 글상자: 바탕도 원(모서리는 안 칠함)
    E(f"__nabi.view.change('props', () => {{ const n = __nabi.view.node('{tid}'); n.area = {{ kind: 'ellipse' }}; n.bg = {{ color: '#00ff00', opacity: 1, radius: 0 }}; }})"); time.sleep(0.2)
    u = E("""async () => { const EX = await import('/src/export.js'); return (await EX.rasterize(__nabi.view.exportPage(), { scale: 1 })).toDataURL(); }""")
    im = Image.open(io.BytesIO(base64.b64decode(u.split(',', 1)[1]))).convert('RGB')
    check('B3 원 모양 글상자 → 바탕도 원 모양(가운데는 칠하고 모서리는 비움)', im.getpixel((250, 200)) == (0, 255, 0) and im.getpixel((104, 104)) == (0, 0, 0), [im.getpixel((250, 200)), im.getpixel((104, 104))])
    # 화면 DOM: 바탕 SVG가 글 뒤(첫 자식), 편집해도 유지
    E(f"__nabi.view.enterEdit('{tid}')"); pg.keyboard.type('x'); time.sleep(0.2)
    kids = E(f"[...__nabi.view.nodes.get('{tid}').children].map((c) => c.getAttribute('class') || c.className)")
    check('B4 화면: 바탕은 글 뒤(첫 자식), 글을 고쳐도 그대로', kids[0] == 'text-bg' and len(kids) == 2, kids)
    pg.keyboard.press('Escape')
    # 저장 → 다시 열기
    saved = E("""(async () => { const { bytes } = await __nabi.P.toZip(__nabi.app.project, { assets: __nabi.assets, docOf: __nabi.view.docOf, swatches: [] }); return T.b64(bytes); })()""")
    E("(b) => __nabi.openBytes(Uint8Array.from(atob(b), (c) => c.charCodeAt(0)), null, '바탕.nabi')", saved); time.sleep(1)
    bgr = E("__nabi.view.page.elements[0].bg")
    check('B5 저장 → 다시 열기: 바탕 값 유지', bgr and bgr['color'] == '#00ff00', bgr)
    # 파일 속 이상한 색 값은 칠하지 않음(속성 끼워 넣기 막기)
    E("""__nabi.view.change('props', () => { __nabi.view.page.elements[0].bg = { color: 'red" onload="window.__pwn=1', opacity: 1 }; })"""); time.sleep(0.2)
    check('B6 이상한 색 값 → 기본색으로, 스크립트 실행 없음', not E("!!window.__pwn") and E("__nabi.view.nodes.get(__nabi.view.page.elements[0].id).querySelector('.text-bg path, .text-bg ellipse').getAttribute('fill')") == '#ffffff', E("!!window.__pwn"))
    pg.screenshot(path=os.path.join(OUT, 'stage16.png'))

    print('page errors:', errors[:5])
    b.close()

ok = sum(1 for r in results if r[1])
for name, good, detail in results:
    print(('PASS ' if good else 'FAIL ') + name + ('' if good else '\n     ' + json.dumps(detail, ensure_ascii=False, default=str)[:1500]))
print(f'{ok}/{len(results)} passed')
