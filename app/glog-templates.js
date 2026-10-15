// 기본 글로그 틀: 커뮤·TRPG·SNS에서 많이 쓰는 글 로그 이미지 형식을 새 장으로 만든다.
// 배치·글꼴·색은 고치기 쉬운 기본값이고, 글은 모두 자리 표시 글(인물 이름·설정은 넣지 않음)이다.
// 사진 자리는 이미지 슬롯(주황 점선): 사진을 끌어다 놓거나 속성 패널 "이미지 바꾸기"로 채운다.
// build(ctx) → { background, elements }. ctx.photo(w, h): 사진 자리 그림 주소(앱이 만들어 넘김)

import * as M from './model.js';

const SANS = '"Noto Sans KR", "Noto Sans CJK KR", "Malgun Gothic", sans-serif';
const SERIF = '"Noto Serif KR", "Noto Serif CJK KR", "Batang", "AppleMyungjo", serif';
const MONO = '"Noto Sans Mono CJK KR", "D2Coding", "Consolas", monospace';

// ---------- 문서 도우미 ----------
// 글(줄바꿈 \n은 강제 줄바꿈) → 인라인 내용
function inline(text, marks) {
  const out = [];
  String(text).split('\n').forEach((t, i) => {
    if (i) out.push({ type: 'hard_break' });
    if (t) out.push({ type: 'text', text: t, ...(marks?.length ? { marks } : {}) });
  });
  return out;
}
// 문단: P('글', { align, indent, spacing }, [마크…]) 또는 P([['굵은 부분', [B]], ['보통']], …)
const P = (text, attrs = {}, marks) => {
  const content = Array.isArray(text) ? text.flatMap(([t, m]) => inline(t, m)) : inline(text, marks);
  return { type: 'paragraph', attrs: { align: null, indent: 0, spacing: null, ...attrs }, ...(content.length ? { content } : {}) };
};
const doc = (...paras) => ({ type: 'doc', content: paras.length ? paras : [{ type: 'paragraph' }] });
const B = { type: 'bold' };
const I = { type: 'italic' };
const color = (v) => ({ type: 'color', attrs: { value: v } });
const size = (v) => ({ type: 'size', attrs: { value: v } });

// ---------- 요소 도우미 ----------
const text = (name, box, style, d, extra = {}) => M.makeElement('text', { name, ...box, padding: 0, style: { fontFamily: SANS, ...style }, doc: d, ...extra });
const rect = (name, box, fill, extra = {}) => M.makeElement('shape', { name, ...box, shape: 'rect', fill, stroke: '#000000', strokeWidth: 0, radius: 0, ...extra });
const oval = (name, box, fill, extra = {}) => M.makeElement('shape', { name, ...box, shape: 'ellipse', fill, stroke: '#000000', strokeWidth: 0, ...extra });
const photo = (ctx, name, box, extra = {}) => M.makeElement('image', { name, ...box, src: ctx.photo(box.w, box.h), fit: 'cover', slot: true, ...extra });
const group = (name, children) => M.makeElement('group', { name, children });
const hr = (name, x, y, w, fill = '#cfc8bc', h = 2) => rect(name, { x, y, w, h }, fill);

const BODY = '여기에 본문을 씁니다. 글상자를 두 번 누르면(태블릿은 두 번 톡) 바로 고칠 수 있습니다.';
const LONG = `${BODY} 글이 길어지면 글상자를 늘리거나, 속성 패널의 "넘치면 글자 줄이기"를 켜 두면 상자 안에 맞춰 글자가 작아집니다.`;

