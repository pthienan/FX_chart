FX.indicator({
  id: 'bb',
  name: 'Bollinger Bands',
  description: 'SMA ± k độ lệch chuẩn',
  pane: 'main',
  params: [
    { id: 'period', label: 'Chu kỳ', type: 'number', default: 20, min: 2 },
    { id: 'mult', label: 'Hệ số k', type: 'number', default: 2, min: 0.1, step: 0.1 },
    { id: 'source', label: 'Nguồn', type: 'source', default: 'close' },
  ],
  plots: [
    { id: 'upper', title: 'Trên', color: '#2196f3' },
    { id: 'basis', title: 'Giữa', color: '#ff6d00', style: 'dashed' },
    { id: 'lower', title: 'Dưới', color: '#2196f3' },
  ],
  compute(bars, p, ta) {
    const src = ta.src(bars, p.source);
    const basis = ta.sma(src, p.period);
    const dev = ta.mul(ta.stdev(src, p.period), p.mult);
    return { basis, upper: ta.add(basis, dev), lower: ta.sub(basis, dev) };
  },
});
