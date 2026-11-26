// Port of the Pine Script "BUY SELL Alert" (shorttitle "RSI Alert").
// The original's "RSI Length" input (14) is never used in its logic, so only the RSI MA length is kept.
// TradingView alertcondition() has no equivalent here; overbought/oversold is shown by the candle colour.
FX.indicator({
  id: 'buy_sell_alert',
  name: 'BUY SELL Alert (RSI)',
  shortName: (p) => `RSI Alert (${p.len}, ${p.upper}/${p.lower})`,
  description: 'Tô màu nến theo RSI: cam khi RSI > ngưỡng trên (quá mua), tím khi RSI < ngưỡng dưới (quá bán)',
  pane: 'main',
  params: [
    { id: 'len', label: 'Chu kỳ RSI (MA Length)', type: 'number', default: 7, min: 1 },
    { id: 'upper', label: 'Ngưỡng trên (quá mua)', type: 'number', default: 70, min: 1, max: 100 },
    { id: 'lower', label: 'Ngưỡng dưới (quá bán)', type: 'number', default: 30, min: 0, max: 99 },
    { id: 'upColor', label: 'Màu quá mua', type: 'color', default: '#ff9800' },
    { id: 'downColor', label: 'Màu quá bán', type: 'color', default: '#9c27b0' },
  ],
  plots: [],
  compute(bars, p, ta) {
    const r = ta.rsi(ta.src(bars, 'close'), p.len);
    return { barColor: r.map((v) => (v == null ? null : v > p.upper ? p.upColor : v < p.lower ? p.downColor : null)) };
  },
});
