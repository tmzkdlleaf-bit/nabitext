"""Chromium에서 데모를 열고 검증 결과와 스크린샷을 남긴다.
사용: python3 test/run.py  (proto 폴더 기준)
"""
import json, os, sys, threading, functools
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from playwright.sync_api import sync_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'test', 'out')
os.makedirs(OUT, exist_ok=True)

class Quiet(SimpleHTTPRequestHandler):
    def log_message(self, *a): pass

srv = ThreadingHTTPServer(('127.0.0.1', 0), functools.partial(Quiet, directory=ROOT))
threading.Thread(target=srv.serve_forever, daemon=True).start()
url = f'http://127.0.0.1:{srv.server_port}/demo.html'

with sync_playwright() as p:
    b = p.chromium.launch()
    pg = b.new_page(viewport={'width': 1240, 'height': 1300})
    pg.route('**/fonts.googleapis.com/**', lambda r: r.abort())  # 오프라인: 로컬 폰트로 폴백
    errors = []
    pg.on('pageerror', lambda e: errors.append(str(e)))
    pg.on('console', lambda m: m.type == 'error' and errors.append(m.text))
    pg.goto(url)
    pg.wait_for_function('window.__app && window.__app.ready', timeout=30000)
    pg.wait_for_timeout(300)

    results = {}
    for size in [16, 13, 22]:
        pg.evaluate(f"(async()=>{{const s=document.getElementById('size'); s.value={size}; await s.oninput();}})()")
        pg.wait_for_timeout(200)
        results[size] = pg.evaluate('window.__app.verifyAll()')
    pg.evaluate("(async()=>{const s=document.getElementById('size'); s.value=16; await s.oninput();})()")
    pg.wait_for_timeout(200)
    pg.screenshot(path=os.path.join(OUT, 'frames.png'), full_page=True)
    pg.check('#debug')
    pg.wait_for_timeout(200)
    pg.screenshot(path=os.path.join(OUT, 'frames-debug.png'), full_page=True)
    b.close()

print(json.dumps({'errors': errors, 'results': results}, ensure_ascii=False, indent=1))
srv.shutdown()
