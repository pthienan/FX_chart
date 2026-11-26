'use strict';
// TradingView-style drawing tools, painted on a canvas overlay above the main chart.
// Points are stored as {t: UTC seconds, p: price} so drawings survive timeframe changes.

const Draw = (() => {
  const wrap = $('chart-wrap'), cv = $('draw-overlay'), ctx = cv.getContext('2d');
  const cu = $('ind-underlay'), ctxU = cu.getContext('2d');
  const FONT = '11px -apple-system, "Segoe UI", Roboto, Arial, sans-serif';
  const FIB = [
    { l: 0, c: '#787b86' }, { l: 0.236, c: '#f23645' }, { l: 0.382, c: '#ff9800' }, { l: 0.5, c: '#4caf50' },
    { l: 0.618, c: '#089981' }, { l: 0.786, c: '#00bcd4' }, { l: 1, c: '#787b86' }, { l: 1.618, c: '#2962ff' },
  ];
  const POINTS = { trend: 2, fib: 2, measure: 2, hline: 1, vline: 1, long: 1, short: 1 };
  const DEFAULT_COLOR = { trend: '#2962ff', hline: '#f0b90b', vline: '#9598a1', fib: '#787b86' };
  const DEFAULT_WIDTH = { trend: 2, hline: 1, vline: 1, fib: 1, long: 1, short: 1 };
  const widthOf = (d) => d.width || DEFAULT_WIDTH[d.type] || 1;
  const lastWidth = JSON.parse(localStorage.getItem('fxlab_draw_width') || '{}');
  const TOOL_HELP = {
    replay: 'Click lên nến muốn bắt đầu replay (các nến sau đó sẽ bị ẩn).',
    price: 'Click lên chart để lấy giá cho lệnh chờ.',
    trend: 'Trendline: click điểm thứ nhất.',
    hline: 'Click để đặt đường ngang.',
    vline: 'Click để đặt đường dọc.',
    fib: 'Fib Retracement: click đầu sóng, rồi click cuối sóng.',
    long: 'Long Position: click tại giá vào lệnh. Kéo mép trên vùng xanh = TP, mép dưới vùng đỏ = SL, đường giữa = Entry, mép phải = độ rộng, kéo trong box = di chuyển.',
    short: 'Short Position: click tại giá vào lệnh. Kéo mép vùng xanh = TP, mép vùng đỏ = SL, đường giữa = Entry, mép phải = độ rộng, kéo trong box = di chuyển.',
    measure: 'Đo: click điểm thứ nhất.',
  };
  const HIT = 6;
  const MAGNET_PX = 14;

  let sel = null, hover = null, drag = null, pending = null, measure = null;
  let magnet = false, keepTool = false, isDirty = true, lastSig = '';

  // ------------------------------------------------------------ coordinates
  const ts = () => chart.timeScale();
  const paneW = () => ts().width();
  const paneH = () => wrap.clientHeight - ts().height();
  const X = (t) => ts().logicalToCoordinate(timeToLogical(t));
  const Y = (p) => candle.priceToCoordinate(p);
  function xy(pt) {
    const x = X(pt.t), y = Y(pt.p);
    return x == null || y == null ? null : { x, y };
  }
  function pointAt(x, y) {
    let l = ts().coordinateToLogical(x);
    let p = candle.coordinateToPrice(y);
    if (l == null || p == null) return null;
    l = Math.round(l);
    if (magnet && l >= 0 && l < S.end) {
      const b = S.bars[l];
      let best = p, bd = MAGNET_PX;
      for (const v of [b.open, b.high, b.low, b.close]) {
        const dd = Math.abs(Y(v) - y);
        if (dd < bd) { bd = dd; best = v; }
      }
      p = best;
    }
    return { t: logicalToTime(l), p: round(p), l };
  }
  function local(e) {
    const r = wrap.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  // ------------------------------------------------------------ canvas primitives
  function line(x1, y1, x2, y2, color, width = 1, dash = []) {
    ctx.strokeStyle = color; ctx.lineWidth = width; ctx.setLineDash(dash);
    ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
    ctx.setLineDash([]);
  }
  function handle(x, y, color) {
    ctx.fillStyle = THEME.bg; ctx.strokeStyle = color; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.arc(x, y, 4.5, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  }
  function label(str, x, y, color, align = 'left', bg = null) {
    ctx.font = FONT; ctx.textAlign = align; ctx.textBaseline = 'middle';
    if (bg) {
      const w = ctx.measureText(str).width + 10, h = 18;
      const bx = align === 'left' ? x - 5 : align === 'right' ? x - w + 5 : x - w / 2;
      ctx.fillStyle = bg;
      ctx.beginPath();
      if (ctx.roundRect) ctx.roundRect(bx, y - h / 2, w, h, 3); else ctx.rect(bx, y - h / 2, w, h);
      ctx.fill();
    }
    ctx.fillStyle = color;
    ctx.fillText(str, x, y);
  }
  function priceTag(p, color, pw) {
    const y = Y(p);
    if (y == null || y < -10 || y > paneH() + 10) return;
    ctx.fillStyle = color;
    ctx.fillRect(pw + 1, y - 9, wrap.clientWidth - pw - 1, 18);
    ctx.font = FONT; ctx.fillStyle = '#fff'; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    ctx.fillText(fmtPrice(p), pw + 6, y);
  }
  function timeTag(t, color, pw, ph) {
    const x = X(t);
    if (x == null || x < 0 || x > pw) return;
    ctx.font = FONT;
    const s = fmt(t), w = ctx.measureText(s).width + 12;
    ctx.fillStyle = color;
    ctx.fillRect(x - w / 2, ph + 1, w, 20);
    ctx.fillStyle = '#fff'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(s, x, ph + 11);
  }
  function extended(a, b, pw) {
    if (Math.abs(b.x - a.x) < 1e-6) return b;
    const xt = b.x > a.x ? pw + 10 : -10;
    return { x: xt, y: a.y + ((b.y - a.y) / (b.x - a.x)) * (xt - a.x) };
  }

  // ------------------------------------------------------------ geometry per type
  function fibLevels(d) {
    const p0 = d.pts[0].p, p1 = d.pts[1].p;
    return FIB.map((f) => { const price = p1 + (p0 - p1) * f.l; return { ...f, price, y: Y(price) }; });
  }
  function posGeom(d) {
    const x1 = X(d.pts[0].t), x2 = X(d.pts[1].t);
    const ye = Y(d.pts[0].p), yt = Y(d.tp), ys = Y(d.sl);
    if ([x1, x2, ye, yt, ys].some((v) => v == null)) return null;
    return { L: Math.min(x1, x2), R: Math.max(x1, x2), ye, yt, ys };
  }
  function posStats(d) {
    const dir = d.type === 'long' ? 1 : -1, e = d.pts[0].p;
    const tpPips = ((d.tp - e) / S.pip) * dir, slPips = ((e - d.sl) / S.pip) * dir;
    const { lots, risk } = sizeFor(e, Math.max(slPips, 0.1));
    return { dir, e, tpPips, slPips, rr: tpPips / slPips, lots, risk, reward: tpPips * pipValue(e) * lots };
  }
  // Scans only bars already revealed (index < S.end), so replay never leaks the future.
  function posOutcome(d) {
    const i0 = barIndexOf(d.pts[0].t), i1 = Math.min(S.end - 1, barIndexOf(d.pts[1].t));
    if (i0 < 0 || i0 >= i1) return null;
    const long = d.type === 'long';
    for (let i = i0 + 1; i <= i1; i++) {
      const b = S.bars[i];
      if (long ? b.low <= d.sl : b.high >= d.sl) return { i, kind: 'sl', price: d.sl };
      if (long ? b.high >= d.tp : b.low <= d.tp) return { i, kind: 'tp', price: d.tp };
    }
    return { i: i1, kind: null, price: S.bars[i1].close };
  }

  function handles(d) {
    const pw = paneW(), ph = paneH();
    switch (d.type) {
      case 'trend': case 'fib': case 'measure':
        return d.pts.map((pt, k) => { const q = xy(pt); return q && { id: k, ...q }; }).filter(Boolean);
      case 'hline': { const y = Y(d.pts[0].p); return y == null ? [] : [{ id: 0, x: pw / 2, y }]; }
      case 'vline': { const x = X(d.pts[0].t); return x == null ? [] : [{ id: 0, x, y: ph / 2 }]; }
      case 'long': case 'short': {
        const g = posGeom(d);
        if (!g) return [];
        return [{ id: 'tp', x: g.L, y: g.yt }, { id: 'sl', x: g.L, y: g.ys }, { id: 'entry', x: g.L, y: g.ye }, { id: 'width', x: g.R, y: g.ye }];
      }
      default: return [];
    }
  }

  function distSeg(px, py, a, b) {
    const dx = b.x - a.x, dy = b.y - a.y, len = dx * dx + dy * dy;
    const t = len ? Math.max(0, Math.min(1, ((px - a.x) * dx + (py - a.y) * dy) / len)) : 0;
    return Math.hypot(px - (a.x + t * dx), py - (a.y + t * dy));
  }
  function bodyHit(d, x, y) {
    const pw = paneW(), ph = paneH();
    switch (d.type) {
      case 'trend': {
        const a = xy(d.pts[0]), b = xy(d.pts[1]);
        if (!a || !b) return false;
        return distSeg(x, y, a, d.extend ? extended(a, b, pw) : b) <= HIT;
      }
      case 'hline': { const yy = Y(d.pts[0].p); return yy != null && Math.abs(y - yy) <= HIT && x <= pw; }
      case 'vline': { const xx = X(d.pts[0].t); return xx != null && Math.abs(x - xx) <= HIT && y <= ph; }
      case 'fib': {
        const a = xy(d.pts[0]), b = xy(d.pts[1]);
        if (!a || !b) return false;
        const xl = Math.min(a.x, b.x), xr = d.extend ? pw : Math.max(a.x, b.x);
        if (distSeg(x, y, a, b) <= HIT) return true;
        return x >= xl - HIT && x <= xr + HIT && fibLevels(d).some((L) => L.y != null && Math.abs(y - L.y) <= HIT);
      }
      case 'long': case 'short': {
        const g = posGeom(d);
        return !!g && x >= g.L && x <= g.R && y >= Math.min(g.yt, g.ys) && y <= Math.max(g.yt, g.ys);
      }
      default: return false;
    }
  }
  // Edges of the TP / SL zones, the entry line and the right border resize a position box, like TradingView.
  function posEdgeHit(d, x, y) {
    if (d.type !== 'long' && d.type !== 'short') return null;
    const g = posGeom(d);
    if (!g || x < g.L - HIT || x > g.R + HIT) return null;
    if (Math.abs(y - g.yt) <= HIT) return 'tp';
    if (Math.abs(y - g.ys) <= HIT) return 'sl';
    const top = Math.min(g.yt, g.ys), bot = Math.max(g.yt, g.ys);
    if (Math.abs(x - g.R) <= HIT && y >= top && y <= bot) return 'width';
    if (Math.abs(y - g.ye) <= 4 && x >= g.L && x <= g.R) return 'entryP';
    return null;
  }
  function hitTest(x, y) {
    const order = [...S.drawings].reverse();
    for (const d of order) for (const h of handles(d)) if (Math.hypot(h.x - x, h.y - y) <= HIT + 2) return { d, h: h.id };
    for (const d of order) { const e = posEdgeHit(d, x, y); if (e) return { d, h: e }; }
    for (const d of order) if (bodyHit(d, x, y)) return { d, h: 'body' };
    return null;
  }

  // ------------------------------------------------------------ painting
  function drawShape(d, pw, ph) {
    const active = d === sel || d === pending || d === measure || (drag && drag.d === d) || (hover && hover.d === d);
    const col = d.color || DEFAULT_COLOR[d.type] || '#2962ff';
    switch (d.type) {
      case 'trend': {
        const a = xy(d.pts[0]), b = xy(d.pts[1]);
        if (!a || !b) return;
        const e = d.extend ? extended(a, b, pw) : b;
        line(a.x, a.y, e.x, e.y, col, widthOf(d));
        if (active) { handle(a.x, a.y, col); handle(b.x, b.y, col); }
        break;
      }
      case 'hline': {
        const y = Y(d.pts[0].p);
        if (y == null) return;
        line(0, y, pw, y, col, widthOf(d));
        if (active) handle(pw / 2, y, col);
        break;
      }
      case 'vline': {
        const x = X(d.pts[0].t);
        if (x == null) return;
        line(x, 0, x, ph, col, widthOf(d));
        if (active) handle(x, ph / 2, col);
        break;
      }
      case 'fib': {
        const a = xy(d.pts[0]), b = xy(d.pts[1]);
        if (!a || !b) return;
        const xl = Math.min(a.x, b.x), xr = d.extend ? pw : Math.max(a.x, b.x);
        const lv = fibLevels(d);
        for (let k = 0; k < lv.length - 1; k++) {
          const A = lv[k], B = lv[k + 1];
          if (A.y == null || B.y == null) continue;
          ctx.fillStyle = hexA(B.c, 0.1);
          ctx.fillRect(xl, Math.min(A.y, B.y), xr - xl, Math.abs(B.y - A.y));
        }
        for (const L of lv) {
          if (L.y == null) continue;
          line(xl, L.y, xr, L.y, L.c, widthOf(d));
          label(`${L.l} (${fmtPrice(L.price)})`, xl + 4, L.y - 8, L.c);
        }
        line(a.x, a.y, b.x, b.y, col, 1, [4, 4]);
        if (active) { handle(a.x, a.y, col); handle(b.x, b.y, col); }
        break;
      }
      case 'long': case 'short': {
        const g = posGeom(d);
        if (!g) return;
        const st = posStats(d);
        ctx.fillStyle = 'rgba(38,166,154,0.22)';
        ctx.fillRect(g.L, Math.min(g.ye, g.yt), g.R - g.L, Math.abs(g.yt - g.ye));
        ctx.fillStyle = 'rgba(239,83,80,0.22)';
        ctx.fillRect(g.L, Math.min(g.ye, g.ys), g.R - g.L, Math.abs(g.ys - g.ye));
        line(g.L, g.ye, g.R, g.ye, '#9598a1', widthOf(d));
        const out = posOutcome(d);
        if (out) {
          const xh = ts().logicalToCoordinate(out.i), yh = Y(out.price);
          if (xh != null && yh != null) {
            line(g.L, g.ye, xh, yh, out.kind === 'sl' ? '#ef5350' : out.kind === 'tp' ? '#26a69a' : '#d1d4dc', 1, [4, 3]);
            if (out.kind) label(out.kind === 'tp' ? '✓ TP' : '✗ SL', xh + 6, yh, '#fff', 'left', out.kind === 'tp' ? '#089981' : '#f23645');
          }
        }
        const cx = (g.L + g.R) / 2, up = (a, b) => (a < b ? -1 : 1);
        if (active) {
          const pctT = Math.abs(d.tp - st.e) / st.e * 100, pctS = Math.abs(st.e - d.sl) / st.e * 100;
          label(`Target: ${st.tpPips.toFixed(1)} pip (${pctT.toFixed(2)}%) · ${money(st.reward)}`, cx, g.yt + 12 * up(g.yt, g.ye), '#fff', 'center', '#089981');
          label(`Stop: ${st.slPips.toFixed(1)} pip (${pctS.toFixed(2)}%) · ${money(st.risk)}`, cx, g.ys + 12 * up(g.ys, g.ye), '#fff', 'center', '#f23645');
          label(`${d.type === 'long' ? 'Long' : 'Short'} · R:R ${st.rr.toFixed(2)} · ${st.lots.toFixed(2)} lot`, cx, g.ye, '#fff', 'center', '#2a2e39');
          for (const h of handles(d)) handle(h.x, h.y, h.id === 'tp' ? '#26a69a' : h.id === 'sl' ? '#ef5350' : '#d1d4dc');
        } else {
          label(`R:R ${st.rr.toFixed(2)}`, cx, g.ye, '#d1d4dc', 'center', '#1e222dcc');
        }
        break;
      }
      case 'measure': {
        const a = xy(d.pts[0]), b = xy(d.pts[1]);
        if (!a || !b) return;
        const upMove = d.pts[1].p >= d.pts[0].p, c = upMove ? '#2962ff' : '#f23645';
        ctx.fillStyle = hexA(c, 0.15);
        ctx.fillRect(Math.min(a.x, b.x), Math.min(a.y, b.y), Math.abs(b.x - a.x), Math.abs(b.y - a.y));
        line(a.x, (a.y + b.y) / 2, b.x, (a.y + b.y) / 2, c, 1);
        line((a.x + b.x) / 2, a.y, (a.x + b.x) / 2, b.y, c, 1);
        const pips = (d.pts[1].p - d.pts[0].p) / S.pip, pct = ((d.pts[1].p - d.pts[0].p) / d.pts[0].p) * 100;
        const nb = Math.round(timeToLogical(d.pts[1].t) - timeToLogical(d.pts[0].t));
        const ly = upMove ? Math.min(a.y, b.y) - 24 : Math.max(a.y, b.y) + 24;
        label(`${sign(pips)} pip (${sign(pct, 2)}%)`, (a.x + b.x) / 2, ly - 9, '#fff', 'center', c);
        label(`${nb} nến · ${durText(d.pts[1].t - d.pts[0].t)}`, (a.x + b.x) / 2, ly + 9, '#fff', 'center', c);
        break;
      }
      default: break;
    }
  }

  function axisLabels(d, pw, ph) {
    const active = d === sel || d === pending || d === measure || (drag && drag.d === d) || (hover && hover.d === d);
    const col = d.color || DEFAULT_COLOR[d.type] || '#2962ff';
    if (d.type === 'hline') { priceTag(d.pts[0].p, col, pw); return; }
    if (d.type === 'vline') { timeTag(d.pts[0].t, col, pw, ph); return; }
    if (!active) return;
    if (d.type === 'long' || d.type === 'short') {
      priceTag(d.tp, '#089981', pw); priceTag(d.sl, '#f23645', pw); priceTag(d.pts[0].p, '#2a2e39', pw);
      timeTag(d.pts[0].t, '#2a2e39', pw, ph); timeTag(d.pts[1].t, '#2a2e39', pw, ph);
      return;
    }
    const c = d.type === 'measure' ? '#2962ff' : col;
    for (const pt of d.pts) { priceTag(pt.p, c, pw); timeTag(pt.t, c, pw, ph); }
  }

  function paint() {
    const dpr = window.devicePixelRatio || 1, w = wrap.clientWidth, h = wrap.clientHeight;
    for (const [c, g] of [[cv, ctx], [cu, ctxU]]) {
      if (c.width !== Math.round(w * dpr) || c.height !== Math.round(h * dpr)) {
        c.width = Math.round(w * dpr); c.height = Math.round(h * dpr);
      }
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.clearRect(0, 0, w, h);
    }
    if (!S.bars.length) return;
    const pw = paneW(), ph = paneH();
    ctxU.save();
    ctxU.beginPath(); ctxU.rect(0, 0, pw, ph); ctxU.clip();
    Ind.paintUnder(ctxU, pw, ph);
    ctxU.restore();
    const shapes = [...S.drawings, pending, measure].filter(Boolean);
    ctx.save();
    ctx.beginPath(); ctx.rect(0, 0, pw, ph); ctx.clip();
    for (const d of shapes) drawShape(d, pw, ph);
    ctx.restore();
    for (const d of shapes) axisLabels(d, pw, ph);
  }

  function frame() {
    requestAnimationFrame(frame);
    if (!S.bars.length) return;
    const r = ts().getVisibleLogicalRange();
    const ref = S.bars[0].close;
    const sig = [wrap.clientWidth, wrap.clientHeight, paneW(), r ? r.from.toFixed(3) : '', r ? r.to.toFixed(3) : '',
      Y(ref), Y(ref * 1.01), S.end, S.tf, S.tz].join('|');
    if (sig === lastSig && !isDirty) return;
    lastSig = sig; isDirty = false;
    paint();
  }
  requestAnimationFrame(frame);

  // ------------------------------------------------------------ editing
  function dirty() { isDirty = true; }

  function newDrawing(type, pts) {
    const d = { id: S.drawSeq++, type, pts };
    if (DEFAULT_COLOR[type]) d.color = DEFAULT_COLOR[type];
    if (lastWidth[type]) d.width = lastWidth[type];
    return d;
  }
  function commit(d) {
    S.drawings.push(d);
    select(d);
    save();
  }
  function select(d) {
    sel = d;
    renderProps();
    dirty();
  }

  function renderProps() {
    const box = $('draw-props');
    if (!sel) { box.classList.add('hidden'); box.innerHTML = ''; return; }
    const d = sel, parts = [];
    if (d.type !== 'long' && d.type !== 'short') {
      parts.push(`<input type="color" class="sw" data-a="color" value="${d.color || DEFAULT_COLOR[d.type]}" title="Màu">`);
    }
    const w = widthOf(d);
    parts.push(`<select data-a="width" title="Độ dày">${[1, 2, 3, 4].map((n) => `<option value="${n}"${n === w ? ' selected' : ''}>${n}px</option>`).join('')}</select>`);
    if (d.type === 'trend' || d.type === 'fib') {
      parts.push(`<button data-a="extend" class="${d.extend ? 'active' : ''}" title="Kéo dài sang phải">Kéo dài →</button>`);
    }
    if (d.type === 'long' || d.type === 'short') {
      parts.push('<button data-a="flip" title="Đổi Long ↔ Short">⇅ Đảo</button>');
      parts.push('<button data-a="pending" title="Replay: đặt lệnh chờ tại giá Entry, SL/TP theo box">Đặt lệnh chờ</button>');
      parts.push('<button data-a="market" title="Replay: vào lệnh Market ngay, SL/TP theo box">Vào Market</button>');
    }
    parts.push('<button data-a="delete" title="Xóa (Delete)">🗑 Xóa</button>');
    box.innerHTML = parts.join('');
    box.classList.remove('hidden');
  }

  $('draw-props').addEventListener('input', (e) => {
    if (e.target.dataset.a === 'color' && sel) { sel.color = e.target.value; dirty(); saveSoon(); }
  });
  $('draw-props').addEventListener('change', (e) => {
    if (e.target.dataset.a === 'width' && sel) {
      sel.width = +e.target.value;
      lastWidth[sel.type] = sel.width;
      localStorage.setItem('fxlab_draw_width', JSON.stringify(lastWidth));
      dirty(); save();
    }
  });
  $('draw-props').addEventListener('click', (e) => {
    const a = e.target.closest('[data-a]')?.dataset.a;
    if (!a || !sel) return;
    if (a === 'extend') { sel.extend = !sel.extend; renderProps(); save(); }
    else if (a === 'delete') api.removeSelected();
    else if (a === 'flip') {
      const e0 = sel.pts[0].p;
      sel.type = sel.type === 'long' ? 'short' : 'long';
      [sel.tp, sel.sl] = [round(2 * e0 - sel.tp), round(2 * e0 - sel.sl)];
      save();
    } else if (a === 'pending' || a === 'market') placeFromBox(sel, a === 'market');
    dirty();
  });

  function applyDrag(x, y) {
    const d = drag.d, o = drag.orig;
    if (drag.h === 'body') {
      const l = ts().coordinateToLogical(x), p = candle.coordinateToPrice(y);
      if (l == null || p == null) return;
      const dl = Math.round(l - drag.start.l), dp = p - drag.start.p;
      d.pts = o.pts.map((q) => ({
        t: d.type === 'hline' ? q.t : logicalToTime(Math.round(timeToLogical(q.t)) + dl),
        p: d.type === 'vline' ? q.p : round(q.p + dp),
      }));
      if (o.tp != null) { d.tp = round(o.tp + dp); d.sl = round(o.sl + dp); }
      return;
    }
    const pt = pointAt(x, y);
    if (!pt) return;
    if (d.type === 'long' || d.type === 'short') {
      const long = d.type === 'long', e0 = d.pts[0].p, m = S.pip;
      if (drag.h === 'tp') d.tp = round(long ? Math.max(pt.p, e0 + m) : Math.min(pt.p, e0 - m));
      else if (drag.h === 'sl') d.sl = round(long ? Math.min(pt.p, e0 - m) : Math.max(pt.p, e0 + m));
      else if (drag.h === 'entryP') {
        const lo = long ? d.sl + m : d.tp + m, hi = long ? d.tp - m : d.sl - m;
        const p = round(Math.min(Math.max(pt.p, lo), hi));
        d.pts = [{ t: d.pts[0].t, p }, { t: d.pts[1].t, p }];
      } else if (drag.h === 'entry') {
        const lo = long ? d.sl + m : d.tp + m, hi = long ? d.tp - m : d.sl - m;
        const t = pt.l < timeToLogical(d.pts[1].t) ? pt.t : d.pts[0].t;
        d.pts[0] = { t, p: round(Math.min(Math.max(pt.p, lo), hi)) };
        d.pts[1] = { t: d.pts[1].t, p: d.pts[0].p };
      } else if (drag.h === 'width' && pt.l > timeToLogical(d.pts[0].t)) {
        d.pts[1] = { t: pt.t, p: d.pts[0].p };
      }
      return;
    }
    if (d.type === 'hline') { d.pts[0] = { t: d.pts[0].t, p: pt.p }; return; }
    if (d.type === 'vline') { d.pts[0] = { t: pt.t, p: d.pts[0].p }; return; }
    d.pts[drag.h] = { t: pt.t, p: pt.p };
  }

  function onToolClick(x, y) {
    const pt = pointAt(x, y);
    if (!pt) return;
    const tool = S.tool;
    if (tool === 'replay') { api.setTool(null); startReplayAt(Math.max(0, Math.min(S.end - 1, pt.l))); return; }
    if (tool === 'price') { $('oprice').value = fmtPrice(pt.p); api.setTool(null); updateLotPreview(); return; }
    const P = { t: pt.t, p: pt.p };
    if (POINTS[tool] === 2) {
      if (!pending) {
        pending = tool === 'measure' ? { type: 'measure', pts: [P, { ...P }] } : newDrawing(tool, [P, { ...P }]);
        measure = null;
        setStatus('Click điểm thứ hai.');
        dirty();
        return;
      }
      pending.pts[1] = P;
      const done = pending;
      pending = null;
      if (done.pts[0].t === done.pts[1].t && done.pts[0].p === done.pts[1].p) {
        setStatus('Hai điểm trùng nhau, hãy vẽ lại.', true);
        dirty();
        return;
      }
      if (done.type === 'measure') { measure = done; dirty(); } else commit(done);
    } else if (tool === 'hline' || tool === 'vline') {
      commit(newDrawing(tool, [P]));
    } else if (tool === 'long' || tool === 'short') {
      // Sized to the current view (as TradingView does), keeping the TP:SL ratio from the order settings.
      const dir = tool === 'long' ? 1 : -1;
      const ph = paneH(), pAt = (yy) => candle.coordinateToPrice(yy);
      const span = Math.abs(pAt(0) - pAt(ph)) || 100 * S.pip;
      const slDist = Math.max(S.pip, Math.round((span * 0.08) / S.pip) * S.pip);
      const ratio = S.settings.sl > 0 && S.settings.tp > 0 ? S.settings.tp / S.settings.sl : 2;
      const spacing = Math.abs(ts().logicalToCoordinate(1) - ts().logicalToCoordinate(0)) || 6;
      const bars = Math.max(5, Math.round((paneW() * 0.12) / spacing));
      const d = newDrawing(tool, [P, { t: logicalToTime(pt.l + bars), p: P.p }]);
      d.sl = round(P.p - dir * slDist);
      d.tp = round(P.p + dir * slDist * ratio);
      commit(d);
    }
    if (!keepTool) api.setTool(null);
  }

  // ------------------------------------------------------------ mouse
  wrap.addEventListener('mousedown', (e) => {
    if (e.button !== 0 || e.target.closest('#legend .lg-row, #draw-props')) return;
    const { x, y } = local(e);
    if (x > paneW() || y > paneH()) return;
    if (measure && !S.tool) { measure = null; dirty(); }
    if (S.tool) { e.preventDefault(); e.stopPropagation(); onToolClick(x, y); return; }
    const hit = hitTest(x, y);
    if (hit) {
      e.preventDefault(); e.stopPropagation();
      select(hit.d);
      drag = {
        d: hit.d, h: hit.h, moved: false, orig: JSON.parse(JSON.stringify(hit.d)),
        start: { l: ts().coordinateToLogical(x), p: candle.coordinateToPrice(y) },
      };
      return;
    }
    if (sel) select(null);
  }, true);

  window.addEventListener('mousemove', (e) => {
    const { x, y } = local(e);
    if (drag) { applyDrag(x, y); drag.moved = true; dirty(); return; }
    const inside = e.target instanceof Element && wrap.contains(e.target) && x >= 0 && y >= 0 && x <= paneW() && y <= paneH() && !e.target.closest('#legend .lg-row, #draw-props');
    if (pending && inside) {
      const pt = pointAt(x, y);
      if (pt) { pending.pts[1] = { t: pt.t, p: pt.p }; dirty(); }
    }
    const h = !S.tool && inside ? hitTest(x, y) : null;
    if ((h && h.d) !== (hover && hover.d) || (h && h.h) !== (hover && hover.h)) { hover = h; dirty(); }
    setCursor(S.tool && inside ? 'draw' : drag ? cursorFor(drag.h) : h ? cursorFor(h.h) : null);
  });
  function cursorFor(id) {
    if (id === 'body') return 'move';
    if (id === 'tp' || id === 'sl' || id === 'entryP') return 'ns';
    if (id === 'width') return 'ew';
    return 'handle';
  }
  function setCursor(kind) {
    for (const k of ['draw', 'move', 'handle', 'ns', 'ew']) wrap.classList.toggle('cur-' + k, k === kind);
  }

  window.addEventListener('mouseup', () => {
    if (!drag) return;
    if (drag.moved) save();
    drag = null;
    dirty();
  });

  // ------------------------------------------------------------ public api
  const api = {
    dirty,
    reset() { sel = hover = drag = pending = measure = null; renderProps(); dirty(); },
    refreshProps() { renderProps(); },
    setTool(t) {
      S.tool = S.tool === t ? null : t;
      pending = null;
      document.querySelectorAll('[data-tool]').forEach((b) => b.classList.toggle('active', b.dataset.tool === S.tool));
      if (S.tool) setStatus(TOOL_HELP[S.tool] || '');
      dirty();
    },
    escape() {
      if (pending || S.tool) { pending = null; if (S.tool) api.setTool(S.tool); return; }
      if (measure) { measure = null; dirty(); return; }
      if (sel) select(null);
    },
    removeSelected() {
      if (!sel) return false;
      S.drawings = S.drawings.filter((d) => d !== sel);
      select(null);
      save();
      return true;
    },
    undo() {
      const d = S.drawings.pop();
      if (d && d === sel) select(null);
      dirty(); save();
    },
    clear() {
      S.drawings = [];
      select(null);
      save();
    },
    toggleMagnet() { magnet = !magnet; return magnet; },
    toggleKeep() { keepTool = !keepTool; return keepTool; },
  };
  return api;
})();
