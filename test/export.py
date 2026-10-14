"""4단계 출력 검증: PNG/JPG/WebP, 래스터 PDF, 벡터 PDF를 화면과 픽셀 단위로 대조한다.
사용: python3 test/export.py  (proto 폴더 기준, poppler-utils 필요: pdftoppm, pdfinfo, pdftotext, pdffonts, pdfimages)

비교 조건
 - Chromium을 --disable-lcd-text로 띄운다. 화면 글자는 기본으로 LCD용 서브픽셀 안티에일리어싱(글자 가장자리 색 번짐)이고,
   이미지 파일은 흑백 안티에일리어싱이 맞으므로 화면 쪽을 같은 방식으로 맞춘 뒤 비교한다.
 - 배율 s>1의 기준 화면은 transform: scale(s)로 확대한 화면이다. 출력은 1배 배치를 s배로 그리는 방식이고,
   Chrome은 '확대해 그린 글자'와 '기기 배율 s로 직접 그린 글자'를 화면에서도 다르게 그린다(측정값은 결과에 함께 기록).
"""
import json, os, io, time, base64, subprocess, tempfile, zipfile, threading, functools
from html import unescape as _html_unescape
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from playwright.sync_api import sync_playwright
from PIL import Image
import numpy as np

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'test', 'out')
os.makedirs(OUT, exist_ok=True)
TMP = tempfile.mkdtemp()

UPLOAD_FONT = '/usr/share/texmf/fonts/opentype/public/tex-gyre/texgyrecursor-regular.otf'
SHEET_FONT = '/usr/share/fonts/truetype/freefont/FreeSerifItalic.ttf'

class Quiet(SimpleHTTPRequestHandler):
    def log_message(self, *a): pass

srv = ThreadingHTTPServer(('127.0.0.1', 0), functools.partial(Quiet, directory=ROOT))
threading.Thread(target=srv.serve_forever, daemon=True).start()
ORIGIN = f'http://127.0.0.1:{srv.server_port}'

results = []
metrics = {}
def check(name, ok, detail=''):
    results.append((name, bool(ok), detail))

def img_from_dataurl(u):
    return Image.open(io.BytesIO(base64.b64decode(u.split(',', 1)[1])))

def compare(a, b, alpha=False):
    """a, b: PIL 이미지. max/비율은 채널별 최대 차이(0–255) 기준. nb = 1픽셀 이웃까지 허용한 차이."""
    mode = 'RGBA' if alpha else 'RGB'
    A = np.asarray(a.convert(mode)).astype(int); B = np.asarray(b.convert(mode)).astype(int)
    if A.shape != B.shape:
        return {'shape': [A.shape, B.shape]}
    d = np.abs(A - B).max(axis=2)
    nb = None
    for dy in (-1, 0, 1):
        for dx in (-1, 0, 1):
            e = np.abs(A - np.roll(np.roll(B, dy, 0), dx, 1)).max(axis=2)
            nb = e if nb is None else np.minimum(nb, e)
    nb = nb[1:-1, 1:-1]
    pct = lambda m: round(float(m.mean()) * 100, 4)
    return {'max': int(d.max()), 'mean': round(float(d.mean()), 3), 'pct16': pct(d > 16), 'pct64': pct(d > 64),
            'nb_max': int(nb.max()), 'nb_pct64': pct(nb > 64)}

# 화면과 '같음' 판정. Chromium 141까지는 완전 일치(16 넘게 다른 픽셀 0)였으나 Chrome 148 이후(Electron 44의 152 포함)는
# SVG 이미지 안 글자의 사선·곡선 획(/, (, :)과 선 장식(외곽선·물결 밑줄·취소선) 가장자리 안티에일리어싱이 화면과 조금 다르다.
# 위치는 같으므로 '1px 이웃 허용 64 초과'로 위치를, '16 초과 비율'로 가장자리 차이의 양을 제한한다.
def same_as_screen(m, nb=0.05, px16=0.3):
    return m.get('nb_pct64', 1) < nb and m.get('pct16', 100) < px16

def run(cmd):
    return subprocess.run(cmd, capture_output=True, text=True, check=True).stdout

