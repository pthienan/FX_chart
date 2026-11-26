'use strict';
// Simulated orders, SL/TP handling, side panel and statistics.

function balance() {
  return S.settings.balance + S.trades.reduce((s, p) => s + (p.status === 'closed' ? p.pnl : 0), 0);
}
function floating(p) {
  const b = curBar(), dir = p.side === 'buy' ? 1 : -1;
  const exit = p.side === 'buy' ? b.close : b.close + spreadPx();
  const pips = ((exit - p.entry) / S.pip) * dir;
  return { pips, usd: pips * pipValue(exit) * p.lots };
}
function sizeFor(price, slPips) {
  const riskUsd = (balance() * S.settings.risk) / 100;
  const lots = Math.max(0.01, Math.floor((riskUsd / (slPips * pipValue(price))) * 100) / 100);
  return { lots, risk: slPips * pipValue(price) * lots };
}
const marketPrice = (side) => (side === 'buy' ? curBar().close + spreadPx() : curBar().close);

// type: 'market' | 'limit' | 'stop'; sl/tp are absolute prices (tp may be null).
function openOrder(side, type, price, sl, tp) {
  if (!S.replay) { setStatus('Bật Replay để vào lệnh (bấm "⏮ Replay" rồi click chọn nến).', true); return null; }
  const dir = side === 'buy' ? 1 : -1;
  if (type === 'market') price = marketPrice(side);
  if (!(price > 0)) { setStatus('Giá vào lệnh không hợp lệ.', true); return null; }
  if (type !== 'market') {
    const ref = marketPrice(side), below = price < ref;
    const ok = type === 'limit' ? (side === 'buy' ? below : !below) : (side === 'buy' ? !below : below);
    if (!ok || price === ref) {
      setStatus(type === 'limit'
        ? 'Buy Limit phải đặt dưới giá hiện tại, Sell Limit phải đặt trên.'
        : 'Buy Stop phải đặt trên giá hiện tại, Sell Stop phải đặt dưới.', true);
      return null;
    }
  }
  if (!(sl > 0) || (price - sl) * dir <= 0) { setStatus('SL phải nằm phía lỗ so với giá vào lệnh.', true); return null; }
  if (tp != null && (tp - price) * dir <= 0) { setStatus('TP phải nằm phía lời so với giá vào lệnh.', true); return null; }
  const slPips = Math.abs(price - sl) / S.pip;
  const { lots, risk } = sizeFor(price, slPips);
  const cur = cursorUtc();
  const p = {
    id: S.nextId++, side, otype: type, status: type === 'market' ? 'open' : 'pending',
    price: round(price), entry: type === 'market' ? round(price) : null,
    sl: round(sl), tp: tp == null ? null : round(tp),
    lots, riskUsd: risk, placedT: cur,
    openT: type === 'market' ? cur : null, openMark: type === 'market' ? cur - 1 : null,
    closeT: null, closeMark: null, exit: null, pips: 0, pnl: 0, r: 0, reason: '',
  };
  S.trades.push(p);
  refreshTradeVisuals();
  updateUI();
  save();
  setStatus(`#${p.id} ${side.toUpperCase()} ${type.toUpperCase()} ${lots} lot @ ${fmtPrice(p.price)}  SL ${fmtPrice(p.sl)}  TP ${fmtPrice(p.tp)}`);
  return p;
}

function placeOrder(side) {
  readSettings();
  const st = S.settings;
  if (!(st.sl > 0)) { setStatus('Cần nhập SL (pip) > 0.', true); return; }
  const price = st.otype === 'market' ? (S.replay ? marketPrice(side) : 0) : parseFloat($('oprice').value);
  const dir = side === 'buy' ? 1 : -1;
  openOrder(side, st.otype, price, price - dir * st.sl * S.pip, st.tp > 0 ? price + dir * st.tp * S.pip : null);
}

