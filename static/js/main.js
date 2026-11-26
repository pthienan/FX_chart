'use strict';
// UI wiring, keyboard shortcuts, plugin loading and startup.

document.querySelectorAll('#tfs button').forEach((b) => b.addEventListener('click', () => changeTF(b.dataset.tf)));
document.querySelectorAll('[data-tool]').forEach((b) => b.addEventListener('click', () => Draw.setTool(b.dataset.tool)));
$('btn-indicators').addEventListener('click', () => Ind.openPicker());
$('btn-magnet').addEventListener('click', (e) => e.currentTarget.classList.toggle('active', Draw.toggleMagnet()));
$('btn-keep-tool').addEventListener('click', (e) => e.currentTarget.classList.toggle('active', Draw.toggleKeep()));
$('undo-draw').addEventListener('click', () => Draw.undo());
$('clear-draw').addEventListener('click', () => { if (S.drawings.length && confirm('Xóa tất cả hình vẽ?')) Draw.clear(); });
$('btn-goto').addEventListener('click', gotoDate);
$('btn-back').addEventListener('click', stepBack);
$('btn-next').addEventListener('click', stepForward);
$('btn-play').addEventListener('click', togglePlay);
$('btn-exit-replay').addEventListener('click', exitReplay);
$('speed').addEventListener('change', () => { if (S.timer) { stopPlay(); togglePlay(); } });
$('btn-update').addEventListener('click', updateData);
$('btn-buy').addEventListener('click', () => placeOrder('buy'));
$('btn-sell').addEventListener('click', () => placeOrder('sell'));
$('btn-export').addEventListener('click', exportCsv);
$('btn-reset').addEventListener('click', resetSession);
$('symbol').addEventListener('change', (e) => { save(); openSymbol(e.target.value); });
$('tz').addEventListener('change', async (e) => {
  const cursor = S.replay ? cursorUtc() : null;
  S.tz = +e.target.value;
  localStorage.setItem('fxlab_tz', S.tz);
  await loadData(S.tf, cursor);
});
for (const id of [...Object.values(SETTING_INPUTS), 's-otype']) {
  $(id).addEventListener('change', () => {
    readSettings();
    $('oprice-row').classList.toggle('hidden', S.settings.otype === 'market');
    if (S.settings.otype !== 'market' && !$('oprice').value && S.end) $('oprice').value = fmtPrice(curBar().close);
    S.statSig = '';
    updateUI(); save(); Draw.dirty();
  });
}
$('oprice').addEventListener('input', updateLotPreview);
$('positions').addEventListener('change', (e) => {
  const el = e.target;
  if (el.dataset.f) editLevel(+el.dataset.id, el.dataset.f, el.value);
});
$('positions').addEventListener('click', (e) => {
  const el = e.target.closest('button');
  if (!el) return;
  if (el.dataset.act === 'close') closeManual(+el.dataset.id);
  else if (el.dataset.act === 'be') moveBE(+el.dataset.id);
});
document.addEventListener('click', (e) => { if (e.target.tagName === 'BUTTON') e.target.blur(); });

document.addEventListener('keydown', (e) => {
  const typing = e.target.tagName === 'TEXTAREA' || (e.target.tagName === 'INPUT' && !['color', 'checkbox', 'button'].includes(e.target.type));
  if (typing || (e.target.tagName === 'SELECT' && e.key !== 'Delete' && e.key !== 'Escape')) return;
  if (!$('modal').classList.contains('hidden')) { if (e.key === 'Escape') closeModal(); return; }
  if (e.key === 'ArrowRight') { e.preventDefault(); stepForward(); }
  else if (e.key === 'ArrowLeft') { e.preventDefault(); stepBack(); }
  else if (e.key === ' ') { e.preventDefault(); togglePlay(); }
  else if (e.key === 'Escape') Draw.escape();
  else if (e.key === 'Delete' || e.key === 'Backspace') { if (Draw.removeSelected()) e.preventDefault(); }
  else if (e.shiftKey && e.key.toUpperCase() === 'B') placeOrder('buy');
  else if (e.shiftKey && e.key.toUpperCase() === 'S') placeOrder('sell');
  else if (e.ctrlKey && e.key.toLowerCase() === 'z') { e.preventDefault(); Draw.undo(); }
});
window.addEventListener('beforeunload', save);

function loadScript(src) {
  return new Promise((resolve) => {
    const el = document.createElement('script');
    el.src = src;
    el.onload = () => resolve(true);
    el.onerror = () => resolve(false);
    document.head.appendChild(el);
  });
}

async function loadIndicatorPlugins() {
  let files = [];
  try { files = await (await fetch('/api/indicators')).json(); } catch (e) { files = []; }
  const failed = [];
  let current = null;
  const onErr = (ev) => { if (current && ev.filename && ev.filename.includes(current)) failed.push(`${current}: ${ev.message}`); };
  window.addEventListener('error', onErr);
  for (const f of files) {
    current = f;
    if (!(await loadScript(`/static/indicators/${f}?v=${Date.now()}`))) failed.push(`${f}: không tải được`);
  }
  window.removeEventListener('error', onErr);
  if (failed.length) setStatus('Lỗi indicator: ' + failed.join(' | '), true);
}

(async function init() {
  S.tz = +(localStorage.getItem('fxlab_tz') ?? 7);
  $('tz').value = String(S.tz);
  await loadIndicatorPlugins();
  Ind.init();
  let syms = ['EURUSD'];
  try { syms = await (await fetch('/api/symbols')).json(); } catch (e) { setStatus('Không kết nối được server.', true); }
  $('symbol').innerHTML = syms.map((s) => `<option>${s}</option>`).join('');
  const sym = localStorage.getItem('fxlab_symbol');
  const start = syms.includes(sym) ? sym : syms[0];
  $('symbol').value = start;
  await openSymbol(start);
})();
