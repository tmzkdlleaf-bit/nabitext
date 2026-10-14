// IndexedDB(브라우저 내장 저장소) 얇은 도우미. 자동 저장 복구(recovery.js)와 템플릿 보관함(templates.js)이 쓴다.

const dbs = new Map();
// 이름별로 한 번만 연다. upgrade(db): 처음 만들거나 버전이 오를 때 저장소를 만든다
export function openDB(name, version, upgrade) {
  if (!dbs.has(name)) dbs.set(name, new Promise((resolve, reject) => {
    const r = indexedDB.open(name, version);
    r.onupgradeneeded = () => upgrade(r.result);
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  }));
  return dbs.get(name);
}
// IDBRequest → Promise
export const req = (r) => new Promise((resolve, reject) => { r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
// 트랜잭션이 끝날 때까지
export const done = (tx) => new Promise((resolve, reject) => { tx.oncomplete = () => resolve(); tx.onerror = tx.onabort = () => reject(tx.error); });
