/* 글꼴 목록과 테마 프리셋 */
NT.FONTS = [
  { id: 'pretendard', name: '프리텐다드', stack: '"Pretendard Variable", Pretendard, -apple-system, "Apple SD Gothic Neo", "Malgun Gothic", sans-serif' },
  { id: 'plex', name: 'IBM Plex Sans KR', stack: '"IBM Plex Sans KR", "Pretendard Variable", sans-serif' },
  { id: 'gowun-dodum', name: '고운돋움', stack: '"Gowun Dodum", "Pretendard Variable", sans-serif' },
  { id: 'noto-serif', name: '본명조 (Noto Serif KR)', stack: '"Noto Serif KR", "Nanum Myeongjo", serif' },
  { id: 'nanum-myeongjo', name: '나눔명조', stack: '"Nanum Myeongjo", "Noto Serif KR", serif' },
  { id: 'gowun-batang', name: '고운바탕', stack: '"Gowun Batang", "Noto Serif KR", serif' },
  { id: 'song-myung', name: '송명', stack: '"Song Myung", "Noto Serif KR", serif' },
  { id: 'hahmlet', name: '함렛', stack: '"Hahmlet", "Noto Serif KR", serif' },
  { id: 'diphylleia', name: '디필레이아', stack: '"Diphylleia", "Noto Serif KR", serif' },
  { id: 'gasoek', name: '가석', stack: '"Gasoek One", "Black Han Sans", sans-serif' },
  { id: 'bagel', name: '베이글', stack: '"Bagel Fat One", "Black Han Sans", sans-serif' },
  { id: 'black-han', name: '검은고딕', stack: '"Black Han Sans", "Pretendard Variable", sans-serif' },
  { id: 'do-hyeon', name: '도현', stack: '"Do Hyeon", "Pretendard Variable", sans-serif' },
  { id: 'pen', name: '나눔손글씨 펜', stack: '"Nanum Pen Script", cursive' },
  { id: 'mono', name: '고정폭', stack: 'ui-monospace, "SF Mono", Menlo, Consolas, "D2Coding", monospace' }
];

NT.ACCENTS = ['#3b5bdb', '#0c8599', '#2b8a3e', '#e8590c', '#e03131', '#c2255c', '#7048e8', '#1f2328', '#a0703c'];

const baseColors = { bg: '#ffffff', fg: '#1f2328', muted: '#6b7280', rule: '#e5e7eb', quoteBg: '#f5f6f8', codeBg: '#f3f4f6', mark: '#fff3a3' };

NT.THEMES = [
  { id: 'clean', name: '클린', desc: '담백한 기본형',
    colors: baseColors,
    design: { fontBody: 'pretendard', fontHead: 'pretendard', fs: 17, lh: 1.8, ls: -0.01, pg: 1.1, w: 680, align: 'left', accent: '#3b5bdb', indent: false, dropcap: false, keepall: true, balance: true } },
  { id: 'essay', name: '에세이', desc: '명조, 넓은 여백',
    colors: { ...baseColors, bg: '#fdfcf9', fg: '#2b2a28', muted: '#77736b', quoteBg: '#f4f1ea' },
    design: { fontBody: 'noto-serif', fontHead: 'noto-serif', fs: 17, lh: 1.95, ls: -0.005, pg: 1.3, w: 600, align: 'justify', accent: '#a0703c', indent: false, dropcap: false, keepall: true, balance: true } },
  { id: 'magazine', name: '매거진', desc: '굵은 제목, 드롭캡',
    colors: { ...baseColors, fg: '#111111' },
    design: { fontBody: 'nanum-myeongjo', fontHead: 'pretendard', fs: 17, lh: 1.8, ls: -0.01, pg: 1.0, w: 700, align: 'justify', accent: '#e03131', indent: false, dropcap: true, keepall: true, balance: true } },
  { id: 'newsletter', name: '뉴스레터', desc: '색 띠 제목, 박스 인용',
    colors: { ...baseColors, bg: '#ffffff', quoteBg: '#eef2ff' },
    design: { fontBody: 'pretendard', fontHead: 'pretendard', fs: 16, lh: 1.75, ls: -0.01, pg: 1.0, w: 640, align: 'left', accent: '#7048e8', indent: false, dropcap: false, keepall: true, balance: true } },
  { id: 'note', name: '노트', desc: '줄 노트, 형광펜',
    colors: { ...baseColors, bg: '#fffef6', rule: '#e3e8f0', mark: '#ffe066' },
    design: { fontBody: 'gowun-dodum', fontHead: 'gowun-dodum', fs: 17, lh: 1.9, ls: 0, pg: 0, w: 660, align: 'left', accent: '#0c8599', indent: false, dropcap: false, keepall: true, balance: false } },
  { id: 'retro', name: '레트로', desc: '타자기 원고',
    colors: { ...baseColors, bg: '#f4ecd8', fg: '#3a2f23', muted: '#7a6a55', rule: '#d9ccb0', quoteBg: '#ebe0c6', codeBg: '#ebe0c6', mark: '#f7d794' },
    design: { fontBody: 'mono', fontHead: 'song-myung', fs: 15.5, lh: 1.85, ls: 0, pg: 1.1, w: 640, align: 'left', accent: '#8a3b12', indent: true, dropcap: false, keepall: true, balance: true } },
  { id: 'letter', name: '편지', desc: '손글씨 느낌',
    colors: { ...baseColors, bg: '#fff8f6', fg: '#3b2f2f', muted: '#8c7a7a', quoteBg: '#fdeceb', mark: '#ffd6d6' },
    design: { fontBody: 'pen', fontHead: 'pen', fs: 17, lh: 1.7, ls: 0, pg: 0.8, w: 580, align: 'left', accent: '#c2255c', indent: false, dropcap: false, keepall: true, balance: true } },
  { id: 'dark', name: '다크', desc: '어두운 배경',
    colors: { bg: '#16181d', fg: '#e6e6e6', muted: '#9aa0a6', rule: '#2c3038', quoteBg: '#20242b', codeBg: '#22262e', mark: '#6b5a00' },
    design: { fontBody: 'pretendard', fontHead: 'pretendard', fs: 17, lh: 1.85, ls: -0.005, pg: 1.1, w: 680, align: 'left', accent: '#74c0fc', indent: false, dropcap: false, keepall: true, balance: true } }
];

NT.themeById = id => NT.THEMES.find(t => t.id === id) || NT.THEMES[0];
NT.fontById = id => NT.FONTS.find(f => f.id === id) || NT.FONTS[0];
