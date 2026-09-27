/* 문서 저장소 — 브라우저 localStorage. 막혀 있으면(사생활 보호 창 등) 메모리에만 둔다. */
NT.store = (() => {
  const PREFIX = 'nabitext.';
  const mem = {};
  let persistent = true;

  const get = key => {
    try { const v = localStorage.getItem(PREFIX + key); return v == null ? null : JSON.parse(v); }
    catch { persistent = false; return mem[key] ?? null; }
  };
  const set = (key, val) => {
    mem[key] = val;
    try { localStorage.setItem(PREFIX + key, JSON.stringify(val)); return true; }
    catch (e) {
      persistent = false;
      if (e && e.name === 'QuotaExceededError') NT.toast('저장 공간이 가득 찼어요. 큰 이미지를 줄이거나 오래된 문서를 지워 주세요.', 4000);
      return false;
    }
  };
  const remove = key => { delete mem[key]; try { localStorage.removeItem(PREFIX + key); } catch { /* 무시 */ } };

  return {
    get isPersistent() { return persistent; },
    list: () => (get('index') || []).sort((a, b) => b.updatedAt - a.updatedAt),
    load: id => get('doc.' + id),
    save(doc) {
      doc.updatedAt = Date.now();
      const ok = set('doc.' + doc.id, doc);
      const index = (get('index') || []).filter(d => d.id !== doc.id);
      index.push({ id: doc.id, title: doc.title, updatedAt: doc.updatedAt });
      set('index', index);
      set('current', doc.id);
      return ok;
    },
    remove(id) {
      remove('doc.' + id);
      set('index', (get('index') || []).filter(d => d.id !== id));
    },
    currentId: () => get('current'),
    prefs: () => get('prefs') || {},
    setPrefs: p => set('prefs', { ...(get('prefs') || {}), ...p })
  };
})();
