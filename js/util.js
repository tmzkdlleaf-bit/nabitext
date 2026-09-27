/* 공용 도우미 */
NT.$ = (sel, root = document) => root.querySelector(sel);
NT.$$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

NT.debounce = (fn, ms) => {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
};

NT.uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

NT.escapeHtml = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

let toastTimer;
NT.toast = (msg, ms = 2200) => {
  const el = NT.$('#toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), ms);
};

NT.download = (filename, content, type) => {
  if (NT.embedded && typeof content === 'string') return NT.ui.showText(filename, content);
  const blob = content instanceof Blob ? content : new Blob([content], { type: type || 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};

NT.safeFilename = s => (s || '나비텍스트').replace(/[\\/:*?"<>|]+/g, ' ').trim().slice(0, 80) || '나비텍스트';

/* ─ 캐럿 위치를 "본문 전체에서 몇 번째 글자인지"로 저장/복원 ─ */
NT.textNodes = root => {
  const out = [];
  const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let n; while ((n = w.nextNode())) out.push(n);
  return out;
};

NT.getCaretOffset = root => {
  const sel = window.getSelection();
  if (!sel.rangeCount || !root.contains(sel.anchorNode)) return null;
  const r = sel.getRangeAt(0);
  const pre = document.createRange();
  pre.selectNodeContents(root);
  pre.setEnd(r.startContainer, r.startOffset);
  return pre.toString().length;
};

NT.setCaretOffset = (root, offset) => {
  if (offset == null) return;
  let remain = offset;
  for (const n of NT.textNodes(root)) {
    if (remain <= n.length) { NT.placeCaret(n, remain); return; }
    remain -= n.length;
  }
  // 글자가 없는 블록(빈 제목, 빈 목록 등): 가장 안쪽 첫 요소의 맨 앞에 둔다
  let el = root;
  while (el.firstElementChild && el.firstElementChild.tagName !== 'BR') el = el.firstElementChild;
  NT.placeCaret(el, 0);
};

/* 블록 경계에서 모호하지 않도록 (몇 번째 블록, 블록 안 몇 번째 글자)로 저장한다 */
NT.getCaretPos = root => {
  const sel = window.getSelection();
  if (!sel.rangeCount || !root.contains(sel.anchorNode) || sel.anchorNode === root) return null;
  let block = sel.getRangeAt(0).startContainer;
  while (block.parentNode !== root) block = block.parentNode;
  return { i: Array.prototype.indexOf.call(root.childNodes, block), o: NT.getCaretOffset(block) || 0 };
};

NT.setCaretPos = (root, pos) => {
  if (!pos) return;
  const block = root.childNodes[Math.min(pos.i, root.childNodes.length - 1)];
  if (!block) return;
  if (block.nodeType === 3) NT.placeCaret(block, Math.min(pos.o, block.length));
  else NT.setCaretOffset(block, pos.o);
};

NT.placeCaret = (node, offset) => {
  const r = document.createRange();
  r.setStart(node, offset); r.collapse(true);
  const sel = window.getSelection();
  sel.removeAllRanges(); sel.addRange(r);
};

/* 블록 안 텍스트를 이어 붙이고, 글자 위치 → (텍스트 노드, 오프셋)으로 되돌릴 수 있는 지도 */
NT.textMap = block => {
  const nodes = []; let text = '';
  for (const n of NT.textNodes(block)) { nodes.push({ node: n, start: text.length }); text += n.data; }
  return { text, nodes };
};

NT.rangeFromMap = (map, start, end) => {
  const locate = (pos, isEnd) => {
    for (let i = 0; i < map.nodes.length; i++) {
      const { node, start: s } = map.nodes[i];
      const e = s + node.length;
      if (pos < e || (isEnd && pos === e) || i === map.nodes.length - 1) return [node, Math.max(0, Math.min(node.length, pos - s))];
    }
    return null;
  };
  const a = locate(start, false), b = locate(end, true);
  if (!a || !b) return null;
  const r = document.createRange();
  r.setStart(a[0], a[1]); r.setEnd(b[0], b[1]);
  return r;
};
