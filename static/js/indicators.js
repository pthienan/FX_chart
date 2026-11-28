'use strict';
// Indicator plugin framework. Every file in /static/indicators/ calls FX.indicator({...}) once.
// See /static/indicators/_TEMPLATE.js for the plugin format.

// ---------------------------------------------------------------- ta: series helpers for plugins
// All functions take/return plain arrays aligned with `bars`; warm-up values are null.
const ta = {
  src(bars, source = 'close') {
    switch (source) {
      case 'open': return bars.map((b) => b.open);
      case 'high': return bars.map((b) => b.high);
      case 'low': return bars.map((b) => b.low);
      case 'hl2': return bars.map((b) => (b.high + b.low) / 2);
      case 'hlc3': return bars.map((b) => (b.high + b.low + b.close) / 3);
      case 'ohlc4': return bars.map((b) => (b.open + b.high + b.low + b.close) / 4);
      default: return bars.map((b) => b.close);
    }
  },
  sma(a, n) {
    const out = new Array(a.length).fill(null);
    let s = 0, bad = 0;
    for (let i = 0; i < a.length; i++) {
      if (a[i] == null) bad++; else s += a[i];
      if (i >= n) { if (a[i - n] == null) bad--; else s -= a[i - n]; }
      if (i >= n - 1 && bad === 0) out[i] = s / n;
    }
    return out;
  },
  _smooth(a, n, alpha) {
    const out = new Array(a.length).fill(null);
    let f = a.findIndex((v) => v != null);
    if (f < 0 || a.length - f < n) return out;
    let v = 0;
    for (let i = f; i < f + n; i++) v += a[i];
    v /= n; out[f + n - 1] = v;
    for (let i = f + n; i < a.length; i++) { if (a[i] != null) v = alpha * a[i] + (1 - alpha) * v; out[i] = v; }
    return out;
  },
  ema(a, n) { return ta._smooth(a, n, 2 / (n + 1)); },
  rma(a, n) { return ta._smooth(a, n, 1 / n); },
  wma(a, n) {
    const out = new Array(a.length).fill(null), den = (n * (n + 1)) / 2;
    for (let i = n - 1; i < a.length; i++) {
      let s = 0, ok = true;
      for (let k = 0; k < n; k++) { const v = a[i - k]; if (v == null) { ok = false; break; } s += v * (n - k); }
      if (ok) out[i] = s / den;
    }
    return out;
  },
  stdev(a, n) {
    const m = ta.sma(a, n);
    return m.map((mu, i) => {
      if (mu == null) return null;
      let v = 0;
      for (let k = i - n + 1; k <= i; k++) v += (a[k] - mu) ** 2;
      return Math.sqrt(v / n);
    });
  },
  highest(a, n) {
    return a.map((_, i) => {
      if (i < n - 1) return null;
      let m = -Infinity;
      for (let k = i - n + 1; k <= i; k++) { if (a[k] == null) return null; if (a[k] > m) m = a[k]; }
      return m;
    });
  },
  lowest(a, n) {
    return a.map((_, i) => {
      if (i < n - 1) return null;
      let m = Infinity;
      for (let k = i - n + 1; k <= i; k++) { if (a[k] == null) return null; if (a[k] < m) m = a[k]; }
      return m;
    });
  },
  change(a, k = 1) { return a.map((v, i) => (i < k || v == null || a[i - k] == null ? null : v - a[i - k])); },
  tr(bars) {
    return bars.map((b, i) => (i
      ? Math.max(b.high - b.low, Math.abs(b.high - bars[i - 1].close), Math.abs(b.low - bars[i - 1].close))
      : b.high - b.low));
  },
  atr(bars, n) { return ta.rma(ta.tr(bars), n); },
  rsi(a, n) {
    const ch = ta.change(a);
    const up = ta.rma(ch.map((d) => (d == null ? null : Math.max(d, 0))), n);
    const dn = ta.rma(ch.map((d) => (d == null ? null : Math.max(-d, 0))), n);
    return up.map((u, i) => (u == null ? null : dn[i] === 0 ? 100 : 100 - 100 / (1 + u / dn[i])));
  },
  // a[i] op b[i] where b may be an array or a constant
  sub(a, b) { return a.map((v, i) => { const w = Array.isArray(b) ? b[i] : b; return v == null || w == null ? null : v - w; }); },
  add(a, b) { return a.map((v, i) => { const w = Array.isArray(b) ? b[i] : b; return v == null || w == null ? null : v + w; }); },
  mul(a, b) { return a.map((v, i) => { const w = Array.isArray(b) ? b[i] : b; return v == null || w == null ? null : v * w; }); },
};

// ---------------------------------------------------------------- registry
const FX = {
  registry: {},
  indicator(def) {
    if (!def || !def.id || typeof def.compute !== 'function') throw new Error('FX.indicator cần có id và compute()');
    def.name = def.name || def.id;
    def.pane = def.pane === 'sub' ? 'sub' : 'main';
    def.params = def.params || [];
    def.plots = def.plots || [];
    FX.registry[def.id] = def;
  },
};

