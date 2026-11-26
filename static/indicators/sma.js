FX.indicator({
  id: 'sma',
  name: 'SMA',
  description: 'Simple Moving Average',
  pane: 'main',
  params: [
    { id: 'period', label: 'Chu kỳ', type: 'number', default: 50, min: 1 },
    { id: 'source', label: 'Nguồn', type: 'source', default: 'close' },
  ],
  plots: [{ id: 'sma', title: 'SMA', color: '#ff9800', lineWidth: 2 }],
  compute(bars, p, ta) {
    return { sma: ta.sma(ta.src(bars, p.source), p.period) };
  },
});
