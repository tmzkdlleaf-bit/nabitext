"""3단계 편집 기능 검증: 마크 명령·단축키, 전역 되돌리기, 복사/붙여넣기.
Chromium + CDP로 실제 키·IME 조합·클립보드 이벤트를 발생시킨다.
사용: python3 test/stage3.py  (proto 폴더 기준)
"""
import json, os, time, threading, functools, base64
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from playwright.sync_api import sync_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'test', 'out')
os.makedirs(OUT, exist_ok=True)

class Quiet(SimpleHTTPRequestHandler):
    def log_message(self, *a): pass

srv = ThreadingHTTPServer(('127.0.0.1', 0), functools.partial(Quiet, directory=ROOT))
threading.Thread(target=srv.serve_forever, daemon=True).start()

results = []
def check(name, ok, detail=''):
    results.append((name, bool(ok), detail))

JS_HELPERS = r"""
(async () => {
  const PS = await import('/vendor/prosemirror-state.js');
  const CB = await import('/src/clipboard.js');
  const SC = await import('/src/schema.js');
  const PM = await import('/vendor/prosemirror-model.js');
  const initial = {};
  for (const [id, ed] of __app.editors) initial[id] = ed.state.doc.toJSON();
  window.T = {
    PS, CB, SC, PM, initial,
    ed: (id) => __app.editors.get(id),
    json: (id) => T.ed(id).state.doc.toJSON(),
    text: (id) => T.ed(id).text,
    sel: (id) => { const s = T.ed(id).state.selection; return { from: s.from, to: s.to, head: s.head, anchor: s.anchor, type: s.toJSON().type }; },
    page: (id, x, y) => { const r = T.ed(id).frameEl.getBoundingClientRect(); return { x: r.left + x, y: r.top + y }; },
    reset: (id) => {
      const ed = T.ed(id);
      ed.state = PS.EditorState.create({ doc: SC.schema.nodeFromJSON(T.initial[id]) });
      ed.comp = null; ed.update();
      __app.history.done.length = 0; __app.history.undone.length = 0; __app.history.emit();
    },
    // 문서 안 문자열 → [from, to] (문단 안에서 여러 글자 노드에 걸쳐도 됨, nth번째)
    find: (id, str, nth = 0) => {
      const doc = T.ed(id).state.doc;
      let s = '', map = [];
      doc.descendants((n, pos) => { if (n.isText) for (let i = 0; i < n.text.length; i++) { s += n.text[i]; map.push(pos + i); } });
      let i = -1;
      for (let k = 0; k <= nth; k++) { i = s.indexOf(str, i + 1); if (i < 0) return null; }
      return [map[i], map[i + str.length - 1] + 1];
    },
    select: (id, str, nth = 0) => {
      const ed = T.ed(id); const r = T.find(id, str, nth);
      ed.focus(); ed.setSelection(PS.TextSelection.create(ed.state.doc, r[0], r[1])); return r;
    },
    caretAt: (id, pos) => { const ed = T.ed(id); ed.focus(); ed.setSelection(PS.TextSelection.create(ed.state.doc, pos)); },
    // 범위 안 글자들의 마크 목록(글자 노드 단위)
    marksIn: (id, from, to) => {
      const out = [];
      T.ed(id).state.doc.nodesBetween(from, to, (n) => { if (n.isText) out.push({ t: n.text, m: n.marks.map((m) => m.toJSON()) }); });
      return out;
    },
    // 레이아웃 조각(piece) 중 문서 범위 [from,to)에 걸친 것들의 스타일
    piecesIn: (id, from, to) => {
      const out = [];
      for (const ln of T.ed(id).result.lines) for (const p of ln.pieces) if (!p.space && p.from < to && p.to > from) out.push({ text: p.text, style: p.style });
      return out;
    },
    // 렌더된 span의 계산된 스타일
    domStyle: (id, text) => {
      for (const sp of T.ed(id).frameEl.querySelectorAll('.piece')) if (sp.textContent === text) {
        const cs = getComputedStyle(sp);
        return { weight: cs.fontWeight, style: cs.fontStyle, deco: cs.textDecorationLine, color: cs.color, size: cs.fontSize };
      }
      return null;
    },
    hist: () => ({ done: __app.history.done.length, undone: __app.history.undone.length }),
    focused: () => { for (const [id, ed] of __app.editors) if (document.activeElement === ed.input) return id; return null; },
    clipWriteHTML: async (html, text) => {
      const item = { 'text/html': new Blob([html], { type: 'text/html' }) };
      if (text != null) item['text/plain'] = new Blob([text], { type: 'text/plain' });
      await navigator.clipboard.write([new ClipboardItem(item)]);
    },
    clipRead: async () => {
      const out = {};
      for (const it of await navigator.clipboard.read()) for (const t of it.types) out[t] = await (await it.getType(t)).text();
      return out;
    },
  };
})()
"""