// Long/Short Position drawing -> real order (pending at its entry, or market now).
function placeFromBox(d, market) {
  const side = d.type === 'long' ? 'buy' : 'sell';
  if (market || !S.replay) { openOrder(side, 'market', 0, d.sl, d.tp); return; }
  const price = d.pts[0].p, ref = marketPrice(side);
  const type = side === 'buy' ? (price < ref ? 'limit' : 'stop') : (price > ref ? 'limit' : 'stop');
  openOrder(side, type, price, d.sl, d.tp);
}

function fillPending(p, b, sp) {
  const P = p.price;
  if (p.side === 'buy') {
    if (p.otype === 'limit' && b.low + sp <= P) return Math.min(P, b.open + sp);
    if (p.otype === 'stop' && b.high + sp >= P) return Math.max(P, b.open + sp);
  } else {
    if (p.otype === 'limit' && b.high >= P) return Math.max(P, b.open);
    if (p.otype === 'stop' && b.low <= P) return Math.min(P, b.open);
  }
  return null;
}

function closeTrade(p, price, reason, t, mark) {
  const dir = p.side === 'buy' ? 1 : -1;
  p.status = 'closed';
  p.exit = round(price);
  p.closeT = t;
  p.closeMark = mark ?? t;
  p.reason = reason;
  p.pips = ((p.exit - p.entry) / S.pip) * dir;
  p.pnl = p.pips * pipValue(p.exit) * p.lots;
  p.r = p.riskUsd ? p.pnl / p.riskUsd : 0;
}

// Within one bar the path is unknown: if both SL and TP are touched, SL is assumed first.
function checkExit(p, b, sp, t, justFilled) {
  if (p.side === 'buy') {
    if (!justFilled && b.open <= p.sl) return closeTrade(p, b.open, 'SL (gap)', t);
    if (!justFilled && p.tp != null && b.open >= p.tp) return closeTrade(p, b.open, 'TP (gap)', t);
    if (b.low <= p.sl) return closeTrade(p, p.sl, 'SL', t);
    if (p.tp != null && b.high >= p.tp) return closeTrade(p, p.tp, 'TP', t);
  } else {
    const op = b.open + sp, hi = b.high + sp, lo = b.low + sp;
    if (!justFilled && op >= p.sl) return closeTrade(p, op, 'SL (gap)', t);
    if (!justFilled && p.tp != null && op <= p.tp) return closeTrade(p, op, 'TP (gap)', t);
    if (hi >= p.sl) return closeTrade(p, p.sl, 'SL', t);
    if (p.tp != null && lo <= p.tp) return closeTrade(p, p.tp, 'TP', t);
  }
}

function processBar(i) {
  const b = S.bars[i], t = S.t[i], sp = spreadPx();
  for (const p of S.trades) {
    let justFilled = false;
    // After switching to a higher TF the next bar can start before the order existed; its range mixes in older prices.
    if (isActive(p) && t < (p.status === 'pending' ? p.placedT : p.openT)) continue;
    if (p.status === 'pending') {
      const fill = fillPending(p, b, sp);
      if (fill == null) continue;
      const shift = round(fill) - p.price;
      p.status = 'open';
      p.entry = round(fill);
      p.sl = round(p.sl + shift);
      if (p.tp != null) p.tp = round(p.tp + shift);
      p.openT = t; p.openMark = t;
      justFilled = true;
    }
    if (p.status === 'open') checkExit(p, b, sp, t, justFilled);
  }
}

function closeManual(id) {
  const p = S.trades.find((x) => x.id === id);
  if (!p) return;
  if (p.status === 'pending') {
    S.trades = S.trades.filter((x) => x !== p);
  } else if (p.status === 'open') {
    const cur = cursorUtc();
    closeTrade(p, p.side === 'buy' ? curBar().close : curBar().close + spreadPx(), 'Đóng tay', cur, cur - 1);
  }
  refreshTradeVisuals(); updateUI(); save();
}

