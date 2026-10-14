"""5단계 Electron 검증: 리눅스에서 실제 Electron을 Xvfb(가상 X 화면)로 띄워 확인한다.
사용: python3 test/electron.py  (proto 폴더 기준)
필요: npm install 완료(node_modules/electron), Xvfb, xdotool, poppler-utils, pip의 websocket-client
      dist/linux-unpacked(= npm run dist:dir)가 있으면 패키징된 앱도 검사한다.

연결 방식
 - 렌더러: --remote-debugging-port로 띄우고 Playwright connect_over_cdp로 붙는다(웹판 테스트와 같은 방식).
 - 메인 프로세스: --inspect(Node 검사기)에 웹소켓으로 붙어 대화상자를 가짜로 바꾸고 메뉴 항목을 누른다.
 - 키 입력: xdotool로 실제 X11 키 이벤트를 보낸다(운영체제 → Electron → 메뉴 단축키 → 페이지 순서를 그대로 거침).
   한글 조합만 CDP(Input.imeSetComposition)로 보낸다.
 - root로 실행되는 컨테이너라 --no-sandbox가 필요하다(일반 사용자 실행에는 불필요).
"""
import json, os, io, re, time, base64, shutil, zipfile, signal, socket, subprocess, tempfile, urllib.request, threading, functools
from html import unescape as _html_unescape
from playwright.sync_api import sync_playwright
from PIL import Image
import numpy as np
import websocket

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'test', 'out')
os.makedirs(OUT, exist_ok=True)
TMP = tempfile.mkdtemp(prefix='le-electron-')
ELECTRON = os.path.join(ROOT, 'node_modules', 'electron', 'dist', 'electron')
PACKAGED = os.path.join(ROOT, 'dist', 'linux-unpacked', 'Nabitext')
MAIN_JS = os.path.join(ROOT, 'electron', 'main.js')
UPLOAD_FONT = '/usr/share/texmf/fonts/opentype/public/tex-gyre/texgyrecursor-regular.otf'
FRAMES = ['donut', 'alpha', 'colorKey', 'invert']
TITLE = '레이아웃 엔진 프로토타입'

results, metrics = [], {}
def check(name, ok, detail=''):
    results.append((name, bool(ok), detail))

def free_port():
    s = socket.socket(); s.bind(('127.0.0.1', 0)); p = s.getsockname()[1]; s.close(); return p

def run(cmd, **kw):
    return subprocess.run(cmd, capture_output=True, text=True, check=True, **kw).stdout

def compare(a, b):
    """채널별 최대 차이(0–255). nb_* = 1px 이웃 이동을 허용한 차이(위치가 같은지)."""
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
    return {'max': int(d.max()), 'mean': round(float(d.mean()), 3), 'pct16': pct(d > 16), 'pct64': pct(d > 64), 'nb_max': int(nb.max()), 'nb_pct64': pct(nb > 64)}

# 화면과 '같음' 판정(test/export.py와 같은 기준). Chrome 148 이후 SVG 이미지 안 글자의 사선·곡선 획과 선 장식의
# 가장자리 안티에일리어싱이 화면과 조금 다르다(위치는 같음). → 위치(이웃 허용)와 가장자리 차이의 양을 따로 제한.
def same_as_screen(m, nb=0.05, px16=0.3):
    return m.get('nb_pct64', 1) < nb and m.get('pct16', 100) < px16

def img_from_dataurl(u):
    return Image.open(io.BytesIO(base64.b64decode(u.split(',', 1)[1])))

def pdf_page_sizes(path):
    out = run(['pdfinfo', '-f', '1', '-l', '999', path])
    return [tuple(float(v) for v in l.split(':', 1)[1].split('pts')[0].split('x')) for l in out.splitlines() if l.startswith('Page') and 'size' in l]

