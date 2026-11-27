'use strict';
// Shared state, main chart, data loading, replay engine.

const TF_SEC = { M5: 300, M15: 900, M30: 1800, H1: 3600, H4: 14400, D1: 86400, W1: 604800 };
const DEFAULT_SETTINGS = { balance: 10000, risk: 1, sl: 20, tp: 40, spread: 1, otype: 'market' };
const INITIAL_BARS = 150;
// Set by build_static.py: data comes from pre-built JSON files instead of the Flask API.
const STATIC_SITE = !!window.FX_STATIC;
const $ = (id) => document.getElementById(id);

const S = {
  symbol: 'EURUSD', tf: 'H1', pip: 0.0001, digits: 5, quoteUsd: true, contract: 100000,
  t: [], bars: [], end: 0,
  replay: false, timer: null, tz: 7,
  tool: null,
  drawings: [], drawSeq: 1,
  trades: [], nextId: 1,
  settings: { ...DEFAULT_SETTINGS },
  posSig: '', statSig: '',
};

// ---------------------------------------------------------------- charts
const THEME = { bg: '#131722', text: '#d1d4dc', grid: '#1e222d', border: '#2a2e39' };
function chartOptions(extra = {}) {
  return {
    autoSize: true,
    layout: { background: { color: THEME.bg }, textColor: THEME.text, fontSize: 12 },
    grid: { vertLines: { color: THEME.grid }, horzLines: { color: THEME.grid } },
    crosshair: { mode: LightweightCharts.CrosshairMode.Normal },
    rightPriceScale: { borderColor: THEME.border, minimumWidth: 80 },
    ...extra,
  };
}
// Transparent so the indicator underlay canvas (#ind-underlay) shows through beneath the candles.
const chart = LightweightCharts.createChart($('chart'), chartOptions({
  layout: { background: { color: 'transparent' }, textColor: THEME.text, fontSize: 12 },
  timeScale: { borderColor: THEME.border, timeVisible: true, secondsVisible: false, rightOffset: 8 },
}));
const candle = chart.addCandlestickSeries({
  upColor: '#26a69a', downColor: '#ef5350', borderVisible: false,
  wickUpColor: '#26a69a', wickDownColor: '#ef5350',
});