export const GLOG_TEMPLATES = [
  {
    id: 'novel', name: '소설 페이지', desc: '책 본문처럼 제목·본문·쪽 번호. 한 장에 글이 많은 로그', w: 1080, h: 1528,
    build: () => ({
      background: '#fbf8f2',
      elements: [
        text('제목', { x: 120, y: 150, w: 840, h: 80 }, { fontFamily: SERIF, fontSize: 44, color: '#2b2722', lineHeight: 1.3 }, doc(P('제목', { align: 'center' }))),
        text('부제', { x: 120, y: 236, w: 840, h: 44 }, { fontFamily: SERIF, fontSize: 22, color: '#8c8273' }, doc(P('부제 또는 회차', { align: 'center' }))),
        hr('구분선', 500, 312, 80, '#b9ad9a'),
        text('본문', { x: 120, y: 360, w: 840, h: 1000 }, { fontFamily: SERIF, fontSize: 26, color: '#2b2722', lineHeight: 1.85 },
          doc(P(LONG, { align: 'justify', indent: 26, spacing: 12 }), P(BODY, { align: 'justify', indent: 26, spacing: 12 }), P('"대사는 이렇게 씁니다."', { align: 'justify', indent: 26, spacing: 12 })), { autoShrink: true, minScale: 0.6 }),
        text('쪽 번호', { x: 440, y: 1410, w: 200, h: 40 }, { fontFamily: SERIF, fontSize: 20, color: '#a3998a' }, doc(P('— 1 —', { align: 'center' }))),
      ],
    }),
  },
  {
    id: 'cover', name: '표지 + 본문', desc: '위에 사진(캐릭터·장면), 아래 제목과 본문', w: 1080, h: 1350,
    build: (ctx) => ({
      background: '#ffffff',
      elements: [
        photo(ctx, '사진 자리', { x: 0, y: 0, w: 1080, h: 540 }),
        text('제목', { x: 80, y: 590, w: 920, h: 72 }, { fontSize: 46, fontWeight: 700, color: '#1d1d1f', lineHeight: 1.3 }, doc(P('제목'))),
        text('정보', { x: 80, y: 668, w: 920, h: 40 }, { fontSize: 22, color: '#86868b' }, doc(P('글 · 이름　|　날짜'))),
        hr('구분선', 80, 732, 920, '#e5e5ea'),
        text('본문', { x: 80, y: 770, w: 920, h: 500 }, { fontSize: 26, color: '#333336', lineHeight: 1.75 }, doc(P(LONG, { spacing: 14 }), P(BODY)), { autoShrink: true, minScale: 0.6 }),
      ],
    }),
  },
  {
    id: 'quote', name: '한 구절(발췌)', desc: '짧은 대사·구절 하나를 크게. 아래에 제목·글쓴이', w: 1080, h: 1080,
    build: () => ({
      background: '#1f2430',
      elements: [
        text('따옴표', { x: 110, y: 110, w: 200, h: 170 }, { fontFamily: SERIF, fontSize: 170, color: '#c9a86a', lineHeight: 1 }, doc(P('“'))),
        text('구절', { x: 140, y: 300, w: 800, h: 440 }, { fontFamily: SERIF, fontSize: 40, color: '#f2efe8', lineHeight: 1.75 }, doc(P('기억에 남는 한 구절이나 대사를 여기에 씁니다.')), { autoShrink: true, minScale: 0.6 }),
        hr('구분선', 140, 800, 60, '#c9a86a', 3),
        text('출처', { x: 140, y: 830, w: 800, h: 100 }, { fontSize: 24, color: '#a8adb8', lineHeight: 1.6 }, doc(P('작품 제목'), P('글쓴이'))),
      ],
    }),
  },
  {
    id: 'chat', name: '대화 로그(메신저)', desc: '말풍선으로 주고받는 대화. 왼쪽·오른쪽 두 사람', w: 1080, h: 1350,
    build: () => {
      const els = [rect('대화방 막대', { x: 0, y: 0, w: 1080, h: 110 }, '#f3f4f7'),
        text('대화방 이름', { x: 140, y: 32, w: 800, h: 50 }, { fontSize: 30, fontWeight: 700, color: '#222' }, doc(P('대화방 이름', { align: 'center' })))];
      const left = (y, name, msg, h) => group(`${name} 말`, [
        oval('프로필', { x: 40, y, w: 76, h: 76 }, '#c7ccd6'),
        text('이름', { x: 136, y: y - 2, w: 400, h: 36 }, { fontSize: 22, color: '#5f6470' }, doc(P(name))),
        rect('말풍선', { x: 136, y: y + 40, w: 600, h }, '#ffffff', { radius: 30 }),
        text('말', { x: 166, y: y + 62, w: 540, h: h - 44 }, { fontSize: 27, color: '#222', lineHeight: 1.5 }, doc(P(msg))),
        text('시각', { x: 750, y: y + 40 + h - 34, w: 120, h: 30 }, { fontSize: 18, color: '#8a909c' }, doc(P('오후 3:00'))),
      ]);
      const right = (y, msg, h) => group('내 말', [
        rect('말풍선', { x: 404, y, w: 636, h }, '#4f6bed', { radius: 30 }),
        text('말', { x: 434, y: y + 22, w: 576, h: h - 44 }, { fontSize: 27, color: '#ffffff', lineHeight: 1.5 }, doc(P(msg))),
        text('시각', { x: 270, y: y + h - 34, w: 120, h: 30 }, { fontSize: 18, color: '#8a909c' }, doc(P('오후 3:01', { align: 'right' }))),
      ]);
      els.push(left(160, '인물 A', '상대가 보낸 말입니다.', 100), right(390, '내가 보낸 말입니다. 길면 말풍선과 글상자를 함께 늘려 주세요.', 140),
        left(570, '인물 A', '말풍선은 묶음(그룹)이라 통째로 옮기고 복제할 수 있습니다.', 140), right(830, '짧은 답', 100));
      return { background: '#dfe4ec', elements: els };
    },
  },
  {
    id: 'script', name: '대본', desc: '"이름 — 대사" 줄과 지문. 세션 로그·짧은 장면에', w: 1080, h: 1350,
    build: () => {
      const line = (name, said) => P([[name, [B, color('#3a4a8c')]], ['　' + said]], { spacing: 18 });
      const note = (t) => P(t, { spacing: 18 }, [I, color('#8a8a8a')]);
      return {
        background: '#ffffff',
        elements: [
          text('제목', { x: 100, y: 110, w: 880, h: 70 }, { fontSize: 42, fontWeight: 700, color: '#1f1f1f' }, doc(P('제목'))),
          text('정보', { x: 100, y: 188, w: 880, h: 40 }, { fontSize: 22, color: '#8a8a8a' }, doc(P('장면 · 장소 · 시간'))),
          hr('구분선', 100, 250, 880, '#e3e3e3'),
          text('대본', { x: 100, y: 290, w: 880, h: 960 }, { fontSize: 27, color: '#2a2a2a', lineHeight: 1.7 },
            doc(note('(지문: 장면 설명이나 행동은 이렇게 씁니다.)'), line('인물 A', '첫 번째 대사입니다.'), line('인물 B', '두 번째 대사입니다.'), note('(잠시 침묵)'), line('인물 A', '대사가 길어지면 다음 줄로 자연스럽게 이어집니다.')), { autoShrink: true, minScale: 0.6 }),
        ],
      };
    },
  },
  {
    id: 'letter', name: '편지', desc: '받는 이 · 본문 · 날짜와 보내는 이(오른쪽)', w: 1080, h: 1350,
    build: () => ({
      background: '#ece3d3',
      elements: [
        rect('편지지', { x: 70, y: 70, w: 940, h: 1210 }, '#fffdf8', { stroke: '#d9cbb3', strokeWidth: 2, radius: 6 }),
        text('받는 이', { x: 150, y: 170, w: 780, h: 60 }, { fontFamily: SERIF, fontSize: 34, color: '#3b3226' }, doc(P('받는 이에게,'))),
        text('본문', { x: 150, y: 270, w: 780, h: 760 }, { fontFamily: SERIF, fontSize: 28, color: '#3b3226', lineHeight: 1.95 }, doc(P(LONG, { spacing: 16 }), P(BODY)), { autoShrink: true, minScale: 0.6 }),
        text('맺음', { x: 150, y: 1070, w: 780, h: 130 }, { fontFamily: SERIF, fontSize: 26, color: '#5b4f3f', lineHeight: 1.8 }, doc(P('날짜', { align: 'right' }), P('보내는 이가', { align: 'right' }))),
      ],
    }),
  },
  {
    id: 'diary', name: '일기·메모', desc: '날짜·날씨 줄과 줄 노트. 줄 간격에 맞춘 본문', w: 1080, h: 1350,
    build: () => {
      const gap = 56, top = 236;
      const lines = [];
      for (let y = top; y <= 1240; y += gap) lines.push(hr('줄', 100, y, 880, '#dfe3ea', 2));
      return {
        background: '#fdfcf7',
        elements: [
          text('날짜', { x: 100, y: 90, w: 880, h: 50 }, { fontSize: 28, color: '#4a5568' }, doc(P([['2026년 ○월 ○일', [B]], ['　·　날씨 ○']]))),
          rect('머리 선', { x: 100, y: 160, w: 880, h: 4 }, '#9fb3c8'),
          M.makeElement('group', { name: '줄 노트', locked: true, children: lines }),
          text('본문', { x: 100, y: top - gap + 8, w: 880, h: 1240 - top + gap }, { fontSize: 28, color: '#2d3748', lineHeight: gap / 28 }, doc(P(LONG, { spacing: 0 }), P(BODY, { spacing: 0 }))),
        ],
      };
    },
  },
  {
    id: 'receipt', name: '영수증', desc: '항목·값을 고정폭 글꼴로. 캐릭터 정리·관계 로그에', w: 720, h: 1500,
    build: () => {
      const bars = [];
      let x = 170;
      for (let i = 0; x < 550; i++) { const w = [3, 6, 2, 8, 4, 2][i % 6]; bars.push(rect('막대', { x, y: 1300, w, h: 90 }, '#222')); x += w + [4, 3, 6, 2, 5][i % 5]; }
      return {
        background: '#e6e3dd',
        elements: [
          rect('종이', { x: 50, y: 50, w: 620, h: 1400 }, '#ffffff'),
          text('제목', { x: 90, y: 110, w: 540, h: 70 }, { fontFamily: MONO, fontSize: 40, fontWeight: 700, color: '#111' }, doc(P('R E C E I P T', { align: 'center' }))),
          text('머리', { x: 90, y: 190, w: 540, h: 90 }, { fontFamily: MONO, fontSize: 20, color: '#444', lineHeight: 1.6 }, doc(P('No. 0001', { align: 'center' }), P('2026-10-15 15:00', { align: 'center' }))),
          text('항목', { x: 90, y: 300, w: 540, h: 850 }, { fontFamily: MONO, fontSize: 22, color: '#111', lineHeight: 1.75 }, doc(
            P('--------------------------------'),
            P('이름 ................... 값'), P('나이 ................... 값'), P('소속 ................... 값'), P('좋아하는 것 ........... 값'), P('싫어하는 것 ........... 값'),
            P('--------------------------------'),
            P('관계 / 메모'), P(BODY),
            P('--------------------------------'),
            P([['합계', [B]], ['　　　　　　　　　　 값']]),
          ), { autoShrink: true, minScale: 0.6 }),
          group('바코드', bars),
          text('맺음', { x: 90, y: 1170, w: 540, h: 100 }, { fontFamily: MONO, fontSize: 20, color: '#444', lineHeight: 1.6 }, doc(P('THANK YOU', { align: 'center' }), P('* * *', { align: 'center' }))),
        ],
      };
    },
  },
  {
    id: 'profile', name: '프로필 카드', desc: '사진·이름·항목표·한마디·설정. 캐릭터 소개용', w: 1080, h: 1350,
    build: (ctx) => ({
      background: '#f3f1ec',
      elements: [
        photo(ctx, '사진 자리', { x: 80, y: 80, w: 420, h: 560 }),
        text('이름', { x: 540, y: 96, w: 460, h: 80 }, { fontSize: 54, fontWeight: 700, color: '#222', lineHeight: 1.3 }, doc(P('이름'))),
        text('소개', { x: 540, y: 186, w: 460, h: 44 }, { fontSize: 24, color: '#8a8478' }, doc(P('한 줄 소개'))),
        hr('구분선', 540, 254, 460, '#d6d0c4'),
        text('항목', { x: 540, y: 284, w: 460, h: 356 }, { fontSize: 24, color: '#333', lineHeight: 1.95 }, doc(...['나이', '키', '생일', '좋아하는 것', '싫어하는 것'].map((k) => P([[k, [B, color('#8a6f3b')]], ['　|　내용']])))),
        rect('한마디 상자', { x: 80, y: 690, w: 920, h: 170 }, '#ffffff', { radius: 18 }),
        text('한마디', { x: 120, y: 735, w: 840, h: 90 }, { fontFamily: SERIF, fontSize: 32, color: '#333', lineHeight: 1.4 }, doc(P('"대표 대사 한 마디"', { align: 'center' }, [I]))),
        text('설정', { x: 80, y: 900, w: 920, h: 370 }, { fontSize: 24, color: '#444', lineHeight: 1.75 }, doc(P('설정·성격·배경을 적는 칸입니다. ' + BODY)), { autoShrink: true, minScale: 0.6 }),
      ],
    }),
  },
  {
    id: 'news', name: '신문 기사', desc: '제호·날짜줄·헤드라인·사진·2단 본문(이어진 글상자)', w: 1080, h: 1528,
    build: (ctx) => {
      const col1 = text('본문 1단', { x: 80, y: 1036, w: 440, h: 420 }, { fontFamily: SERIF, fontSize: 21, color: '#222', lineHeight: 1.7 },
        doc(P(LONG, { align: 'justify', indent: 21 }), P(LONG, { align: 'justify', indent: 21 }), P(LONG, { align: 'justify', indent: 21 }), P(BODY, { align: 'justify', indent: 21 })), { seq: 0 });
      const col2 = text('본문 2단', { x: 560, y: 1036, w: 440, h: 420 }, { fontFamily: SERIF, fontSize: 21, color: '#222', lineHeight: 1.7 }, M.emptyDoc(), { story: col1.id, seq: 1 });
      return {
        background: '#f6f3ea',
        elements: [
          text('제호', { x: 80, y: 60, w: 920, h: 110 }, { fontFamily: SERIF, fontSize: 76, fontWeight: 700, color: '#111', letterSpacing: 6, lineHeight: 1.3 }, doc(P('○○ 일보', { align: 'center' }))),
          hr('위 선', 80, 180, 920, '#111', 3),
          text('날짜줄', { x: 80, y: 192, w: 920, h: 36 }, { fontSize: 19, color: '#444' }, doc(P('2026년 ○월 ○일　·　제 ○호', { align: 'center' }))),
          hr('아래 선', 80, 236, 920, '#111', 1),
          text('헤드라인', { x: 80, y: 262, w: 920, h: 150 }, { fontFamily: SERIF, fontSize: 54, fontWeight: 700, color: '#111', lineHeight: 1.3 }, doc(P('헤드라인을 크게 씁니다'))),
          text('부제', { x: 80, y: 420, w: 920, h: 50 }, { fontSize: 25, color: '#555' }, doc(P('부제 — 기사 요약 한 줄'))),
          photo(ctx, '사진 자리', { x: 80, y: 496, w: 920, h: 460 }),
          text('사진 설명', { x: 80, y: 964, w: 920, h: 34 }, { fontSize: 18, color: '#666' }, doc(P('사진 설명'))),
          col1, col2,
        ],
      };
    },
  },
  {
    id: 'post', name: '게시글 캡처풍', desc: '프로필·이름·아이디·본문·시각. 가상의 SNS 게시글 모양', w: 1080, h: 1080,
    build: () => ({
      background: '#ffffff',
      elements: [
        oval('프로필', { x: 70, y: 80, w: 110, h: 110 }, '#d5d9e0'),
        text('이름', { x: 205, y: 88, w: 760, h: 50 }, { fontSize: 32, fontWeight: 700, color: '#0f1419', lineHeight: 1.4 }, doc(P('이름'))),
        text('아이디', { x: 205, y: 140, w: 760, h: 40 }, { fontSize: 24, color: '#6e767d' }, doc(P('@아이디'))),
        text('본문', { x: 70, y: 240, w: 940, h: 560 }, { fontSize: 34, color: '#0f1419', lineHeight: 1.55 }, doc(P('게시글 본문을 여기에 씁니다. ' + BODY)), { autoShrink: true, minScale: 0.6 }),
        text('시각', { x: 70, y: 850, w: 940, h: 40 }, { fontSize: 24, color: '#6e767d' }, doc(P('오후 3:00 · 2026년 10월 15일'))),
        hr('구분선', 70, 912, 940, '#e6e9ec'),
        text('반응', { x: 70, y: 940, w: 940, h: 44 }, { fontSize: 24, color: '#6e767d' }, doc(P([['0', [B, color('#0f1419')]], [' 답글　　'], ['0', [B, color('#0f1419')]], [' 공유　　'], ['0', [B, color('#0f1419')]], [' 마음']]))),
      ],
    }),
  },
];


