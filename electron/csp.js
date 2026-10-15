'use strict';
// 편집기 HTML 문서의 CSP(허용 자원 목록). Electron(app:// 응답 머리글)과 웹판 배포 폴더(Cloudflare Pages `_headers`)가 같이 쓴다.
// import map은 인라인 스크립트라 내용의 해시로 허용한다. 그 밖의 인라인 스크립트·onclick="…" 같은 속성 스크립트·eval은 막힌다
// → 남이 준 프로젝트·템플릿 파일에 HTML 조각이 숨어 있어도 스크립트로 실행되지 않는다.
const crypto = require('node:crypto');

function cspFor(html) {
  // 브라우저는 줄바꿈을 \n으로 바꾼 뒤 해시를 잰다(HTML 규칙). Windows에서 git이 줄 끝을 \r\n으로 바꿔 받은 파일도 같은 해시가 나오게
  html = html.replace(/\r\n?/g, '\n');
  const hashes = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)]
    .map((m) => `'sha256-${crypto.createHash('sha256').update(m[1]).digest('base64')}'`);
  return [
    "default-src 'self'",
    `script-src 'self' ${hashes.join(' ')}`,
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' data: blob: https://fonts.gstatic.com",
    // 외부 HTML 붙여넣기의 원격 이미지, 출력 때의 data:/blob: 이미지
    "img-src 'self' data: blob: https:",
    // 출력 때 이미지·글꼴을 fetch로 읽어 data URL로 넣는다
    "connect-src 'self' data: blob: https:",
    "object-src 'none'", "base-uri 'none'", "form-action 'none'", "frame-src 'none'",
  ].join('; ');
}

module.exports = { cspFor };
