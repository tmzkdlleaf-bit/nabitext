// 아이콘: Lucide(lucide-static 1.48.0)에서 쓰는 것만 옮겨 둠(ISC 라이선스, 아래 원문).
/*
ISC License

Copyright (c) 2026 Lucide Icons and Contributors

Permission to use, copy, modify, and/or distribute this software for any
purpose with or without fee is hereby granted, provided that the above
copyright notice and this permission notice appear in all copies.

THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES
WITH REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF
MERCHANTABILITY AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR
ANY SPECIAL, DIRECT, INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES
WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS, WHETHER IN AN
ACTION OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION, ARISING OUT OF
OR IN CONNECTION WITH THE USE OR PERFORMANCE OF THIS SOFTWARE.

---

The following Lucide icons are derived from the Feather project:

airplay, alert-circle, alert-octagon, alert-triangle, aperture, arrow-down-circle, arrow-down-left, arrow-down-right, arrow-down, arrow-left-circle, arrow-left, arrow-right-circle, arrow-right, arrow-up-circle, arrow-up-left, arrow-up-right, arrow-up, at-sign, calendar, cast, check, chevron-down, chevron-left, chevron-right, chevron-up, chevrons-down, chevrons-left, chevrons-right, chevrons-up, circle, clipboard, clock, code, columns, command, compass, corner-down-left, corner-down-right, corner-left-down, corner-left-up, corner-right-down, corner-right-up, corner-up-left, corner-up-right, crosshair, database, divide-circle, divide-square, dollar-sign, download, external-link, feather, frown, hash, headphones, help-circle, info, italic, key, layout, life-buoy, link-2, link, loader, lock, log-in, log-out, maximize, meh, minimize, minimize-2, minus-circle, minus-square, minus, monitor, moon, more-horizontal, more-vertical, move, music, navigation-2, navigation, octagon, pause-circle, percent, plus-circle, plus-square, plus, power, radio, rss, search, server, share, shopping-bag, sidebar, smartphone, smile, square, table-2, tablet, target, terminal, trash-2, trash, triangle, tv, type, upload, x-circle, x-octagon, x-square, x, zoom-in, zoom-out

The MIT License (MIT) (for the icons listed above)

Copyright (c) 2013-present Cole Bemis

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
*/

