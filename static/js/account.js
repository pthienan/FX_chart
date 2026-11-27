'use strict';
// Email login. The journal (trades, order settings, drawings, indicators) is stored per account.

const Account = (() => {
  let email = '';
  let timer = null;

  function canon(value) {
    if (Array.isArray(value)) return '[' + value.map(canon).join(',') + ']';
    if (value && typeof value === 'object') {
      return '{' + Object.keys(value).sort().map((key) => JSON.stringify(key) + ':' + canon(value[key])).join(',') + '}';
    }
    return JSON.stringify(value);
  }

  function snapshot() {
    const symbols = {};
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key || !key.startsWith('fxlab_')) continue;
      const name = key.slice(6);
      if (!/^[A-Z0-9]{6}$/.test(name)) continue;
      try { symbols[name] = JSON.parse(localStorage.getItem(key)); } catch (e) { /* bỏ qua mục hỏng */ }
    }
    let indicators = null;
    let drawDefaults = {};
    try { indicators = JSON.parse(localStorage.getItem('fxlab_indicators') || 'null'); } catch (e) { indicators = null; }
    try { drawDefaults = JSON.parse(localStorage.getItem('fxlab_draw_defaults') || '{}'); } catch (e) { drawDefaults = {}; }
    return {
      symbol: localStorage.getItem('fxlab_symbol') || '',
      tz: localStorage.getItem('fxlab_tz'),
      sideHidden: localStorage.getItem('fxlab_side_hidden') === '1',
      indicators, drawDefaults, symbols,
    };
  }

  function applyProfile(profile) {
    const keys = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.startsWith('fxlab_')) keys.push(key);
    }
    for (const key of keys) localStorage.removeItem(key);
    if (profile.symbol) localStorage.setItem('fxlab_symbol', profile.symbol);
    if (profile.tz != null && profile.tz !== '') localStorage.setItem('fxlab_tz', String(profile.tz));
    localStorage.setItem('fxlab_side_hidden', profile.sideHidden ? '1' : '');
    if (profile.indicators) localStorage.setItem('fxlab_indicators', JSON.stringify(profile.indicators));
    localStorage.setItem('fxlab_draw_defaults', JSON.stringify(profile.drawDefaults || {}));
    for (const [sym, state] of Object.entries(profile.symbols || {})) {
      if (/^[A-Z0-9]{6}$/.test(sym) && state && typeof state === 'object') {
        localStorage.setItem('fxlab_' + sym, JSON.stringify(state));
      }
    }
  }

  function paint() {
    const btn = $('btn-account');
    if (!btn) return;
    btn.textContent = email || 'Tài khoản';
    btn.title = email
      ? `${email} — nhật ký, thông số và indicator được lưu theo tài khoản`
      : 'Đăng nhập bằng email để giữ nhật ký, thông số và indicator khi đổi máy';
  }

  async function call(path, method, body) {
    let response;
    try {
      response = await fetch('/api/account/' + path, {
        method, credentials: 'same-origin',
        headers: body ? { 'Content-Type': 'application/json' } : {},
        body: body ? JSON.stringify(body) : undefined,
        keepalive: method === 'PUT',
      });
    } catch (e) {
      throw new Error('Không kết nối được máy chủ tài khoản');
    }
    const payload = await response.json().catch(() => ({}));
    if (response.status === 404) throw new Error('Bản này chưa có chỗ lưu tài khoản.');
    if (!response.ok) throw new Error(payload.error || 'Lỗi tài khoản');
    return payload;
  }

  function touch() {
    if (!email) return;
    clearTimeout(timer);
    timer = setTimeout(flush, 800);
  }

  async function flush() {
    clearTimeout(timer);
    timer = null;
    if (!email) return;
    try { await call('profile', 'PUT', { profile: snapshot() }); }
    catch (e) { setStatus(`Không lưu được tài khoản: ${e.message}`, true); }
  }

  async function prepare() {
    paint();
    try {
      const me = await call('me', 'GET');
      email = me.email;
      paint();
      if (me.profile && canon(me.profile) !== canon(snapshot())) {
        applyProfile(me.profile);
        location.reload();
        return new Promise(() => {});
      }
    } catch (e) {
      email = '';
      paint();
    }
  }

  function showError(message) {
    const el = $('acc-msg');
    if (el) el.textContent = message;
  }

  function open() {
    if (email) {
      openModal('Tài khoản', `
        <p>Đang đăng nhập <b>${esc(email)}</b>.</p>
        <p class="muted">Nhật ký lệnh, thông số đặt lệnh, hình vẽ và indicator của tài khoản này được dùng lại khi đăng nhập trên máy khác.</p>
        <div class="modal-actions"><button id="acc-logout" class="active">Đăng xuất</button></div>
        <div id="acc-msg" class="acc-msg neg"></div>`);
      $('acc-logout').addEventListener('click', logout);
      return;
    }
    openModal('Đăng nhập', `
      <div class="form">
        <label class="full">Email<input id="acc-email" type="email" autocomplete="username"></label>
        <label class="full">Mật khẩu<input id="acc-pass" type="password" autocomplete="current-password"></label>
      </div>
      <p class="muted">Dùng cùng email và mật khẩu ở máy công ty và máy nhà. Lần đầu bấm Tạo tài khoản: bản nhật ký đang có trên máy này được lưu vào tài khoản.</p>
      <div class="modal-actions">
        <button id="acc-register">Tạo tài khoản</button>
        <button id="acc-login" class="active">Đăng nhập</button>
      </div>
      <div id="acc-msg" class="acc-msg neg"></div>`);
    $('acc-login').addEventListener('click', () => submit('login'));
    $('acc-register').addEventListener('click', () => submit('register'));
    $('acc-pass').addEventListener('keydown', (e) => { if (e.key === 'Enter') submit('login'); });
    $('acc-email').focus();
  }

  async function submit(kind) {
    const address = $('acc-email').value;
    const password = $('acc-pass').value;
    $('acc-login').disabled = true;
    $('acc-register').disabled = true;
    try {
      const result = await call(kind, 'POST', { email: address, password });
      email = result.email;
      if (result.profile) applyProfile(result.profile);
      location.reload();
    } catch (e) {
      showError(e.message);
      $('acc-login').disabled = false;
      $('acc-register').disabled = false;
    }
  }

  async function logout() {
    try { await call('logout', 'POST'); } catch (e) { showError(e.message); return; }
    email = '';
    const keys = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.startsWith('fxlab_')) keys.push(key);
    }
    for (const key of keys) localStorage.removeItem(key);
    location.reload();
  }

  $('btn-account').addEventListener('click', open);
  return { prepare, touch, flush };
})();
window.Account = Account;
