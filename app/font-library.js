// 내 글꼴: 넣은 글꼴 파일을 이 컴퓨터(IndexedDB 'nabitext-fonts')에 보관한다.
//   예전에는 글꼴이 그 프로젝트 안에만 들어가서, 새 프로젝트를 만들거나 앱을 다시 켜면 목록에서 사라졌다.
//   이제는 한 번 넣으면 모든 프로젝트의 글꼴 목록에 계속 나온다. 프로젝트를 저장할 때는 그 프로젝트에서
//   쓴 글꼴만 파일 안에 같이 넣는다(project.js toJSON의 extraFonts) → 다른 컴퓨터에서 열어도 같은 글꼴로 보인다.
//   기록: { key: '이름|굵기|기울임', family, weight, style, label, name(원래 파일 이름), blob, addedAt }

import { openDB, req, done } from './idb.js';

const STORE = 'fonts';
const db = () => openDB('nabitext-fonts', 1, (d) => d.createObjectStore(STORE, { keyPath: 'key' }));
export const fontKey = (f) => `${f.family}|${f.weight}|${f.style}`;

// IndexedDB를 못 쓰는 환경(사생활 보호 창 등)에서 멈추지 않게 시간 제한
const timeout = (p, ms = 4000) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error('글꼴 보관함 응답 없음')), ms))]);

export async function listLibraryFonts() {
  const d = await timeout(db());
  const all = await req(d.transaction(STORE).objectStore(STORE).getAll());
  return all.filter((r) => r && r.family && r.blob).sort((a, b) => (a.addedAt || 0) - (b.addedAt || 0));
}

export async function putLibraryFonts(recs) {
  if (!recs.length) return;
  const d = await timeout(db());
  const tx = d.transaction(STORE, 'readwrite');
  const st = tx.objectStore(STORE);
  for (const r of recs) st.put({ ...r, key: fontKey(r), addedAt: r.addedAt || Date.now() });
  await done(tx);
}

// 이름이 같은 글꼴(굵기·기울임 전부) 지우기
export async function deleteLibraryFamily(family) {
  const d = await timeout(db());
  const tx = d.transaction(STORE, 'readwrite');
  const st = tx.objectStore(STORE);
  const all = st.getAll();
  all.onsuccess = () => { for (const r of all.result) if (r.family === family) st.delete(r.key); };
  await done(tx);
}
