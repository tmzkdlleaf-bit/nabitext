// 자동 저장(비정상 종료 복구용). IndexedDB(브라우저 내장 저장소)에 작업 상태를 둔다.
// 웹판·Electron 모두 같은 코드다(Electron은 앱의 사용자 데이터 폴더 안에 저장된다).
//   recovery[탭 id] = { json(project.json과 같은 내용), savedAt, name, file(열었던 파일 이름) }
//   blobs[에셋 id] = Blob(에셋 원본). 여러 탭이 같은 에셋을 같이 쓴다(에셋 id = 내용 해시).
// 탭(창)마다 자기 자리에 쓴다. 웹판에서 탭을 두 개 열어도 서로 덮어쓰거나 지우지 않는다.
//   살아 있는 탭은 'nabitext-tab-<id>' 잠금(Web Locks)을 쥐고 있다. 시작할 때 잠금이 없는 자리 = 비정상 종료 등으로
//   주인이 사라진 작업 → 복구를 제안한다. 다른 탭이 지금 작업 중인 자리는 건드리지 않는다.
// 실제 프로젝트 파일은 건드리지 않는다. 사용자가 저장하거나 '저장하지 않음'으로 닫으면 자기 자리를 지운다.

import { openDB, req, done } from './idb.js';

const db = () => openDB('nabitext', 1, (d) => { d.createObjectStore('recovery'); d.createObjectStore('blobs'); });
const LOCK = 'nabitext-tab-';
const usedIn = (json) => new Set([...JSON.stringify(json).matchAll(/assets\/([0-9a-f]{32})\./g)].map((m) => m[1]));

// 이 탭의 id. 잠금을 쥔 뒤에야 정해진다(claimTab)
let tabId = null;

// 이 탭의 잠금을 쥔다(탭이 닫힐 때까지 놓지 않음). Web Locks가 없으면 잠금 없이(탭 구분만)
export async function claimTab() {
  if (tabId) return tabId;
  const id = crypto.randomUUID();
  if (navigator.locks?.request) {
    await new Promise((granted) => { navigator.locks.request(LOCK + id, () => { granted(); return new Promise(() => {}); }); });
  }
  tabId = id;
  return id;
}

// json: toJSON() 결과, used: 쓰인 에셋 id, assets: AssetStore
export async function saveRecovery({ json, used, assets, file = null }) {
  const id = await claimTab();
  const d = await db();
  const tx = d.transaction(['recovery', 'blobs'], 'readwrite');
  const blobs = tx.objectStore('blobs');
  // 저장소에 없는 에셋만 쓴다(다른 탭이 지웠을 수 있으므로 매번 확인. 한 트랜잭션 안이라 그사이 지워지지 않음)
  for (const aid of used) {
    const a = assets.get(aid);
    if (!a) continue;
    const r = blobs.getKey(aid);
    r.onsuccess = () => { if (r.result === undefined) blobs.put(a.blob, aid); };
  }
  tx.objectStore('recovery').put({ json, savedAt: Date.now(), name: json.name, file }, id);
  await done(tx);
}

// 주인이 없는(잠금이 풀린) 작업들, 최근 것부터. [{ key, json, savedAt, name, file, readAsset }]
export async function orphanRecoveries() {
  const me = await claimTab();
  const d = await db();
  const store = d.transaction('recovery').objectStore('recovery');
  const [keys, vals] = await Promise.all([req(store.getAllKeys()), req(store.getAll())]);
  let held = new Set();
  if (navigator.locks?.query) { const q = await navigator.locks.query(); held = new Set((q.held || []).map((l) => l.name)); }
  const read = async (path) => {
    const m = /^assets\/([0-9a-f]{32})\./.exec(path || '');
    return m ? (await req(d.transaction('blobs').objectStore('blobs').get(m[1]))) || null : null;
  };
  return keys.map((key, i) => ({ key, ...vals[i], readAsset: read }))
    .filter((r) => r.key !== me && !held.has(LOCK + r.key) && r.json)
    .sort((a, b) => (b.savedAt || 0) - (a.savedAt || 0));
}
// 예전 이름(가장 최근의 주인 없는 작업 하나)
export async function loadRecovery() { return (await orphanRecoveries())[0] || null; }

// 자리 하나 지우기(기본: 이 탭). 다른 자리가 쓰지 않는 에셋 원본도 지운다
export async function clearRecovery(key = null) {
  key ??= await claimTab();
  const d = await db();
  const tx = d.transaction(['recovery', 'blobs'], 'readwrite');
  const rec = tx.objectStore('recovery'), blobs = tx.objectStore('blobs');
  rec.delete(key);
  const all = rec.getAll();
  const ks = blobs.getAllKeys();
  all.onsuccess = () => {
    const keep = new Set();
    for (const r of all.result) for (const aid of usedIn(r.json)) keep.add(aid);
    ks.onsuccess = () => { for (const aid of ks.result) if (!keep.has(aid)) blobs.delete(aid); };
    if (ks.readyState === 'done') ks.onsuccess();
  };
  await done(tx);
}
