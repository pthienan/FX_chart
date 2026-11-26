// Hiển thị ATR theo pip để tiện đặt SL (ví dụ SL = 1.5 × ATR).
FX.indicator({
  id: 'atr',
  name: 'ATR (pip)',
  description: 'Average True Range, đơn vị pip',
  pane: 'sub',
  precision: 1,
  params: [{ id: 'period', label: 'Chu kỳ', type: 'number', default: 14, min: 1 }],
  plots: [{ id: 'atr', title: 'ATR', color: '#ef5350' }],
  compute(bars, p, ta) {
    return { atr: ta.mul(ta.atr(bars, p.period), 1 / S.pip) };
  },
});
