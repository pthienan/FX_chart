// Email login for the public site. The journal is one JSON document per user in KV binding FXLAB.
const TTL = 90 * 24 * 3600;
const MAX_FAILS = 10;
const FAIL_WINDOW = 3600;
const MAX_PROFILE = 1500000;

function json(body, status = 200, extra = {}) {
  const headers = { "content-type": "application/json; charset=utf-8", ...extra };
  return new Response(JSON.stringify(body), { status, headers });
}

function emailOf(value) {
  const text = String(value || "").trim().toLowerCase();
  if (text.includes(" ") || (text.match(/@/g) || []).length !== 1 || text.startsWith("@") || text.endsWith("@") || text.length < 6 || text.length > 120) {
    return null;
  }
  return text;
}

function cookie(request, name) {
  const header = request.headers.get("Cookie") || "";
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq < 0) continue;
    if (part.slice(0, eq).trim() === name) return part.slice(eq + 1).trim();
  }
  return "";
}

function setCookie(token, https) {
  const parts = [`fxlab_session=${token}`, "HttpOnly", "Path=/", "SameSite=Lax", `Max-Age=${TTL}`];
  if (https) parts.push("Secure");
  return parts.join("; ");
}

async function sha256hex(bytes) {
  const buf = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function userId(email) {
  return (await sha256hex(new TextEncoder().encode(email))).slice(0, 32);
}

async function hashPassword(password, salt) {
  const pass = new TextEncoder().encode(password);
  const bytes = new Uint8Array(salt.length + 1 + pass.length);
  bytes.set(salt, 0);
  bytes[salt.length] = 0;
  bytes.set(pass, salt.length + 1);
  return sha256hex(bytes);
}

function checkProfile(profile) {
  if (!profile || typeof profile !== "object" || Array.isArray(profile)) return "Nhật ký không hợp lệ";
  const allowed = new Set(["symbol", "tz", "sideHidden", "indicators", "drawDefaults", "symbols"]);
  for (const key of Object.keys(profile)) if (!allowed.has(key)) return "Nhật ký không hợp lệ";
  const symbols = profile.symbols || {};
  if (typeof symbols !== "object" || Array.isArray(symbols)) return "Nhật ký không hợp lệ";
  for (const [key, value] of Object.entries(symbols)) {
    if (!/^[A-Z0-9]{6}$/.test(key) || !value || typeof value !== "object" || Array.isArray(value)) return "Nhật ký không hợp lệ";
  }
  if (profile.indicators != null && !Array.isArray(profile.indicators)) return "Nhật ký không hợp lệ";
  if (profile.drawDefaults != null && (typeof profile.drawDefaults !== "object" || Array.isArray(profile.drawDefaults))) return "Nhật ký không hợp lệ";
  if (JSON.stringify(profile).length > MAX_PROFILE) return "Nhật ký quá lớn";
  return "";
}

async function readUser(kv, email) {
  return kv.get("user:" + await userId(email), "json");
}

async function writeUser(kv, email, rec) {
  await kv.put("user:" + await userId(email), JSON.stringify(rec));
}

export async function onRequest(context) {
  const { request, env } = context;
  if (!env.FXLAB) return json({ error: "Kho tài khoản chưa được gắn trên Cloudflare." }, 500);
  const route = new URL(request.url).pathname.replace(/\/+$/, "").split("/").pop();
  const https = new URL(request.url).protocol === "https:";
  try {
    if (route === "register" && request.method === "POST") return await register(request, env, https);
    if (route === "login" && request.method === "POST") return await login(request, env, https);
    if (route === "logout" && request.method === "POST") return await logout(request, env);
    if (route === "me" && request.method === "GET") return await me(request, env);
    if (route === "profile" && request.method === "PUT") return await save(request, env);
    return json({ error: "Không có đường dẫn này" }, 404);
  } catch (err) {
    return json({ error: err.message || "Lỗi tài khoản" }, err.status || 500);
  }
}

async function bodyOf(request) {
  const text = await request.text();
  if (text.length > MAX_PROFILE + 1000) { const e = new Error("Nhật ký quá lớn"); e.status = 413; throw e; }
  try { return JSON.parse(text || "{}"); } catch (e) { const err = new Error("Dữ liệu không hợp lệ"); err.status = 400; throw err; }
}

async function register(request, env, https) {
  const body = await bodyOf(request);
  const email = emailOf(body.email);
  const password = typeof body.password === "string" ? body.password : "";
  if (!email) return json({ error: "Email không hợp lệ" }, 400);
  if (password.length < 8 || password.length > 128) return json({ error: "Mật khẩu cần từ 8 đến 128 ký tự" }, 400);
  if (await readUser(env.FXLAB, email)) return json({ error: "Email này đã có tài khoản" }, 409);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const rec = {
    email, salt: [...salt].map((b) => b.toString(16).padStart(2, "0")).join(""),
    hash: await hashPassword(password, salt), profile: null, updated: 0, fails: [], created: Math.floor(Date.now() / 1000),
  };
  await writeUser(env.FXLAB, email, rec);
  const token = crypto.randomUUID() + crypto.randomUUID();
  await env.FXLAB.put("session:" + token, email, { expirationTtl: TTL });
  return json({ email, profile: null, updated: 0 }, 200, { "set-cookie": setCookie(token, https) });
}

async function login(request, env, https) {
  const body = await bodyOf(request);
  const email = emailOf(body.email);
  const password = typeof body.password === "string" ? body.password : "";
  if (!email || password.length < 8 || password.length > 128) return json({ error: "Email hoặc mật khẩu không đúng" }, 401);
  const rec = await readUser(env.FXLAB, email);
  if (!rec) return json({ error: "Email hoặc mật khẩu không đúng" }, 401);
  const now = Date.now() / 1000;
  const fails = (rec.fails || []).filter((t) => now - t < FAIL_WINDOW);
  if (fails.length >= MAX_FAILS) return json({ error: "Đăng nhập sai quá nhiều lần. Thử lại sau một giờ." }, 429);
  const salt = new Uint8Array(rec.salt.match(/../g).map((h) => parseInt(h, 16)));
  if (await hashPassword(password, salt) !== rec.hash) {
    rec.fails = fails.concat([now]);
    await writeUser(env.FXLAB, email, rec);
    return json({ error: "Email hoặc mật khẩu không đúng" }, 401);
  }
  rec.fails = [];
  await writeUser(env.FXLAB, email, rec);
  const token = crypto.randomUUID() + crypto.randomUUID();
  await env.FXLAB.put("session:" + token, email, { expirationTtl: TTL });
  return json({ email, profile: rec.profile, updated: rec.updated || 0 }, 200, { "set-cookie": setCookie(token, https) });
}

async function sessionEmail(request, env) {
  const token = cookie(request, "fxlab_session");
  if (!token || token.length > 80) return "";
  return (await env.FXLAB.get("session:" + token)) || "";
}

async function logout(request, env) {
  const token = cookie(request, "fxlab_session");
  if (token) await env.FXLAB.delete("session:" + token);
  return json({ ok: true }, 200, { "set-cookie": "fxlab_session=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0" });
}

async function me(request, env) {
  const email = await sessionEmail(request, env);
  if (!email) return json({ error: "Chưa đăng nhập" }, 401);
  const rec = await readUser(env.FXLAB, email);
  if (!rec) return json({ error: "Chưa đăng nhập" }, 401);
  return json({ email, profile: rec.profile, updated: rec.updated || 0 });
}

async function save(request, env) {
  const email = await sessionEmail(request, env);
  if (!email) return json({ error: "Chưa đăng nhập" }, 401);
  const body = await bodyOf(request);
  const problem = checkProfile(body.profile);
  if (problem) return json({ error: problem }, problem === "Nhật ký quá lớn" ? 413 : 400);
  const rec = await readUser(env.FXLAB, email);
  if (!rec) return json({ error: "Chưa đăng nhập" }, 401);
  rec.profile = body.profile;
  rec.updated = Math.floor(Date.now() / 1000);
  await writeUser(env.FXLAB, email, rec);
  return json({ updated: rec.updated });
}
