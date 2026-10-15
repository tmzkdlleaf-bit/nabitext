// 웹판 배포 폴더 만들기: 렌더러 파일만 dist/web으로 복사한다(번들러 없음, 파일 내용은 그대로).
// Cloudflare Pages의 출력 폴더를 dist/web으로 지정하거나 `npx wrangler pages deploy dist/web`로 올린다.
// 프로젝트 폴더를 통째로 올리면 node_modules·electron·test까지 올라가므로 이 폴더를 쓴다.
import { cpSync, rmSync, mkdirSync, readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'dist', 'web');
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
for (const item of ['index.html', 'demo.html', 'manifest.webmanifest', 'res', 'src', 'vendor', 'demo', 'app']) cpSync(join(root, item), join(out, item), { recursive: true });
// Cloudflare Pages 응답 머리글(_headers): 편집기·데모 HTML에 CSP(허용 자원 목록). Electron판과 같은 규칙(electron/csp.js)
// → 남이 준 프로젝트·템플릿 파일에 HTML 조각이 숨어 있어도 스크립트로 실행되지 않는다.
const { cspFor } = createRequire(import.meta.url)('../electron/csp.js');
let headers = '/*\n  X-Content-Type-Options: nosniff\n  Referrer-Policy: same-origin\n';
for (const [file, paths] of [['index.html', ['/', '/index.html', '/index']], ['demo.html', ['/demo.html', '/demo']]]) {
  const csp = cspFor(readFileSync(join(root, file), 'utf8'));
  for (const p of paths) headers += `${p}\n  Content-Security-Policy: ${csp}\n`;
}
writeFileSync(join(out, '_headers'), headers);
// 서비스 워커: 편집기에 필요한 파일 목록과 버전(내용 해시)을 넣는다(데모는 빼고). 파일이 바뀌면 버전이 바뀌어 새로 받는다
const files = [];
const walk = (dir, rel) => { for (const f of readdirSync(dir)) { const p = join(dir, f), r = rel ? `${rel}/${f}` : f; if (statSync(p).isDirectory()) walk(p, r); else files.push(r); } };
for (const item of ['index.html', 'manifest.webmanifest', 'res', 'src', 'vendor', 'app']) { if (statSync(join(out, item)).isDirectory()) walk(join(out, item), item); else files.push(item); }
const hash = createHash('sha256');
for (const f of files.sort()) hash.update(f).update(readFileSync(join(out, f)));
const sw = readFileSync(join(root, 'sw.js'), 'utf8').replace("const VERSION = 'dev';", `const VERSION = '${hash.digest('hex').slice(0, 12)}';`).replace('const FILES = [];', `const FILES = ${JSON.stringify(['./', ...files])};`);
writeFileSync(join(out, 'sw.js'), sw);
console.log('웹판 →', out);
