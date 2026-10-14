// 데모용 입력: 테스트 이미지(런타임 생성)와 문서 JSON

export async function makeImages() {
  // 1) 투명 배경 PNG: 7각 별 + 가운데 구멍
  const a = new OffscreenCanvas(800, 800);
  let c = a.getContext('2d');
  c.fillStyle = '#6b4fa3';
  c.strokeStyle = '#6b4fa3';
  c.lineWidth = 60;
  c.lineJoin = 'round';
  c.beginPath();
  for (let i = 0; i < 14; i++) {
    const r = i % 2 ? 200 : 350;
    const t = (Math.PI * i) / 7 - Math.PI / 2;
    c[i ? 'lineTo' : 'moveTo'](400 + r * Math.cos(t), 400 + r * Math.sin(t));
  }
  c.closePath();
  c.fill();
  c.stroke();
  c.globalCompositeOperation = 'destination-out';
  c.beginPath();
  c.arc(400, 400, 105, 0, Math.PI * 2);
  c.fill();
  const alpha = await toImage(a, 'image/png');

  // 2) 흰 배경 JPG: 초승달 + 떨어진 원 (JPG 압축 잡음 포함)
  const b = new OffscreenCanvas(800, 800);
  c = b.getContext('2d');
  c.fillStyle = '#fff';
  c.fillRect(0, 0, 800, 800);
  c.fillStyle = '#2b3a4a';
  c.beginPath(); c.arc(380, 400, 340, 0, Math.PI * 2); c.fill();
  c.fillStyle = '#fff';
  c.beginPath(); c.arc(520, 330, 290, 0, Math.PI * 2); c.fill();
  c.fillStyle = '#2b3a4a';
  c.beginPath(); c.arc(610, 560, 110, 0, Math.PI * 2); c.fill();
  const jpg = await toImage(b, 'image/jpeg', 0.7);

  // 3) 문단 사이 삽입용 이미지
  const d = new OffscreenCanvas(240, 120);
  c = d.getContext('2d');
  const g = c.createLinearGradient(0, 0, 240, 120);
  g.addColorStop(0, '#f2a65a');
  g.addColorStop(1, '#c05a8b');
  c.fillStyle = g;
  c.fillRect(0, 0, 240, 120);
  c.fillStyle = 'rgba(255,255,255,.85)';
  c.font = '600 20px sans-serif';
  c.textAlign = 'center';
  c.fillText('BLOCK IMAGE', 120, 68);
  const block = await toImage(d, 'image/png');

  return { alpha, jpg, block };
}

async function toImage(canvas, type, q) {
  const blob = await canvas.convertToBlob({ type, quality: q });
  const img = new Image();
  img.src = URL.createObjectURL(blob);
  await img.decode();
  return img;
}

export function donutPath(w, h, R, r) {
  const cx = w / 2, cy = h / 2;
  const circ = (rad) => `M${cx - rad},${cy} a${rad},${rad} 0 1,0 ${2 * rad},0 a${rad},${rad} 0 1,0 ${-2 * rad},0 Z`;
  return circ(R) + ' ' + circ(r);
}

const t = (text, ...marks) => ({ type: 'text', text, ...(marks.length ? { marks } : {}) });
const m = (type, attrs) => (attrs ? { type, attrs } : { type });
const p = (attrs, ...content) => ({ type: 'paragraph', attrs, content });

export function sampleDoc(blockSrc, imgWidth = 120) {
  return {
    type: 'doc',
    content: [
      p({ indent: 16, align: 'justify' },
        t('이 문단은 레이아웃 엔진의 줄 배치를 확인하기 위한 예시 텍스트입니다. '),
        t('굵게', m('bold')), t(', '),
        t('기울임', m('italic')), t(', '),
        t('색상', m('color', { value: '#c0392b' })), t(', '),
        t('형광펜', m('highlight', { value: '#fff27a' })), t(', '),
        t('물결 밑줄', m('underline', { style: 'wavy', color: '#2d7ff9' })), t(', '),
        t('취소선', m('strike')),
        t('처럼 서로 다른 꾸밈이 한 줄에 섞여도 기준선이 맞아야 합니다.')),
      p({ align: 'justify' },
        t('크기가 다른 '), t('큰 글씨', m('size', { value: 30 }), m('bold')), t('와 '),
        t('작은 글씨', m('size', { value: 11 })),
        t('가 같은 줄에 들어가면 그 줄의 높이는 가장 큰 글자에 맞춰 다시 계산되고, 엔진은 높아진 띠로 구간을 다시 질의합니다.')),
      p({ align: 'left' },
        t('금칙 처리: “따옴표”, (괄호), 「낫표」, 마침표와 쉼표는 줄 머리에 오지 않습니다. 긴 단어 '),
        t('Pneumonoultramicroscopicsilicovolcanoconiosis', m('font', { value: 'Georgia, "Noto Serif CJK KR", serif' })),
        t('나 주소 https://example.com/a/very/long/path 처럼 구간보다 긴 단어는 글자 단위로 쪼갭니다.')),
      { type: 'image', attrs: { src: blockSrc, width: imgWidth, radius: 8 } },
      p({ align: 'center' },
        t('문단 사이 이미지 아래로 글이 이어집니다.'),
        { type: 'hard_break' },
        t('강제 줄바꿈 뒤 줄입니다. '),
        t('외곽선', m('stroke', { width: 3, color: '#222' }), m('color', { value: '#ffd84d' }), m('bold')), t(' '),
        t('그림자', m('shadow', { value: '2px 2px 0 #9ad' })), t(' '),
        t('그라디언트', m('gradient', { value: 'linear-gradient(90deg,#e1306c,#833ab4)' }), m('bold')), t(' '),
        t('자간 넓게', m('spacing', { value: 4 })), t(' '),
        t('윗줄', m('overline'))),
      p({ align: 'justify' },
        t('영역이 끝날 때까지 채우는 추가 텍스트입니다. 넘치는 부분은 잘리고 넘침 위치가 보고됩니다. '.repeat(10))),
    ],
  };
}
