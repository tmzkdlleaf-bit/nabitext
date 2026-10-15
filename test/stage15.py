"""15단계 검증: 장 크기 고르기(용지·SNS), 기본 글로그 틀.
사용: python3 test/stage15.py  (proto 폴더 기준). V=1이면 항목마다 결과를 바로 찍는다.
"""
import json, os, io, time, base64, threading, functools
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from playwright.sync_api import sync_playwright
from PIL import Image

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

with sync_playwright() as p:
    b = p.chromium.launch(args=['--disable-lcd-text'])
    pg = b.new_page(viewport={'width': 1600, 'height': 1000})
    errors = []
    pg.route('**/fonts.googleapis.com/**', lambda r: r.abort())
    pg.on('pageerror', lambda e: errors.append(str(e)))
    pg.on('console', lambda m: m.type == 'error' and 'ERR_FAILED' not in m.text and errors.append(m.text))
    pg.goto(ORIGIN + '/index.html')
    pg.wait_for_function('window.__nabi && window.__nabi.ready', timeout=30000)
    time.sleep(0.3)
    if pg.evaluate("!!document.querySelector('.modal-bg')"): pg.click('.modal-bg [data-v=discard]')
    E = lambda js, arg=None: pg.evaluate(js, arg) if arg is not None else pg.evaluate(js)
    E("window.__S = import('/app/sizes.js'); window.__G = import('/app/glog-templates.js'); true")
    size = lambda: E("[__nabi.view.page.w, __nabi.view.page.h]")
    def pick(id_):
        E("__nabi.view.select([]); __nabi.flush()")
        E(f"(() => {{ const s = document.querySelector('#props select[data-field=\"크기\"]'); s.value = '{id_}'; s.dispatchEvent(new Event('change')); __nabi.flush(); }})()")
        time.sleep(0.1)

    # ============ Z. 장 크기 ============
    opts = E("[...document.querySelectorAll('#props select[data-field=\"크기\"] option')].map((o) => o.textContent)")
    check('Z1 장 속성에 "크기" 고르기: SNS 6종 + 종이 9종 + 직접 입력, 지금 크기(1080×1080)가 "정사각"으로 보임',
          len(opts) >= 16 and any('A4' in o for o in opts) and any('9:16' in o for o in opts) and E("document.querySelector('#props select[data-field=\"크기\"]').value") == 'sq', opts)
    pick('a4')
    a4 = size()
    check('Z2 정사각에서 A4 → 본래 방향(세로) 794×1123px(96dpi: PDF 쪽 크기 = A4)', a4 == [794, 1123], a4)
    E("[...document.querySelectorAll('#props button')].find((b) => b.textContent === '가로·세로 바꾸기').click()"); time.sleep(0.1)
    check('Z3 "가로·세로 바꾸기" → 1123×794, 크기 칸은 그대로 A4', size() == [1123, 794] and E("document.querySelector('#props select[data-field=\"크기\"]').value") == 'a4', size())
    pick('b5')
    check('Z4 가로인 채 B5를 고르면 가로 방향 유지(971×688)', size() == [971, 688], size())
    pick('story')
    check('Z5 SNS 세로 9:16 → 1080×1920(가로였으면 가로로: 1920×1080)', size() in ([1920, 1080],), size())
    E("__nabi.history.undo(); __nabi.history.undo(); __nabi.flush()")
    check('Z6 크기 바꾸기는 되돌리기 한 단위씩', size() == [1123, 794], size())
    pts = E("[__nabi.view.page.w * 0.75, __nabi.view.page.h * 0.75]")
    check('Z7 A4 가로 장의 PDF 쪽 크기(1px = 0.75pt) ≈ 842×595pt(A4 가로, 0.5pt 이내)', abs(pts[0] - 841.89) < 0.5 and abs(pts[1] - 595.28) < 0.5, pts)

    # ============ G. 기본 글로그 틀 ============
    E("__nabi.app.templates.open()"); time.sleep(0.5)
    cards = E("[...document.querySelectorAll('.tpl-builtin .tpl-item')].map((c) => [c.dataset.glog, c.querySelector('.tpl-name').textContent, !!c.querySelector('svg')])")
    pg.screenshot(path=os.path.join(OUT, 'stage15-templates.png'))
    heads = E("[...document.querySelectorAll('.tpl-tabs button')].map((p) => p.textContent)")
    E("document.querySelector('.tpl-tabs [data-sec=photo]').click()"); time.sleep(0.2)
    pg.screenshot(path=os.path.join(OUT, 'stage15-templates-photo.png'))
    tabok = E("!document.querySelector('.tpl-list[data-sec=photo]').hidden && document.querySelector('.tpl-list[data-sec=text]').hidden")
    E("document.querySelector('.tpl-tabs [data-sec=text]').click()")
    check('G1 템플릿 창 맨 위 기본 틀 18종(탭: 글 위주 11 / 사진이 들어가는 틀 7), 각각 그림 미리보기', len(cards) == 18 and all(c[2] for c in cards) and len(heads) == 2 and tabok, [heads, tabok, cards])
    E("document.querySelector('.tpl-builtin [data-glog=novel] [data-act=glog]').click()"); time.sleep(0.6)
    check('G2 "새 장으로" → 창이 닫히고 그 틀로 새 장(지금 장 뒤), 장 이름 = 틀 이름', not E("!!document.querySelector('.modal-bg')") and E("__nabi.app.current.name") == '소설 페이지' and size() == [1080, 1528], [E("__nabi.app.current.name"), size()])
    ids = [c[0] for c in cards]
    rep = {}
    for i in ids:
        r = E("""async (id) => { const pg = await __nabi.app.insertGlog(id); await new Promise((r) => setTimeout(r, 250)); __nabi.flush();
          const V = __nabi.view, M = __nabi.M;
          const texts = [], slots = [];
          M.walk(pg.elements, (n) => { if (n.type === 'text') texts.push(n); if (n.slot) slots.push(n); });
          const over = [...new Set(texts.map((n) => V.editorOf(n)))].filter((ed) => ed && ed.overflow != null).length;
          const empty = texts.filter((n) => { const ed = V.editorOf(n); return ed && !ed.text.trim(); }).map((n) => n.name);
          const imgsOk = slots.every((n) => n.type === 'image' && __nabi.assets.ofUrl(n.src));
          return { w: pg.w, h: pg.h, texts: texts.length, over, empty, slots: slots.length, imgsOk, cur: __nabi.app.current === pg }; }""", i)
        rep[i] = r
    bad = {k: v for k, v in rep.items() if v['over'] or not v['imgsOk'] or not v['cur'] or v['empty']}
    check('G3 18종 모두 새 장으로: 글이 상자 밖으로 넘치지 않음(제목처럼 짧은 글이 사라지지 않음), 사진 자리는 이미지 슬롯', not bad, bad or rep)
    col = E("""(async () => { await __nabi.app.insertGlog('news'); await new Promise((r) => setTimeout(r, 250)); const V = __nabi.view; let c1 = null;
      __nabi.M.walk(V.page.elements, (n) => { if (n.name === '본문 1단') c1 = n; }); const ed = V.editorOf(c1);
      return { frames: ed.members.length, lines: (ed.results || []).map((r) => r.lines.length) }; })()""")
    check('G4 신문 기사: 본문 2단이 이어진 글상자(1단에서 넘친 글이 2단으로 흘러감)', col['frames'] == 2 and all(n > 3 for n in col['lines']), col)
    # 사진 형식: 글이 사진을 피해 흐르는지(글 조각이 사진 상자와 겹치지 않음), 원 둘레는 한 줄에 구간이 둘, 실루엣은 그림 모양 안
    fl = E("""(async () => { const out = {}; const V = __nabi.view, G = await import('/app/geom.js');
      for (const id of ['wrap', 'round', 'silhouette']) { await __nabi.app.insertGlog(id); await new Promise((r) => setTimeout(r, 400));
        let tb = null, ph = null; __nabi.M.walk(V.page.elements, (n) => { if (n.type === 'text' && n.area) tb = n; if (n.type === 'image') ph = n; });
        const ed = V.editorOf(tb); const r = ed.results[0];
        const pieces = r.lines.flatMap((l) => l.pieces.filter((p) => p.text.trim()).map((p) => ({ x: tb.x + p.x, y: tb.y + p.top, w: p.w, h: p.h })));
        const hit = ph ? pieces.filter((p) => p.x < ph.x + ph.w && p.x + p.w > ph.x && p.y < ph.y + ph.h && p.y + p.h > ph.y).length : null;
        const bands = new Map(); for (const l of r.lines) { const k = Math.round(l.y); bands.set(k, (bands.get(k) || 0) + 1); }
        out[id] = { pieces: pieces.length, overlapPhoto: hit, twoPerBand: [...bands.values()].filter((v) => v >= 2).length, area: tb.area.kind, mask: ph?.mask?.kind || null, over: ed.overflow != null }; }
      return out; })()""")
    check('G4b 글이 사진을 감싸기: 글 조각이 사진 상자와 겹치지 않음(사진 둘레로 흐름)', fl['wrap']['pieces'] > 50 and fl['wrap']['overlapPhoto'] == 0, fl['wrap'])
    check('G4c 둥근 사진 + 둘레 글: 사진은 원 마스크, 원 높이의 줄은 양옆 두 구간으로 나뉨', fl['round']['mask'] == 'shape' and fl['round']['twoPerBand'] >= 5, fl['round'])
    check('G4d 실루엣 안에 글: 글상자 모양 = 이미지 외곽선, 글이 채워짐', fl['silhouette']['area'] == 'image' and fl['silhouette']['pieces'] > 100, fl['silhouette'])
    # 사진 자리에 사진 넣기 → 그 자리에 채워짐
    r = E("""(async () => { await __nabi.app.insertGlog('profile'); const V = __nabi.view; let slot = null; __nabi.M.walk(V.page.elements, (n) => { if (n.slot && n.type === 'image') slot = n; });
      const c = new OffscreenCanvas(300, 400); const x = c.getContext('2d'); x.fillStyle = '#f60'; x.fillRect(0, 0, 300, 400);
      const b0 = { x: slot.x, y: slot.y, w: slot.w, h: slot.h };
      await V.replaceImage(slot.id, await c.convertToBlob({ type: 'image/png' })); const n = V.node(slot.id);
      return { same: n.x === b0.x && n.y === b0.y && n.w === b0.w && n.h === b0.h, fit: n.fit, changed: !__nabi.assets.ofUrl(n.src)?.name?.includes('사진 자리') }; })()""")
    check('G5 사진 자리에 사진 바꿔 넣기 → 같은 상자에 채우기(cover)', r['same'] and r['fit'] == 'cover' and r['changed'], r)
    # 되돌리기 한 번 = 틀 장 빼기
    n0 = E("__nabi.app.project.pages.length")
    E("__nabi.app.insertGlog('quote')"); time.sleep(0.3)
    n1 = E("__nabi.app.project.pages.length")
    E("__nabi.history.undo()"); time.sleep(0.2)
    check('G6 틀로 만든 장은 되돌리기 한 번에 빠짐', n1 == n0 + 1 and E("__nabi.app.project.pages.length") == n0, [n0, n1])
    # 출력: 각 틀 PNG(화면과 같은 렌더러) + 저장·다시 열기
    shots = []
    for i in ids:
        u = E("""async (id) => { await __nabi.app.insertGlog(id); await new Promise((r) => setTimeout(r, 200)); const EX = await import('/src/export.js'); return (await EX.rasterize(__nabi.view.exportPage(), { scale: 0.4 })).toDataURL(); }""", i)
        shots.append(Image.open(io.BytesIO(base64.b64decode(u.split(',', 1)[1]))).convert('RGB'))
    W = 6 * 440; rows = [shots[i:i + 6] for i in range(0, len(shots), 6)]
    sheet = Image.new('RGB', (W, sum(max(s.height for s in r) for r in rows) + 20), '#777')
    y = 0
    for r in rows:
        x = 0
        for s in r: sheet.paste(s, (x, y)); x += 440
        y += max(s.height for s in r) + 10
    sheet.save(os.path.join(OUT, 'stage15-glog.png'))
    nonblank = [len(set(s.resize((40, 40)).getdata())) > 3 for s in shots]
    check('G7 18종 모두 PNG로 내보내짐(빈 그림 아님)', all(nonblank), nonblank)
    saved = E("""(async () => { const { bytes } = await __nabi.P.toZip(__nabi.app.project, { assets: __nabi.assets, docOf: __nabi.view.docOf, swatches: [] }); let s = ''; for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000)); return btoa(s); })()""")
    before = E("JSON.stringify(__nabi.app.project.pages.map((p) => [p.name, p.w, p.h, p.elements.length]))")
    E("(b) => __nabi.openBytes(Uint8Array.from(atob(b), (c) => c.charCodeAt(0)), null, '틀.nabi')", saved); time.sleep(1.5)
    after = E("JSON.stringify(__nabi.app.project.pages.map((p) => [p.name, p.w, p.h, p.elements.length]))")
    check('G8 틀로 만든 장들 저장 → 다시 열기: 장 이름·크기·요소 수 같음', before == after, [before[:200], after[:200]])
    b.close()

# Windows에서 git이 줄 끝을 CRLF로 바꿔 받아도 CSP 해시가 같아야 함(다르면 import map이 막혀 화면이 비어 버림)
import subprocess as _sp
_h = _sp.run(['node', '-e', "const {cspFor}=require(process.argv[1]); const fs=require('fs'); const t=fs.readFileSync(process.argv[2],'utf8'); process.stdout.write(String(cspFor(t)===cspFor(t.replace(/\\r?\\n/g,'\\r\\n'))))", os.path.join(ROOT, 'electron', 'csp.js'), os.path.join(ROOT, 'index.html')], capture_output=True, text=True).stdout
check('W1 index.html 줄 끝이 CRLF(Windows)여도 CSP의 import map 해시가 같음', _h == 'true', _h)
fails = [r for r in results if not r[1]]
for n, ok, d in results: print(('PASS ' if ok else 'FAIL ') + n + ('' if ok else '\n     ' + json.dumps(d, ensure_ascii=False, default=str)[:1500]))
print('page errors:', errors[:8])
print(f'{len(results) - len(fails)}/{len(results)} passed')
