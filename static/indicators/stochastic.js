FX.indicator({
  id: 'stoch',
  name: 'Stochastic',
  description: '%K và %D',
  pane: 'sub',
  precision: 1,
  range: [0, 100],
  levels: [80, 20],
  params: [
    { id: 'k', label: '%K', type: 'number', default: 14, min: 1 },
    { id: 'smooth', label: 'Làm mượt %K', type: 'number', default: 3, min: 1 },
    { id: 'd', label: '%D', type: 'number', default: 3, min: 1 },
  ],
  plots: [
    { id: 'k', title: '%K', color: '#2962ff' },
    { id: 'd', title: '%D', color: '#ff6d00' },
  ],
  compute(bars, p, ta) {
    const hh = ta.highest(ta.src(bars, 'high'), p.k), ll = ta.lowest(ta.src(bars, 'low'), p.k);
    const raw = bars.map((b, i) => (hh[i] == null || hh[i] === ll[i] ? null : ((b.close - ll[i]) / (hh[i] - ll[i])) * 100));
    const k = ta.sma(raw, p.smooth);
    return { k, d: ta.sma(k, p.d) };
  },
});