def pdf_pages_png(path, dpi):
    prefix = os.path.join(TMP, os.path.basename(path) + f'-{dpi}')
    run(['pdftoppm', '-r', str(dpi), '-png', path, prefix])
    files = sorted(f for f in os.listdir(TMP) if f.startswith(os.path.basename(prefix) + '-'))
    return [Image.open(os.path.join(TMP, f)) for f in files]

def pdf_page_sizes(path):
    out = run(['pdfinfo', '-f', '1', '-l', '999', path])
    return [tuple(float(v) for v in l.split(':', 1)[1].split('pts')[0].split('x')) for l in out.splitlines() if l.startswith('Page') and 'size' in l]

JS = r"""
(async () => {
  window.EX = await import('/src/export.js');
  window.FN = await import('/src/fonts.js');
  window.MS = await import('/src/measure.js');
  window.PS = await import('/vendor/prosemirror-state.js');
  window.X = {
    ed: (id) => __app.editors.get(id),
    find: (id, str) => {
      const doc = X.ed(id).state.doc; let s = '', map = [];
      doc.descendants((n, pos) => { if (n.isText) for (let i = 0; i < n.text.length; i++) { s += n.text[i]; map.push(pos + i); } });
      const i = s.indexOf(str); return i < 0 ? null : [map[i], map[i + str.length - 1] + 1];
    },
    mark: (id, str, name, attrs) => {
      const ed = X.ed(id), r = X.find(id, str);
      ed.setSelection(PS.TextSelection.create(ed.state.doc, r[0], r[1]));
      ed.setMark(name, attrs);
      ed.setSelection(PS.TextSelection.create(ed.state.doc, r[0]));
    },
    // 기준 화면: 해당 프레임만 (0,0)에 고정, s>1이면 확대 변환
    pin: (id, s) => {
      document.activeElement && document.activeElement.blur();
      for (const f of document.querySelectorAll('.frame')) f.style.cssText = '';
      const h = document.getElementById('f-' + id);
      h.style.cssText = `position:fixed;left:0;top:0;z-index:99;outline:none;transform-origin:0 0;${s !== 1 ? `transform:scale(${s})` : ''}`;
    },
    unpin: () => { for (const f of document.querySelectorAll('.frame')) f.style.cssText = ''; },
    raster: async (id, opts) => (await EX.rasterize(X.ed(id).exportPage(), opts)).toDataURL('image/png'),
    blob64: async (blob) => { const b = new Uint8Array(await blob.arrayBuffer()); let s = ''; for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000)); return btoa(s); },
    pages: () => [...__app.editors.values()].map((e) => e.exportPage()),
  };
})()
"""

FRAMES = ['donut', 'alpha', 'colorKey', 'invert']