# ---------- 가상 화면 ----------
def start_xvfb():
    for n in range(90, 130):
        if not os.path.exists(f'/tmp/.X11-unix/X{n}') and not os.path.exists(f'/tmp/.X{n}-lock'):
            proc = subprocess.Popen(['Xvfb', f':{n}', '-screen', '0', '2000x1400x24', '-nolisten', 'tcp'], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            for _ in range(50):
                if os.path.exists(f'/tmp/.X11-unix/X{n}'): return proc, f':{n}'
                time.sleep(0.1)
            proc.kill()
    raise RuntimeError('Xvfb를 띄우지 못함')

xvfb, DISPLAY = start_xvfb()
HOME = os.path.join(TMP, 'home'); os.makedirs(HOME)
ENV = {**os.environ, 'DISPLAY': DISPLAY, 'HOME': HOME, 'XDG_CONFIG_HOME': os.path.join(HOME, '.config')}
ENV.pop('ELECTRON_RUN_AS_NODE', None)

def launch(binary, app_arg, inspect=True, env=None):
    rport = free_port(); iport = free_port() if inspect else None
    args = [binary, '--no-sandbox', '--disable-lcd-text', f'--remote-debugging-port={rport}']
    if inspect: args.append(f'--inspect={iport}')
    if app_arg: args.append(app_arg)
    log = open(os.path.join(TMP, f'electron-{rport}.log'), 'w')
    proc = subprocess.Popen(args, env={**ENV, **(env or {})}, stdout=log, stderr=subprocess.STDOUT, start_new_session=True)
    for _ in range(150):
        try:
            if json.load(urllib.request.urlopen(f'http://127.0.0.1:{rport}/json/list', timeout=1)): break
        except Exception: pass
        time.sleep(0.2)
    return proc, rport, iport

def stop(proc):
    try: os.killpg(proc.pid, signal.SIGTERM)
    except ProcessLookupError: return
    try: proc.wait(5)
    except subprocess.TimeoutExpired: os.killpg(proc.pid, signal.SIGKILL)

class Main:
    """메인 프로세스 Node 검사기(Runtime.evaluate). 식은 async 함수 본문으로 실행된다."""
    def __init__(self, port):
        url = None
        for _ in range(50):
            try: url = json.load(urllib.request.urlopen(f'http://127.0.0.1:{port}/json/list', timeout=1))[0]['webSocketDebuggerUrl']; break
            except Exception: time.sleep(0.2)
        self.ws = websocket.create_connection(url, timeout=120); self.n = 0
    def ev(self, body):
        self.n += 1
        self.ws.send(json.dumps({'id': self.n, 'method': 'Runtime.evaluate', 'params': {
            'expression': f'(async () => {{ const {{ app, BrowserWindow, Menu, dialog, clipboard, session, shell }} = require("electron"); const M = require({json.dumps(MAIN_JS)}); const W = BrowserWindow.getAllWindows().find((w) => w.webContents.getURL().startsWith("app://bundle")); {body} }})()',
            'awaitPromise': True, 'returnByValue': True, 'includeCommandLineAPI': True}}))
        while True:
            m = json.loads(self.ws.recv())
            if m.get('id') == self.n: break
        r = m.get('result', {})
        if 'exceptionDetails' in r: raise RuntimeError(json.dumps(r['exceptionDetails'], ensure_ascii=False)[:800])
        return r['result'].get('value')

def xkey(keys):
    wid = run(['xdotool', 'search', '--name', TITLE], env=ENV).split()[0]
    subprocess.run(['xdotool', 'windowfocus', '--sync', wid], env=ENV, check=False, capture_output=True)
    subprocess.run(['xdotool', 'key', '--clearmodifiers', keys], env=ENV, check=True)
    time.sleep(0.4)

JS = r"""
(async () => {
  window.EX = await import('/src/export.js');
  window.MS = await import('/src/measure.js');
  window.PS = await import('/vendor/prosemirror-state.js');
  window.X = {
    ed: (id) => __app.editors.get(id),
    json: (id) => JSON.stringify(X.ed(id).state.doc.toJSON()),
    text: (id) => X.ed(id).state.doc.textContent,
    find: (id, str) => {
      const doc = X.ed(id).state.doc; let s = '', map = [];
      doc.descendants((n, pos) => { if (n.isText) for (let i = 0; i < n.text.length; i++) { s += n.text[i]; map.push(pos + i); } });
      const i = s.indexOf(str); return i < 0 ? null : [map[i], map[i + str.length - 1] + 1];
    },
    select: (id, str) => { const ed = X.ed(id), r = X.find(id, str); ed.focus(); ed.setSelection(PS.TextSelection.create(ed.state.doc, r[0], r[1])); },
    caret: (id, pos) => { const ed = X.ed(id); ed.focus(); ed.setSelection(PS.TextSelection.create(ed.state.doc, pos)); },
    mark: (id, str, name, attrs) => { X.select(id, str); X.ed(id).setMark(name, attrs); X.caret(id, 1); },
    marksAt: (id, str) => { const r = X.find(id, str); return r ? X.ed(id).state.doc.resolve(r[0] + 1).marks().map((m) => m.type.name) : null; },
    count: (id, str) => X.text(id).split(str).length - 1,
    // 꾸밈이 없는 글자 두 개 사이의 위치(붙여넣은 글자가 앞뒤 꾸밈을 물려받지 않도록)
    plainPos: (id) => { const doc = X.ed(id).state.doc; let r = null;
      doc.descendants((n, pos) => { if (r == null && n.isText && !n.marks.length && n.text.length > 4 && !/\s/.test(n.text.slice(1, 3))) r = pos + 2; });
      return r; },
    marksAtPos: (id, pos) => X.ed(id).state.doc.resolve(pos).marks().map((m) => m.type.name),
    pin: (id) => {
      document.activeElement && document.activeElement.blur();
      for (const f of document.querySelectorAll('.frame')) f.style.cssText = '';
      document.getElementById('f-' + id).style.cssText = 'position:fixed;left:0;top:0;z-index:99;outline:none';
    },
    unpin: () => { for (const f of document.querySelectorAll('.frame')) f.style.cssText = ''; },
    raster: async (id, opts) => (await EX.rasterize(X.ed(id).exportPage(), opts)).toDataURL('image/png'),
    pages: () => [...__app.editors.values()].map((e) => e.exportPage()),
  };
  return true;
})()
"""

MOCK = r"""
globalThis.__dlg = { calls: [], save: [], open: [], box: [], ext: [] };
dialog.showSaveDialog = async (w, o) => { __dlg.calls.push({ t: 'save', o }); return __dlg.save.shift() ?? { canceled: true }; };
dialog.showOpenDialog = async (w, o) => { __dlg.calls.push({ t: 'open', o }); return __dlg.open.shift() ?? { canceled: true, filePaths: [] }; };
dialog.showMessageBox = async (w, o) => { __dlg.calls.push({ t: 'box', o }); return { response: __dlg.box.shift() ?? 1 }; };
shell.openExternal = async (u) => { __dlg.ext.push(u); };
W.setContentSize(1400, 1300);
return 'ok';
"""

def wait_js(pg, expr, timeout=30):
    """CSP가 문자열 eval을 막아 Playwright의 대기 함수(문자열 식)를 쓸 수 없으므로 evaluate로 폴링한다."""
    end = time.time() + timeout
    while time.time() < end:
        try:
            if pg.evaluate(expr): return True
        except Exception: pass
        time.sleep(0.1)
    raise TimeoutError(expr)

def export_via_button(pg, fmt, rng='all', scale='1'):
    if pg.evaluate("document.getElementById('exportPop')?.hidden === true"): pg.click('#exportBtn')  # 내보내기 설정은 내보내기 창 안(12단계 개편)
    pg.select_option('#exFormat', fmt); pg.select_option('#exRange', rng); pg.select_option('#exScale', scale)
    pg.evaluate("document.getElementById('exStatus').textContent = ''")
    pg.click('#exRun')
    wait_js(pg, "(() => { const t = document.getElementById('exStatus').textContent; return t && t !== '만드는 중…'; })()", 60)
    return pg.evaluate("document.getElementById('exStatus').textContent")

proc, RPORT, IPORT = launch(ELECTRON, ROOT)
try:
  with sync_playwright() as p:
    b = p.chromium.connect_over_cdp(f'http://127.0.0.1:{RPORT}')
    pg = next(x for c in b.contexts for x in c.pages if x.url.startswith('app://bundle/'))
    M = Main(IPORT)
    check('M0 메인 프로세스 검사기 연결, 대화상자 가짜로 교체', M.ev(MOCK) == 'ok')

    # ============ A. 편집기 화면(index.html) ============
    errors = []
    pg.on('pageerror', lambda e: errors.append(str(e)))
    pg.on('console', lambda m: m.type == 'error' and errors.append(m.text))
    wait_js(pg, '!!(window.__nabi && window.__nabi.ready)', 30)
    ed = pg.evaluate("({ url: location.href, title: document.title, kind: __nabi.platform.kind, page: [__nabi.view.page.w, __nabi.view.page.h] })")
    win = M.ev("return { title: W.getTitle(), name: app.getName(), userData: app.getPath('userData') };")
    check('A1 Electron 시작 화면 = 편집기(index.html), 창 제목 "제목 없음 — 나비글쓰기"·앱 이름 나비글쓰기, 설정 폴더 이름도 나비글쓰기',
          ed['url'] == 'app://bundle/index.html' and ed['title'] == '제목 없음 — 나비글쓰기' and win['title'] == ed['title'] and win['name'] == '나비글쓰기' and win['userData'].endswith('나비글쓰기'), {'ed': ed, 'win': win})
    # 편집기 속성 패널의 "시스템 글꼴" 버튼 → 글꼴 목록(datalist)에 설치된 글꼴이 들어감(실제 권한 경로)
    n0 = pg.evaluate("document.querySelectorAll('#pp-fonts option').length")
    bt = pg.evaluate("(() => { const b = document.getElementById('sysFonts').getBoundingClientRect(); return [b.left + 5, b.top + 5]; })()")
    pg.mouse.click(bt[0], bt[1])
    wait_js(pg, f"document.querySelectorAll('#pp-fonts option').length > {n0}", 10)
    n1 = pg.evaluate("document.querySelectorAll('#pp-fonts option').length")
    check(f'A2 편집기 "시스템 글꼴" 버튼 → 글꼴 목록 {n0} → {n1}개(Noto Sans CJK KR 포함)', n1 > n0 + 5 and pg.evaluate("[...document.querySelectorAll('#pp-fonts option')].some((o) => o.value === 'Noto Sans CJK KR')"), [n0, n1])
    ed_api = pg.evaluate("[typeof window.EyeDropper, !document.querySelector('#props .cf-drop') || !document.querySelector('#props .cf-drop').disabled]")
    metrics['eyedropper'] = ed_api[0]
    check(f'A3 스포이트(EyeDropper API) 제공 여부: {ed_api[0]} (실제 색 집기는 사람이 확인)', ed_api[0] == 'function', ed_api)
    # 이후 검사는 엔진 데모 화면(demo.html)에서
    pg.goto('app://bundle/demo.html')

    # ============ L. 실행: 웹판과 같은 렌더러를 app://로 불러옴 ============
    wait_js(pg, '!!(window.__app && window.__app.ready)', 30)
    time.sleep(1.0)
    load_errors = [e for e in errors if 'fonts.googleapis' not in e and 'ERR_' not in e]
    info = pg.evaluate("""({ url: location.href, secure: isSecureContext, kind: __app.platform.kind,
      req: typeof require, proc: typeof process, nativeKeys: Object.keys(window.native).sort(),
      ua: navigator.userAgent })""")
    metrics['electron'] = info
    check('L1 app://bundle/demo.html 로드, 초기화 완료, 불러오기 중 스크립트 오류 없음(구글 폰트 연결 실패 제외)',
          info['url'] == 'app://bundle/demo.html' and not load_errors, {'errors': load_errors, 'all': errors})
    check('L2 보안 컨텍스트(Local Font Access·클립보드 API 조건), platform.kind = electron', info['secure'] and info['kind'] == 'electron', info)
    check('L3 렌더러에 Node 없음(require·process 없음), window.native는 정해 둔 13개만(12단계: updates 추가 — 업데이트 IPC 네 가지만)',
          info['req'] == 'undefined' and info['proc'] == 'undefined' and info['nativeKeys'] == ['closeWindow', 'edit', 'onMenu', 'onOpenFile', 'openProject', 'platform', 'saveFiles', 'saveProject', 'saveVectorPDF', 'setDirty', 'setMenuState', 'takePendingFile', 'updates'] and pg.evaluate("Object.keys(window.native.updates).sort()") == ['check', 'install', 'onState', 'setAuto', 'state'], info)
    same = pg.evaluate("""(async (files) => { const out = {}; for (const f of files) { const b = new Uint8Array(await (await fetch('/' + f)).arrayBuffer());
      const h = await crypto.subtle.digest('SHA-256', b); out[f] = [...new Uint8Array(h)].map((x) => x.toString(16).padStart(2, '0')).join(''); } return out; })""",
      [os.path.relpath(os.path.join(d, f), ROOT) for top in ['src', 'vendor', 'demo', 'app', 'res'] for d, _, fs in os.walk(os.path.join(ROOT, top)) for f in fs] + ['index.html', 'demo.html'])
    import hashlib
    diff = [f for f, h in same.items() if hashlib.sha256(open(os.path.join(ROOT, f), 'rb').read()).hexdigest() != h]
    check(f'L4 렌더러 파일 {len(same)}개가 웹판 파일과 바이트 단위로 같음(index.html, demo.html, app, src, vendor, demo, res)', not diff and len(same) > 15, diff)

    # ============ S. 보안 ============
    before = len(errors)
    st = pg.evaluate("""(async () => { const s = async (u) => { try { return (await fetch(u)).status; } catch (e) { return 'err'; } };
      return { main: await s('/electron/main.js'), pkg: await s('/package.json'), nm: await s('/node_modules/electron/package.json'),
        dots: await s('/%2e%2e/package.json'), enc: await s('/src/%2e%2e/electron/main.js'), print: await s('app://print/nope'),
        other: await s('app://other/index.html'), ok: await s('/src/editor.js') }; })()""")
    time.sleep(0.3); del errors[before:]  # 의도한 404·CSP 차단 보고
    check('S1 app://에서 electron/·node_modules·package.json·경로 탈출(%2e%2e)·다른 호스트는 404, src는 200',
          st['ok'] == 200 and all(v in (404, 'err') for k, v in st.items() if k != 'ok'), st)
    csp = pg.evaluate("(async () => (await fetch('/index.html')).headers.get('content-security-policy'))()")
    before = len(errors)
    inj = pg.evaluate("""(async () => { const s = document.createElement('script'); s.textContent = 'window.__csp = 1'; document.head.appendChild(s);
      await new Promise((r) => setTimeout(r, 100)); return typeof window.__csp; })()""")
    check('S2 CSP 적용: import map은 해시로 허용, 끼워 넣은 인라인 스크립트는 실행 안 됨', csp and "'sha256-" in csp and inj == 'undefined', {'csp': csp, 'inline': inj})
    del errors[before:]  # CSP 위반 보고는 의도한 것
    opened = pg.evaluate("[window.open('https://example.com/x') === null, window.open('app://bundle/index.html') === null]")
    time.sleep(0.5)
    ext = M.ev("return { ext: __dlg.ext, windows: BrowserWindow.getAllWindows().length };")
    check('S3 새 창 금지: window.open → null, http(s) 주소는 기본 브라우저로 넘김, 창 수 1', all(opened) and ext['ext'] == ['https://example.com/x'] and ext['windows'] == 1, {'opened': opened, **ext})
    perm = pg.evaluate("(async () => ({ geo: (await navigator.permissions.query({ name: 'geolocation' })).state, fonts: (await navigator.permissions.query({ name: 'local-fonts' })).state }))()")
    check('S5 권한: 시스템 글꼴 허용, 그 밖(위치 등)은 거부', perm == {'geo': 'denied', 'fonts': 'granted'}, perm)
    bad = pg.evaluate("""(async () => { const r = [];
      for (const f of [[{ name: '../x.png', data: new Uint8Array(3) }], [{ name: 'a/b.png', data: new Uint8Array(3) }], [{ name: 'ok.png', data: 'text' }], []]) {
        try { await window.native.saveFiles(f); r.push('saved'); } catch (e) { r.push('rejected'); } }
      try { await window.native.edit('reload'); r.push('ran'); } catch (e) { r.push('rejected'); }
      return r; })()""")
    check('S6 IPC 입력 검사: 경로가 섞인 이름·잘못된 내용·빈 목록·허용 밖 편집 동작 거부', bad == ['rejected'] * 5, bad)

    # ============ R. 출력: app:// 에서도 캔버스가 오염되지 않고 화면과 일치 ============
    pg.evaluate(JS)
    font64 = base64.b64encode(open(UPLOAD_FONT, 'rb').read()).decode()
    pg.evaluate("""(async (b64) => { const bin = atob(b64), u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
      await __app.fonts.register('업로드글꼴', u.buffer); MS.clearMeasureCache();
      X.mark('donut', 'Pneumonoultramicroscopicsilicovolcanoconiosis', 'font', { value: '"업로드글꼴", monospace' });
      X.mark('alpha', '레이아웃', 'font', { value: '"업로드글꼴", monospace' }); })""", font64)
    screen1 = {}
    for fid in FRAMES:
        pg.evaluate(f"X.pin('{fid}')"); time.sleep(0.1)
        screen1[fid] = Image.open(io.BytesIO(pg.screenshot(clip={'x': 0, 'y': 0, 'width': 560, 'height': 560})))
        m = compare(screen1[fid], img_from_dataurl(pg.evaluate(f"X.raster('{fid}', {{ scale: 1 }})")))
        metrics[f'png1x/{fid}'] = m
        check(f'R1 PNG 1x [{fid}] 화면과 대조: 위치 일치(이웃 허용 64 초과 {m.get("nb_pct64")}% < 0.05%), 16 넘게 다른 픽셀 {m.get("pct16")}% < 0.3%', same_as_screen(m), m)
    pg.evaluate("X.unpin()")
    screen1['donut'].save(os.path.join(OUT, 'electron-screen-1x.png'))

    # ============ F. 네이티브 파일 대화상자 ============
    d1 = os.path.join(TMP, 'export1'); os.makedirs(d1)
    M.ev(f"__dlg.calls = []; __dlg.open.push({{ canceled: false, filePaths: [{json.dumps(d1)}] }}); return 1;")
    s = export_via_button(pg, 'png', 'all', '1')
    calls = M.ev("return __dlg.calls;")
    names = sorted(os.listdir(d1))
    check('F1 여러 장 PNG → 폴더 선택 대화상자 1회, 레이아웃 데모_1–4.png 저장, 임시 파일 없음',
          [c['t'] for c in calls] == ['open'] and 'openDirectory' in calls[0]['o']['properties'] and names == [f'레이아웃 데모_{i}.png' for i in range(1, 5)], {'status': s, 'names': names, 'calls': calls})
    m = compare(screen1['donut'], Image.open(os.path.join(d1, '레이아웃 데모_1.png')))
    check('F2 저장된 파일 내용 = 화면(R1 기준)', same_as_screen(m), m)
    mt = {n: os.stat(os.path.join(d1, n)).st_mtime_ns for n in names}
    M.ev(f"__dlg.calls = []; __dlg.open.push({{ canceled: false, filePaths: [{json.dumps(d1)}] }}); __dlg.box.push(1); return 1;")
    s_cancel = export_via_button(pg, 'png', 'all', '1')
    calls = M.ev("return __dlg.calls;")
    unchanged = all(os.stat(os.path.join(d1, n)).st_mtime_ns == mt[n] for n in names)
    check('F3 같은 이름이 있으면 덮어쓸지 묻고, 취소하면 파일을 건드리지 않음', [c['t'] for c in calls] == ['open', 'box'] and '4개' in calls[1]['o']['message'] and unchanged and s_cancel == '취소함',
          {'status': s_cancel, 'calls': [c['t'] for c in calls], 'msg': calls[-1]['o'].get('message') if calls else None})
    time.sleep(0.02)
    M.ev(f"__dlg.open.push({{ canceled: false, filePaths: [{json.dumps(d1)}] }}); __dlg.box.push(0); return 1;")
    export_via_button(pg, 'png', 'all', '1')
    changed = all(os.stat(os.path.join(d1, n)).st_mtime_ns != mt[n] for n in names)
    check('F4 덮어쓰기를 고르면 4개 모두 새로 씀, 임시 파일 남지 않음', changed and sorted(os.listdir(d1)) == names, sorted(os.listdir(d1)))
    # 한 장: 파일 저장 대화상자. 기본 경로 = 마지막 폴더 + 규칙대로 지은 이름. 확장자 없이 입력하면 붙인다.
    pg.evaluate("X.ed('colorKey').focus()")
    M.ev(f"__dlg.calls = []; __dlg.save.push({{ canceled: false, filePath: {json.dumps(os.path.join(TMP, 'one'))} }}); return 1;")
    s1 = export_via_button(pg, 'jpg', 'current', '1')
    calls = M.ev("return __dlg.calls;")
    one = os.path.join(TMP, 'one.jpg')
    check('F5 현재 장 JPG → 저장 대화상자(기본 이름 레이아웃 데모_3.jpg, 기본 폴더 = 마지막 폴더), 확장자 자동으로 붙임',
          [c['t'] for c in calls] == ['save'] and calls[0]['o']['defaultPath'] == os.path.join(d1, '레이아웃 데모_3.jpg') and os.path.exists(one) and open(one, 'rb').read(3) == b'\xff\xd8\xff',
          {'status': s1, 'calls': calls})
    M.ev("__dlg.calls = []; return 1;")  # 다음 save 응답 없음 → 취소
    s2 = export_via_button(pg, 'webp', 'current', '1')
    check('F6 저장 대화상자에서 취소 → 파일 없음, 상태 "취소함"', s2 == '취소함' and not any(f.endswith('.webp') for f in os.listdir(TMP)), s2)
    rp = os.path.join(TMP, 'raster.pdf')
    M.ev(f"__dlg.calls = []; __dlg.save.push({{ canceled: false, filePath: {json.dumps(rp)} }}); return 1;")
    s3 = export_via_button(pg, 'pdf', 'all', '2')
    calls = M.ev("return __dlg.calls;")
    imgs = run(['pdfimages', '-list', rp]).splitlines()[2:] if os.path.exists(rp) else []
    check('F7 래스터 PDF → 저장 대화상자(기본 이름 레이아웃 데모.pdf), 4쪽, 쪽마다 1120×1120 이미지',
          calls and calls[0]['o']['defaultPath'].endswith('레이아웃 데모.pdf') and pdf_page_sizes(rp) == [(420.0, 420.0)] * 4 and [(int(l.split()[3]), int(l.split()[4])) for l in imgs] == [(1120, 1120)] * 4,
          {'status': s3, 'calls': calls})

    # ============ V. 벡터 PDF: printToPDF로 인쇄 창 없이 바로 저장 ============
    vp = os.path.join(TMP, 'vector')
    M.ev(f"__dlg.calls = []; __dlg.save.push({{ canceled: false, filePath: {json.dumps(vp)} }}); return 1;")
    t0 = time.time()
    sv = export_via_button(pg, 'vector', 'all', '1')
    metrics['time/vector-pdf-4p-ms'] = round((time.time() - t0) * 1000)
    vp += '.pdf'
    after = M.ev("return { windows: BrowserWindow.getAllWindows().length, docs: M.printDocs.size, calls: __dlg.calls };")
    ok = os.path.exists(vp)
    sizes = pdf_page_sizes(vp) if ok else []
    check('V1 벡터 PDF → 저장 대화상자 1회, 파일 저장(확장자 자동), 4쪽 420×420pt(±0.5)', ok and [c['t'] for c in after['calls']] == ['save'] and len(sizes) == 4 and all(abs(a - 420) <= 0.5 and abs(c - 420) <= 0.5 for a, c in sizes), {'status': sv, 'sizes': sizes})
    check('V2 인쇄용 숨긴 창과 문서가 정리됨(창 1개, 대기 문서 0)', after['windows'] == 1 and after['docs'] == 0, after)
    if ok:
        txt = run(['pdftotext', '-layout', vp, '-']).split('\f')
        strip = lambda s: ''.join(s.split())
        want = pg.evaluate("[...__app.editors.values()].map(ed => ed.result.lines.flatMap(l => l.pieces.map(p => p.text)).join(''))")
        tok = [all(w in strip(txt[i]) for w in [strip(want[i])[:12], strip(want[i])[-12:]]) for i in range(4)]
        check('V3 글자가 글자로 남음(pdftotext로 장마다 첫·끝 12자)', all(tok), tok)
        fl = run(['pdffonts', vp]).splitlines()[2:]
        emb = [l for l in fl if l.split()[-5] == 'yes']
        check('V4 글꼴 전부 포함, 업로드 글꼴 포함', fl and len(emb) == len(fl) and 'TeXGyreCursor' in ' '.join(fl).replace(' ', ''), fl)
        pcs = pg.evaluate("[...__app.editors.values()].map(ed => ed.result.lines.flatMap(l => l.pieces.filter(p => !p.space).map(p => ({ t: p.text, x: p.x, y: p.top + p.h / 2, top: p.top, base: l.baseline, k: p.style.fontFamily + '|' + p.style.fontSize + '|' + p.style.fontWeight }))))")
        pos = {}
        for i, fid in enumerate(FRAMES):
            bb = run(['pdftotext', '-bbox', '-f', str(i + 1), '-l', str(i + 1), vp, '-'])
            words = [(float(a) * 4 / 3, (float(b2) + float(d)) / 2 * 4 / 3, _html_unescape(t)) for a, b2, c, d, t in
                     re.findall(r'<word xMin="([\d.-]+)" yMin="([\d.-]+)" xMax="([\d.-]+)" yMax="([\d.-]+)">([^<]*)</word>', bb)]
            dxs, dys = [], {}
            for pc in pcs[i]:
                cand = [w for w in words if w[2] == pc['t'] and abs(w[0] - pc['x']) < 20 and abs(w[1] - pc['y']) < 20]
                if not cand: continue
                w = min(cand, key=lambda w: abs(w[0] - pc['x']) + abs(w[1] - pc['y']))
                dxs.append(w[0] - pc['x'])
                for cn in ('top', 'base', 'y'):
                    dys.setdefault(cn, {}).setdefault(pc['k'], []).append(w[1] - round(pc[cn]))
            spreads = {c: round(max((max(v) - min(v)) for v in g.values()), 3) for c, g in dys.items()}
            pos[fid] = {'matched': len(dxs), 'max_dx_px': round(max(map(abs, dxs)), 3), 'y_spread_px': min(spreads.values())}
        metrics['vector-pdf-positions'] = pos
        # test/export.py R7과 같은 기준: 가로는 엔진 값과 0.05px, 세로는 Chrome 인쇄가 정수 px로 맞추므로 반올림 후 글꼴별 편차 0.5px
        check('V5 PDF 단어 위치 = 엔진 계산 위치: 가로 0.05px 이내, 세로(정수 반올림 기준) 0.5px 이내(단어 20개 이상 대응)',
              all(v['matched'] >= 20 and v['max_dx_px'] <= 0.05 and v['y_spread_px'] <= 0.5 for v in pos.values()), pos)
        # 4단계(headless Chromium의 page.pdf)와 같은 엔진이므로 결과 모양도 같아야 한다: 96dpi로 그려 화면과 비교
        pages96 = []
        prefix = os.path.join(TMP, 'v96'); run(['pdftoppm', '-r', '96', '-png', vp, prefix])
        for i, fid in enumerate(FRAMES):
            f = sorted(x for x in os.listdir(TMP) if x.startswith('v96-'))[i]
            metrics[f'vector-pdf-poppler96/{fid}'] = compare(screen1[fid], Image.open(os.path.join(TMP, f)))
        Image.open(os.path.join(TMP, sorted(x for x in os.listdir(TMP) if x.startswith('v96-'))[0])).save(os.path.join(OUT, 'electron-vector-p1-96dpi.png'))
    # 크기가 다른 장이 섞인 경우(이름 붙은 @page)
    vp2 = os.path.join(TMP, 'mixed.pdf')
    M.ev(f"__dlg.save.push({{ canceled: false, filePath: {json.dumps(vp2)} }}); return 1;")
    r = pg.evaluate("""(async () => { const extra = { w: 300, h: 500, render: () => { const d = document.createElement('div');
        d.style.cssText = 'position:relative;width:300px;height:500px;background:#223;color:#fff;font:700 40px sans-serif';
        d.innerHTML = '<span style="position:absolute;left:20px;top:30px">Extra 장</span>'; return d; } };
      return __app.platform.saveVectorPDF([X.pages()[0], extra], { project: '혼합' }); })()""")
    sz = pdf_page_sizes(vp2) if os.path.exists(vp2) else []
    check('V6 크기가 다른 장: 420×420pt, 225×375pt(±0.5)', len(sz) == 2 and abs(sz[1][0] - 225) <= 0.5 and abs(sz[1][1] - 375) <= 0.5 and 'Extra' in run(['pdftotext', vp2, '-']), {'r': r, 'sizes': sz})
    M.ev("__dlg.calls = []; return 1;")
    rc = pg.evaluate("__app.platform.saveVectorPDF(X.pages(), { project: '취소' })")
    wc = M.ev("return BrowserWindow.getAllWindows().length;")
    check('V7 PDF 저장 대화상자 취소 → 인쇄 창을 만들지 않음', rc['mode'] == 'cancelled' and wc == 1, {'r': rc, 'windows': wc})

    # ============ U. 편집 메뉴의 되돌리기 → 전역 스택 ============
    cdp = pg.context.new_cdp_session(pg)
    ins = lambda t: cdp.send('Input.insertText', {'text': t})
    pg.evaluate("X.caret('donut', 1)")
    j0 = pg.evaluate("X.json('donut')")
    ins('메뉴'); time.sleep(1.2); ins('검증')
    j2 = pg.evaluate("X.json('donut')")
    pg.evaluate("X.caret('donut', 1)")
    j2b = pg.evaluate("X.json('donut')")
    M.ev("Menu.getApplicationMenu().getMenuItemById('undo').click(); return 1;"); time.sleep(0.3)
    j_u1 = pg.evaluate("X.json('donut')")
    check('U1 메뉴 "되돌리기" → 마지막 입력 한 단위만 취소("검증")', j_u1 != j2 and '메뉴' in pg.evaluate("X.text('donut')") and '메뉴검증' not in pg.evaluate("X.text('donut')"), pg.evaluate("X.text('donut')")[:30])
    pg.evaluate("document.activeElement.blur(); document.body.focus()")
    M.ev("Menu.getApplicationMenu().getMenuItemById('undo').click(); return 1;"); time.sleep(0.3)
    check('U2 편집기 밖에 포커스가 있어도 메뉴 되돌리기가 전역 스택에 닿음(입력 전 문서와 JSON 일치)', pg.evaluate("X.json('donut')") == j0)
    M.ev("const m = Menu.getApplicationMenu(); m.getMenuItemById('redo').click(); m.getMenuItemById('redo').click(); return 1;"); time.sleep(0.3)
    check('U3 메뉴 "다시 실행" 2회 → 입력 후 문서와 일치', pg.evaluate("X.json('donut')") == j2)
    # 조합 중 메뉴 되돌리기: 조합 글자를 확정한 뒤 되돌린다 → 조합 중이던 글자만 사라짐
    pg.evaluate("X.caret('donut', 1)"); time.sleep(1.2)
    jc = pg.evaluate("X.json('donut')")
    cdp.send('Input.imeSetComposition', {'text': '하', 'selectionStart': 1, 'selectionEnd': 1})
    comp = pg.evaluate("X.ed('donut').comp && X.ed('donut').comp.text")
    M.ev("Menu.getApplicationMenu().getMenuItemById('undo').click(); return 1;"); time.sleep(0.3)
    check('U4 조합 중(하) 메뉴 되돌리기 → 조합 확정 후 그 글자만 취소, 조합 상태 해제', comp == '하' and pg.evaluate("X.json('donut')") == jc and pg.evaluate("X.ed('donut').comp") is None,
          {'comp': comp, 'now': pg.evaluate("X.text('donut')")[:20]})
    pg.evaluate("X.ed('donut').input.value = ''")
    # 운영체제 편집 동작(webContents.undo = role:'undo'가 부르는 것) → beforeinput historyUndo → 전역 스택
    pg.evaluate("X.caret('donut', 1)"); time.sleep(1.2); ins('Q'); time.sleep(0.2)
    jq = pg.evaluate("X.json('donut')")
    M.ev("W.webContents.undo(); return 1;"); time.sleep(0.4)
    log = pg.evaluate("X.ed('donut').log.slice(-5)")
    check('U5 webContents.undo()(운영체제 편집 명령 경로) → historyUndo → 전역 스택으로 1단위', pg.evaluate("X.json('donut')") == jc and 'beforeinput:historyUndo' in log, log)
    # 메뉴 활성 상태 동기화
    pg.evaluate("while (__app.history.canUndo) __app.history.undo()")
    en = M.ev("const m = Menu.getApplicationMenu(); return [m.getMenuItemById('undo').enabled, m.getMenuItemById('redo').enabled];")
    pg.evaluate("while (__app.history.canRedo) __app.history.redo()")
    en2 = M.ev("const m = Menu.getApplicationMenu(); return [m.getMenuItemById('undo').enabled, m.getMenuItemById('redo').enabled];")
    check('U6 메뉴 항목 활성화가 전역 스택과 동기화(되돌릴 것 없음 → 비활성)', en == [False, True] and en2 == [True, False], {'allUndone': en, 'allRedone': en2})

    # ============ K. 실제 X11 키 입력(xdotool): 단축키가 한 번만 실행되는지 ============
    pg.evaluate("X.caret('donut', 1)"); time.sleep(1.2)
    k0 = pg.evaluate("X.json('donut')")
    ins('가'); time.sleep(1.2); ins('나')
    k2 = pg.evaluate("X.json('donut')")
    pg.evaluate("X.ed('donut').focus()")
    xkey('ctrl+z')
    t_after = pg.evaluate("X.text('donut')")
    check('K1 실제 Ctrl+Z 1회 → 정확히 1단위 취소("나"만)', t_after.startswith('가') and not t_after.startswith('가나'), t_after[:10])
    xkey('ctrl+shift+z')
    check('K2 실제 Ctrl+Shift+Z → 다시 실행 1단위', pg.evaluate("X.json('donut')") == k2)
    # 복사(굵게 적용한 단어) → 운영체제(X11) 클립보드 → 다른 프레임에 붙여넣기
    word = pg.evaluate("(() => { const m = X.text('invert').match(/[A-Za-z]{6,}/); return m && m[0]; })()") or '레이아웃'
    pg.evaluate(f"X.select('invert', {json.dumps(word)}); X.ed('invert').run('bold'); X.select('invert', {json.dumps(word)})")
    xkey('ctrl+c')
    html = M.ev("const items = await clipboard.read(); const it = items.find((i) => i.types.includes('text/html')); return it ? await (await it.getType('text/html')).text() : JSON.stringify(items.map((i) => i.types));")
    check('K3 실제 Ctrl+C → OS 클립보드에 HTML + 슬라이스 JSON(data-le-slice) 기록', html and 'data-le-slice' in html and word in html, (html or '')[:200])
    n0 = pg.evaluate(f"X.count('alpha', {json.dumps(word)})")
    pp = pg.evaluate("X.plainPos('alpha')"); pg.evaluate(f"X.caret('alpha', {pp})")
    xkey('ctrl+v'); time.sleep(0.4)
    n1 = pg.evaluate(f"X.count('alpha', {json.dumps(word)})")
    mk = pg.evaluate(f"X.marksAtPos('alpha', {pp} + 1)")
    check('K4 실제 Ctrl+V → 정확히 1회 붙여넣기, 굵게 유지(OS 클립보드를 거친 내부 슬라이스)', n1 == n0 + 1 and mk and 'bold' in mk, {'before': n0, 'after': n1, 'marks': mk})
    pg.evaluate(f"X.caret('alpha', {pp})")
    xkey('ctrl+shift+v'); time.sleep(0.4)
    n2 = pg.evaluate(f"X.count('alpha', {json.dumps(word)})")
    mk2 = pg.evaluate(f"X.marksAtPos('alpha', {pp} + 1)")
    check('K5 실제 Ctrl+Shift+V → 정확히 1회, 서식 없이(주변 글자의 꾸밈만, 굵게 없음)', n2 == n1 + 1 and mk2 == [], {'after': n2, 'marks': mk2})
    xkey('ctrl+a')
    sa = pg.evaluate("(() => { const s = X.ed('alpha').state.selection; return [s.from, s.to, X.ed('alpha').state.doc.content.size]; })()")
    check('K6 실제 Ctrl+A → 편집기 문서 전체 선택', sa[0] == 0 and sa[1] == sa[2], sa)
    # 메뉴 경로의 복사/붙여넣기/서식 없이 붙여넣기/전체 선택
    pg.evaluate(f"X.select('invert', {json.dumps(word)})")
    M.ev("Menu.getApplicationMenu().getMenuItemById('copy').click(undefined, W, W.webContents); return 1;"); time.sleep(0.3)
    cp = pg.evaluate("X.plainPos('colorKey')"); pg.evaluate(f"X.caret('colorKey', {cp})")
    c0 = pg.evaluate(f"X.count('colorKey', {json.dumps(word)})")
    M.ev("Menu.getApplicationMenu().getMenuItemById('paste').click(undefined, W, W.webContents); return 1;"); time.sleep(0.5)
    c1 = pg.evaluate(f"X.count('colorKey', {json.dumps(word)})")
    cm = pg.evaluate(f"X.marksAtPos('colorKey', {cp} + 1)")
    pg.evaluate(f"X.caret('colorKey', {cp})")
    M.ev("Menu.getApplicationMenu().getMenuItemById('pastePlain').click(undefined, W, W.webContents); return 1;"); time.sleep(0.5)
    c2 = pg.evaluate(f"X.count('colorKey', {json.dumps(word)})")
    cm2 = pg.evaluate(f"X.marksAtPos('colorKey', {cp} + 1)")
    check('K7 메뉴 복사 → 붙여넣기(굵게 유지) → 서식 없이 붙여넣기(꾸밈 없음), 각각 1회', c1 == c0 + 1 and 'bold' in cm and c2 == c1 + 1 and cm2 == [], {'counts': [c0, c1, c2], 'marks': [cm, cm2]})
    M.ev("Menu.getApplicationMenu().getMenuItemById('selectAll').click(undefined, W, W.webContents); return 1;"); time.sleep(0.2)
    sa2 = pg.evaluate("(() => { const s = X.ed('colorKey').state.selection; return [s.from, s.to, X.ed('colorKey').state.doc.content.size]; })()")
    check('K8 메뉴 "전체 선택" → 포커스된 편집기 문서 전체', sa2[0] == 0 and sa2[1] == sa2[2], sa2)
    pg.evaluate("while (__app.history.canUndo) __app.history.undo()")

    # ============ G. 시스템 글꼴(Local Font Access API) ============
    fl = pg.evaluate("""(async () => { const l = await __app.platform.listSystemFonts();
      const g = l.find((x) => x.family === 'DejaVu Serif') || l[0]; const face = g.faces[0];
      const b = new Uint8Array(await (await face.data.blob()).slice(0, 4).arrayBuffer());
      return { n: l.length, faces: l.reduce((a, x) => a + x.faces.length, 0), fams: l.map((x) => x.family), pick: g.family, ps: face.postscriptName, magic: [...b] }; })()""")
    magic_ok = bytes(fl['magic']) in (b'\x00\x01\x00\x00', b'OTTO', b'ttcf', b'true')
    metrics['system-fonts'] = {'families': fl['n'], 'faces': fl['faces']}
    check(f'G1 시스템 글꼴 목록: 글꼴 {fl["n"]}종(face {fl["faces"]}개), Noto Sans CJK KR 포함, 글꼴 파일 내용 읽기 가능(sfnt 헤더)',
          fl['n'] > 5 and any('Noto Sans CJK KR' == f for f in fl['fams']) and magic_ok, {k: fl[k] for k in ('n', 'pick', 'ps', 'magic')})
    lat = pg.evaluate("(() => { const m = X.text('invert').match(/[A-Za-z]{5,}/g); return m && m[m.length - 1]; })()")
    pg.evaluate("X.pin('invert')"); time.sleep(0.1)
    before_img = Image.open(io.BytesIO(pg.screenshot(clip={'x': 0, 'y': 0, 'width': 560, 'height': 560})))
    pg.evaluate(f"X.mark('invert', {json.dumps(lat)}, 'font', {{ value: '\"DejaVu Serif\"' }}); X.pin('invert')"); time.sleep(0.2)
    scr = Image.open(io.BytesIO(pg.screenshot(clip={'x': 0, 'y': 0, 'width': 560, 'height': 560})))
    out = img_from_dataurl(pg.evaluate("X.raster('invert', { scale: 1 })"))
    changed = compare(before_img, scr)
    m = compare(scr, out)
    check('G2 시스템 글꼴(DejaVu Serif) 적용 → 화면이 바뀌고, PNG 출력 = 화면(시스템 글꼴은 넣지 않아도 출력에 보임)', changed['pct16'] > 1 and same_as_screen(m), {'word': lat, 'changed': changed, 'export': m})
    pg.evaluate("X.unpin()")
    M.ev("globalThis.__chk = []; session.defaultSession.setPermissionRequestHandler((w, p, cb) => cb(false)); session.defaultSession.setPermissionCheckHandler((w, p) => { __chk.push(p); return false; }); return 1;")
    deny = pg.evaluate("(async () => { try { return (await __app.platform.listSystemFonts()).length; } catch (e) { return e.name; } })()")
    asked = M.ev("return __chk;")
    M.ev("M.hardenSession(session.defaultSession); return 1;")
    again = pg.evaluate("(async () => { try { return (await __app.platform.listSystemFonts()).length; } catch (e) { return e.name; } })()")
    check('G3 권한 처리기가 실제로 관여함(local-fonts 확인 요청): 거부하면 빈 목록(예외 아님), 되돌리면 다시 조회됨', deny == 0 and 'local-fonts' in asked and again == fl['n'], {'denied': deny, 'asked': asked, 'restored': again})
    # 데모의 버튼 경로
    pg.click('#sysFonts'); wait_js(pg, "document.getElementById('sysFontStatus').textContent.includes('개')")
    check('G4 데모 "시스템 글꼴 불러오기" 버튼 → 목록 채움', pg.evaluate("document.getElementById('sysFontPick').options.length") == fl['n'] + 1)

    # ============ T. 10단계: 보기 메뉴, 템플릿 보관함(app:// 출처), 이어진 글상자·경로 글자 출력 = 화면(Chromium 152) ============
    pg.goto('app://bundle/index.html')
    wait_js(pg, '!!(window.__nabi && window.__nabi.ready)', 30)
    time.sleep(0.5)
    if pg.evaluate("!!document.querySelector('.modal-bg')"): pg.evaluate("document.querySelector('.modal-bg button:last-child').click()")
    ids = M.ev("const m = Menu.getApplicationMenu(); return ['rulers', 'grid', 'guides'].map((id) => { const it = m.getMenuItemById(id); return it && [it.label, it.accelerator]; });")
    g0 = pg.evaluate("__nabi.view.showGrid")
    M.ev("Menu.getApplicationMenu().getMenuItemById('grid').click(); return 1;")
    wait_js(pg, f"__nabi.view.showGrid === {'false' if g0 else 'true'}", 10)
    M.ev("Menu.getApplicationMenu().getMenuItemById('grid').click(); return 1;")
    wait_js(pg, f"__nabi.view.showGrid === {'true' if g0 else 'false'}", 10)
    check('T1 보기 메뉴: 눈금자(Shift+R)·격자(Ctrl+\')·가이드(Ctrl+;) 항목, 메뉴 "격자" → 격자 켜고 끔', ids == [['눈금자', 'Shift+R'], ['격자', "CmdOrCtrl+'"], ['가이드', 'CmdOrCtrl+;']], ids)
    lp = pg.evaluate("""(async () => { const N = __nabi, V = N.view, M = N.M;
      N.app.project.pages = [M.newPage({ w: 700, h: 500 })]; N.app.current = null; N.app.switchPage(N.app.project.pages[0]); N.history.clear();
      const t = 'Electron 이어진 글상자 시험 문장입니다. 첫 글상자에서 넘친 글은 둘째 글상자로 흘러갑니다. '.repeat(3);
      const a = M.makeElement('text', { x: 30, y: 30, w: 280, h: 150, style: { fontSize: 18 }, doc: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: t }] }] } });
      const b = M.makeElement('text', { x: 360, y: 30, w: 300, h: 300, style: { fontSize: 18 } });
      const e = M.makeElement('shape', { shape: 'ellipse', x: 60, y: 260, w: 260, h: 180 });
      V.change('create', () => V.page.elements.push(a, b, e));
      V.linkFrames(a.id, b.id); V.select([e.id]); V.run('textOnPath');
      V.setProps({ text: '둥글게 도는 경로 글자' }, V.selection);
      V.select([]); V.setView(1, 30, 30);
      return { members: V.editorOf(V.node(a.id)).members.length, over: V.editorOf(V.node(a.id)).overflow }; })()""")
    time.sleep(0.4)
    pg.evaluate("__nabi.view.overlay.style.visibility = 'hidden'")
    rr = pg.evaluate("(() => { const r = __nabi.view.pageEl.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; })()")
    scr = Image.open(io.BytesIO(pg.screenshot(clip={'x': rr['x'], 'y': rr['y'], 'width': rr['w'], 'height': rr['h']})))
    pg.evaluate("__nabi.view.overlay.style.visibility = ''")
    ex_mod = pg.evaluate("(async () => { const X = await import('/src/export.js'); return (await X.rasterize(__nabi.view.exportPage(), { scale: 1 })).toDataURL(); })()")
    m = compare(scr, img_from_dataurl(ex_mod))
    metrics['electron-linked-pathtext'] = m
    check(f'T2 이어진 글상자 + 경로 글자 PNG 출력 = 화면(Chromium 152, 16 초과 {m.get("pct16")}%)', lp['members'] == 2 and lp['over'] is None and same_as_screen(m), {'lp': lp, 'm': m})
    tp = os.path.join(TMP, 'tpl')
    tr = pg.evaluate("""(async () => { const N = __nabi; N.app.promptText = async () => '전자 템플릿';
      const rec = await N.app.templates.saveFromPage(); const list = await N.app.templates.list();
      const n0 = N.app.project.pages.length; await N.app.templates.insert(rec.bytes);
      return { names: list.map((t) => t.name), pages: [n0, N.app.project.pages.length], thumb: !!rec.thumb, id: rec.id }; })()""")
    M.ev(f"__dlg.calls = []; __dlg.save.push({{ canceled: false, filePath: {json.dumps(tp + '.nabitpl')} }}); return 1;")
    pg.evaluate("(async () => { const N = __nabi; const [t] = await N.app.templates.list(); await N.app.templates.exportFile(t); })()")
    time.sleep(0.5)
    tpl_ok = os.path.exists(tp + '.nabitpl') and zipfile.is_zipfile(tp + '.nabitpl') and 'project.json' in zipfile.ZipFile(tp + '.nabitpl').namelist()
    pg.evaluate("(async () => { const N = __nabi; for (const t of await N.app.templates.list()) await N.app.templates.remove(t.id); })()")
    check('T3 템플릿 보관함(app:// 출처의 IndexedDB): 저장 → 목록 → 새 장, 네이티브 저장 창으로 .nabitpl 내보내기(zip)', (tr['names'] == ['전자 템플릿'] and tr['pages'] == [1, 2] and tr['thumb'] and tpl_ok), {'tr': tr, 'file': tpl_ok, 'calls': M.ev("return __dlg.calls;")})
    # ============ T4. 11단계: 단축키 재지정 → 메뉴에 보이는 단축키도 바뀜 ============
    pg.evaluate("""(async () => { const S = await import('/app/settings.js'); const N = __nabi; const s = S.loadSettings();
      s.keys.app = { 'Mod-Shift-e': 'export', 'Mod-e': null }; S.saveSettings(s);
      S.applySettings(s, { appKeymap: N.appKeymap, keymap: N.keymap, view: N.view, platform: N.platform }); })()""")
    time.sleep(0.5)
    acc1 = M.ev("return [Menu.getApplicationMenu().getMenuItemById('export').accelerator, Menu.getApplicationMenu().getMenuItemById('save').accelerator, Menu.getApplicationMenu().getMenuItemById('undo').enabled];")
    pg.evaluate("""(async () => { const S = await import('/app/settings.js'); const N = __nabi; const s = S.loadSettings(); s.keys.app = {}; S.saveSettings(s);
      S.applySettings(s, { appKeymap: N.appKeymap, keymap: N.keymap, view: N.view, platform: N.platform }); })()""")
    time.sleep(0.5)
    acc2 = M.ev("return Menu.getApplicationMenu().getMenuItemById('export').accelerator;")
    check('T4 설정에서 내보내기 단축키를 Ctrl+Shift+E로 바꾸면 Electron 메뉴 표시도 바뀌고(저장은 그대로), 기본값으로 되돌리면 Ctrl+E', acc1[0] == 'CmdOrCtrl+Shift+E' and acc1[1] == 'CmdOrCtrl+S' and acc2 == 'CmdOrCtrl+E', [acc1, acc2])
    # ============ N. 프로젝트 파일(8단계): 네이티브 저장·열기, 파일 연결, 비정상 종료 복구 ============
    M.ev("dialog.showMessageBoxSync = (w, o) => { __dlg.calls.push({ t: 'boxSync', o }); return __dlg.boxSync.shift() ?? 2; }; __dlg.boxSync = []; return 1;")
    pg.goto('app://bundle/index.html')
    wait_js(pg, '!!(window.__nabi && window.__nabi.ready)', 30)
    time.sleep(0.5)
    if pg.evaluate("!!document.querySelector('.modal-bg')"): pg.evaluate("document.querySelector('.modal-bg button:last-child').click()")
    projp = os.path.join(TMP, 'proj')
    pg.evaluate("""(() => { const V = __nabi.view, M = __nabi.M; const n = M.makeElement('text', { x: 100, y: 100, w: 500, h: 120, doc: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: '저장 시험 글' }] }] } }); V.change('create', () => V.page.elements.push(n)); window.__tid = n.id; })()""")
    M.ev(f"__dlg.calls = []; __dlg.save.push({{ canceled: false, filePath: {json.dumps(projp)} }}); return 1;")
    pg.focus('.pv-viewport'); pg.keyboard.press('Control+s')
    wait_js(pg, "!document.title.startsWith('●') && document.title.startsWith('proj')", 20)
    calls = M.ev("return __dlg.calls;")
    saved_ok = os.path.exists(projp + '.nabi') and zipfile.is_zipfile(projp + '.nabi') and 'project.json' in zipfile.ZipFile(projp + '.nabi').namelist()
    check('N1 Ctrl+S → 저장 창(파일 형식 .nabi, 기본 이름 "제목 없음.nabi"), .nabi 자동으로 붙여 zip 저장, 제목 = 파일 이름·● 없음',
          saved_ok and [c['t'] for c in calls] == ['save'] and calls[0]['o']['filters'][0]['extensions'] == ['nabi'] and calls[0]['o']['defaultPath'].endswith('제목 없음.nabi'), {'calls': calls, 'title': pg.evaluate("document.title")})
    mt = os.stat(projp + '.nabi').st_mtime_ns
    pg.evaluate("(() => { const V = __nabi.view; V.select([__tid]); V.nudge(7, 0); })()")
    time.sleep(0.05)
    M.ev("__dlg.calls = []; return 1;")
    pg.keyboard.press('Control+s')
    wait_js(pg, "!document.title.startsWith('●')", 20)
    check('N2 두 번째 Ctrl+S → 창 없이 같은 파일에 덮어씀', M.ev("return __dlg.calls.length;") == 0 and os.stat(projp + '.nabi').st_mtime_ns != mt)
    evil = os.path.join(TMP, 'evil.nabi')
    r = pg.evaluate(f"window.native.saveProject(new Uint8Array([1, 2, 3]), {{ path: {json.dumps(evil)}, name: 'x.nabi' }})")
    check('N3 렌더러가 허가받지 않은 경로를 주면 쓰지 않고 저장 창으로(취소 → 파일 없음)', r['mode'] == 'cancelled' and not os.path.exists(evil), r)
    shutil.copy(projp + '.nabi', os.path.join(TMP, '둘째.nabi'))
    M.ev(f"__dlg.open.push({{ canceled: false, filePaths: [{json.dumps(os.path.join(TMP, '둘째.nabi'))}] }}); return 1;")
    pg.keyboard.press('Control+o')
    wait_js(pg, "__nabi.app.project.name === '둘째'", 20)
    txt = pg.evaluate("[...__nabi.view.editors.values()].map((e) => e.text)")
    check('N4 Ctrl+O → 열기 창 → 파일 내용 복원(글·위치), 프로젝트 이름 = 파일 이름', txt == ['저장 시험 글'] and pg.evaluate("__nabi.view.page.elements[0].x") == 107, txt)
    M.ev(f"M.sendOpen({json.dumps(projp + '.nabi')}); return 1;")
    wait_js(pg, "__nabi.app.project.name === 'proj'", 20)
    check('N5 실행 중 .nabi 더블클릭(두 번째 실행 인자 → 기존 창으로 전달) → 그 파일을 엶', pg.evaluate("__nabi.app.project.name") == 'proj')
    # 비정상 종료 복구: 변경 → 자동 저장 → 화면 프로세스 강제 종료 → 다시 불러옴 → 복구 확인 창
    pg.evaluate("(() => { const V = __nabi.view, M = __nabi.M; const n = M.makeElement('shape', { x: 300, y: 300, w: 222, h: 111, fill: '#e07a5f' }); V.change('create', () => V.page.elements.push(n)); })()")
    time.sleep(2.8)
    before = pg.evaluate("__nabi.view.page.elements.map((n) => [n.type, n.x, n.w])")
    M.ev("__dlg.box.push(0); W.webContents.forcefullyCrashRenderer(); return 1;")
    time.sleep(3)
    b.close()
    b = p.chromium.connect_over_cdp(f'http://127.0.0.1:{RPORT}')
    pg = next(x for c in b.contexts for x in c.pages if x.url.startswith('app://bundle/'))
    wait_js(pg, "!!document.querySelector('.modal-bg')", 30)
    mtext = pg.evaluate("document.querySelector('.modal-bg p').textContent")
    pg.evaluate("[...document.querySelectorAll('.modal-bg button')].find((b) => b.textContent === '복구').click()")
    wait_js(pg, "__nabi.view.page.elements.length === 2", 20)
    after = pg.evaluate("__nabi.view.page.elements.map((n) => [n.type, n.x, n.w])")
    gone_box = [c for c in M.ev("return __dlg.calls;") if c['t'] == 'box']
    check('N6 화면 프로세스 강제 종료 → 알림 후 다시 불러옴 → "저장하지 않은 작업" 복구 → 종료 직전 요소 그대로(아직 저장 안 됨 ●)',
          '저장하지 않은 작업' in mtext and after == before and pg.evaluate("document.title.startsWith('●')") and any('비정상 종료' in c['o'].get('message', '') for c in gone_box), {'before': before, 'after': after})
    pg.goto('app://bundle/demo.html')
    wait_js(pg, '!!(window.__app && window.__app.ready)', 30)
    pg.evaluate(JS)

    # ============ P. 속도 ============
    for s in [1, 2]:
        t0 = time.time(); pg.evaluate(f"X.raster('donut', {{ scale: {s} }})"); metrics[f'time/png-{s}x-ms'] = round((time.time() - t0) * 1000)
    pg.evaluate("window.__stay = 1; setTimeout(() => { location.href = 'https://example.com/'; }, 0)")
    time.sleep(1.0)
    check('S4 앱 밖 주소로 이동 금지(페이지 그대로)', pg.evaluate("location.href === 'app://bundle/demo.html' && window.__stay === 1"))
    late = [e for e in errors if 'fonts.googleapis' not in e and 'ERR_' not in e]
    check('Z 검증 전체 동안 페이지 오류 없음', not late, late)
    # 닫기 확인(창이 닫히므로 마지막): 저장 안 한 변경 표시 → 닫기 → 취소면 그대로, 저장하지 않음이면 닫힘
    # 편집기 화면(index.html)을 다시 띄운다(저장하지 않음 → 렌더러가 복구 사본을 지우고 창을 닫는 경로까지 확인)
    M.ev("await W.loadURL('app://bundle/index.html'); await new Promise((r) => setTimeout(r, 2500)); return 1;")
    M.ev("W.dirty = true; __dlg.calls = []; __dlg.boxSync = [2]; W.close(); return 1;")
    time.sleep(0.5)
    still = M.ev("return { n: BrowserWindow.getAllWindows().length, calls: __dlg.calls.map((c) => [c.t, c.o.buttons]) };")
    M.ev("__dlg.boxSync = [1]; W.close(); return 1;")
    time.sleep(1.0)
    try: closed = M.ev("return BrowserWindow.getAllWindows().length;")
    except Exception: closed = 0  # 마지막 창이 닫혀 앱이 끝남
    try: b.close()
    except Exception: pass
    check('N7 저장 안 한 변경이 있으면 창 닫기 전에 확인(저장/저장하지 않음/취소) → 취소 = 그대로, 저장하지 않음 = 닫힘', still['n'] == 1 and still['calls'] == [['boxSync', ['저장', '저장하지 않음', '취소']]] and closed == 0, {'still': still, 'closed': closed})
finally:
    stop(proc)

# ============ D. 패키징된 앱(npm run dist:dir 결과) ============
if os.path.exists(PACKAGED):
    res = os.path.join(os.path.dirname(PACKAGED), 'resources')
    check('D1 패키지: resources/app.asar만 있음(풀린 app 폴더 없음)', os.path.exists(os.path.join(res, 'app.asar')) and not os.path.exists(os.path.join(res, 'app')), os.listdir(res))
    proc, RPORT, IPORT = launch(PACKAGED, None, inspect=True)
    try:
        time.sleep(1)
        insp = True
        try: urllib.request.urlopen(f'http://127.0.0.1:{IPORT}/json/list', timeout=1)
        except Exception: insp = False
        check('D2 퓨즈: 패키지는 --inspect(Node 검사기)를 무시함', not insp)
        with sync_playwright() as p:
            b = p.chromium.connect_over_cdp(f'http://127.0.0.1:{RPORT}')
            pg = next(x for c in b.contexts for x in c.pages if x.url.startswith('app://bundle/'))
            wait_js(pg, '!!(window.__nabi && window.__nabi.ready)', 30)
            ptitle = pg.evaluate("document.title")
            pg.goto('app://bundle/demo.html')
            wait_js(pg, '!!(window.__app && window.__app.ready)', 30)
            pg.evaluate(JS)
            k = pg.evaluate("({ kind: __app.platform.kind, secure: isSecureContext, main: 0 })"); k['title'] = ptitle
            st = pg.evaluate("(async () => [(await fetch('/electron/main.js')).status, (await fetch('/src/editor.js')).status])()")
            pg.evaluate("X.pin('donut')"); time.sleep(0.2)
            scr = Image.open(io.BytesIO(pg.screenshot(clip={'x': 0, 'y': 0, 'width': 560, 'height': 560})))
            m = compare(scr, img_from_dataurl(pg.evaluate("X.raster('donut', { scale: 1 })")))
            check('D3 패키지 실행: 편집기 화면으로 시작, asar에서 app:// 로드, Electron 모드, PNG 출력 = 화면, electron/ 비공개', k['title'].endswith('나비글쓰기') and k['kind'] == 'electron' and k['secure'] and st == [404, 200] and same_as_screen(m), {'k': k, 'status': st, 'png': m})
            b.close()
    finally:
        stop(proc)
    # ELECTRON_RUN_AS_NODE: 퓨즈가 꺼져 있으면 Node로 동작하지 않고 앱이 뜬다 → 몇 초 뒤 종료하고 출력 확인
    pr = subprocess.Popen([PACKAGED, '--no-sandbox', '-e', 'console.log("NODE_MODE_" + 1)'], env={**ENV, 'ELECTRON_RUN_AS_NODE': '1'},
                          stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, start_new_session=True)
    time.sleep(4); stop(pr)
    o = pr.stdout.read()
    check('D4 퓨즈: ELECTRON_RUN_AS_NODE=1이어도 Node로 동작하지 않음', 'NODE_MODE_1' not in o, o[-300:])
    # ============ U. 자동 업데이트(패키지) ============
    import hashlib, http.server as HS
    UPD = os.path.join(TMP, 'upd'); os.makedirs(UPD)
    blob = os.urandom(300000)
    open(os.path.join(UPD, 'Nabitext-99.0.0.AppImage'), 'wb').write(blob)
    sha = base64.b64encode(hashlib.sha512(blob).digest()).decode()
    def feed(ver):
        open(os.path.join(UPD, 'latest-linux.yml'), 'w').write(f"version: {ver}\nfiles:\n  - url: Nabitext-99.0.0.AppImage\n    sha512: {sha}\n    size: {len(blob)}\npath: Nabitext-99.0.0.AppImage\nsha512: {sha}\nreleaseDate: '2026-09-30T00:00:00.000Z'\n")
    class Q(HS.SimpleHTTPRequestHandler):
        def log_message(self, *a): pass
    usrv = HS.ThreadingHTTPServer(('127.0.0.1', 0), functools.partial(Q, directory=UPD))
    threading.Thread(target=usrv.serve_forever, daemon=True).start()
    fake_img = os.path.join(TMP, 'Nabitext-current.AppImage'); open(fake_img, 'wb').write(b'old')
    APPVER = json.load(open(os.path.join(ROOT, 'package.json')))['version']
    def upd_run(extra, fn):
        shutil.rmtree(os.path.join(HOME, '.cache', 'nabitext-updater'), ignore_errors=True) # 앞 시험에서 받아 둔 파일을 쓰지 않게
        pr_, rp, _ = launch(PACKAGED, None, inspect=False, env=extra)
        try:
            with sync_playwright() as p:
                b = p.chromium.connect_over_cdp(f'http://127.0.0.1:{rp}')
                pg = next(x for c in b.contexts for x in c.pages if x.url.startswith('app://bundle/'))
                wait_js(pg, '!!(window.__nabi && window.__nabi.ready)', 30)
                if pg.evaluate("!!document.querySelector('.modal-bg')"): pg.click('.modal-bg [data-v=discard]')
                r = fn(pg)
                b.close()
                return r
        finally:
            stop(pr_)
    st0 = upd_run({}, lambda pg: pg.evaluate("window.native.updates.state()"))
    check('U1 업데이트 주소가 없는 설치 파일 → 자동 업데이트 꺼짐(까닭 표시), 다른 동작은 그대로', st0['status'] == 'off' and '업데이트 주소' in st0['reason'] and st0['version'] == APPVER, st0)
    feed('99.0.0')
    def newer(pg):
        pg.evaluate("window.native.updates.check()")
        for _ in range(120):
            st = pg.evaluate("window.native.updates.state()")
            if st['status'] in ('ready', 'error') and pg.evaluate("!!document.querySelector('.upd-toast') || true"): break
            time.sleep(0.25)
        if st['status'] != 'ready': return {'st': st, 'toast': '', 'line': '', 'btn': False}
        time.sleep(0.3)
        toast = pg.evaluate("document.querySelector('.upd-toast').textContent")
        pg.click('#settings'); time.sleep(0.3)
        line = pg.evaluate("document.querySelector('.settings [data-upd]').textContent")
        btn = pg.evaluate("!!document.querySelector('.settings [data-updinstall]')")
        return {'st': st, 'toast': toast, 'line': line, 'btn': btn}
    rn = upd_run({'NABITEXT_UPDATE_URL': f'http://127.0.0.1:{usrv.server_port}/', 'APPIMAGE': fake_img}, newer)
    check('U2 새 버전(99.0.0)이 있으면 내려받고(해시 확인) "준비됨" 알림 + 설정 창에 상태·"다시 시작해서 업데이트"', rn['st']['status'] == 'ready' and rn['st']['next'] == '99.0.0' and '99.0.0' in rn['toast'] and '준비됨' in rn['line'] and rn['btn'], rn)
    feed(APPVER)
    rl = upd_run({'NABITEXT_UPDATE_URL': f'http://127.0.0.1:{usrv.server_port}/', 'APPIMAGE': fake_img}, lambda pg: pg.evaluate("window.native.updates.check()"))
    check('U3 같은 버전이면 "최신 버전"', rl['status'] == 'latest', rl)
    # 해시가 틀린 파일은 받지 않음
    feed('99.0.1'); open(os.path.join(UPD, 'Nabitext-99.0.0.AppImage'), 'wb').write(blob[:-1] + b'x')
    def bad(pg):
        pg.evaluate("window.native.updates.check()")
        for _ in range(60):
            st = pg.evaluate("window.native.updates.state()")
            if st['status'] in ('error', 'ready'): return st
            time.sleep(0.25)
        return st
    rb = upd_run({'NABITEXT_UPDATE_URL': f'http://127.0.0.1:{usrv.server_port}/', 'APPIMAGE': fake_img}, bad)
    check('U4 내려받은 파일의 해시가 맞지 않으면 설치 준비하지 않음(오류 표시)', rb['status'] == 'error', rb)
    usrv.shutdown()
else:
    print('(dist/linux-unpacked 없음: 패키지 검사 건너뜀 — npm run dist:dir 후 다시 실행)')

xvfb.kill()
json.dump(metrics, open(os.path.join(OUT, 'electron-metrics.json'), 'w'), ensure_ascii=False, indent=1)
fails = [r for r in results if not r[1]]
for name, ok, detail in results:
    print(('PASS ' if ok else 'FAIL ') + name + ('' if ok else '  ' + json.dumps(detail, ensure_ascii=False, default=str)[:900]))
print('metrics:', json.dumps(metrics, ensure_ascii=False))
print(f'{len(results) - len(fails)}/{len(results)} passed')