function moveBE(id) {
  const p = S.trades.find((x) => x.id === id);
  if (!p || p.status !== 'open') return;
  const ref = p.side === 'buy' ? curBar().close : curBar().close + spreadPx();
  if (p.side === 'buy' ? ref <= p.entry : ref >= p.entry) {
    setStatus('Giá chưa vượt điểm vào lệnh, không dời SL về hòa vốn được.', true);
    return;
  }
  p.sl = p.entry;
  refreshTradeVisuals(); updateUI(); save();
}

function editLevel(id, field, raw) {
  const p = S.trades.find((x) => x.id === id);
  if (!p || !isActive(p)) return;
  const v = raw.trim() === '' ? null : parseFloat(raw);
  const reject = (msg) => { if (msg) setStatus(msg, true); S.posSig = ''; updateUI(); };
  if (field === 'sl' && !(v > 0)) return reject('SL không được để trống.');
  if (v != null && !(v > 0)) return reject();
  const dir = p.side === 'buy' ? 1 : -1;
  const ref = p.status === 'pending' ? p.price : (p.side === 'buy' ? curBar().close : curBar().close + spreadPx());
  if (v != null) {
    const wrong = field === 'sl' ? (v - ref) * dir >= 0 : (v - ref) * dir <= 0;
    if (wrong) return reject(field === 'sl' ? 'SL phải nằm phía lỗ so với giá hiện tại.' : 'TP phải nằm phía lời so với giá hiện tại.');
  }
  p[field] = v == null ? null : round(v);
  refreshTradeVisuals(); updateUI(); save();
}

// ---------------------------------------------------------------- trade visuals
let tradeLines = [];
function refreshTradeVisuals() {
  for (const l of tradeLines) candle.removePriceLine(l);
  tradeLines = [];
  for (const p of S.trades.filter(isActive)) {
    const lbl = `#${p.id} ${p.side.toUpperCase()}${p.status === 'pending' ? ' ' + p.otype.toUpperCase() : ''} ${p.lots}`;
    const at = p.status === 'pending' ? p.price : p.entry;
    tradeLines.push(candle.createPriceLine({ price: at, color: '#2962ff', lineWidth: 1, lineStyle: p.status === 'pending' ? 2 : 0, title: lbl }));
    tradeLines.push(candle.createPriceLine({ price: p.sl, color: '#ef5350', lineWidth: 1, lineStyle: 2, title: `SL #${p.id}` }));
    if (p.tp != null) tradeLines.push(candle.createPriceLine({ price: p.tp, color: '#26a69a', lineWidth: 1, lineStyle: 2, title: `TP #${p.id}` }));
  }
  const last = S.end - 1, ms = [];
  const snap = (utc) => { const i = barIndexOf(utc); return i >= 0 && i <= last ? S.bars[i].time : null; };
  for (const p of S.trades) {
    if (p.openMark != null) {
      const tm = snap(p.openMark);
      if (tm != null) ms.push({
        time: tm, position: p.side === 'buy' ? 'belowBar' : 'aboveBar',
        color: p.side === 'buy' ? '#26a69a' : '#ef5350', shape: p.side === 'buy' ? 'arrowUp' : 'arrowDown', text: `#${p.id}`,
      });
    }
    if (p.status === 'closed') {
      const tm = snap(p.closeMark);
      if (tm != null) ms.push({
        time: tm, position: p.side === 'buy' ? 'aboveBar' : 'belowBar',
        color: p.pnl >= 0 ? '#26a69a' : '#ef5350', shape: 'circle', text: `${sign(p.pips)}p`,
      });
    }
  }
  ms.sort((a, b) => a.time - b.time);
  candle.setMarkers(ms);
}