with sync_playwright() as p:
    # LE_CHROMIUM: 다른 Chromium/Chrome 실행 파일로 검증(버전별 차이 확인용)
    b = p.chromium.launch(args=['--disable-lcd-text'], executable_path=os.environ.get('LE_CHROMIUM') or None)
    metrics['browser'] = b.version
    ctx = b.new_context(viewport={'width': 2300, 'height': 2300}, accept_downloads=True)
    pg = ctx.new_page()
    pg.route('**/fonts.googleapis.com/**', lambda r: r.abort())
    pg.route('**/test-fonts/upload.otf', lambda r: r.fulfill(path=UPLOAD_FONT, content_type='font/otf'))
    pg.route('**/test-fonts/sheet.ttf', lambda r: r.fulfill(path=SHEET_FONT, content_type='font/ttf'))
    errors = []
    pg.on('pageerror', lambda e: errors.append(str(e)))
    pg.on('console', lambda m: m.type == 'error' and 'ERR_FAILED' not in m.text and errors.append(m.text))
    pg.goto(ORIGIN + '/demo.html')
    pg.wait_for_function('window.__app && window.__app.ready', timeout=30000)
    pg.evaluate(JS)
    E = lambda js: pg.evaluate(js)

    # ---- 글꼴 준비: 업로드 글꼴(register)과 스타일시트 @font-face 글꼴을 문서 일부에 적용
    E("""(async () => {
      const bytes = await (await fetch('/test-fonts/upload.otf')).arrayBuffer();
      await __app.fonts.register('업로드글꼴', bytes);
      document.head.insertAdjacentHTML('beforeend', '<style>@font-face{font-family:"SheetFont";src:url(/test-fonts/sheet.ttf) format("truetype")}</style>');
      await document.fonts.load('16px SheetFont', 'abc');
      MS.clearMeasureCache();
      X.mark('donut', 'Pneumonoultramicroscopicsilicovolcanoconiosis', 'font', { value: '"업로드글꼴", monospace' });
      X.mark('donut', 'https://example.com/a/very/long/path', 'font', { value: 'SheetFont, serif' });
      X.mark('alpha', '레이아웃', 'font', { value: '"업로드글꼴", monospace' });
    })()""")
    fam_ok = E("document.fonts.check('16px \"업로드글꼴\"') && document.fonts.check('16px SheetFont')")
    check('F0 시험 글꼴 2종 로드(업로드 등록 + 스타일시트)', fam_ok)

    # ============ R1. 배율 1: 화면과 픽셀 대조 ============
    screen1 = {}
    for fid in FRAMES:
        E(f"X.pin('{fid}', 1)")
        screen1[fid] = Image.open(io.BytesIO(pg.screenshot(clip={'x': 0, 'y': 0, 'width': 560, 'height': 560})))
        out = img_from_dataurl(E(f"X.raster('{fid}', {{ scale: 1 }})"))
        m = compare(screen1[fid], out)
        metrics[f'png1x/{fid}'] = m
        check(f'R1 PNG 1x [{fid}] 화면과 대조: 위치 일치(이웃 허용 64 초과 {m.get("nb_pct64")}% < 0.05%), 16 넘게 다른 픽셀 {m.get("pct16")}% < 0.3%', same_as_screen(m), m)
        if fid == 'donut':
            screen1[fid].save(os.path.join(OUT, 'export-screen-1x.png')); out.save(os.path.join(OUT, 'export-png-1x.png'))

    # ============ R2. 배율 2–4: 확대 화면과 대조 + 기기 배율 화면 참고 수치 ============
    for s in [2, 3, 4]:
        for fid in (FRAMES if s == 2 else ['donut', 'invert']):
            E(f"X.pin('{fid}', {s})")
            scr = Image.open(io.BytesIO(pg.screenshot(clip={'x': 0, 'y': 0, 'width': 560 * s, 'height': 560 * s})))
            out = img_from_dataurl(E(f"X.raster('{fid}', {{ scale: {s} }})"))
            m = compare(scr, out)
            metrics[f'png{s}x/{fid}'] = m
            check(f'R2 PNG {s}x [{fid}] 크기 {560*s}px, 확대 화면과 대조: 이웃 허용 64 초과 {m.get("nb_pct64")}% (기준 0.1% 미만)',
                  out.size == (560 * s, 560 * s) and m.get('nb_pct64', 1) < 0.1, m)
    E("X.unpin()")
    ctx2 = b.new_context(viewport={'width': 1300, 'height': 1300}, device_scale_factor=2)
    pg2 = ctx2.new_page(); pg2.route('**/fonts.googleapis.com/**', lambda r: r.abort())
    pg2.goto(ORIGIN + '/demo.html'); pg2.wait_for_function('window.__app && window.__app.ready'); pg2.evaluate(JS)
    for fid in ['donut', 'colorKey']:
        pg2.evaluate(f"X.pin('{fid}', 1)")
        scr = Image.open(io.BytesIO(pg2.screenshot(clip={'x': 0, 'y': 0, 'width': 560, 'height': 560})))
        out = img_from_dataurl(pg2.evaluate(f"X.raster('{fid}', {{ scale: 2 }})"))
        metrics[f'png2x-vs-dpr2/{fid}'] = compare(scr, out)
    ctx2.close()

    # ============ R3. 글꼴 넣기: 넣으면 화면과 같고, 빼면 달라져야 한다(검사가 실제로 글꼴을 보는지 확인) ============
    E("X.pin('donut', 1)")
    no_embed = img_from_dataurl(E("X.raster('donut', { scale: 1, embedFonts: false })"))
    m_no = compare(screen1['donut'], no_embed)
    metrics['fonts/no-embed'] = m_no
    check('R3 글꼴 파일을 넣지 않으면 화면과 달라짐(검사의 민감도 확인)', m_no['pct64'] > 0.1, m_no)
    css = E("""(async () => { const el = X.ed('donut').exportPage().render(); return (await __app.fonts.cssFor(['업로드글꼴', 'SheetFont', 'Noto Sans KR'], el.textContent)).length; })()""")
    check('R3 출력 CSS에 업로드 글꼴 + 스타일시트 글꼴이 data URL로 들어감', css > 50000, {'cssLength': css})
    none = E("""(async () => (await __app.fonts.cssFor(['업로드글꼴'], '가나다')).length)()""")
    # 업로드 글꼴은 unicode-range가 없으므로 글자와 상관없이 들어가야 함 / 쓰지 않은 글꼴은 안 들어가야 함
    unused = E("""(async () => (await __app.fonts.cssFor(['없는글꼴'], 'abc')).length)()""")
    check('R3 쓰지 않은 글꼴은 넣지 않음', none > 0 and unused == 0, {'upload': none, 'unused': unused})
    ur = E("""(async () => {
      const r = new FN.FontRegistry();
      const bytes = await (await fetch('/test-fonts/upload.otf')).arrayBuffer();
      r.registered.push({ family: 'U', weight: '400', style: 'normal', unicodeRange: 'U+AC00-D7A3', bytes });
      return [(await r.cssFor(['U'], 'abc')).length, (await r.cssFor(['U'], 'a가')).length];
    })()""")
    check('R3 unicode-range 조각: 쓴 글자가 범위 밖이면 제외, 안이면 포함', ur[0] == 0 and ur[1] > 0, ur)

    # ============ R4. 투명 배경, JPG, WebP ============
    t = img_from_dataurl(E("X.raster('donut', { scale: 1, transparent: true })")).convert('RGBA')
    A = np.asarray(t)
    corner = int(A[:20, :20, 3].max())
    ring = int(A[280, 20, 3])  # 도넛 링 안(도형 채움)
    check('R4 투명 배경: 도형 밖 모서리 알파 0, 도형 안 불투명', corner == 0 and ring == 255, {'corner': corner, 'ring': ring})
    t_opaque = Image.alpha_composite(Image.new('RGBA', t.size, (255, 255, 255, 255)), t)
    m = compare(screen1['donut'], t_opaque)
    check('R4 투명 PNG를 흰 바탕에 합성하면 화면과 같음(R1 기준)', same_as_screen(m), m)
    for fmt, magic in [('jpg', b'\xff\xd8\xff'), ('webp', b'RIFF')]:
        b64 = E(f"(async () => X.blob64(await EX.exportImage(X.ed('donut').exportPage(), {{ format: '{fmt}', scale: 2, transparent: true }})))()")
        raw = base64.b64decode(b64)
        im = Image.open(io.BytesIO(raw))
        if fmt == 'jpg':  # JPG는 투명이 없어 흰 바탕을 깐다 → 흰 바탕 합성과 비교
            tr = img_from_dataurl(E("X.raster('donut', { scale: 2, transparent: true })")).convert('RGBA')
            m = compare(Image.alpha_composite(Image.new('RGBA', tr.size, (255, 255, 255, 255)), tr), im.convert('RGB'))
        else:  # WebP는 투명 유지. 완전 투명 픽셀의 RGB는 정의되지 않으므로 흰 바탕 합성 + 알파 채널을 따로 비교
            tr = img_from_dataurl(E("X.raster('donut', { scale: 2, transparent: true })")).convert('RGBA')
            wi = im.convert('RGBA')
            white = lambda x: Image.alpha_composite(Image.new('RGBA', x.size, (255, 255, 255, 255)), x)
            m = compare(white(tr), white(wi))
            m['alpha_max'] = int(np.abs(np.asarray(tr)[..., 3].astype(int) - np.asarray(wi)[..., 3].astype(int)).max())
        metrics[f'{fmt}2x-vs-png2x'] = m
        check(f'R4 {fmt.upper()} 2x: 형식 {im.format}, 크기 {im.size}, PNG와 평균 차이 {m.get("mean")} (손실 압축, 기준 3 미만)',
              raw.startswith(magic) and im.size == (1120, 1120) and m.get('mean', 99) < 3 and (im.mode == 'RGB' if fmt == 'jpg' else m['alpha_max'] <= 8), m)

    # ============ R5. 출력에 커서·선택·조합·디버그 표시가 들어가지 않음 ============
    ref = E("X.raster('invert', { scale: 1 })")
    E("""(() => { const ed = X.ed('invert'); ed.focus(); const r = X.find('invert', '레이아웃 엔진의');
        ed.setSelection(PS.TextSelection.create(ed.state.doc, r[0], r[1])); ed.comp = { text: '조합중' }; ed.setDebug(true); })()""")
    busy = E("X.raster('invert', { scale: 1 })")
    E("(() => { const ed = X.ed('invert'); ed.comp = null; ed.setDebug(false); ed.setSelection(PS.TextSelection.create(ed.state.doc, 1)); })()")
    check('R5 선택·조합 중·디버그 표시 상태에서도 출력은 확정 문서만', ref == busy)

    # ============ R6. 래스터 PDF ============
    t0 = time.time()
    b64 = E("(async () => X.blob64(await EX.exportRasterPDF(X.pages(), { scale: 2, title: '레이아웃 데모' })))()")
    metrics['time/raster-pdf-4p-2x-ms'] = round((time.time() - t0) * 1000)
    rp = os.path.join(TMP, 'raster.pdf'); open(rp, 'wb').write(base64.b64decode(b64))
    sizes = pdf_page_sizes(rp)
    check('R6 래스터 PDF: 4쪽, 쪽 크기 420×420pt(560px × 0.75)', sizes == [(420.0, 420.0)] * 4, sizes)
    imgs = run(['pdfimages', '-list', rp]).splitlines()[2:]
    dims = [(int(l.split()[3]), int(l.split()[4])) for l in imgs]
    check('R6 래스터 PDF: 쪽마다 1120×1120 이미지 1장(192dpi)', dims == [(1120, 1120)] * 4, dims)
    # PDF에 들어 있는 이미지를 그대로 꺼내 PNG 출력과 비교(뷰어의 재표본화 영향 없음)
    run(['pdfimages', '-png', rp, os.path.join(TMP, 'rimg')])
    bad = {}
    for i, fid in enumerate(FRAMES):
        ref = img_from_dataurl(E(f"X.raster('{fid}', {{ scale: 2 }})"))
        m = compare(ref, Image.open(os.path.join(TMP, f'rimg-{i:03d}.png')))
        metrics[f'raster-pdf-embedded/{fid}'] = m
        if m.get('max', 1) > 0: bad[fid] = m
    check('R6 래스터 PDF 안의 이미지 = PNG 2x (모든 픽셀 일치)', not bad, bad)
    pages_png = pdf_pages_png(rp, 192)  # 참고: 뷰어(poppler)로 그렸을 때
    for i, fid in enumerate(FRAMES):
        metrics[f'raster-pdf-poppler192/{fid}'] = compare(img_from_dataurl(E(f"X.raster('{fid}', {{ scale: 2 }})")), pages_png[i])
    b64j = E("(async () => X.blob64(await EX.exportRasterPDF(X.pages(), { scale: 2, imageFormat: 'jpg' })))()")
    jp = os.path.join(TMP, 'raster-jpg.pdf'); open(jp, 'wb').write(base64.b64decode(b64j))
    encs = [l.split()[8] for l in run(['pdfimages', '-list', jp]).splitlines()[2:]]
    metrics['size/raster-pdf-png-bytes'] = len(base64.b64decode(b64)); metrics['size/raster-pdf-jpg-bytes'] = len(base64.b64decode(b64j))
    check('R6 래스터 PDF JPG 모드: 쪽마다 JPEG 이미지', encs == ['jpeg'] * 4, encs)

    # ============ R7. 벡터 PDF(인쇄 CSS) ============
    # 크기가 다른 장 하나를 섞는다(이름 붙은 @page가 장마다 적용되는지)
    html = E("""(async () => {
      const extra = { w: 300, h: 500, render: () => { const d = document.createElement('div');
        d.style.cssText = 'position:relative;width:300px;height:500px;background:#223;color:#fff;font:700 40px "업로드글꼴"';
        d.innerHTML = '<span style="position:absolute;left:20px;top:30px">Extra 장</span>'; return d; } };
      return EX.buildPrintHTML([...X.pages(), extra], { title: '레이아웃 데모' });
    })()""")
    vp = ctx.new_page()
    vp.set_content(html, wait_until='load')
    vp.evaluate("document.fonts.ready")
    vpath = os.path.join(TMP, 'vector.pdf')
    t0 = time.time()
    vp.pdf(path=vpath, prefer_css_page_size=True, print_background=True)
    metrics['time/vector-pdf-5p-ms'] = round((time.time() - t0) * 1000)
    vp.close()
    sizes = pdf_page_sizes(vpath)
    want_sz = [(420.0, 420.0)] * 4 + [(225.0, 375.0)]
    check('R7 벡터 PDF: 5쪽, 장마다 크기(420×420pt ×4, 225×375pt, Chrome 인쇄의 쪽 크기 양자화 ±0.5pt)',
          len(sizes) == 5 and all(abs(a - c) <= 0.5 and abs(b2 - d) <= 0.5 for (a, b2), (c, d) in zip(sizes, want_sz)), sizes)
    txt = run(['pdftotext', '-layout', vpath, '-']).split('\f')
    strip = lambda s: ''.join(s.split())
    want = E("[...__app.editors.values()].map(ed => ed.result.lines.flatMap(l => l.pieces.map(p => p.text)).join(''))")
    tok = [all(w in strip(txt[i]) for w in [strip(want[i])[:12], strip(want[i])[-12:]]) for i in range(4)]
    check('R7 벡터 PDF 글자가 글자로 남음(pdftotext로 장마다 첫·끝 12자 추출)', all(tok) and 'Extra' in txt[4], tok)
    fl = run(['pdffonts', vpath]).splitlines()[2:]
    emb = [l for l in fl if l.split()[-5] == 'yes'] if fl else []
    check('R7 벡터 PDF 글꼴이 파일에 포함(pdffonts emb=yes 전부)', fl and len(emb) == len(fl), fl)
    fams = ' '.join(fl)
    check('R7 벡터 PDF에 업로드 글꼴과 스타일시트 글꼴이 들어감', 'TeXGyreCursor' in fams.replace(' ', '') and 'FreeSerif' in fams, fl)
    vimgs = len(run(['pdfimages', '-list', vpath]).splitlines()[2:])
    metrics['vector-pdf/images'] = vimgs
    # 다른 래스터라이저(poppler)는 글자를 조금 더 굵게 그려 픽셀 값이 다르다. 그래서 '위치'를 본다:
    # 4배 해상도에서 20px(4배 기준 80px) 띠마다 화면과 가장 잘 겹치는 이동량을 찾고, 모두 0.25px(4배 기준 1px) 이내인지.
    vpng = pdf_pages_png(vpath, 96)
    vpng4 = pdf_pages_png(vpath, 384)
    shifts = {}
    for i, fid in enumerate(FRAMES):
        metrics[f'vector-pdf-poppler96/{fid}'] = compare(screen1[fid], vpng[i].convert('RGB'))
        E(f"X.pin('{fid}', 4)")
        S = np.asarray(Image.open(io.BytesIO(pg.screenshot(clip={'x': 0, 'y': 0, 'width': 2240, 'height': 2240}))).convert('L')).astype(np.int16)
        V = np.asarray(vpng4[i].convert('L')).astype(np.int16)
        worst, bands = 0, 0
        for y0 in range(8, 2240 - 88, 80):
            a = S[y0:y0 + 80, 8:-8]
            if a.std() < 20: continue  # 글자·그림이 거의 없는 띠
            best = None
            for dy in range(-3, 4):
                for dx in range(-3, 4):
                    e = np.abs(a - V[y0 + dy:y0 + dy + 80, 8 + dx:2240 - 8 + dx]).mean()
                    if best is None or e < best[0]: best = (e, dx, dy)
            e0 = np.abs(a - V[y0:y0 + 80, 8:-8]).mean()
            bands += 1
            # 옮기지 않았을 때가 가장 잘 맞는 이동보다 0.5 넘게 나쁠 때만 '어긋남'으로 센다(이미지 가장자리처럼 흐릿한 띠는 이동량이 모호)
            if e0 - best[0] > 0.5: worst = max(worst, abs(best[1]), abs(best[2]))
        shifts[fid] = {'bands': bands, 'max_shift_4x_px': worst}
        metrics[f'vector-pdf-shift/{fid}'] = shifts[fid]
    E("X.unpin()")
    # 화면은 글자 위치를 픽셀 격자에 맞춰 반올림하고 벡터 PDF는 소수점 위치 그대로라 최대 0.5px(4배 기준 2px) 차이가 날 수 있다
    check('R7 벡터 PDF vs 화면(4배): 모든 띠의 위치 차이 0.5px 이내', all(v['max_shift_4x_px'] <= 2 and v['bands'] > 5 for v in shifts.values()), shifts)

    # 래스터라이저와 무관한 위치 검사: PDF 안 단어 상자(pdftotext -bbox, pt) ↔ 엔진이 계산한 조각 위치(px)
    import re as _re
    pcs = E("[...__app.editors.values()].map(ed => ed.result.lines.flatMap(l => l.pieces.filter(p => !p.space).map(p => ({ t: p.text, x: p.x, y: p.top + p.h / 2, top: p.top, base: l.baseline, k: p.style.fontFamily + '|' + p.style.fontSize + '|' + p.style.fontWeight }))))")
    pos = {}
    for i, fid in enumerate(FRAMES):
        html_bb = run(['pdftotext', '-bbox', '-f', str(i + 1), '-l', str(i + 1), vpath, '-'])
        words = [(float(a) * 4 / 3, (float(b) + float(d)) / 2 * 4 / 3, _html_unescape(t)) for a, b, c, d, t in
                 _re.findall(r'<word xMin="([\d.-]+)" yMin="([\d.-]+)" xMax="([\d.-]+)" yMax="([\d.-]+)">([^<]*)</word>', html_bb)]
        dxs, dys = [], {}
        for pc in pcs[i]:
            # 같은 글자의 단어 중 가장 가까운 것(20px 이내)과 짝짓는다(추출기의 읽기 순서는 도넛 좌우를 오가므로 순서 대응 불가)
            cand = [w for w in words if w[2] == pc['t'] and abs(w[0] - pc['x']) < 20 and abs(w[1] - pc['y']) < 20]
            if not cand: continue
            w = min(cand, key=lambda w: abs(w[0] - pc['x']) + abs(w[1] - pc['y']))
            # 세로: Chrome 인쇄는 글자 상자 윗변을 정수 px로 반올림한다 → PDF 위치 - 반올림한 윗변은 글꼴마다 일정해야 함
            dxs.append(w[0] - pc['x'])
            for cand_name in ('top', 'base', 'y'):
                dys.setdefault(cand_name, {}).setdefault(pc['k'], []).append(w[1] - round(pc[cand_name]))
        spreads = {c: round(max((max(v) - min(v)) for v in g.values()), 3) for c, g in dys.items()}
        pos[fid] = {'matched': len(dxs), 'pieces': len(pcs[i]), 'max_dx_px': round(max(abs(d) for d in dxs), 3), 'y_spread_by_rounded': spreads, 'y_spread_px': min(spreads.values())}
    metrics['vector-pdf-positions'] = pos
    # 세로: Chrome 인쇄는 세로 위치를 정수 px로 맞춘다(엔진 값 소수부에 따라 PDF 위치가 반올림처럼 움직이는 것을 확인).
    # 반올림 후에도 같은 글꼴 안에서 약 0.3px 편차가 남는데, PDF 좌표 정밀도인지 추출기 계산인지는 확정하지 못함 → 기준 0.5px
    check('R7 벡터 PDF 단어 위치 = 엔진 계산 위치: 가로 0.05px 이내, 세로(정수 반올림 기준) 0.5px 이내(단어 20개 이상 대응)',
          all(v['matched'] >= 20 and v['max_dx_px'] <= 0.05 and v['y_spread_px'] <= 0.5 for v in pos.values()), pos)
    vpng[0].save(os.path.join(OUT, 'export-vector-p1-96dpi.png')); vpng[3].save(os.path.join(OUT, 'export-vector-p4-96dpi.png')); screen1['invert'].save(os.path.join(OUT, 'export-screen-invert-1x.png'))

    # ============ R8. 파일 이름, 저장, 범위 ============
    names = E("[EX.fileName('레이아웃 데모', 0, 4, 'png'), EX.fileName('레이아웃 데모', 3, 12, 'jpg'), EX.fileName('a/b:c*', 0, 1, 'webp'), EX.fileName('', 9, 10, 'png')]")
    check('R8 파일 이름 {프로젝트명}_{장번호}, 10장 이상 자릿수 맞춤, 금지 문자 치환', names == ['레이아웃 데모_1.png', '레이아웃 데모_04.jpg', 'a_b_c__1.webp', '제목 없음_10.png'], names)
    # 폴더 저장(File System Access API): 메모리 폴더로 대체해 호출 순서 확인
    saved = E("""(async () => {
      const written = {};
      window.showDirectoryPicker = async () => ({ getFileHandle: async (name) => ({ createWritable: async () => ({ write: async (b) => { written[name] = b.size; }, close: async () => {} }) }) });
      const files = await EX.exportPages(X.pages(), { project: '레이아웃 데모', format: 'png', indices: [1, 3], scale: 1 });
      const r = await EX.saveFiles(files, { project: '레이아웃 데모' });
      return { r, written };
    })()""")
    check('R8 선택한 장(2, 4) → 폴더에 레이아웃 데모_2.png, _4.png 저장', saved['r']['mode'] == 'directory' and sorted(saved['written']) == ['레이아웃 데모_2.png', '레이아웃 데모_4.png'] and all(v > 1000 for v in saved['written'].values()), saved)
    # 폴더 API가 없으면 zip 내려받기
    E("delete window.showDirectoryPicker; window.showDirectoryPicker = undefined")
    with pg.expect_download() as dl:
        E("(async () => EX.saveFiles(await EX.exportPages(X.pages(), { project: '레이아웃 데모', format: 'png', scale: 1 }), { project: '레이아웃 데모' }))()")
    zp = os.path.join(TMP, 'out.zip'); dl.value.save_as(zp)
    with zipfile.ZipFile(zp) as z:
        zn = sorted(z.namelist())
        zimg = Image.open(io.BytesIO(z.read('레이아웃 데모_1.png')))
    check('R8 폴더 저장 불가 → zip 내려받기(4장, 이름·내용 확인)', dl.value.suggested_filename == '레이아웃 데모.zip' and zn == [f'레이아웃 데모_{i}.png' for i in range(1, 5)] and same_as_screen(compare(screen1['donut'], zimg)), zn)
    # 데모 버튼: 현재 장, JPG, 한 장 → 파일 하나 내려받기
    E("X.ed('colorKey').focus()")
    if pg.evaluate("document.getElementById('exportPop')?.hidden === true"): pg.click('#exportBtn')  # 내보내기 설정은 내보내기 창 안(12단계 개편)
    pg.select_option('#exFormat', 'jpg'); pg.select_option('#exRange', 'current'); pg.select_option('#exScale', '1')
    with pg.expect_download() as dl:
        pg.click('#exRun')
    check('R8 데모 버튼: 현재 장(3번째) JPG → 레이아웃 데모_3.jpg', dl.value.suggested_filename == '레이아웃 데모_3.jpg', dl.value.suggested_filename)
    if pg.evaluate("document.getElementById('exportPop')?.hidden === true"): pg.click('#exportBtn')  # 내보내기 설정은 내보내기 창 안(12단계 개편)
    pg.select_option('#exFormat', 'pdf'); pg.select_option('#exRange', 'all')
    with pg.expect_download() as dl:
        pg.click('#exRun')
    check('R8 데모 버튼: 전체 래스터 PDF → 레이아웃 데모.pdf', dl.value.suggested_filename == '레이아웃 데모.pdf', dl.value.suggested_filename)

    # ============ R9. 한계 초과 배율은 명확한 오류 ============
    err = E("""(async () => { try { await EX.rasterize({ w: 9000, h: 9000, render: () => document.createElement('div') }, { scale: 4 }); return 'no error'; } catch (e) { return e.message; } })()""")
    check('R9 캔버스 한계 초과(36000px) → 배율을 낮추라는 오류', '한계' in err, err)

    # ============ R10. 속도 ============
    for s in [1, 2, 4]:
        t0 = time.time(); E(f"X.raster('donut', {{ scale: {s} }})"); metrics[f'time/png-{s}x-ms'] = round((time.time() - t0) * 1000)
    b.close()

srv.shutdown()
json.dump(metrics, open(os.path.join(OUT, 'export-metrics.json'), 'w'), ensure_ascii=False, indent=1)
fails = [r for r in results if not r[1]]
for name, ok, detail in results:
    print(('PASS ' if ok else 'FAIL ') + name + ('' if ok else '  ' + json.dumps(detail, ensure_ascii=False)[:900]))
print('page errors:', errors)
print('metrics:', json.dumps(metrics, ensure_ascii=False))
print(f'{len(results) - len(fails)}/{len(results)} passed')
