const encoder = new TextEncoder();
const SUPERADMINS = new Set([
  "chulingli1988@outlook.com",
  "295297477@qq.com",
  "boss@lynli.me",
]);
const PBKDF2_ITERATIONS = 310000;
const SESSION_SECONDS = 60 * 60 * 12;

function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...headers },
  });
}
function cookie(name, value, maxAge) {
  return `${name}=${value}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${maxAge}`;
}
function clearCookie() {
  return "qtp_session=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0";
}
function randomId(bytes = 32) {
  const data = crypto.getRandomValues(new Uint8Array(bytes));
  return [...data].map(v => v.toString(16).padStart(2, "0")).join("");
}
async function digest(value) {
  const hash = await crypto.subtle.digest("SHA-256", encoder.encode(value));
  return [...new Uint8Array(hash)].map(v => v.toString(16).padStart(2, "0")).join("");
}
async function passwordHash(password) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey("raw", encoder.encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations: PBKDF2_ITERATIONS }, key, 256);
  const hex = value => [...new Uint8Array(value)].map(v => v.toString(16).padStart(2, "0")).join("");
  return `pbkdf2-sha256$${PBKDF2_ITERATIONS}$${hex(salt)}$${hex(bits)}`;
}
async function verifyPassword(password, stored) {
  if (!stored) return false;
  const [kind, rounds, saltHex, expected] = stored.split("$");
  if (kind !== "pbkdf2-sha256" || Number(rounds) < 200000 || !saltHex || !expected) return false;
  const salt = new Uint8Array(saltHex.match(/.{2}/g).map(x => parseInt(x, 16)));
  const key = await crypto.subtle.importKey("raw", encoder.encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations: Number(rounds) }, key, 256);
  const actual = [...new Uint8Array(bits)].map(v => v.toString(16).padStart(2, "0")).join("");
  return actual.length === expected.length && [...actual].reduce((n, c, i) => n | (c.charCodeAt(0) ^ expected.charCodeAt(i)), 0) === 0;
}
function allowedOrigin(request, env) {
  const origin = request.headers.get("Origin");
  if (!origin) return true;
  return origin === env.ADMIN_ORIGIN;
}
async function audit(db, actor, action, resourceType, resourceId, result = "success", detail = null) {
  await db.prepare("INSERT INTO audit_logs (id, actor_admin_id, action, resource_type, resource_id, result, detail_json) VALUES (?, ?, ?, ?, ?, ?, ?)")
    .bind(randomId(16), actor || null, action, resourceType || null, resourceId || null, result, detail ? JSON.stringify(detail) : null).run();
}
async function currentAdmin(request, env) {
  const token = request.headers.get("Cookie")?.split(";").map(v => v.trim()).find(v => v.startsWith("qtp_session="))?.slice(12);
  if (!token) return null;
  const tokenHash = await digest(token);
  const row = await env.DB.prepare(
    "SELECT a.id, a.email, a.role, a.status, s.id AS session_id FROM admin_sessions s JOIN admin_accounts a ON a.id=s.admin_id WHERE s.token_hash=? AND s.expires_at > CURRENT_TIMESTAMP AND a.status='active' LIMIT 1"
  ).bind(tokenHash).first();
  if (!row) return null;
  await env.DB.prepare("UPDATE admin_sessions SET last_seen_at=CURRENT_TIMESTAMP WHERE id=?").bind(row.session_id).run();
  return row;
}
async function body(request) {
  try { return await request.json(); } catch { return null; }
}
async function rateLimit(db, identity) {
  const now = Math.floor(Date.now() / 1000);
  const row = await db.prepare("SELECT attempt_count, window_started_at, locked_until FROM auth_attempts WHERE identity_key=?").bind(identity).first();
  if (row?.locked_until && row.locked_until > now) return false;
  if (!row || now - row.window_started_at > 900) {
    await db.prepare("INSERT OR REPLACE INTO auth_attempts (identity_key, attempt_count, window_started_at, locked_until) VALUES (?, 0, ?, NULL)").bind(identity, now).run();
  }
  return true;
}
async function failedAttempt(db, identity) {
  const now = Math.floor(Date.now() / 1000);
  const row = await db.prepare("SELECT attempt_count, window_started_at FROM auth_attempts WHERE identity_key=?").bind(identity).first();
  const count = row && now - row.window_started_at <= 900 ? row.attempt_count + 1 : 1;
  await db.prepare("INSERT OR REPLACE INTO auth_attempts (identity_key, attempt_count, window_started_at, locked_until) VALUES (?, ?, ?, ?)")
    .bind(identity, count, row && now - row.window_started_at <= 900 ? row.window_started_at : now, count >= 8 ? now + 900 : null).run();
}