// ---------------------------------------------------------------- side panel
const SETTING_INPUTS = { balance: 's-balance', risk: 's-risk', sl: 's-sl', tp: 's-tp', spread: 's-spread' };
function writeSettingsUI() {
  for (const [k, id] of Object.entries(SETTING_INPUTS)) $(id).value = S.settings[k];
  $('s-otype').value = S.settings.otype;
  $('oprice-row').classList.toggle('hidden', S.settings.otype === 'market');
}
function readSettings() {
  for (const [k, id] of Object.entries(SETTING_INPUTS)) {
    const v = parseFloat($(id).value);
    if (Number.isFinite(v) && v >= 0) S.settings[k] = v;
  }
  if (!(S.settings.balance > 0)) S.settings.balance = DEFAULT_SETTINGS.balance;
  S.settings.otype = $('s-otype').value;
}

function updateLotPreview() {
  const el = $('lot-preview');
  if (!S.replay) { el.textContent = 'Bật Replay để vào lệnh.'; return; }
  const st = S.settings;
  const price = st.otype === 'market' ? curBar().close + spreadPx() / 2 : parseFloat($('oprice').value);
  if (!(st.sl > 0) || !(price > 0)) { el.textContent = ''; return; }
  const { lots, risk } = sizeFor(price, st.sl);
  const rr = st.tp > 0 ? ` · R:R 1:${(st.tp / st.sl).toFixed(2)}` : '';
  el.textContent = `Khối lượng ${lots.toFixed(2)} lot · rủi ro ${money(risk)} · 1 pip = ${money(pipValue(price) * lots)}${rr}`;
}

function renderPositions() {
  const act = S.trades.filter(isActive);
  const sig = act.map((p) => `${p.id}:${p.status}:${p.sl}:${p.tp}`).join('|');
  if (sig !== S.posSig) {
    S.posSig = sig;
    $('positions').innerHTML = !act.length ? '<div class="muted">Chưa có lệnh.</div>' :
      '<table><tr><th>Lệnh</th><th>Giá</th><th>SL</th><th>TP</th><th>Lot</th><th>Lãi/lỗ</th><th></th></tr>' +
      act.map((p) => `<tr>
        <td class="${p.side}">#${p.id} ${p.side.toUpperCase()}${p.status === 'pending' ? `<br><span class="muted">${p.otype.toUpperCase()}</span>` : ''}</td>
        <td>${fmtPrice(p.status === 'pending' ? p.price : p.entry)}</td>
        <td><input data-id="${p.id}" data-f="sl" value="${fmtPrice(p.sl)}"></td>
        <td><input data-id="${p.id}" data-f="tp" value="${p.tp == null ? '' : fmtPrice(p.tp)}" placeholder="—"></td>
        <td>${p.lots.toFixed(2)}</td>
        <td id="fl-${p.id}"></td>
        <td>${p.status === 'open' ? `<button data-act="be" data-id="${p.id}" title="Dời SL về điểm vào lệnh">BE</button>` : ''}<button data-act="close" data-id="${p.id}" title="${p.status === 'open' ? 'Đóng lệnh tại giá hiện tại' : 'Hủy lệnh chờ'}">✕</button></td>
      </tr>`).join('') + '</table>';
  }
  let fl = 0;
  for (const p of act) {
    const el = $('fl-' + p.id);
    if (p.status !== 'open') { if (el) { el.textContent = 'chờ khớp'; el.className = 'muted'; } continue; }
    const f = floating(p);
    fl += f.usd;
    if (el) { el.innerHTML = `${sign(f.pips)}p<br>${money(f.usd)}`; el.className = f.usd >= 0 ? 'pos' : 'neg'; }
  }
  const bal = balance();
  $('equity').textContent = `· Số dư ${money(bal)} · Equity ${money(bal + fl)}`;
}

