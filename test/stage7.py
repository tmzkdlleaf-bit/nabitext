"""7단계 검증: 레이어 패널, 속성 패널, 스와치, 스포이트.
사용: python3 test/stage7.py  (proto 폴더 기준)
입력은 CDP로 실제 마우스·키 이벤트(Playwright mouse/keyboard)를 보낸다.
"""
import json, os, time, threading, functools
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from playwright.sync_api import sync_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
class Quiet(SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
srv = ThreadingHTTPServer(('127.0.0.1', 0), functools.partial(Quiet, directory=ROOT))
threading.Thread(target=srv.serve_forever, daemon=True).start()
ORIGIN = f'http://127.0.0.1:{srv.server_port}'

results = []
def check(name, ok, detail=''):
    results.append((name, bool(ok), detail))
close = lambda a, b, eps=0.01: a is not None and b is not None and abs(a - b) <= eps

JS = r"""
(() => {
  const V = __nabi.view, M = __nabi.M;
  const doc = (t) => ({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: t }] }] });
  window.T = {
    V, M, doc,
    reset: () => { V.setPage(M.newPage()); __nabi.history.done.length = 0; __nabi.history.undone.length = 0; __nabi.history.emit(); __nabi.flush(); },
    add: (type, props) => { const n = M.makeElement(type, props); V.change('create', () => { V.page.elements.push(n); }); return n.id; },
    el: (id) => { const n = V.node(id); return n && JSON.parse(JSON.stringify(n, (k, v) => (k === 'doc' ? undefined : v))); },
    ids: () => V.page.elements.map((n) => n.id),
    rows: () => { __nabi.flush(); return [...document.querySelectorAll('#layers .lp-row')].map((r) => ({ id: r.dataset.id, name: r.querySelector('.lp-name').textContent, sel: r.classList.contains('sel'), hidden: r.classList.contains('hidden'), pad: parseFloat(r.style.paddingLeft) })); },
    rowPt: (id, part = 'name', fy = 0.5) => { __nabi.flush(); const r = document.querySelector(`#layers .lp-row[data-id="${id}"]`); const t = part === 'row' ? r : r.querySelector(part === 'name' ? '.lp-name' : part === 'twist' ? '.lp-tw' : `[data-act="${part}"]`); const b = (part === 'row' ? r : t).getBoundingClientRect(); const rb = r.getBoundingClientRect(); return { x: b.left + b.width / 2, y: rb.top + rb.height * fy }; },
    field: (label) => { __nabi.flush(); const f = document.querySelector(`#props [data-field="${label}"]`); f?.scrollIntoView({ block: 'center' }); if (!f) return null; const b = f.getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2, value: f.value, ph: f.placeholder, pressed: f.getAttribute('aria-pressed') }; },
    text: (id) => V.editors.get(id).text,
    marksAt: (id, pos) => V.editors.get(id).state.doc.resolve(pos).marks().map((m) => m.type.name + (m.attrs && m.attrs.value != null ? '=' + m.attrs.value : '')),
    find: (id, str) => { const d = V.editors.get(id).state.doc; let s = '', map = []; d.descendants((n, pos) => { if (n.isText) for (let i = 0; i < n.text.length; i++) { s += n.text[i]; map.push(pos + i); } }); const i = s.indexOf(str); return i < 0 ? null : [map[i], map[i + str.length - 1] + 1]; },
    domOrder: () => [...V.pageEl.children].filter((c) => c.parentNode && c.style.display !== 'none').map((c) => c.dataset.id),
  };
  return true;
})()
"""

with sync_playwright() as p:
    b = p.chromium.launch(args=['--disable-lcd-text'])
    ctx = b.new_context(viewport={'width': 1500, 'height': 1000})
    pg = ctx.new_page()
    pg.route('**/fonts.googleapis.com/**', lambda r: r.abort())
    errors = []
    pg.on('pageerror', lambda e: errors.append(str(e)))
    pg.on('console', lambda m: m.type == 'error' and 'ERR_FAILED' not in m.text and errors.append(m.text))
    pg.goto(ORIGIN + '/index.html')
    pg.wait_for_function('window.__nabi && window.__nabi.ready', timeout=30000)
    pg.evaluate(JS)
    pg.click("[data-tab=layers]")  # 12단계 개편: 레이어는 왼쪽 패널의 "레이어" 탭
    E = lambda js, arg=None: pg.evaluate(js, arg) if arg is not None else pg.evaluate(js)
    mouse, kb = pg.mouse, pg.keyboard
    cdp = ctx.new_cdp_session(pg)
    def click(pt, mods=(), count=1):
        for m in mods: kb.down(m)
        mouse.click(pt['x'], pt['y'], click_count=count)
        for m in reversed(mods): kb.up(m)
    def drag(a, c, steps=10):
        mouse.move(a['x'], a['y']); mouse.down(); mouse.move(c['x'], c['y'], steps=steps); mouse.up()
    def set_field(label, value, enter=True):
        f = E(f"T.field({json.dumps(label)})")
        click(f); kb.press('Control+a'); kb.press('Backspace'); kb.type(str(value))
        if enter: kb.press('Enter')
        E("__nabi.flush()")
    undo = lambda: E("__nabi.history.undo()")

    # ============ L. 레이어 패널 ============
    E("T.reset()")
    a = E("T.add('shape', { x: 60, y: 60, w: 200, h: 150 })")
    bb = E("T.add('shape', { shape: 'ellipse', x: 320, y: 80, w: 180, h: 180, fill: '#b9e3ff' })")
    t = E("T.add('text', { x: 80, y: 400, w: 420, h: 120, doc: T.doc('첫째 글상자 굵게 바꿀 단어') })")
    c = E("T.add('shape', { x: 600, y: 500, w: 120, h: 120 })")
    d = E("T.add('shape', { x: 760, y: 520, w: 120, h: 120 })")
    E(f"T.V.select(['{c}', '{d}']); T.V.group()")
    g = E("T.ids()[3]")
    rows = E("T.rows()")
    check('L1 행 순서 = 앞 → 뒤(그룹, 글상자, 원, 사각형), 기본 이름(그룹·글상자·도형), 그룹은 접힌 상태',
          [r['id'] for r in rows] == [g, t, bb, a] and [r['name'] for r in rows] == ['그룹', '글상자', '도형', '도형'], rows)
    click(E(f"T.rowPt('{g}', 'twist')"))
    rows = E("T.rows()")
    check('L2 ▸ 누르면 그룹 펼침: 자식이 들여쓰기로(위 = 앞: d, c)', [r['id'] for r in rows] == [g, d, c, t, bb, a] and rows[1]['pad'] > rows[0]['pad'], rows)
    click(E(f"T.rowPt('{bb}')"))
    s1 = E("T.V.selection"); r1 = [r['id'] for r in E("T.rows()") if r['sel']]
    click(E("T.V.pageToClient({ x: 100, y: 100 })"))
    r2 = [r['id'] for r in E("T.rows()") if r['sel']]
    click(E("T.V.pageToClient({ x: 650, y: 550 })"))
    r3 = [r['id'] for r in E("T.rows()") if r['sel']]
    click(E(f"T.rowPt('{c}')"))
    s4 = E("T.V.selection")
    check('L3 행 클릭 → 캔버스 선택, 캔버스 클릭 → 행 강조, 그룹 자식 클릭(캔버스) → 그룹 행, 패널에서는 그룹 안 요소도 직접 선택', s1 == [bb] and r1 == [bb] and r2 == [a] and r3 == [g] and s4 == [c], [s1, r1, r2, r3, s4])
    click(E(f"T.rowPt('{t}')")); click(E(f"T.rowPt('{a}')"), mods=['Control'])
    s5 = E("T.V.selection")
    click(E(f"T.rowPt('{t}')"), mods=['Control'])
    s6 = E("T.V.selection")
    click(E(f"T.rowPt('{t}')")); click(E(f"T.rowPt('{a}')"), mods=['Shift'])
    s7 = E("T.V.selection")
    check('L4 Ctrl+클릭 더하기·빼기, Shift+클릭 범위(보이는 행 순서)', sorted(s5) == sorted([t, a]) and s6 == [a] and sorted(s7) == sorted([t, bb, a]), [s5, s6, s7])
    mouse.move(*E(f"[T.rowPt('{bb}').x, T.rowPt('{bb}').y]"))
    click(E(f"T.rowPt('{bb}', 'hide')"))
    hid = (E(f"T.V.node('{bb}').hidden"), E(f"T.V.nodes.get('{bb}').style.display"), [r['hidden'] for r in E("T.rows()") if r['id'] == bb][0])
    click(E(f"T.rowPt('{bb}', 'hide')"))
    shown = E(f"T.V.node('{bb}').hidden")
    click(E(f"T.rowPt('{a}', 'lock')"))
    lk = E(f"T.V.node('{a}').locked")
    undo()
    lk2 = E(f"T.V.node('{a}').locked")
    check('L5 눈 버튼 → 숨김(화면에서 사라지고 행 흐리게), 다시 누르면 보임, 자물쇠 → 잠금, 되돌리기 가능', hid == (True, 'none', True) and shown is False and lk is True and lk2 is False, [hid, shown, lk, lk2])
    click(E(f"T.rowPt('{a}')"), count=2)
    time.sleep(0.1)
    kb.press('Control+a'); kb.type('배경 상자'); kb.press('Enter')
    nm = E(f"T.V.node('{a}').name"); rn = [r['name'] for r in E("T.rows()") if r['id'] == a][0]
    click(E(f"T.rowPt('{a}')"), count=2); time.sleep(0.1); kb.type('취소될 이름'); kb.press('Escape')
    nm2 = E(f"T.V.node('{a}').name")
    undo()
    nm3 = E(f"T.V.node('{a}').name")
    check('L6 이름 더블클릭 → 바꾸기(Enter 적용, Esc 취소), 되돌리기 가능, 이름 입력 중 키가 캔버스로 가지 않음', nm == '배경 상자' and rn == '배경 상자' and nm2 == '배경 상자' and nm3 == '' and E(f"T.V.node('{a}') !== null"), [nm, rn, nm2, nm3])
    # 끌어 놓기: 사각형(맨 뒤)을 그룹 행 위쪽으로 → 맨 앞
    drag(E(f"T.rowPt('{a}')"), E(f"T.rowPt('{g}', 'row', 0.15)"))
    o1 = E("T.ids()"); dom1 = E("T.domOrder()")
    check('L7 행을 끌어 맨 위 행 위쪽에 놓기 → 맨 앞으로(캔버스 그리는 순서도)', o1[-1] == a and dom1[-1] == a and E("T.V.selection") == [a], [o1, dom1])
    # 글상자를 그룹 행 가운데에 놓기 → 그룹 안 맨 앞
    drag(E(f"T.rowPt('{t}')"), E(f"T.rowPt('{g}', 'row', 0.5)"))
    kids = E(f"T.V.node('{g}').children.map((n) => n.id)")
    check('L8 행을 그룹 행 가운데에 놓기 → 그룹 안(맨 앞), 좌표는 그대로', kids == [c, d, t] and E(f"T.el('{t}').x") == 80, kids)
    # 그룹 자식을 끌어 바깥(원 행 아래쪽)으로
    drag(E(f"T.rowPt('{c}')"), E(f"T.rowPt('{bb}', 'row', 0.85)"))
    o3 = E("T.ids()")
    check('L9 그룹 안 요소를 끌어 바깥 행 아래에 놓기 → 그룹에서 빠져 그 자리로', c in o3 and o3.index(c) == o3.index(bb) - 1 and c not in E(f"T.V.node('{g}').children.map((n) => n.id)"), o3)
    E(f"T.V.moveNodes(['{d}', '{t}'], null, 0)")
    check('L10 그룹을 비우면 그룹이 지워짐', E(f"T.V.node('{g}')") is None and E("T.ids()")[:2] == [d, t], E("T.ids()"))
    undo()
    bad = E(f"T.V.moveNodes(['{g}'], '{g}', 0)")
    check('L11 그룹을 자기 안으로 옮기기 거부', bad is False and E(f"T.V.node('{g}') !== null"))
    mouse.move(*E(f"[T.rowPt('{bb}').x, T.rowPt('{bb}').y]"))
    hv = (E("T.V.hover"), E("T.V.overlay.querySelectorAll('polygon').length"))
    check('L12 행에 마우스를 올리면 캔버스에 그 요소 윤곽 표시', hv[0] == bb and hv[1] >= 1, hv)

    # ============ P. 속성 패널 ============
    E("T.reset()")
    E("__nabi.flush()")
    check('P1 선택 없음 → 장 속성(너비·높이·배경)', E("T.field('너비')")['value'] == '1080' and E("T.field('배경')")['value'] == '#ffffff')
    set_field('너비', 800)
    w1 = E("T.V.page.w"); z_fit = E("T.V.autoFit")
    set_field('배경', 'ffeecc')
    bg = E("T.V.page.background")
    set_field('배경', '')
    bg2 = E("T.V.page.background")
    undo(); undo(); undo()
    check('P2 장 너비 800(화면 다시 맞춤), 배경 #ffeecc(# 없이 입력해도 됨), 비우면 투명, 되돌리기 3번 → 처음', w1 == 800 and z_fit and bg == '#ffeecc' and bg2 == 'transparent' and E("T.V.page.w") == 1080 and E("T.V.page.background") == '#ffffff', [w1, bg, bg2])
    a = E("T.add('shape', { x: 100.5, y: 120, w: 200, h: 100 })")
    bb = E("T.add('shape', { x: 400, y: 300, w: 100, h: 50, opacity: 0.5 })")
    click(E("T.V.pageToClient({ x: 150, y: 150 })"))
    fx = E("T.field('X')")
    set_field('X', 123)
    x1 = E(f"T.el('{a}').x")
    click(E("T.field('W')"))
    for k in ['ArrowUp', 'ArrowUp', 'ArrowUp', 'Shift+ArrowUp']: kb.press(k)
    w2 = E(f"T.el('{a}').w")
    kb.press('Escape')
    undo()
    w3 = E(f"T.el('{a}').w")
    check('P3 X 칸에 요소 값(100.5), 123 입력 → x=123, W 칸 ↑↑↑ + Shift↑ → +13, 이어진 화살표는 되돌리기 1단위', fx['value'] == '100.5' and x1 == 123 and w2 == 213 and w3 == 200, [fx['value'], x1, w2, w3])
    set_field('회전', 30)
    check('P4 회전 30 → 요소 회전 30°', E(f"T.el('{a}').rotation") == 30)
    E(f"T.V.setProps({{ rotation: 0 }}, ['{a}'])")
    E(f"T.V.select(['{a}', '{bb}'])"); E("__nabi.flush()")
    bx = E("T.V.selectionBounds()")
    fx2 = E("T.field('X')"); op = E("T.field('불투명도')")
    set_field('W', bx['w'] * 2)
    bx2 = E("T.V.selectionBounds()")
    check('P5 여러 개: X = 선택 전체 상자, 불투명도가 다르면 "여러 값", W 두 배 → 두 요소가 함께 늘어남', fx2['value'] == '123' and op['value'] == '' and op['ph'] == '여러 값' and close(bx2['w'], bx['w'] * 2) and close(bx2['x'], bx['x']) and E("T.field('회전')") is None, [fx2, op, bx, bx2])
    set_field('불투명도', 50)
    E("(() => { const s = document.querySelector('#props [data-field=\"blend\"]'); s.value = 'multiply'; s.dispatchEvent(new Event('change')); })()")
    check('P6 불투명도 50 → 0.5(둘 다), 혼합 모드 곱하기', E(f"T.el('{a}').opacity") == 0.5 and E(f"T.el('{bb}').opacity") == 0.5 and E(f"T.el('{a}').blend") == 'multiply')
    E(f"T.V.select(['{a}'])"); E("__nabi.flush()")
    set_field('색', '#123456')
    f1 = E(f"T.el('{a}').fill")
    n_before = E("__nabi.history.done.length")
    E("""(() => { const p = document.querySelector('#props .cf-pick'); for (const c of ['#200000', '#400000', '#600000', '#800000']) { p.value = c; p.dispatchEvent(new Event('input')); } p.dispatchEvent(new Event('change')); })()""")
    f2 = E(f"T.el('{a}').fill"); n_after = E("__nabi.history.done.length")
    undo()
    f3 = E(f"T.el('{a}').fill")
    check('P7 채움 #123456 입력, 색 고르기 창을 끌며 바꾼 연속 변경 → 되돌리기 1단위', f1 == '#123456' and f2 == '#800000' and n_after - n_before == 1 and f3 == '#123456', [f1, f2, n_after - n_before, f3])
    set_field('두께', 4); set_field('모서리', 12)
    check('P8 테두리 두께 4, 모서리 12', E(f"T.el('{a}').strokeWidth") == 4 and E(f"T.el('{a}').radius") == 12)
    set_field('색', '')
    check('P9 채움을 비우면 없음(none)', E(f"T.el('{a}').fill") == 'none')

    # 글자: 편집 중이 아닐 때 = 글상자 전체
    E("T.reset()")
    t1 = E("T.add('text', { x: 80, y: 80, w: 600, h: 200, doc: T.doc('첫째 글상자 굵게 바꿀 단어') })")
    t2 = E("T.add('text', { x: 80, y: 400, w: 600, h: 200, doc: T.doc('둘째 글상자') })")
    E(f"T.V.select(['{t1}', '{t2}'])"); E("__nabi.flush()")
    sz0 = E("T.field('크기')")['value']
    set_field('크기', 40)
    click(E("T.field('굵게')"))
    sizes = E(f"[T.V.editors.get('{t1}').markStateOn('size', true), T.V.editors.get('{t2}').markStateOn('size', true)].map((s) => [s.state, s.values.map((v) => v.value)])")
    bolds = E(f"[T.V.editors.get('{t1}').markStateOn('bold', true).state, T.V.editors.get('{t2}').markStateOn('bold', true).state]")
    lay = E(f"T.V.editors.get('{t1}').result.lines[0].pieces[0].style.fontSize")
    pressed = E("T.field('굵게')")['pressed']
    undo()
    after1 = (E(f"T.V.editors.get('{t1}').markStateOn('bold', true).state"), E(f"T.V.editors.get('{t2}').markStateOn('bold', true).state"), E("T.V.editing"))
    undo()
    after2 = E(f"T.V.editors.get('{t2}').markStateOn('size', true).state")
    check('P10 글상자 2개 선택(편집 아님): 크기 기본 32 표시 → 40 입력, B → 두 글상자 전체 굵게(버튼 눌림), 되돌리기 1번에 두 글상자 모두 취소·편집 모드로 들어가지 않음',
          sz0 == '32' and sizes == [['all', [40]], ['all', [40]]] and bolds == ['all', 'all'] and lay == 40 and pressed == 'true' and after1 == ('none', 'none', None) and after2 == 'none', [sz0, sizes, bolds, lay, pressed, after1, after2])
    # 편집 중: 선택 범위에만
    E(f"T.V.enterEdit('{t1}')")
    rng = E(f"T.find('{t1}', '단어')")
    E(f"(() => {{ const ed = T.V.editors.get('{t1}'); ed.setSelection(T.V.editors.get('{t1}').state.selection.constructor.create(ed.state.doc, {rng[0]}, {rng[1]})); }})()")
    E("__nabi.flush()")
    title = E("[...document.querySelectorAll('#props .pp-h')].map((h) => h.textContent)")  # 12단계 개편: 칸 제목(작은 글씨에 '선택한 글자에')
    set_field('색', '#c0392b')
    m_word = E(f"T.marksAt('{t1}', {rng[0]} + 1)"); m_other = E(f"T.marksAt('{t1}', 2)")
    focus_back = E("document.activeElement.classList.contains('ce-input')")
    check('P11 편집 중 단어 선택 → 색 입력 → 그 단어만 색, 적용 뒤 키보드 포커스가 글상자로 돌아옴, 패널 제목 "선택한 글자에"',
          'color=#c0392b' in m_word and not any(m.startswith('color') for m in m_other) and focus_back and any('선택한 글자' in h for h in title), [m_word, m_other, focus_back, title])
    rb = E(f"T.find('{t1}', '굵게')")
    E(f"(() => {{ const ed = T.V.editors.get('{t1}'); ed.setSelection(ed.state.selection.constructor.create(ed.state.doc, {rb[0]}, {rb[1]})); }})()")
    click(E("T.field('굵게')"))
    E(f"(() => {{ const ed = T.V.editors.get('{t1}'); ed.setSelection(ed.state.selection.constructor.create(ed.state.doc, {rb[0]} + 1)); }})()")
    time.sleep(0.05); E("__nabi.flush()")
    bp_in = E("T.field('굵게')")['pressed']
    E(f"(() => {{ const ed = T.V.editors.get('{t1}'); ed.setSelection(ed.state.selection.constructor.create(ed.state.doc, 2)); }})()")
    time.sleep(0.05); E("__nabi.flush()")
    bp_out = E("T.field('굵게')")['pressed']
    check('P12 커서를 굵은 글자 안으로 옮기면 B 버튼 눌림, 밖으로 옮기면 해제(커서 이동에 패널이 따라옴)', bp_in == 'true' and bp_out == 'false', [bp_in, bp_out])
    end = E(f"T.V.editors.get('{t1}').state.doc.content.size - 1")
    E(f"(() => {{ const ed = T.V.editors.get('{t1}'); ed.setSelection(ed.state.selection.constructor.create(ed.state.doc, {end})); ed.focus(); }})()")
    set_field('크기', 50)
    cdp.send('Input.insertText', {'text': 'Z'})
    mz = E(f"T.marksAt('{t1}', {end} + 1)")
    check('P13 빈 선택(커서)에서 크기 50 → 다음에 입력한 글자가 50', 'size=50' in mz, mz)
    click(E("T.field('가운데 정렬')"))
    al = E(f"T.V.editors.get('{t1}').state.doc.firstChild.attrs.align")
    ln = E(f"(() => {{ const r = T.V.editors.get('{t1}').result; const l = r.lines[r.lines.length - 1]; return l.pieces[0].x; }})()")
    kb.press('Escape')
    check('P14 가운데 정렬 버튼 → 문단 정렬 center, 마지막 줄이 가운데로 이동', al == 'center' and ln > 50, [al, ln])
    E(f"T.V.select(['{t2}'])"); E("__nabi.flush()")
    set_field('글꼴', 'DejaVu Serif')
    ff = E(f"T.V.editors.get('{t2}').markStateOn('font', true)")
    x0 = E(f"T.V.editors.get('{t2}').result.lines[0].pieces[0].x")
    set_field('안쪽 여백', 20)
    x1 = E(f"T.V.editors.get('{t2}').result.lines[0].pieces[0].x")
    check('P15 글꼴 "DejaVu Serif" → 글상자 전체 글꼴 꾸밈(뒤에 한글 대체 글꼴, 13단계), 안쪽 여백 20 → 글이 20px 안쪽에서 시작', ff['state'] == 'all' and ff['values'][0]['value'].startswith('"DejaVu Serif", ') and x0 == 0 and x1 >= 20, [ff, x0, x1])
    # 시스템 글꼴 버튼(P16)은 headless에서 권한을 줄 수 없어 test/electron.py(A2)에서 확인한다
    E("T.reset()")
    im = E("""(async () => { const c = new OffscreenCanvas(40, 20); c.getContext('2d').fillRect(0, 0, 40, 20); const u = URL.createObjectURL(await c.convertToBlob()); return T.add('image', { src: u, x: 10, y: 10, w: 200, h: 200 }); })()""")
    E(f"T.V.select(['{im}'])"); E("__nabi.flush()")
    E("(() => { const s = document.querySelector('#props [data-field=\"맞춤\"]'); s.value = 'contain'; s.dispatchEvent(new Event('change')); })()")
    check('P17 이미지 맞춤 → contain(화면 img에 반영)', E(f"T.el('{im}').fit") == 'contain' and E(f"T.V.nodes.get('{im}').querySelector('img').style.objectFit") == 'contain')

    # ============ S. 스와치·스포이트 ============
    E("T.reset()")
    a = E("T.add('shape', { x: 100, y: 100, w: 200, h: 100, fill: '#13579b' })")
    E(f"T.V.select(['{a}'])"); E("__nabi.flush()")
    n0 = E("__nabi.swatches.list.length")
    click(E("(() => { const b = document.querySelector('#props .cf-more').getBoundingClientRect(); return { x: b.left + 4, y: b.top + 4 }; })()"))
    click(E("(() => { const b = document.querySelector('.cf-pop .cf-add').getBoundingClientRect(); return { x: b.left + 5, y: b.top + 5 }; })()"))
    added = E("__nabi.swatches.list.includes('#13579b')")
    click(E("(() => { const b = document.querySelector('.cf-pop .cf-sw[data-c=\"#e07a5f\"]').getBoundingClientRect(); return { x: b.left + 5, y: b.top + 5 }; })()"))
    f_sw = E(f"T.el('{a}').fill")
    click(E("(() => { const b = document.querySelector('#props .cf-more').getBoundingClientRect(); return { x: b.left + 4, y: b.top + 4 }; })()"))
    click(E("(() => { const b = document.querySelector('.cf-pop .cf-sw[data-c=\"#13579b\"]').getBoundingClientRect(); return { x: b.left + 5, y: b.top + 5 }; })()"), mods=['Alt'])
    removed = not E("__nabi.swatches.list.includes('#13579b')")
    check('S1 스와치: ＋ → 지금 색 추가, 스와치 클릭 → 채움에 적용, Alt+클릭 → 스와치에서 빼기', added and f_sw == '#e07a5f' and removed and E("__nabi.swatches.list.length") == n0, [added, f_sw, removed])
    ed_native = E("typeof window.EyeDropper")
    E("(() => { window.EyeDropper = class { open() { return Promise.resolve({ sRGBHex: '#abcdef' }); } }; })()")
    E("T.V.select([])"); E(f"T.V.select(['{a}'])"); E("__nabi.flush()")
    click(E("(() => { const b = document.querySelector('#props .cf-drop').getBoundingClientRect(); return { x: b.left + 4, y: b.top + 4 }; })()"))
    time.sleep(0.2)
    check(f'S2 스포이트 버튼 → EyeDropper 결과 색을 채움에 적용 (이 Chromium의 EyeDropper: {ed_native}, 검사는 가짜 결과로)', E(f"T.el('{a}').fill") == '#abcdef', E(f"T.el('{a}').fill"))

    check('Z 검증 전체 동안 페이지 오류 없음', not errors, errors)
    b.close()

srv.shutdown()
fails = [r for r in results if not r[1]]
for name, ok, detail in results:
    print(('PASS ' if ok else 'FAIL ') + name + ('' if ok else '  ' + json.dumps(detail, ensure_ascii=False, default=str)[:900]))
print(f'{len(results) - len(fails)}/{len(results)} passed')
