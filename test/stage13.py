"""13단계 검증(점검 보완): 글꼴 넣기·고르기·적용, 파일 속 HTML 끼워넣기 막기, 저장 실패·중복 저장·저장 중 변경, 탭 여러 개 자동 저장.
사용: python3 test/stage13.py  (proto 폴더 기준). V=1이면 항목마다 결과를 바로 찍는다.
입력은 CDP로 실제 마우스·키 이벤트를 보낸다(Playwright mouse/keyboard).
시험 글꼴은 리눅스 시스템 글꼴을 쓴다(DejaVu Serif 보통·굵게, TeX Gyre Cursor, Noto Serif CJK .ttc). 없으면 그 항목은 실패로 나온다.
"""
import json, os, io, time, base64, zipfile, threading, functools, subprocess, tempfile, shutil
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from playwright.sync_api import sync_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'test', 'out'); os.makedirs(OUT, exist_ok=True)
TMP = tempfile.mkdtemp()
FONT_R = '/usr/share/fonts/truetype/dejavu/DejaVuSerif.ttf'
FONT_B = '/usr/share/fonts/truetype/dejavu/DejaVuSerif-Bold.ttf'
FONT_CUR = '/usr/share/texmf/fonts/opentype/public/tex-gyre/texgyrecursor-regular.otf'
FONT_TTC = '/usr/share/fonts/opentype/noto/NotoSerifCJK-Bold.ttc'
# 파일 이름이 글꼴 이름과 다른 경우를 보려고 이름을 바꿔 복사
shutil.copy(FONT_R, os.path.join(TMP, 'my-font-file.ttf')); shutil.copy(FONT_B, os.path.join(TMP, 'my-font-file-bold.ttf'))
open(os.path.join(TMP, 'broken.ttf'), 'wb').write(b'this is not a font' * 10)