const USER_SCRIPT_STORE = 'fxlab_user_scripts';
const USER_SCRIPT_SAMPLE = `// Dán Pine Script của TradingView, hoặc viết FX.indicator như mẫu dưới.
// bars[i] = { time, open, high, low, close }. null = chưa đủ dữ liệu.
FX.indicator({
  id: 'my_sma',
  name: 'SMA của tôi',
  description: 'Đường trung bình do tôi viết',
  pane: 'main',
  params: [
    { id: 'length', label: 'Số nến', type: 'number', default: 20, min: 1 },
  ],
  plots: [
    { id: 'sma', title: 'SMA', color: '#f0b90b', lineWidth: 2 },
  ],
  compute(bars, p, ta) {
    return { sma: ta.sma(ta.src(bars, 'close'), p.length) };
  },
});
`;

FX.readUserScripts = function readUserScripts() {
  try {
    const list = JSON.parse(localStorage.getItem(USER_SCRIPT_STORE) || '[]');
    if (!Array.isArray(list)) return [];
    return list.filter((s) => s && typeof s.id === 'string' && typeof s.code === 'string');
  } catch (e) { return []; }
};

FX.compileUserScript = function compileUserScript(script) {
  const regId = 'user_' + script.id;
  const backup = FX.registry[regId];
  delete FX.registry[regId];
  let registered = null;
  const fx = {
    indicator(def) {
      if (registered) throw new Error('Chỉ gọi FX.indicator một lần');
      FX.indicator({ ...def, id: regId });
      registered = FX.registry[regId];
    },
  };
  try {
    if (window.Pine && Pine.looksLike(script.code)) fx.indicator(Pine.compile(script.code));
    else new Function('FX', 'ta', script.code)(fx, ta);
    if (!registered) throw new Error('Code phải gọi FX.indicator({...})');
    const chosen = (script.name || '').trim().slice(0, 80);
    script.name = chosen || registered.name || 'Indicator của tôi';
    registered.name = script.name;
    return '';
  } catch (e) {
    if (backup) FX.registry[regId] = backup;
    else delete FX.registry[regId];
    return e.message || String(e);
  }
};

FX.loadUserScripts = function loadUserScripts() {
  const bad = [];
  for (const script of FX.readUserScripts()) {
    const err = FX.compileUserScript(script);
    if (err) bad.push(`${script.name || script.id}: ${err}`);
  }
  if (bad.length) setStatus('Lỗi code indicator: ' + bad.join(' | '), true);
};

FX.saveUserScripts = function saveUserScripts(list) {
  localStorage.setItem(USER_SCRIPT_STORE, JSON.stringify(list));
  if (window.Account) Account.touch();
};

// ---------------------------------------------------------------- modal (shared with other modules)
function openModal(title, html) {
  $('modal-title').textContent = title;
  $('modal-body').innerHTML = html;
  document.querySelector('.modal-box').classList.toggle('wide', title === 'Thêm Indicator');
  $('modal').classList.remove('hidden');
}
function closeModal() {
  $('modal').classList.add('hidden');
  $('modal-body').innerHTML = '';
  document.querySelector('.modal-box').classList.remove('wide');
}
$('modal-close').addEventListener('click', closeModal);
$('modal').addEventListener('mousedown', (e) => { if (e.target.id === 'modal') closeModal(); });

