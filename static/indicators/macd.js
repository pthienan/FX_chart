FX.indicator({
  id: 'macd',
  name: 'MACD',
  description: 'EMA nhanh − EMA chậm, đường tín hiệu và histogram',
  pane: 'sub',
  precision: 5,
  levels: [0],
  params: [
    { id: 'fast', label: 'EMA nhanh', type: 'number', default: 12, min: 1 },
    { id: 'slow', label: 'EMA chậm', type: 'number', default: 26, min: 1 },
    { id: 'signal', label: 'Tín hiệu', type: 'number', default: 9, min: 1 },
    { id: 'source', label: 'Nguồn', type: 'source', default: 'close' },
  ],
  plots: [
    { id: 'hist', title: 'Histogram', type: 'histogram', colors: ['#26a69a', '#ef5350'] },
    { id: 'macd', title: 'MACD', color: '#2962ff' },
    { id: 'signal', title: 'Signal', color: '#ff6d00' },
  ],
  compute(bars, p, ta) {
    const src = ta.src(bars, p.source);
    const macd = ta.sub(ta.ema(src, p.fast), ta.ema(src, p.slow));
    const signal = ta.ema(macd, p.signal);
    return { macd, signal, hist: ta.sub(macd, signal) };
  },
});