const P = {
"mouse-pointer-2": "<path d=\"M4.037 4.688a.495.495 0 0 1 .651-.651l16 6.5a.5.5 0 0 1-.063.947l-6.124 1.58a2 2 0 0 0-1.438 1.435l-1.579 6.126a.5.5 0 0 1-.947.063z\" />",
"type": "<path d=\"M12 4v16\" /> <path d=\"M4 7V5a1 1 0 0 1 1-1h14a1 1 0 0 1 1 1v2\" /> <path d=\"M9 20h6\" />",
"shapes": "<path d=\"M8.3 10a.7.7 0 0 1-.626-1.079L11.4 3a.7.7 0 0 1 1.198-.043L16.3 8.9a.7.7 0 0 1-.572 1.1Z\" /> <rect x=\"3\" y=\"14\" width=\"7\" height=\"7\" rx=\"1\" /> <circle cx=\"17.5\" cy=\"17.5\" r=\"3.5\" />",
"square": "<rect width=\"18\" height=\"18\" x=\"3\" y=\"3\" rx=\"2\" />",
"circle": "<circle cx=\"12\" cy=\"12\" r=\"10\" />",
"hexagon": "<path d=\"M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z\" />",
"minus": "<path d=\"M5 12h14\" />",
"pen-tool": "<path d=\"M15.707 21.293a1 1 0 0 1-1.414 0l-1.586-1.586a1 1 0 0 1 0-1.414l5.586-5.586a1 1 0 0 1 1.414 0l1.586 1.586a1 1 0 0 1 0 1.414z\" /> <path d=\"m18 13-1.375-6.874a1 1 0 0 0-.746-.776L3.235 2.028a1 1 0 0 0-1.207 1.207L5.35 15.879a1 1 0 0 0 .776.746L13 18\" /> <path d=\"m2.3 2.3 7.286 7.286\" /> <circle cx=\"11\" cy=\"11\" r=\"2\" />",
"image": "<rect width=\"18\" height=\"18\" x=\"3\" y=\"3\" rx=\"2\" ry=\"2\" /> <circle cx=\"9\" cy=\"9\" r=\"2\" /> <path d=\"m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21\" />",
"search": "<path d=\"m21 21-4.34-4.34\" /> <circle cx=\"11\" cy=\"11\" r=\"8\" />",
"undo-2": "<path d=\"M9 14 4 9l5-5\" /> <path d=\"M4 9h10.5a5.5 5.5 0 0 1 5.5 5.5a5.5 5.5 0 0 1-5.5 5.5H11\" />",
"redo-2": "<path d=\"m15 14 5-5-5-5\" /> <path d=\"M20 9H9.5A5.5 5.5 0 0 0 4 14.5A5.5 5.5 0 0 0 9.5 20H13\" />",
"ruler": "<path d=\"M21.3 15.3a2.4 2.4 0 0 1 0 3.4l-2.6 2.6a2.4 2.4 0 0 1-3.4 0L2.7 8.7a2.41 2.41 0 0 1 0-3.4l2.6-2.6a2.41 2.41 0 0 1 3.4 0Z\" /> <path d=\"m14.5 12.5 2-2\" /> <path d=\"m11.5 9.5 2-2\" /> <path d=\"m8.5 6.5 2-2\" /> <path d=\"m17.5 15.5 2-2\" />",
"grid-3x3": "<rect width=\"18\" height=\"18\" x=\"3\" y=\"3\" rx=\"2\" /> <path d=\"M3 9h18\" /> <path d=\"M3 15h18\" /> <path d=\"M9 3v18\" /> <path d=\"M15 3v18\" />",
"scan": "<path d=\"M3 7V5a2 2 0 0 1 2-2h2\" /> <path d=\"M17 3h2a2 2 0 0 1 2 2v2\" /> <path d=\"M21 17v2a2 2 0 0 1-2 2h-2\" /> <path d=\"M7 21H5a2 2 0 0 1-2-2v-2\" />",
"settings": "<path d=\"M9.671 4.136a2.34 2.34 0 0 1 4.659 0 2.34 2.34 0 0 0 3.319 1.915 2.34 2.34 0 0 1 2.33 4.033 2.34 2.34 0 0 0 0 3.831 2.34 2.34 0 0 1-2.33 4.033 2.34 2.34 0 0 0-3.319 1.915 2.34 2.34 0 0 1-4.659 0 2.34 2.34 0 0 0-3.32-1.915 2.34 2.34 0 0 1-2.33-4.033 2.34 2.34 0 0 0 0-3.831A2.34 2.34 0 0 1 6.35 6.051a2.34 2.34 0 0 0 3.319-1.915\" /> <circle cx=\"12\" cy=\"12\" r=\"3\" />",
"download": "<path d=\"M12 15V3\" /> <path d=\"M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4\" /> <path d=\"m7 10 5 5 5-5\" />",
"menu": "<path d=\"M4 5h16\" /> <path d=\"M4 12h16\" /> <path d=\"M4 19h16\" />",
"chevron-down": "<path d=\"m6 9 6 6 6-6\" />",
"chevron-right": "<path d=\"m9 18 6-6-6-6\" />",
"plus": "<path d=\"M5 12h14\" /> <path d=\"M12 5v14\" />",
"copy": "<rect width=\"14\" height=\"14\" x=\"8\" y=\"8\" rx=\"2\" ry=\"2\" /> <path d=\"M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2\" />",
"trash-2": "<path d=\"M10 11v6\" /> <path d=\"M14 11v6\" /> <path d=\"M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6\" /> <path d=\"M3 6h18\" /> <path d=\"M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2\" />",
"file-stack": "<path d=\"M11 21a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-8a1 1 0 0 1 1-1\" /> <path d=\"M16 16a1 1 0 0 1-1 1H9a1 1 0 0 1-1-1V8a1 1 0 0 1 1-1\" /> <path d=\"M21 6a2 2 0 0 0-.586-1.414l-2-2A2 2 0 0 0 17 2h-3a1 1 0 0 0-1 1v8a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1z\" />",
"layout-template": "<rect width=\"18\" height=\"7\" x=\"3\" y=\"3\" rx=\"1\" /> <rect width=\"9\" height=\"7\" x=\"3\" y=\"14\" rx=\"1\" /> <rect width=\"5\" height=\"7\" x=\"16\" y=\"14\" rx=\"1\" />",
"align-start-vertical": "<rect width=\"9\" height=\"6\" x=\"6\" y=\"14\" rx=\"2\" /> <rect width=\"16\" height=\"6\" x=\"6\" y=\"4\" rx=\"2\" /> <path d=\"M2 2v20\" />",
"align-center-vertical": "<path d=\"M12 2v20\" /> <path d=\"M8 10H4a2 2 0 0 1-2-2V6c0-1.1.9-2 2-2h4\" /> <path d=\"M16 10h4a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2h-4\" /> <path d=\"M8 20H7a2 2 0 0 1-2-2v-2c0-1.1.9-2 2-2h1\" /> <path d=\"M16 14h1a2 2 0 0 1 2 2v2a2 2 0 0 1-2 2h-1\" />",
"align-end-vertical": "<rect width=\"16\" height=\"6\" x=\"2\" y=\"4\" rx=\"2\" /> <rect width=\"9\" height=\"6\" x=\"9\" y=\"14\" rx=\"2\" /> <path d=\"M22 22V2\" />",
"align-start-horizontal": "<rect width=\"6\" height=\"16\" x=\"4\" y=\"6\" rx=\"2\" /> <rect width=\"6\" height=\"9\" x=\"14\" y=\"6\" rx=\"2\" /> <path d=\"M22 2H2\" />",
"align-center-horizontal": "<path d=\"M2 12h20\" /> <path d=\"M10 16v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-4\" /> <path d=\"M10 8V4a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v4\" /> <path d=\"M20 16v1a2 2 0 0 1-2 2h-2a2 2 0 0 1-2-2v-1\" /> <path d=\"M14 8V7c0-1.1.9-2 2-2h2a2 2 0 0 1 2 2v1\" />",
"align-end-horizontal": "<rect width=\"6\" height=\"16\" x=\"4\" y=\"2\" rx=\"2\" /> <rect width=\"6\" height=\"9\" x=\"14\" y=\"9\" rx=\"2\" /> <path d=\"M22 22H2\" />",
"align-horizontal-distribute-center": "<rect width=\"6\" height=\"14\" x=\"4\" y=\"5\" rx=\"2\" /> <rect width=\"6\" height=\"10\" x=\"14\" y=\"7\" rx=\"2\" /> <path d=\"M17 22v-5\" /> <path d=\"M17 7V2\" /> <path d=\"M7 22v-3\" /> <path d=\"M7 5V2\" />",
"align-vertical-distribute-center": "<path d=\"M22 17h-3\" /> <path d=\"M22 7h-5\" /> <path d=\"M5 17H2\" /> <path d=\"M7 7H2\" /> <rect x=\"5\" y=\"14\" width=\"14\" height=\"6\" rx=\"2\" /> <rect x=\"7\" y=\"4\" width=\"10\" height=\"6\" rx=\"2\" />",
"bold": "<path d=\"M6 12h9a4 4 0 0 1 0 8H7a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1h7a4 4 0 0 1 0 8\" />",
"italic": "<line x1=\"19\" x2=\"10\" y1=\"4\" y2=\"4\" /> <line x1=\"14\" x2=\"5\" y1=\"20\" y2=\"20\" /> <line x1=\"15\" x2=\"9\" y1=\"4\" y2=\"20\" />",
"underline": "<path d=\"M6 4v6a6 6 0 0 0 12 0V4\" /> <line x1=\"4\" x2=\"20\" y1=\"20\" y2=\"20\" />",
"strikethrough": "<path d=\"M16 4H9a3 3 0 0 0-2.83 4\" /> <path d=\"M14 12a4 4 0 0 1 0 8H6\" /> <line x1=\"4\" x2=\"20\" y1=\"12\" y2=\"12\" />",
"align-left": "<path d=\"M21 5H3\" /> <path d=\"M15 12H3\" /> <path d=\"M17 19H3\" />",
"align-center": "<path d=\"M21 5H3\" /> <path d=\"M17 12H7\" /> <path d=\"M19 19H5\" />",
"align-right": "<path d=\"M21 5H3\" /> <path d=\"M21 12H9\" /> <path d=\"M21 19H7\" />",
"align-justify": "<path d=\"M3 5h18\" /> <path d=\"M3 12h18\" /> <path d=\"M3 19h18\" />",
"lock": "<rect width=\"18\" height=\"11\" x=\"3\" y=\"11\" rx=\"2\" ry=\"2\" /> <path d=\"M7 11V7a5 5 0 0 1 10 0v4\" />",
"unlock": "<rect width=\"18\" height=\"11\" x=\"3\" y=\"11\" rx=\"2\" ry=\"2\" /> <path d=\"M7 11V7a5 5 0 0 1 9.9-1\" />",
"eye": "<path d=\"M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0\" /> <circle cx=\"12\" cy=\"12\" r=\"3\" />",
"eye-off": "<path d=\"M10.733 5.076a10.744 10.744 0 0 1 11.205 6.575 1 1 0 0 1 0 .696 10.747 10.747 0 0 1-1.444 2.49\" /> <path d=\"M14.084 14.158a3 3 0 0 1-4.242-4.242\" /> <path d=\"M17.479 17.499a10.75 10.75 0 0 1-15.417-5.151 1 1 0 0 1 0-.696 10.75 10.75 0 0 1 4.446-5.143\" /> <path d=\"m2 2 20 20\" />",
"group": "<path d=\"M3 7V5c0-1.1.9-2 2-2h2\" /> <path d=\"M17 3h2c1.1 0 2 .9 2 2v2\" /> <path d=\"M21 17v2c0 1.1-.9 2-2 2h-2\" /> <path d=\"M7 21H5c-1.1 0-2-.9-2-2v-2\" /> <rect width=\"7\" height=\"5\" x=\"7\" y=\"7\" rx=\"1\" /> <rect width=\"7\" height=\"5\" x=\"10\" y=\"12\" rx=\"1\" />",
"ungroup": "<rect x=\"11\" y=\"14\" width=\"10\" height=\"7\" rx=\"2\" /> <rect x=\"3\" y=\"3\" width=\"10\" height=\"7\" rx=\"2\" />",
"bring-to-front": "<rect x=\"8\" y=\"8\" width=\"8\" height=\"8\" rx=\"2\" /> <path d=\"M4 10a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2\" /> <path d=\"M14 20a2 2 0 0 0 2 2h4a2 2 0 0 0 2-2v-4a2 2 0 0 0-2-2\" />",
"send-to-back": "<rect x=\"14\" y=\"14\" width=\"8\" height=\"8\" rx=\"2\" /> <rect x=\"2\" y=\"2\" width=\"8\" height=\"8\" rx=\"2\" /> <path d=\"M7 14v1a2 2 0 0 0 2 2h1\" /> <path d=\"M14 7h1a2 2 0 0 1 2 2v1\" />",
"arrow-up": "<path d=\"m5 12 7-7 7 7\" /> <path d=\"M12 19V5\" />",
"arrow-down": "<path d=\"M12 5v14\" /> <path d=\"m19 12-7 7-7-7\" />",
"file-image": "<path d=\"M6 22a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.704.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2z\" /> <path d=\"M14 2v5a1 1 0 0 0 1 1h5\" /> <circle cx=\"10\" cy=\"12\" r=\"2\" /> <path d=\"m20 17-1.296-1.296a2.41 2.41 0 0 0-3.408 0L9 22\" />",
"spline": "<circle cx=\"19\" cy=\"5\" r=\"2\" /> <circle cx=\"5\" cy=\"19\" r=\"2\" /> <path d=\"M5 17A12 12 0 0 1 17 5\" />",
"text-cursor": "<path d=\"M17 22h-1a4 4 0 0 1-4-4V6a4 4 0 0 1 4-4h1\" /> <path d=\"M7 22h1a4 4 0 0 0 4-4\" /> <path d=\"M7 2h1a4 4 0 0 1 4 4\" />",
"crop": "<path d=\"M6 2v14a2 2 0 0 0 2 2h14\" /> <path d=\"M18 22V8a2 2 0 0 0-2-2H2\" />",
"x": "<path d=\"M18 6 6 18\" /> <path d=\"m6 6 12 12\" />",
"star": "<path d=\"M11.525 2.295a.53.53 0 0 1 .95 0l2.31 4.679a2.123 2.123 0 0 0 1.595 1.16l5.166.756a.53.53 0 0 1 .294.904l-3.736 3.638a2.123 2.123 0 0 0-.611 1.878l.882 5.14a.53.53 0 0 1-.771.56l-4.618-2.428a2.122 2.122 0 0 0-1.973 0L6.396 21.01a.53.53 0 0 1-.77-.56l.881-5.139a2.122 2.122 0 0 0-.611-1.879L2.16 9.795a.53.53 0 0 1 .294-.906l5.165-.755a2.122 2.122 0 0 0 1.597-1.16z\" />",
"zoom-in": "<circle cx=\"11\" cy=\"11\" r=\"8\" /> <line x1=\"21\" x2=\"16.65\" y1=\"21\" y2=\"16.65\" /> <line x1=\"11\" x2=\"11\" y1=\"8\" y2=\"14\" /> <line x1=\"8\" x2=\"14\" y1=\"11\" y2=\"11\" />",
"zoom-out": "<circle cx=\"11\" cy=\"11\" r=\"8\" /> <line x1=\"21\" x2=\"16.65\" y1=\"21\" y2=\"16.65\" /> <line x1=\"8\" x2=\"14\" y1=\"11\" y2=\"11\" />"
};

// icon('bold', 18) → SVG 문자열(선 색 = 글자 색)
export function icon(name, size = 18, stroke = 1.75) {
  const p = P[name];
  if (!p) return '';
  return `<svg class="ic" xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${stroke}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${p}</svg>`;
}
// 정적 HTML의 <i data-icon="이름" data-size="18"></i>를 SVG로 바꾼다
export function fillIcons(root = document) {
  for (const el of root.querySelectorAll('i[data-icon]')) el.outerHTML = icon(el.dataset.icon, +(el.dataset.size || 18));
}
