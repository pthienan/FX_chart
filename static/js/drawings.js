'use strict';
// TradingView-style drawing tools, painted on a canvas overlay above the main chart.
// Points are stored as {t: UTC seconds, p: price} so drawings survive timeframe changes.

const Draw = (() => {
  const wrap = $('chart-wrap'), cv = $('draw-overlay'), ctx = cv.getContext('2d');
  const cu = $('ind-underlay'), ctxU = cu.getContext('2d');
  const FONT_FAMILY = '-apple-system, "Segoe UI", Roboto, Arial, sans-serif';
  const FONT = `11px ${FONT_FAMILY}`;
  const FIB = [
    { l: 0, c: '#787b86' }, { l: 0.236, c: '#f23645' }, { l: 0.382, c: '#ff9800' }, { l: 0.5, c: '#4caf50' },
    { l: 0.618, c: '#089981' }, { l: 0.786, c: '#00bcd4' }, { l: 1, c: '#787b86' }, { l: 1.618, c: '#2962ff' },
  ];
  const FIB_EXTRA = [1.272, 1.414, 2, 2.272, 2.414, 2.618, 3, 3.618, 4.236, 0.65, 0.705, 0.886, -0.272, -0.618, 1.13, 4.618];
  const FIB_PALETTE = ['#9c27b0', '#e91e63', '#f23645', '#ff9800', '#4caf50', '#089981', '#00bcd4', '#2962ff'];
  const fibFactory = () => ({
    levels: [
      ...FIB.map((f) => ({ l: f.l, c: f.c, on: true })),
      ...FIB_EXTRA.map((l, i) => ({ l, c: FIB_PALETTE[i % FIB_PALETTE.length], on: false })),
    ],
    trend: true, fill: true, showLevel: true, showPrice: true, ext: 'none', oneColor: null,
  });
  const fibExt = (d) => d.ext || (d.extend ? 'right' : 'none');

  const POINTS = { trend: 2, fib: 2, measure: 2, rect: 2, hline: 1, vline: 1, long: 1, short: 1, icon: 1 };
  const ICONS = [
    { id: 'arrowUp', name: 'Mũi tên lên', glyph: '↑' },
    { id: 'arrowDown', name: 'Mũi tên xuống', glyph: '↓' },
    { id: 'arrowLeft', name: 'Mũi tên trái', glyph: '←' },
    { id: 'arrowRight', name: 'Mũi tên phải', glyph: '→' },
    { id: 'flag', name: 'Cờ', glyph: '⚑' },
    { id: 'star', name: 'Sao', glyph: '★' },
    { id: 'check', name: 'Đúng', glyph: '✓' },
    { id: 'cross', name: 'Sai', glyph: '✕' },
    { id: 'triangleUp', name: 'Tam giác lên', glyph: '▲' },
    { id: 'triangleDown', name: 'Tam giác xuống', glyph: '▼' },
    { id: 'circle', name: 'Tròn', glyph: '●' },
    { id: 'diamond', name: 'Thoi', glyph: '◆' },
  ];
  const ICON_SIZES = [16, 20, 24, 28, 32, 40, 48, 64];
  const iconId = (d) => ICONS.some((ic) => ic.id === d.icon) ? d.icon : 'arrowUp';
  const iconSize = (d) => ICON_SIZES.includes(opt(d, 'size')) ? opt(d, 'size') : 28;
  const POS = {
    width: 1, tpColor: '#26a69a', slColor: '#ef5350', fillOpacity: 22, alwaysStats: false, outcome: true,
  };
  const TEXT = { text: '', textColor: '#d1d4dc', textSize: 12 };
  const TYPE_DEF = {
    trend: { color: '#2962ff', width: 2, style: 'solid', extLeft: false, extend: false, stats: false, ...TEXT },
    hline: { color: '#f0b90b', width: 1, style: 'solid', showPrice: true, ...TEXT },
    vline: { color: '#9598a1', width: 1, style: 'solid', showTime: true, ...TEXT },
    rect: {
      color: '#9c27b0', width: 1, style: 'solid', fill: true, fillColor: '#9c27b0', fillOpacity: 20,
      extLeft: false, extend: false, ...TEXT, textPos: 'top',
    },
    fib: { color: '#787b86', width: 1 },
    long: POS, short: POS,
    icon: { color: '#2962ff', icon: 'arrowUp', size: 28 },
  };
  const DASH = { solid: [], dashed: [8, 5], dotted: [2, 3] };
  const opt = (d, k) => (d[k] !== undefined && d[k] !== null ? d[k] : (TYPE_DEF[d.type] || {})[k]);
  const widthOf = (d) => d.width || (TYPE_DEF[d.type] || {}).width || 1;
  const colorOf = (d) => opt(d, 'color') || '#2962ff';
  const dashOf = (d) => DASH[opt(d, 'style')] || [];

  // Per-type user defaults ("Lưu làm mặc định"); migrates the older width / fib stores.
  const DEF_STORE = 'fxlab_draw_defaults';
  const userDefs = JSON.parse(localStorage.getItem(DEF_STORE) || '{}');
  {
    const oldW = JSON.parse(localStorage.getItem('fxlab_draw_width') || '{}');
    for (const [t, w] of Object.entries(oldW)) userDefs[t] = { width: w, ...(userDefs[t] || {}) };
    const oldFib = JSON.parse(localStorage.getItem('fxlab_fib_default') || 'null');
    if (oldFib && !userDefs.fib?.levels) userDefs.fib = { ...(userDefs.fib || {}), ...oldFib };
    localStorage.removeItem('fxlab_draw_width');
    localStorage.removeItem('fxlab_fib_default');
    localStorage.setItem(DEF_STORE, JSON.stringify(userDefs));
  }
  function setUserDef(types, vals) {
    for (const t of types) userDefs[t] = { ...(userDefs[t] || {}), ...JSON.parse(JSON.stringify(vals)) };
    localStorage.setItem(DEF_STORE, JSON.stringify(userDefs));
    if (window.Account) Account.touch();
  }

  const TOOL_HELP = {
    replay: 'Click lên nến muốn bắt đầu replay (các nến sau đó sẽ bị ẩn).',
    price: 'Click lên chart để lấy giá cho lệnh chờ.',
    trend: 'Trendline: click điểm thứ nhất.',
    hline: 'Click để đặt đường ngang.',
    vline: 'Click để đặt đường dọc.',
    rect: 'Rectangle: click góc thứ nhất, rồi click góc đối diện.',
    fib: 'Fib Retracement: click đầu sóng, rồi click cuối sóng.',
    long: 'Long Position: click tại giá vào lệnh. Kéo mép trên vùng xanh = TP, mép dưới vùng đỏ = SL, đường giữa = Entry, mép phải = độ rộng, kéo trong box = di chuyển.',
    short: 'Short Position: click tại giá vào lệnh. Kéo mép vùng xanh = TP, mép vùng đỏ = SL, đường giữa = Entry, mép phải = độ rộng, kéo trong box = di chuyển.',
    measure: 'Đo: click điểm thứ nhất.',
    icon: 'Icon: click lên chart để đặt biểu tượng. Double-click để đổi loại, màu và cỡ.',
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
  function userText(d, x, y, align = 'left', baseline = 'bottom') {
    const s = opt(d, 'text');
    if (!s) return;
    ctx.font = `${opt(d, 'textSize')}px ${FONT_FAMILY}`;
    ctx.textAlign = align; ctx.textBaseline = baseline;
    ctx.fillStyle = opt(d, 'textColor');
    ctx.fillText(s, x, y);
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
  function drawGlyph(id, x, y, size, color) {
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(size / 2, size / 2);
    ctx.fillStyle = color;
    ctx.strokeStyle = color;
    ctx.lineWidth = 0.22;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    const poly = (pts, fill = true) => {
      ctx.beginPath();
      pts.forEach((p, i) => (i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1])));
      ctx.closePath();
      if (fill) ctx.fill(); else ctx.stroke();
    };
    if (id === 'arrowDown' || id === 'arrowLeft' || id === 'arrowRight' || id === 'triangleDown') {
      ctx.rotate(id === 'arrowDown' || id === 'triangleDown' ? Math.PI : id === 'arrowLeft' ? -Math.PI / 2 : Math.PI / 2);
      id = id.startsWith('triangle') ? 'triangleUp' : 'arrowUp';
    }
    if (id === 'arrowUp') poly([[0, -0.95], [0.62, -0.08], [0.26, -0.08], [0.26, 0.95], [-0.26, 0.95], [-0.26, -0.08], [-0.62, -0.08]]);
    else if (id === 'flag') {
      ctx.fillRect(-0.72, -0.92, 0.16, 1.84);
      poly([[-0.56, -0.92], [0.78, -0.52], [-0.56, -0.12]]);
    } else if (id === 'star') {
      const pts = [];
      for (let i = 0; i < 10; i++) {
        const a = -Math.PI / 2 + i * Math.PI / 5, r = i % 2 ? 0.4 : 0.95;
        pts.push([Math.cos(a) * r, Math.sin(a) * r]);
      }
      poly(pts);
    } else if (id === 'check') {
      ctx.beginPath(); ctx.moveTo(-0.72, 0.02); ctx.lineTo(-0.22, 0.58); ctx.lineTo(0.82, -0.62); ctx.stroke();
    } else if (id === 'cross') {
      ctx.beginPath(); ctx.moveTo(-0.62, -0.62); ctx.lineTo(0.62, 0.62); ctx.moveTo(0.62, -0.62); ctx.lineTo(-0.62, 0.62); ctx.stroke();
    } else if (id === 'triangleUp') poly([[0, -0.9], [0.86, 0.72], [-0.86, 0.72]]);
    else if (id === 'circle') { ctx.beginPath(); ctx.arc(0, 0, 0.78, 0, Math.PI * 2); ctx.fill(); }
    else if (id === 'diamond') poly([[0, -0.92], [0.72, 0], [0, 0.92], [-0.72, 0]]);
    ctx.restore();
  }
  function extended(a, b, pw) {
    if (Math.abs(b.x - a.x) < 1e-6) return b;
    const xt = b.x > a.x ? pw + 10 : -10;
    return { x: xt, y: a.y + ((b.y - a.y) / (b.x - a.x)) * (xt - a.x) };
  }

  // ------------------------------------------------------------ geometry per type
  function trendSeg(d, pw) {
    const a = xy(d.pts[0]), b = xy(d.pts[1]);
    if (!a || !b) return null;
    return { a, b, s: opt(d, 'extLeft') ? extended(b, a, pw) : a, e: opt(d, 'extend') ? extended(a, b, pw) : b };
  }
  function rectGeom(d, pw) {
    const a = xy(d.pts[0]), b = xy(d.pts[1]);
    if (!a || !b) return null;
    return {
      L: opt(d, 'extLeft') ? 0 : Math.min(a.x, b.x), R: opt(d, 'extend') ? pw : Math.max(a.x, b.x),
      T: Math.min(a.y, b.y), B: Math.max(a.y, b.y), a, b,
    };
  }
  function fibLevels(d) {
    const p0 = d.pts[0].p, p1 = d.pts[1].p;
    const src = d.levels || FIB.map((f) => ({ ...f, on: true }));
    return src.filter((L) => L.on && Number.isFinite(L.l))
      .map((L) => { const price = p1 + (p0 - p1) * L.l; return { l: L.l, c: d.oneColor || L.c, price, y: Y(price) }; })
      .sort((a, b) => a.l - b.l);
  }
  function fibSpan(d, a, b, pw) {
    const e = fibExt(d);
    return {
      xl: e === 'left' || e === 'both' ? 0 : Math.min(a.x, b.x),
      xr: e === 'right' || e === 'both' ? pw : Math.max(a.x, b.x),
    };
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
      case 'rect': {
        const xs = d.pts.map((pt) => X(pt.t)), ys = d.pts.map((pt) => Y(pt.p));
        if ([...xs, ...ys].some((v) => v == null)) return [];
        const xm = (xs[0] + xs[1]) / 2, ym = (ys[0] + ys[1]) / 2;
        return [
          { id: 'c00', x: xs[0], y: ys[0] }, { id: 'c11', x: xs[1], y: ys[1] },
          { id: 'c01', x: xs[0], y: ys[1] }, { id: 'c10', x: xs[1], y: ys[0] },
          { id: 'x0', x: xs[0], y: ym }, { id: 'x1', x: xs[1], y: ym },
          { id: 'y0', x: xm, y: ys[0] }, { id: 'y1', x: xm, y: ys[1] },
        ];
      }
      case 'long': case 'short': {
        const g = posGeom(d);
        if (!g) return [];
        return [{ id: 'tp', x: g.L, y: g.yt }, { id: 'sl', x: g.L, y: g.ys }, { id: 'entry', x: g.L, y: g.ye }, { id: 'width', x: g.R, y: g.ye }];
      }
      case 'icon': { const q = xy(d.pts[0]); return q ? [{ id: 0, x: q.x, y: q.y }] : []; }
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
        const g = trendSeg(d, pw);
        return !!g && distSeg(x, y, g.s, g.e) <= HIT;
      }
      case 'hline': { const yy = Y(d.pts[0].p); return yy != null && Math.abs(y - yy) <= HIT && x <= pw; }
      case 'vline': { const xx = X(d.pts[0].t); return xx != null && Math.abs(x - xx) <= HIT && y <= ph; }
      case 'rect': {
        const g = rectGeom(d, pw);
        return !!g && x >= g.L - HIT && x <= g.R + HIT && y >= g.T - HIT && y <= g.B + HIT;
      }
      case 'fib': {
        const a = xy(d.pts[0]), b = xy(d.pts[1]);
        if (!a || !b) return false;
        const { xl, xr } = fibSpan(d, a, b, pw);
        if (distSeg(x, y, a, b) <= HIT) return true;
        return x >= xl - HIT && x <= xr + HIT && fibLevels(d).some((L) => L.y != null && Math.abs(y - L.y) <= HIT);
      }
      case 'long': case 'short': {
        const g = posGeom(d);
        return !!g && x >= g.L && x <= g.R && y >= Math.min(g.yt, g.ys) && y <= Math.max(g.yt, g.ys);
      }
      case 'icon': {
        const q = xy(d.pts[0]);
        if (!q) return false;
        const s = iconSize(d) / 2 + 4;
        return Math.abs(x - q.x) <= s && Math.abs(y - q.y) <= s;
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
  const shapeActive = (d) => d === sel || d === pending || d === measure || (drag && drag.d === d) || (hover && hover.d === d);

  function drawShape(d, pw, ph) {
    const active = shapeActive(d);
    const col = colorOf(d);
    switch (d.type) {
      case 'trend': {
        const g = trendSeg(d, pw);
        if (!g) return;
        line(g.s.x, g.s.y, g.e.x, g.e.y, col, widthOf(d), dashOf(d));
        if (opt(d, 'stats')) {
          const pips = (d.pts[1].p - d.pts[0].p) / S.pip, pct = ((d.pts[1].p - d.pts[0].p) / d.pts[0].p) * 100;
          const nb = Math.round(timeToLogical(d.pts[1].t) - timeToLogical(d.pts[0].t));
          label(`${sign(pips)} pip (${sign(pct, 2)}%) · ${nb} nến`, g.b.x + 8, g.b.y + 14, '#fff', 'left', '#1e222dcc');
        }
        userText(d, (g.a.x + g.b.x) / 2, (g.a.y + g.b.y) / 2 - 6, 'center');
        if (active) { handle(g.a.x, g.a.y, col); handle(g.b.x, g.b.y, col); }
        break;
      }
      case 'hline': {
        const y = Y(d.pts[0].p);
        if (y == null) return;
        line(0, y, pw, y, col, widthOf(d), dashOf(d));
        userText(d, 8, y - 4);
        if (active) handle(pw / 2, y, col);
        break;
      }
      case 'vline': {
        const x = X(d.pts[0].t);
        if (x == null) return;
        line(x, 0, x, ph, col, widthOf(d), dashOf(d));
        userText(d, x + 6, 8, 'left', 'top');
        if (active) handle(x, ph / 2, col);
        break;
      }
      case 'rect': {
        const g = rectGeom(d, pw);
        if (!g) return;
        if (opt(d, 'fill')) {
          ctx.fillStyle = hexA(opt(d, 'fillColor'), opt(d, 'fillOpacity') / 100);
          ctx.fillRect(g.L, g.T, g.R - g.L, g.B - g.T);
        }
        ctx.strokeStyle = col; ctx.lineWidth = widthOf(d); ctx.setLineDash(dashOf(d));
        ctx.strokeRect(g.L, g.T, g.R - g.L, g.B - g.T);
        ctx.setLineDash([]);
        const pos = opt(d, 'textPos'), cx = (g.L + g.R) / 2;
        if (pos === 'middle') userText(d, cx, (g.T + g.B) / 2, 'center', 'middle');
        else if (pos === 'bottom') userText(d, cx, g.B - 4, 'center', 'bottom');
        else userText(d, cx, g.T + 4, 'center', 'top');
        if (active) for (const h of handles(d)) handle(h.x, h.y, col);
        break;
      }
      case 'fib': {
        const a = xy(d.pts[0]), b = xy(d.pts[1]);
        if (!a || !b) return;
        const { xl, xr } = fibSpan(d, a, b, pw);
        const lv = fibLevels(d);
        if (d.fill !== false) {
          for (let k = 0; k < lv.length - 1; k++) {
            const A = lv[k], B = lv[k + 1];
            if (A.y == null || B.y == null) continue;
            ctx.fillStyle = hexA(B.c, 0.1);
            ctx.fillRect(xl, Math.min(A.y, B.y), xr - xl, Math.abs(B.y - A.y));
          }
        }
        const showL = d.showLevel !== false, showP = d.showPrice !== false;
        for (const L of lv) {
          if (L.y == null) continue;
          line(xl, L.y, xr, L.y, L.c, widthOf(d));
          const txt = showL && showP ? `${L.l} (${fmtPrice(L.price)})` : showL ? `${L.l}` : showP ? fmtPrice(L.price) : '';
          if (txt) label(txt, Math.max(xl, 0) + 4, L.y - 8, L.c);
        }
        if (d.trend !== false) line(a.x, a.y, b.x, b.y, col, 1, [4, 4]);
        if (active) { handle(a.x, a.y, col); handle(b.x, b.y, col); }
        break;
      }
      case 'long': case 'short': {
        const g = posGeom(d);
        if (!g) return;
        const st = posStats(d);
        const tpC = opt(d, 'tpColor'), slC = opt(d, 'slColor'), alpha = opt(d, 'fillOpacity') / 100;
        ctx.fillStyle = hexA(tpC, alpha);
        ctx.fillRect(g.L, Math.min(g.ye, g.yt), g.R - g.L, Math.abs(g.yt - g.ye));
        ctx.fillStyle = hexA(slC, alpha);
        ctx.fillRect(g.L, Math.min(g.ye, g.ys), g.R - g.L, Math.abs(g.ys - g.ye));
        line(g.L, g.ye, g.R, g.ye, '#9598a1', widthOf(d));
        const out = opt(d, 'outcome') ? posOutcome(d) : null;
        if (out) {
          const xh = ts().logicalToCoordinate(out.i), yh = Y(out.price);
          if (xh != null && yh != null) {
            line(g.L, g.ye, xh, yh, out.kind === 'sl' ? slC : out.kind === 'tp' ? tpC : '#d1d4dc', 1, [4, 3]);
          }
        }
        const cx = (g.L + g.R) / 2, up = (a, b) => (a < b ? -1 : 1);
        if (active || opt(d, 'alwaysStats')) {
          const pctT = Math.abs(d.tp - st.e) / st.e * 100, pctS = Math.abs(st.e - d.sl) / st.e * 100;
          label(`Target: ${st.tpPips.toFixed(1)} pip (${pctT.toFixed(2)}%) · ${money(st.reward)}`, cx, g.yt + 12 * up(g.yt, g.ye), '#fff', 'center', tpC);
          label(`Stop: ${st.slPips.toFixed(1)} pip (${pctS.toFixed(2)}%) · ${money(st.risk)}`, cx, g.ys + 12 * up(g.ys, g.ye), '#fff', 'center', slC);
          label(`${d.type === 'long' ? 'Long' : 'Short'} · R:R ${st.rr.toFixed(2)} · ${st.lots.toFixed(2)} lot`, cx, g.ye, '#fff', 'center', '#2a2e39');
        } else {
          label(`R:R ${st.rr.toFixed(2)}`, cx, g.ye, '#d1d4dc', 'center', '#1e222dcc');
        }
        if (active) for (const h of handles(d)) handle(h.x, h.y, h.id === 'tp' ? tpC : h.id === 'sl' ? slC : '#d1d4dc');
        break;
      }
      case 'icon': {
        const q = xy(d.pts[0]);
        if (!q) return;
        const size = iconSize(d);
        drawGlyph(iconId(d), q.x, q.y, size, col);
        if (active) {
          ctx.strokeStyle = col; ctx.lineWidth = 1; ctx.setLineDash([3, 3]);
          ctx.strokeRect(q.x - size / 2 - 4, q.y - size / 2 - 4, size + 8, size + 8);
          ctx.setLineDash([]);
          handle(q.x, q.y, col);
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
    const col = colorOf(d);
    if (d.type === 'hline') { if (opt(d, 'showPrice')) priceTag(d.pts[0].p, col, pw); return; }
    if (d.type === 'vline') { if (opt(d, 'showTime')) timeTag(d.pts[0].t, col, pw, ph); return; }
    if (!shapeActive(d)) return;
    if (d.type === 'long' || d.type === 'short') {
      priceTag(d.tp, opt(d, 'tpColor'), pw); priceTag(d.sl, opt(d, 'slColor'), pw); priceTag(d.pts[0].p, '#2a2e39', pw);
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
      Y(ref), Y(ref * 1.01), S.end, S.tf, S.tz, window.devicePixelRatio].join('|');
    if (sig === lastSig && !isDirty) return;
    lastSig = sig; isDirty = false;
    paint();
  }
  requestAnimationFrame(frame);

  // ------------------------------------------------------------ editing
  function dirty() { isDirty = true; }

  function newDrawing(type, pts) {
    const d = { id: S.drawSeq++, type, pts };
    if (type === 'fib') Object.assign(d, fibFactory());
    Object.assign(d, JSON.parse(JSON.stringify(userDefs[type] || {})));
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

  const widthSelect = (attr, w) =>
    `<select ${attr}>${[1, 2, 3, 4].map((n) => `<option value="${n}"${n === w ? ' selected' : ''}>${n}px</option>`).join('')}</select>`;

  function renderProps() {
    const box = $('draw-props');
    if (!sel) { box.classList.add('hidden'); box.innerHTML = ''; return; }
    const d = sel, parts = [];
    if (d.type !== 'long' && d.type !== 'short') {
      parts.push(`<input type="color" class="sw" data-a="color" value="${colorOf(d)}" title="Màu">`);
    }
    if (d.type === 'icon') {
      const sz = iconSize(d);
      parts.push(`<select data-a="size" title="Cỡ">${ICON_SIZES.map((n) => `<option value="${n}"${n === sz ? ' selected' : ''}>${n}</option>`).join('')}</select>`);
    } else {
      parts.push(widthSelect('data-a="width" title="Độ dày"', widthOf(d)));
    }
    if (d.type === 'trend') {
      parts.push(`<button data-a="extend" class="${opt(d, 'extend') ? 'active' : ''}" title="Kéo dài sang phải">Kéo dài →</button>`);
    }
    parts.push('<button data-a="settings" title="Cài đặt (hoặc double-click vào hình vẽ)">⚙ Cài đặt</button>');
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
      setUserDef(sel.type === 'long' || sel.type === 'short' ? ['long', 'short'] : [sel.type], { width: sel.width });
      e.target.blur();
      dirty(); save();
    } else if (e.target.dataset.a === 'size' && sel) {
      sel.size = +e.target.value;
      setUserDef([sel.type], { size: sel.size });
      e.target.blur();
      dirty(); save();
    }
  });
  $('draw-props').addEventListener('click', (e) => {
    const a = e.target.closest('[data-a]')?.dataset.a;
    if (!a || !sel) return;
    if (a === 'extend') { sel.extend = !opt(sel, 'extend'); renderProps(); save(); }
    else if (a === 'settings') openSettings(sel);
    else if (a === 'delete') api.removeSelected();
    else if (a === 'flip') {
      const e0 = sel.pts[0].p;
      sel.type = sel.type === 'long' ? 'short' : 'long';
      [sel.tp, sel.sl] = [round(2 * e0 - sel.tp), round(2 * e0 - sel.sl)];
      save();
    } else if (a === 'pending' || a === 'market') placeFromBox(sel, a === 'market');
    dirty();
  });

  // ------------------------------------------------------------ settings dialogs
  const NAMES = { trend: 'Trendline', hline: 'Đường ngang', vline: 'Đường dọc', rect: 'Rectangle', long: 'Long Position', short: 'Short Position', icon: 'Icon' };
  const F = {
    color: ['color', 'color', 'Màu'],
    width: ['width', 'width', 'Độ dày'],
    style: ['style', 'style', 'Kiểu nét'],
    text: ['text', 'text', 'Nội dung'],
    textColor: ['textColor', 'color', 'Màu chữ'],
    textSize: ['textSize', 'size', 'Cỡ chữ'],
    extLeft: ['extLeft', 'bool', 'Kéo dài sang trái'],
    extend: ['extend', 'bool', 'Kéo dài sang phải'],
  };
  const POS_SPEC = [
    ['Kiểu', [['tpColor', 'color', 'Màu vùng TP'], ['slColor', 'color', 'Màu vùng SL'], ['fillOpacity', 'pct', 'Độ đậm vùng (%)'],
      ['width', 'width', 'Độ dày đường Entry'], ['alwaysStats', 'bool', 'Luôn hiện đầy đủ thông số'], ['outcome', 'bool', 'Hiện đường kết quả (chạm TP/SL)']]],
    ['Tọa độ', 'pos'],
  ];
  const SPEC = {
    trend: [['Kiểu', [F.color, F.width, F.style, F.extLeft, F.extend, ['stats', 'bool', 'Hiện thống kê (pip, %, số nến)']]],
      ['Chữ', [F.text, F.textColor, F.textSize]], ['Tọa độ', 'pts']],
    hline: [['Kiểu', [F.color, F.width, F.style, ['showPrice', 'bool', 'Hiện nhãn giá trên trục']]],
      ['Chữ', [F.text, F.textColor, F.textSize]], ['Tọa độ', 'pts']],
    vline: [['Kiểu', [F.color, F.width, F.style, ['showTime', 'bool', 'Hiện nhãn thời gian trên trục']]],
      ['Chữ', [F.text, F.textColor, F.textSize]]],
    rect: [['Kiểu', [['color', 'color', 'Màu viền'], F.width, F.style, ['fill', 'bool', 'Tô nền'], ['fillColor', 'color', 'Màu nền'],
      ['fillOpacity', 'pct', 'Độ đậm nền (%)'], F.extLeft, F.extend]],
    ['Chữ', [F.text, F.textColor, F.textSize, ['textPos', 'select', 'Vị trí chữ', { top: 'Trên', middle: 'Giữa', bottom: 'Dưới' }]]],
    ['Tọa độ', 'pts']],
    long: POS_SPEC, short: POS_SPEC,
    icon: [['Biểu tượng', 'icons'], ['Kiểu', [['color', 'color', 'Màu'], ['size', 'px', 'Cỡ', ICON_SIZES]]]],
  };
  const STYLE_NAMES = { solid: 'Liền', dashed: 'Nét đứt', dotted: 'Chấm' };
  const SIZES = [10, 11, 12, 14, 16, 20, 24, 28];

  function control([k, type, , extra], v) {
    const opts = (o, cur) => Object.entries(o).map(([val, txt]) => `<option value="${val}"${String(val) === String(cur) ? ' selected' : ''}>${txt}</option>`).join('');
    switch (type) {
      case 'color': return `<input type="color" class="sw" data-k="${k}" value="${v}">`;
      case 'width': return widthSelect(`data-k="${k}"`, v);
      case 'style': return `<select data-k="${k}">${opts(STYLE_NAMES, v)}</select>`;
      case 'size': return `<select data-k="${k}">${opts(Object.fromEntries(SIZES.map((n) => [n, n + 'px'])), v)}</select>`;
      case 'px': return `<select data-k="${k}">${opts(Object.fromEntries((extra || SIZES).map((n) => [n, n + 'px'])), v)}</select>`;
      case 'select': return `<select data-k="${k}">${opts(extra, v)}</select>`;
      case 'bool': return `<input type="checkbox" data-k="${k}"${v ? ' checked' : ''}>`;
      case 'pct': return `<input type="number" min="0" max="100" step="5" data-k="${k}" value="${v}">`;
      default: return `<input type="text" data-k="${k}" value="${esc(v || '')}" placeholder="(không có)">`;
    }
  }
  function iconPicker(cur) {
    const id = ICONS.some((ic) => ic.id === cur) ? cur : 'arrowUp';
    const btns = ICONS.map((ic) => `<button type="button" data-icon="${ic.id}" class="${ic.id === id ? 'active' : ''}" title="${ic.name}">${ic.glyph}</button>`).join('');
    return `<div class="icon-pick">${btns}<input type="hidden" data-k="icon" value="${id}"></div>`;
  }
  function coordRows(d, kind) {
    const step = S.pip / 10;
    const row = (k, txt, v) => `<label>${txt}</label><input type="number" step="${step}" data-c="${k}" value="${fmtPrice(v)}">`;
    if (kind === 'pos') return row('entry', 'Giá Entry', d.pts[0].p) + row('tp', 'Giá TP', d.tp) + row('sl', 'Giá SL', d.sl);
    if (d.pts.length === 1) return row('p0', 'Giá', d.pts[0].p);
    return row('p0', 'Giá điểm 1', d.pts[0].p) + row('p1', 'Giá điểm 2', d.pts[1].p);
  }
  function readStyle(body) {
    const v = {};
    body.querySelectorAll('[data-k]').forEach((el) => {
      const k = el.dataset.k;
      if (el.type === 'checkbox') v[k] = el.checked;
      else if (el.tagName === 'SELECT' && /^\d+$/.test(el.value)) v[k] = +el.value;
      else if (el.type === 'number') v[k] = Math.max(0, Math.min(100, +el.value || 0));
      else v[k] = el.value;
    });
    return v;
  }
  function applyCoords(d, body) {
    const c = {};
    body.querySelectorAll('[data-c]').forEach((el) => { c[el.dataset.c] = parseFloat(el.value); });
    if (Object.values(c).some((x) => !Number.isFinite(x))) return 'Giá không hợp lệ.';
    if (c.entry != null) {
      const long = d.type === 'long';
      if (long ? !(c.sl < c.entry && c.entry < c.tp) : !(c.tp < c.entry && c.entry < c.sl)) {
        return long ? 'Long cần SL < Entry < TP.' : 'Short cần TP < Entry < SL.';
      }
      d.pts = [{ t: d.pts[0].t, p: round(c.entry) }, { t: d.pts[1].t, p: round(c.entry) }];
      d.tp = round(c.tp); d.sl = round(c.sl);
      return null;
    }
    d.pts = d.pts.map((pt, i) => (c['p' + i] != null ? { t: pt.t, p: round(c['p' + i]) } : pt));
    return null;
  }

  function openSettings(d) {
    if (d.type === 'fib') { openFibSettings(d); return; }
    const spec = SPEC[d.type];
    if (!spec) return;
    const render = (vals) => {
      const html = spec.map(([title, fields]) => `<div class="ind-group">${title}</div>` + (typeof fields === 'string'
        ? (fields === 'icons' ? iconPicker(vals.icon) : coordRows(d, fields))
        : fields.map((f) => `<label>${f[2]}</label>${control(f, vals[f[0]])}`).join(''))).join('');
      openModal(`${NAMES[d.type]} · Cài đặt`, `<div class="ind-form">${html}</div>
        <div class="modal-actions">
          <button id="ds-factory" title="Trả về kiểu gốc">Khôi phục gốc</button>
          <button id="ds-save-def" title="Các hình vẽ loại này vẽ sau sẽ dùng kiểu này">Lưu làm mặc định</button>
          <span style="flex:1"></span>
          <button id="ds-cancel">Hủy</button><button id="ds-ok" class="active">OK</button>
        </div>`);
      const body = $('modal-body');
      $('ds-cancel').onclick = closeModal;
      body.querySelectorAll('[data-icon]').forEach((btn) => {
        btn.onclick = () => {
          const hid = body.querySelector('[data-k="icon"]');
          if (hid) hid.value = btn.dataset.icon;
          body.querySelectorAll('[data-icon]').forEach((b) => b.classList.toggle('active', b === btn));
        };
      });
      $('ds-factory').onclick = () => render({ ...TYPE_DEF[d.type], text: readStyle(body).text });
      $('ds-save-def').onclick = () => {
        const { text, ...style } = readStyle(body);
        setUserDef(d.type === 'long' || d.type === 'short' ? ['long', 'short'] : [d.type], style);
        setStatus(`Đã lưu làm mặc định cho ${NAMES[d.type]}.`);
      };
      $('ds-ok').onclick = () => {
        const err = applyCoords(d, body);
        if (err) { setStatus(err, true); return; }
        Object.assign(d, readStyle(body));
        closeModal();
        renderProps(); dirty(); save();
      };
    };
    const vals = {};
    for (const [, fields] of spec) if (Array.isArray(fields)) for (const [k] of fields) vals[k] = k === 'width' ? widthOf(d) : opt(d, k);
    if (d.type === 'icon') vals.icon = iconId(d);
    render(vals);
  }

  function fibForm(o, col, width) {
    const EXT = { none: 'Không kéo dài', right: 'Sang phải', left: 'Sang trái', both: 'Hai phía' };
    const chk = (k, v, text) => `<label class="fib-chk"><input type="checkbox" data-f="${k}"${v ? ' checked' : ''}> ${text}</label>`;
    const levels = o.levels.map((L, i) =>
      `<div class="fib-lv"><input type="checkbox" data-lon="${i}"${L.on ? ' checked' : ''}>` +
      `<input type="number" step="0.001" data-lv="${i}" value="${L.l}">` +
      `<input type="color" class="sw" data-lc="${i}" value="${L.c}"></div>`).join('');
    return `<div class="fib-form">
      <div class="fib-opts">
        <div>${chk('trend', o.trend, 'Đường xu hướng')} <input type="color" class="sw" data-f="color" value="${col}"></div>
        <div><label>Độ dày mức</label> ${widthSelect('data-f="width"', width)}</div>
        <div><label>Kéo dài</label> <select data-f="ext">${Object.entries(EXT).map(([k, v]) => `<option value="${k}"${k === o.ext ? ' selected' : ''}>${v}</option>`).join('')}</select></div>
        <div>${chk('fill', o.fill, 'Tô nền')}</div>
        <div>${chk('showLevel', o.showLevel, 'Hiện mức')} ${chk('showPrice', o.showPrice, 'Hiện giá')}</div>
        <div>${chk('useOne', !!o.oneColor, 'Dùng một màu')} <input type="color" class="sw" data-f="oneColor" value="${o.oneColor || '#2962ff'}"></div>
      </div>
      <div class="fib-levels">${levels}</div>
      <div class="modal-actions">
        <button id="fib-factory" title="Trả về bộ mức gốc">Khôi phục gốc</button>
        <button id="fib-save-def" title="Các Fib vẽ sau sẽ dùng thông số này">Lưu làm mặc định</button>
        <span style="flex:1"></span>
        <button id="fib-cancel">Hủy</button><button id="fib-ok" class="active">OK</button>
      </div></div>`;
  }
  function readFibForm(body) {
    const f = (k) => body.querySelector(`[data-f="${k}"]`);
    return {
      levels: [...body.querySelectorAll('[data-lv]')].map((el) => {
        const i = el.dataset.lv;
        return { l: parseFloat(el.value), c: body.querySelector(`[data-lc="${i}"]`).value, on: body.querySelector(`[data-lon="${i}"]`).checked };
      }).filter((L) => Number.isFinite(L.l)),
      trend: f('trend').checked, fill: f('fill').checked, showLevel: f('showLevel').checked, showPrice: f('showPrice').checked,
      ext: f('ext').value, oneColor: f('useOne').checked ? f('oneColor').value : null,
      color: f('color').value, width: +f('width').value,
    };
  }
  function openFibSettings(d) {
    const cur = d.levels ? d : { ...fibFactory(), ext: fibExt(d) };
    const o = JSON.parse(JSON.stringify({
      levels: cur.levels, trend: cur.trend !== false, fill: cur.fill !== false,
      showLevel: cur.showLevel !== false, showPrice: cur.showPrice !== false, ext: fibExt(cur), oneColor: cur.oneColor || null,
    }));
    const render = (opts, col, width) => {
      openModal('Fib Retracement · Cài đặt', fibForm(opts, col, width));
      const body = $('modal-body');
      $('fib-cancel').onclick = closeModal;
      $('fib-factory').onclick = () => { const v = readFibForm(body); render(fibFactory(), v.color, v.width); };
      $('fib-save-def').onclick = () => {
        setUserDef(['fib'], readFibForm(body));
        setStatus('Đã lưu làm mặc định cho Fib vẽ sau.');
      };
      $('fib-ok').onclick = () => {
        Object.assign(d, readFibForm(body));
        delete d.extend;
        closeModal();
        renderProps(); dirty(); save();
      };
    };
    render(o, colorOf(d), widthOf(d));
  }

  // ------------------------------------------------------------ dragging
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
    if (d.type === 'rect') {
      const h = String(drag.h), setT = (i) => { d.pts[i] = { t: pt.t, p: d.pts[i].p }; }, setP = (j) => { d.pts[j] = { t: d.pts[j].t, p: pt.p }; };
      if (h[0] === 'c') { setT(+h[1]); setP(+h[2]); } else if (h[0] === 'x') setT(+h[1]); else if (h[0] === 'y') setP(+h[1]);
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
        setStatus(tool === 'rect' ? 'Click góc đối diện.' : 'Click điểm thứ hai.');
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
    } else if (tool === 'hline' || tool === 'vline' || tool === 'icon') {
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
    // preventDefault below keeps focus on the last input/select, which would swallow Delete / arrow keys.
    if (document.activeElement && document.activeElement !== document.body) document.activeElement.blur();
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
    if (id === 'tp' || id === 'sl' || id === 'entryP' || id === 'y0' || id === 'y1') return 'ns';
    if (id === 'width' || id === 'x0' || id === 'x1') return 'ew';
    return 'handle';
  }
  function setCursor(kind) {
    for (const k of ['draw', 'move', 'handle', 'ns', 'ew']) wrap.classList.toggle('cur-' + k, k === kind);
  }

  wrap.addEventListener('dblclick', (e) => {
    const { x, y } = local(e);
    const hit = !S.tool && x <= paneW() && y <= paneH() ? hitTest(x, y) : null;
    if (!hit) return;
    e.preventDefault(); e.stopPropagation();
    select(hit.d);
    openSettings(hit.d);
  }, true);

  wrap.addEventListener('contextmenu', (e) => {
    const { x, y } = local(e);
    const hit = !S.tool && x <= paneW() && y <= paneH() ? hitTest(x, y) : null;
    if (!hit) return;
    e.preventDefault();
    select(hit.d);
  });

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
