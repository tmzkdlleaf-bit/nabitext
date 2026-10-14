"""2단계 편집 검증. Chromium + CDP로 실제 입력 이벤트(마우스, 키, IME 조합)를 발생시킨다.
사용: python3 test/edit.py  (proto 폴더 기준)
"""
import json, os, threading, functools
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
window.T = {
  ed: (id) => __app.editors.get(id),
  sel: (id) => { const s = T.ed(id).state.selection; return { from: s.from, to: s.to, head: s.head, anchor: s.anchor, node: s.constructor.name }; },
  text: (id) => T.ed(id).text,
  // 프레임 로컬 좌표 → 페이지 좌표
  page: (id, x, y) => { const r = T.ed(id).frameEl.getBoundingClientRect(); return { x: r.left + x, y: r.top + y }; },
  // 조각 텍스트로 위치 찾기
  findPiece: (id, text) => {
    const m = T.ed(id).mapper;
    for (const ln of m.lines) for (const p of ln.pieces) if (p.text === text) return { x: p.x, top: p.top, h: p.h, w: p.w, from: p.from, to: p.to, lineY: ln.y };
    return null;
  },
  caret: (id) => { const c = T.ed(id).caret; return c && { x: c.x, top: c.top, h: c.h }; },
  lineOf: (id, pos, assoc) => { const m = T.ed(id).mapper; const ln = m.lines[m.lineIndex(pos, assoc)]; return { y: ln.y, x0: ln.x0, x1: ln.x1, from: ln.from, to: ln.to }; },
  // 모든 줄의 모든 글자 경계에서 좌표→위치 왕복
  roundTrip: (id) => {
    const m = T.ed(id).mapper, seg = new Intl.Segmenter('ko', { granularity: 'grapheme' });
    let n = 0, bad = [];
    for (const ln of m.lines) {
      const stops = new Set([ln.from, ln.to]);
      for (const p of ln.pieces) { stops.add(p.from); for (const s of seg.segment(p.text)) stops.add(p.from + s.index + s.segment.length); }
      for (const pos of stops) {
        if (pos < ln.from || pos > ln.to) continue;
        const assoc = pos === ln.to && pos !== ln.from ? -1 : 1;
        const c = m.coordsAt(pos, assoc);
        const back = m.posAt(c.x, ln.y + ln.h / 2);
        n++;
        if (!back || back.pos !== pos) bad.push([pos, back && back.pos]);
      }
    }
    return { n, bad: bad.slice(0, 10), badCount: bad.length };
  },
  inputBox: (id) => { const e = T.ed(id); const s = e.input.style; return { x: parseFloat(s.left), top: parseFloat(s.top), focused: document.activeElement === e.input }; },
  overlayCount: (id, cls) => T.ed(id).overlay.querySelectorAll('.' + cls).length,
  paraCount: (id) => T.ed(id).state.doc.childCount,
};
"""

with sync_playwright() as p:
    b = p.chromium.launch()
    ctx = b.new_context(viewport={'width': 1240, 'height': 1300})
    pg = ctx.new_page()
    pg.route('**/fonts.googleapis.com/**', lambda r: r.abort())
    errors = []
    pg.on('pageerror', lambda e: errors.append(str(e)))
    pg.goto(f'http://127.0.0.1:{srv.server_port}/demo.html')
    pg.wait_for_function('window.__app && window.__app.ready', timeout=30000)
    pg.evaluate(JS_HELPERS)
    cdp = ctx.new_cdp_session(pg)
    E = lambda js: pg.evaluate(js)

    # 1) 좌표 ↔ 위치 왕복 (4개 프레임 전체)
    for fid in ['donut', 'alpha', 'colorKey', 'invert']:
        r = E(f"T.roundTrip('{fid}')")
        check(f'왕복 매핑 [{fid}] {r["n"]}개 경계', r['badCount'] == 0, r)

    # 2) 클릭 → 커서 위치
    pc = E("T.findPiece('donut','레이아웃')")
    tx = pc['x'] + pc['w'] * 0.5 + 0.5  # '레이|아웃' 근처
    pt = E(f"T.page('donut', {tx}, {pc['top'] + pc['h']/2})")
    pg.mouse.click(pt['x'], pt['y'])
    s = E("T.sel('donut')")
    check('클릭 → 커서가 해당 단어 안', pc['from'] < s['head'] < pc['to'], {'piece': pc, 'sel': s})
    cr = E("T.caret('donut')")
    check('커서 표시 위치 = 클릭 지점(±글자 반 폭)', abs(cr['x'] - tx) <= pc['w'] / 8 + 1, {'caret': cr, 'click': tx})
    ib = E("T.inputBox('donut')")
    check('숨긴 입력창이 커서 위치로 이동 + 포커스', abs(ib['x'] - cr['x']) < 0.5 and abs(ib['top'] - cr['top']) < 0.5 and ib['focused'], ib)

    # 3) 영문 입력
    before = E("T.text('donut')")
    head = s['head']
    pg.keyboard.type('abc')
    after = E("T.text('donut')")
    check('영문 입력 abc가 커서 위치에 삽입', after.replace('abc', '', 1) == before and E("T.sel('donut')")['head'] == head + 3)

    # 4) 한글 IME 조합: ㅎ→하→한 확정, ㄱ→그→글 확정
    E("T.ed('donut').log.length = 0")
    base = E("T.text('donut')")
    head = E("T.sel('donut')")['head']
    for t in ['ㅎ', '하', '한']:
        cdp.send('Input.imeSetComposition', {'text': t, 'selectionStart': len(t), 'selectionEnd': len(t)})
    mid_doc = E("T.text('donut')")
    comp = E("T.ed('donut').comp && T.ed('donut').comp.text")
    underline = E("T.overlayCount('donut','ce-comp')")
    check('조합 중: 문서는 그대로, 화면에만 "한" 표시 + 밑줄', mid_doc == base and comp == '한' and underline >= 1, {'comp': comp, 'underline': underline})
    ib = E("T.inputBox('donut')"); cr = E("T.caret('donut')")
    check('조합 중 입력창이 조합 글자 끝을 따라감', abs(ib['x'] - cr['x']) < 0.5, {'input': ib, 'caret': cr})
    cdp.send('Input.insertText', {'text': '한'})
    for t in ['ㄱ', '그', '글']:
        cdp.send('Input.imeSetComposition', {'text': t, 'selectionStart': len(t), 'selectionEnd': len(t)})
    cdp.send('Input.insertText', {'text': '글'})
    after = E("T.text('donut')")
    log = E("T.ed('donut').log")
    check('IME 확정 결과 "한글"이 정확히 1회 삽입', after.count('abc한글') == 1 and len(after) == len(base) + 2, {'log': log})
    check('커서가 "한글" 뒤', E("T.sel('donut')")['head'] == head + 2)

    # 5) 조합 중 Enter: 확정 + 문단 나눔, 중복·유실 없음
    paras = E("T.paraCount('donut')")
    E("T.ed('donut').log.length = 0")
    cdp.send('Input.imeSetComposition', {'text': '끝', 'selectionStart': 1, 'selectionEnd': 1})
    pg.keyboard.press('Enter')
    t2 = E("T.text('donut')")
    log = E("T.ed('donut').log")
    check('조합 중 Enter → "끝" 1회 확정 + 문단 1개 추가', t2.count('abc한글끝') == 1 and E("T.paraCount('donut')") == paras + 1, {'log': log, 'paras': E("T.paraCount('donut')")})

    # 6) Backspace: 새 문단 합치기 → 음절 단위 삭제
    pg.keyboard.press('Backspace')
    check('Backspace(문단 시작) → 문단 합치기', E("T.paraCount('donut')") == paras)
    pg.keyboard.press('Backspace')
    check('Backspace → 음절 "끝" 통째로 삭제', 'abc한글끝' not in E("T.text('donut')") and 'abc한글' in E("T.text('donut')"))

    # 7) 이모지 조합 문자(grapheme) 하나를 방향키 한 번으로 넘기
    pg.keyboard.insert_text('👍🏽')
    h0 = E("T.sel('donut')")['head']
    pg.keyboard.press('ArrowLeft')
    h1 = E("T.sel('donut')")['head']
    check('← 한 번에 이모지(코드 단위 4개) 통째로 이동', h0 - h1 == 4, {'h0': h0, 'h1': h1})
    pg.keyboard.press('Shift+ArrowRight')
    pg.keyboard.press('Backspace')
    check('선택 후 Backspace → 이모지 삭제', '👍🏽' not in E("T.text('donut')"))

    # 8) ↓/↑: 도넛 왼쪽 구간에서 아래 띠로, 목표 x 유지
    pc = E("T.findPiece('donut','글자에')")
    pt = E(f"T.page('donut', {pc['x'] + 1}, {pc['top'] + pc['h']/2})")
    pg.mouse.click(pt['x'], pt['y'])
    c0 = E("T.caret('donut')"); l0 = E(f"T.lineOf('donut', T.sel('donut').head, 1)")
    pg.keyboard.press('ArrowDown')
    c1 = E("T.caret('donut')"); l1 = E(f"T.lineOf('donut', T.sel('donut').head, 1)")
    check('↓ → 바로 아래 띠, 같은 쪽(왼쪽) 구간', l1['y'] > l0['y'] and l1['x0'] < 280 and abs(c1['x'] - c0['x']) < 20, {'c0': c0, 'c1': c1, 'l0': l0, 'l1': l1})
    pg.keyboard.press('ArrowDown'); pg.keyboard.press('ArrowUp'); pg.keyboard.press('ArrowUp')
    c3 = E("T.caret('donut')")
    check('↓↓↑↑ 후 원래 위치 복귀(목표 x 유지)', abs(c3['x'] - c0['x']) < 0.5 and abs(c3['top'] - c0['top']) < 0.5, {'c0': c0, 'c3': c3})

    # 9) Home/End: 도넛 한 줄(구간) 단위
    pg.keyboard.press('End')
    s = E("T.sel('donut')"); ln = E("T.lineOf('donut', T.sel('donut').head, -1)")
    check('End → 현재 구간의 끝', s['head'] == ln['to'], {'sel': s, 'line': ln})
    pg.keyboard.press('Home')
    check('Home → 현재 구간의 시작', E("T.sel('donut')")['head'] == ln['from'])

    # 10) 드래그 선택
    a = E("T.findPiece('donut','크기가')"); z = E("T.findPiece('donut','높아진')")
    pa = E(f"T.page('donut', {a['x']}, {a['top'] + a['h']/2})"); pz = E(f"T.page('donut', {z['x'] + z['w']}, {z['top'] + z['h']/2})")
    pg.mouse.move(pa['x'], pa['y']); pg.mouse.down(); pg.mouse.move(pz['x'], pz['y'], steps=8); pg.mouse.up()
    s = E("T.sel('donut')")
    rects = E("T.overlayCount('donut','ce-sel')")
    check('드래그 → "크기가"~"높아진" 선택', s['from'] == a['from'] and s['to'] == z['to'] and rects >= 4, {'sel': s, 'rects': rects})
    pg.screenshot(path=os.path.join(OUT, 'edit-selection.png'), clip={'x': 20, 'y': 60, 'width': 600, 'height': 640})

    # 11) 선택 상태에서 IME 입력 → 선택 영역 대체
    before = E("T.text('donut')")
    cdp.send('Input.imeSetComposition', {'text': '가', 'selectionStart': 1, 'selectionEnd': 1})
    cdp.send('Input.insertText', {'text': '가'})
    after = E("T.text('donut')")
    check('선택 영역 위 한글 입력 → 대체', len(after) == len(before) - (s['to'] - s['from']) + 1 and E("T.overlayCount('donut','ce-sel')") == 0,
          {'before': len(before), 'after': len(after), 'sel': s})

    # 12) 이미지 클릭 → 노드 선택 → Delete로 삭제
    im = E("(() => { const i = T.ed('invert').result.images[0]; return i && { x: i.x, y: i.y, w: i.w, h: i.h }; })()")
    if im:
        pt = E(f"T.page('invert', {im['x'] + im['w']/2}, {im['y'] + im['h']/2})")
        pg.mouse.click(pt['x'], pt['y'])
        s = E("T.sel('invert')")
        check('이미지 클릭 → 노드 선택 + 테두리 표시', s['node'] == 'NodeSelection' and E("T.overlayCount('invert','ce-node')") == 1, s)
        pg.keyboard.press('Delete')
        check('Delete → 이미지 삭제', E("T.ed('invert').state.doc.toJSON().content.every(n => n.type !== 'image')"))
    else:
        check('이미지 노드 선택 테스트용 이미지가 배치됨', False, '넘침으로 이미지 미배치')

    # 13) 전체 선택 → 삭제 → 빈 문단에서 커서 표시 → 입력
    pc = E("T.findPiece('colorKey','문단은')")
    pt = E(f"T.page('colorKey', {pc['x']}, {pc['top'] + pc['h']/2})")
    pg.mouse.click(pt['x'], pt['y'])
    pg.keyboard.press('Control+a'); pg.keyboard.press('Backspace')
    c = E("T.caret('colorKey')")
    check('전체 삭제 후 빈 문단에 커서 표시', c is not None and E("T.text('colorKey')") == '' and E("T.overlayCount('colorKey','ce-caret')") == 1, c)
    pg.keyboard.type('new')
    check('빈 문단에 입력', E("T.text('colorKey')") == 'new')

    # 14) Shift+Enter: 강제 줄바꿈 → 새 줄에 커서, Enter: 새 문단
    y0 = E("T.caret('colorKey')")['top']
    pg.keyboard.press('Shift+Enter')
    y1 = E("T.caret('colorKey')")['top']
    check('Shift+Enter → 강제 줄바꿈, 커서가 다음 줄로', y1 > y0 + 5 and E("T.paraCount('colorKey')") == 1, {'y0': y0, 'y1': y1})
    pg.keyboard.type('x'); pg.keyboard.press('Enter'); pg.keyboard.type('y')
    check('Enter → 새 문단', E("T.paraCount('colorKey')") == 2 and E("T.text('colorKey')") == 'new\nx\ny')

    # 15) 입력 1회당 갱신 비용 (도넛, 전체 재배치 + 재렌더)
    pc = E("T.findPiece('invert','문단은')")
    pt = E(f"T.page('invert', {pc['x']}, {pc['top'] + pc['h']/2})")
    pg.mouse.click(pt['x'], pt['y'])
    E("T.ms = []; { const ed = T.ed('invert'); const o = ed.update.bind(ed); ed.update = () => { o(); T.ms.push(ed.lastUpdateMs); (T.lay=T.lay||[]).push(ed.lastLayoutMs); }; }")
    pg.keyboard.type('가나다라마바사아자차카타파하' * 3)
    ms = E("T.ms")
    avg = sum(ms) / len(ms); mx = max(ms)
    lay = E("T.lay"); print("MS", round(sum(ms)/len(ms),2), round(max(ms),1), 'LAYOUT', round(sum(lay)/len(lay),2), round(max(lay),1))
    check(f"입력 1회당 갱신 평균 {avg:.2f}ms, 최대 {mx:.2f}ms (목표 16ms)", mx < 16, {'n': len(ms)})

    # 16) 입력 후에도 1단계 검증(영역 이탈, 측정 오차, 금칙) 유지
    v = E("__app.verifyAll()")
    ok = all(x['pixelsOutsideMask'] == 0 and x['intervalOverruns'] == 0 and x['maxWidthErrPx'] < 0.1 and x['kinsokuViolations'] == 0 for x in v.values())
    check('편집 후 렌더 검증(영역 이탈 0, 측정 오차, 금칙)', ok, v if not ok else '')

    pg.mouse.click(5, 5)
    pg.screenshot(path=os.path.join(OUT, 'edit-after.png'), full_page=True)
    b.close()

srv.shutdown()
fails = [r for r in results if not r[1]]
for name, ok, detail in results:
    print(('PASS ' if ok else 'FAIL ') + name + ('' if ok else '  ' + json.dumps(detail, ensure_ascii=False)[:600]))
print('page errors:', errors)
print(f'{len(results) - len(fails)}/{len(results)} passed')
