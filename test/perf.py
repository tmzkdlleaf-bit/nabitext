"""성능 측정: 무거운 프로젝트(20장, 장마다 요소 약 30개, 여러 장에 걸친 긴 글, 이미지 외곽선 글상자, 공통 장·쪽 번호, 장 목록 미리보기)에서
입력·끌기·크기 바꾸기·확대/이동·마우스 올리기·영역 선택·장 전환·되돌리기·자동 저장을 사람 속도(약 60Hz)로 해 보고,
프레임 간격(끊김)과 메인 스레드 작업 시간을 잰다.

사용: python3 test/perf.py [--json 결과.json] [--check] [--only 이름,이름] [--loaf]
  --check: 기준(아래 BUDGET)을 넘으면 실패로 표시(회귀 검사용)
  --only: 그 장면만 잰다   --loaf: 긴 프레임마다 어디서 시간을 썼는지 찍는다

지표
  frame_p95 / frame_max: requestAnimationFrame 간격(ms). 60Hz면 16.7. 25ms를 넘으면 한 프레임 이상 밀린 것(drops25)
  task_ms: 동작 하나당 메인 스레드 작업 시간 평균(CDP Performance TaskDuration 차이 / 동작 수)
  loaf: 50ms 넘는 긴 프레임(Long Animation Frame) 수, loaf_max: 그중 가장 긴 것(ms)
  loaf_work: 그 가운데 앱이 스크립트·그리기로 30ms 넘게 일한 것(앱 탓인 긴 프레임)
  evt_max: 키·클릭 입력부터 화면에 반영될 때까지(Event Timing) 가장 긴 시간(ms)
"""
import json, os, sys, time, threading, functools, statistics
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from playwright.sync_api import sync_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
class Quiet(SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
srv = ThreadingHTTPServer(('127.0.0.1', 0), functools.partial(Quiet, directory=ROOT))
threading.Thread(target=srv.serve_forever, daemon=True).start()
ORIGIN = f'http://127.0.0.1:{srv.server_port}'

# 기준(넘으면 --check에서 실패). 헤드리스 가상 화면 기준이라 실제 기기보다 여유를 둔다
# loaf_work: 긴 프레임(50ms 넘음) 가운데 앱이 실제로 일한 시간(스크립트 + 그리기)이 30ms를 넘은 것.
#   2코어 시험 기계에서는 메인 스레드가 아무 일도 안 하고 CPU를 기다리다 생기는 긴 프레임이 가끔 섞이므로 그것은 빼고 센다.
BUDGET = {'frame_p95': 20, 'drops25': 2, 'loaf_work': 0, 'evt_max': 50}

BUILD = r"""
(async () => {
  const N = __nabi, V = N.view, M = N.M;
  const blob = async (w, h, draw) => { const c = new OffscreenCanvas(w, h); draw(c.getContext('2d'), w, h); return c.convertToBlob({ type: 'image/png' }); };
  const photo = await N.assets.add(await blob(1600, 1200, (x, W, H) => { const g = x.createLinearGradient(0, 0, W, H); g.addColorStop(0, '#f60'); g.addColorStop(1, '#06f'); x.fillStyle = g; x.fillRect(0, 0, W, H); for (let i = 0; i < 300; i++) { x.fillStyle = `hsl(${i * 7},70%,60%)`; x.fillRect((i * 97) % W, (i * 53) % H, 40, 40); } }));
  const star = await N.assets.add(await blob(800, 800, (x, W, H) => { x.fillStyle = '#2b3a66'; x.beginPath(); for (let i = 0; i < 10; i++) { const a = -Math.PI / 2 + i * Math.PI / 5, r = i % 2 ? W * 0.2 : W * 0.48; x.lineTo(W / 2 + Math.cos(a) * r, H / 2 + Math.sin(a) * r); } x.closePath(); x.fill(); }));
  const S = '여러 장에 걸쳐 이어지는 긴 글입니다. 성능 측정을 위해 충분히 긴 문장을 반복합니다. Performance test text with Latin words mixed in. ';
  const para = (t) => ({ type: 'paragraph', content: [{ type: 'text', text: t }] });
  const longDoc = { type: 'doc', content: Array.from({ length: 40 }, (_, i) => para(S.repeat(3) + i)) };
  const mid = { type: 'doc', content: [para(S.repeat(3))] };
  const pages = [];
  const storyId = 'longstory';
  for (let pi = 0; pi < 20; pi++) {
    const pg = M.newPage({ w: 1080, h: 1080 });
    const els = pg.elements;
    for (let i = 0; i < 12; i++) els.push(M.makeElement('shape', { shape: ['rect', 'ellipse', 'star'][i % 3], sides: 5, x: 40 + (i % 6) * 170, y: 700 + Math.floor(i / 6) * 170, w: 140, h: 140, fill: i % 2 ? '#d9d4ff' : { type: 'linear', angle: 45, stops: [{ o: 0, c: '#ff0000' }, { o: 1, c: '#0000ff' }] } }));
    for (let i = 0; i < 6; i++) els.push(M.makeElement('path', { x: 60 + i * 160, y: 620, w: 140, h: 60, d: 'M0 30C30 0 60 60 90 30S140 0 140 30', pw: 140, ph: 60, stroke: '#333', strokeWidth: 3 }));
    for (let i = 0; i < 4; i++) els.push(M.makeElement('image', { src: photo.url, x: 600 + (i % 2) * 230, y: 40 + Math.floor(i / 2) * 180, w: 220, h: 165, filters: i === 0 ? { blur: 1 } : undefined }));
    els.push(M.makeElement('text', { x: 40, y: 40, w: 520, h: 520, style: { fontSize: 20 }, story: pi < 6 ? storyId : undefined, seq: 0, ...(pi === 0 ? { id: storyId, story: undefined, doc: longDoc } : {}) }));
    els.push(M.makeElement('text', { x: 600, y: 400, w: 440, h: 180, style: { fontSize: 18 }, doc: mid }));
    els.push(M.makeElement('text', { x: 600, y: 590, w: 200, h: 40, style: { fontSize: 16 }, doc: { type: 'doc', content: [para('짧은 글')] } }));
    els.push(M.makeElement('text', { x: 820, y: 880, w: 220, h: 180, style: { fontSize: 12 }, area: { kind: 'image', src: star.url, mode: 'alpha' }, doc: mid }));
    els.push(M.makeElement('pathText', { x: 600, y: 900, w: 200, h: 140, d: 'M0 70C50 0 150 0 200 70', pw: 200, ph: 140, text: '경로를 따라 쓰는 글자', offset: 0 }));
    pages.push(pg);
  }
  N.app.project.pages = pages;
  // 공통 장: 머리띠 + 쪽 번호(모든 장에 깔림)
  const master = { ...M.newPage({ w: 1080, h: 1080, background: 'transparent' }), name: '공통 장', kind: 'master' };
  master.elements.push(M.makeElement('shape', { x: 0, y: 1040, w: 1080, h: 40, fill: '#2b3a66' }));
  master.elements.push(M.makeElement('text', { x: 900, y: 1046, w: 160, h: 30, padding: 0, style: { fontSize: 16, color: '#ffffff' }, doc: { type: 'doc', content: [para('{쪽} / {전체쪽}')] } }));
  N.app.project.master = master;
  N.app.current = null;
  N.app.switchPage(pages[0]);
  N.history.clear();
  N.flush();
  // 모든 장을 한 번씩 준비(이미지 외곽선 영역·편집기 생성)해 두고 첫 장으로
  for (const p of pages) { N.app.switchPage(p); await new Promise((r) => setTimeout(r, 30)); }
  N.app.switchPage(pages[0]);
  await new Promise((r) => setTimeout(r, 300));
  // 측정기
  window.PERF = {
    frames: [], loaf: [], events: [], on: false,
    start() {
      this.frames = []; this.loaf = []; this.events = [];
      let last = performance.now();
      this.on = true;
      const tick = (t) => { this.frames.push(t - last); last = t; if (this.on) requestAnimationFrame(tick); };
      requestAnimationFrame((t) => { last = t; requestAnimationFrame(tick); });
    },
    stop() { this.on = false; },
  };
  new PerformanceObserver((l) => { for (const e of l.getEntries()) { PERF.loaf.push(e.duration); (PERF.loafInfo ||= []).push({ d: Math.round(e.duration), render: Math.round(e.renderStart ? e.startTime + e.duration - e.renderStart : 0), style: Math.round(e.styleAndLayoutStart ? e.startTime + e.duration - e.styleAndLayoutStart : 0), scripts: e.scripts.map((x) => [x.invoker, x.sourceFunctionName, (x.sourceURL || '').split('/').pop(), Math.round(x.duration), Math.round(x.forcedStyleAndLayoutDuration)]) }); } }).observe({ type: 'long-animation-frame', buffered: false });
  new PerformanceObserver((l) => { for (const e of l.getEntries()) PERF.events.push([e.name, e.duration]); }).observe({ type: 'event', durationThreshold: 16, buffered: false });
  return { pages: pages.length, elements: pages.reduce((a, p) => a + p.elements.length, 0), story: V.editors.get(storyId)?.members.length };
})()
"""

def main():
    out_json = sys.argv[sys.argv.index('--json') + 1] if '--json' in sys.argv else None
    check = '--check' in sys.argv
    res = {}
    with sync_playwright() as p:
        b = p.chromium.launch(args=['--disable-lcd-text'])
        ctx = b.new_context(viewport={'width': 1500, 'height': 1000})
        pg = ctx.new_page()
        pg.route('**/fonts.googleapis.com/**', lambda r: r.abort())
        pg.goto(ORIGIN + '/index.html')
        pg.wait_for_function('window.__nabi && window.__nabi.ready', timeout=30000)
        time.sleep(0.3)
        if pg.evaluate("!!document.querySelector('.modal-bg')"): pg.click('.modal-bg [data-v=discard]')
        cdp = ctx.new_cdp_session(pg)
        cdp.send('Performance.enable')
        info = pg.evaluate(BUILD)
        E = pg.evaluate
        mouse, kb = pg.mouse, pg.keyboard
        C = lambda x, y: E(f"__nabi.view.pageToClient({{ x: {x}, y: {y} }})")
        def task_s(): return next(m['value'] for m in cdp.send('Performance.getMetrics')['metrics'] if m['name'] == 'TaskDuration')

        only = sys.argv[sys.argv.index('--only') + 1].split(',') if '--only' in sys.argv else None
        def scenario(name, n, fn, setup=None):
            if only and name not in only: return
            if setup: setup()
            time.sleep(0.3)
            E("PERF.start()"); time.sleep(0.1)
            t0 = task_s()
            fn()
            time.sleep(0.4)
            t1 = task_s()
            E("PERF.stop()")
            fr = E("PERF.frames"); lo = E("PERF.loaf"); ev = E("PERF.events")
            fr = fr[2:] or [0]
            r = {
                'actions': n,
                'task_ms': round((t1 - t0) * 1000 / max(1, n), 2),
                'frame_p95': round(sorted(fr)[int(len(fr) * 0.95) - 1] if len(fr) > 1 else fr[0], 1),
                'frame_max': round(max(fr), 1),
                'drops25': sum(1 for f in fr if f > 25),
                'loaf': len(lo), 'loaf_max': round(max(lo), 1) if lo else 0,
                'loaf_work': E(f"PERF.loafInfo ? PERF.loafInfo.slice(-{len(lo)}).filter((x) => x.render + x.scripts.reduce((a, s) => a + s[3], 0) > 30).length : 0") if lo else 0,
                'evt_max': round(max([d for _, d in ev]), 1) if ev else 0,
            }
            if '--events' in sys.argv and ev: print('   EV', sorted(ev, key=lambda x: -x[1])[:5])
            if '--loaf' in sys.argv and lo: print('   ', json.dumps(E("PERF.loafInfo.slice(-" + str(len(lo)) + ")"), ensure_ascii=False))
            res[name] = r
            print(f"{name:28s} " + ' '.join(f"{k}={v}" for k, v in r.items()), flush=True)

        def paced_moves(pts, dt=0.016):
            for x, y in pts:
                mouse.move(x, y); time.sleep(dt)

        V = "__nabi.view"
        # 1. 긴 글(6장에 걸친 이야기) 가운데 입력
        def setup_type_long():
            E(f"{V}.select(['longstory'])"); kb.press('Enter')
            E(f"(() => {{ const ed = {V}.editors.get('longstory'); const TS = ed.state.selection.constructor; ed.setSelection(TS.create(ed.state.doc, 200)); }})()")
        def type_n(n):
            def f():
                for i in range(n):
                    kb.insert_text('가나다라마바사'[i % 7]); time.sleep(0.03)
            return f
        scenario('type_long_story', 40, type_n(40), setup_type_long)
        kb.press('Escape')
        # 2. 이미지 외곽선 글상자 입력
        def setup_type_area():
            ids = E(f"{V}.page.elements.filter((n) => n.area).map((n) => n.id)")
            E(f"{V}.select(['{ids[0]}'])"); kb.press('Enter')
        scenario('type_area_frame', 30, type_n(30), setup_type_area)
        kb.press('Escape')
        # 3. 요소 끌기
        def drag_el():
            a = C(110, 770); mouse.move(a['x'], a['y']); mouse.down()
            paced_moves([(a['x'] + i * 4, a['y'] + i * 2) for i in range(1, 61)])
            mouse.up()
        scenario('drag_shape', 60, drag_el, lambda: E(f"{V}.select([])"))
        # 4. 긴 글 글상자 크기 바꾸기(오른쪽 아래 핸들)
        def resize_text():
            E(f"{V}.select(['longstory'])")
            h = E(f"(() => {{ const n = {V}.node('longstory'); return {V}.pageToClient({{ x: n.x + n.w, y: n.y + n.h }}); }})()")
            mouse.move(h['x'], h['y']); mouse.down()
            paced_moves([(h['x'] + i * 2, h['y'] + i) for i in range(1, 41)])
            mouse.up()
        scenario('resize_long_text', 40, resize_text)
        # 5. 이미지 외곽선 글상자 크기 바꾸기
        def resize_area():
            ids = E(f"{V}.page.elements.filter((n) => n.area).map((n) => n.id)")
            E(f"{V}.select(['{ids[0]}'])")
            h = E(f"(() => {{ const n = {V}.node('{ids[0]}'); return {V}.pageToClient({{ x: n.x, y: n.y }}); }})()")
            mouse.move(h['x'], h['y']); mouse.down()
            paced_moves([(h['x'] - i, h['y'] - i) for i in range(1, 41)])
            mouse.up()
        scenario('resize_area_frame', 40, resize_area)
        # 6. 휠 확대·이동
        def wheel():
            c = C(540, 540); mouse.move(c['x'], c['y'])
            for i in range(20):
                kb.down('Control'); mouse.wheel(0, -40 if i < 10 else 40); kb.up('Control'); time.sleep(0.016)
            for i in range(20):
                mouse.wheel(0, 30); time.sleep(0.016)
        scenario('wheel_zoom_pan', 40, wheel, lambda: E(f"{V}.select([]); {V}.zoomFit()"))
        # 7. 마우스 올리기(요소 위를 지나감)
        def hover():
            pts = []
            for i in range(80):
                q = C(40 + (i * 13) % 1000, 40 + (i * 29) % 1000); pts.append((q['x'], q['y']))
            paced_moves(pts)
        scenario('hover', 80, hover, lambda: E(f"{V}.select([]); {V}.zoomFit()"))
        # 8. 영역 선택(빈 곳에서 끌어 많은 요소를 덮음)
        def marquee():
            a = C(1075, 1075); mouse.move(a['x'], a['y']); mouse.down()
            paced_moves([(a['x'] - i * 18, a['y'] - i * 18) for i in range(1, 61)])
            mouse.up()
        scenario('marquee_select', 60, marquee, lambda: E(f"{V}.select([])"))
        # 9. 모두 선택 후 끌기
        def drag_all():
            a = C(110, 770); mouse.move(a['x'], a['y']); mouse.down()
            paced_moves([(a['x'] + i * 2, a['y'] + i) for i in range(1, 41)])
            mouse.up()
        scenario('drag_all', 40, drag_all, lambda: E(f"{V}.run('selectAll')"))
        # 10. 장 전환
        def switch():
            for i in range(10):
                E(f"__nabi.app.switchPage(__nabi.app.project.pages[{(i + 1) % 20}])"); time.sleep(0.05)
        scenario('switch_pages', 10, switch, lambda: E(f"{V}.select([])"))
        E("__nabi.app.switchPage(__nabi.app.project.pages[0])")
        # 11. 되돌리기·다시 실행(끌기 여러 번 기록 후)
        def undo_redo():
            for i in range(8): E("__nabi.history.undo()"); time.sleep(0.03)
            for i in range(8): E("__nabi.history.redo()"); time.sleep(0.03)
        def setup_undo():
            for i in range(8): E(f"(() => {{ const n = {V}.page.elements[{i}]; {V}.select([n.id]); {V}.nudge(5, 0); }})()")
        scenario('undo_redo', 16, undo_redo, setup_undo)
        # 12. 자동 저장(복구용 사본)
        def autosave():
            E("(async () => { __nabi.app.dirty = true; await __nabi.autosave(); })()")
        scenario('autosave', 1, autosave)
        # 13. 글상자 선택(속성 패널 다시 그림)
        def select_text():
            ids = E(f"{V}.page.elements.filter((n) => n.type === 'text').map((n) => n.id)")
            for i in range(10): E(f"{V}.select(['{ids[i % len(ids)]}'])"); time.sleep(0.03)
        scenario('select_text_frames', 10, select_text)
        b.close()
    print('project:', json.dumps(info, ensure_ascii=False))
    if out_json: json.dump(res, open(out_json, 'w'), ensure_ascii=False, indent=1)
    if check:
        bad = [(n, k, r[k]) for n, r in res.items() for k, lim in BUDGET.items() if r.get(k, 0) > lim]
        for n, k, v in bad: print(f'OVER {n} {k}={v} (기준 {BUDGET[k]})')
        print('PERF OK' if not bad else f'PERF {len(bad)}개 기준 초과')

main()