// ---------------------------------------------------------------- helpers
const round = (x) => +x.toFixed(S.digits);
const fmtPrice = (x) => (x == null ? '—' : x.toFixed(S.digits));
const sign = (x, d = 1) => (x >= 0 ? '+' : '') + x.toFixed(d);
const money = (x) => (x < 0 ? '-$' : '$') + Math.abs(x).toFixed(2);
const isActive = (p) => p.status === 'open' || p.status === 'pending';
function hexA(color, a) {
  if (!color || color[0] !== '#') return color;
  let h = color.slice(1);
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  const n = parseInt(h.slice(0, 6), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function fmt(utc) {
  if (utc == null) return '—';
  return new Date((utc + S.tz * 3600) * 1000).toISOString().slice(0, 16).replace('T', ' ');
}
function durText(sec) {
  sec = Math.abs(Math.trunc(sec));
  const d = Math.floor(sec / 86400), h = Math.floor((sec % 86400) / 3600), m = Math.floor((sec % 3600) / 60);
  return (d ? d + 'd ' : '') + (h ? h + 'h ' : '') + (m || (!d && !h) ? m + 'm' : '');
}
function upperBound(a, x) {
  let lo = 0, hi = a.length;
  while (lo < hi) { const m = (lo + hi) >> 1; if (a[m] <= x) lo = m + 1; else hi = m; }
  return lo;
}
const barIndexOf = (utc) => upperBound(S.t, utc) - 1;
const countClosed = (cursor) => upperBound(S.t, cursor - TF_SEC[S.tf]);
const cursorUtc = () => (S.end > 0 ? S.t[S.end - 1] + TF_SEC[S.tf] : 0);
const curBar = () => S.bars[S.end - 1];
const spreadPx = () => S.settings.spread * S.pip;
const pipValue = (price) => (S.quoteUsd ? S.contract * S.pip : (S.contract * S.pip) / price);

// Fractional bar index <-> UTC seconds; extrapolates past both ends so drawings can live in empty space.
function timeToLogical(utc) {
  const n = S.t.length, d = TF_SEC[S.tf];
  if (!n) return 0;
  if (utc <= S.t[0]) return (utc - S.t[0]) / d;
  if (utc >= S.t[n - 1]) return n - 1 + (utc - S.t[n - 1]) / d;
  const i = upperBound(S.t, utc) - 1;
  return i + Math.min(1, (utc - S.t[i]) / d);
}
function logicalToTime(l) {
  const n = S.t.length, d = TF_SEC[S.tf];
  if (!n) return 0;
  if (l <= 0) return Math.round(S.t[0] + l * d);
  if (l >= n - 1) return Math.round(S.t[n - 1] + (l - (n - 1)) * d);
  const i = Math.floor(l);
  return Math.round(S.t[i] + (l - i) * Math.min(d, S.t[i + 1] - S.t[i]));
}

function setStatus(msg, err = false) {
  const el = $('status-msg');
  el.textContent = msg;
  el.className = err ? 'err' : '';
}

// ---------------------------------------------------------------- rendering
function candleBar(i) {
  const b = S.bars[i], c = Ind.barColor(i);
  return c ? { ...b, color: c, wickColor: c, borderColor: c } : b;
}
function refreshCandles() {
  const data = new Array(S.end);
  for (let i = 0; i < S.end; i++) data[i] = candleBar(i);
  candle.setData(data);
}

function render(fit) {
  refreshCandles();
  Ind.renderAll();
  refreshTradeVisuals();
  if (fit) chart.timeScale().setVisibleLogicalRange({ from: S.end - INITIAL_BARS, to: S.end + 8 });
  Draw.dirty();
  updateUI();
}

function applyDigits() {
  candle.applyOptions({ priceFormat: { type: 'price', precision: S.digits, minMove: 10 ** -S.digits } });
  $('oprice').step = String(10 ** -S.digits);
}

function showLegend(i) {
  const b = S.bars[i];
  if (!b) { $('legend-main').innerHTML = ''; return; }
  const d = S.digits, chg = (b.close - b.open) / S.pip;
  const cls = chg >= 0 ? 'pos' : 'neg';
  $('legend-main').innerHTML =
    `<b>${S.symbol} · ${S.tf}</b><span class="muted">${esc(S.source || '')}</span><span class="muted">${fmt(S.t[i])}</span>` +
    `<span>O <i class="${cls}">${b.open.toFixed(d)}</i></span><span>H <i class="${cls}">${b.high.toFixed(d)}</i></span>` +
    `<span>L <i class="${cls}">${b.low.toFixed(d)}</i></span><span>C <i class="${cls}">${b.close.toFixed(d)}</i></span>` +
    `<span class="${cls}">${sign(chg)}p</span>`;
  Ind.legend(i);
}
chart.subscribeCrosshairMove((param) => {
  let i = param.logical != null ? Math.round(param.logical) : S.end - 1;
  if (i < 0 || i >= S.end) i = S.end - 1;
  showLegend(i);
  Ind.syncCrosshair(param.time != null ? i : null);
});

// ---------------------------------------------------------------- data loading
async function loadData(tf, cursor) {
  setStatus(`Đang tải ${S.symbol} ${tf}...`);
  let j;
  try {
    const r = STATIC_SITE
      ? await fetch(`/api/candles/${S.symbol}_${tf}.json`, { cache: 'no-cache' })
      : await fetch(`/api/candles?symbol=${S.symbol}&tf=${tf}`);
    if (STATIC_SITE && !r.ok) throw new Error(`chưa có dữ liệu ${S.symbol} ${tf} trên web`);
    j = await r.json();
    if (!r.ok) throw new Error(j.error || r.status);
  } catch (e) {
    setStatus(`Lỗi tải dữ liệu: ${e.message}`, true);
    return false;
  }
  if (!j.data.length) { setStatus(`Không có dữ liệu ${S.symbol} ${tf}`, true); return false; }
  const replayAt = S.replay && cursor != null;
  if (replayAt && j.data[0][0] + TF_SEC[tf] > cursor) {
    setStatus(`Khung ${tf} chỉ có dữ liệu từ ${fmt(j.data[0][0])}, không có tại thời điểm replay ${fmt(cursor)}.`, true);
    return false;
  }
  S.tf = tf; S.pip = j.pip; S.digits = j.digits; S.quoteUsd = j.quote_usd; S.contract = j.contract || 100000;
  S.source = j.source || 'Yahoo Finance';
  const off = S.tz * 3600;
  S.t = j.data.map((d) => d[0]);
  S.bars = j.data.map((d) => ({ time: d[0] + off, open: d[1], high: d[2], low: d[3], close: d[4] }));
  applyDigits();
  Ind.computeAll();
  S.end = replayAt ? Math.max(1, countClosed(cursor)) : S.bars.length;
  if (window.renderTfs) renderTfs();
  render(true);
  setStatus(`${S.symbol} ${tf}: ${S.bars.length} nến, ${fmt(S.t[0])} → ${fmt(S.t[S.t.length - 1])} · nguồn: ${S.source}`);
  return true;
}

async function changeTF(tf) {
  if (tf === S.tf) return;
  stopPlay();
  if (await loadData(tf, S.replay ? cursorUtc() : null)) save();
}

function migrateDrawings(list) {
  return (list || []).map((d) => {
    if (d.pts) return d;
    if (d.type === 'h') return { type: 'hline', pts: [{ t: 0, p: d.price }] };
    return { type: 'trend', extend: d.type === 'ray', pts: [{ t: d.t1, p: d.p1 }, { t: d.t2, p: d.p2 }] };
  });
}

async function openSymbol(sym) {
  stopPlay();
  S.symbol = sym;
  localStorage.setItem('fxlab_symbol', sym);
  const st = JSON.parse(localStorage.getItem('fxlab_' + sym) || '{}');
  S.trades = st.trades || [];
  S.nextId = st.nextId || 1;
  S.settings = { ...DEFAULT_SETTINGS, ...(st.settings || {}) };
  S.drawings = migrateDrawings(st.drawings);
  S.drawSeq = 1;
  for (const d of S.drawings) { if (!d.id) d.id = S.drawSeq; S.drawSeq = Math.max(S.drawSeq, d.id + 1); }
  S.replay = !!st.replay && st.cursor != null;
  S.posSig = ''; S.statSig = '';
  Draw.reset();
  writeSettingsUI();
  if (!(await loadData(st.tf || 'H1', S.replay ? st.cursor : null)) && S.replay) {
    S.replay = false;
    await loadData('H1', null);
  }
}

async function updateData() {
  stopPlay();
  const btn = $('btn-update');
  btn.disabled = true;
  if (STATIC_SITE) {
    try {
      const m = await (await fetch('/api/meta.json', { cache: 'no-cache' })).json();
      if (await loadData(S.tf, S.replay ? cursorUtc() : null)) {
        setStatus(`Đã tải lại. Dữ liệu trên web tự cập nhật mỗi giờ, lần cuối lúc ${fmt(m.updated)}.`);
      }
    } catch (e) {
      setStatus(`Lỗi tải lại dữ liệu: ${e.message}`, true);
    } finally {
      btn.disabled = false;
    }
    return;
  }
  setStatus(`Đang tải dữ liệu mới từ ${S.source || 'nguồn dữ liệu'}...`);
  try {
    const r = await fetch(`/api/update?symbol=${S.symbol}`, { method: 'POST' });
    const j = await r.json();
    if (!r.ok) throw new Error(j.error || r.status);
    await loadData(S.tf, S.replay ? cursorUtc() : null);
    setStatus('Đã cập nhật: ' + Object.entries(j.counts).map(([k, v]) => `${k} ${v}`).join(' · '));
  } catch (e) {
    setStatus(`Lỗi cập nhật: ${e.message}`, true);
  } finally {
    btn.disabled = false;
  }
}

// ---------------------------------------------------------------- persistence
let saveTimer = null;
function save() {
  clearTimeout(saveTimer); saveTimer = null;
  localStorage.setItem('fxlab_' + S.symbol, JSON.stringify({
    trades: S.trades, nextId: S.nextId, settings: S.settings, drawings: S.drawings,
    replay: S.replay, cursor: S.replay ? cursorUtc() : null, tf: S.tf,
  }));
  if (window.Account) Account.touch();
}
function saveSoon() {
  if (!saveTimer) saveTimer = setTimeout(save, 800);
}

// ---------------------------------------------------------------- replay
function cancelActiveTrades(msg) {
  const act = S.trades.filter(isActive);
  if (!act.length) return true;
  if (!confirm(msg.replace('{n}', act.length))) return false;
  S.trades = S.trades.filter((p) => !isActive(p));
  return true;
}

function startReplayAt(i) {
  if (!cancelActiveTrades('Có {n} lệnh đang mở/chờ. Hủy các lệnh này để replay từ điểm mới?')) return;
  stopPlay();
  S.replay = true;
  S.end = Math.max(1, Math.min(i + 1, S.bars.length));
  render(true);
  save();
  setStatus(`Replay từ ${fmt(S.t[S.end - 1])}. Nhấn → hoặc ▶ để chạy từng nến.`);
}

function exitReplay() {
  if (!S.replay) return;
  if (!cancelActiveTrades('Có {n} lệnh đang mở/chờ. Thoát replay sẽ hủy các lệnh này. Tiếp tục?')) return;
  stopPlay();
  S.replay = false;
  S.end = S.bars.length;
  render(true);
  save();
  setStatus('Đã thoát replay.');
}

function gotoDate() {
  const v = $('goto').value;
  if (!v) { setStatus('Chọn ngày giờ trước khi bấm Đi.', true); return; }
  const [d, tm] = v.split('T');
  const [Y, M, D] = d.split('-').map(Number);
  const [h, mi] = (tm || '00:00').split(':').map(Number);
  const utc = Date.UTC(Y, M - 1, D, h, mi) / 1000 - S.tz * 3600;
  const n = countClosed(utc);
  if (n < 1) { setStatus(`Dữ liệu ${S.tf} bắt đầu từ ${fmt(S.t[0])}.`, true); return; }
  startReplayAt(n - 1);
}

function stepForward() {
  if (!S.replay) return;
  if (S.end >= S.bars.length) { stopPlay(); setStatus('Đã hết dữ liệu.'); return; }
  const i = S.end++;
  Ind.step(i);
  candle.update(candleBar(i));
  processBar(i);
  refreshTradeVisuals();
  Draw.dirty();
  updateUI();
  saveSoon();
}

function stepBack() {
  if (!S.replay || S.end <= 1) return;
  if (S.trades.some(isActive)) { setStatus('Không lùi được khi đang có lệnh mở/chờ.', true); return; }
  S.end--;
  render(false);
  save();
}

function stopPlay() {
  if (S.timer) { clearInterval(S.timer); S.timer = null; }
  $('btn-play').textContent = '▶';
}
function togglePlay() {
  if (!S.replay) { setStatus('Bấm "⏮ Replay" rồi click chọn nến bắt đầu trước.', true); return; }
  if (S.timer) { stopPlay(); save(); return; }
  S.timer = setInterval(stepForward, +$('speed').value);
  $('btn-play').textContent = '⏸';
}

function updateUI() {
  for (const id of ['btn-back', 'btn-play', 'btn-next', 'btn-exit-replay', 'btn-buy', 'btn-sell']) $(id).disabled = !S.replay;
  document.querySelector('[data-tool="replay"]').classList.toggle('replay-on', S.replay);
  $('btn-exit-replay').classList.toggle('replay-on', S.replay);
  renderPositions();
  renderStats();
  updateLotPreview();
  showLegend(S.end - 1);
  $('status-mode').textContent = S.replay
    ? `REPLAY · ${S.tf} · đến ${fmt(cursorUtc())} · nến ${S.end}/${S.bars.length}`
    : `XEM · ${S.tf}`;
}