MARK_CASES = [
    ('bold', None, lambda s: s['fontWeight'] == 700),
    ('italic', None, lambda s: s['italic'] is True),
    ('weight', {'value': 300}, lambda s: s['fontWeight'] == 300),
    ('underline', {'style': 'wavy', 'color': '#2d7ff9', 'thickness': 2}, lambda s: s['underline'] == {'style': 'wavy', 'color': '#2d7ff9', 'thickness': 2}),
    ('strike', {'style': 'double', 'color': None, 'thickness': None}, lambda s: s['strike']['style'] == 'double'),
    ('overline', {'style': 'dotted', 'color': '#c00', 'thickness': None}, lambda s: s['overline']['style'] == 'dotted'),
    ('color', {'value': '#c0392b'}, lambda s: s['color'] == '#c0392b'),
    ('highlight', {'value': '#fff27a'}, lambda s: s['highlight'] == '#fff27a'),
    ('size', {'value': 24}, lambda s: s['fontSize'] == 24),
    ('font', {'value': 'Georgia, serif'}, lambda s: s['fontFamily'] == 'Georgia, serif'),
    ('spacing', {'value': 3}, lambda s: s['letterSpacing'] == 3),
    ('lineHeight', {'value': 2.2}, lambda s: s['lineHeight'] == 2.2),
    ('stroke', {'width': 2, 'color': '#222'}, lambda s: s['stroke'] == {'width': 2, 'color': '#222'}),
    ('shadow', {'value': '2px 2px 0 #9ad'}, lambda s: s['shadow'] == '2px 2px 0 #9ad'),
    ('gradient', {'value': 'linear-gradient(90deg, #e1306c, #833ab4)'}, lambda s: s['gradient'] == 'linear-gradient(90deg, #e1306c, #833ab4)'),
]