// ---------- 사진이 들어가는 틀 ----------
// 원 경로(요소 안 좌표): 지름 w·h 상자에 꼭 맞는 원
const circleD = (x, y, w, h) => { const rx = w / 2, ry = h / 2, cx = x + rx, cy = y + ry; return `M${cx + rx} ${cy}A${rx} ${ry} 0 1 1 ${cx - rx} ${cy}A${rx} ${ry} 0 1 1 ${cx + rx} ${cy}Z`; };
const rectPathD = (x, y, w, h) => `M${x} ${y}L${x + w} ${y}L${x + w} ${y + h}L${x} ${y + h}Z`;
// 상자를 (cx, cy) 둘레로 deg만큼 돌린 자리(요소는 자기 가운데 기준으로 돌므로 가운데를 옮긴다)
function rotAround(box, cx, cy, deg) {
  const a = deg * Math.PI / 180, bx = box.x + box.w / 2 - cx, by = box.y + box.h / 2 - cy;
  const nx = cx + bx * Math.cos(a) - by * Math.sin(a), ny = cy + bx * Math.sin(a) + by * Math.cos(a);
  return { ...box, x: Math.round(nx - box.w / 2), y: Math.round(ny - box.h / 2), rotation: deg };
}

export const PHOTO_TEMPLATES = [
  {
    id: 'overlay', name: '사진 위 글', desc: '사진을 장 전체에 깔고 아래쪽을 어둡게, 그 위에 흰 글', w: 1080, h: 1350,
    build: (ctx) => ({
      background: '#111111',
      elements: [
        photo(ctx, '배경 사진', { x: 0, y: 0, w: 1080, h: 1350 }),
        rect('어둡게', { x: 0, y: 560, w: 1080, h: 790 }, { type: 'linear', angle: 90, stops: [{ o: 0, c: '#00000000' }, { o: 0.45, c: '#000000a6' }, { o: 1, c: '#000000e6' }] }),
        text('제목', { x: 90, y: 860, w: 900, h: 80 }, { fontFamily: SERIF, fontSize: 48, fontWeight: 700, color: '#ffffff', lineHeight: 1.3 }, doc(P('제목'))),
        text('본문', { x: 90, y: 960, w: 900, h: 300 }, { fontSize: 27, color: '#ecebe8', lineHeight: 1.75 }, doc(P(BODY)), { autoShrink: true, minScale: 0.6 }),
      ],
    }),
  },
  {
    id: 'wrap', name: '글이 사진을 감싸기', desc: '본문 한쪽에 사진, 글이 사진 둘레로 흘러감(사진을 옮기면 자리도 같이 맞추기)', w: 1080, h: 1350,
    build: (ctx) => {
      const tb = { x: 90, y: 230, w: 900, h: 1030 }, ph = { x: 90, y: 230, w: 400, h: 520 };
      return {
        background: '#fbfaf7',
        elements: [
          text('제목', { x: 90, y: 100, w: 900, h: 80 }, { fontFamily: SERIF, fontSize: 46, color: '#24211d', lineHeight: 1.3 }, doc(P('제목'))),
          photo(ctx, '사진 자리', ph),
          text('본문(사진 둘레)', tb, { fontFamily: SERIF, fontSize: 25, color: '#2e2a25', lineHeight: 1.8 },
            doc(P(LONG, { align: 'justify', spacing: 14 }), P(LONG, { align: 'justify', spacing: 14 }), P(BODY, { align: 'justify' })),
            { area: { kind: 'path', d: rectPathD(ph.x - tb.x, ph.y - tb.y, ph.w, ph.h), pw: tb.w, ph: tb.h, invert: true }, padding: 28, autoShrink: true, minScale: 0.6 }),
        ],
      };
    },
  },
  {
    id: 'round', name: '둥근 사진 + 둘레 글', desc: '가운데 둥근 사진, 글이 원의 양옆으로 흘러감', w: 1080, h: 1350,
    build: (ctx) => {
      const tb = { x: 80, y: 200, w: 920, h: 1070 }, c = { x: 300, y: 380, w: 480, h: 480 };
      return {
        background: '#f4efe9',
        elements: [
          text('제목', { x: 80, y: 90, w: 920, h: 80 }, { fontFamily: SERIF, fontSize: 44, color: '#3a2f28', lineHeight: 1.3 }, doc(P('제목', { align: 'center' }))),
          photo(ctx, '둥근 사진 자리', c, { mask: { kind: 'shape', d: circleD(0, 0, c.w, c.h), pw: c.w, ph: c.h } }),
          text('본문(원 둘레)', tb, { fontFamily: SERIF, fontSize: 24, color: '#3a2f28', lineHeight: 1.75 },
            doc(P(LONG, { spacing: 12 }), P(LONG, { spacing: 12 }), P(LONG)),
            { area: { kind: 'path', d: circleD(c.x - tb.x, c.y - tb.y, c.w, c.h), pw: tb.w, ph: tb.h, invert: true, minWidth: 60 }, padding: 26, autoShrink: true, minScale: 0.6 }),
        ],
      };
    },
  },
  {
    id: 'split', name: '사진 + 글 반반', desc: '왼쪽 절반 사진, 오른쪽 제목·본문(잡지 펼침면처럼)', w: 1350, h: 1080,
    build: (ctx) => ({
      background: '#ffffff',
      elements: [
        photo(ctx, '사진 자리', { x: 0, y: 0, w: 675, h: 1080 }),
        text('작은 제목', { x: 755, y: 120, w: 520, h: 40 }, { fontSize: 20, color: '#9a8f80', letterSpacing: 4 }, doc(P('CHAPTER 01'))),
        text('제목', { x: 755, y: 170, w: 520, h: 140 }, { fontFamily: SERIF, fontSize: 50, color: '#1e1c19', lineHeight: 1.3 }, doc(P('제목'))),
        hr('구분선', 755, 330, 60, '#1e1c19', 3),
        text('본문', { x: 755, y: 380, w: 520, h: 600 }, { fontFamily: SERIF, fontSize: 24, color: '#33302b', lineHeight: 1.85 }, doc(P(LONG, { align: 'justify', spacing: 14 }), P(BODY, { align: 'justify' })), { autoShrink: true, minScale: 0.6 }),
      ],
    }),
  },
  {
    id: 'grid', name: '사진 네 장 + 글', desc: '위에 사진 2×2, 아래 짧은 글(장면 모음·세션 정리)', w: 1080, h: 1350,
    build: (ctx) => {
      const g = 12, s = (1080 - 80 * 2 - g) / 2;
      const cells = [[0, 0], [1, 0], [0, 1], [1, 1]].map(([i, j], k) => photo(ctx, `사진 ${k + 1}`, { x: 80 + i * (s + g), y: 80 + j * (s + g), w: s, h: s }));
      return {
        background: '#f7f6f3',
        elements: [
          ...cells,
          text('제목', { x: 80, y: 80 + 2 * s + g + 40, w: 920, h: 64 }, { fontSize: 38, fontWeight: 700, color: '#222', lineHeight: 1.3 }, doc(P('제목'))),
          text('본문', { x: 80, y: 80 + 2 * s + g + 110, w: 920, h: 1350 - (80 + 2 * s + g + 110) - 70 }, { fontSize: 25, color: '#444', lineHeight: 1.7 }, doc(P(BODY)), { autoShrink: true, minScale: 0.6 }),
        ],
      };
    },
  },
  {
    id: 'polaroid', name: '폴라로이드', desc: '흰 테두리 사진을 살짝 기울이고 아래 손글씨 한 줄, 그 밑에 글', w: 1080, h: 1350,
    build: (ctx) => {
      const deg = -4, frame = { x: 230, y: 90, w: 620, h: 740 }, cx = frame.x + frame.w / 2, cy = frame.y + frame.h / 2;
      return {
        background: '#e9e4dc',
        elements: [
          group('폴라로이드', [
            rect('그림자', rotAround({ x: frame.x + 10, y: frame.y + 14, w: frame.w, h: frame.h }, cx + 10, cy + 14, deg), '#00000026'),
            rect('테두리', rotAround(frame, cx, cy, deg), '#ffffff'),
            photo(ctx, '사진 자리', rotAround({ x: frame.x + 36, y: frame.y + 36, w: frame.w - 72, h: frame.w - 72 }, cx, cy, deg)),
            text('손글씨', rotAround({ x: frame.x + 36, y: frame.y + frame.w - 20, w: frame.w - 72, h: 100 }, cx, cy, deg), { fontSize: 34, color: '#4a4a4a', lineHeight: 1.4 }, doc(P('사진 아래 한 줄', { align: 'center' }))),
          ]),
          text('본문', { x: 110, y: 900, w: 860, h: 370 }, { fontSize: 26, color: '#3d3a35', lineHeight: 1.75 }, doc(P(BODY, { align: 'center' })), { autoShrink: true, minScale: 0.6 }),
        ],
      };
    },
  },
  {
    id: 'silhouette', name: '실루엣 안에 글', desc: '캐릭터 모양(투명 배경 그림) 안을 글로 채움. 글상자 모양 → 이미지 바꾸기로 내 그림을 넣기', w: 1080, h: 1350,
    build: (ctx) => ({
      background: '#fdfbf7',
      elements: [
        text('실루엣 글', { x: 140, y: 90, w: 800, h: 1080 }, { fontFamily: SERIF, fontSize: 22, color: '#2f2a24', lineHeight: 1.45 },
          doc(...Array.from({ length: 6 }, () => P(LONG, { align: 'justify', spacing: 6 }))),
          { area: { kind: 'image', src: ctx.bust(800, 1080), mode: 'alpha', threshold: 128, show: true, opacity: 0.12, fit: 'contain', minWidth: 30 }, padding: 6, autoShrink: true, minScale: 0.5 }),
        text('제목', { x: 140, y: 1200, w: 800, h: 70 }, { fontFamily: SERIF, fontSize: 36, color: '#2f2a24', lineHeight: 1.3 }, doc(P('제목', { align: 'center' }))),
      ],
    }),
  },
];

