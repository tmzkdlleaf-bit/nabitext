// 장 크기 고르기(용지·SNS). 값은 화면 px.
//   종이는 96dpi 기준(1mm = 96/25.4px). PDF로 내보내면 1px = 0.75pt라 쪽 크기가 그 용지와 같아진다.
//   인쇄용 해상도는 내보내기 배율로 정한다(3× ≈ 288dpi, 4× ≈ 384dpi).
const mm = (v) => Math.round(v / 25.4 * 96);
const paper = (id, name, w, h) => ({ id, group: '종이', name: `${name} (${w}×${h}mm)`, w: mm(w), h: mm(h) });

export const SIZE_PRESETS = [
  { id: 'sq', group: 'SNS', name: '정사각 1:1', w: 1080, h: 1080 },
  { id: 'portrait45', group: 'SNS', name: '세로 4:5 (인스타그램 세로)', w: 1080, h: 1350 },
  { id: 'portrait34', group: 'SNS', name: '세로 3:4', w: 1080, h: 1440 },
  { id: 'story', group: 'SNS', name: '세로 9:16 (스토리·전체 화면)', w: 1080, h: 1920 },
  { id: 'wide169', group: 'SNS', name: '가로 16:9 (X 한 장)', w: 1600, h: 900 },
  { id: 'x4', group: 'SNS', name: '정사각 (X 네 장 묶음)', w: 1200, h: 1200 },
  paper('a4', 'A4', 210, 297),
  paper('a5', 'A5·국판', 148, 210),
  paper('a3', 'A3', 297, 420),
  paper('b5', 'B5 JIS', 182, 257),
  paper('b6', 'B6 JIS', 128, 182),
  paper('sinkuk', '신국판', 152, 225),
  paper('letter', '레터', 215.9, 279.4),
  paper('postcard', '엽서', 100, 148),
  paper('card', '명함', 90, 50),
];

// 이 크기(가로·세로 어느 쪽이든)에 맞는 크기 이름 → { preset, landscape } | null
export function matchSize(w, h) {
  for (const p of SIZE_PRESETS) {
    if (p.w === w && p.h === h) return { preset: p, landscape: p.w > p.h };
    if (p.w === h && p.h === w) return { preset: p, landscape: !(p.w > p.h) };
  }
  return null;
}
// 크기 이름 → w·h. landscape: true = 가로가 길게, false = 세로가 길게, null = 그 크기 본래 방향
export function sizeOf(id, landscape = null) {
  const p = SIZE_PRESETS.find((x) => x.id === id);
  if (!p) return null;
  if (landscape == null || p.w === p.h) return { w: p.w, h: p.h };
  const long = Math.max(p.w, p.h), short = Math.min(p.w, p.h);
  return landscape ? { w: long, h: short } : { w: short, h: long };
}