class Quiet(SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
srv = ThreadingHTTPServer(('127.0.0.1', 0), functools.partial(Quiet, directory=ROOT))
threading.Thread(target=srv.serve_forever, daemon=True).start()
ORIGIN = f'http://127.0.0.1:{srv.server_port}'

# 웹판 배포 폴더(dist/web)를 _headers의 CSP를 붙여 내보내는 서버(Cloudflare Pages 흉내)
subprocess.run(['node', os.path.join(ROOT, 'scripts', 'build-web.mjs')], check=True, capture_output=True)
WEB = os.path.join(ROOT, 'dist', 'web')
def parse_headers():
    rules, cur = {}, None
    for line in open(os.path.join(WEB, '_headers'), encoding='utf8'):
        if not line.strip(): continue
        if not line.startswith(' '): cur = line.strip(); rules[cur] = {}
        else: k, v = line.strip().split(': ', 1); rules[cur][k] = v
    return rules
HDR = parse_headers()
class Pages(Quiet):
    def end_headers(self):
        p = self.path.split('?')[0]
        for k, v in {**HDR.get('/*', {}), **HDR.get(p, {})}.items(): self.send_header(k, v)
        super().end_headers()
srv2 = ThreadingHTTPServer(('127.0.0.1', 0), functools.partial(Pages, directory=WEB))
threading.Thread(target=srv2.serve_forever, daemon=True).start()
WEB_ORIGIN = f'http://127.0.0.1:{srv2.server_port}'

results, metrics = [], {}
def check(name, ok, detail=''):
    results.append((name, bool(ok), detail))
    if os.environ.get('V'): print(('ok ' if ok else 'XX ') + name[:70] + ('' if ok else '  ' + json.dumps(detail, ensure_ascii=False, default=str)[:900]), flush=True)

HELPERS = r"""
(async () => {
  window.__FI = await import('/app/font-info.js');
  const N = __nabi, V = N.view, M = N.M;
  window.T = {
    N, V, M,
    reset: () => { N.app.project.pages = [M.newPage({ w: 900, h: 700 })]; N.app.current = null; N.app.switchPage(N.app.project.pages[0]); N.history.clear(); N.flush(); V.setView(1, 30, 30); },
    addText: (t, x = 100, y = 100, w = 600, h = 200) => { const n = M.makeElement('text', { doc: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: t }] }] } }); Object.assign(n, { x, y, w, h }); V.change('create', () => { V.page.elements.push(n); }); V.select([n.id]); N.flush(); return n.id; },
    ed: (id) => V.editorOf(V.node(id)),
    doc: (id) => JSON.stringify(V.editorOf(V.node(id)).state.doc.toJSON()),
    fontMarks: (id) => { const out = []; V.editorOf(V.node(id)).state.doc.descendants((n) => { if (n.isText) out.push([n.text, (n.marks.find((m) => m.type.name === 'font') || {}).attrs?.value ?? null]); }); return out; },
    spans: (id) => [...V.nodes.get(id).querySelectorAll('span.piece')].map((s) => [s.textContent, getComputedStyle(s).fontFamily, getComputedStyle(s).fontWeight]),
    pieceW: (id, word) => { for (const r of T.ed(id).results) for (const l of r.lines) for (const p of l.pieces) if (p.text === word) return p.w; return null; },
    field: (label) => { N.flush(); const f = document.querySelector(`#props [data-field="${label}"]`); f?.scrollIntoView({ block: 'center' }); if (!f) return null; const b = f.getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2, value: f.value }; },
    fontBtn: () => { N.flush(); const f = document.querySelector('#props [data-field="글꼴"]'); f.scrollIntoView({ block: 'center' }); const b = f.parentElement.querySelector('.fp-open').getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2 }; },
    popItems: () => [...document.querySelectorAll('.fp-pop .fp-it')].map((e) => ({ name: e.querySelector('.fp-name').textContent, sub: e.querySelector('.fp-sub')?.textContent || '', ff: e.querySelector('.fp-name').style.fontFamily, hi: e.classList.contains('hi') })),
    popHeads: () => [...document.querySelectorAll('.fp-pop .fp-h')].map((e) => e.textContent),
    popItem: (name) => { const e = [...document.querySelectorAll('.fp-pop .fp-it')].find((x) => x.querySelector('.fp-name').textContent === name); if (!e) return null; const b = e.getBoundingClientRect(); return { x: b.left + 40, y: b.top + b.height / 2 }; },
    popX: (name) => { const e = [...document.querySelectorAll('.fp-pop .fp-it')].find((x) => x.querySelector('.fp-name').textContent === name); const x = e?.querySelector('.fp-x'); if (!x) return null; const b = x.getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2 }; },
    modal: () => { const m = document.querySelector('.modal-bg'); return m ? { text: m.querySelector('p')?.textContent, buttons: [...m.querySelectorAll('button')].map((b) => b.textContent) } : null; },
    answer: (v) => document.querySelector(`.modal-bg [data-v="${v}"]`).click(),
    status: () => document.getElementById('status').textContent,
    fonts: () => N.app.project.fonts.map((f) => [f.family, f.weight, f.style, f.label || null]),
    loaded: (fam) => [...document.fonts].filter((f) => f.family.replace(/"/g, '') === fam && f.status === 'loaded').map((f) => f.weight).sort(),
    b64: (u8) => { let s = ''; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode(...u8.subarray(i, i + 0x8000)); return btoa(s); },
    fromB64: (b) => Uint8Array.from(atob(b), (c) => c.charCodeAt(0)),
    idbAll: async () => { const d = await new Promise((r) => { const q = indexedDB.open('nabitext', 1); q.onsuccess = () => r(q.result); });
      const g = (store, fn) => new Promise((r) => { const q = d.transaction(store).objectStore(store)[fn](); q.onsuccess = () => r(q.result); });
      return { keys: await g('recovery', 'getAllKeys'), recs: (await g('recovery', 'getAll')).map((x) => x.name), blobs: await g('blobs', 'getAllKeys') }; },
  };
  return true;
})()
"""
def projzip(pj, assets=None):
    b = io.BytesIO(); z = zipfile.ZipFile(b, 'w'); z.writestr('project.json', json.dumps(pj))
    for k, v in (assets or {}).items(): z.writestr(k, v)
    z.close(); return list(b.getvalue())
b64file = lambda p: base64.b64encode(open(p, 'rb').read()).decode()

with sync_playwright() as p:
    b = p.chromium.launch(args=['--disable-lcd-text'])
    ctx = b.new_context(viewport={'width': 1600, 'height': 1000})
    errors = []
    def open_page(origin=ORIGIN, discard=True, c=None):
        pg = (c or ctx).new_page()
        pg.route('**/fonts.googleapis.com/**', lambda r: r.abort())
        pg.on('pageerror', lambda e: errors.append(str(e)))
        pg.on('console', lambda m: m.type == 'error' and 'ERR_FAILED' not in m.text and errors.append(m.text))
        pg.goto(origin + '/index.html')
        pg.wait_for_function('window.__nabi && window.__nabi.ready', timeout=30000)
        time.sleep(0.3)
        if discard and pg.evaluate("!!document.querySelector('.modal-bg')"): pg.click('.modal-bg [data-v=discard]')
        pg.evaluate(HELPERS)
        return pg
    pg = open_page()
    E = lambda js, arg=None: pg.evaluate(js, arg) if arg is not None else pg.evaluate(js)
    mouse, kb = pg.mouse, pg.keyboard
    def click(pt, count=1): mouse.click(pt['x'], pt['y'], click_count=count)
    def wait(js, t=10):
        try: pg.wait_for_function(js, timeout=t * 1000); return True
        except Exception: return False

    # ============ F. 글꼴 넣기·고르기·적용 ============
    E("T.reset()")
    names = E("""(() => ['Pretendard-Regular.otf', 'Pretendard-SemiBoldItalic.woff2', 'NanumGothicExtraBold.ttf', 'NanumMyeongjo.ttf', 'ArchivoBlack-Regular.ttf', 'SourceSans3-It.otf', 'KoPubWorld Dotum Light.ttf', 'fraunces-latin-600-normal.woff2']
      .map((n) => { const g = __FI.guessFromName(n); return [g.family, g.weight, g.italic]; }))()""")
    check('F1 파일 이름으로 짐작(WOFF2 등): 굵기·기울임 이름을 떼고 같은 글꼴로 묶음', names == [['Pretendard', 400, False], ['Pretendard', 600, True], ['NanumGothic', 800, False], ['NanumMyeongjo', 400, False],
          ['ArchivoBlack', 400, False], ['SourceSans3', 400, True], ['KoPubWorld Dotum', 300, False], ['fraunces-latin', 600, False]], names)
    infos = E("""(async (files) => { const out = []; for (const [n, b] of files) out.push(__FI.fontInfo(n, T.fromB64(b).buffer)); return out; })""",
              [['a.ttf', b64file(FONT_R)], ['b.ttf', b64file(FONT_B)], ['c.otf', b64file(FONT_CUR)], ['d.ttc', b64file(FONT_TTC)], ['e.ttf', base64.b64encode(b'junk' * 20).decode()]])
    check('F2 파일 안 이름표 읽기: TTF·OTF·TTC(첫 글꼴)의 글꼴 이름·굵기, 깨진 파일은 파일 이름으로',
          [(i['family'], i['weight'], i['source']) for i in infos] == [('DejaVu Serif', '400', 'name'), ('DejaVu Serif', '700', 'name'), ('TeX Gyre Cursor', '400', 'name'), ('Noto Serif CJK JP', '700', 'name'), ('e', '400', 'file')], infos)

    tid = E("T.addText('가나다 Hello World')")
    w400 = E(f"T.pieceW('{tid}', 'Hello')")
    pg.set_input_files('#fontFile', [os.path.join(TMP, 'my-font-file.ttf'), os.path.join(TMP, 'my-font-file-bold.ttf')])
    wait("T.N.app.project.fonts.length === 2")
    time.sleep(0.4)
    marks = E(f"T.fontMarks('{tid}')")
    check('F3 굵기 두 파일(이름이 글꼴과 다른 파일) → "DejaVu Serif" 한 글꼴의 400·700으로 등록',
          E("T.fonts()") == [['DejaVu Serif', '400', 'normal', None], ['DejaVu Serif', '700', 'normal', None]] and E("T.loaded('DejaVu Serif')") == ['400', '700'], [E("T.fonts()"), E("T.loaded('DejaVu Serif')")])
    check('F4 글상자를 고른 채 한 글꼴을 넣으면 바로 적용(대체 글꼴 포함) + 상태 줄 안내',
          all(m[1] and m[1].startswith('"DejaVu Serif", "Noto Sans KR"') for m in marks) and '적용함' in E("T.status()") and 'DejaVu Serif' in E(f"T.spans('{tid}')")[0][1], [marks, E("T.status()"), E(f"T.spans('{tid}')")])
    E("T.N.history.undo()"); time.sleep(0.2)
    und = E(f"T.fontMarks('{tid}')")
    E("T.N.history.redo()"); time.sleep(0.2)
    check('F5 자동 적용은 되돌리기 한 단위(되돌리면 글꼴 꾸밈 없음, 글꼴은 프로젝트에 남음)', all(m[1] is None for m in und) and len(E("T.fonts()")) == 2, und)
    # 굵게 → 진짜 굵은 글꼴 파일(합성 굵게가 아니라 글자 폭이 달라짐)
    E("T.N.flush()")
    bbtn = E("(() => { const b = document.querySelector('#props button[data-field=\"굵게\"]'); b.scrollIntoView({ block: 'center' }); const r = b.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()")
    w_reg = E(f"T.pieceW('{tid}', 'Hello')")
    click(bbtn); time.sleep(0.3)
    w_bold = E(f"T.pieceW('{tid}', 'Hello')")
    sp = E(f"T.spans('{tid}')")
    check('F6 굵게 → 넣은 700 파일로 그림(글자 폭이 보통보다 넓음, 화면 굵기 700)', w_bold and w_reg and w_bold > w_reg * 1.05 and sp[-1][2] == '700', {'w400(기본)': w400, 'regular': w_reg, 'bold': w_bold, 'spans': sp})
    E("T.N.history.undo()")

    # 글꼴 목록(펼침): 실제 마우스로
    E("T.N.view.select([])"); E(f"T.N.view.select(['{tid}'])"); E("T.N.flush()")
    E("T.fontBtn()"); time.sleep(0.15); click(E("T.fontBtn()")); time.sleep(0.3)
    items, heads = E("T.popItems()"), E("T.popHeads()")
    pg.screenshot(path=os.path.join(OUT, 'stage13-font-list.png'))
    check('F7 ▼ 누르면 목록: "넣은 글꼴"이 맨 위, 굵기 수 표시, 이름은 그 글꼴로 미리 보임, 기본 글꼴 이어짐',
          heads[0].startswith('넣은 글꼴') and items[0]['name'] == 'DejaVu Serif' and '굵기 2종' in items[0]['sub'] and 'DejaVu Serif' in items[0]['ff'] and any(i['name'] == 'Noto Sans KR' for i in items), {'heads': heads, 'items': items[:4]})
    kb.press('Escape'); time.sleep(0.2)
    check('F7b 목록이 열린 채 Esc → 목록만 닫힘(글상자 선택은 그대로)', not E("!!document.querySelector('.fp-pop')") and E("T.V.selection.length") == 1, E("T.V.selection"))
    # 편집 중 글자 일부만 골라 목록에서 고르기(포커스·선택 유지)
    kb.press('Enter'); time.sleep(0.2)
    kb.press('Control+End')
    for _ in range(5): kb.press('Shift+ArrowLeft')
    E("T.fontBtn()"); time.sleep(0.15); click(E("T.fontBtn()")); time.sleep(0.3)
    still = E("!!T.N.view.editing && document.activeElement.classList.contains('ce-input')")
    click(E("T.popItem('serif')")); time.sleep(0.3)
    marks = E(f"T.fontMarks('{tid}')")
    check('F8 편집 중 "World"만 골라 목록에서 serif → 그 글자만 바뀜, 편집 상태·포커스 유지, 일반 이름은 따옴표 없이',
          still and marks[-1] == ['World', 'serif'] and marks[0][1].startswith('"DejaVu Serif"') and E("!!T.N.view.editing") and not E("!!document.querySelector('.fp-pop')"), marks)
    # 입력칸에 쳐서 거르기 → Enter
    click(E("T.field('글꼴')")); kb.press('Control+a'); kb.type('deja'); time.sleep(0.2)
    flt = E("T.popItems()")
    kb.press('Enter'); time.sleep(0.3)
    marks = E(f"T.fontMarks('{tid}')")
    check('F9 입력칸에 "deja" → 목록이 걸러지고 첫 일치가 골라짐, Enter = 적용', [i['name'] for i in flt] == ['DejaVu Serif'] and flt[0]['hi'] and marks[-1][1].startswith('"DejaVu Serif"'), [flt, marks])
    click(E("T.field('글꼴')")); kb.press('Control+a'); kb.type('Some Other Font'); kb.press('Enter'); time.sleep(0.3)
    marks = E(f"T.fontMarks('{tid}')")
    check('F10 목록에 없는 이름 + Enter → 그 이름 그대로(뒤에 한글 대체 글꼴)', marks[-1][1] == '"Some Other Font", "Noto Sans KR", "Noto Sans CJK KR", "Malgun Gothic", sans-serif', marks)
    kb.press('Escape'); time.sleep(0.1); kb.press('Escape')

    # 같은 파일 다시 넣기 / 깨진 파일
    pg.set_input_files('#fontFile', [FONT_R]); time.sleep(0.8)
    st = E("T.status()")
    check('F11 같은 글꼴(이름·굵기 같음)을 다시 넣으면 건너뛰고 알림', len(E("T.fonts()")) == 2 and '건너뜀' in st, st)
    pg.set_input_files('#fontFile', [os.path.join(TMP, 'broken.ttf')]); time.sleep(0.8)
    m = E("T.modal()")
    check('F12 깨진 글꼴 파일 → 확인 창으로 알림(파일 이름·넣을 수 있는 형식)', m and 'broken.ttf' in m['text'] and '.woff2' in m['text'] and len(E("T.fonts()")) == 2, m)
    if m: E("T.answer('ok')")
    # 캔버스에 끌어다 놓기(.otf)
    E("""(async (b) => { const f = new File([T.fromB64(b)], 'cursor.otf'); const dt = new DataTransfer(); dt.items.add(f);
      const r = T.V.viewport.getBoundingClientRect(); T.V.viewport.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, clientX: r.left + 200, clientY: r.top + 200, bubbles: true, cancelable: true })); })""", b64file(FONT_CUR))
    wait("T.N.app.project.fonts.length === 3")
    check('F13 글꼴 파일을 캔버스에 끌어다 놓기 → 프로젝트 글꼴(이미지 요소는 생기지 않음)', E("T.fonts()")[2][0] == 'TeX Gyre Cursor' and E("T.V.page.elements.length") == 1, E("T.fonts()"))
    # 출력: 넣은 글꼴이 출력 CSS에 들어감
    css = E("""(async () => { const EX = await import('/src/export.js'); const el = T.V.exportPage().render(); const fams = new Set(); for (const e of [el, ...el.querySelectorAll('*')]) if (e.style.fontFamily) for (const f of e.style.fontFamily.split(',')) fams.add(f.trim().replace(/^"|"$/g, ''));
      const c = await T.N.fonts.cssFor([...fams], el.textContent); return { fams: [...fams], n: (c.match(/@font-face/g) || []).length, dejavu: (c.match(/font-family:"DejaVu Serif"/g) || []).length }; })()""")
    check('F14 출력용 글꼴 CSS에 넣은 글꼴(굵기 둘 다) 포함', css['dejavu'] == 2, css)
    # 저장 → 다시 열기
    saved = E("""(async () => { const { bytes } = await T.N.P.toZip(T.N.app.project, { assets: T.N.assets, docOf: T.V.docOf, swatches: [] }); return T.b64(bytes); })()""")
    pj = json.loads(zipfile.ZipFile(io.BytesIO(base64.b64decode(saved))).read('project.json'))
    E("(b) => T.N.openBytes(T.fromB64(b), null, '다시.nabi')", saved); time.sleep(1.2)
    check('F15 저장 → 다시 열기: 글꼴 이름·굵기 유지, 화면에 다시 등록',
          [(f['family'], f['weight']) for f in pj['fonts']] == [('DejaVu Serif', '400'), ('DejaVu Serif', '700'), ('TeX Gyre Cursor', '400')] and E("T.fonts()") == [[f['family'], f['weight'], 'normal', None] for f in pj['fonts']] and E("T.loaded('DejaVu Serif')") == ['400', '700'],
          [pj['fonts'], E("T.fonts()")])
    # 목록의 ×로 빼기
    E("T.N.view.select([T.V.page.elements[0].id])"); E("T.N.flush()")
    E("T.fontBtn()"); time.sleep(0.15); click(E("T.fontBtn()")); time.sleep(0.3)
    mouse.move(E("T.popItem('TeX Gyre Cursor')")['x'], E("T.popItem('TeX Gyre Cursor')")['y']); time.sleep(0.1)
    click(E("T.popX('TeX Gyre Cursor')")); time.sleep(0.2)
    m = E("T.modal()")
    if m: E("T.answer('remove')")
    time.sleep(0.3)
    check('F16 넣은 글꼴 ×(확인 후) → 프로젝트·화면 등록에서 빠짐, 목록 갱신', m and '되돌리기로' in m['text'] and [f[0] for f in E("T.fonts()")] == ['DejaVu Serif', 'DejaVu Serif'] and not E("T.loaded('TeX Gyre Cursor')") and not any(i['name'] == 'TeX Gyre Cursor' for i in E("T.popItems()")), [m, E("T.fonts()")])
    kb.press('Escape')

    # ============ S. 파일 속 HTML 끼워넣기 막기 ============
    evil = 'x" onmouseover="window.__pwn=1" y="'
    pj = {'format': 'nabitext', 'version': 1, 'name': 'evil',
          'pages': [{'id': 'p1"><img src=x onerror="window.__pwn=2">', 'w': 400, 'h': 400, 'background': '#fff', 'elements': [
              {'type': 'shape', 'id': 'e1"><img src=x onerror="window.__pwn=3">', 'x': 10, 'y': 10, 'w': 50, 'h': 50, 'name': 'ok'},
              {'type': 'text', 'id': 't1', 'x': 10, 'y': 100, 'w': 300, 'h': 200, 'area': {'kind': 'path', 'd': 'M0 0" /><img src=x onerror="window.__pwn=5">'}, 'shapeFill': evil,
               'doc': {'type': 'doc', 'content': [{'type': 'paragraph', 'content': [{'type': 'text', 'text': 'hi'}]}]}}]}],
          'swatches': ['#ff0000', 'red;"><img src=x onerror="window.__pwn=4">', evil], 'fonts': [], 'styles': {}, 'grid': {'size': 20}}
    E("(d) => T.N.openBytes(new Uint8Array(d), null, 'evil.nabi')", projzip(pj)); time.sleep(1)
    E("T.N.flush()")
    # 스와치 창 열기
    E("(() => { const b = [...document.querySelectorAll('#props button')].find((b) => /스와치/.test(b.title || '')); b && b.click(); })()"); time.sleep(0.4)
    check('S1 프로젝트 파일 속 HTML 조각(스와치·장 id·요소 id·경로)이 실행되지 않음, 이상한 스와치는 버림, id는 새로',
          not E("window.__pwn") and E("T.N.swatches.list") == ['#ff0000'] and E("/^[\\w-]+$/.test(T.N.app.project.pages[0].id) && T.N.app.project.pages[0].elements.every((n) => /^[\\w-]+$/.test(n.id))") and not E("!!document.querySelector('img[onerror]')"),
          {'pwn': E("window.__pwn"), 'sw': E("T.N.swatches.list"), 'ids': E("[T.N.app.project.pages[0].id, ...T.N.app.project.pages[0].elements.map((n) => n.id)]")})
    E("""(() => { const el = { nabitext: 1, elements: [{ type: 'shape', id: 'q"><img src=x onerror="window.__pwn=6">', x: 0, y: 0, w: 10, h: 10 }, { type: '<script>', id: 'z' }] };
      const dt = new DataTransfer(); const d = document.createElement('div'); d.setAttribute('data-nabitext', JSON.stringify(el)); dt.setData('text/html', d.outerHTML);
      document.body.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true })); })()"""); time.sleep(0.4); E("T.N.flush()")
    check('S2 웹페이지에서 복사한 요소 붙여넣기: 모르는 종류는 버리고 나머지만, 스크립트 실행 없음', not E("window.__pwn") and E("T.V.page.elements.filter((n) => n.type === 'shape').length") == 2, E("T.V.page.elements.map((n) => [n.type, n.id])"))
    # 웹판 배포 폴더 + CSP
    pw = open_page(WEB_ORIGIN)
    ok_ready = pw.evaluate("window.__nabi.ready")
    pw.evaluate("(() => { const d = document.createElement('div'); d.innerHTML = '<img src=x onerror=\"window.__pwn=7\">'; document.body.appendChild(d); })()"); time.sleep(0.5)
    csp = HDR.get('/index.html', {}).get('Content-Security-Policy', '')
    check('S3 웹판 배포 폴더(_headers)의 CSP로도 편집기가 뜨고(import map 해시 일치) 끼워 넣은 onerror는 막힘', ok_ready and not pw.evaluate("window.__pwn") and "script-src 'self' 'sha256-" in csp, {'ready': ok_ready, 'pwn': pw.evaluate("window.__pwn"), 'csp': csp[:120]})
    pw.close()

    # ============ V. 저장 실패·중복 저장·저장 중 변경 ============
    E("void T.N.newProject()"); time.sleep(0.5)
    if E("T.modal()"): E("T.answer('discard')"); time.sleep(0.5)
    E("T.reset()"); E("T.addText('저장 시험')")
    E("""window.showSaveFilePicker = async () => ({ name: 'x.nabi', createWritable: async () => { throw new DOMException('denied', 'NotAllowedError'); } }); true""")
    kb.press('Control+s'); time.sleep(0.8)
    m = E("T.modal()")
    check('V1 저장 실패 → 확인 창(까닭을 쉬운 말로) + 상태 줄, "저장 안 됨" 그대로', m and '권한' in m['text'] and '저장 실패' in E("T.status()") and E("T.N.app.dirty"), [m, E("T.status()")])
    if m: E("T.answer('ok')")
    E("""window.__fs = { picks: 0, writes: 0, release: null };
      window.showSaveFilePicker = async () => { __fs.picks++; return { name: 'y.nabi', createWritable: async () => ({ write: async () => { __fs.writes++; await new Promise((r) => { __fs.release = r; }); }, close: async () => {} }) }; };; true""")
    kb.press('Control+s'); time.sleep(0.2); kb.press('Control+s'); time.sleep(0.3)
    picks_during = E("__fs.picks")
    E("T.addText('저장하는 동안 추가')"); time.sleep(0.1)
    E("__fs.release()"); time.sleep(0.5)
    check('V2 Ctrl+S 두 번 → 저장 창 한 번(저장 하나만)', picks_during == 1 and E("__fs.writes") == 1, E("__fs"))
    check('V3 저장하는 동안 바꾼 내용 → 저장 뒤에도 "저장 안 됨"으로 남고 알림', E("T.N.app.dirty") and '아직 저장되지 않았습니다' in E("T.status()"), [E("T.N.app.dirty"), E("T.status()")])
    E("""window.showSaveFilePicker = async () => { __fs.picks++; return { name: 'y.nabi', createWritable: async () => ({ write: async () => { __fs.writes++; }, close: async () => {} }) }; }; true""")
    kb.press('Control+s'); time.sleep(0.3)
    E("__fs.release && __fs.release()"); time.sleep(0.4)  # 같은 파일 핸들(V2에서 받은 것)에 쓰므로 V2의 쓰기 흉내를 풀어 준다
    check('V4 다시 저장하면 깨끗해짐(같은 파일, 창 없이)', not E("T.N.app.dirty") and E("__fs.picks") == 1, [E("__fs"), E("[T.N.app.dirty, T.N.app.rev, T.N.app.savedRev, T.status(), T.modal()]")])

    # ============ R. 탭 여러 개 자동 저장 ============
    E("T.addText('탭 A의 작업')"); E("T.N.autosave()"); time.sleep(0.5)
    a_img = E("""(async () => { const c = new OffscreenCanvas(40, 40); c.getContext('2d').fillRect(0, 0, 40, 40); const n = await T.V.addImage(await c.convertToBlob({ type: 'image/png' })); await T.N.autosave(); return T.N.assets.ofUrl(n.src).id; })()""")
    pb = open_page(discard=False)
    mb = pb.evaluate("T.modal()")
    check('R1 탭 A가 작업 중일 때 탭 B를 열면 A의 작업으로 복구를 묻지 않음', mb is None, mb)
    pb.evaluate("T.reset(); T.addText('탭 B 작업')"); pb.evaluate("T.N.autosave()"); time.sleep(0.4)
    st = E("T.idbAll()")
    check('R2 두 탭이 각자 자리에 자동 저장(서로 덮어쓰지 않음)', len(st['keys']) == 2 and a_img in st['blobs'], st)
    # B가 저장하면 B 자리만 지우고 A의 이미지 원본은 남음
    pb.evaluate("""window.showSaveFilePicker = async () => ({ name: 'b.nabi', createWritable: async () => ({ write: async () => {}, close: async () => {} }) }); true""")
    pb.keyboard.press('Control+s'); time.sleep(0.8)
    st = E("T.idbAll()")
    check('R3 탭 B 저장 → B 자리만 지움, A 자리와 A가 쓰는 이미지 원본은 남음', len(st['keys']) == 1 and a_img in st['blobs'], st)
    pb.close()
    # A가 비정상 종료(닫힘) → 새 탭 C가 A의 작업 복구를 제안
    E("T.N.autosave()"); time.sleep(0.3)
    a_json = E("(async () => { const r = await T.N.P.toJSON(T.N.app.project, { assets: T.N.assets, docOf: T.V.docOf, swatches: T.N.swatches.list }); delete r.json.savedAt; return JSON.stringify(r.json.pages.map((p) => p.elements.length)); })()")
    pg.close()
    pc = open_page(discard=False)
    mc = pc.evaluate("T.modal()")
    if mc: pc.evaluate("T.answer('restore')")
    time.sleep(1.2)
    c_json = pc.evaluate("(async () => { const r = await T.N.P.toJSON(T.N.app.project, { assets: T.N.assets, docOf: T.V.docOf, swatches: T.N.swatches.list }); return JSON.stringify(r.json.pages.map((p) => p.elements.length)); })()")
    img_ok = pc.evaluate("(id) => !!T.N.assets.get(id)", a_img)
    st = pc.evaluate("T.idbAll()")
    check('R4 탭 A가 닫힌 뒤 새 탭 → A의 작업 복구 제안(원래 파일 이름 표시) → 복구 = 같은 내용·이미지, 이 탭 자리로 옮김',
          mc and '저장하지 않은 작업' in mc['text'] and '원래 파일: y.nabi' in mc['text'] and c_json == a_json and img_ok and len(st['keys']) == 1 and a_img in st['blobs'], [mc, a_json, c_json, img_ok, st])
    # 예전 형식(한 자리 'current')도 복구 제안
    pc.evaluate("""(async () => { const d = await new Promise((r) => { const q = indexedDB.open('nabitext', 1); q.onsuccess = () => r(q.result); });
      const json = { format: 'nabitext', version: 1, name: '예전 복구본', pages: [{ id: 'p', w: 300, h: 300, elements: [] }] };
      await new Promise((r) => { const t = d.transaction('recovery', 'readwrite'); t.objectStore('recovery').put({ json, savedAt: Date.now() - 1000, name: json.name, file: null }, 'current'); t.oncomplete = r; }); })()""")
    pd = open_page(discard=False)
    md = pd.evaluate("T.modal()")
    check('R5 예전 버전이 남긴 복구본(자리 하나)도 복구 제안', md and '예전 복구본' in md['text'], md)
    if md: pd.evaluate("T.answer('discard')")
    time.sleep(0.4)
    st = pd.evaluate("T.idbAll()")
    check('R6 버리기 → 그 자리만 지우고 살아 있는 탭(C)의 자리·이미지는 남음', 'current' not in st['keys'] and len(st['keys']) == 1 and a_img in st['blobs'], st)
    pd.close(); pc.close()

    b.close()

fails = [r for r in results if not r[1]]
for n, ok, d in results: print(('PASS ' if ok else 'FAIL ') + n + ('' if ok else '\n     ' + json.dumps(d, ensure_ascii=False, default=str)[:1200]))
print('page errors:', errors[:8])
print(f'{len(results) - len(fails)}/{len(results)} passed')
json.dump({'results': [[n, ok] for n, ok, _ in results], 'metrics': metrics}, open(os.path.join(OUT, 'stage13.json'), 'w'), ensure_ascii=False, indent=1)
