// Port of the Pine Script "Kim - Sessions + EMA + Engulfing".
// Not ported (all off by default in the original): session trendline / mean / VWAP / max-min, sessions divider, dashboard.
// TradingView alertcondition() has no equivalent here; the engulfing signal is shown by the candle colour.

const KIM_SESSIONS = [
  { k: 'A', name: 'New York', time: '1900-2130', color: '#ff5d00' },
  { k: 'B', name: 'London', time: '1330-1600', color: '#2157f3' },
  { k: 'C', name: 'Tokyo', time: '0800-1100', color: '#e91e63' },
  { k: 'D', name: 'Sydney', time: '2100-0600', color: '#ffeb3b' },
];
const KIM_DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

FX.indicator({
  id: 'kim_sessions_ema_engulfing',
  name: 'Kim - Sessions + EMA + Engulfing',
  shortName: () => 'Kim - Sessions + EMA + Engulfing',
  description: 'EMA 50/100/200, tô màu nến Engulfing, vùng phiên NY/London/Tokyo/Sydney, chia ngày, 2 Keltner Channel',
  pane: 'main',
  params: [
    { group: 'EMA', id: 'ema1', label: 'EMA 1', type: 'number', default: 50, min: 1 },
    { group: 'EMA', id: 'ema2', label: 'EMA 2', type: 'number', default: 100, min: 1 },
    { group: 'EMA', id: 'ema3', label: 'EMA 3', type: 'number', default: 200, min: 1 },

    { group: 'Engulfing', id: 'engulf', label: 'Tô màu nến Engulfing', type: 'bool', default: true },
    { group: 'Engulfing', id: 'bullColor', label: 'Màu Bullish', type: 'color', default: '#ffeb3b' },
    { group: 'Engulfing', id: 'bearColor', label: 'Màu Bearish', type: 'color', default: '#ffffff' },

    ...KIM_SESSIONS.flatMap((s) => [
      { group: `Session ${s.k}`, id: `show${s.k}`, label: 'Hiện', type: 'bool', default: true },
      { group: `Session ${s.k}`, id: `name${s.k}`, label: 'Tên', type: 'text', default: s.name },
      { group: `Session ${s.k}`, id: `time${s.k}`, label: 'Giờ (HHMM-HHMM)', type: 'text', default: s.time },
      { group: `Session ${s.k}`, id: `color${s.k}`, label: 'Màu', type: 'color', default: s.color },
    ]),

    { group: 'Phiên & chia ngày', id: 'tz', label: 'Múi giờ UTC (+/-)', type: 'number', default: 7, min: -12, max: 14, step: 0.5 },
    { group: 'Phiên & chia ngày', id: 'transp', label: 'Độ trong suốt vùng (%)', type: 'number', default: 90, min: 0, max: 100 },
    { group: 'Phiên & chia ngày', id: 'outline', label: 'Viền vùng', type: 'bool', default: true },
    { group: 'Phiên & chia ngày', id: 'labels', label: 'Tên phiên', type: 'bool', default: true },
    { group: 'Phiên & chia ngày', id: 'dayDiv', label: 'Đường chia ngày', type: 'bool', default: true },

    { group: 'Keltner Channel 1', id: 'kc1Show', label: 'Hiện', type: 'bool', default: true },
    { group: 'Keltner Channel 1', id: 'kc1Len', label: 'Chu kỳ', type: 'number', default: 20, min: 1 },
    { group: 'Keltner Channel 1', id: 'kc1Mult', label: 'Hệ số', type: 'number', default: 2, min: 0.1, step: 0.1 },
    { group: 'Keltner Channel 1', id: 'kc1Fill', label: 'Màu nền', type: 'color', default: '#2962ff' },

    { group: 'Keltner Channel 2', id: 'kc2Show', label: 'Hiện', type: 'bool', default: true },
    { group: 'Keltner Channel 2', id: 'kc2Len', label: 'Chu kỳ', type: 'number', default: 50, min: 1 },
    { group: 'Keltner Channel 2', id: 'kc2Mult', label: 'Hệ số', type: 'number', default: 3, min: 0.1, step: 0.1 },
    { group: 'Keltner Channel 2', id: 'kc2Fill', label: 'Màu nền', type: 'color', default: '#ff9800' },

    { group: 'Keltner - chung', id: 'src', label: 'Nguồn', type: 'source', default: 'close' },
    { group: 'Keltner - chung', id: 'exp', label: 'Dùng EMA (tắt = SMA)', type: 'bool', default: true },
    { group: 'Keltner - chung', id: 'bands', label: 'Kiểu dải', type: 'select', default: 'Average True Range',
      options: ['Average True Range', 'True Range', 'Range'] },
    { group: 'Keltner - chung', id: 'atrLen', label: 'Chu kỳ ATR', type: 'number', default: 10, min: 1 },
  ],
  plots: [
    { id: 'ema1', title: 'EMA 1', color: '#4caf50', lineWidth: 2 },
    { id: 'ema2', title: 'EMA 2', color: '#d016f5', lineWidth: 2 },
    { id: 'ema3', title: 'EMA 3', color: '#ffffff', lineWidth: 2 },
    { id: 'kc1u', title: 'KC1 Upper', color: '#2962ff', legend: false },
    { id: 'kc1b', title: 'KC1 Basis', color: '#2962ff', legend: false },
    { id: 'kc1l', title: 'KC1 Lower', color: '#2962ff', legend: false },
    { id: 'kc2u', title: 'KC2 Upper', color: '#ff9800', legend: false },
    { id: 'kc2b', title: 'KC2 Basis', color: '#ff9800', legend: false },
    { id: 'kc2l', title: 'KC2 Lower', color: '#ff9800', legend: false },
  ],

  compute(bars, p, ta) {
    const n = bars.length, close = ta.src(bars, 'close');
    const out = { ema1: ta.ema(close, p.ema1), ema2: ta.ema(close, p.ema2), ema3: ta.ema(close, p.ema3) };

    const barColor = new Array(n).fill(null);
    if (p.engulf) {
      for (let i = 3; i < n; i++) {
        const b = bars[i], b1 = bars[i - 1], b2 = bars[i - 2], b3 = bars[i - 3];
        const bull = b3.open > b3.close && b2.open > b2.close && b1.open > b1.close && b.close > b.open &&
          b.close >= b1.open && b1.close >= b.open && b.close - b.open > b1.open - b1.close;
        const bear = b3.open < b3.close && b2.open < b2.close && b1.close > b1.open && b.open > b.close &&
          b.open >= b1.close && b1.open >= b.close && b.open - b.close > b1.close - b1.open;
        if (bear) barColor[i] = p.bearColor;
        else if (bull) barColor[i] = p.bullColor;
      }
    }
    out.barColor = barColor;

    const src = ta.src(bars, p.src);
    const empty = new Array(n).fill(null);
    const kc = (show, len, mult) => {
      if (!show) return [empty, empty, empty];
      const ma = p.exp ? ta.ema(src, len) : ta.sma(src, len);
      const rng = p.bands === 'True Range' ? ta.tr(bars)
        : p.bands === 'Average True Range' ? ta.atr(bars, p.atrLen)
          : ta.rma(bars.map((b) => b.high - b.low), len);
      const dev = ta.mul(rng, mult);
      return [ta.add(ma, dev), ma, ta.sub(ma, dev)];
    };
    [out.kc1u, out.kc1b, out.kc1l] = kc(p.kc1Show, p.kc1Len, p.kc1Mult);
    [out.kc2u, out.kc2b, out.kc2l] = kc(p.kc2Show, p.kc2Len, p.kc2Mult);
    return out;
  },

  // Session boxes use only bars < h.end, so a session still forming in replay never shows future highs/lows.
  draw(ctx, h) {
    const p = h.params, r = h.res;
    if (p.kc1Show) h.fillBetween(r.kc1u, r.kc1l, h.hexA(p.kc1Fill, 0.1));
    if (p.kc2Show) h.fillBetween(r.kc2u, r.kc2l, h.hexA(p.kc2Fill, 0.15));
    if (h.tfSec >= 86400) return;

    const off = p.tz * 3600;
    const minuteOf = (utc) => Math.floor(((((utc + off) % 86400) + 86400) % 86400) / 60);
    const dayOf = (utc) => Math.floor((utc + off) / 86400);
    const gap = Math.max(2 * h.tfSec, 6 * 3600);

    for (const s of KIM_SESSIONS) {
      if (!p[`show${s.k}`]) continue;
      const m = /^(\d{2})(\d{2})-(\d{2})(\d{2})$/.exec(p[`time${s.k}`] || '');
      if (!m) continue;
      const a = +m[1] * 60 + +m[2], b = +m[3] * 60 + +m[4];
      const inS = (utc) => { const mm = minuteOf(utc); return a < b ? mm >= a && mm < b : mm >= a || mm < b; };
      const color = p[`color${s.k}`], name = p[`name${s.k}`];

      const box = (i0, i1) => {
        let hi = -Infinity, lo = Infinity;
        for (let i = i0; i <= i1; i++) { hi = Math.max(hi, h.bars[i].high); lo = Math.min(lo, h.bars[i].low); }
        const x1 = h.x(i0), x2 = h.x(i1), y1 = h.y(hi), y2 = h.y(lo);
        if (x1 == null || x2 == null || y1 == null || y2 == null || x2 < 0 || x1 > h.width) return;
        ctx.fillStyle = h.hexA(color, 1 - p.transp / 100);
        ctx.fillRect(x1, y1, Math.max(1, x2 - x1), y2 - y1);
        if (p.outline) {
          ctx.strokeStyle = color; ctx.lineWidth = 1; ctx.setLineDash([2, 2]);
          ctx.strokeRect(x1, y1, Math.max(1, x2 - x1), y2 - y1);
          ctx.setLineDash([]);
        }
        if (p.labels) h.text(name, (x1 + x2) / 2, y1 - 3, color, 'center', 'bottom', '10px -apple-system, "Segoe UI", Roboto, Arial, sans-serif');
      };

      let g0 = -1;
      for (let i = Math.max(0, h.from - 600); i < h.end; i++) {
        if (i > h.to && g0 < 0) break;
        const on = inS(h.t[i]);
        if (g0 >= 0 && (!on || h.t[i] - h.t[i - 1] > gap)) { box(g0, i - 1); g0 = -1; }
        if (on && g0 < 0) g0 = i;
      }
      if (g0 >= 0) box(g0, h.end - 1);
    }

    if (p.dayDiv) {
      ctx.strokeStyle = '#787b86'; ctx.lineWidth = 1;
      for (let i = Math.max(1, h.from); i <= h.to; i++) {
        if (dayOf(h.t[i]) === dayOf(h.t[i - 1])) continue;
        const x = h.x(i);
        if (x == null) continue;
        ctx.setLineDash([4, 4]);
        ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h.height); ctx.stroke();
        ctx.setLineDash([]);
        h.text(KIM_DAYS[new Date((h.t[i] + off) * 1000).getUTCDay()], x, 24, '#787b86', 'center', 'top', '10px -apple-system, "Segoe UI", Roboto, Arial, sans-serif');
      }
    }
  },
});