async function handle(request, env) {
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: { "access-control-allow-methods": "GET,POST,OPTIONS", "access-control-allow-headers": "Content-Type,X-Bootstrap-Secret", "access-control-max-age": "86400" } });
  if (!env.DB) return json({ error: "database_not_configured" }, 503);
  if (!allowedOrigin(request, env)) return json({ error: "origin_not_allowed" }, 403);
  const url = new URL(request.url);
  const path = url.pathname;
  const method = request.method;

  if (path === "/api/health" && method === "GET") {
    const result = await env.DB.prepare("SELECT 1 AS ok").first();
    return json({ ok: result?.ok === 1, service: "qingtianpay-api", database: "connected" });
  }

  if (path === "/api/auth/bootstrap" && method === "POST") {
    if (!env.BOOTSTRAP_SECRET || request.headers.get("X-Bootstrap-Secret") !== env.BOOTSTRAP_SECRET) return json({ error: "forbidden" }, 403);
    const state = await env.DB.prepare("SELECT setting_value FROM system_settings WHERE setting_key='bootstrap_completed'").first();
    if (state?.setting_value === "true") return json({ error: "bootstrap_already_completed" }, 409);
    const payload = await body(request);
    const password = payload?.password;
    if (typeof password !== "string" || password.length < 12 || password.length > 256) return json({ error: "password_must_be_12_to_256_chars" }, 400);
    const hash = await passwordHash(password);
    for (const email of SUPERADMINS) {
      await env.DB.prepare("UPDATE admin_accounts SET password_hash=?, status='active', updated_at=CURRENT_TIMESTAMP WHERE lower(email)=? AND is_protected=1")
        .bind(hash, email).run();
    }
    await env.DB.prepare("UPDATE system_settings SET setting_value='true', updated_at=CURRENT_TIMESTAMP WHERE setting_key='bootstrap_completed'").run();
    await audit(env.DB, null, "admin.bootstrap", "admin_accounts", "protected-superadmins");
    return json({ ok: true, initialized: [...SUPERADMINS] });
  }

  if (path === "/api/auth/login" && method === "POST") {
    const payload = await body(request);
    const email = String(payload?.email || "").trim().toLowerCase();
    const password = String(payload?.password || "");
    if (!email || !password || password.length > 256) return json({ error: "invalid_credentials" }, 400);
    const identity = await digest(email + ":" + (request.headers.get("CF-Connecting-IP") || "unknown"));
    if (!(await rateLimit(env.DB, identity))) return json({ error: "too_many_attempts" }, 429);
    const admin = await env.DB.prepare("SELECT id,email,password_hash,role,status FROM admin_accounts WHERE email=? COLLATE NOCASE LIMIT 1").bind(email).first();
    if (!admin || admin.status !== "active" || !(await verifyPassword(password, admin.password_hash))) {
      await failedAttempt(env.DB, identity);
      await audit(env.DB, admin?.id, "auth.login", "admin_accounts", admin?.id, "denied");
      return json({ error: "invalid_credentials" }, 401);
    }
    await env.DB.prepare("DELETE FROM auth_attempts WHERE identity_key=?").bind(identity).run();
    const token = randomId(32);
    const sessionId = randomId(16);
    await env.DB.prepare("INSERT INTO admin_sessions (id,admin_id,token_hash,expires_at) VALUES (?, ?, ?, datetime('now', ?))")
      .bind(sessionId, admin.id, await digest(token), `+${SESSION_SECONDS} seconds`).run();
    await env.DB.prepare("UPDATE admin_accounts SET last_login_at=CURRENT_TIMESTAMP WHERE id=?").bind(admin.id).run();
    await audit(env.DB, admin.id, "auth.login", "admin_sessions", sessionId);
    return json({ ok: true, admin: { id: admin.id, email: admin.email, role: admin.role } }, 200, { "set-cookie": cookie("qtp_session", token, SESSION_SECONDS) });
  }

  if (path === "/api/auth/logout" && method === "POST") {
    const admin = await currentAdmin(request, env);
    if (admin) {
      await env.DB.prepare("DELETE FROM admin_sessions WHERE id=?").bind(admin.session_id).run();
      await audit(env.DB, admin.id, "auth.logout", "admin_sessions", admin.session_id);
    }
    return json({ ok: true }, 200, { "set-cookie": clearCookie() });
  }

  if (path === "/api/auth/me" && method === "GET") {
    const admin = await currentAdmin(request, env);
    return admin ? json({ admin: { id: admin.id, email: admin.email, role: admin.role } }) : json({ error: "unauthorized" }, 401);
  }

  const admin = await currentAdmin(request, env);
  if (!admin) return json({ error: "unauthorized" }, 401);

  if (path === "/api/sites" && method === "GET") {
    const rows = await env.DB.prepare("SELECT id,name,slug,base_url,status,delivery_mode,created_at,updated_at FROM business_sites ORDER BY created_at DESC").all();
    return json({ items: rows.results || [] });
  }
  if (path === "/api/sites" && method === "POST") {
    const payload = await body(request);
    const name = String(payload?.name || "").trim();
    const slug = String(payload?.slug || "").trim().toLowerCase();
    if (!name || !/^[a-z0-9][a-z0-9-]{1,48}$/.test(slug)) return json({ error: "invalid_site" }, 400);
    const id = randomId(16);
    try {
      await env.DB.prepare("INSERT INTO business_sites (id,name,slug,base_url) VALUES (?,?,?,?)").bind(id,name,slug,payload?.base_url || null).run();
      await audit(env.DB, admin.id, "site.create", "business_sites", id);
      return json({ id,name,slug }, 201);
    } catch { return json({ error: "site_conflict_or_database_error" }, 409); }
  }

  if (path === "/api/products" && method === "GET") {
    const rows = await env.DB.prepare("SELECT p.id,p.site_id,s.name AS site_name,p.name,p.description,p.amount_minor,p.currency,p.status,p.created_at FROM products p JOIN business_sites s ON s.id=p.site_id ORDER BY p.created_at DESC").all();
    return json({ items: rows.results || [] });
  }
  if (path === "/api/products" && method === "POST") {
    const payload = await body(request);
    const siteId = String(payload?.site_id || "");
    const name = String(payload?.name || "").trim();
    const amount = Number(payload?.amount_minor);
    if (!siteId || !name || !Number.isSafeInteger(amount) || amount < 0) return json({ error: "invalid_product" }, 400);
    const site = await env.DB.prepare("SELECT id FROM business_sites WHERE id=? AND status='active'").bind(siteId).first();
    if (!site) return json({ error: "site_not_found" }, 404);
    const id = randomId(16);
    await env.DB.prepare("INSERT INTO products (id,site_id,name,description,amount_minor,currency) VALUES (?,?,?,?,?,'CNY')").bind(id,siteId,name,payload?.description || null,amount).run();
    await audit(env.DB, admin.id, "product.create", "products", id, "success", { site_id: siteId });
    return json({ id,site_id: siteId,name,amount_minor: amount,currency: "CNY" }, 201);
  }

  if (path === "/api/orders" && method === "GET") {
    const rows = await env.DB.prepare("SELECT o.id,o.order_no,o.site_id,s.name AS site_name,o.subject,o.amount_minor,o.currency,o.status,o.created_at,o.paid_at FROM orders o JOIN business_sites s ON s.id=o.site_id ORDER BY o.created_at DESC LIMIT 200").all();
    return json({ items: rows.results || [] });
  }

  if (path === "/api/admins" && method === "GET") {
    const rows = await env.DB.prepare("SELECT id,email,role,status,is_protected,last_login_at,created_at FROM admin_accounts ORDER BY is_protected DESC,created_at").all();
    return json({ items: rows.results || [] });
  }

  return json({ error: "not_found" }, 404);
}

export default {
  async fetch(request, env) {
    try {
      const response = await handle(request, env);
      const origin = request.headers.get("Origin");
      if (origin && origin === env.ADMIN_ORIGIN) {
        const headers = new Headers(response.headers);
        headers.set("access-control-allow-origin", origin);
        headers.set("access-control-allow-credentials", "true");
        headers.set("vary", "Origin");
        return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
      }
      return response;
    } catch (error) {
      console.error("qingtianpay api error", error?.message || error);
      return json({ error: "internal_error" }, 500);
    }
  },
};
