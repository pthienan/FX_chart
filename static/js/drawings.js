'use strict';
// TradingView-style drawing tools, painted on a canvas overlay above the main chart.
// Points are stored as {t: UTC seconds, p: price} so drawings survive timeframe changes.

const Draw = (() => {
  const wrap = $('chart-wrap'), cv = $('draw-overlay'), ctx = cv.getContext('2d');
  const cu = $('ind-underlay'), ctxU = cu.getContext('2d');
  const FONT_FAMILY = '-apple-system, "Segoe UI", Roboto, Arial, sans-serif';
  const FONT = `11px ${FONT_FAMILY}`;
  const FIB = [
    { l: 0, c: '#787b86' }, { l: 0.236, c: '#f23645' }, { l: 0.382, c: '#ff9800' }, { l: 0.5, c: '#4caf50' },
    { l: 0.618, c: '#089981' }, { l: 0.786, c: '#00bcd4' }, { l: 1, c: '#787b86' }, { l: 1.618, c: '#2962ff' },
  ];
  const FIB_EXTRA = [1.272, 1.414, 2, 2.272, 2.414, 2.618, 3, 3.618, 4.236, 0.65, 0.705, 0.886, -0.272, -0.618, 1.13, 4.618];
  const FIB_PALETTE = ['#9c27b0', '#e91e63', '#f23645', '#ff9800', '#4caf50', '#089981', '#00bcd4', '#2962ff'];
  const fibFactory = () => ({
    levels: [
      ...FIB.map((f) => ({ l: f.l, c: f.c, on: true })),
      ...FIB_EXTRA.map((l, i) => ({ l, c: FIB_PALETTE[i % FIB_PALETTE.length], on: false })),
    ],
    trend: true, fill: true, showLevel: true, showPrice: true, ext: 'none', oneColor: null,
  });
  const fibExt = (d) => d.ext || (d.extend ? 'right' : 'none');

  const POINTS = { trend: 2, fib: 2, measure: 2, rect: 2, hline: 1, vline: 1, long: 1, short: 1, icon: 1 };
  const ICONS = [
    { id: 'arrowUp', name: 'Mũi tên lên', glyph: '↑' },
    { id: 'arrowDown', name: 'Mũi tên xuống', glyph: '↓' },
    { id: 'arrowLeft', name: 'Mũi tên trái', glyph: '←' },
    { id: 'arrowRight', name: 'Mũi tên phải', glyph: '→' },
    { id: 'flag', name: 'Cờ', glyph: '⚑' },
    { id: 'star', name: 'Sao', glyph: '★' },
    { id: 'check', name: 'Đúng', glyph: '✓' },
    { id: 'cross', name: 'Sai', glyph: '✕' },
    { id: 'triangleUp', name: 'Tam giác lên', glyph: '▲' },
    { id: 'triangleDown', name: 'Tam giác xuống', glyph: '▼' },
    { id: 'circle', name: 'Tròn', glyph: '●' },
    { id: 'diamond', name: 'Thoi', glyph: '◆' },
  ];
  const ICON_SIZES = [16, 20, 24, 28, 32, 40, 48, 64];
  const isVectorIcon = (id) => ICONS.some((ic) => ic.id === id);
  const iconId = (d) => { const v = opt(d, 'icon'); return v == null || v === '' ? 'arrowUp' : v; };
  const iconSize = (d) => ICON_SIZES.includes(opt(d, 'size')) ? opt(d, 'size') : 28;
  const EMOJI = [
    { name: 'Mặt cười', items: '😀 😃 😄 😁 😆 😅 🤣 😂 🙂 😉 😊 😇 🥰 😍 🤩 😘 😗 😚 😙 🥲 😋 😛 😜 🤪 😝 🤑 🤗 🤭 🤫 🤔 🤐 🤨 😐 😑 😶 😏 😒 🙄 😬 🤥 😌 😔 😪 🤤 😴 😷 🤒 🤕 🤢 🤮 🤧 🥵 🥶 🥴 😵 🤯 🤠 🥳 😎 🤓 🧐 😕 😟 🙁 😮 😯 😲 😳 🥺 😦 😧 😨 😰 😥 😢 😭 😱 😖 😣 😞 😓 😩 😫 🥱 😤 😡 😠 🤬 😈 👿 💀 ☠️ 💩 🤡 👹 👺 👻 👽 👾 🤖'.split(' ') },
    { name: 'Cử chỉ', items: '👍 👎 👌 ✌️ 🤞 🤟 🤘 🤙 👋 🤚 ✋ 👏 🙌 👐 🤲 🤝 🙏 ✍️ 💪 👀 👁️ 🧠 👅 👄 💋'.split(' ') },
    { name: 'Trái tim', items: '❤️ 🧡 💛 💚 💙 💜 🖤 🤍 🤎 💔 ❣️ 💕 💞 💓 💗 💖 💘 💝 💟'.split(' ') },
    { name: 'Đánh dấu', items: '⭐ 🌟 ✨ ⚡ 🔥 💥 💯 💢 💦 💨 ✅ ❌ ⭕ 🔴 🟠 🟡 🟢 🔵 🟣 ⚫ ⚪ 🔶 🔷 ⚠️ 🚫 ⛔ ♻️ ✔️ ❗ ❓ ‼️ ⁉️ 🔔'.split(' ') },
    { name: 'Mũi tên', items: '⬆️ ⬇️ ⬅️ ➡️ ↗️ ↘️ ↙️ ↖️ 🔼 🔽 ⏫ ⏬ ↩️ ↪️ 🔄 🔃'.split(' ') },
    { name: 'Giao dịch', items: '💰 💵 💴 💶 💷 💸 💳 💎 🏆 🎯 📌 📍 🚩 🏁 📈 📉 📊 🕒 ⏰ 🚀 💡 🪙 ⚖️ 🔑 🔒 🧲'.split(' ') },
    { name: 'Đồ vật', items: '⌚ 📱 💻 ⌨️ 🖥️ 🖨️ 📷 🎥 📺 📻 ☎️ 📧 📝 📌 📎 ✂️ 📁 📅 📦 📫 📮 ✏️ 🖊️ 🖋️ 🖌️ 🖍️ 📖 📚 🎁 🎀 🎉 🎊 🎈'.split(' ') },
    { name: 'Động vật', items: '🐶 🐱 🐭 🐹 🐰 🦊 🐻 🐼 🐨 🐯 🦁 🐮 🐷 🐸 🐵 🙈 🙉 🙊 🐔 🐧 🐦 🐤 🦆 🦅 🦉 🦇 🐺 🐗 🐴 🦄 🐝 🐛 🦋 🐌 🐞 🐜 🐢 🐍 🦎 🐙 🦑 🦐 🐠 🐟 🐬 🐳 🦈 🐊'.split(' ') },
    { name: 'Thức ăn', items: '🍏 🍎 🍊 🍋 🍌 🍉 🍇 🍓 🍒 🍑 🍍 🥝 🍅 🥑 🍔 🍕 🌭 🥪 🌮 🍣 🍩 🍪 🎂 ☕ 🍺 🍻'.split(' ') },
    { name: 'Cờ', items: '🏳️ 🏴 🚩 🏁 🇻🇳 🇺🇸 🇬🇧 🇯🇵 🇪🇺 🇨🇳 🇰🇷 🇹🇭 🇸🇬 🇦🇺'.split(' ') },
  ];
  const POS = {
    width: 1, tpColor: '#26a69a', slColor: '#ef5350', fillOpacity: 22, alwaysStats: false, outcome: true,
  };
  const TEXT = { text: '', textColor: '#d1d4dc', textSize: 12 };
  const TYPE_DEF = {
    trend: { color: '#2962ff', width: 2, style: 'solid', extLeft: false, extend: false, stats: false, ...TEXT },
    hline: { color: '#f0b90b', width: 1, style: 'solid', showPrice: true, ...TEXT },
    vline: { color: '#9598a1', width: 1, style: 'solid', showTime: true, ...TEXT },
    rect: {
      color: '#9c27b0', width: 1, style: 'solid', fill: true, fillColor: '#9c27b0', fillOpacity: 20,
      extLeft: false, extend: false, ...TEXT, textPos: 'top',
    },
    fib: { color: '#787b86', width: 1 },
    long: POS, short: POS,
    icon: { color: '#2962ff', icon: 'arrowUp', size: 28 },
  };
  const DASH = { solid: [], dashed: [8, 5], dotted: [2, 3] };
  const opt = (d, k) => (d[k] !== undefined && d[k] !== null ? d[k] : (TYPE_DEF[d.type] || {})[k]);
  const widthOf = (d) => d.width || (TYPE_DEF[d.type] || {}).width || 1;
  const colorOf = (d) => opt(d, 'color') || '#2962ff';
  const dashOf = (d) => DASH[opt(d, 'style')] || [];

  // Per-type user defaults ("Lưu làm mặc định"); migrates the older width / fib stores.
  const DEF_STORE = 'fxlab_draw_defaults';
  const userDefs = JSON.parse(localStorage.getItem(DEF_STORE) || '{}');
  {
    const oldW = JSON.parse(localStorage.getItem('fxlab_draw_width') || '{}');
    for (const [t, w] of Object.entries(oldW)) userDefs[t] = { width: w, ...(userDefs[t] || {}) };
    const oldFib = JSON.parse(localStorage.getItem('fxlab_fib_default') || 'null');
    if (oldFib && !userDefs.fib?.levels) userDefs.fib = { ...(userDefs.fib || {}), ...oldFib };
    localStorage.removeItem('fxlab_draw_width');
    localStorage.removeItem('fxlab_fib_default');
    localStorage.setItem(DEF_STORE, JSON.stringify(userDefs));
  }
  function setUserDef(types, vals) {
    for (const t of types) userDefs[t] = { ...(userDefs[t] || {}), ...JSON.parse(JSON.stringify(vals)) };
    localStorage.setItem(DEF_STORE, JSON.stringify(userDefs));
    if (window.Account) Account.touch();
  }

  const TOOL_HELP = {
    replay: 'Click lên nến muốn bắt đầu replay (các nến sau đó sẽ bị ẩn).',
    price: 'Click lên chart để lấy giá cho lệnh chờ.',
    trend: 'Trendline: click điểm thứ nhất.',
    hline: 'Click lên chart giá, hoặc lên khung indicator (RSI…), để đặt đường ngang.',
    vline: 'Click để đặt đường dọc.',
    rect: 'Rectangle: click góc thứ nhất, rồi click góc đối diện.',
    fib: 'Fib Retracement: click đầu sóng, rồi click cuối sóng.',
    long: 'Long Position: click tại giá vào lệnh. Kéo mép trên vùng xanh = TP, mép dưới vùng đỏ = SL, đường giữa = Entry, mép phải = độ rộng, kéo trong box = di chuyển.',
    short: 'Short Position: click tại giá vào lệnh. Kéo mép vùng xanh = TP, mép vùng đỏ = SL, đường giữa = Entry, mép phải = độ rộng, kéo trong box = di chuyển.',
    measure: 'Đo: click điểm thứ nhất.',
    icon: 'Icon: chọn một biểu tượng trong bảng, rồi click lên chart để đặt.',
  };
  let recentIcons = [];
  try { recentIcons = JSON.parse(localStorage.getItem('fxlab_icon_recent') || '[]'); } catch (e) { recentIcons = []; }
  if (!Array.isArray(recentIcons)) recentIcons = [];
  let placeIcon = (userDefs.icon && userDefs.icon.icon) || '⭐';
  let iconTab = 'emoji';
  let iconPopMode = 'place';
  const iconPop = document.createElement('div');
  iconPop.id = 'icon-pop';
  iconPop.className = 'hidden';
  iconPop.innerHTML = '<div class="icon-pop-tabs"><button type="button" data-icontab="emoji">Emojis</button><button type="button" data-icontab="icon">Icons</button></div><div class="icon-pop-scroll"></div>';
  document.body.appendChild(iconPop);
  function iconButtons(ids, active) {
    return `<div class="icon-grid">${ids.map((id) => {
      const vec = ICONS.find((ic) => ic.id === id);
      return `<button type="button" data-pick="${esc(id)}" class="${id === active ? 'on' : ''}" title="${esc(vec ? vec.name : id)}">${vec ? vec.glyph : id}</button>`;
    }).join('')}</div>`;
  }
  function iconCatalog(active) {
    const parts = [];
    if (recentIcons.length) parts.push(`<div class="icon-pop-label">Dùng gần đây</div>${iconButtons(recentIcons, active)}`);
    for (const g of EMOJI) parts.push(`<div class="icon-pop-label">${g.name}</div>${iconButtons(g.items, active)}`);
    return parts.join('');
  }
  function rememberIcon(id) {
    recentIcons = [id, ...recentIcons.filter((x) => x !== id)].slice(0, 16);
    localStorage.setItem('fxlab_icon_recent', JSON.stringify(recentIcons));
  }
  function renderIconPop() {
    iconPop.querySelectorAll('[data-icontab]').forEach((b) => b.classList.toggle('active', b.dataset.icontab === iconTab));
    const body = iconPop.querySelector('.icon-pop-scroll');
    body.innerHTML = iconTab === 'icon'
      ? `<div class="icon-pop-label">Một màu — đổi màu sau khi đặt</div>${iconButtons(ICONS.map((ic) => ic.id), placeIcon)}`
      : iconCatalog(placeIcon);
    const on = body.querySelector('.on');
    if (on) {
      const er = on.getBoundingClientRect(), sr = body.getBoundingClientRect();
      if (er.top < sr.top || er.bottom > sr.bottom) body.scrollTop += er.top - sr.top - 36;
    }
  }
  function openIconPop(mode) {
    iconPopMode = mode || 'place';
    iconTab = isVectorIcon(placeIcon) ? 'icon' : 'emoji';
    const btn = document.querySelector('[data-tool="icon"]');
    const r = btn.getBoundingClientRect();
    const h = Math.min(520, window.innerHeight - 16);
    iconPop.style.height = h + 'px';
    iconPop.style.left = (r.right + 6) + 'px';
    iconPop.style.top = Math.max(8, Math.min(r.top - 60, window.innerHeight - h - 8)) + 'px';
    iconPop.classList.remove('hidden');
    renderIconPop();
  }
  function closeIconPop() { iconPop.classList.add('hidden'); }
  iconPop.addEventListener('mousedown', (e) => e.stopPropagation());
  iconPop.addEventListener('click', (e) => {
    const tab = e.target.closest('[data-icontab]');
    if (tab) { iconTab = tab.dataset.icontab; renderIconPop(); return; }
    const b = e.target.closest('[data-pick]');
    if (!b) return;
    placeIcon = b.dataset.pick;
    rememberIcon(placeIcon);
    setUserDef(['icon'], { icon: placeIcon });
    if (iconPopMode === 'edit' && sel && sel.type === 'icon') {
      sel.icon = placeIcon;
      closeIconPop();
      renderProps(); dirty(); save();
      return;
    }
    closeIconPop();
    setStatus('Click lên chart để đặt biểu tượng.');
  });
  const HIT = 6;
  const MAGNET_PX = 14;

  let sel = null, hover = null, drag = null, pending = null, measure = null, undoStack = [], redoStack = [];
  function syncHist() {
    $('undo-draw').disabled = undoStack.length === 0;
    $('redo-draw').disabled = redoStack.length === 0;
  }
  function dropRedo() { redoStack = []; syncHist(); }
  function remember(action) {
    undoStack.push(action);
    redoStack = [];
    syncHist();
  }
  let magnet = false, keepTool = false, isDirty = true, lastSig = '';

  // ------------------------------------------------------------ coordinates
  const ts = () => chart.timeScale();
  const paneW = () => ts().width();
  const paneH = () => wrap.clientHeight - ts().height();
  const X = (t) => ts().logicalToCoordinate(timeToLogical(t));
  const Y = (p) => candle.priceToCoordinate(p);
  function xy(pt) {
    const x = X(pt.t), y = Y(pt.p);
    return x == null || y == null ? null : { x, y };
  }
  function pointAt(x, y) {
    let l = ts().coordinateToLogical(x);
    let p = candle.coordinateToPrice(y);
    if (l == null || p == null) return null;
    l = Math.round(l);
    if (magnet && l >= 0 && l < S.end) {
      const b = S.bars[l];
      let best = p, bd = MAGNET_PX;
      for (const v of [b.open, b.high, b.low, b.close]) {
        const dd = Math.abs(Y(v) - y);
        if (dd < bd) { bd = dd; best = v; }
      }
      p = best;
    }
    return { t: logicalToTime(l), p: round(p), l };
  }
  function local(e) {
    const r = wrap.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  // ------------------------------------------------------------ canvas primitives
  function line(x1, y1, x2, y2, color, width = 1, dash = []) {
    ctx.strokeStyle = color; ctx.lineWidth = width; ctx.setLineDash(dash);
    ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
    ctx.setLineDash([]);
  }
  function handle(x, y, color) {
    ctx.fillStyle = THEME.bg; ctx.strokeStyle = color; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.arc(x, y, 4.5, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  }
  function label(str, x, y, color, align = 'left', bg = null) {
    ctx.font = FONT; ctx.textAlign = align; ctx.textBaseline = 'middle';
    if (bg) {
      const w = ctx.measureText(str).width + 10, h = 18;
      const bx = align === 'left' ? x - 5 : align === 'right' ? x - w + 5 : x - w / 2;
      ctx.fillStyle = bg;
      ctx.beginPath();
      if (ctx.roundRect) ctx.roundRect(bx, y - h / 2, w, h, 3); else ctx.rect(bx, y - h / 2, w, h);
      ctx.fill();
    }
    ctx.fillStyle = color;
    ctx.fillText(str, x, y);
  }
  function userText(d, x, y, align = 'left', baseline = 'bottom') {
    const s = opt(d, 'text');
    if (!s) return;
    ctx.font = `${opt(d, 'textSize')}px ${FONT_FAMILY}`;
    ctx.textAlign = align; ctx.textBaseline = baseline;
    ctx.fillStyle = opt(d, 'textColor');
    ctx.fillText(s, x, y);
  }
  function priceTag(p, color, pw) {
    const y = Y(p);
    if (y == null || y < -10 || y > paneH() + 10) return;
    ctx.fillStyle = color;
    ctx.fillRect(pw + 1, y - 9, wrap.clientWidth - pw - 1, 18);
    ctx.font = FONT; ctx.fillStyle = '#fff'; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    ctx.fillText(fmtPrice(p), pw + 6, y);
  }
  function timeTag(t, color, pw, ph) {
    const x = X(t);
    if (x == null || x < 0 || x > pw) return;
    ctx.font = FONT;
    const s = fmt(t), w = ctx.measureText(s).width + 12;
    ctx.fillStyle = color;
    ctx.fillRect(x - w / 2, ph + 1, w, 20);
    ctx.fillStyle = '#fff'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(s, x, ph + 11);
  }
  function drawGlyph(id, x, y, size, color) {
    ctx.save();
    ctx.translate(x, y);
    if (!isVectorIcon(id)) {
      ctx.font = `${size}px "Segoe UI Emoji", "Segoe UI Symbol", "Apple Color Emoji", "Noto Color Emoji", sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(id, 0, size * 0.06);
      ctx.restore();
      return;
    }
    ctx.scale(size / 2, size / 2);
    ctx.fillStyle = color;
    ctx.strokeStyle = color;
    ctx.lineWidth = 0.22;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    const poly = (pts, fill = true) => {
      ctx.beginPath();
      pts.forEach((p, i) => (i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1])));
      ctx.closePath();
      if (fill) ctx.fill(); else ctx.stroke();
    };
    if (id === 'arrowDown' || id === 'arrowLeft' || id === 'arrowRight' || id === 'triangleDown') {
      ctx.rotate(id === 'arrowDown' || id === 'triangleDown' ? Math.PI : id === 'arrowLeft' ? -Math.PI / 2 : Math.PI / 2);
      id = id.startsWith('triangle') ? 'triangleUp' : 'arrowUp';
    }
    if (id === 'arrowUp') poly([[0, -0.95], [0.62, -0.08], [0.26, -0.08], [0.26, 0.95], [-0.26, 0.95], [-0.26, -0.08], [-0.62, -0.08]]);
    else if (id === 'flag') {
      ctx.fillRect(-0.72, -0.92, 0.16, 1.84);
      poly([[-0.56, -0.92], [0.78, -0.52], [-0.56, -0.12]]);
    } else if (id === 'star') {
      const pts = [];
      for (let i = 0; i < 10; i++) {
        const a = -Math.PI / 2 + i * Math.PI / 5, r = i % 2 ? 0.4 : 0.95;
        pts.push([Math.cos(a) * r, Math.sin(a) * r]);
      }
      poly(pts);
    } else if (id === 'check') {
      ctx.beginPath(); ctx.moveTo(-0.72, 0.02); ctx.lineTo(-0.22, 0.58); ctx.lineTo(0.82, -0.62); ctx.stroke();
    } else if (id === 'cross') {
      ctx.beginPath(); ctx.moveTo(-0.62, -0.62); ctx.lineTo(0.62, 0.62); ctx.moveTo(0.62, -0.62); ctx.lineTo(-0.62, 0.62); ctx.stroke();
    } else if (id === 'triangleUp') poly([[0, -0.9], [0.86, 0.72], [-0.86, 0.72]]);
    else if (id === 'circle') { ctx.beginPath(); ctx.arc(0, 0, 0.78, 0, Math.PI * 2); ctx.fill(); }
    else if (id === 'diamond') poly([[0, -0.92], [0.72, 0], [0, 0.92], [-0.72, 0]]);
    ctx.restore();
  }
  function extended(a, b, pw) {
    if (Math.abs(b.x - a.x) < 1e-6) return b;
    const xt = b.x > a.x ? pw + 10 : -10;
    return { x: xt, y: a.y + ((b.y - a.y) / (b.x - a.x)) * (xt - a.x) };
  }

  // ------------------------------------------------------------ geometry per type
  function trendSeg(d, pw) {
    const a = xy(d.pts[0]), b = xy(d.pts[1]);
    if (!a || !b) return null;
    return { a, b, s: opt(d, 'extLeft') ? extended(b, a, pw) : a, e: opt(d, 'extend') ? extended(a, b, pw) : b };
  }
  function rectGeom(d, pw) {
    const a = xy(d.pts[0]), b = xy(d.pts[1]);
    if (!a || !b) return null;
    return {
      L: opt(d, 'extLeft') ? 0 : Math.min(a.x, b.x), R: opt(d, 'extend') ? pw : Math.max(a.x, b.x),
      T: Math.min(a.y, b.y), B: Math.max(a.y, b.y), a, b,
    };
  }
  function fibLevels(d) {
    const p0 = d.pts[0].p, p1 = d.pts[1].p;
    const src = d.levels || FIB.map((f) => ({ ...f, on: true }));
    return src.filter((L) => L.on && Number.isFinite(L.l))
      .map((L) => { const price = p1 + (p0 - p1) * L.l; return { l: L.l, c: d.oneColor || L.c, price, y: Y(price) }; })
      .sort((a, b) => a.l - b.l);
  }
  function fibSpan(d, a, b, pw) {
    const e = fibExt(d);
    return {
      xl: e === 'left' || e === 'both' ? 0 : Math.min(a.x, b.x),
      xr: e === 'right' || e === 'both' ? pw : Math.max(a.x, b.x),
    };
  }
  function posGeom(d) {
    const x1 = X(d.pts[0].t), x2 = X(d.pts[1].t);
    const ye = Y(d.pts[0].p), yt = Y(d.tp), ys = Y(d.sl);
    if ([x1, x2, ye, yt, ys].some((v) => v == null)) return null;
    return { L: Math.min(x1, x2), R: Math.max(x1, x2), ye, yt, ys };
  }
  function posStats(d) {
    const dir = d.type === 'long' ? 1 : -1, e = d.pts[0].p;
    const tpPips = ((d.tp - e) / S.pip) * dir, slPips = ((e - d.sl) / S.pip) * dir;
    const { lots, risk } = sizeFor(e, Math.max(slPips, 0.1));
    return { dir, e, tpPips, slPips, rr: tpPips / slPips, lots, risk, reward: tpPips * pipValue(e) * lots };
  }
  // Scans only bars already revealed (index < S.end), so replay never leaks the future.
  function posOutcome(d) {
    const i0 = barIndexOf(d.pts[0].t), i1 = Math.min(S.end - 1, barIndexOf(d.pts[1].t));
    if (i0 < 0 || i0 >= i1) return null;
    const long = d.type === 'long';
    for (let i = i0 + 1; i <= i1; i++) {
      const b = S.bars[i];
      if (long ? b.low <= d.sl : b.high >= d.sl) return { i, kind: 'sl', price: d.sl };
      if (long ? b.high >= d.tp : b.low <= d.tp) return { i, kind: 'tp', price: d.tp };
    }
    return { i: i1, kind: null, price: S.bars[i1].close };
  }

  function handles(d) {
    const pw = paneW(), ph = paneH();
    switch (d.type) {
      case 'trend': case 'fib': case 'measure':
        return d.pts.map((pt, k) => { const q = xy(pt); return q && { id: k, ...q }; }).filter(Boolean);
      case 'hline': { const y = Y(d.pts[0].p); return y == null ? [] : [{ id: 0, x: pw / 2, y }]; }
      case 'vline': { const x = X(d.pts[0].t); return x == null ? [] : [{ id: 0, x, y: ph / 2 }]; }
      case 'rect': {
        const xs = d.pts.map((pt) => X(pt.t)), ys = d.pts.map((pt) => Y(pt.p));
        if ([...xs, ...ys].some((v) => v == null)) return [];
        const xm = (xs[0] + xs[1]) / 2, ym = (ys[0] + ys[1]) / 2;
        return [
          { id: 'c00', x: xs[0], y: ys[0] }, { id: 'c11', x: xs[1], y: ys[1] },
          { id: 'c01', x: xs[0], y: ys[1] }, { id: 'c10', x: xs[1], y: ys[0] },
          { id: 'x0', x: xs[0], y: ym }, { id: 'x1', x: xs[1], y: ym },
          { id: 'y0', x: xm, y: ys[0] }, { id: 'y1', x: xm, y: ys[1] },
        ];
      }
      case 'long': case 'short': {
        const g = posGeom(d);
        if (!g) return [];
        return [{ id: 'tp', x: g.L, y: g.yt }, { id: 'sl', x: g.L, y: g.ys }, { id: 'entry', x: g.L, y: g.ye }, { id: 'width', x: g.R, y: g.ye }];
      }
      case 'icon': { const q = xy(d.pts[0]); return q ? [{ id: 0, x: q.x, y: q.y }] : []; }
      default: return [];
    }
  }

  function distSeg(px, py, a, b) {
    const dx = b.x - a.x, dy = b.y - a.y, len = dx * dx + dy * dy;
    const t = len ? Math.max(0, Math.min(1, ((px - a.x) * dx + (py - a.y) * dy) / len)) : 0;
    return Math.hypot(px - (a.x + t * dx), py - (a.y + t * dy));
  }
  function bodyHit(d, x, y) {
    const pw = paneW(), ph = paneH();
    switch (d.type) {
      case 'trend': {
        const g = trendSeg(d, pw);
        return !!g && distSeg(x, y, g.s, g.e) <= HIT;
      }
      case 'hline': { const yy = Y(d.pts[0].p); return yy != null && Math.abs(y - yy) <= HIT && x <= pw; }
      case 'vline': { const xx = X(d.pts[0].t); return xx != null && Math.abs(x - xx) <= HIT && y <= ph; }
      case 'rect': {
        const g = rectGeom(d, pw);
        return !!g && x >= g.L - HIT && x <= g.R + HIT && y >= g.T - HIT && y <= g.B + HIT;
      }
      case 'fib': {
        const a = xy(d.pts[0]), b = xy(d.pts[1]);
        if (!a || !b) return false;
        const { xl, xr } = fibSpan(d, a, b, pw);
        if (distSeg(x, y, a, b) <= HIT) return true;
        return x >= xl - HIT && x <= xr + HIT && fibLevels(d).some((L) => L.y != null && Math.abs(y - L.y) <= HIT);
      }
      case 'long': case 'short': {
        const g = posGeom(d);
        return !!g && x >= g.L && x <= g.R && y >= Math.min(g.yt, g.ys) && y <= Math.max(g.yt, g.ys);
      }
      case 'icon': {
        const q = xy(d.pts[0]);
        if (!q) return false;
        const s = iconSize(d) / 2 + 4;
        return Math.abs(x - q.x) <= s && Math.abs(y - q.y) <= s;
      }
      default: return false;
    }
  }
  // Edges of the TP / SL zones, the entry line and the right border resize a position box, like TradingView.
  function posEdgeHit(d, x, y) {
    if (d.type !== 'long' && d.type !== 'short') return null;
    const g = posGeom(d);
    if (!g || x < g.L - HIT || x > g.R + HIT) return null;
    if (Math.abs(y - g.yt) <= HIT) return 'tp';
    if (Math.abs(y - g.ys) <= HIT) return 'sl';
    const top = Math.min(g.yt, g.ys), bot = Math.max(g.yt, g.ys);
    if (Math.abs(x - g.R) <= HIT && y >= top && y <= bot) return 'width';
    if (Math.abs(y - g.ye) <= 4 && x >= g.L && x <= g.R) return 'entryP';
    return null;
  }
  function hitTest(x, y) {
    const order = [...S.drawings].reverse().filter((d) => !d.pane);
    for (const d of order) for (const h of handles(d)) if (Math.hypot(h.x - x, h.y - y) <= HIT + 2) return { d, h: h.id };
    for (const d of order) { const e = posEdgeHit(d, x, y); if (e) return { d, h: e }; }
    for (const d of order) if (bodyHit(d, x, y)) return { d, h: 'body' };
    return null;
  }

  // ------------------------------------------------------------ painting
  const shapeActive = (d) => d === sel || d === pending || d === measure || (drag && drag.d === d) || (hover && hover.d === d);

  function drawShape(d, pw, ph) {
    const active = shapeActive(d);
    const col = colorOf(d);
    switch (d.type) {
      case 'trend': {
        const g = trendSeg(d, pw);
        if (!g) return;
        line(g.s.x, g.s.y, g.e.x, g.e.y, col, widthOf(d), dashOf(d));
        if (opt(d, 'stats')) {
          const pips = (d.pts[1].p - d.pts[0].p) / S.pip, pct = ((d.pts[1].p - d.pts[0].p) / d.pts[0].p) * 100;
          const nb = Math.round(timeToLogical(d.pts[1].t) - timeToLogical(d.pts[0].t));
          label(`${sign(pips)} pip (${sign(pct, 2)}%) · ${nb} nến`, g.b.x + 8, g.b.y + 14, '#fff', 'left', '#1e222dcc');
        }
        userText(d, (g.a.x + g.b.x) / 2, (g.a.y + g.b.y) / 2 - 6, 'center');
        if (active) { handle(g.a.x, g.a.y, col); handle(g.b.x, g.b.y, col); }
        break;
      }
      case 'hline': {
        const y = Y(d.pts[0].p);
        if (y == null) return;
        line(0, y, pw, y, col, widthOf(d), dashOf(d));
        userText(d, 8, y - 4);
        if (active) handle(pw / 2, y, col);
        break;
      }
      case 'vline': {
        const x = X(d.pts[0].t);
        if (x == null) return;
        line(x, 0, x, ph, col, widthOf(d), dashOf(d));
        userText(d, x + 6, 8, 'left', 'top');
        if (active) handle(x, ph / 2, col);
        break;
      }
      case 'rect': {
        const g = rectGeom(d, pw);
        if (!g) return;
        if (opt(d, 'fill')) {
          ctx.fillStyle = hexA(opt(d, 'fillColor'), opt(d, 'fillOpacity') / 100);
          ctx.fillRect(g.L, g.T, g.R - g.L, g.B - g.T);
        }
        ctx.strokeStyle = col; ctx.lineWidth = widthOf(d); ctx.setLineDash(dashOf(d));
        ctx.strokeRect(g.L, g.T, g.R - g.L, g.B - g.T);
        ctx.setLineDash([]);
        const pos = opt(d, 'textPos'), cx = (g.L + g.R) / 2;
        if (pos === 'middle') userText(d, cx, (g.T + g.B) / 2, 'center', 'middle');
        else if (pos === 'bottom') userText(d, cx, g.B - 4, 'center', 'bottom');
        else userText(d, cx, g.T + 4, 'center', 'top');
        if (active) for (const h of handles(d)) handle(h.x, h.y, col);
        break;
      }
      case 'fib': {
        const a = xy(d.pts[0]), b = xy(d.pts[1]);
        if (!a || !b) return;
        const { xl, xr } = fibSpan(d, a, b, pw);
        const lv = fibLevels(d);
        if (d.fill !== false) {
          for (let k = 0; k < lv.length - 1; k++) {
            const A = lv[k], B = lv[k + 1];
            if (A.y == null || B.y == null) continue;
            ctx.fillStyle = hexA(B.c, 0.1);
            ctx.fillRect(xl, Math.min(A.y, B.y), xr - xl, Math.abs(B.y - A.y));
          }
        }
        const showL = d.showLevel !== false, showP = d.showPrice !== false;
        for (const L of lv) {
          if (L.y == null) continue;
          line(xl, L.y, xr, L.y, L.c, widthOf(d));
          const txt = showL && showP ? `${L.l} (${fmtPrice(L.price)})` : showL ? `${L.l}` : showP ? fmtPrice(L.price) : '';
          if (txt) label(txt, Math.max(xl, 0) + 4, L.y - 8, L.c);
        }
        if (d.trend !== false) line(a.x, a.y, b.x, b.y, col, 1, [4, 4]);
        if (active) { handle(a.x, a.y, col); handle(b.x, b.y, col); }
        break;
      }
      case 'long': case 'short': {
        const g = posGeom(d);
        if (!g) return;
        const st = posStats(d);
        const tpC = opt(d, 'tpColor'), slC = opt(d, 'slColor'), alpha = opt(d, 'fillOpacity') / 100;
        ctx.fillStyle = hexA(tpC, alpha);
        ctx.fillRect(g.L, Math.min(g.ye, g.yt), g.R - g.L, Math.abs(g.yt - g.ye));
        ctx.fillStyle = hexA(slC, alpha);
        ctx.fillRect(g.L, Math.min(g.ye, g.ys), g.R - g.L, Math.abs(g.ys - g.ye));
        line(g.L, g.ye, g.R, g.ye, '#9598a1', widthOf(d));
        const out = opt(d, 'outcome') ? posOutcome(d) : null;
        if (out) {
          const xh = ts().logicalToCoordinate(out.i), yh = Y(out.price);
          if (xh != null && yh != null) {
            line(g.L, g.ye, xh, yh, out.kind === 'sl' ? slC : out.kind === 'tp' ? tpC : '#d1d4dc', 1, [4, 3]);
          }
        }
        const cx = (g.L + g.R) / 2, up = (a, b) => (a < b ? -1 : 1);
        if (active || opt(d, 'alwaysStats')) {
          const pctT = Math.abs(d.tp - st.e) / st.e * 100, pctS = Math.abs(st.e - d.sl) / st.e * 100;
          label(`Target: ${st.tpPips.toFixed(1)} pip (${pctT.toFixed(2)}%) · ${money(st.reward)}`, cx, g.yt + 12 * up(g.yt, g.ye), '#fff', 'center', tpC);
          label(`Stop: ${st.slPips.toFixed(1)} pip (${pctS.toFixed(2)}%) · ${money(st.risk)}`, cx, g.ys + 12 * up(g.ys, g.ye), '#fff', 'center', slC);
          label(`${d.type === 'long' ? 'Long' : 'Short'} · R:R ${st.rr.toFixed(2)} · ${st.lots.toFixed(2)} lot`, cx, g.ye, '#fff', 'center', '#2a2e39');
        } else {
          label(`R:R ${st.rr.toFixed(2)}`, cx, g.ye, '#d1d4dc', 'center', '#1e222dcc');
        }
        if (active) for (const h of handles(d)) handle(h.x, h.y, h.id === 'tp' ? tpC : h.id === 'sl' ? slC : '#d1d4dc');
        break;
      }
      case 'icon': {
        const q = xy(d.pts[0]);
        if (!q) return;
        const size = iconSize(d);
        drawGlyph(iconId(d), q.x, q.y, size, col);
        if (active) {
          ctx.strokeStyle = col; ctx.lineWidth = 1; ctx.setLineDash([3, 3]);
          ctx.strokeRect(q.x - size / 2 - 4, q.y - size / 2 - 4, size + 8, size + 8);
          ctx.setLineDash([]);
          handle(q.x, q.y, col);
        }
        break;
      }
      case 'measure': {
        const a = xy(d.pts[0]), b = xy(d.pts[1]);
        if (!a || !b) return;
        const upMove = d.pts[1].p >= d.pts[0].p, c = upMove ? '#2962ff' : '#f23645';
        ctx.fillStyle = hexA(c, 0.15);
        ctx.fillRect(Math.min(a.x, b.x), Math.min(a.y, b.y), Math.abs(b.x - a.x), Math.abs(b.y - a.y));
        line(a.x, (a.y + b.y) / 2, b.x, (a.y + b.y) / 2, c, 1);
        line((a.x + b.x) / 2, a.y, (a.x + b.x) / 2, b.y, c, 1);
        const pips = (d.pts[1].p - d.pts[0].p) / S.pip, pct = ((d.pts[1].p - d.pts[0].p) / d.pts[0].p) * 100;
        const nb = Math.round(timeToLogical(d.pts[1].t) - timeToLogical(d.pts[0].t));
        const ly = upMove ? Math.min(a.y, b.y) - 24 : Math.max(a.y, b.y) + 24;
        label(`${sign(pips)} pip (${sign(pct, 2)}%)`, (a.x + b.x) / 2, ly - 9, '#fff', 'center', c);
        label(`${nb} nến · ${durText(d.pts[1].t - d.pts[0].t)}`, (a.x + b.x) / 2, ly + 9, '#fff', 'center', c);
        break;
      }
      default: break;
    }
  }

  function axisLabels(d, pw, ph) {
    const col = colorOf(d);
    if (d.type === 'hline') { if (opt(d, 'showPrice')) priceTag(d.pts[0].p, col, pw); return; }
    if (d.type === 'vline') { if (opt(d, 'showTime')) timeTag(d.pts[0].t, col, pw, ph); return; }
    if (!shapeActive(d)) return;
    if (d.type === 'long' || d.type === 'short') {
      priceTag(d.tp, opt(d, 'tpColor'), pw); priceTag(d.sl, opt(d, 'slColor'), pw); priceTag(d.pts[0].p, '#2a2e39', pw);
      timeTag(d.pts[0].t, '#2a2e39', pw, ph); timeTag(d.pts[1].t, '#2a2e39', pw, ph);
      return;
    }
    const c = d.type === 'measure' ? '#2962ff' : col;
    for (const pt of d.pts) { priceTag(pt.p, c, pw); timeTag(pt.t, c, pw, ph); }
  }

  const panePriceLines = new Map();
  function priceLineOpts(d) {
    const style = opt(d, 'style');
    return {
      price: d.pts[0].p,
      color: colorOf(d),
      lineWidth: Math.max(1, Math.min(4, Math.round(widthOf(d) || 1))),
      lineStyle: style === 'dotted' ? 1 : style === 'dashed' ? 2 : 0,
      axisLabelVisible: opt(d, 'showPrice') !== false,
      title: '',
    };
  }
  function samePane(a, b) { return Number(a) === Number(b); }

  function paintPaneLines() {
    const hosts = Ind.paneHosts ? Ind.paneHosts() : [];
    const dpr = window.devicePixelRatio || 1;
    const alive = new Set();
    for (const host of hosts) {
      const lines = S.drawings.filter((d) => d.type === 'hline' && samePane(d.pane, host.uid));
      let canvas = host.el.querySelector(':scope > .pane-draw');
      if (!lines.length) { if (canvas) canvas.remove(); }
      else {
        if (!canvas) {
          canvas = document.createElement('canvas');
          canvas.className = 'pane-draw';
          host.el.appendChild(canvas);
        }
        const w = host.el.clientWidth, h = host.el.clientHeight;
        if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
          canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
        }
        const g = canvas.getContext('2d');
        g.setTransform(dpr, 0, 0, dpr, 0, 0);
        g.clearRect(0, 0, w, h);
        const pw = plotEdge(host.chart, host.el);
        for (const d of lines) {
          if (d.id != null) alive.add(d.id);
          if (host.series) {
            const opts = priceLineOpts(d);
            let rec = panePriceLines.get(d.id);
            if (!rec || rec.series !== host.series) {
              if (rec) { try { rec.series.removePriceLine(rec.line); } catch (e) { /* series đã bỏ */ } }
              try {
                rec = { series: host.series, line: host.series.createPriceLine(opts) };
                panePriceLines.set(d.id, rec);
              } catch (e) { rec = null; }
            } else {
              try { rec.line.applyOptions(opts); } catch (e) { /* series đã bỏ */ }
            }
          }
          if (!host.series || pw < 1) continue;
          const y = host.series.priceToCoordinate(d.pts[0].p);
          if (y == null) continue;
          const col = colorOf(d);
          g.strokeStyle = col; g.lineWidth = widthOf(d); g.setLineDash(dashOf(d));
          g.beginPath(); g.moveTo(0, y); g.lineTo(pw, y); g.stroke();
          g.setLineDash([]);
          if (opt(d, 'showPrice') !== false) {
            const label = Number(d.pts[0].p).toFixed(host.prec);
            g.font = FONT; g.fillStyle = col; g.textAlign = 'right'; g.textBaseline = 'bottom';
            g.fillText(label, pw - 4, y - 2);
          }
          const txt = opt(d, 'text');
          if (txt) { g.font = FONT; g.fillStyle = opt(d, 'textColor') || '#d1d4dc'; g.textAlign = 'left'; g.textBaseline = 'bottom'; g.fillText(txt, 8, y - 2); }
          if (shapeActive(d)) {
            g.fillStyle = THEME.bg; g.strokeStyle = col; g.lineWidth = 1.5;
            g.beginPath(); g.arc(pw / 2, y, 4.5, 0, Math.PI * 2); g.fill(); g.stroke();
          }
        }
      }
    }
    for (const [id, rec] of panePriceLines) {
      if (alive.has(id)) continue;
      try { rec.series.removePriceLine(rec.line); } catch (e) { /* series đã bỏ */ }
      panePriceLines.delete(id);
    }
  }

  function paint() {
    const dpr = window.devicePixelRatio || 1, w = wrap.clientWidth, h = wrap.clientHeight;
    for (const [c, g] of [[cv, ctx], [cu, ctxU]]) {
      if (c.width !== Math.round(w * dpr) || c.height !== Math.round(h * dpr)) {
        c.width = Math.round(w * dpr); c.height = Math.round(h * dpr);
      }
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.clearRect(0, 0, w, h);
    }
    if (!S.bars.length) return;
    const pw = paneW(), ph = paneH();
    ctxU.save();
    ctxU.beginPath(); ctxU.rect(0, 0, pw, ph); ctxU.clip();
    Ind.paintUnder(ctxU, pw, ph);
    if (Ind.paintPanes) Ind.paintPanes();
    ctxU.restore();
    const shapes = [...S.drawings, pending, measure].filter((d) => d && !d.pane);
    ctx.save();
    ctx.beginPath(); ctx.rect(0, 0, pw, ph); ctx.clip();
    for (const d of shapes) drawShape(d, pw, ph);
    ctx.restore();
    for (const d of shapes) axisLabels(d, pw, ph);
    paintPaneLines();
  }

  function frame() {
    requestAnimationFrame(frame);
    if (!S.bars.length) return;
    const r = ts().getVisibleLogicalRange();
    const ref = S.bars[0].close;
    const sig = [wrap.clientWidth, wrap.clientHeight, paneW(), r ? r.from.toFixed(3) : '', r ? r.to.toFixed(3) : '',
      Y(ref), Y(ref * 1.01), S.end, S.tf, S.tz, window.devicePixelRatio, Ind.layoutSig ? Ind.layoutSig() : ''].join('|');
    if (sig === lastSig && !isDirty) return;
    lastSig = sig; isDirty = false;
    paint();
  }
  requestAnimationFrame(frame);

  // ------------------------------------------------------------ editing
  function dirty() { isDirty = true; }

  function newDrawing(type, pts) {
    const d = { id: S.drawSeq++, type, pts };
    if (type === 'fib') Object.assign(d, fibFactory());
    Object.assign(d, JSON.parse(JSON.stringify(userDefs[type] || {})));
    return d;
  }
  function commit(d) {
    S.drawings.push(d);
    remember({ kind: 'add', drawing: d });
    select(d);
    save();
  }
  function select(d) {
    sel = d;
    renderProps();
    dirty();
  }

  const widthSelect = (attr, w) =>
    `<select ${attr}>${[1, 2, 3, 4].map((n) => `<option value="${n}"${n === w ? ' selected' : ''}>${n}px</option>`).join('')}</select>`;

  function renderProps() {
    const box = $('draw-props');
    if (!sel) { box.classList.add('hidden'); box.innerHTML = ''; return; }
    const d = sel, parts = [];
    if (d.type !== 'long' && d.type !== 'short' && !(d.type === 'icon' && !isVectorIcon(iconId(d)))) {
      parts.push(`<input type="color" class="sw" data-a="color" value="${colorOf(d)}" title="Màu">`);
    }
    if (d.type === 'icon') {
      parts.push('<button data-a="pick" title="Đổi biểu tượng">Đổi</button>');
      const sz = iconSize(d);
      parts.push(`<select data-a="size" title="Cỡ">${ICON_SIZES.map((n) => `<option value="${n}"${n === sz ? ' selected' : ''}>${n}</option>`).join('')}</select>`);
    } else {
      parts.push(widthSelect('data-a="width" title="Độ dày"', widthOf(d)));
    }
    if (d.type === 'trend') {
      parts.push(`<button data-a="extend" class="${opt(d, 'extend') ? 'active' : ''}" title="Kéo dài sang phải">Kéo dài →</button>`);
    }
    parts.push('<button data-a="settings" title="Cài đặt (hoặc double-click vào hình vẽ)">⚙ Cài đặt</button>');
    if (d.type === 'long' || d.type === 'short') {
      parts.push('<button data-a="flip" title="Đổi Long ↔ Short">⇅ Đảo</button>');
      parts.push('<button data-a="pending" title="Replay: đặt lệnh chờ tại giá Entry, SL/TP theo box">Đặt lệnh chờ</button>');
      parts.push('<button data-a="market" title="Replay: vào lệnh Market ngay, SL/TP theo box">Vào Market</button>');
    }
    parts.push('<button data-a="delete" title="Xóa (Delete)">🗑 Xóa</button>');
    box.innerHTML = parts.join('');
    box.classList.remove('hidden');
  }

  $('draw-props').addEventListener('input', (e) => {
    if (e.target.dataset.a === 'color' && sel) { sel.color = e.target.value; dirty(); saveSoon(); }
  });
  $('draw-props').addEventListener('change', (e) => {
    if (e.target.dataset.a === 'width' && sel) {
      sel.width = +e.target.value;
      setUserDef(sel.type === 'long' || sel.type === 'short' ? ['long', 'short'] : [sel.type], { width: sel.width });
      e.target.blur();
      dirty(); save();
    } else if (e.target.dataset.a === 'size' && sel) {
      sel.size = +e.target.value;
      setUserDef([sel.type], { size: sel.size });
      e.target.blur();
      dirty(); save();
    }
  });
  $('draw-props').addEventListener('click', (e) => {
    const a = e.target.closest('[data-a]')?.dataset.a;
    if (!a || !sel) return;
    if (a === 'extend') { sel.extend = !opt(sel, 'extend'); renderProps(); save(); }
    else if (a === 'pick') openIconPop('edit');
    else if (a === 'settings') openSettings(sel);
    else if (a === 'delete') api.removeSelected();
    else if (a === 'flip') {
      const e0 = sel.pts[0].p;
      sel.type = sel.type === 'long' ? 'short' : 'long';
      [sel.tp, sel.sl] = [round(2 * e0 - sel.tp), round(2 * e0 - sel.sl)];
      save();
    } else if (a === 'pending' || a === 'market') placeFromBox(sel, a === 'market');
    dirty();
  });

  // ------------------------------------------------------------ settings dialogs
  const NAMES = { trend: 'Trendline', hline: 'Đường ngang', vline: 'Đường dọc', rect: 'Rectangle', long: 'Long Position', short: 'Short Position', icon: 'Icon' };
  const F = {
    color: ['color', 'color', 'Màu'],
    width: ['width', 'width', 'Độ dày'],
    style: ['style', 'style', 'Kiểu nét'],
    text: ['text', 'text', 'Nội dung'],
    textColor: ['textColor', 'color', 'Màu chữ'],
    textSize: ['textSize', 'size', 'Cỡ chữ'],
    extLeft: ['extLeft', 'bool', 'Kéo dài sang trái'],
    extend: ['extend', 'bool', 'Kéo dài sang phải'],
  };
  const POS_SPEC = [
    ['Kiểu', [['tpColor', 'color', 'Màu vùng TP'], ['slColor', 'color', 'Màu vùng SL'], ['fillOpacity', 'pct', 'Độ đậm vùng (%)'],
      ['width', 'width', 'Độ dày đường Entry'], ['alwaysStats', 'bool', 'Luôn hiện đầy đủ thông số'], ['outcome', 'bool', 'Hiện đường kết quả (chạm TP/SL)']]],
    ['Tọa độ', 'pos'],
  ];
  const SPEC = {
    trend: [['Kiểu', [F.color, F.width, F.style, F.extLeft, F.extend, ['stats', 'bool', 'Hiện thống kê (pip, %, số nến)']]],
      ['Chữ', [F.text, F.textColor, F.textSize]], ['Tọa độ', 'pts']],
    hline: [['Kiểu', [F.color, F.width, F.style, ['showPrice', 'bool', 'Hiện nhãn giá trên trục']]],
      ['Chữ', [F.text, F.textColor, F.textSize]], ['Tọa độ', 'pts']],
    vline: [['Kiểu', [F.color, F.width, F.style, ['showTime', 'bool', 'Hiện nhãn thời gian trên trục']]],
      ['Chữ', [F.text, F.textColor, F.textSize]]],
    rect: [['Kiểu', [['color', 'color', 'Màu viền'], F.width, F.style, ['fill', 'bool', 'Tô nền'], ['fillColor', 'color', 'Màu nền'],
      ['fillOpacity', 'pct', 'Độ đậm nền (%)'], F.extLeft, F.extend]],
    ['Chữ', [F.text, F.textColor, F.textSize, ['textPos', 'select', 'Vị trí chữ', { top: 'Trên', middle: 'Giữa', bottom: 'Dưới' }]]],
    ['Tọa độ', 'pts']],
    long: POS_SPEC, short: POS_SPEC,
    icon: [['Biểu tượng', 'icons'], ['Kiểu', [['color', 'color', 'Màu'], ['size', 'px', 'Cỡ', ICON_SIZES]]]],
  };
  const STYLE_NAMES = { solid: 'Liền', dashed: 'Nét đứt', dotted: 'Chấm' };
  const SIZES = [10, 11, 12, 14, 16, 20, 24, 28];

  function control([k, type, , extra], v) {
    const opts = (o, cur) => Object.entries(o).map(([val, txt]) => `<option value="${val}"${String(val) === String(cur) ? ' selected' : ''}>${txt}</option>`).join('');
    switch (type) {
      case 'color': return `<input type="color" class="sw" data-k="${k}" value="${v}">`;
      case 'width': return widthSelect(`data-k="${k}"`, v);
      case 'style': return `<select data-k="${k}">${opts(STYLE_NAMES, v)}</select>`;
      case 'size': return `<select data-k="${k}">${opts(Object.fromEntries(SIZES.map((n) => [n, n + 'px'])), v)}</select>`;
      case 'px': return `<select data-k="${k}">${opts(Object.fromEntries((extra || SIZES).map((n) => [n, n + 'px'])), v)}</select>`;
      case 'select': return `<select data-k="${k}">${opts(extra, v)}</select>`;
      case 'bool': return `<input type="checkbox" data-k="${k}"${v ? ' checked' : ''}>`;
      case 'pct': return `<input type="number" min="0" max="100" step="5" data-k="${k}" value="${v}">`;
      default: return `<input type="text" data-k="${k}" value="${esc(v || '')}" placeholder="(không có)">`;
    }
  }
  function iconPicker(cur) {
    const id = cur || placeIcon || 'arrowUp';
    return `<div class="icon-catalog"><div class="icon-pop-label">Icons</div>${iconButtons(ICONS.map((ic) => ic.id), id)}${iconCatalog(id)}<input type="hidden" data-k="icon" value="${esc(id)}"></div>`;
  }
  function coordRows(d, kind) {
    const step = S.pip / 10;
    const row = (k, txt, v) => `<label>${txt}</label><input type="number" step="${step}" data-c="${k}" value="${fmtPrice(v)}">`;
    if (kind === 'pos') return row('entry', 'Giá Entry', d.pts[0].p) + row('tp', 'Giá TP', d.tp) + row('sl', 'Giá SL', d.sl);
    if (d.pts.length === 1) return row('p0', 'Giá', d.pts[0].p);
    return row('p0', 'Giá điểm 1', d.pts[0].p) + row('p1', 'Giá điểm 2', d.pts[1].p);
  }
  function readStyle(body) {
    const v = {};
    body.querySelectorAll('[data-k]').forEach((el) => {
      const k = el.dataset.k;
      if (el.type === 'checkbox') v[k] = el.checked;
      else if (el.tagName === 'SELECT' && /^\d+$/.test(el.value)) v[k] = +el.value;
      else if (el.type === 'number') v[k] = Math.max(0, Math.min(100, +el.value || 0));
      else v[k] = el.value;
    });
    return v;
  }
  function applyCoords(d, body) {
    const c = {};
    body.querySelectorAll('[data-c]').forEach((el) => { c[el.dataset.c] = parseFloat(el.value); });
    if (Object.values(c).some((x) => !Number.isFinite(x))) return 'Giá không hợp lệ.';
    if (c.entry != null) {
      const long = d.type === 'long';
      if (long ? !(c.sl < c.entry && c.entry < c.tp) : !(c.tp < c.entry && c.entry < c.sl)) {
        return long ? 'Long cần SL < Entry < TP.' : 'Short cần TP < Entry < SL.';
      }
      d.pts = [{ t: d.pts[0].t, p: round(c.entry) }, { t: d.pts[1].t, p: round(c.entry) }];
      d.tp = round(c.tp); d.sl = round(c.sl);
      return null;
    }
    d.pts = d.pts.map((pt, i) => (c['p' + i] != null ? { t: pt.t, p: round(c['p' + i]) } : pt));
    return null;
  }

  function openSettings(d) {
    if (d.type === 'fib') { openFibSettings(d); return; }
    const spec = SPEC[d.type];
    if (!spec) return;
    const render = (vals) => {
      const html = spec.map(([title, fields]) => `<div class="ind-group">${title}</div>` + (typeof fields === 'string'
        ? (fields === 'icons' ? iconPicker(vals.icon) : coordRows(d, fields))
        : fields.map((f) => `<label>${f[2]}</label>${control(f, vals[f[0]])}`).join(''))).join('');
      openModal(`${NAMES[d.type]} · Cài đặt`, `<div class="ind-form">${html}</div>
        <div class="modal-actions">
          <button id="ds-factory" title="Trả về kiểu gốc">Khôi phục gốc</button>
          <button id="ds-save-def" title="Các hình vẽ loại này vẽ sau sẽ dùng kiểu này">Lưu làm mặc định</button>
          <span style="flex:1"></span>
          <button id="ds-cancel">Hủy</button><button id="ds-ok" class="active">OK</button>
        </div>`);
      const body = $('modal-body');
      $('ds-cancel').onclick = closeModal;
      body.querySelectorAll('[data-pick]').forEach((btn) => {
        btn.onclick = () => {
          const hid = body.querySelector('[data-k="icon"]');
          if (hid) hid.value = btn.dataset.pick;
          body.querySelectorAll('[data-pick]').forEach((b) => b.classList.toggle('on', b === btn));
        };
      });
      $('ds-factory').onclick = () => render({ ...TYPE_DEF[d.type], text: readStyle(body).text });
      $('ds-save-def').onclick = () => {
        const { text, ...style } = readStyle(body);
        setUserDef(d.type === 'long' || d.type === 'short' ? ['long', 'short'] : [d.type], style);
        setStatus(`Đã lưu làm mặc định cho ${NAMES[d.type]}.`);
      };
      $('ds-ok').onclick = () => {
        const err = applyCoords(d, body);
        if (err) { setStatus(err, true); return; }
        Object.assign(d, readStyle(body));
        closeModal();
        renderProps(); dirty(); save();
      };
    };
    const vals = {};
    for (const [, fields] of spec) if (Array.isArray(fields)) for (const [k] of fields) vals[k] = k === 'width' ? widthOf(d) : opt(d, k);
    if (d.type === 'icon') vals.icon = iconId(d);
    render(vals);
  }

  function fibForm(o, col, width) {
    const EXT = { none: 'Không kéo dài', right: 'Sang phải', left: 'Sang trái', both: 'Hai phía' };
    const chk = (k, v, text) => `<label class="fib-chk"><input type="checkbox" data-f="${k}"${v ? ' checked' : ''}> ${text}</label>`;
    const levels = o.levels.map((L, i) =>
      `<div class="fib-lv"><input type="checkbox" data-lon="${i}"${L.on ? ' checked' : ''}>` +
      `<input type="number" step="0.001" data-lv="${i}" value="${L.l}">` +
      `<input type="color" class="sw" data-lc="${i}" value="${L.c}"></div>`).join('');
    return `<div class="fib-form">
      <div class="fib-opts">
        <div>${chk('trend', o.trend, 'Đường xu hướng')} <input type="color" class="sw" data-f="color" value="${col}"></div>
        <div><label>Độ dày mức</label> ${widthSelect('data-f="width"', width)}</div>
        <div><label>Kéo dài</label> <select data-f="ext">${Object.entries(EXT).map(([k, v]) => `<option value="${k}"${k === o.ext ? ' selected' : ''}>${v}</option>`).join('')}</select></div>
        <div>${chk('fill', o.fill, 'Tô nền')}</div>
        <div>${chk('showLevel', o.showLevel, 'Hiện mức')} ${chk('showPrice', o.showPrice, 'Hiện giá')}</div>
        <div>${chk('useOne', !!o.oneColor, 'Dùng một màu')} <input type="color" class="sw" data-f="oneColor" value="${o.oneColor || '#2962ff'}"></div>
      </div>
      <div class="fib-levels">${levels}</div>
      <div class="modal-actions">
        <button id="fib-factory" title="Trả về bộ mức gốc">Khôi phục gốc</button>
        <button id="fib-save-def" title="Các Fib vẽ sau sẽ dùng thông số này">Lưu làm mặc định</button>
        <span style="flex:1"></span>
        <button id="fib-cancel">Hủy</button><button id="fib-ok" class="active">OK</button>
      </div></div>`;
  }
  function readFibForm(body) {
    const f = (k) => body.querySelector(`[data-f="${k}"]`);
    return {
      levels: [...body.querySelectorAll('[data-lv]')].map((el) => {
        const i = el.dataset.lv;
        return { l: parseFloat(el.value), c: body.querySelector(`[data-lc="${i}"]`).value, on: body.querySelector(`[data-lon="${i}"]`).checked };
      }).filter((L) => Number.isFinite(L.l)),
      trend: f('trend').checked, fill: f('fill').checked, showLevel: f('showLevel').checked, showPrice: f('showPrice').checked,
      ext: f('ext').value, oneColor: f('useOne').checked ? f('oneColor').value : null,
      color: f('color').value, width: +f('width').value,
    };
  }
  function openFibSettings(d) {
    const cur = d.levels ? d : { ...fibFactory(), ext: fibExt(d) };
    const o = JSON.parse(JSON.stringify({
      levels: cur.levels, trend: cur.trend !== false, fill: cur.fill !== false,
      showLevel: cur.showLevel !== false, showPrice: cur.showPrice !== false, ext: fibExt(cur), oneColor: cur.oneColor || null,
    }));
    const render = (opts, col, width) => {
      openModal('Fib Retracement · Cài đặt', fibForm(opts, col, width));
      const body = $('modal-body');
      $('fib-cancel').onclick = closeModal;
      $('fib-factory').onclick = () => { const v = readFibForm(body); render(fibFactory(), v.color, v.width); };
      $('fib-save-def').onclick = () => {
        setUserDef(['fib'], readFibForm(body));
        setStatus('Đã lưu làm mặc định cho Fib vẽ sau.');
      };
      $('fib-ok').onclick = () => {
        Object.assign(d, readFibForm(body));
        delete d.extend;
        closeModal();
        renderProps(); dirty(); save();
      };
    };
    render(o, colorOf(d), widthOf(d));
  }

  // ------------------------------------------------------------ dragging
  function applyDrag(x, y) {
    const d = drag.d, o = drag.orig;
    if (drag.h === 'body') {
      const l = ts().coordinateToLogical(x), p = candle.coordinateToPrice(y);
      if (l == null || p == null) return;
      const dl = Math.round(l - drag.start.l), dp = p - drag.start.p;
      d.pts = o.pts.map((q) => ({
        t: d.type === 'hline' ? q.t : logicalToTime(Math.round(timeToLogical(q.t)) + dl),
        p: d.type === 'vline' ? q.p : round(q.p + dp),
      }));
      if (o.tp != null) { d.tp = round(o.tp + dp); d.sl = round(o.sl + dp); }
      return;
    }
    const pt = pointAt(x, y);
    if (!pt) return;
    if (d.type === 'long' || d.type === 'short') {
      const long = d.type === 'long', e0 = d.pts[0].p, m = S.pip;
      if (drag.h === 'tp') d.tp = round(long ? Math.max(pt.p, e0 + m) : Math.min(pt.p, e0 - m));
      else if (drag.h === 'sl') d.sl = round(long ? Math.min(pt.p, e0 - m) : Math.max(pt.p, e0 + m));
      else if (drag.h === 'entryP') {
        const lo = long ? d.sl + m : d.tp + m, hi = long ? d.tp - m : d.sl - m;
        const p = round(Math.min(Math.max(pt.p, lo), hi));
        d.pts = [{ t: d.pts[0].t, p }, { t: d.pts[1].t, p }];
      } else if (drag.h === 'entry') {
        const lo = long ? d.sl + m : d.tp + m, hi = long ? d.tp - m : d.sl - m;
        const t = pt.l < timeToLogical(d.pts[1].t) ? pt.t : d.pts[0].t;
        d.pts[0] = { t, p: round(Math.min(Math.max(pt.p, lo), hi)) };
        d.pts[1] = { t: d.pts[1].t, p: d.pts[0].p };
      } else if (drag.h === 'width' && pt.l > timeToLogical(d.pts[0].t)) {
        d.pts[1] = { t: pt.t, p: d.pts[0].p };
      }
      return;
    }
    if (d.type === 'rect') {
      const h = String(drag.h), setT = (i) => { d.pts[i] = { t: pt.t, p: d.pts[i].p }; }, setP = (j) => { d.pts[j] = { t: d.pts[j].t, p: pt.p }; };
      if (h[0] === 'c') { setT(+h[1]); setP(+h[2]); } else if (h[0] === 'x') setT(+h[1]); else if (h[0] === 'y') setP(+h[1]);
      return;
    }
    if (d.type === 'hline') { d.pts[0] = { t: d.pts[0].t, p: pt.p }; return; }
    if (d.type === 'vline') { d.pts[0] = { t: pt.t, p: d.pts[0].p }; return; }
    d.pts[drag.h] = { t: pt.t, p: pt.p };
  }

  function onToolClick(x, y) {
    const pt = pointAt(x, y);
    if (!pt) return;
    const tool = S.tool;
    if (tool === 'replay') { api.setTool(null); startReplayAt(Math.max(0, Math.min(S.end - 1, pt.l))); return; }
    if (tool === 'price') { $('oprice').value = fmtPrice(pt.p); api.setTool(null); updateLotPreview(); return; }
    const P = { t: pt.t, p: pt.p };
    if (POINTS[tool] === 2) {
      if (!pending) {
        pending = tool === 'measure' ? { type: 'measure', pts: [P, { ...P }] } : newDrawing(tool, [P, { ...P }]);
        measure = null;
        setStatus(tool === 'rect' ? 'Click góc đối diện.' : 'Click điểm thứ hai.');
        dirty();
        return;
      }
      pending.pts[1] = P;
      const done = pending;
      pending = null;
      if (done.pts[0].t === done.pts[1].t && done.pts[0].p === done.pts[1].p) {
        setStatus('Hai điểm trùng nhau, hãy vẽ lại.', true);
        dirty();
        return;
      }
      if (done.type === 'measure') { measure = done; dirty(); } else commit(done);
    } else if (tool === 'hline' || tool === 'vline') {
      commit(newDrawing(tool, [P]));
    } else if (tool === 'icon') {
      const d = newDrawing(tool, [P]);
      d.icon = placeIcon;
      rememberIcon(placeIcon);
      commit(d);
    } else if (tool === 'long' || tool === 'short') {
      // Sized to the current view (as TradingView does), keeping the TP:SL ratio from the order settings.
      const dir = tool === 'long' ? 1 : -1;
      const ph = paneH(), pAt = (yy) => candle.coordinateToPrice(yy);
      const span = Math.abs(pAt(0) - pAt(ph)) || 100 * S.pip;
      const slDist = Math.max(S.pip, Math.round((span * 0.08) / S.pip) * S.pip);
      const ratio = S.settings.sl > 0 && S.settings.tp > 0 ? S.settings.tp / S.settings.sl : 2;
      const spacing = Math.abs(ts().logicalToCoordinate(1) - ts().logicalToCoordinate(0)) || 6;
      const bars = Math.max(5, Math.round((paneW() * 0.12) / spacing));
      const d = newDrawing(tool, [P, { t: logicalToTime(pt.l + bars), p: P.p }]);
      d.sl = round(P.p - dir * slDist);
      d.tp = round(P.p + dir * slDist * ratio);
      commit(d);
    }
    if (!keepTool) api.setTool(null);
  }

  function hitPaneLine(hit) {
    if (!hit || !hit.series) return null;
    for (const d of [...S.drawings].reverse()) {
      if (d.type !== 'hline' || !samePane(d.pane, hit.uid)) continue;
      const y = hit.series.priceToCoordinate(d.pts[0].p);
      if (y != null && Math.abs(y - hit.y) <= HIT) return d;
    }
    return null;
  }
  function setPaneCursor(kind) {
    const root = $('panes');
    root.classList.toggle('cur-ns', kind === 'ns');
    root.classList.toggle('cur-draw', kind === 'draw');
  }

  // ------------------------------------------------------------ mouse
  wrap.addEventListener('mousedown', (e) => {
    if (e.button !== 0 || e.target.closest('#legend .lg-row, #btn-ind-legend, #draw-props, .price-plus, #price-plus-menu')) return;
    const { x, y } = local(e);
    if (x > paneW() || y > paneH()) return;
    // preventDefault below keeps focus on the last input/select, which would swallow Delete / arrow keys.
    if (document.activeElement && document.activeElement !== document.body) document.activeElement.blur();
    if (measure && !S.tool) { measure = null; dirty(); }
    if (S.tool) { e.preventDefault(); e.stopPropagation(); onToolClick(x, y); return; }
    const hit = hitTest(x, y);
    if (hit) {
      e.preventDefault(); e.stopPropagation();
      select(hit.d);
      drag = {
        d: hit.d, h: hit.h, moved: false, orig: JSON.parse(JSON.stringify(hit.d)),
        start: { l: ts().coordinateToLogical(x), p: candle.coordinateToPrice(y) },
      };
      return;
    }
    if (sel) select(null);
  }, true);

  $('panes').addEventListener('mousedown', (e) => {
    if (e.button !== 0 || e.target.closest('.pane-grip, .lg-row, button, .price-plus')) return;
    const hit = Ind.hitPane(e.clientX, e.clientY);
    if (!hit) return;
    if (document.activeElement && document.activeElement !== document.body) document.activeElement.blur();
    if (S.tool === 'hline') {
      if (hit.price == null) return;
      e.preventDefault();
      e.stopPropagation();
      const d = newDrawing('hline', [{ t: 0, p: hit.price }]);
      d.pane = hit.uid;
      commit(d);
      if (!keepTool) api.setTool(null);
      return;
    }
    if (S.tool) return;
    const found = hitPaneLine(hit);
    if (!found) { if (sel && sel.pane) select(null); return; }
    e.preventDefault();
    e.stopPropagation();
    select(found);
    drag = { d: found, h: 0, moved: false, orig: JSON.parse(JSON.stringify(found)) };
  }, true);

  $('panes').addEventListener('dblclick', (e) => {
    if (S.tool || e.target.closest('.pane-grip, .lg-row')) return;
    const found = hitPaneLine(Ind.hitPane(e.clientX, e.clientY));
    if (!found) return;
    e.preventDefault();
    e.stopPropagation();
    select(found);
    openSettings(found);
  }, true);

  $('panes').addEventListener('contextmenu', (e) => {
    if (S.tool || e.target.closest('.pane-grip, .lg-row')) return;
    const found = hitPaneLine(Ind.hitPane(e.clientX, e.clientY));
    if (!found) return;
    e.preventDefault();
    select(found);
  });

  window.addEventListener('mousemove', (e) => {
    if (drag && drag.d && drag.d.pane) {
      const g = Ind.paneGeom(drag.d.pane);
      if (g && g.series) {
        const price = g.series.coordinateToPrice(e.clientY - g.top);
        if (price != null) drag.d.pts[0].p = price;
      }
      drag.moved = true;
      dirty();
      setPaneCursor('ns');
      return;
    }
    const { x, y } = local(e);
    if (drag) { applyDrag(x, y); drag.moved = true; dirty(); return; }
    const inside = e.target instanceof Element && wrap.contains(e.target) && x >= 0 && y >= 0 && x <= paneW() && y <= paneH() && !e.target.closest('#legend .lg-row, #draw-props');
    if (pending && inside) {
      const pt = pointAt(x, y);
      if (pt) { pending.pts[1] = { t: pt.t, p: pt.p }; dirty(); }
    }
    const h = !S.tool && inside ? hitTest(x, y) : null;
    if ((h && h.d) !== (hover && hover.d) || (h && h.h) !== (hover && hover.h)) { hover = h; dirty(); }
    setCursor(S.tool && inside ? 'draw' : drag ? cursorFor(drag.h) : h ? cursorFor(h.h) : null);
    const over = e.target instanceof Element && e.target.closest('#panes') ? Ind.hitPane(e.clientX, e.clientY) : null;
    if (over && S.tool === 'hline') setPaneCursor('draw');
    else if (over && !S.tool && hitPaneLine(over)) setPaneCursor('ns');
    else setPaneCursor(null);
  });
  function cursorFor(id) {
    if (id === 'body') return 'move';
    if (id === 'tp' || id === 'sl' || id === 'entryP' || id === 'y0' || id === 'y1') return 'ns';
    if (id === 'width' || id === 'x0' || id === 'x1') return 'ew';
    return 'handle';
  }
  function setCursor(kind) {
    for (const k of ['draw', 'move', 'handle', 'ns', 'ew']) wrap.classList.toggle('cur-' + k, k === kind);
  }

  wrap.addEventListener('dblclick', (e) => {
    const { x, y } = local(e);
    const hit = !S.tool && x <= paneW() && y <= paneH() ? hitTest(x, y) : null;
    if (!hit) return;
    e.preventDefault(); e.stopPropagation();
    select(hit.d);
    openSettings(hit.d);
  }, true);

  wrap.addEventListener('contextmenu', (e) => {
    const { x, y } = local(e);
    const hit = !S.tool && x <= paneW() && y <= paneH() ? hitTest(x, y) : null;
    if (!hit) return;
    e.preventDefault();
    select(hit.d);
  });

  window.addEventListener('mouseup', () => {
    if (!drag) return;
    if (drag.moved) { dropRedo(); save(); }
    drag = null;
    dirty();
  });

  let plusTarget = null;
  const plusMenu = document.createElement('div');
  plusMenu.id = 'price-plus-menu';
  plusMenu.className = 'hidden';
  document.body.appendChild(plusMenu);
  function hidePlusMenu() {
    plusMenu.classList.add('hidden');
    document.querySelectorAll('.price-plus.open').forEach((b) => b.classList.remove('open'));
  }
  function levelText(price, digits) {
    return Number(price).toFixed(digits == null ? S.digits : digits);
  }
  function placeHline(price, paneUid, digits) {
    const d = newDrawing('hline', [{ t: 0, p: +levelText(price, digits) }]);
    if (paneUid) d.pane = paneUid;
    commit(d);
    hidePlusMenu();
  }
  function openPlusMenu(btn, price, paneUid, digits) {
    const label = levelText(price, digits);
    plusMenu.innerHTML = `<button type="button">Vẽ đường ngang tại ${label}<kbd>Alt+H</kbd></button>`;
    const r = btn.getBoundingClientRect();
    plusMenu.style.left = Math.max(8, r.left - 268) + 'px';
    plusMenu.style.top = Math.max(8, r.top - 4) + 'px';
    plusMenu.classList.remove('hidden');
    btn.classList.add('open');
    plusMenu.querySelector('button').onclick = (e) => {
      e.stopPropagation();
      placeHline(price, paneUid, digits);
    };
  }
  function plotEdge(hostChart, parent) {
    const tw = hostChart.timeScale().width();
    if (tw > 40) return tw;
    let scaleW = 80;
    try {
      const w = hostChart.priceScale('right').width();
      if (w > 0) scaleW = w;
    } catch (e) { /* thang giá chưa đo */ }
    return Math.max(0, parent.clientWidth - scaleW);
  }
  function movePlus(btn, hostChart, series, parent, paneUid, digits, y) {
    const price = series.coordinateToPrice(y);
    if (price == null || !Number.isFinite(price)) return false;
    plusTarget = { price, paneUid, digits };
    btn._price = price;
    // TradingView puts the + on the chart, just left of the price scale, so the price itself stays clickable.
    btn.style.left = Math.max(0, plotEdge(hostChart, parent) - 22 - 6) + 'px';
    btn.style.top = Math.max(0, y - 11) + 'px';
    btn.classList.remove('hidden');
    return true;
  }
  function attachPlus(hostChart, series, parent, paneUid, digits) {
    if (!series || parent.querySelector(':scope > .price-plus')) return;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'price-plus hidden';
    btn.textContent = '+';
    btn.title = 'Vẽ đường ngang tại mức này';
    parent.appendChild(btn);
    const boxOf = () => (parent.querySelector('.pane-chart, #chart') || parent).getBoundingClientRect();
    parent.addEventListener('pointermove', (e) => {
      if (btn.classList.contains('open') || e.target.closest('.pane-grip')) return;
      movePlus(btn, hostChart, series, parent, paneUid, digits, e.clientY - boxOf().top);
    });
    parent.addEventListener('pointerleave', (e) => {
      if (e.relatedTarget && (parent.contains(e.relatedTarget) || plusMenu.contains(e.relatedTarget))) return;
      if (!btn.classList.contains('open')) btn.classList.add('hidden');
    });
    hostChart.subscribeCrosshairMove((param) => {
      if (btn.classList.contains('open') || !param.point || param.point.y == null) return;
      movePlus(btn, hostChart, series, parent, paneUid, digits, param.point.y);
    });
    btn.addEventListener('mousedown', (e) => { e.preventDefault(); e.stopPropagation(); });
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (btn._price == null) return;
      openPlusMenu(btn, btn._price, paneUid, digits);
    });
  }
  document.addEventListener('mousedown', (e) => {
    if (e.target.closest('#price-plus-menu, .price-plus')) return;
    hidePlusMenu();
  });

  // ------------------------------------------------------------ public api
  const api = {
    dirty,
    dropPane(uid) {
      const gone = S.drawings.some((d) => samePane(d.pane, uid));
      if (!gone) return;
      S.drawings = S.drawings.filter((d) => !samePane(d.pane, uid));
      if (sel && sel.pane === uid) select(null);
      save();
      dirty();
    },
    reset() { sel = hover = drag = pending = measure = null; undoStack = []; redoStack = []; renderProps(); dirty(); syncHist(); },
    refreshProps() { renderProps(); },
    setTool(t) {
      S.tool = S.tool === t ? null : t;
      pending = null;
      document.querySelectorAll('[data-tool]').forEach((b) => b.classList.toggle('active', b.dataset.tool === S.tool));
      if (S.tool === 'icon') openIconPop('place');
      else closeIconPop();
      if (S.tool) setStatus(TOOL_HELP[S.tool] || '');
      dirty();
    },
    escape() {
      if (pending || S.tool) { pending = null; if (S.tool) api.setTool(S.tool); return; }
      if (measure) { measure = null; dirty(); return; }
      if (sel) select(null);
    },
    removeSelected() {
      if (!sel) return false;
      const index = S.drawings.indexOf(sel);
      const drawing = sel;
      S.drawings = S.drawings.filter((d) => d !== drawing);
      remember({ kind: 'remove', drawing, index });
      select(null);
      save();
      return true;
    },
    undo() {
      const a = undoStack.pop();
      if (!a) return;
      if (a.kind === 'add') {
        S.drawings = S.drawings.filter((d) => d !== a.drawing);
        if (sel === a.drawing) select(null);
      } else if (a.kind === 'remove') {
        S.drawings.splice(Math.max(0, Math.min(a.index, S.drawings.length)), 0, a.drawing);
        select(a.drawing);
      } else if (a.kind === 'clear') {
        S.drawings = a.drawings;
      }
      redoStack.push(a);
      dirty(); save(); syncHist();
    },
    redo() {
      const a = redoStack.pop();
      if (!a) return;
      if (a.kind === 'add') {
        S.drawings.push(a.drawing);
        select(a.drawing);
      } else if (a.kind === 'remove') {
        S.drawings = S.drawings.filter((d) => d !== a.drawing);
        if (sel === a.drawing) select(null);
      } else if (a.kind === 'clear') {
        S.drawings = [];
        select(null);
      }
      undoStack.push(a);
      dirty(); save(); syncHist();
    },
    clear() {
      if (!S.drawings.length) return;
      const drawings = S.drawings.slice();
      S.drawings = [];
      remember({ kind: 'clear', drawings });
      select(null);
      save();
    },
    toggleMagnet() { magnet = !magnet; return magnet; },
    toggleKeep() { keepTool = !keepTool; return keepTool; },
    attachPlus,
    hlineAtCursor() {
      if (!plusTarget) return;
      placeHline(plusTarget.price, plusTarget.paneUid, plusTarget.digits);
    },
  };
  attachPlus(chart, candle, wrap, null, null);
  return api;
})();
window.Draw = Draw;
