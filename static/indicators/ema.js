FX.indicator({
  id: 'ema',
  name: 'EMA',
  description: 'Exponential Moving Average',
  pane: 'main',
  params: [
    { id: 'period', label: 'Chu kỳ', type: 'number', default: 20, min: 1 },
    { id: 'source', label: 'Nguồn', type: 'source', default: 'close' },
  ],
  plots: [{ id: 'ema', title: 'EMA', color: '#f7c948', lineWidth: 2 }],
  compute(bars, p, ta) {
    return { ema: ta.ema(ta.src(bars, p.source), p.period) };
  },
});
