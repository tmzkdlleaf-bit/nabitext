# 나비텍스트 리서치 노트 — 기존 글 편집·디자인 도구 분석

> 목표: "글을 보기 좋게 편집하고 디자인하는 프로그램"을 만들기 위해, 이미 널리 쓰이는 도구들이
> 무엇을 잘하고 무엇이 부족한지 정리하고, 거기서 나비텍스트의 기능을 도출한다.

## 1. 조사 대상과 핵심 강점

| 분류 | 도구 | 잘하는 것 | 한계 (우리 관점) |
|---|---|---|---|
| 몰입형 글쓰기 | **iA Writer** | 정교한 기본 타이포그래피, 포커스 모드(현재 문장/문단만 선명), 타자기 모드, Style Check | 디자인 선택지가 거의 없음(의도적). 한글 문체 점검 없음 |
| 몰입형 글쓰기 | **Ulysses** | 문서 라이브러리, 목표 글자수 링, 원고 포맷 내보내기 | Apple 전용, 유료 구독 |
| 마크다운 | **Typora** | 입력 즉시 렌더링(분할 화면 없음), 테마 CSS 교체 | 테마를 바꾸려면 CSS를 직접 써야 함 |
| 블록 에디터 | **Notion** (및 Craft, BlockNote 등) | 모든 것이 블록, `/` 슬래시 명령, 선택 시 뜨는 플로팅 툴바, 키보드 중심 조작 | 문서의 "모양"을 바꿀 수 있는 폭이 좁음(폰트 3종 정도) |
| 문장 점검 | **Hemingway Editor** | 긴 문장 노랑/빨강 하이라이트, 부사·수동태 표시, 가독성 등급 | 영어 전용. 편집·디자인 기능 없음 |
| 디자인 | **Canva** | 템플릿, 텍스트 스타일 조합, PNG/JPG/PDF 내보내기 | 긴 글을 쓰는 도구가 아님. 글→카드 변환이 수작업 |
| 국내 블로그 | **네이버 스마트에디터 ONE** | 인용구·구분선 스타일, 템플릿, 모바일 미리보기 | 플랫폼 밖으로 가져가기 어려움 |
| 국내 출판 | **브런치** | 절제된 세리프 조판, 느낌 있는 구분선, 넓은 여백 | 디자인 커스터마이즈 불가 |

## 2. 한글 웹 타이포그래피 기준 (조사 결과)

- **행간**: 본문 150% 이상(모바일 155% 전후 권장), 제목은 120% 이하로 좁게.
- **줄바꿈**: `word-break: keep-all` — 기본값은 한글을 글자 단위로 끊어 어절이 쪼개진다.
  제목에는 `text-wrap: balance`, 본문에는 `text-wrap: pretty`로 외톨이 줄을 줄인다.
- **자간**: 넓으면 가독성이 떨어진다. 본문은 0 ~ -0.01em, 큰 제목은 더 좁게(-0.02em 이하).
- **글줄 길이**: 16px 기준 한 줄 40~60자, 폭 600~700px 전후.
- **문장 길이**: 한국어 글쓰기 교재들은 한 문장 50~60자 안팎을 권장한다.
  → 나비텍스트는 70자 초과를 "주의", 100자 초과를 "경고"로 표시한다.

## 3. 공통 패턴 → 나비텍스트 기능 도출

| 관찰 | 채택한 기능 |
|---|---|
| Notion식 슬래시 명령·플로팅 툴바는 이제 표준 UX | `/` 메뉴(검색 가능), 선택 시 서식 툴바, 마크다운 단축 입력(`# `, `> `, `- `, `1. `, `---`, ```` ``` ````) |
| iA Writer의 포커스·타자기 모드는 몰입에 효과적 | 포커스 모드(현재 문단 외 흐리게 + 커서 줄을 화면 중앙에 유지) |
| Typora/노션은 "모양 바꾸기"가 약함, Canva는 "긴 글"이 약함 | **테마 프리셋 + 세부 조절 슬라이더**(폰트·크기·행간·자간·문단 간격·폭·정렬·강조색·드롭캡·들여쓰기) |
| Hemingway는 영어 전용 | **한국어 문장 점검**: 긴 문장 하이라이트 + 번역투/군더더기 표현(“~에 대해”, “~를 통해”, 이중 피동 등) 탐지. 본문을 건드리지 않는 CSS Custom Highlight API 사용 |
| 복붙한 글은 공백·따옴표·말줄임표가 제각각 | **글 다듬기**: 연속 공백, 문장부호 앞뒤 공백, 곧은 따옴표→둥근 따옴표, `...`→`…`, 반복 문장부호, 괄호 안 공백, 빈 문단 정리 — 적용 전 변경 개수 미리보기 |
| 인스타그램 카드뉴스는 Canva에서 손으로 다시 조판 | **카드뉴스 모드**: 구분선 기준으로 글을 카드로 자동 분할, 글자 크기 자동 맞춤, 1:1 / 4:5 / 9:16 PNG 내보내기 |
| 블로그·메일에 붙여넣으면 서식이 깨짐 | **서식 포함 복사**(인라인 스타일로 변환), HTML·Markdown·TXT 내보내기, PDF 인쇄 |
| 원고 분량을 원고지 매수로 세는 국내 관행 | 글자수(공백 포함/제외), 원고지 매수(200자), 읽는 시간, 반복 단어 |

## 4. 의도적으로 뺀 것

- **서버/계정/동기화**: 설치 없이 파일 하나 열면 되는 도구를 우선했다. 문서는 브라우저 `localStorage`에 저장한다.
- **맞춤법 검사기**: 제대로 하려면 대형 사전·형태소 분석이 필요하다. 대신 규칙 기반 문체 점검에 집중했다.
- **자유 배치 캔버스**: Canva와 경쟁하지 않고, "글의 흐름"을 유지한 채 모양을 입히는 데 집중했다.

## 참고 자료

- [The 10 Best Distraction-Free Writing Apps of 2026 — selfpublishing.com](https://selfpublishing.com/distraction-free-writing-apps/)
- [Best Distraction-Free Writing Apps in 2026 — Writespace](https://usewritespace.com/best-distraction-free-writing-apps-2026/)
- [Using slash commands — Notion Help](https://www.notion.com/help/guides/using-slash-commands)
- [You Should Be Adopting (Copying) Notion’s UI — Dashibase](https://dashibase.com/blog/notion-ui/)
- [Readability and document stats — Hemingway Editor Help](https://hemingwayapp.com/help/docs/readability)
- [Highlighted issues in your writing — Hemingway Editor Help](https://hemingwayapp.com/help/docs/highlighted-issues)
- [읽기 쉬운 웹을 위한 타이포그래피 — parksb](https://parksb.github.io/article/37.html)
- [웹 사이트들의 한글 타이포그래피 — lqez](https://lqez.github.io/blog/hangul-typo-on-web.html)
- [모바일 UI 디자인 기본 요소 — 타이포그래피 2 가독성 (브런치)](https://brunch.co.kr/@chulhochoiucj0/34)
- [어색하게 끊기는 한국어 줄바꿈 다듬는 법 — Dale Seo](https://daleseo.com/css-text-wrap/)
- [Exporting designs — Canva Developers](https://www.canva.dev/docs/apps/exporting-designs/)
