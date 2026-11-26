FX.indicator({
  id: 'rsi',
  name: 'RSI',
  description: 'Relative Strength Index (Wilder)',
  pane: 'sub',
  precision: 1,
  range: [0, 100],
  levels: [70, 50, 30],
  params: [
    { id: 'period', label: 'Chu kỳ', type: 'number', default: 14, min: 1 },
    { id: 'source', label: 'Nguồn', type: 'source', default: 'close' },
  ],
  plots: [{ id: 'rsi', title: 'RSI', color: '#b39ddb', lineWidth: 1 }],
  compute(bars, p, ta) {
    return { rsi: ta.rsi(ta.src(bars, p.source), p.period) };
  },
});