// ---------------------------------------------------------------- runtime
const Ind = (() => {
  const STORE = 'fxlab_indicators';
  const SOURCES = ['close', 'open', 'high', 'low', 'hl2', 'hlc3', 'ohlc4'];
  let list = [];
  let insts = [];
  let uidSeq = 1;
  let syncing = false;

  const paneCharts = () => list.filter((r) => r.pane).map((r) => r.pane.chart);
  const defaults = (def) => Object.fromEntries(def.params.map((p) => [p.id, p.default]));
  const plotColor = (r, pl) => (r.inst.colors && r.inst.colors[pl.id]) || pl.color || '#2962ff';
  const plotWidth = (r, pl) => (r.inst.widths && r.inst.widths[pl.id]) || pl.lineWidth || 1;
  const precisionOf = (r) => (r.pane ? r.def.precision ?? 2 : S.digits);

  function title(r) {
    if (r.def.shortName) return r.def.shortName(r.inst.params);
    const vals = r.def.params.filter((p) => p.type !== 'bool').map((p) => r.inst.params[p.id]);
    return vals.length ? `${r.def.name} (${vals.join(', ')})` : r.def.name;
  }

  function syncFrom(src, range) {
    if (syncing || !range) return;
    syncing = true;
    for (const c of [chart, ...paneCharts()]) if (c !== src) c.timeScale().setVisibleLogicalRange(range);
    syncing = false;
  }
  chart.timeScale().subscribeVisibleLogicalRangeChange((r) => syncFrom(chart, r));

  function createPane(inst) {
    const el = document.createElement('div');
    el.className = 'pane';
    el.dataset.uid = inst.uid;
    if (inst.height >= 48) el.style.height = inst.height + 'px';
    el.innerHTML = '<div class="pane-grip" title="Kéo để đổi chiều cao. Double-click để về mặc định."></div><div class="pane-chart"></div><div class="pane-legend"></div>';
    $('panes').appendChild(el);
    const grip = el.querySelector('.pane-grip');
    grip.addEventListener('mousedown', (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();
      const startY = e.clientY, startH = el.offsetHeight;
      const move = (ev) => {
        const max = Math.max(80, $('charts').clientHeight - 100);
        const next = Math.max(48, Math.min(max, startH + (startY - ev.clientY)));
        el.style.height = next + 'px';
        inst.height = Math.round(next);
      };
      const up = () => {
        window.removeEventListener('mousemove', move);
        window.removeEventListener('mouseup', up);
        save();
        if (window.Draw) Draw.dirty();
      };
      window.addEventListener('mousemove', move);
      window.addEventListener('mouseup', up);
    });
    grip.addEventListener('dblclick', (e) => {
      e.preventDefault();
      e.stopPropagation();
      el.style.height = '';
      delete inst.height;
      save();
    });
    const c = LightweightCharts.createChart(el.querySelector('.pane-chart'), chartOptions({
      rightPriceScale: { borderColor: THEME.border, minimumWidth: 80, scaleMargins: { top: 0.1, bottom: 0.1 } },
      timeScale: { visible: false, rightOffset: 8 },
    }));
    const handler = (range) => syncFrom(c, range);
    c.timeScale().subscribeVisibleLogicalRangeChange(handler);
    c.subscribeCrosshairMove((param) => {
      if (param.logical == null) return;
      const i = Math.round(param.logical);
      if (i >= 0 && i < S.end) showLegend(i);
    });
    return { el, chart: c, legend: el.querySelector('.pane-legend') };
  }

  function addPlotSeries(target, r, pl) {
    const prec = precisionOf(r);
    const opts = {
      color: plotColor(r, pl), priceLineVisible: false, lastValueVisible: !!r.pane,
      visible: r.inst.visible !== false,
      priceFormat: { type: 'price', precision: prec, minMove: 10 ** -prec },
    };
    if (r.pane && r.def.range) {
      const [minValue, maxValue] = r.def.range;
      opts.autoscaleInfoProvider = () => ({ priceRange: { minValue, maxValue } });
    }
    if (pl.type === 'histogram') return target.addHistogramSeries({ ...opts, base: pl.base ?? 0 });
    return target.addLineSeries({
      ...opts, lineWidth: plotWidth(r, pl), crosshairMarkerVisible: false,
      lineStyle: pl.style === 'dashed' ? 2 : pl.style === 'dotted' ? 1 : 0,
    });
  }

  function createRuntime(inst) {
    const def = FX.registry[inst.id];
    if (!def) return null;
    const r = { inst, def, out: {}, series: {}, pane: null, err: null };
    let target = chart;
    if (def.pane === 'sub') {
      r.pane = createPane(inst);
      target = r.pane.chart;
    }
    for (const pl of def.plots) r.series[pl.id] = addPlotSeries(target, r, pl);
    if (r.pane && def.levels && def.plots.length) {
      const s0 = r.series[def.plots[0].id];
      for (const lv of def.levels) {
        s0.createPriceLine({ price: lv, color: '#4a4e5a', lineWidth: 1, lineStyle: 2, axisLabelVisible: false });
      }
    }
    if (r.pane) {
      const range = chart.timeScale().getVisibleLogicalRange();
      if (range) requestAnimationFrame(() => r.pane.chart.timeScale().setVisibleLogicalRange(range));
      const host = firstSeries(r);
      if (host && window.Draw) Draw.attachPlus(r.pane.chart, host, r.pane.el, inst.uid, precisionOf(r));
    }
    return r;
  }

  function destroyRuntime(r) {
    if (r.pane) { r.pane.chart.remove(); r.pane.el.remove(); }
    else for (const s of Object.values(r.series)) chart.removeSeries(s);
  }

  function compute(r, bars) {
    try {
      const res = r.def.compute(bars, r.inst.params, ta) || {};
      r.out = {};
      for (const pl of r.def.plots) r.out[pl.id] = Array.isArray(res[pl.id]) ? res[pl.id] : [];
      r.res = res;
      r.barColor = Array.isArray(res.barColor) ? res.barColor : null;
      r.colorOf = res.colors || null;
      r.marks = Array.isArray(res.marks) ? res.marks : null;
      r.lines = Array.isArray(res.lines) ? res.lines : null;
      r.labels = Array.isArray(res.labels) ? res.labels : null;
      r.err = null;
    } catch (e) {
      r.out = {};
      r.res = {};
      r.barColor = null;
      r.colorOf = null;
      r.marks = [];
      r.lines = null;
      r.labels = null;
      r.err = e.message;
      console.error(e);
      setStatus(`Lỗi indicator ${r.def.name}: ${e.message}`, true);
    }
  }

  function item(r, pl, i) {
    const v = r.out[pl.id][i], time = S.bars[i].time;
    if (v == null || !Number.isFinite(v)) return r.pane ? { time } : null;
    const it = { time, value: v };
    if (r.colorOf && r.colorOf[pl.id] && r.colorOf[pl.id][i]) it.color = r.colorOf[pl.id][i];
    else if (pl.type === 'histogram' && pl.colors) it.color = v >= 0 ? pl.colors[0] : pl.colors[1];
    return it;
  }

  function setAll(r) {
    for (const pl of r.def.plots) {
      const data = [];
      for (let i = 0; i < S.end; i++) { const it = item(r, pl, i); if (it) data.push(it); }
      r.series[pl.id].setData(data);
    }
    const host = r.def.plots[0] && r.series[r.def.plots[0].id];
    if (host && host.setMarkers && Array.isArray(r.marks)) {
      const endTime = S.end > 0 ? S.bars[S.end - 1].time : 0;
      host.setMarkers(r.marks.filter((m) => m && m.time <= endTime).sort((a, b) => a.time - b.time));
    }
  }

  function buildLegends() {
    const main = [];
    for (const r of list) {
      const vals = r.def.plots.filter((pl) => pl.legend !== false).map((pl) => `<span class="lg-val" data-plot="${esc(pl.id)}" style="color:${esc(plotColor(r, pl))}"></span>`).join('');
      const row = `<div class="lg-row${r.inst.visible === false ? ' off' : ''}" data-uid="${r.inst.uid}">` +
        `<span class="lg-name">${esc(title(r))}</span>${vals}${r.err ? `<span class="lg-err" title="${esc(r.err)}">lỗi</span>` : ''}` +
        '<button data-a="vis" title="Ẩn/hiện">👁</button><button data-a="cfg" title="Cài đặt">⚙</button><button data-a="del" title="Xóa">✕</button></div>';
      if (r.pane) r.pane.legend.innerHTML = row; else main.push(row);
    }
    $('legend-ind').innerHTML = main.join('');
  }

  function save() {
    localStorage.setItem(STORE, JSON.stringify(insts));
    if (window.Account) Account.touch();
  }

  function changed() {
    if (!S.bars.length) return;
    refreshCandles();
    refreshTradeVisuals();
    Draw.dirty();
  }

  function drawHelpers(r, ctx, pw, ph) {
    const tsc = chart.timeScale(), vr = tsc.getVisibleLogicalRange();
    if (!vr) return null;
    const x = (i) => tsc.logicalToCoordinate(i);
    const y = (p) => candle.priceToCoordinate(p);
    const from = Math.max(0, Math.floor(vr.from) - 1), to = Math.min(S.end - 1, Math.ceil(vr.to) + 1);
    return {
      ctx, width: pw, height: ph, from, to, end: S.end,
      bars: S.bars, t: S.t, params: r.inst.params, res: r.res || {},
      pip: S.pip, digits: S.digits, tfSec: TF_SEC[S.tf], tz: S.tz,
      barSpacing: tsc.options().barSpacing, x, y, hexA, fmtPrice,
      fillBetween(a, b, color) {
        ctx.fillStyle = color;
        let seg = [];
        const flush = () => {
          if (seg.length > 1) {
            ctx.beginPath();
            seg.forEach((i, k) => (k ? ctx.lineTo(x(i), y(a[i])) : ctx.moveTo(x(i), y(a[i]))));
            for (let k = seg.length - 1; k >= 0; k--) ctx.lineTo(x(seg[k]), y(b[seg[k]]));
            ctx.closePath();
            ctx.fill();
          }
          seg = [];
        };
        for (let i = from; i <= to; i++) {
          if (a[i] == null || b[i] == null) flush(); else seg.push(i);
        }
        flush();
      },
      text(str, tx, ty, color, align = 'center', baseline = 'middle', font = '11px -apple-system, "Segoe UI", Roboto, Arial, sans-serif') {
        ctx.font = font; ctx.fillStyle = color; ctx.textAlign = align; ctx.textBaseline = baseline;
        ctx.fillText(str, tx, ty);
      },
    };
  }

  function rebuild(r) {
    const idx = list.indexOf(r);
    destroyRuntime(r);
    const nr = createRuntime(r.inst);
    list[idx] = nr;
    if (S.bars.length) { compute(nr, nr.def.recompute ? S.bars.slice(0, S.end) : S.bars); setAll(nr); }
    return nr;
  }

  function onLegendClick(e) {
    const btn = e.target.closest('button[data-a]');
    const row = e.target.closest('.lg-row');
    if (!btn || !row) return;
    e.stopPropagation();
    const r = list.find((x) => x.inst.uid === +row.dataset.uid);
    if (!r) return;
    if (btn.dataset.a === 'del') api.remove(r.inst.uid);
    else if (btn.dataset.a === 'vis') {
      r.inst.visible = r.inst.visible === false;
      for (const s of Object.values(r.series)) s.applyOptions({ visible: r.inst.visible });
      buildLegends(); save(); changed();
    } else if (btn.dataset.a === 'cfg') api.edit(r.inst.uid);
  }
  $('legend-ind').addEventListener('click', onLegendClick);
  $('legend-ind').addEventListener('mousedown', (e) => { if (e.target.closest('button')) e.stopPropagation(); });
  $('panes').addEventListener('click', onLegendClick);

  function paintPineOn(ctx, r, xOf, yOf, end, textOf) {
    ctx.save();
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    for (const ln of r.lines || []) {
      if (!ln || ln.dead || ln.x1 >= end || ln.x2 >= end) continue;
      const x1 = xOf(ln.x1), y1 = yOf(ln.y1), x2 = xOf(ln.x2), y2 = yOf(ln.y2);
      if (x1 == null || y1 == null || x2 == null || y2 == null) continue;
      const style = String(ln.style || '');
      ctx.setLineDash(style.includes('dashed') ? [5, 4] : style.includes('dotted') ? [1, 3] : []);
      ctx.beginPath();
      ctx.strokeStyle = ln.color || '#2962ff';
      ctx.lineWidth = ln.width || 1;
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.stroke();
    }
    ctx.setLineDash([]);
    for (const lb of r.labels || []) {
      if (!lb || lb.dead || lb.x >= end) continue;
      const x = xOf(lb.x), y = yOf(lb.y);
      if (x == null || y == null) continue;
      textOf(String(lb.text || ''), x, y, lb.textColor || '#fff');
    }
    ctx.restore();
  }

  function firstSeries(r) {
    const id = r.def.plots[0] && r.def.plots[0].id;
    return (id && r.series[id]) || Object.values(r.series)[0] || null;
  }
  function paneHost(r) {
    const b = r.pane.el.getBoundingClientRect();
    return {
      uid: r.inst.uid, el: r.pane.el, chart: r.pane.chart, series: firstSeries(r),
      prec: precisionOf(r), top: b.top, left: b.left, w: b.width, h: b.height,
    };
  }

  const api = {
    init() {
      let saved = null;
      try { saved = JSON.parse(localStorage.getItem(STORE) || 'null'); } catch (e) { saved = null; }
      insts = saved || [
        { id: 'ema', params: { period: 20, source: 'close' }, colors: { ema: '#f7c948' } },
        { id: 'ema', params: { period: 50, source: 'close' }, colors: { ema: '#42a5f5' } },
        { id: 'ema', params: { period: 200, source: 'close' }, colors: { ema: '#e040fb' } },
      ];
      for (const inst of insts) {
        if (!inst.uid) inst.uid = uidSeq;
        uidSeq = Math.max(uidSeq, inst.uid + 1);
        const def = FX.registry[inst.id];
        if (def) inst.params = { ...defaults(def), ...inst.params };
      }
      list = insts.map(createRuntime).filter(Boolean);
      const missing = insts.filter((i) => !FX.registry[i.id]).map((i) => i.id);
      if (missing.length) setStatus(`Không tìm thấy file indicator: ${[...new Set(missing)].join(', ')}`, true);
      buildLegends();
      save();
    },
    computeAll() {
      for (const r of list) {
        if (!r.pane) {
          const pf = { type: 'price', precision: S.digits, minMove: 10 ** -S.digits };
          for (const s of Object.values(r.series)) s.applyOptions({ priceFormat: pf });
        }
        if (!r.def.recompute) compute(r, S.bars);
      }
      buildLegends();
    },
    renderAll() {
      for (const r of list) {
        if (r.def.recompute) compute(r, S.bars.slice(0, S.end));
        setAll(r);
      }
    },
    step(i) {
      for (const r of list) {
        if (r.def.recompute) { compute(r, S.bars.slice(0, S.end)); setAll(r); continue; }
        for (const pl of r.def.plots) {
          const it = item(r, pl, i);
          if (it) r.series[pl.id].update(it);
        }
      }
    },
    barColor(i) {
      for (let k = list.length - 1; k >= 0; k--) {
        const r = list[k];
        if (r.barColor && r.inst.visible !== false && r.barColor[i]) return r.barColor[i];
      }
      return null;
    },
    paintUnder(ctx, pw, ph) {
      for (const r of list) {
        const pine = (r.lines && r.lines.length && !r.pane) || (r.labels && r.labels.length && !r.pane);
        if ((!r.def.draw && !pine) || r.inst.visible === false || r.err) continue;
        const h = drawHelpers(r, ctx, pw, ph);
        if (!h) return;
        ctx.save();
        try {
          if (r.def.draw) r.def.draw(ctx, h);
          paintPineOn(ctx, r, (i) => h.x(i), (p) => h.y(p), h.end, (text, x, y, color) => h.text(text, x, y, color));
        } catch (e) {
          r.err = e.message;
          console.error(e);
          setStatus(`Lỗi vẽ indicator ${r.def.name}: ${e.message}`, true);
          buildLegends();
        }
        ctx.restore();
      }
    },
    paintPanes() {
      for (const r of list) {
        if (!r.pane || r.err || r.inst.visible === false) continue;
        const lines = (r.lines || []).filter((x) => x && !x.dead);
        const labels = (r.labels || []).filter((x) => x && !x.dead);
        const old = r.pane.el.querySelector(':scope > .pine-draw');
        if (!lines.length && !labels.length) { if (old) old.remove(); continue; }
        const plot = r.def.plots[0];
        const series = plot && r.series[plot.id];
        if (!series) continue;
        let canvas = old;
        if (!canvas) {
          canvas = document.createElement('canvas');
          canvas.className = 'pine-draw';
          r.pane.el.appendChild(canvas);
        }
        const dpr = window.devicePixelRatio || 1;
        const w = r.pane.el.clientWidth, h = r.pane.el.clientHeight;
        if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
          canvas.width = Math.round(w * dpr);
          canvas.height = Math.round(h * dpr);
        }
        const g = canvas.getContext('2d');
        g.setTransform(dpr, 0, 0, dpr, 0, 0);
        g.clearRect(0, 0, w, h);
        const tsc = r.pane.chart.timeScale();
        paintPineOn(g, { lines, labels }, (i) => tsc.logicalToCoordinate(i), (p) => series.priceToCoordinate(p), S.end, (text, x, y, color) => {
          g.font = '11px -apple-system, "Segoe UI", Roboto, Arial, sans-serif';
          g.fillStyle = color || '#fff';
          g.textAlign = 'center';
          g.textBaseline = 'bottom';
          g.fillText(text, x, y);
        });
      }
    },
    legend(i) {
      for (const r of list) {
        const root = r.pane ? r.pane.legend : $('legend-ind');
        const row = root.querySelector(`.lg-row[data-uid="${r.inst.uid}"]`);
        if (!row) continue;
        const prec = precisionOf(r);
        for (const pl of r.def.plots) {
          if (pl.legend === false) continue;
          const el = row.querySelector(`.lg-val[data-plot="${CSS.escape(pl.id)}"]`);
          const v = r.out[pl.id] ? r.out[pl.id][i] : null;
          if (el) el.textContent = v == null || !Number.isFinite(v) ? '—' : v.toFixed(prec);
        }
      }
    },
    syncCrosshair(i) {
      for (const r of list) {
        if (!r.pane) continue;
        const pl = r.def.plots[0];
        const v = i == null || !pl ? null : r.out[pl.id][i];
        if (v == null || !Number.isFinite(v)) r.pane.chart.clearCrosshairPosition();
        else r.pane.chart.setCrosshairPosition(v, S.bars[i].time, r.series[pl.id]);
      }
    },
    add(id) {
      const def = FX.registry[id];
      if (!def) return;
      const inst = { uid: uidSeq++, id, params: defaults(def), colors: {}, visible: true };
      insts.push(inst);
      const r = createRuntime(inst);
      list.push(r);
      if (S.bars.length) { compute(r, def.recompute ? S.bars.slice(0, S.end) : S.bars); setAll(r); }
      buildLegends(); save(); changed();
      showLegend(S.end - 1);
    },
    remove(uid) {
      const r = list.find((x) => x.inst.uid === uid);
      if (r) { destroyRuntime(r); list = list.filter((x) => x !== r); }
      insts = insts.filter((x) => x.uid !== uid);
      if (window.Draw) Draw.dropPane(uid);
      buildLegends(); save(); changed();
    },
    refreshDef(id) {
      list = list.map((r) => {
        if (r.inst.id !== id) return r;
        r.inst.params = { ...defaults(FX.registry[id]), ...r.inst.params };
        return rebuild(r);
      });
      buildLegends();
      showLegend(Math.max(0, S.end - 1));
    },
    openPicker() {
      const defs = Object.values(FX.registry).sort((a, b) => a.name.localeCompare(b.name));
      openModal('Indicators', `<div class="modal-actions" style="margin-top:0"><button id="ind-code">Thêm Indicator</button></div>` +
        (defs.length ? defs.map((d) =>
          `<div class="ind-item" data-id="${esc(d.id)}"><div><b>${esc(d.name)}</b><small>${esc(d.description || '')}</small></div>` +
          `<span class="muted">${d.id.startsWith('user_') ? 'code của bạn' : d.pane === 'sub' ? 'khung riêng' : 'trên chart'}</span></div>`).join('')
          : '<div class="muted">Chưa có indicator nào.</div>'));
      $('ind-code').addEventListener('click', () => api.openEditor());
      $('modal-body').querySelectorAll('.ind-item').forEach((el) => el.addEventListener('click', () => {
        api.add(el.dataset.id);
        setStatus(`Đã thêm ${FX.registry[el.dataset.id].name}. Bấm ⚙ trên legend để chỉnh thông số.`);
      }));
    },
    openEditor(editId) {
      let scripts = FX.readUserScripts();
      let current = editId || (scripts[0] && scripts[0].id) || '';
      const render = () => {
        const script = scripts.find((s) => s.id === current);
        const code = script ? script.code : USER_SCRIPT_SAMPLE;
        const items = scripts.map((s) =>
          `<button type="button" data-script="${esc(s.id)}" class="${s.id === current ? 'active' : ''}">${esc(s.name || 'Chưa đặt tên')}</button>`).join('');
        openModal('Thêm Indicator', `<div class="code-lab">
          <div class="code-list">${items}<button type="button" id="ind-new">+ Mới</button></div>
          <div>
            <input id="ind-name" type="text" maxlength="80" placeholder="Tên indicator" value="${esc(script ? script.name : '')}">
            <textarea id="ind-src" spellcheck="false">${esc(code)}</textarea>
            <div id="ind-src-err" class="acc-msg neg"></div>
            <div class="modal-actions">
              <button id="ind-back">Danh sách</button>
              <button id="ind-del"${script ? '' : ' disabled'}>Xóa</button>
              <span style="flex:1"></span>
              <button id="ind-save">Lưu</button>
              <button id="ind-use" class="active">Thêm vào chart</button>
            </div>
          </div></div>`);
        const area = $('ind-src');
        area.addEventListener('keydown', (e) => {
          if (e.key !== 'Tab') return;
          e.preventDefault();
          const at = area.selectionStart;
          area.value = area.value.slice(0, at) + '  ' + area.value.slice(area.selectionEnd);
          area.selectionStart = area.selectionEnd = at + 2;
        });
        $('ind-back').onclick = () => api.openPicker();
        $('ind-new').onclick = () => { current = ''; render(); };
        $('modal-body').querySelectorAll('[data-script]').forEach((btn) => {
          btn.onclick = () => { current = btn.dataset.script; render(); };
        });
        $('ind-save').onclick = () => saveDraft(false);
        $('ind-use').onclick = () => saveDraft(true);
        if ($('ind-del')) $('ind-del').onclick = () => {
          if (!current || !confirm('Xóa indicator này?')) return;
          const regId = 'user_' + current;
          scripts = scripts.filter((s) => s.id !== current);
          FX.saveUserScripts(scripts);
          delete FX.registry[regId];
          for (const inst of [...insts]) if (inst.id === regId) api.remove(inst.uid);
          current = scripts[0] ? scripts[0].id : '';
          render();
        };
        function saveDraft(addToChart) {
          const text = area.value;
          const name = ($('ind-name').value || '').trim().slice(0, 80);
          let script = scripts.find((s) => s.id === current);
          if (!script) {
            script = { id: Math.random().toString(36).slice(2, 10), name, code: text };
            scripts.push(script);
            current = script.id;
          } else {
            script.code = text;
            script.name = name;
          }
          const err = FX.compileUserScript(script);
          $('ind-src-err').textContent = err;
          FX.saveUserScripts(scripts);
          if (err) return;
          api.refreshDef('user_' + script.id);
          if (addToChart) {
            api.add('user_' + script.id);
            closeModal();
            setStatus(`Đã thêm ${script.name}.`);
            return;
          }
          setStatus(`Đã lưu ${script.name}.`);
          render();
        }
      };
      render();
    },
    edit(uid) {
      const r = list.find((x) => x.inst.uid === uid);
      if (!r) return;
      const p = r.inst.params;
      const field = (x) => {
        const v = p[x.id];
        if (x.type === 'source' || x.type === 'select') {
          const opts = x.type === 'source' ? SOURCES : x.options;
          return `<select data-p="${esc(x.id)}">${opts.map((o) => `<option${o === v ? ' selected' : ''}>${esc(o)}</option>`).join('')}</select>`;
        }
        if (x.type === 'bool') return `<input type="checkbox" data-p="${esc(x.id)}"${v ? ' checked' : ''}>`;
        if (x.type === 'color') return `<input type="color" data-p="${esc(x.id)}" value="${esc(v)}">`;
        if (x.type === 'text') return `<input type="text" data-p="${esc(x.id)}" value="${esc(v)}">`;
        return `<input type="number" data-p="${esc(x.id)}" value="${esc(v)}"${x.min != null ? ` min="${x.min}"` : ''}${x.max != null ? ` max="${x.max}"` : ''} step="${x.step ?? 1}">`;
      };
      let group = null;
      const params = r.def.params.map((x) => {
        const head = x.group && x.group !== group ? `<div class="ind-group">${esc(x.group)}</div>` : '';
        group = x.group || group;
        return `${head}<label>${esc(x.label || x.id)}</label>${field(x)}`;
      }).join('');
      const widthSel = (pl) => `<select data-w="${esc(pl.id)}" title="Độ dày">${[1, 2, 3, 4]
        .map((n) => `<option value="${n}"${n === plotWidth(r, pl) ? ' selected' : ''}>${n}px</option>`).join('')}</select>`;
      const colors = r.def.plots.filter((pl) => !(pl.type === 'histogram' && pl.colors))
        .map((pl) => `<label>${esc(pl.title || pl.id)}</label><span class="row tight"><input type="color" data-c="${esc(pl.id)}" value="${esc(plotColor(r, pl))}">` +
          `${pl.type === 'histogram' ? '' : widthSel(pl)}</span>`).join('');
      openModal(r.def.name, `<div class="ind-form">${params}${colors}</div>
        <div class="modal-actions"><button id="ind-reset">Mặc định</button><button id="ind-cancel">Hủy</button><button id="ind-ok" class="active">OK</button></div>`);
      const body = $('modal-body');
      $('ind-cancel').onclick = closeModal;
      $('ind-reset').onclick = () => {
        const d = defaults(r.def);
        body.querySelectorAll('[data-p]').forEach((el) => {
          if (el.type === 'checkbox') el.checked = !!d[el.dataset.p]; else el.value = d[el.dataset.p];
        });
        body.querySelectorAll('[data-c]').forEach((el) => {
          el.value = r.def.plots.find((pl) => pl.id === el.dataset.c).color || '#2962ff';
        });
        body.querySelectorAll('[data-w]').forEach((el) => {
          el.value = r.def.plots.find((pl) => pl.id === el.dataset.w).lineWidth || 1;
        });
      };
      $('ind-ok').onclick = () => {
        for (const x of r.def.params) {
          const el = body.querySelector(`[data-p="${CSS.escape(x.id)}"]`);
          if (!el) continue;
          if (x.type === 'bool') p[x.id] = el.checked;
          else if (x.type === 'source' || x.type === 'select' || x.type === 'color') p[x.id] = el.value;
          else if (x.type === 'text') p[x.id] = el.value.trim();
          else {
            let v = parseFloat(el.value);
            if (!Number.isFinite(v)) v = x.default;
            if (x.min != null) v = Math.max(x.min, v);
            if (x.max != null) v = Math.min(x.max, v);
            p[x.id] = v;
          }
        }
        r.inst.colors = r.inst.colors || {};
        body.querySelectorAll('[data-c]').forEach((el) => { r.inst.colors[el.dataset.c] = el.value; });
        r.inst.widths = r.inst.widths || {};
        body.querySelectorAll('[data-w]').forEach((el) => { r.inst.widths[el.dataset.w] = +el.value; });
        closeModal();
        rebuild(r);
        buildLegends(); save(); changed();
        showLegend(S.end - 1);
      };
    },
    hitPane(clientX, clientY) {
      for (const r of list) {
        if (!r.pane || r.inst.visible === false) continue;
        const h = paneHost(r);
        if (clientX < h.left || clientX > h.left + h.w || clientY < h.top || clientY > h.top + h.h) continue;
        const y = clientY - h.top;
        return { ...h, x: clientX - h.left, y, price: h.series ? h.series.coordinateToPrice(y) : null };
      }
      return null;
    },
    paneGeom(uid) {
      const r = list.find((x) => x.inst.uid === uid && x.pane);
      return r ? paneHost(r) : null;
    },
    paneHosts() {
      return list.filter((r) => r.pane).map(paneHost);
    },
    layoutSig() {
      return list.filter((r) => r.pane).map((r) => {
        const s = firstSeries(r);
        const y = s ? s.priceToCoordinate(50) : null;
        return r.inst.uid + ':' + r.pane.el.clientHeight + ':' + (y == null ? '' : Math.round(y));
      }).join(',');
    },
  };
  return api;
})();

const IND_LEGEND_KEY = 'fxlab_ind_legend_hidden';
function applyIndLegend() {
  const hidden = localStorage.getItem(IND_LEGEND_KEY) === '1';
  document.body.classList.toggle('hide-ind-legend', hidden);
  const btn = $('btn-ind-legend');
  if (btn) btn.title = hidden ? 'Hiện tên indicator' : 'Ẩn tên indicator';
}
applyIndLegend();
$('btn-ind-legend').addEventListener('click', (e) => {
  e.stopPropagation();
  localStorage.setItem(IND_LEGEND_KEY, document.body.classList.contains('hide-ind-legend') ? '0' : '1');
  applyIndLegend();
});