function renderStats() {
  const c = S.trades.filter((p) => p.status === 'closed');
  const sig = `${c.length}|${S.settings.balance}|${S.symbol}`;
  if (sig === S.statSig) return;
  S.statSig = sig;
  const wins = c.filter((p) => p.pnl > 0), losses = c.filter((p) => p.pnl <= 0);
  const gw = wins.reduce((s, p) => s + p.pnl, 0), gl = -losses.reduce((s, p) => s + p.pnl, 0);
  const net = gw - gl, pips = c.reduce((s, p) => s + p.pips, 0);
  const avgR = c.length ? c.reduce((s, p) => s + p.r, 0) / c.length : 0;
  let bal = S.settings.balance, peak = bal, mdd = 0, streak = 0, maxStreak = 0;
  for (const p of [...c].sort((a, b) => a.closeT - b.closeT || a.id - b.id)) {
    bal += p.pnl; peak = Math.max(peak, bal); mdd = Math.max(mdd, (peak - bal) / peak);
    streak = p.pnl <= 0 ? streak + 1 : 0; maxStreak = Math.max(maxStreak, streak);
  }
  const pf = gl > 0 ? (gw / gl).toFixed(2) : gw > 0 ? '∞' : '—';
  const kv = [
    ['Số lệnh', c.length], ['Thắng / Thua', `${wins.length} / ${losses.length}`],
    ['Tỷ lệ thắng', c.length ? ((wins.length / c.length) * 100).toFixed(1) + '%' : '—'], ['Profit factor', pf],
    ['Lãi ròng', `<span class="${net >= 0 ? 'pos' : 'neg'}">${money(net)}</span>`], ['Tổng pip', sign(pips)],
    ['Kỳ vọng', `${sign(avgR, 2)}R / lệnh`], ['Max drawdown', (mdd * 100).toFixed(1) + '%'],
    ['Chuỗi thua dài nhất', maxStreak], ['Lợi nhuận', sign((net / S.settings.balance) * 100, 2) + '%'],
  ];
  $('stats').innerHTML = '<div class="kv">' + kv.map(([k, v]) => `<div><span class="muted">${k}</span><span>${v}</span></div>`).join('') + '</div>';
  $('history').innerHTML = !c.length ? '<div class="muted">Chưa có lệnh đóng.</div>' :
    '<table><tr><th>#</th><th>Mở</th><th>Vào</th><th>Ra</th><th>Pip</th><th>$</th><th>R</th><th>Lý do</th></tr>' +
    [...c].reverse().map((p) => `<tr>
      <td class="${p.side}">${p.id} ${p.side === 'buy' ? 'B' : 'S'}</td><td class="muted">${fmt(p.openT).slice(2)}</td>
      <td>${fmtPrice(p.entry)}</td><td>${fmtPrice(p.exit)}</td>
      <td class="${p.pips >= 0 ? 'pos' : 'neg'}">${sign(p.pips)}</td><td class="${p.pnl >= 0 ? 'pos' : 'neg'}">${p.pnl.toFixed(0)}</td>
      <td>${sign(p.r, 2)}</td><td class="muted">${p.reason}</td></tr>`).join('') + '</table>';
}

function exportCsv() {
  const c = S.trades.filter((p) => p.status === 'closed');
  if (!c.length) { setStatus('Chưa có lệnh đóng để xuất.', true); return; }
  const head = 'id,side,type,open_time,entry,close_time,exit,sl,tp,lots,pips,pnl_usd,r,reason';
  const rows = c.map((p) => [p.id, p.side, p.otype, fmt(p.openT), p.entry, fmt(p.closeT), p.exit, p.sl, p.tp ?? '',
    p.lots, p.pips.toFixed(1), p.pnl.toFixed(2), p.r.toFixed(2), p.reason].join(','));
  const blob = new Blob([[head, ...rows].join('\n')], { type: 'text/csv' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `fxlab_${S.symbol}_${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
}

function resetSession() {
  if (!confirm('Xóa toàn bộ lệnh và thống kê của phiên này?')) return;
  S.trades = []; S.nextId = 1; S.statSig = ''; S.posSig = '';
  refreshTradeVisuals(); updateUI(); save();
  setStatus('Đã reset phiên.');
}