with sync_playwright() as p:
    b = p.chromium.launch()
    ctx = b.new_context(viewport={'width': 1240, 'height': 1300})
    origin = f'http://127.0.0.1:{srv.server_port}'
    ctx.grant_permissions(['clipboard-read', 'clipboard-write'], origin=origin)
    pg = ctx.new_page()
    pg.route('**/fonts.googleapis.com/**', lambda r: r.abort())
    errors = []
    pg.on('pageerror', lambda e: errors.append(str(e)))
    pg.on('console', lambda m: m.type == 'error' and 'ERR_FAILED' not in m.text and errors.append(m.text))  # Google Fonts 차단은 의도됨
    pg.goto(origin + '/demo.html')
    pg.wait_for_function('window.__app && window.__app.ready', timeout=30000)
    pg.evaluate(JS_HELPERS)
    cdp = ctx.new_cdp_session(pg)
    E = lambda js: pg.evaluate(js)
    key = pg.keyboard.press

    def ime(text):
        """음절마다 조합 → 확정(실제 IME처럼 자모 단계를 거침: 마지막 글자만 조합 표시)"""
        for ch in text:
            if ch == ' ':
                pg.keyboard.type(' ')
                continue
            cdp.send('Input.imeSetComposition', {'text': ch, 'selectionStart': 1, 'selectionEnd': 1})
            cdp.send('Input.insertText', {'text': ch})

    def click_text(fid, text, frac=0.5):
        r = E(f"""(() => {{ for (const ln of T.ed('{fid}').result.lines) for (const q of ln.pieces) if (q.text === {json.dumps(text)}) return {{ x: q.x + q.w * {frac}, y: q.top + q.h / 2 }}; return null; }})()""")
        pt = E(f"T.page('{fid}', {r['x']}, {r['y']})")
        pg.mouse.click(pt['x'], pt['y'])

    # =========================================================
    # A. 마크 명령·단축키
    # =========================================================
    fid = 'donut'
    E(f"T.reset('{fid}')")

    # A1. 더블클릭으로 단어 선택 → Ctrl+B → 굵게, 다시 Ctrl+B → 해제
    pc = E(f"(() => {{ for (const ln of T.ed('{fid}').result.lines) for (const q of ln.pieces) if (q.text === '문단은') return {{ x: q.x + q.w / 2, y: q.top + q.h / 2 }}; }})()")
    pt = E(f"T.page('{fid}', {pc['x']}, {pc['y']})")
    pg.mouse.dblclick(pt['x'], pt['y'])
    s = E(f"T.sel('{fid}')")
    key('Control+b')
    st = E(f"T.ed('{fid}').markState('bold')")
    ps = E(f"T.piecesIn('{fid}', {s['from']}, {s['to']})")
    dom = E(f"T.domStyle('{fid}', '문단은')")
    check('A1 더블클릭 + Ctrl+B → 굵게(문서·레이아웃·DOM 모두)', st['state'] == 'all' and all(x['style']['fontWeight'] == 700 for x in ps) and dom and dom['weight'] == '700', {'st': st, 'dom': dom})
    key('Control+b')
    check('A1 Ctrl+B 다시 → 해제', E(f"T.ed('{fid}').markState('bold').state") == 'none' and E(f"T.domStyle('{fid}', '문단은').weight") == '400')

    # A2. 일부만 굵은 범위('굵게, 기울임') → Ctrl+B → 전체 굵게 (워드 규칙)
    E(f"T.select('{fid}', '굵게, 기울임')")
    before = E(f"T.ed('{fid}').markState('bold').state")
    key('Control+b')
    after = E(f"T.ed('{fid}').markState('bold').state")
    check('A2 일부만 굵은 범위 → Ctrl+B → 전체 굵게', before == 'some' and after == 'all', {'before': before, 'after': after})

    # A3. Ctrl+I / Ctrl+U / Ctrl+Shift+X
    r = E(f"T.select('{fid}', '레이아웃 엔진의')")
    key('Control+i'); key('Control+u'); key('Control+Shift+x')
    ps = E(f"T.piecesIn('{fid}', {r[0]}, {r[1]})")
    ok = ps and all(x['style']['italic'] and x['style']['underline'] and x['style']['strike'] for x in ps)
    dom = E(f"T.domStyle('{fid}', '레이아웃')")
    check('A3 Ctrl+I, Ctrl+U, Ctrl+Shift+X → 기울임·밑줄·취소선', ok and dom['style'] == 'italic' and 'underline' in dom['deco'] and 'line-through' in dom['deco'], dom)

    # A4. 한글 입력 상태의 Ctrl+B (e.key = 'ㅠ', 물리 키 KeyB)
    r = E(f"T.select('{fid}', '확인하기')")
    for t in ['rawKeyDown', 'keyUp']:
        cdp.send('Input.dispatchKeyEvent', {'type': t, 'key': 'ㅠ', 'code': 'KeyB', 'windowsVirtualKeyCode': 66, 'modifiers': 2})
    check('A4 한글 자판 상태 Ctrl+B(key=ㅠ) → 물리 키로 인식해 굵게', E(f"T.ed('{fid}').markState('bold').state") == 'all')

    # A5. 빈 선택에서 Ctrl+B → 이어서 입력하는 글자가 굵게 (영문 + 한글 조합, 조합 중 미리보기도 굵게)
    rr = E(f"T.find('{fid}', '예시')")
    E(f"T.caretAt('{fid}', {rr[0]})")
    key('Control+b')
    pg.keyboard.type('xy')
    cdp.send('Input.imeSetComposition', {'text': '한', 'selectionStart': 1, 'selectionEnd': 1})
    comp_bold = E(f"""(() => {{ const ed = T.ed('{fid}'); const at = {rr[0]} + 2; for (const ln of ed.result.lines) for (const q of ln.pieces) if (q.from <= at && at < q.to) return q.style.fontWeight; return null; }})()""")
    cdp.send('Input.insertText', {'text': '한'})
    m = E(f"T.marksIn('{fid}', {rr[0]}, {rr[0] + 3})")
    check('A5 빈 선택 Ctrl+B → 입력 글자 굵게(조합 미리보기 포함)', comp_bold == 700 and all(any(k['type'] == 'bold' for k in x['m']) for x in m) and ''.join(x['t'] for x in m) == 'xy한', {'m': m, 'comp': comp_bold})

    # A6. 15종 마크 적용(API) → 문서 마크 + 레이아웃 스타일 반영
    E(f"T.reset('{fid}')")
    bad = []
    for name, attrs, pred in MARK_CASES:
        r = E(f"T.select('{fid}', '예시 텍스트입니다')")
        E(f"T.ed('{fid}').setMark('{name}', {json.dumps(attrs)})")
        ms = E(f"T.marksIn('{fid}', {r[0]}, {r[1]})")
        ps = E(f"T.piecesIn('{fid}', {r[0]}, {r[1]})")
        if not ms or not all(any(k['type'] == name for k in x['m']) for x in ms) or not ps or not all(pred(x['style']) for x in ps):
            bad.append({'mark': name, 'marks': ms[:1], 'style': ps[:1]})
    check('A6 마크 15종 적용 → 문서·레이아웃 스타일 반영', not bad, bad)
    v = E("__app.verifyAll()")['donut']
    check('A6 15종 동시 적용 상태 렌더 검증(측정 오차·영역 이탈·금칙)', v['maxWidthErrPx'] < 0.1 and v['pixelsOutsideMask'] == 0 and v['intervalOverruns'] == 0 and v['kinsokuViolations'] == 0, v)
    pg.screenshot(path=os.path.join(OUT, 'stage3-marks.png'), clip={'x': 20, 'y': 60, 'width': 600, 'height': 640})

    # A7. bold ↔ weight 배타
    r = E(f"T.select('{fid}', '굵게')")
    E(f"T.ed('{fid}').setMark('weight', {{ value: 300 }})")
    ms = E(f"T.marksIn('{fid}', {r[0]}, {r[1]})")
    check('A7 굵게 글자에 weight 300 → bold 제거, 300 적용', all([k['type'] for k in x['m']].count('bold') == 0 and any(k['type'] == 'weight' for k in x['m']) for x in ms), ms)

    # A8. 크기 단계: 기본 16 → 18 → 20 → 18, 섞인 범위(30 포함)는 각자 다음 단계
    E(f"T.reset('{fid}')")
    r = E(f"T.select('{fid}', '크기가 다른')")
    key('Control+Shift+Period'); a = E(f"T.piecesIn('{fid}', {r[0]}, {r[1]})")[0]['style']['fontSize']
    key('Control+Shift+Period'); b2 = E(f"T.piecesIn('{fid}', {r[0]}, {r[1]})")[0]['style']['fontSize']
    key('Control+Shift+Comma'); c = E(f"T.piecesIn('{fid}', {r[0]}, {r[1]})")[0]['style']['fontSize']
    check('A8 Ctrl+Shift+> / < → 16→18→20→18', (a, b2, c) == (18, 20, 18), (a, b2, c))
    r = E(f"T.select('{fid}', '크기가 다른 큰 글씨')")
    key('Control+Shift+Period')
    sizes = sorted({x['style']['fontSize'] for x in E(f"T.piecesIn('{fid}', {r[0]}, {r[1]})")})
    check('A8 섞인 크기(18, 30) → 각자 한 단계(20, 32)', sizes == [20, 32], sizes)

    # A9. Ctrl+\ → 꾸밈 전부 해제
    r = E(f"T.select('{fid}', '굵게, 기울임, 색상, 형광펜')")
    key('Control+Backslash')
    ms = E(f"T.marksIn('{fid}', {r[0]}, {r[1]})")
    check('A9 Ctrl+\\ → 선택 범위 꾸밈 전부 해제', all(not x['m'] for x in ms), ms)

    # A10. 사용자 재지정: Mod-Shift-s → 취소선, 기존 Mod-Shift-x 해제
    E("(async () => { const K = await import('/src/keymap.js'); const km = K.createKeymap({ 'Mod-Shift-s': 'strike', 'Mod-Shift-x': null }); for (const ed of __app.editors.values()) ed.keymap = km; })()")
    r = E(f"T.select('{fid}', '기준선이')")
    key('Control+Shift+x')
    no = E(f"T.ed('{fid}').markState('strike').state")
    key('Control+Shift+s')
    yes = E(f"T.ed('{fid}').markState('strike').state")
    check('A10 단축키 재지정(Ctrl+Shift+S=취소선, Ctrl+Shift+X 해제)', no == 'none' and yes == 'all', (no, yes))
    E("for (const ed of __app.editors.values()) ed.keymap = __app.keymap")

    # =========================================================
    # B. 전역 되돌리기
    # =========================================================
    E(f"T.reset('{fid}')")
    j0 = E(f"T.json('{fid}')")

    # B1. 연속 한글 입력(공백 포함) → Ctrl+Z 한 번에 전부 취소, Ctrl+Shift+Z / Ctrl+Y로 복원
    rr = E(f"T.find('{fid}', '예시')")
    E(f"T.caretAt('{fid}', {rr[0]})")
    ime('안녕하세요 반갑습니다')
    typed = E(f"T.json('{fid}')")
    t_typed = E(f"T.text('{fid}')")
    h = E("T.hist()")
    key('Control+z')
    check('B1 연속 입력 "안녕하세요 반갑습니다" → 한 단위(스택 1개)', h['done'] == 1, h)
    check('B1 Ctrl+Z 1회 → 입력 전 문서와 동일', E(f"T.json('{fid}')") == j0)
    check('B1 되돌린 뒤 커서가 입력 시작 위치', E(f"T.sel('{fid}')")['head'] == rr[0])
    key('Control+Shift+z')
    ok1 = E(f"T.json('{fid}')") == typed
    key('Control+z'); key('Control+y')
    check('B1 Ctrl+Shift+Z / Ctrl+Y → 다시 실행', ok1 and E(f"T.json('{fid}')") == typed and '안녕하세요 반갑습니다예시' in t_typed)

    # B2. 쉬는 시간(>1초)이 있으면 묶음을 끊는다
    E(f"T.reset('{fid}')")
    E(f"T.caretAt('{fid}', {rr[0]})")
    pg.keyboard.type('ab'); time.sleep(1.15); pg.keyboard.type('cd')
    key('Control+z')
    check('B2 1초 넘게 쉬고 입력 → 별도 단위(cd만 취소)', 'ab예시' in E(f"T.text('{fid}')") and 'abcd' not in E(f"T.text('{fid}')"))

    # B3. 커서를 옮기고 입력하면 새 단위
    E(f"T.reset('{fid}')")
    E(f"T.caretAt('{fid}', {rr[0]})")
    pg.keyboard.type('ab'); key('ArrowLeft'); pg.keyboard.type('x')
    t1 = E(f"T.text('{fid}')")
    key('Control+z'); t2 = E(f"T.text('{fid}')")
    key('Control+z'); t3 = E(f"T.text('{fid}')")
    check('B3 커서 이동 후 입력 → 별도 단위', 'axb예시' in t1 and 'ab예시' in t2 and E(f"T.json('{fid}')") == j0, (t1[:0], ))

    # B4. 입력과 삭제는 서로 다른 단위, 연속 Backspace는 한 단위
    E(f"T.reset('{fid}')")
    E(f"T.caretAt('{fid}', {rr[0]})")
    pg.keyboard.type('abc'); key('Backspace'); key('Backspace')
    key('Control+z'); t1 = E(f"T.text('{fid}')")
    key('Control+z')
    check('B4 입력 abc + Backspace 2회 → Ctrl+Z: bc 복원, 다시 Ctrl+Z: abc 제거', 'abc예시' in t1 and E(f"T.json('{fid}')") == j0)

    # B5. 선택 위 한글 입력(선택 삭제 + 입력) → 한 단위, 되돌리면 선택까지 복원
    E(f"T.reset('{fid}')")
    r = E(f"T.select('{fid}', '레이아웃 엔진의')")
    ime('가나')
    key('Control+z')
    s = E(f"T.sel('{fid}')")
    check('B5 선택 위 입력 → Ctrl+Z 1회로 원문·선택 복원', E(f"T.json('{fid}')") == j0 and s['from'] == r[0] and s['to'] == r[1], s)

    # B6. 마크 적용 되돌리기
    r = E(f"T.select('{fid}', '레이아웃 엔진의')")
    key('Control+b'); key('Control+z')
    s = E(f"T.sel('{fid}')")
    check('B6 Ctrl+B → Ctrl+Z → 마크 제거, 선택 유지', E(f"T.json('{fid}')") == j0 and (s['from'], s['to']) == tuple(r))

    # B7. 전역 스택: donut 입력 → alpha 입력 → (alpha에서) Ctrl+Z 2회 → alpha, donut 순서로 취소 + 포커스 이동
    E("T.reset('alpha')"); E(f"T.reset('{fid}')")
    ja = E("T.json('alpha')")
    E(f"T.caretAt('{fid}', {rr[0]})"); pg.keyboard.type('DDD')
    ra = E("T.find('alpha', '예시')"); E(f"T.caretAt('alpha', {ra[0]})"); pg.keyboard.type('AAA')
    key('Control+z')
    step1 = (E("T.json('alpha')") == ja, 'DDD' in E(f"T.text('{fid}')"))
    key('Control+z')
    check('B7 전역 스택: 두 프레임 입력을 최근 순서대로 취소', step1 == (True, True) and E(f"T.json('{fid}')") == j0, step1)
    check('B7 다른 프레임의 변경을 되돌리면 그 프레임으로 포커스 이동', E("T.focused()") == fid, E("T.focused()"))

    # B8. 편집기 밖(문서 본문)에 포커스가 있어도 Ctrl+Z가 전역 스택에 닿음
    E(f"T.reset('{fid}')")
    E(f"T.caretAt('{fid}', {rr[0]})"); pg.keyboard.type('zz')
    E("document.activeElement.blur(); document.body.focus()")
    key('Control+z')
    check('B8 편집기 밖에서 Ctrl+Z → 전역 되돌리기', E(f"T.json('{fid}')") == j0)

    # B9. 조합 중에 되돌리기 버튼 클릭 → 조합 확정 후 취소, 조합 상태가 남지 않음
    E(f"T.reset('{fid}')")
    E(f"T.caretAt('{fid}', {rr[0]})")
    ime('가'); time.sleep(1.1)  # '가'는 별도 단위
    cdp.send('Input.imeSetComposition', {'text': '나', 'selectionStart': 1, 'selectionEnd': 1})
    bx = pg.locator('#undo').bounding_box()
    pg.mouse.click(bx['x'] + bx['width'] / 2, bx['y'] + bx['height'] / 2)
    t = E(f"T.text('{fid}')")
    comp = E(f"T.ed('{fid}').comp")
    log = E(f"T.ed('{fid}').log.slice(-4)")
    pg.keyboard.type('z')
    t2 = E(f"T.text('{fid}')")
    check('B9 조합 중 되돌리기 버튼 → 조합 글자 취소, "가"는 유지, 조합 상태 없음, 이후 입력 정상',
          '가예시' in t and '가나' not in t and comp is None and '가z예시' in t2,
          {'comp': comp, 'log': log, 'around': t[t.find('예시') - 3: t.find('예시') + 2], 'after': t2[t2.find('예시') - 3: t2.find('예시') + 2]})

    # B10. 입력창 자체 되돌리기(메뉴 → historyUndo)도 전역 스택으로
    E(f"T.reset('{fid}')")
    E(f"T.caretAt('{fid}', {rr[0]})"); pg.keyboard.type('mm')
    E(f"T.ed('{fid}').input.dispatchEvent(new InputEvent('beforeinput', {{ inputType: 'historyUndo', cancelable: true, bubbles: true }}))")
    check('B10 beforeinput historyUndo → 전역 되돌리기', E(f"T.json('{fid}')") == j0)

    # =========================================================
    # C. 복사/붙여넣기
    # =========================================================
    E(f"T.reset('{fid}')"); E("T.reset('alpha')")

    # C1. 선택 없이 Ctrl+C → 클립보드 유지
    E("navigator.clipboard.writeText('KEEP')")
    E(f"T.caretAt('{fid}', {rr[0]})")
    key('Control+c')
    check('C1 빈 선택 Ctrl+C → 클립보드 그대로', E("navigator.clipboard.readText()") == 'KEEP')

    # C2. 꾸밈 섞인 범위 복사 → 시스템 클립보드에 text/plain + text/html
    r = E(f"T.select('{fid}', '굵게, 기울임, 색상, 형광펜, 물결 밑줄')")
    src_slice = E(f"T.ed('{fid}').state.selection.content().toJSON()")
    key('Control+c')
    clip = E("T.clipRead()")
    check('C2 Ctrl+C → 시스템 클립보드 text/plain', clip.get('text/plain') == '굵게, 기울임, 색상, 형광펜, 물결 밑줄', clip.get('text/plain'))
    html = clip.get('text/html', '')
    check('C2 text/html에 외부용 인라인 서식 + 내부용 슬라이스', '<strong>' in html and '<em>' in html and ('color: #c0392b' in html or 'color: rgb(192, 57, 43)' in html) and 'wavy' in html and 'data-le-slice' in html, html[html.find('<p'):][:900])

    # C3. 다른 프레임에 Ctrl+V → 마크까지 정확히 같은 내용
    rb = E("T.find('alpha', '예시')")
    E(f"T.caretAt('alpha', {rb[0]})")
    key('Control+v')
    pg.wait_for_timeout(100)
    got = E(f"T.ed('alpha').state.doc.slice({rb[0]}, {rb[0]} + {r[1] - r[0]}).toJSON()")
    check('C3 다른 프레임에 Ctrl+V → 마크 포함 내용 동일', got['content'] == src_slice['content'][0]['content'], {'got': got, 'src': src_slice})
    key('Control+z')
    check('C3 붙여넣기 → Ctrl+Z 1회로 취소', E("T.json('alpha')") == E("T.initial.alpha"))

    # C4. Ctrl+X → 잘라내기, Ctrl+Z로 복원
    r = E(f"T.select('{fid}', '크기가 다른')")
    key('Control+x')
    cut_ok = '크기가 다른' not in E(f"T.text('{fid}')") and E("navigator.clipboard.readText()") == '크기가 다른'
    key('Control+z')
    check('C4 Ctrl+X → 삭제 + 클립보드, Ctrl+Z → 복원', cut_ok and E(f"T.json('{fid}')") == j0)

    # C5. 문단 경계와 이미지를 포함한 범위 복사 → 다른 프레임에 붙여넣기 → 이미지 배치
    E(f"""(() => {{ const ed = T.ed('{fid}'); const a = T.find('{fid}', '쪼갭니다.')[0]; const z = T.find('{fid}', '문단 사이 이미지')[1];
        ed.focus(); ed.setSelection(T.PS.TextSelection.create(ed.state.doc, a, z)); }})()""")
    src_slice = E(f"T.ed('{fid}').state.selection.content().toJSON()")
    key('Control+c')
    E("T.reset('alpha')")
    imgs0 = E("T.ed('alpha').result.images.length")
    paras0 = E("T.ed('alpha').state.doc.childCount")
    rb = E("T.find('alpha', '예시')")
    E(f"T.caretAt('alpha', {rb[0]})")
    key('Control+v')
    pg.wait_for_timeout(150)
    imgs1 = E("T.ed('alpha').result.images.length")
    paras1 = E("T.ed('alpha').state.doc.childCount")
    check('C5 문단+이미지 범위 붙여넣기 → 이미지 노드 추가·배치, 블록 수 +2', paras1 == paras0 + 2 and imgs1 == imgs0 + 1, {'paras': (paras0, paras1), 'imgs': (imgs0, imgs1)})

    # C6. 외부 HTML(기본 모드: 굵게·기울임·선 종류만 유지, 색·크기 버림, div/p는 문단)
    E("T.reset('alpha')")
    ext = ('<meta charset="utf-8"><p>외부 <b>굵음</b> <i>기움</i> <span style="color:red;font-size:30px">빨강</span> '
           '<u>밑줄</u> <s>취소</s> <span style="text-decoration: underline wavy #00f">물결</span></p>'
           '<p style="text-align:center">둘째</p><div>셋째</div><div>넷째<br>줄바꿈</div>'
           '<b style="font-weight:normal" id="docs-internal-guid-1"><span style="font-weight:700">구글굵게</span><span>구글보통</span></b>')
    E(f"T.clipWriteHTML({json.dumps(ext)}, 'plain fallback')")
    rb = E("T.find('alpha', '예시')")
    E(f"T.caretAt('alpha', {rb[0]})")
    paras0 = E("T.ed('alpha').state.doc.childCount")
    key('Control+v')
    pg.wait_for_timeout(100)
    def marks_of(fid_, s_):
        rr_ = E(f"T.find('{fid_}', {json.dumps(s_)})")
        if not rr_: return None
        ms_ = E(f"T.marksIn('{fid_}', {rr_[0]}, {rr_[1]})")
        return sorted({k['type'] for x in ms_ for k in x['m']})
    got = {w: marks_of('alpha', w) for w in ['굵음', '기움', '빨강', '밑줄', '취소', '물결', '구글굵게', '구글보통']}
    exp = {'굵음': ['bold'], '기움': ['italic'], '빨강': [], '밑줄': ['underline'], '취소': ['strike'], '물결': ['underline'], '구글굵게': ['bold'], '구글보통': []}
    wave = E("(() => { const r = T.find('alpha', '물결'); return T.marksIn('alpha', r[0], r[1])[0].m[0].attrs; })()")
    check('C6 외부 HTML(기본) → 굵게·기울임·밑줄·취소선만 유지, 색·크기 버림, 구글 문서 감싸기 처리', got == exp and wave['style'] == 'wavy', {'got': got, 'wave': wave})
    ptext = E("T.text('alpha')")
    check('C6 외부 HTML 문단 구조(p, div, br) 유지', E("T.ed('alpha').state.doc.childCount") == paras0 + 4 and '넷째\n줄바꿈' in ptext and '\n둘째\n셋째\n' in ptext, {'paras': (paras0, E("T.ed('alpha').state.doc.childCount"))})

    # C7. 외부 HTML(전체 모드) → 색·크기도 유지
    E("T.reset('alpha')"); E("T.ed('alpha').externalMarks = 'all'")
    E(f"T.caretAt('alpha', {rb[0]})")
    key('Control+v'); pg.wait_for_timeout(100)
    rr2 = E("T.find('alpha', '빨강')")
    ms = E(f"T.marksIn('alpha', {rr2[0]}, {rr2[1]})")[0]['m']
    E("T.ed('alpha').externalMarks = 'basic'")
    check('C7 외부 HTML(전체 모드) → 색·크기 유지', {'type': 'color', 'attrs': {'value': 'red'}} in ms and {'type': 'size', 'attrs': {'value': 30}} in ms, ms)

    # C8. Ctrl+Shift+V → 같은 클립보드를 서식 없이(텍스트)
    E("T.reset('alpha')")
    E(f"T.clipWriteHTML('<b>서식있음</b>', '서식있음')")
    E(f"T.caretAt('alpha', {rb[0]})")
    key('Control+Shift+v'); pg.wait_for_timeout(100)
    rr2 = E("T.find('alpha', '서식있음')")
    check('C8 Ctrl+Shift+V → 서식 없이 텍스트만', rr2 and not E(f"T.marksIn('alpha', {rr2[0]}, {rr2[1]})")[0]['m'])

    # C9. 여러 줄 텍스트 → 문단으로, 글자는 커서 위치의 꾸밈을 이어받음
    E(f"T.reset('{fid}')")
    E("navigator.clipboard.writeText('첫줄\\r\\n둘째줄\\n\\n넷째줄')")
    rr2 = E(f"T.find('{fid}', '굵게')")
    E(f"T.caretAt('{fid}', {rr2[0] + 1})")
    paras0 = E(f"T.ed('{fid}').state.doc.childCount")
    key('Control+v'); pg.wait_for_timeout(100)
    rr3 = E(f"T.find('{fid}', '둘째줄')")
    ms = E(f"T.marksIn('{fid}', {rr3[0]}, {rr3[1]})")
    check('C9 여러 줄 텍스트 → 문단 3개 추가(빈 줄 포함), 굵게 이어받음', E(f"T.ed('{fid}').state.doc.childCount") == paras0 + 3 and ms[0]['m'] == [{'type': 'bold'}] and '굵첫줄\n둘째줄\n\n넷째줄게' in E(f"T.text('{fid}')"), ms)

    # C10. 이미지 파일 붙여넣기(시스템 클립보드 image/png)
    E("T.reset('alpha')")
    E("""(async () => { const c = new OffscreenCanvas(80, 40); const x = c.getContext('2d'); x.fillStyle = '#3a7'; x.fillRect(0, 0, 80, 40);
        const blob = await c.convertToBlob({ type: 'image/png' }); await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]); })()""")
    imgs0 = E("T.ed('alpha').result.images.length")
    E("T.caretAt('alpha', T.find('alpha', '문단은')[0])")
    key('Control+v'); pg.wait_for_timeout(300)
    im = E("T.ed('alpha').result.images.map(i => ({ w: i.w, h: i.h, src: i.src.slice(0, 5) }))")
    check('C10 이미지 파일 붙여넣기 → 이미지 노드 삽입·배치(80×40)', len(im) == imgs0 + 1 and any(i['w'] == 80 and i['h'] == 40 and i['src'] == 'blob:' for i in im), im)
    key('Control+z')
    check('C10 이미지 붙여넣기 Ctrl+Z → 취소', E("T.json('alpha')") == E("T.initial.alpha"))

    # C11. toDOM ↔ parseDOM 대칭: 15종 마크 + 문단 속성을 HTML로 내보내고(슬라이스 속성 제거 = 외부 프로그램 경유 상황)
    #      전체 모드로 다시 읽으면 같은 문서
    rt = E("""(() => {
      const { schema } = T.SC; const bad = [];
      const cases = %s;
      for (const [name, attrs] of cases) {
        const para = schema.nodes.paragraph.create({ align: 'center', indent: 12, spacing: 6, style: { fontSize: 20 } },
          [schema.text('앞'), schema.text('글자', [schema.marks[name].create(attrs)]), schema.text('뒤')]);
        const slice = new T.PM.Slice(T.PM.Fragment.from(para), 0, 0);
        const html = T.CB.sliceToHTML(slice).replace(/ data-le-slice="[^"]*"/, '');
        const back = T.CB.parseHTML(html, { externalMarks: 'all' }).slice;
        // 색·그림자·그라디언트는 브라우저가 표기를 바꾸므로(#222 → #222222, 순서 재배열) 같은 CSS 값으로 계산되는지 비교
        const PROP = { color: 'color', highlight: 'background-color', font: 'font-family', shadow: 'text-shadow', gradient: 'background-image' };
        const el = document.createElement('span');
        const norm = (prop, v) => { if (v == null || typeof v !== 'string') return v; el.style.setProperty(prop, v); const r = el.style.getPropertyValue(prop); el.style.removeProperty(prop); return r; };
        const canon = (frag) => JSON.stringify(frag.toJSON(), (k, v) => {
          if (v && typeof v === 'object' && v.type && v.attrs && T.SC.schema.marks[v.type]) {
            const a = { ...v.attrs };
            if (PROP[v.type]) a.value = norm(PROP[v.type], a.value);
            if ('color' in a && v.type !== 'color') a.color = norm('color', a.color);
            return { type: v.type, attrs: a };
          }
          return v;
        });
        const a = canon(slice.content), b = canon(back.content);
        if (a !== b) bad.push({ name, a, b, html });
      }
      return bad;
    })()""" % json.dumps([[n, a] for n, a, _ in MARK_CASES]))
    check('C11 HTML 내보내기 → 다시 읽기 대칭(마크 15종 + 문단 속성, 슬라이스 속성 없이)', not rt, rt[:3])

    # C12. 복잡한 작업 순서 전체를 되돌리면 처음 문서, 전부 다시 실행하면 마지막 문서
    E(f"T.reset('{fid}')")
    E(f"T.caretAt('{fid}', {rr[0]})")
    ime('테스트'); key('Enter'); pg.keyboard.type('abc')
    E(f"T.select('{fid}', '문단은')"); key('Control+b'); key('Control+i')
    E(f"T.select('{fid}', '크기가')"); key('Control+c')
    E(f"T.caretAt('{fid}', T.find('{fid}', '금칙')[0])"); key('Control+v'); pg.wait_for_timeout(50)
    E(f"T.select('{fid}', '영역이 끝날')"); key('Backspace')
    key('Control+Shift+Period')
    jf = E(f"T.json('{fid}')")
    n = E("T.hist().done")
    for _ in range(n): key('Control+z')
    back0 = E(f"T.json('{fid}')") == j0
    for _ in range(n): key('Control+Shift+z')
    check(f'C12 섞인 작업 {n}단위 전부 되돌리기 = 처음, 전부 다시 실행 = 마지막', back0 and E(f"T.json('{fid}')") == jf, {'n': n, 'back0': back0})

    # D. 성능: 기록이 추가된 뒤 입력 1회당 갱신 비용
    E(f"T.reset('invert')")
    E("T.caretAt('invert', T.find('invert', '문단은')[0])")
    E("T.ms = []; { const ed = T.ed('invert'); const o = ed.update.bind(ed); ed.update = () => { o(); T.ms.push(ed.lastUpdateMs); }; }")
    t0 = time.time()
    pg.keyboard.type('가나다라마바사아자차카타파하' * 3)
    ms = E("T.ms")
    avg = sum(ms) / len(ms); mx = max(ms)
    check(f'D 입력 1회당 갱신 평균 {avg:.2f}ms, 최대 {mx:.2f}ms (목표 16ms)', mx < 16, {'n': len(ms)})
    check('D 연속 입력 42자 → 되돌리기 1단위', E("T.hist().done") == 1, E("T.hist()"))

    v = E("__app.verifyAll()")
    ok = all(x['pixelsOutsideMask'] == 0 and x['intervalOverruns'] == 0 and x['maxWidthErrPx'] < 0.1 and x['kinsokuViolations'] == 0 for x in v.values())
    check('E 전체 작업 후 렌더 검증(영역 이탈 0, 측정 오차, 금칙)', ok, v if not ok else '')

    pg.mouse.click(5, 5)
    pg.screenshot(path=os.path.join(OUT, 'stage3-after.png'), full_page=True)
    b.close()

srv.shutdown()
fails = [r for r in results if not r[1]]
for name, ok, detail in results:
    print(('PASS ' if ok else 'FAIL ') + name + ('' if ok else '  ' + json.dumps(detail, ensure_ascii=False)[:700]))
print('page errors:', errors)
print(f'{len(results) - len(fails)}/{len(results)} passed')