// 목록: 글 위주 틀 + 사진이 들어가는 틀
export const ALL_TEMPLATES = [...GLOG_TEMPLATES, ...PHOTO_TEMPLATES];

// 틀 → 새 장(요소 id는 모두 새로). ctx: { photo(w, h), bust(w, h) } — 사진 자리·실루엣 그림 주소
export function buildGlogPage(tpl, ctx) {
  const { background, elements } = tpl.build(ctx);
  return { ...M.newPage({ w: tpl.w, h: tpl.h, background }), name: tpl.name, elements };
}

// 목록에 보일 간단한 그림(요소 상자를 줄여 그린 것). 글상자는 회색 줄, 사진 자리는 빗금
export function sketchSVG(tpl, W = 150, H = 150) {
  const fake = () => '';
  const { background, elements } = tpl.build({ photo: fake, bust: fake });
  const k = Math.min(W / tpl.w, H / tpl.h), ox = (W - tpl.w * k) / 2, oy = (H - tpl.h * k) / 2;
  const R = (v) => Math.round(v * k * 10) / 10;
  let s = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}"><g transform="translate(${ox.toFixed(1)} ${oy.toFixed(1)})">`;
  s += `<rect width="${R(tpl.w)}" height="${R(tpl.h)}" fill="${background}" stroke="#d0ccc4"/>`;
  let clipN = 0;
  const fillOf = (f) => (typeof f === 'string' ? f : '#00000055');
  const rot = (n, x, y, w, h) => (n.rotation ? ` transform="rotate(${n.rotation} ${x + w / 2} ${y + h / 2})"` : '');
  const box = (n) => ({ x: R(n.x), y: R(n.y), w: Math.max(1, R(n.w)), h: Math.max(1, R(n.h)) });
  const flat = [];
  const collect = (n) => (n.type === 'group' ? n.children.forEach(collect) : flat.push(n));
  elements.forEach(collect);
  // 모양이 있는 글상자(사진을 감싸는 글)는 먼저 그려 사진이 그 위에 보이게. 나머지는 놓인 순서대로
  for (const n of [...flat.filter((n) => n.type === 'text' && n.area), ...flat.filter((n) => !(n.type === 'text' && n.area))]) {
    const { x, y, w, h } = box(n);
    if (n.type === 'shape') s += n.shape === 'ellipse' ? `<ellipse cx="${x + w / 2}" cy="${y + h / 2}" rx="${w / 2}" ry="${h / 2}" fill="${fillOf(n.fill)}"/>` : `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${R(n.radius || 0)}" fill="${fillOf(n.fill)}"${n.strokeWidth ? ` stroke="${n.stroke}" stroke-width="0.6"` : ''}${rot(n, x, y, w, h)}/>`;
    else if (n.type === 'image') s += n.mask ? `<ellipse cx="${x + w / 2}" cy="${y + h / 2}" rx="${w / 2}" ry="${h / 2}" fill="#c9ced8"/>` : `<g${rot(n, x, y, w, h)}><rect x="${x}" y="${y}" width="${w}" height="${h}" fill="#c9ced8"/><path d="M${x} ${y + h}L${x + w} ${y}" stroke="#aab1bd" stroke-width="0.8"/></g>`;
    else if (n.type === 'text') {
      const fs = Math.max(1.2, (n.style?.fontSize || 32) * k), lh = fs * (n.style?.lineHeight || 1.6);
      const c = n.style?.color || '#333';
      const rows = Math.max(1, Math.min(Math.floor(h / lh), 60));
      let clip = '';
      if (n.area?.kind === 'image') { const id = `c${clipN++}`; s += `<clipPath id="${id}"><ellipse cx="${x + w / 2}" cy="${y + h * 0.2}" rx="${w * 0.22}" ry="${h * 0.18}"/><path d="M${x + w * 0.1} ${y + h}C${x + w * 0.1} ${y + h * 0.45} ${x + w * 0.9} ${y + h * 0.45} ${x + w * 0.9} ${y + h}Z"/></clipPath>`; clip = ` clip-path="url(#${id})"`; }
      s += `<g${clip}${rot(n, x, y, w, h)}>`;
      for (let i = 0; i < rows; i++) s += `<rect x="${x}" y="${(y + i * lh + (lh - fs) / 2).toFixed(1)}" width="${(w * (i === rows - 1 && rows > 1 ? 0.6 : 1)).toFixed(1)}" height="${Math.max(0.8, fs * 0.55).toFixed(1)}" fill="${c}" opacity=".55"/>`;
      s += '</g>';
    }
  }
  return s + '</g></svg>';
}
