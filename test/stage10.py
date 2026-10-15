"""10단계 검증: 이어진 글상자(글 흐름), 자동 축소, 스타일 프리셋, 눈금자·가이드·격자, 균등 간격 스냅, 템플릿(슬롯).
사용: python3 test/stage10.py  (proto 폴더 기준)
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
    fontSizes: (id) => [...new Set(T.ed(id).results.flatMap((r) => r.lines.flatMap((l) => l.pieces.map((p) => Math.round(p.style.fontSize * 1000) / 1000))))],
  };
  return true;
})()
"""
LONG = '이어지는 글상자 시험 문장입니다. 첫 글상자에 다 들어가지 못한 글은 다음 글상자로 흘러가야 하고, 글자가 빠지거나 겹치면 안 됩니다. Linked frames flow test. ' * 3

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
    def export_vs_screen(tag):
        E("T.V.select([]); T.V.setView(1, 30, 30); T.V.overlay.style.visibility = 'hidden'")
        mouse.move(5, 995); time.sleep(0.25)
        rr = E("(() => { const r = T.V.pageEl.getBoundingClientRect(), v = T.V.viewport.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height, fits: r.right <= v.right && r.bottom <= v.bottom }; })()")
        assert rr['fits'], f'{tag}: 장이 화면 영역보다 큼 {rr}'
        scr = Image.open(io.BytesIO(pg.screenshot(clip={'x': rr['x'], 'y': rr['y'], 'width': rr['w'], 'height': rr['h']})))
        E("T.V.overlay.style.visibility = ''")
        out = img(E("T.raster()"))
        m = compare(scr, out)
        metrics[f'export/{tag}'] = m
        scr.save(os.path.join(OUT, f'stage10-{tag}-screen.png')); out.save(os.path.join(OUT, f'stage10-{tag}-export.png'))
        return m

    # ============ A. 이어진 글상자 ============
    E("T.reset()")
    a = E(f"T.add('text', {{ x: 40, y: 40, w: 300, h: 180, style: {{ fontSize: 20 }}, doc: T.longDoc({json.dumps(LONG)}) }})")
    bb = E("T.add('text', { x: 420, y: 40, w: 300, h: 420, style: { fontSize: 20 } })")
    E(f"T.V.select(['{a}'])")
    over0 = E(f"T.ed('{a}').overflow")
    port = E(f"T.port('{a}')")
    click(port)
    linking = E("!!T.V.linking")
    click(E(f"T.L('{bb}', 150, 100)"))
    gb = E(f"T.el('{bb}')")
    placed = E(f"T.placed('{a}')")
    src = ''.join(LONG.split())
    vc = E(f"T.verifyChain('{a}')")
    check('A1 넘친 글상자 출구(빨간 +) 클릭 → 잇기 모드 → 다른 글상자 클릭 = 이어짐. 두 글상자에 나눠 담긴 글을 이으면 원문 그대로(빠짐·겹침 없음), 두 글상자 모두 영역 밖 0',
          over0 is not None and linking and gb['story'] == a and gb['seq'] == 1 and ''.join(placed) == src and E(f"T.ed('{a}').overflow") is None
          and all(v['outside'] == 0 and v['overrun'] == 0 for v in vc) and len(placed[1]) > 0, {'placed_len': [len(x) for x in placed], 'src': len(src), 'vc': vc})
    check('A2 DOM 글자 위치 = 엔진 계산(두 글상자 모두 ±0.05px)', all(v['dx'] < 0.05 and v['dy'] < 0.05 for v in vc), vc)
    # 두 번째 글상자 안을 더블클릭 → 편집 모드, 커서가 그 글상자 첫 줄에
    first_b = E(f"(() => {{ const r = T.ed('{a}').results[1].lines[0]; return {{ from: r.from, x: r.pieces[0].x, y: r.y + r.h / 2 }}; }})()")
    click(E(f"T.L('{bb}', 1, {first_b['y']})"), count=2)
    ed_state = E(f"(() => {{ const ed = T.ed('{a}'); return {{ editing: T.V.editing, head: ed.state.selection.head, view: ed.caret && ed.caret.view, focus: document.activeElement === ed.input }}; }})()")
    check('A3 이어진 둘째 글상자 더블클릭 → 편집 모드, 커서가 둘째 글상자 첫 글자 앞(문서 위치 = 둘째 글상자 첫 줄 시작)',
          ed_state['editing'] == bb and ed_state['head'] == first_b['from'] and ed_state['view'] == 1 and ed_state['focus'], {'st': ed_state, 'want': first_b})
    cdp.send('Input.imeSetComposition', {'text': 'ㄴ', 'selectionStart': 1, 'selectionEnd': 1})
    cdp.send('Input.imeSetComposition', {'text': '나', 'selectionStart': 1, 'selectionEnd': 1})
    ta = E(f"""(() => {{ const ed = T.ed('{a}'); const r = ed.input.getBoundingClientRect(); const c = ed.caret; const cl = T.L('{bb}', c.x, c.top + c.h / 2); return {{ tx: r.left, ty: r.top + r.height / 2, cx: cl.x, cy: cl.y, view: c.view }}; }})()""")
    cdp.send('Input.insertText', {'text': '나'})
    txt = E(f"T.text('{a}')")
    head = E(f"T.ed('{a}').state.selection.head")
    check('A4 둘째 글상자에서 한글 조합: 숨긴 입력창이 둘째 글상자 커서 자리(IME 후보창 위치 ±3px), 확정하면 그 자리에 들어감',
          ta['view'] == 1 and math.dist((ta['tx'], ta['ty']), (ta['cx'], ta['cy'])) < 3 and txt.replace('\n', '')[first_b['from'] - 1] == '나' and head == first_b['from'] + 1, ta)
    kb.press('Control+z')
    back_txt = E(f"T.text('{a}')")
    check('A5 되돌리기 → 입력 전 글', back_txt.replace('\n', '') == LONG.rstrip() or back_txt == LONG or back_txt.strip() == LONG.strip(), back_txt[:40])
    # 첫 글상자 마지막 줄에서 ↓ → 둘째 글상자 첫 줄
    last_a = E(f"(() => {{ const ls = T.ed('{a}').results[0].lines; const l = ls[ls.length - 1]; return {{ x: l.pieces[0].x + 5, y: l.y + l.h / 2 }}; }})()")
    click(E(f"T.L('{a}', {last_a['x']}, {last_a['y']})"))
    kb.press('ArrowDown')
    v_after = E(f"T.ed('{a}').caret.view")
    head2 = E(f"T.ed('{a}').state.selection.head")
    b_line = E(f"(() => {{ const l = T.ed('{a}').results[1].lines[0]; return [l.from, l.to]; }})()")
    check('A6 첫 글상자 마지막 줄에서 ↓ → 커서가 둘째 글상자 첫 줄로', v_after == 1 and b_line[0] <= head2 <= b_line[1], [v_after, head2, b_line])
    # 첫 글상자 중간부터 둘째 글상자까지 끌어 선택
    drag(E(f"T.L('{a}', 20, 30)"), E(f"T.L('{bb}', 100, 50)"))
    sel = E(f"(() => {{ const ed = T.ed('{a}'); const s = ed.state.selection; return {{ from: s.from, to: s.to, n0: ed.overlay.querySelectorAll('.ce-sel').length, n1: ed.more[0].overlay.querySelectorAll('.ce-sel').length }}; }})()")
    check('A7 첫 글상자에서 둘째 글상자까지 끌어 선택 → 선택이 두 글상자에 걸쳐 표시', sel['to'] > b_line[0] and sel['n0'] > 0 and sel['n1'] > 0, sel)
    kb.press('Escape')
    # 출구 → 빈 곳 클릭 = 같은 크기 새 글상자로 이어짐
    E(f"T.V.setProps({{ w: 300, h: 120 }}, ['{bb}'])")
    E(f"T.V.select(['{bb}'])")
    n_hist = E("__nabi.history.done.length")
    click(E(f"T.port('{bb}')"))
    click(E("T.C(420, 360)"))
    p3 = E("T.P(T.lastDown())")
    ids3 = E("T.ids()")
    c3 = ids3[-1]
    g3 = E(f"T.el('{c3}')")
    members = E(f"T.ed('{a}').members")
    check('A8 둘째 글상자의 출구 → 빈 곳 클릭 = 같은 크기(300×120) 새 글상자가 만들어져 셋째로 이어짐, 되돌리기 한 단위',
          len(ids3) == 3 and members == [a, bb, c3] and close(g3['w'], 300) and close(g3['h'], 120) and close(g3['x'], p3['x'], 0.001) and close(g3['y'], p3['y'], 0.001)
          and E("__nabi.history.done.length") == n_hist + 1, {'members': members, 'g3': {k: g3[k] for k in ('x', 'y', 'w', 'h')}})
    m = export_vs_screen('linked')
    check(f'A9 이어진 글상자 3개 출력 = 화면 (16 초과 {m.get("pct16")}%)', same_as_screen(m), m)
    # 가운데 글상자 빼기
    E(f"T.V.select(['{bb}'])")
    ok_btn = E("T.btn('이어짐에서 빼기')")
    placed2 = E(f"T.placed('{a}')")
    check('A10 가운데 글상자 "이어짐에서 빼기" → 빈 글상자로 남고, 글은 첫째 → 셋째로 이어짐(원문 그대로 이어서)',
          ok_btn and E(f"T.ed('{a}').members") == [a, c3] and E(f"T.text('{bb}')") == '' and src.startswith(''.join(placed2)) and len(placed2) == 2, [len(x) for x in placed2])
    E("__nabi.history.undo()")
    check('A11 되돌리기 → 다시 세 글상자로 이어짐', E(f"T.ed('{a}').members") == [a, bb, c3], E(f"T.ed('{a}').members"))
    # 첫 글상자 지우기 → 글은 둘째부터 처음부터
    E(f"T.V.select(['{a}'])"); kb.press('Delete')
    ed2 = E(f"(() => {{ const ed = T.V.editors.get('{a}'); return {{ members: ed.members, first: ed.results[0].lines[0].pieces.map((p) => p.text).join('') }}; }})()")
    check('A12 첫 글상자 지우기 → 남은 글상자가 글을 처음부터 이어 받음(글은 지워지지 않음)', ed2['members'] == [bb, c3] and LONG.startswith(ed2['first'].strip()) and len(ed2['first']) > 3, ed2)
    E("__nabi.history.undo()")
    check('A13 되돌리기 → 첫 글상자 복원, 세 글상자로 이어짐', E(f"T.ed('{a}').members") == [a, bb, c3])
    # 두 글상자 선택 → "글상자 잇기"(뒤 글상자 글은 이야기 끝으로)
    d = E("T.add('text', { x: 740, y: 40, w: 140, h: 200, style: { fontSize: 16 }, doc: T.longDoc('따로 있던 글') })")
    E(f"T.V.select(['{c3}', '{d}'])")
    ok = E("T.btn('글상자 잇기')")
    t_all = E(f"T.text('{a}')")
    check('A14 글상자 두 개 선택 → "글상자 잇기": 넷째로 이어지고, 넷째에 있던 글은 이야기 끝에 붙음', ok and E(f"T.ed('{a}').members") == [a, bb, c3, d] and t_all.endswith('따로 있던 글'), t_all[-20:])
    E("__nabi.history.undo()")
    check('A15 되돌리기 한 번 → 잇기 전(넷째 글상자는 따로, 제 글 그대로, 이야기 글에서도 빠짐)', E(f"T.ed('{a}').members") == [a, bb, c3] and E(f"T.text('{d}')") == '따로 있던 글' and not E(f"T.text('{a}')").endswith('따로 있던 글'))
    # 복제: 이어진 글상자 셋을 함께 복제 → 새 이야기로 이어짐
    E(f"T.V.select(['{a}', '{bb}', '{c3}'])"); kb.press('Control+d')
    cp = E("T.V.selection")
    cped = E(f"(() => {{ const ed = T.V.editorOf(T.V.node('{cp[0]}')); return {{ members: ed.members, sid: ed.storyId, same: ed === T.ed('{a}') }}; }})()")
    check('A16 이어진 글상자 셋을 함께 복제(Ctrl+D) → 복사본 셋이 새 이야기로 이어짐(원본과 별개)', cped['members'] == cp and not cped['same'], cped)
    E("__nabi.history.undo()")
    # 저장 → 다른 창에서 열기
    E("(() => { const pg = T.V.page; T.V.select([]); })()")
    j0 = E("(async () => { const { bytes } = await __nabi.P.toZip(__nabi.app.project, { assets: __nabi.assets, docOf: T.V.docOf, swatches: [] }); window.__zip = Array.from(bytes); return JSON.parse(await T.snap()); })()")
    els = j0['pages'][0]['elements']
    docs = {e['id']: ('doc' in e) for e in els}
    zipb = E("window.__zip")
    pg2 = open_page()
    pg2.evaluate("(z) => __nabi.openBytes(new Uint8Array(z), null, 'linked.nabi')", zipb)
    j1 = json.loads(pg2.evaluate("T.snap()"))
    l0 = E(f"T.ed('{a}').results.map((r) => r.lines.map((l) => [l.from, l.to, Math.round(l.y * 100)]))")
    l1 = pg2.evaluate(f"T.ed('{a}').results.map((r) => r.lines.map((l) => [l.from, l.to, Math.round(l.y * 100)]))")
    pg2.close()
    check('A17 저장 파일: 이야기의 첫 글상자만 문서를 가짐, 다른 창에서 열기 → JSON·글상자별 줄 배치 일치',
          docs[a] and not docs[bb] and not docs[c3] and j0['pages'] == j1['pages'] and l0 == l1, {'docs': docs})
    # 회전한 둘째 글상자 안 클릭 → 그 자리 글자 경계
    E(f"T.V.setProps({{ rotation: 20 }}, ['{bb}'])")
    E(f"T.V.select(['{bb}'])"); kb.press('Enter')
    pts = E(f"(() => {{ const ed = T.ed('{a}'); const r = ed.results[1]; const out = []; for (const l of r.lines.slice(0, 4)) for (const pc of l.pieces.filter((q) => !q.space && q.x > 3).slice(0, 2)) out.push({{ pos: pc.from, x: pc.x + 1.5, y: l.y + l.h / 2 }}); return out; }})()")
    hits = []
    for q in pts:
        click(E(f"T.L('{bb}', {q['x']}, {q['y']})"))
        hits.append([q['pos'], E(f"T.ed('{a}').state.selection.head")])
    check(f'A18 20° 회전한 둘째 글상자: 글자 앞 {len(hits)}곳 클릭 → 그 위치에 커서', len(hits) >= 5 and all(x == y for x, y in hits), hits)
    kb.press('Escape')

    # ============ B. 자동 축소 ============
    E("T.reset()")
    t = E(f"T.add('text', {{ x: 40, y: 40, w: 300, h: 220, style: {{ fontSize: 24 }}, doc: T.longDoc({json.dumps(LONG)}) }})")
    E(f"T.V.select(['{t}'])")
    click(E("T.field('넘치면 글자 줄이기')"))
    sc = E(f"T.ed('{t}').scale")
    fs = E(f"T.fontSizes('{t}')")
    pl = E(f"T.placed('{t}')")
    vb = E(f"T.verifyChain('{t}')")
    check(f'B1 "넘치면 글자 줄이기" → 글자 {round(sc * 100, 1)}%로 줄여 다 들어감(넘침 없음, 원문 그대로, 모양 밖 0), 모든 글자 크기 = 24 × 배율',
          E(f"T.el('{t}').autoShrink") and 0.5 <= sc < 1 and E(f"T.ed('{t}').overflow") is None and ''.join(pl) == src and len(fs) == 1 and close(fs[0], 24 * sc, 0.002) and vb[0]['outside'] == 0, {'scale': sc, 'fs': fs})
    sc_up = E(f"(() => {{ const ed = T.ed('{t}'); const s = ed.scale; T.V.setProps({{ h: 280 }}, ['{t}']); return [s, ed.scale]; }})()")
    check('B2 글상자를 키우면 배율도 커짐', sc_up[1] > sc_up[0] and E(f"T.ed('{t}').overflow") is None, sc_up)
    set_min = E("T.field('최소')"); click(set_min); kb.press('Control+a'); kb.type('90'); kb.press('Enter')
    check('B3 최소 90% → 90%에서 멈추고 남은 글은 넘침 표시', close(E(f"T.ed('{t}').scale"), 0.9, 1e-9) and E(f"T.ed('{t}').overflow") is not None and E(f"!!T.V.overlay.querySelector('[data-overflow=\"{t}\"]')"))
    E(f"T.V.setProps({{ minScale: 0.5 }}, ['{t}'])")
    m = export_vs_screen('shrink')
    check(f'B4 자동 축소 출력 = 화면 ({m.get("pct16")}%)', same_as_screen(m), m)
    # 입력으로 글이 늘면 더 줄고, 지우면 다시 커짐
    E(f"T.V.select(['{t}'])"); kb.press('Enter')
    s0 = E(f"T.ed('{t}').scale")
    kb.insert_text(' 더 많은 글자를 넣으면 더 작아져야 합니다.' * 2)
    s1 = E(f"T.ed('{t}').scale")
    for _ in range(3): kb.press('Control+z')
    s2 = E(f"T.ed('{t}').scale")
    check('B5 편집 중 글이 늘면 배율이 줄고, 되돌리면 원래 배율', s1 < s0 and close(s2, s0, 1e-9), [s0, s1, s2])
    kb.press('Escape')
    # 이어진 글상자 전체에 자동 축소
    t2 = E("T.add('text', { x: 400, y: 40, w: 300, h: 100, style: { fontSize: 24 } })")
    E(f"T.V.linkFrames('{t}', '{t2}')")
    sc2 = E(f"T.ed('{t}').scale")
    check('B6 이어진 글상자: 둘째까지 쓰고 모자랄 때만 줄임(배율이 한 글상자일 때보다 큼), 두 글상자 글자 크기 같음', sc2 > sc_up[1] and E(f"T.ed('{t}').overflow") is None and len(E(f"T.fontSizes('{t}')")) == 1, [sc2, sc_up[1]])

    # ============ C. 스타일 프리셋 ============
    E("T.reset()")
    E("__nabi.app.promptText = async (msg, v) => window.__nextName || v")
    p1 = E("T.add('text', { x: 40, y: 40, w: 380, h: 300, style: { fontSize: 20 }, doc: T.paras(['제목 문단', '본문 문단 하나', '본문 문단 둘']) })")
    p2 = E("T.add('text', { x: 460, y: 40, w: 380, h: 300, style: { fontSize: 20 }, doc: T.paras(['다른 글상자 제목', '다른 본문']) })")
    # 첫 문단을 굵게 30px로 만든 뒤 "새 프리셋"
    E(f"T.V.select(['{p1}'])"); kb.press('Enter')
    E(f"(() => {{ const ed = T.ed('{p1}'); const TS = ed.state.selection.constructor; ed.setSelection(TS.create(ed.state.doc, 1, 6)); }})()")
    size_f = E("T.field('크기')"); click(size_f); kb.press('Control+a'); kb.type('30'); kb.press('Enter')
    E(f"T.ed('{p1}').focus()"); kb.press('Control+b')
    E(f"(() => {{ const ed = T.ed('{p1}'); const TS = ed.state.selection.constructor; ed.setSelection(TS.create(ed.state.doc, 3)); }})()")
    E("window.__nextName = '제목'")
    E("T.btn('새 프리셋')"); time.sleep(0.2)
    ps = E("T.V.presets")
    pid = [k for k, v in ps.items() if v['name'] == '제목']
    pid = pid[0] if pid else None
    para0 = E(f"T.ed('{p1}').state.doc.firstChild.attrs.preset")
    check('C1 편집 중 첫 문단(굵게·30px)에서 "새 프리셋" → 이름 "제목", 글자 모양 30px·굵기 700이 프리셋에 담기고 그 문단에 걸림',
          pid and ps[pid]['style']['fontSize'] == 30 and ps[pid]['style']['fontWeight'] == 700 and para0 == pid, ps)
    kb.press('Escape')
    # 다른 글상자 첫 문단에 프리셋 적용(편집 중 첫 문단 선택)
    E(f"T.V.select(['{p2}'])"); kb.press('Enter')
    E(f"(() => {{ const ed = T.ed('{p2}'); const TS = ed.state.selection.constructor; ed.setSelection(TS.create(ed.state.doc, 2)); }})()")
    E(f"T.setSel('프리셋', '{pid}')")
    fs2 = E(f"T.ed('{p2}').results[0].lines[0].pieces[0].style")
    check('C2 다른 글상자 첫 문단에 프리셋 적용 → 30px·굵게, 둘째 문단은 그대로(20px)', fs2['fontSize'] == 30 and fs2['fontWeight'] == 700 and E(f"T.ed('{p2}').results[0].lines[1].pieces[0].style.fontSize") == 20, fs2)
    kb.press('Escape')
    # 첫 글상자에서 크기 36·빨강으로 바꾼 뒤 "다시 정의" → 두 글상자 모두 바뀜
    E(f"T.V.select(['{p1}'])"); kb.press('Enter')
    E(f"(() => {{ const ed = T.ed('{p1}'); const TS = ed.state.selection.constructor; ed.setSelection(TS.create(ed.state.doc, 1, 6)); }})()")
    size_f = E("T.field('크기')"); click(size_f); kb.press('Control+a'); kb.type('36'); kb.press('Enter')
    E(f"(() => {{ const ed = T.ed('{p1}'); const TS = ed.state.selection.constructor; ed.setSelection(TS.create(ed.state.doc, 3)); }})()")
    n_before = E("__nabi.history.done.length")
    E("T.btn('다시 정의')")
    st1 = E(f"T.ed('{p2}').results[0].lines[0].pieces[0].style.fontSize")
    check('C3 "다시 정의"(36px) → 이 프리셋을 쓰는 다른 글상자 문단도 36px로 바뀜, 되돌리기 한 단위', E(f"T.V.presets['{pid}'].style.fontSize") == 36 and st1 == 36 and E("__nabi.history.done.length") == n_before + 1, st1)
    kb.press('Escape')
    E("__nabi.history.undo()")
    check('C4 되돌리기 → 프리셋 30px, 다른 글상자도 30px', E(f"T.V.presets['{pid}'].style.fontSize") == 30 and E(f"T.ed('{p2}').results[0].lines[0].pieces[0].style.fontSize") == 30)
    # 글자 모양 마크가 있는 문단에 적용 → 모양 마크는 지우고 밑줄은 남김
    E(f"""(() => {{ const ed = T.ed('{p2}'); const TS = ed.state.selection.constructor; const d = ed.state.doc; const s = d.child(0).nodeSize + 1; ed.setSelection(TS.create(d, s, s + 2)); ed.setMark('size', {{ value: 50 }}); ed.setMark('color', {{ value: '#ff0000' }}); ed.toggleMark('underline'); ed.setSelection(TS.create(ed.state.doc, s + 1)); }})()""")
    E(f"T.V.select(['{p2}'])"); kb.press('Enter')
    E(f"(() => {{ const ed = T.ed('{p2}'); const TS = ed.state.selection.constructor; const d = ed.state.doc; ed.setSelection(TS.create(d, d.child(0).nodeSize + 2)); }})()")
    E(f"T.setSel('프리셋', '{pid}')")
    marks = E(f"(() => {{ const ed = T.ed('{p2}'); const d = ed.state.doc; const n = d.child(1); const out = new Set(); n.forEach((c) => c.marks.forEach((m) => out.add(m.type.name))); return [...out]; }})()")
    check('C5 크기·색·밑줄 마크가 있는 문단에 프리셋 적용 → 크기·색 마크는 지워지고 밑줄은 남음', marks == ['underline'], marks)
    kb.press('Escape')
    # 저장 → 열기
    zipb = E("(async () => { const { bytes } = await __nabi.P.toZip(__nabi.app.project, { assets: __nabi.assets, docOf: T.V.docOf, swatches: [] }); return Array.from(bytes); })()")
    j0 = json.loads(E("T.snap()"))
    pg2 = open_page()
    pg2.evaluate("(z) => __nabi.openBytes(new Uint8Array(z), null, 'presets.nabi')", zipb)
    j1 = json.loads(pg2.evaluate("T.snap()"))
    fs_re = pg2.evaluate(f"T.ed('{p2}').results[0].lines[0].pieces[0].style.fontSize")
    pg2.close()
    check('C6 저장·열기 → 프리셋 목록·문단의 프리셋 연결 그대로(JSON 일치), 열린 창에서도 30px', j0['styles'] == j1['styles'] and j0['pages'] == j1['pages'] and fs_re == 30 and pid in j1['styles'], j1.get('styles'))
    E(f"T.V.select(['{p1}'])"); kb.press('Enter')
    E(f"(() => {{ const ed = T.ed('{p1}'); const TS = ed.state.selection.constructor; ed.setSelection(TS.create(ed.state.doc, 2)); }})()")
    E("T.btn('프리셋 지우기')")
    check('C7 프리셋 지우기 → 목록에서 빠지고, 쓰던 문단은 글상자 기본(20px)으로', pid not in E("T.V.presets") and E(f"T.ed('{p2}').results[0].lines[0].pieces[0].style.fontSize") == 20)
    kb.press('Escape')
    E("__nabi.history.undo()")
    check('C8 되돌리기 → 프리셋 돌아오고 문단도 다시 30px', pid in E("T.V.presets") and E(f"T.ed('{p2}').results[0].lines[0].pieces[0].style.fontSize") == 30)

    # ============ D. 눈금자·가이드·격자 ============
    E("T.reset()")
    rul = E("(() => { const r = T.V.rulers.top.getBoundingClientRect(); const l = T.V.rulers.left.getBoundingClientRect(); return { top: [r.left, r.top, r.width, r.height], left: [l.left, l.top, l.width, l.height], shown: T.V.showRulers }; })()")
    check('D1 눈금자 기본으로 보임(위·왼쪽 20px 띠)', rul['shown'] and close(rul['top'][3], 20, 0.01) and close(rul['left'][2], 20, 0.01), rul)
    tr = E("T.V.rulers.top.getBoundingClientRect().toJSON()")
    drag({'x': tr['left'] + 300, 'y': tr['top'] + 10}, E("T.C(200, 250)"))
    gd = E("T.V.page.guides")
    up = E("T.P(T.lastDown())")
    check('D2 위 눈금자에서 캔버스로 끌기 → 가로 가이드(놓은 자리 y, 정수)', gd == [{'axis': 'y', 'pos': 250}], gd)
    lr = E("T.V.rulers.left.getBoundingClientRect().toJSON()")
    drag({'x': lr['left'] + 10, 'y': lr['top'] + 300}, E("T.C(300.4, 200)"))
    check('D3 왼쪽 눈금자에서 끌기 → 세로 가이드 x=300', E("T.V.page.guides")[1] == {'axis': 'x', 'pos': 300}, E("T.V.page.guides"))
    # 가이드 옮기기
    drag(E("T.C(600, 250)"), E("T.C(600, 280)"))
    check('D4 가이드를 끌어 옮기기(250 → 280)', E("T.V.page.guides")[0] == {'axis': 'y', 'pos': 280}, E("T.V.page.guides"))
    # 스냅: 상자를 가이드 근처로
    r1 = E("T.add('shape', { x: 50, y: 50, w: 100, h: 80 })")
    E(f"T.V.select(['{r1}'])")
    drag(E("T.C(100, 90)"), E("T.C(100 + 247, 90 + 147)"))  # 왼쪽 변 x 297(→ 300), 아랫변 y 277(→ 280)
    g1 = E(f"T.el('{r1}')")
    check('D5 요소를 옮기면 가이드에 붙음(왼쪽 변 x=300, 아랫변 y=280)', close(g1['x'], 300) and close(g1['y'] + g1['h'], 280), {k: g1[k] for k in ('x', 'y')})
    # 가이드를 눈금자 위로 → 지우기
    drag(E("T.C(300, 600)"), {'x': lr['left'] + 10, 'y': lr['top'] + 400})
    check('D6 가이드를 눈금자 위로 끌어 놓으면 지워짐', E("T.V.page.guides") == [{'axis': 'y', 'pos': 280}], E("T.V.page.guides"))
    E("__nabi.history.undo()")
    check('D7 되돌리기 → 가이드 복원', len(E("T.V.page.guides")) == 2)
    # 격자
    E("T.V.select([])"); E("T.V.viewport.focus()")
    kb.press("Control+'")
    grid_on = E("T.V.showGrid && !!T.V.overlay.querySelector('path.grid')")
    E(f"T.V.setProps({{ x: 400, y: 400 }}, ['{r1}'])")
    E(f"T.V.select(['{r1}'])")
    drag(E("T.C(450, 440)"), E("T.C(450 + 37, 440 + 23)"))  # 437, 423 → 격자 20: 440, 420
    g2 = E(f"T.el('{r1}')")
    check("D8 Ctrl+' = 격자 보이기, 옮기면 격자(20px)에 붙음(437 → 440, 423 → 420)", grid_on and close(g2['x'], 440) and close(g2['y'], 420), {k: g2[k] for k in ('x', 'y')})
    E("T.V.select([])"); E("__nabi.flush()")
    f = E("T.field('격자 간격')"); click(f); kb.press('Control+a'); kb.type('25'); kb.press('Enter')
    E(f"T.V.select(['{r1}'])")
    drag(E("T.C(490, 460)"), E("T.C(490 + 13, 460 + 12)"))  # 453 → 450(왼쪽 변), y 432: 가운데 472 → 475 이 가장 가까워 435
    g3 = E(f"T.el('{r1}')")
    check('D9 격자 간격 25 → 25의 배수에 붙음(왼쪽 변 453 → 450, 가운데 472 → 475), 프로젝트에 저장', close(g3['x'], 450) and close(g3['y'], 435) and E("__nabi.app.project.grid.size") == 25, {k: g3[k] for k in ('x', 'y')})
    drag(E("T.C(500, 460)"), E("T.C(500 + 13, 460 + 12)"), mods=['Alt'])
    g4 = E(f"T.el('{r1}')")
    check('D10 Alt를 누른 채 옮기면 스냅 없음', close(g4['x'], 463) and close(g4['y'], 447), {k: g4[k] for k in ('x', 'y')})
    # 출력에는 가이드·격자 없음
    E("T.V.select([])")
    A = np.asarray(img(E("T.raster()")).convert('RGB'))
    check('D11 출력에는 가이드·격자가 없음(가이드 자리 픽셀 = 흰색)', A[280, 100].tolist() == [255, 255, 255] and A[100, 300].tolist() == [255, 255, 255] and A[200, 200].tolist() == [255, 255, 255], [A[280, 100].tolist(), A[100, 300].tolist()])
    kb.press('Shift+R')
    hidden = E("T.V.rulers.top.style.display === 'none' && !T.V.showRulers")
    pg.reload(); pg.wait_for_function('window.__nabi && window.__nabi.ready'); pg.evaluate(HELPERS)
    time.sleep(0.5)
    if E("!!document.querySelector('.modal-bg')"): pg.click('.modal-bg [data-v=discard]')  # 복구 확인 창
    kept = E("[T.V.showRulers, T.V.showGrid, T.V.rulers.top.style.display]")
    check('D12 Shift+R = 눈금자 숨기기, 새로 열어도 보기 설정 유지(눈금자 끔·격자 켬)', hidden and kept == [False, True, 'none'], kept)
    kb.press('Shift+R'); kb.press("Control+'")
    cdp = ctx.new_cdp_session(pg)

    # ============ E. 균등 간격 스냅 ============
    E("T.reset()")
    ea = E("T.add('shape', { x: 100, y: 100, w: 100, h: 100 })")
    eb = E("T.add('shape', { x: 300, y: 100, w: 100, h: 100 })")
    ec = E("T.add('shape', { x: 520, y: 330, w: 100, h: 100 })")
    E(f"T.V.select(['{ec}'])")
    mouse.move(*E("T.C(570, 380)").values()); mouse.down()
    mouse.move(*E("T.C(570 - 17, 380 - 227)").values(), steps=10)  # x 503, y 103
    marks = E("T.V.spacing.length")
    mouse.up()
    ge = E(f"T.el('{ec}')")
    check('E1 두 상자 간격이 100일 때 셋째를 오른쪽에 두면 같은 간격(100)에 붙음(503 → 500), 같은 간격 표시 2곳', close(ge['x'], 500) and marks >= 2, {'x': ge['x'], 'marks': marks})
    E(f"T.V.setProps({{ x: 600, y: 330 }}, ['{ec}']); T.V.setProps({{ x: 400 }}, ['{eb}'])")
    E(f"T.V.select(['{ec}'])")
    drag(E("T.C(650, 380)"), E("T.C(650 - 347, 380 - 227)"))  # x 253: A(100..200) B(400..500) 가운데 = 250
    ge2 = E(f"T.el('{ec}')")
    check('E2 두 상자 사이에 두면 양쪽 간격이 같아지는 자리(250)에 붙음', close(ge2['x'], 250), ge2['x'])
    E(f"T.V.setProps({{ x: 100, y: 300 }}, ['{eb}']); T.V.setProps({{ x: 400, y: 600 }}, ['{ec}'])")
    E(f"T.V.select(['{ec}'])")
    drag(E("T.C(450, 650)"), E("T.C(450 - 300, 650 - 96)"))  # y 504 → A(100..200) B(300..400) 간격 100 → 500
    ge3 = E(f"T.el('{ec}')")
    check('E3 세로 방향도 같은 간격(504 → 500)', close(ge3['y'], 500), ge3['y'])
    E(f"T.V.setProps({{ x: 400, y: 600 }}, ['{ec}'])"); E(f"T.V.select(['{ec}'])")
    drag(E("T.C(450, 650)"), E("T.C(450 - 300, 650 - 96)"), mods=['Alt'])
    check('E4 Alt = 스냅 없음(504 그대로)', close(E(f"T.el('{ec}').y"), 504))

    # ============ F. 템플릿 ============
    E("T.reset(800, 600)")
    E("(async () => { for (const t of await __TPL.listTemplates()) await __TPL.deleteTemplate(t.id); })()")
    ph = E("T.photo(400, 300)")
    ti = E(f"T.add('image', {{ src: {json.dumps(ph['src'])}, x: 40, y: 40, w: 400, h: 300, slot: true, filters: {{ grayscale: 100 }} }})")
    tt = E("T.add('text', { x: 480, y: 40, w: 280, h: 120, style: { fontSize: 28 }, slot: true, doc: T.longDoc('제목을 넣으십시오') })")
    tf1 = E(f"T.add('text', {{ x: 40, y: 380, w: 340, h: 100, style: {{ fontSize: 16 }}, doc: T.longDoc({json.dumps(LONG)}) }})")
    tf2 = E("T.add('text', { x: 420, y: 380, w: 340, h: 180, style: { fontSize: 16 } })")
    E(f"T.V.linkFrames('{tf1}', '{tf2}')")
    E(f"T.V.definePreset('pz', {{ name: '큰 제목', style: {{ fontSize: 34, fontWeight: 700 }} }})")
    E(f"T.ed('{tt}').applyPreset('pz', true)")
    E("__nabi.app.promptText = async () => '표지'")
    E("T.V.select([])")
    marks_ok = E("T.V.overlay.querySelectorAll('.slot').length")
    rec = E("(async () => { const r = await __nabi.app.templates.saveFromPage(); return { id: r.id, name: r.name, w: r.w, h: r.h, thumb: (r.thumb || '').slice(0, 22), size: r.bytes.length }; })()")
    lst = E("(async () => (await __TPL.listTemplates()).map((t) => t.name))()")
    check('F1 슬롯 표시(주황 점선 2개), "지금 장을 템플릿으로" → 보관함에 "표지"(800×600, 미리보기 PNG)', marks_ok == 2 and rec['name'] == '표지' and rec['w'] == 800 and rec['thumb'].startswith('data:image/png') and lst == ['표지'], rec)
    # 다른 프로젝트처럼: 새 장 하나만 있는 상태에서 템플릿으로 새 장
    E("T.reset(500, 500)")
    E("(() => { const d = T.V.presets; for (const k of Object.keys(d)) delete d[k]; T.V.setPresets({}); })()")
    n_assets0 = E("__nabi.assets.byId.size")
    E("(async () => { const [t] = await __TPL.listTemplates(); await __nabi.app.templates.insert(t.bytes); })()")
    time.sleep(0.3)
    np_ = E("[__nabi.app.project.pages.length, __nabi.app.project.pages.indexOf(__nabi.app.current), T.V.page.w, T.V.page.h]")
    els = E("T.V.page.elements.map((n) => ({ id: n.id, type: n.type, slot: !!n.slot, story: n.story || null, x: n.x, y: n.y }))")
    ids_new = [e['id'] for e in els]
    slot_img = next(e['id'] for e in els if e['type'] == 'image')
    slot_txt = next(e['id'] for e in els if e['type'] == 'text' and e['slot'])
    flows = [e['id'] for e in els if e['type'] == 'text' and not e['slot']]
    check('F2 템플릿으로 새 장 → 지금 장 뒤(2장 중 2번째), 크기 800×600, 요소 4개 새 id, 슬롯 2개, 이어진 글상자도 이어진 채로',
          np_ == [2, 1, 800, 600] and len(els) == 4 and not ({ti, tt, tf1, tf2} & set(ids_new)) and sum(e['slot'] for e in els) == 2
          and E(f"T.ed('{flows[0]}').members") == flows and E(f"T.ed('{flows[0]}').overflow") is None, els)
    check('F3 템플릿의 스타일 프리셋이 프로젝트에 더해지고 글 슬롯에 걸려 있음(34px)', 'pz' in E("T.V.presets") and E(f"T.ed('{slot_txt}').results[0].lines[0].pieces[0].style.fontSize") == 34)
    check('F4 템플릿 이미지는 에셋 하나로(같은 내용이면 새로 늘지 않음)', E("__nabi.assets.byId.size") == max(n_assets0, 1), [n_assets0, E("__nabi.assets.byId.size")])
    # 이미지 슬롯 바꾸기(속성 패널)
    ph2 = E("T.photo(300, 600, '#0a0', '#ff0')")
    E(f"__nabi.app.pickImage = async () => ({{ src: {json.dumps(ph2['src'])}, w: 300, h: 600 }})")
    E(f"T.V.select(['{slot_img}'])")
    before = E(f"T.el('{slot_img}')")
    E("T.btn('이미지 바꾸기…')"); time.sleep(0.2)
    after = E(f"T.el('{slot_img}')")
    check('F5 이미지 슬롯 "이미지 바꾸기…" → 이미지만 바뀌고 상자·필터 그대로, 맞춤 = 채우기', after['src'] == ph2['src'] and all(after[k] == before[k] for k in ('x', 'y', 'w', 'h')) and after['filters'] == before['filters'] and after['fit'] == 'cover' and after['slot'], after)
    # 이미지 파일을 슬롯에 끌어다 놓기
    ph3 = E("T.photo(200, 200, '#00f', '#f0f')")
    E(f"""(async () => {{ const b = await (await fetch({json.dumps(ph3['src'])})).blob(); const f = new File([b], 'x.png', {{ type: 'image/png' }}); const dt = new DataTransfer(); dt.items.add(f);
      const c = T.C(200, 200); const ev = new DragEvent('drop', {{ bubbles: true, cancelable: true, clientX: c.x, clientY: c.y, dataTransfer: dt }}); T.V.viewport.dispatchEvent(ev); }})()""")
    time.sleep(0.4)
    after2 = E(f"T.el('{slot_img}')")
    check('F6 이미지 파일을 이미지 슬롯에 끌어다 놓으면 그 슬롯이 바뀜(새 요소 안 생김)', after2['src'] != ph2['src'] and len(E("T.ids()")) == 4, after2['src'])
    # 되돌리기: 슬롯 교체 2번 → 템플릿 삽입(장 + 프리셋) 한 번
    for _ in range(2): E("__nabi.history.undo()")
    E("__nabi.history.undo()")
    check('F7 되돌리기 → 템플릿 장 삽입이 한 단위로 취소(장 1개, 프리셋도 빠짐)', E("__nabi.app.project.pages.length") == 1 and 'pz' not in E("T.V.presets"), E("Object.keys(T.V.presets)"))
    # 파일로 내보내기 → 가져오기
    with pg.expect_download() as dl:
        E("(async () => { const [t] = await __TPL.listTemplates(); await __nabi.app.templates.exportFile(t); })()")
    d = dl.value
    path = os.path.join(TMP, d.suggested_filename); d.save_as(path)
    E("(async () => { for (const t of await __TPL.listTemplates()) await __TPL.deleteTemplate(t.id); })()")
    with pg.expect_file_chooser() as fc:
        E("(() => { window.__imp = null; const b = [...document.querySelectorAll('button')].find((x) => x.id === 'pageTpl'); b.click(); })()")
        time.sleep(0.3)
        pg.click('.modal [data-v=import]')
    fc.value.set_files(path)
    time.sleep(0.5)
    names = E("(async () => (await __TPL.listTemplates()).map((t) => [t.name, t.w, t.h]))()")
    items = E("document.querySelectorAll('.tpl-mine .tpl-item').length")
    check(f'F8 템플릿 창: 파일로 내보내기({d.suggested_filename}) → 보관함 비우고 파일에서 가져오기 → 목록에 다시 나타남', d.suggested_filename == '표지.nabitpl' and names == [['표지', 800, 600]] and items == 1, names)
    pg.click('.tpl-mine .tpl-item [data-act=use]'); time.sleep(0.5)
    check('F9 템플릿 창의 "새 장으로" → 새 장(2장)', E("__nabi.app.project.pages.length") == 2 and E("T.V.page.w") == 800 and not E("document.querySelector('.modal-bg')"))

    check('Z 검증 전체 동안 페이지 오류 없음', not errors, errors)
    b.close()

for name, ok, detail in results:
    print(('PASS ' if ok else 'FAIL ') + name + ('' if ok else '  ' + json.dumps(detail, ensure_ascii=False, default=str)[:600]))
print('metrics:', json.dumps(metrics, ensure_ascii=False))
print(f"{sum(ok for _, ok, _ in results)}/{len(results)} passed")
