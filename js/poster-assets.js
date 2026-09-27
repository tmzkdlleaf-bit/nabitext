/* 글 이미지용 장식과 질감을 코드로 그린다. 외부 그림 없이도 매화 가지, 구름띠, 꽃살 띠,
 * 판화 테두리 같은 전통·빈티지 장식을 만들 수 있게 한다. 결과는 모두 data: URL 이미지라서
 * PNG로 내보낼 때 그대로 찍힌다. */
NT.posterAssets = (() => {
  const cache = new Map();
  const svgUrl = svg => 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);

  // 시드가 같으면 같은 그림이 나오는 난수
  function rng(seed) {
    let a = (seed >>> 0) || 1;
    return () => {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  const f1 = n => Math.round(n * 10) / 10;

  /* ─ 꽃 한 송이 (다섯 잎) ─ */
  function flowerSvg(cx, cy, r, fill, center, rot, opts = {}) {
    let s = `<g transform="rotate(${f1(rot)} ${f1(cx)} ${f1(cy)})"${opts.filter ? ` filter="url(#${opts.filter})"` : ''}>`;
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2;
      const px = cx + Math.cos(a) * r * 0.52, py = cy + Math.sin(a) * r * 0.52;
      s += opts.outline
        ? `<circle cx="${f1(px)}" cy="${f1(py)}" r="${f1(r * 0.5)}" fill="none" stroke="${fill}" stroke-width="${opts.outline}"/>`
        : `<circle cx="${f1(px)}" cy="${f1(py)}" r="${f1(r * 0.52)}" fill="${fill}" fill-opacity="${opts.opacity ?? 0.92}"/>`;
    }
    s += '</g>';
    if (center) {
      s += `<circle cx="${f1(cx)}" cy="${f1(cy)}" r="${f1(r * 0.16)}" fill="${center}"/>`;
      if (!opts.outline) for (let i = 0; i < 7; i++) {
        const a = (i / 7) * Math.PI * 2 + rot;
        const x2 = cx + Math.cos(a) * r * 0.42, y2 = cy + Math.sin(a) * r * 0.42;
        s += `<line x1="${f1(cx)}" y1="${f1(cy)}" x2="${f1(x2)}" y2="${f1(y2)}" stroke="${center}" stroke-width="${f1(r * 0.04 + 0.6)}"/><circle cx="${f1(x2)}" cy="${f1(y2)}" r="${f1(r * 0.05 + 0.8)}" fill="${center}"/>`;
      }
    }
    return s;
  }

  /* ─ 매화 가지: 먹 가지 + 꽃. soft면 번지는 수채화 ─ */
  function plum({ seed = 1, branch = '#1b1b1b', petals = ['#d93a3a', '#1b1b1b'], soft = false } = {}) {
    const R = rng(seed), W = 640, H = 460;
    const segs = [], blooms = [];
    function grow(x, y, ang, len, w, depth) {
      let px = x, py = y;
      const steps = Math.max(3, Math.round(len / 34));
      for (let i = 0; i < steps; i++) {
        ang += (R() - 0.5) * 0.7;
        const nx = px + Math.cos(ang) * len / steps, ny = py + Math.sin(ang) * len / steps;
        if (nx > W - 40 || ny > H - 40 || ny < 30 || nx < -20) break; // 그림 밖으로 나가 잘리지 않게
        const ww = w * (1 - i / steps * 0.55);
        segs.push([px, py, nx, ny, ww]);
        if (depth < 3 && R() < 0.34) grow(nx, ny, ang + (R() < 0.5 ? -1 : 1) * (0.5 + R() * 0.7), len * (0.35 + R() * 0.3), ww * 0.55, depth + 1);
        if (R() < 0.2) blooms.push([nx + (R() - 0.5) * 24, ny + (R() - 0.5) * 24, depth]);
        px = nx; py = ny;
      }
      blooms.push([px, py, depth]);
    }
    grow(-10, 70 + R() * 40, 0.28 + R() * 0.2, 640, 20, 0);
    let s = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}"><defs>
      <filter id="ink" x="-10%" y="-10%" width="120%" height="120%"><feTurbulence type="fractalNoise" baseFrequency="0.06" numOctaves="2" seed="${seed % 97}"/><feDisplacementMap in="SourceGraphic" scale="${soft ? 5 : 7}"/></filter>
      <filter id="wash" x="-30%" y="-30%" width="160%" height="160%"><feTurbulence type="fractalNoise" baseFrequency="0.09" numOctaves="2" seed="${(seed * 7) % 97}"/><feDisplacementMap in="SourceGraphic" scale="${soft ? 10 : 6}"/>${soft ? '<feGaussianBlur stdDeviation="2.2"/>' : '<feGaussianBlur stdDeviation="0.4"/>'}</filter>
    </defs><g filter="url(#ink)" stroke="${branch}" stroke-linecap="round" fill="none" ${soft ? 'opacity="0.55"' : ''}>`;
    for (const [x1, y1, x2, y2, w] of segs) s += `<line x1="${f1(x1)}" y1="${f1(y1)}" x2="${f1(x2)}" y2="${f1(y2)}" stroke-width="${f1(Math.max(1.2, w))}"/>`;
    s += '</g>';
    for (const [x, y, d] of blooms) {
      if (x < 10 || x > W - 20 || y < 10 || y > H - 20) continue;
      const bud = R() < 0.25;
      const r = bud ? 7 + R() * 5 : (soft ? 26 : 20) + R() * (soft ? 22 : 16) - d * 2;
      const col = petals[Math.floor(R() * petals.length)];
      if (bud) s += `<circle cx="${f1(x)}" cy="${f1(y)}" r="${f1(r * 0.6)}" fill="${col}" filter="url(#wash)"/>`;
      else s += flowerSvg(x, y, r, col, soft ? null : (col === branch ? '#f3efe6' : branch), R() * 72, { filter: 'wash', opacity: soft ? 0.62 : 0.93 });
    }
    return svgUrl(s + '</svg>');
  }

  /* ─ 구름띠: 둥근 막대를 엇갈려 쌓은 전통 구름 무늬 ─ */
  function cloud({ seed = 1, color = '#8d8883', style = 'fill' } = {}) {
    const R = rng(seed), h = 16, gap = 13, W = 420;
    const rows = 3 + Math.floor(R() * 3);
    let s = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${rows * (h + gap) + 10}" viewBox="0 0 ${W} ${rows * (h + gap) + 10}">`;
    let prevX = 40 + R() * 80;
    for (let i = 0; i < rows; i++) {
      const w = 140 + R() * 240, x = Math.max(4, Math.min(W - w - 4, prevX + (R() - 0.5) * 160));
      const y = 5 + i * (h + gap);
      s += style === 'line'
        ? `<rect x="${f1(x)}" y="${y}" width="${f1(w)}" height="${h}" rx="${h / 2}" fill="none" stroke="${color}" stroke-width="3"/>`
        : `<rect x="${f1(x)}" y="${y}" width="${f1(w)}" height="${h}" rx="${h / 2}" fill="${color}"/>`;
      if (i > 0 && R() < 0.8) { // 위아래를 잇는 짧은 기둥
        const cx = Math.max(x + 12, Math.min(x + w - 12, prevX + 30 + R() * 60));
        s += `<rect x="${f1(cx)}" y="${y - gap - 2}" width="6" height="${gap + 4}" fill="${style === 'line' ? 'none' : color}" ${style === 'line' ? `stroke="${color}" stroke-width="2"` : ''}/>`;
      }
      prevX = x;
    }
    return svgUrl(s + '</svg>');
  }

  function flower({ color = '#f2a0b8', center = '#c2255c' } = {}) {
    return svgUrl(`<svg xmlns="http://www.w3.org/2000/svg" width="60" height="60" viewBox="0 0 60 60">${flowerSvg(30, 30, 22, color, center, 18, { opacity: 0.95 })}</svg>`);
  }

  /* ─ 장식 구분선: 가운데 꽃과 좌우 덩굴을 세 번 반복 ─ */
  function ornament({ color = '#8b7fb8' } = {}) {
    const motif = cx => {
      let m = flowerSvg(cx, 40, 15, color, color, 0, { outline: 2.4 });
      for (const d of [-1, 1]) {
        m += `<path d="M${cx + d * 14} 46 C ${cx + d * 40} 70, ${cx + d * 70} 60, ${cx + d * 74} 42 C ${cx + d * 76} 30, ${cx + d * 62} 26, ${cx + d * 56} 36" fill="none" stroke="${color}" stroke-width="2.6" stroke-linecap="round"/>`;
        m += `<path d="M${cx + d * 10} 28 C ${cx + d * 26} 8, ${cx + d * 50} 10, ${cx + d * 56} 20" fill="none" stroke="${color}" stroke-width="2.2" stroke-linecap="round"/>`;
        m += flowerSvg(cx + d * 52, 16, 8, color, null, 20, { outline: 1.8 });
        m += `<circle cx="${cx + d * 30}" cy="${58}" r="4" fill="none" stroke="${color}" stroke-width="2"/>`;
      }
      return m;
    };
    return svgUrl(`<svg xmlns="http://www.w3.org/2000/svg" width="560" height="80" viewBox="0 0 560 80">${motif(96)}${motif(280)}${motif(464)}</svg>`);
  }

  /* ─ 꽃살 띠: 테두리 안에 가지와 꽃 윤곽을 엮은 띠 (창살 문양) ─ */
  function lattice({ seed = 1, color = '#222222', w = 1200, h = 250 } = {}) {
    const R = rng(seed);
    let s = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><defs><clipPath id="c"><rect x="14" y="14" width="${w - 28}" height="${h - 28}"/></clipPath></defs>`;
    s += `<rect x="4" y="4" width="${w - 8}" height="${h - 8}" fill="none" stroke="${color}" stroke-width="5"/><rect x="14" y="14" width="${w - 28}" height="${h - 28}" fill="none" stroke="${color}" stroke-width="3"/><g clip-path="url(#c)" fill="none" stroke="${color}" stroke-linecap="round">`;
    for (let i = 0; i < 9; i++) {
      const x0 = R() * w, y0 = R() < 0.5 ? h + 10 : -10;
      const x1 = x0 + (R() - 0.5) * 500, y1 = h / 2 + (R() - 0.5) * h;
      const x2 = x1 + (R() - 0.5) * 400, y2 = R() * h;
      s += `<path d="M${f1(x0)} ${f1(y0)} Q ${f1(x1)} ${f1(y1)} ${f1(x2)} ${f1(y2)}" stroke-width="${f1(5 + R() * 4)}"/>`;
    }
    for (let i = 0; i < 26; i++) s += flowerSvg(20 + R() * (w - 40), 20 + R() * (h - 40), 16 + R() * 14, color, color, R() * 70, { outline: 3.2 });
    return svgUrl(s + '</g></svg>');
  }

  /* ─ 모서리 장식 ─ */
  function corner({ color = '#8a6d3b' } = {}) {
    return svgUrl(`<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200" viewBox="0 0 200 200" fill="none" stroke="${color}" stroke-linecap="round">
      <path d="M10 190 V10 H190" stroke-width="4"/><path d="M26 190 V26 H190" stroke-width="1.6"/>
      <path d="M26 60 C 60 60, 60 26, 60 26" stroke-width="2"/><circle cx="44" cy="44" r="7" stroke-width="2"/>
      <path d="M60 26 C 90 50, 120 30, 140 40" stroke-width="1.6"/><path d="M26 60 C 50 90, 30 120, 40 140" stroke-width="1.6"/></svg>`);
  }

  /* ─ 캔버스로 그리는 것들 ─ */
  function canvas(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return [c, c.getContext('2d')]; }

  /* 잎이 무성한 나무 실루엣 (색은 입히기로 바꾼다) */
  function tree({ seed = 1 } = {}) {
    const key = 'tree' + seed;
    if (cache.has(key)) return cache.get(key);
    const R = rng(seed), [c, g] = canvas(620, 520);
    g.fillStyle = g.strokeStyle = '#000'; g.lineCap = 'round';
    const tips = [];
    function br(x, y, a, len, w, d) {
      const nx = x + Math.cos(a) * len, ny = y + Math.sin(a) * len;
      g.lineWidth = w; g.beginPath(); g.moveTo(x, y);
      g.quadraticCurveTo((x + nx) / 2 + (R() - 0.5) * 30, (y + ny) / 2 + (R() - 0.5) * 30, nx, ny); g.stroke();
      if (d > 4) { tips.push([nx, ny]); return; }
      br(nx, ny, a - 0.35 - R() * 0.4, len * 0.72, w * 0.66, d + 1);
      br(nx, ny, a + 0.35 + R() * 0.4, len * 0.72, w * 0.66, d + 1);
    }
    g.beginPath(); g.moveTo(250, 520); g.bezierCurveTo(265, 430, 230, 380, 260, 300); g.lineTo(300, 300); g.bezierCurveTo(290, 380, 330, 430, 330, 520); g.fill();
    br(280, 310, -Math.PI / 2, 90, 26, 0);
    for (const [x, y] of tips) for (let i = 0; i < 16; i++) {
      g.beginPath(); g.ellipse(x + (R() - 0.5) * 70, y + (R() - 0.5) * 60, 7 + R() * 9, 4 + R() * 4, R() * Math.PI, 0, Math.PI * 2); g.fill();
    }
    const url = c.toDataURL();
    cache.set(key, url);
    return url;
  }

  /* 판화(목판) 테두리 — 페이지 크기에 맞춰 통째로 그린다 */
  function woodcutFrame(W, H, { seed = 3, color = '#111111', top = 110, side = 70, bottom = 130 } = {}) {
    const key = `wood${W}x${H}${seed}${color}${top}${side}${bottom}`;
    if (cache.has(key)) return cache.get(key);
    const R = rng(seed), [c, g] = canvas(W, H);
    g.fillStyle = color;
    // 들쭉날쭉한 안쪽 가장자리를 가진 띠
    const band = (x, y, w, h, edge) => {
      g.fillRect(x, y, w, h);
      for (let i = 0; i < (edge === 'b' || edge === 't' ? w : h) / 9; i++) {
        const r = 6 + R() * 22;
        if (edge === 'b') { g.beginPath(); g.ellipse(x + R() * w, y + h + R() * 10 - 4, r * 0.6, r, R() * 3, 0, Math.PI * 2); g.fill(); }
        if (edge === 't') { g.beginPath(); g.ellipse(x + R() * w, y - R() * 10 + 4, r * 0.6, r, R() * 3, 0, Math.PI * 2); g.fill(); }
        if (edge === 'r') { g.beginPath(); g.ellipse(x + w + R() * 10 - 4, y + R() * h, r, r * 0.6, R() * 3, 0, Math.PI * 2); g.fill(); }
        if (edge === 'l') { g.beginPath(); g.ellipse(x - R() * 10 + 4, y + R() * h, r, r * 0.6, R() * 3, 0, Math.PI * 2); g.fill(); }
      }
    };
    band(0, 0, W, top, 'b');
    band(0, H - bottom, W, bottom, 't');
    band(0, 0, side, H, 'r');
    band(W - side, 0, side, H, 'l');
    // 칼로 파낸 흰 결
    g.strokeStyle = '#ffffff'; g.lineCap = 'round';
    // 조각칼 자국: 같은 방향으로 나란한 짧은 선 묶음을 흩뿌린다
    const carve = (x, y, w, h, n) => {
      for (let i = 0; i < n / 8; i++) {
        const px = x + R() * w, py = y + R() * h, a = R() * Math.PI, l = 6 + R() * 16, k = 4 + Math.floor(R() * 8);
        const nx = -Math.sin(a), ny = Math.cos(a), bend = (R() - 0.5) * 8;
        g.lineWidth = 0.9 + R() * 1.3;
        for (let j = 0; j < k; j++) {
          const ox = px + nx * j * 3.4, oy = py + ny * j * 3.4, ll = l * (0.6 + R() * 0.5);
          g.beginPath(); g.moveTo(ox, oy);
          g.quadraticCurveTo(ox + Math.cos(a) * ll / 2 + nx * bend, oy + Math.sin(a) * ll / 2 + ny * bend, ox + Math.cos(a) * ll, oy + Math.sin(a) * ll);
          g.stroke();
        }
      }
      g.fillStyle = '#ffffff';
      for (let i = 0; i < n / 5; i++) { g.beginPath(); g.arc(x + R() * w, y + R() * h, 0.8 + R() * 2.2, 0, Math.PI * 2); g.fill(); }
      g.fillStyle = color;
    };
    carve(0, 0, W, top * 0.85, W * top / 90);
    carve(0, H - bottom * 0.85, W, bottom * 0.85, W * bottom / 90);
    carve(0, top, side * 0.8, H - top - bottom, side * H / 110);
    carve(W - side * 0.8, top, side * 0.8, H - top - bottom, side * H / 110);
    // 바깥 이중선
    g.strokeStyle = color; g.lineWidth = 6; g.strokeRect(3, 3, W - 6, H - 6);
    const url = c.toDataURL();
    cache.set(key, url);
    return url;
  }

  /* ─ 종이 질감 (반복 타일) ─ */
  function texture(kind, color) {
    const key = 'tex' + kind + color;
    if (cache.has(key)) return cache.get(key);
    if (kind === 'none') return null;
    const size = kind === 'botanical' ? 600 : 256;
    const [c, g] = canvas(size, size), R = rng(7);
    g.fillStyle = color; g.fillRect(0, 0, size, size);
    const noise = (n, a) => { for (let i = 0; i < n; i++) { g.fillStyle = R() < 0.5 ? `rgba(0,0,0,${a * R()})` : `rgba(255,255,255,${a * R()})`; g.fillRect(R() * size, R() * size, 1, 1); } };
    if (kind === 'linen') {
      for (let y = 0; y < size; y += 2) { g.fillStyle = `rgba(${R() < 0.5 ? '0,0,0' : '255,255,255'},${R() * 0.07})`; g.fillRect(0, y, size, 1); }
      for (let x = 0; x < size; x += 2) { g.fillStyle = `rgba(${R() < 0.5 ? '0,0,0' : '255,255,255'},${R() * 0.07})`; g.fillRect(x, 0, 1, size); }
      noise(5000, 0.08);
    } else if (kind === 'paper') {
      noise(12000, 0.09);
    } else if (kind === 'hanji') {
      noise(6000, 0.06);
      g.lineCap = 'round';
      for (let i = 0; i < 260; i++) {
        g.strokeStyle = `rgba(${R() < 0.6 ? '120,100,70' : '255,255,255'},${0.05 + R() * 0.1})`;
        g.lineWidth = 0.4 + R() * 1.1;
        const x = R() * size, y = R() * size;
        g.beginPath(); g.moveTo(x, y); g.bezierCurveTo(x + (R() - 0.5) * 60, y + (R() - 0.5) * 60, x + (R() - 0.5) * 60, y + (R() - 0.5) * 60, x + (R() - 0.5) * 80, y + (R() - 0.5) * 80); g.stroke();
      }
    } else if (kind === 'botanical') {
      noise(9000, 0.07);
      g.lineCap = 'round';
      for (let k = 0; k < 14; k++) {
        let x = R() * size, y = R() * size, a = R() * Math.PI * 2;
        g.strokeStyle = 'rgba(255,255,255,0.28)'; g.fillStyle = 'rgba(255,255,255,0.12)';
        for (let i = 0; i < 9; i++) {
          const nx = x + Math.cos(a) * 18, ny = y + Math.sin(a) * 18;
          g.lineWidth = 1.2; g.beginPath(); g.moveTo(x, y); g.lineTo(nx, ny); g.stroke();
          for (const d of [-1, 1]) {
            g.save(); g.translate(nx, ny); g.rotate(a + d * 0.9);
            g.beginPath(); g.ellipse(12, 0, 12, 4.5, 0, 0, Math.PI * 2); g.fill(); g.stroke(); g.restore();
          }
          x = nx; y = ny; a += (R() - 0.5) * 0.5;
        }
      }
    }
    const url = c.toDataURL();
    cache.set(key, url);
    return url;
  }

  /* ─ 이미지 가공: 흰 배경 지우기, 단색·그라데이션 입히기 ─ */
  function loadImg(src) {
    return new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = src; });
  }
  async function process(src, { knock = false, tint = 'none', c1 = '#000000', c2 = '#000000', angle = 90 } = {}) {
    if (!knock && tint === 'none') return src;
    const key = [src.length, src.slice(-64), knock, tint, c1, c2, angle].join('|');
    if (cache.has(key)) return cache.get(key);
    const img = await loadImg(src);
    const w = img.naturalWidth || 400, h = img.naturalHeight || 400;
    const [c, g] = canvas(w, h);
    g.drawImage(img, 0, 0, w, h);
    if (knock) {
      const d = g.getImageData(0, 0, w, h), p = d.data;
      for (let i = 0; i < p.length; i += 4) {
        const l = Math.min(p[i], p[i + 1], p[i + 2]);
        if (l > 235) p[i + 3] = 0;
        else if (l > 200) p[i + 3] = Math.round(p[i + 3] * (235 - l) / 35);
      }
      g.putImageData(d, 0, 0);
    }
    if (tint !== 'none') {
      g.globalCompositeOperation = 'source-in';
      if (tint === 'gradient') {
        const a = angle * Math.PI / 180, cx = w / 2, cy = h / 2, r = Math.abs(w * Math.cos(a)) / 2 + Math.abs(h * Math.sin(a)) / 2;
        const gr = g.createLinearGradient(cx - Math.cos(a) * r, cy - Math.sin(a) * r, cx + Math.cos(a) * r, cy + Math.sin(a) * r);
        gr.addColorStop(0, c1); gr.addColorStop(1, c2);
        g.fillStyle = gr;
      } else g.fillStyle = c1;
      g.fillRect(0, 0, w, h);
    }
    const url = c.toDataURL();
    cache.set(key, url);
    return url;
  }

  /* 올린 그림은 저장 공간을 아끼려고 줄인다 (투명도 유지를 위해 PNG) */
  async function shrinkUpload(file, max = 1400) {
    const src = await new Promise(res => { const r = new FileReader(); r.onload = () => res(r.result); r.readAsDataURL(file); });
    if (file.type === 'image/svg+xml') return src;
    const img = await loadImg(src);
    const k = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
    if (k === 1 && file.size < 900000) return src;
    const [c, g] = canvas(Math.round(img.naturalWidth * k), Math.round(img.naturalHeight * k));
    g.drawImage(img, 0, 0, c.width, c.height);
    return c.toDataURL(file.type === 'image/jpeg' ? 'image/jpeg' : 'image/png', 0.88);
  }

  /* 내장 장식 목록: 장식 패널의 버튼과 템플릿이 쓴다 */
  const BUILTINS = {
    plum: { name: '매화 가지', w: 520, make: p => plum(p), params: { branch: '#1b1b1b', petals: ['#d93a3a', '#1b1b1b'] } },
    watercolor: { name: '수채 꽃가지', w: 520, make: p => plum({ ...p, soft: true }), params: { branch: '#c3b3e0', petals: ['#f6a3c8', '#c9b6f2', '#fbc4d9'] } },
    cloud: { name: '구름띠', w: 300, make: p => cloud(p), params: { color: '#8d8883', style: 'fill' } },
    cloudline: { name: '구름 윤곽', w: 280, make: p => cloud({ ...p, style: 'line' }), params: { color: '#9d9892' } },
    flower: { name: '꽃 한 송이', w: 60, make: p => flower(p), params: { color: '#f2a0b8', center: '#c2255c' } },
    ornament: { name: '장식 구분선', w: 520, make: p => ornament(p), params: { color: '#8b7fb8' } },
    lattice: { name: '꽃살 띠', w: 1200, make: p => lattice(p), params: { color: '#222222' } },
    tree: { name: '나무 실루엣', w: 460, make: p => tree(p), params: {} },
    corner: { name: '모서리 장식', w: 160, make: p => corner(p), params: { color: '#8a6d3b' } }
  };

  function builtinSrc(gen, params, seed) {
    const b = BUILTINS[gen];
    if (!b) return '';
    const key = 'b' + gen + seed + JSON.stringify(params);
    if (!cache.has(key)) cache.set(key, b.make({ ...b.params, ...params, seed }));
    return cache.get(key);
  }

  return { BUILTINS, builtinSrc, texture, woodcutFrame, process, shrinkUpload, flower, ornament, loadImg };
})();
