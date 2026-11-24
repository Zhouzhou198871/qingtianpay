const encoder = new TextEncoder();
const SUPERADMINS = new Set([
  "chulingli1988@outlook.com",
  "295297477@qq.com",
  "boss@lynli.me",
]);
const PBKDF2_ITERATIONS = 600000;
const SESSION_SECONDS = 60 * 60 * 12;

function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...headers },
  });
}
function cookie(name, value, maxAge) {
  return `${name}=${value}; Path=/; HttpOnly; Secure; SameSite=None; Max-Age=${maxAge}`;
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


function pemBytes(value) {
  const clean = String(value || "").replace(/-----BEGIN [^-]+-----|-----END [^-]+-----|\s/g, "");
  const raw = atob(clean);
  return Uint8Array.from(raw, c => c.charCodeAt(0));
}
async function alipayPrivateKey(env) {
  if (!env.ALIPAY_PRIVATE_KEY) throw new Error("alipay_private_key_not_configured");
  return crypto.subtle.importKey("pkcs8", pemBytes(env.ALIPAY_PRIVATE_KEY), { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
}
async function alipayPublicKey(env) {
  if (!env.ALIPAY_PUBLIC_KEY) throw new Error("alipay_public_key_not_configured");
  return crypto.subtle.importKey("spki", pemBytes(env.ALIPAY_PUBLIC_KEY), { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
}
function alipaySignContent(params) {
  return Object.keys(params).filter(k => k !== "sign" && k !== "sign_type" && params[k] !== undefined && params[k] !== null && params[k] !== "")
    .sort().map(k => k + "=" + (typeof params[k] === "string" ? params[k] : JSON.stringify(params[k]))).join("&");
}
function toBase64(bytes) { let s = ""; for (const b of new Uint8Array(bytes)) s += String.fromCharCode(b); return btoa(s); }
async function alipayRequest(env, method, bizContent, notifyUrl) {
  const params = {
    app_id: env.ALIPAY_APP_ID,
    method,
    format: "JSON",
    charset: "utf-8",
    sign_type: "RSA2",
    timestamp: new Date().toISOString().replace("T", " ").slice(0, 19),
    version: "1.0",
    biz_content: JSON.stringify(bizContent),
  };
  if (notifyUrl) params.notify_url = notifyUrl;
  const signature = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", await alipayPrivateKey(env), encoder.encode(alipaySignContent(params)));
  params.sign = toBase64(signature);
  const form = new URLSearchParams(params);
  const response = await fetch(env.ALIPAY_GATEWAY || "https://openapi.alipay.com/gateway.do", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded;charset=utf-8" }, body: form.toString() });
  const textBody = await response.text();
  if (!response.ok) throw new Error("alipay_http_" + response.status);
  let data;
  try { data = JSON.parse(textBody); } catch { throw new Error("alipay_invalid_json_response"); }
  const resultKey = method.replaceAll(".", "_") + "_response";
  const result = data[resultKey];
  if (!result || result.code !== "10000") throw new Error("alipay_api_error:" + (result?.sub_msg || result?.msg || "unknown"));
  return result;
}
async function verifyAlipayNotify(env, params) {
  if (params.app_id !== env.ALIPAY_APP_ID || params.sign_type !== "RSA2" || !params.sign) return false;
  const signature = pemBytes(params.sign);
  return crypto.subtle.verify("RSASSA-PKCS1-v1_5", await alipayPublicKey(env), signature, encoder.encode(alipaySignContent(params)));
}
function amountText(minor) { return (minor / 100).toFixed(2); }
async function siteFromApiKey(request, db) {
  const token = request.headers.get("Authorization")?.replace(/^Bearer\s+/i, "");
  if (!token) return null;
  const row = await db.prepare("SELECT k.id AS key_id,k.site_id FROM site_api_keys k JOIN business_sites s ON s.id=k.site_id WHERE k.secret_hash=? AND k.status='active' AND s.status='active' LIMIT 1").bind(await digest(token)).first();
  if (row) await db.prepare("UPDATE site_api_keys SET last_used_at=CURRENT_TIMESTAMP WHERE id=?").bind(row.key_id).run();
  return row || null;
}
async function signDelivery(secret, payload) {
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, encoder.encode(payload));
  return [...new Uint8Array(sig)].map(v => v.toString(16).padStart(2, "0")).join("");
}
async function runDelivery(db, env, orderId) {
  const order = await db.prepare("SELECT o.*,p.name AS product_name,p.delivery_rule_json,s.delivery_mode,s.delivery_config_json,s.name AS site_name FROM orders o LEFT JOIN products p ON p.id=o.product_id JOIN business_sites s ON s.id=o.site_id WHERE o.id=? AND o.status='paid'").bind(orderId).first();
  if (!order) return;
  const idempotencyKey = "delivery:" + order.id;
  await db.prepare("INSERT OR IGNORE INTO delivery_records(id,site_id,order_id,idempotency_key,mode,status) VALUES(?,?,?,?,?,'pending')")
    .bind(randomId(16), order.site_id, order.id, idempotencyKey, order.delivery_mode).run();
  const task = await db.prepare("SELECT * FROM delivery_records WHERE idempotency_key=?").bind(idempotencyKey).first();
  if (!task || task.status === "succeeded" || task.status === "processing") return;
  if (order.delivery_mode !== "webhook") return;
  let config = {};
  try { config = JSON.parse(order.delivery_config_json || "{}"); } catch {}
  if (!config.url || !env.DELIVERY_SIGNING_SECRET) {
    await db.prepare("UPDATE delivery_records SET status='failed',last_error='delivery_webhook_not_configured',attempt_count=attempt_count+1,updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(task.id).run();
    return;
  }
  let deliveryRule = null;
  try { deliveryRule = order.delivery_rule_json ? JSON.parse(order.delivery_rule_json) : null; } catch {}
  const payload = JSON.stringify({ event: "order.paid", order_no: order.order_no, external_order_no: order.external_order_no, site_id: order.site_id, product_id: order.product_id, product_name: order.product_name, delivery_rule: deliveryRule, amount_minor: order.amount_minor, currency: order.currency, buyer_ref: order.buyer_ref, paid_at: order.paid_at, idempotency_key: idempotencyKey });
  const signature = await signDelivery(env.DELIVERY_SIGNING_SECRET, payload);
  const claim = await db.prepare("UPDATE delivery_records SET status='processing',attempt_count=attempt_count+1,request_json=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND status IN ('pending','failed')").bind(payload, task.id).run();
  if (!claim.meta?.changes) return;
  try {
    const response = await fetch(config.url, { method: "POST", headers: { "content-type": "application/json", "x-qingtian-event": "order.paid", "x-qingtian-signature": signature, "idempotency-key": idempotencyKey }, body: payload });
    const responseText = (await response.text()).slice(0, 4000);
    await db.prepare("UPDATE delivery_records SET status=?,response_json=?,last_error=?,delivered_at=CASE WHEN ?='succeeded' THEN CURRENT_TIMESTAMP ELSE delivered_at END,updated_at=CURRENT_TIMESTAMP WHERE id=?")
      .bind(response.ok ? "succeeded" : "failed", responseText, response.ok ? null : "webhook_http_" + response.status, response.ok ? "succeeded" : "failed", task.id).run();
  } catch (error) {
    await db.prepare("UPDATE delivery_records SET status='failed',last_error=?,updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(String(error?.message || error).slice(0,500), task.id).run();
  }
}

async function handle(request, env) {
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: { "access-control-allow-methods": "GET,POST,PATCH,OPTIONS", "access-control-allow-headers": "Authorization,Content-Type,X-Bootstrap-Secret", "access-control-max-age": "86400" } });
  if (!env.DB) return json({ error: "database_not_configured" }, 503);
  if (!allowedOrigin(request, env)) return json({ error: "origin_not_allowed" }, 403);
  const url = new URL(request.url);
  const path = url.pathname;
  const method = request.method;

  if (path === "/api/health" && method === "GET") {
    const result = await env.DB.prepare("SELECT 1 AS ok").first();
    return json({ ok: result?.ok === 1, service: "qingtianpay-api", database: "connected", alipay: { app_id: Boolean(env.ALIPAY_APP_ID), private_key: Boolean(env.ALIPAY_PRIVATE_KEY), public_key: Boolean(env.ALIPAY_PUBLIC_KEY) } });
  }

  if (path === "/api/auth/bootstrap-status" && method === "GET") {
    const state = await env.DB.prepare("SELECT setting_value FROM system_settings WHERE setting_key='bootstrap_completed'").first();
    return json({ required: state?.setting_value !== "true" });
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


  if (path.startsWith("/api/sites/") && path.endsWith("/api-keys") && method === "POST") {
    const siteId = path.split("/")[3];
    const site = await env.DB.prepare("SELECT id FROM business_sites WHERE id=?").bind(siteId).first();
    if (!site) return json({ error: "site_not_found" }, 404);
    const payload = await body(request);
    const secret = "qtp_live_" + randomId(32);
    const id = randomId(16);
    const label = String(payload?.label || "默认 API 凭证").slice(0,80);
    await env.DB.prepare("INSERT INTO site_api_keys(id,site_id,label,key_prefix,secret_hash) VALUES(?,?,?,?,?)")
      .bind(id, siteId, label, secret.slice(0,16), await digest(secret)).run();
    await audit(env.DB, admin.id, "site.api_key.create", "site_api_keys", id);
    return json({ id, site_id: siteId, label, key_prefix: secret.slice(0,16), api_key: secret, warning: "请立即保存，完整密钥只展示一次" }, 201);
  }
  if (path.startsWith("/api/sites/") && path.endsWith("/api-keys") && method === "GET") {
    const siteId = path.split("/")[3];
    const rows = await env.DB.prepare("SELECT id,label,key_prefix,status,last_used_at,expires_at,created_at FROM site_api_keys WHERE site_id=? ORDER BY created_at DESC").bind(siteId).all();
    return json({ items: rows.results || [] });
  }

  if (path === "/api/sites" && method === "GET") {
    const rows = await env.DB.prepare("SELECT s.id,s.name,s.slug,s.base_url,s.status,s.delivery_mode,s.created_at,s.updated_at,(SELECT k.key_prefix FROM site_api_keys k WHERE k.site_id=s.id AND k.status='active' ORDER BY k.created_at DESC LIMIT 1) AS key_prefix FROM business_sites s ORDER BY s.created_at DESC").all();
    return json({ items: rows.results || [] });
  }
  if (path === "/api/sites" && method === "POST") {
    const payload = await body(request);
    const name = String(payload?.name || "").trim();
    const slug = String(payload?.slug || "").trim().toLowerCase();
    if (!name || !/^[a-z0-9][a-z0-9-]{1,48}$/.test(slug)) return json({ error: "invalid_site" }, 400);
    const deliveryMode = ["manual","webhook","internal"].includes(payload?.delivery_mode) ? payload.delivery_mode : "manual";
    let deliveryConfig = null;
    if (deliveryMode === "webhook") {
      let endpoint;
      try { endpoint = new URL(String(payload?.delivery_url || "")); } catch { return json({ error: "invalid_delivery_url" }, 400); }
      if (endpoint.protocol !== "https:" || ["localhost","127.0.0.1","0.0.0.0","::1"].includes(endpoint.hostname)) return json({ error: "delivery_url_must_be_public_https" }, 400);
      deliveryConfig = JSON.stringify({ url: endpoint.toString() });
    }
    const id = randomId(16);
    try {
      await env.DB.prepare("INSERT INTO business_sites (id,name,slug,base_url,delivery_mode,delivery_config_json) VALUES (?,?,?,?,?,?)").bind(id,name,slug,payload?.base_url || null,deliveryMode,deliveryConfig).run();
      await audit(env.DB, admin.id, "site.create", "business_sites", id);
      return json({ id,name,slug }, 201);
    } catch { return json({ error: "site_conflict_or_database_error" }, 409); }
  }

  if (path === "/api/products" && method === "GET") {
    const rows = await env.DB.prepare("SELECT p.id,p.site_id,s.name AS site_name,p.name,p.description,p.amount_minor,p.currency,p.status,p.delivery_rule_json,json_extract(p.delivery_rule_json,'$.mode') AS delivery_mode,p.created_at,p.updated_at FROM products p JOIN business_sites s ON s.id=p.site_id ORDER BY p.created_at DESC").all();
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
    await env.DB.prepare("INSERT INTO products (id,site_id,name,description,amount_minor,currency,delivery_rule_json) VALUES (?,?,?,?,?,'CNY',?)").bind(id,siteId,name,payload?.description || null,amount,payload?.delivery_rule ? JSON.stringify(payload.delivery_rule) : null).run();
    await audit(env.DB, admin.id, "product.create", "products", id, "success", { site_id: siteId });
    return json({ id,site_id: siteId,name,amount_minor: amount,currency: "CNY" }, 201);
  }

  if (path === "/api/orders" && method === "GET") {
    const rows = await env.DB.prepare("SELECT o.id,o.order_no,o.site_id,s.name AS site_name,o.subject,o.amount_minor,o.currency,o.status,o.created_at,o.paid_at FROM orders o JOIN business_sites s ON s.id=o.site_id ORDER BY o.created_at DESC LIMIT 200").all();
    return json({ items: rows.results || [] });
  }


  if (path === "/api/api-keys" && method === "GET") {
    const rows = await env.DB.prepare("SELECT k.id,k.site_id,s.name AS site_name,k.label,k.key_prefix,k.status,k.last_used_at,k.expires_at,k.created_at FROM site_api_keys k JOIN business_sites s ON s.id=k.site_id ORDER BY k.created_at DESC LIMIT 300").all();
    return json({ items: rows.results || [] });
  }
  if (path.startsWith("/api/api-keys/") && path.endsWith("/revoke") && method === "POST") {
    const id = path.split("/")[3];
    const result = await env.DB.prepare("UPDATE site_api_keys SET status='revoked' WHERE id=? AND status='active'").bind(id).run();
    if (!result.meta?.changes) return json({ error: "api_key_not_found_or_revoked" }, 404);
    await audit(env.DB, admin.id, "site.api_key.revoke", "site_api_keys", id);
    return json({ ok: true });
  }
  if (path === "/api/admins" && method === "POST") {
    if (admin.role !== "superadmin") return json({ error: "forbidden" }, 403);
    const payload = await body(request);
    const email = String(payload?.email || "").trim().toLowerCase();
    const password = String(payload?.password || "");
    const role = ["operator","viewer"].includes(payload?.role) ? payload.role : "operator";
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || password.length < 12 || password.length > 256) return json({ error: "invalid_admin" }, 400);
    if (SUPERADMINS.has(email)) return json({ error: "protected_superadmin_email" }, 409);
    const id = randomId(16);
    try {
      await env.DB.prepare("INSERT INTO admin_accounts(id,email,password_hash,role,status,is_protected) VALUES(?,?,?,?, 'active',0)").bind(id,email,await passwordHash(password),role).run();
      await audit(env.DB, admin.id, "admin.create", "admin_accounts", id);
      return json({ id,email,role,status:"active" }, 201);
    } catch { return json({ error: "admin_already_exists_or_database_error" }, 409); }
  }
  if (path.startsWith("/api/admins/") && method === "PATCH") {
    if (admin.role !== "superadmin") return json({ error: "forbidden" }, 403);
    const id = path.split("/")[3];
    const target = await env.DB.prepare("SELECT id,email,is_protected FROM admin_accounts WHERE id=?").bind(id).first();
    if (!target) return json({ error: "admin_not_found" }, 404);
    if (target.is_protected) return json({ error: "protected_superadmin_cannot_be_modified" }, 403);
    const payload = await body(request);
    const role = ["operator","viewer"].includes(payload?.role) ? payload.role : null;
    const status = ["active","disabled"].includes(payload?.status) ? payload.status : null;
    if (!role && !status) return json({ error: "no_valid_changes" }, 400);
    await env.DB.prepare("UPDATE admin_accounts SET role=COALESCE(?,role),status=COALESCE(?,status),updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(role,status,id).run();
    if (status === "disabled") await env.DB.prepare("DELETE FROM admin_sessions WHERE admin_id=?").bind(id).run();
    await audit(env.DB, admin.id, "admin.update", "admin_accounts", id, "success", { role, status });
    return json({ ok: true, id, role, status });
  }
  if (path === "/api/auth/change-password" && method === "POST") {
    const payload = await body(request);
    const current = String(payload?.current_password || "");
    const next = String(payload?.new_password || "");
    const record = await env.DB.prepare("SELECT password_hash FROM admin_accounts WHERE id=?").bind(admin.id).first();
    if (!await verifyPassword(current, record?.password_hash)) return json({ error: "current_password_incorrect" }, 400);
    if (next.length < 12 || next.length > 256) return json({ error: "new_password_must_be_12_to_256_chars" }, 400);
    await env.DB.prepare("UPDATE admin_accounts SET password_hash=?,password_changed_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(await passwordHash(next),admin.id).run();
    await env.DB.prepare("DELETE FROM admin_sessions WHERE admin_id=? AND id!=?").bind(admin.id,admin.session_id).run();
    await audit(env.DB, admin.id, "auth.password_change", "admin_accounts", admin.id);
    return json({ ok: true });
  }

  if (path === "/api/admins" && method === "GET") {
    const rows = await env.DB.prepare("SELECT id,email,role,status,is_protected,last_login_at,created_at FROM admin_accounts ORDER BY is_protected DESC,created_at").all();
    return json({ items: rows.results || [] });
  }


  if (path === "/api/v1/payments" && method === "POST") {
    const siteKey = await siteFromApiKey(request, env.DB);
    if (!siteKey) return json({ error: "invalid_site_api_key" }, 401);
    const payload = await body(request);
    const productId = String(payload?.product_id || "");
    const product = await env.DB.prepare("SELECT id,site_id,name,amount_minor,currency,status FROM products WHERE id=? AND site_id=? AND status='active'").bind(productId, siteKey.site_id).first();
    if (!product) return json({ error: "product_not_found" }, 404);
    if (!payload?.buyer_id) return json({ error: "buyer_id_required", message: "JSAPI 下单必须传入支付宝授权取得的 buyer_id" }, 400);
    const externalOrderNo = String(payload?.external_order_no || "").slice(0, 100);
    if (!externalOrderNo) return json({ error: "external_order_no_required" }, 400);
    const existing = await env.DB.prepare("SELECT order_no,status FROM orders WHERE site_id=? AND external_order_no=?").bind(siteKey.site_id, externalOrderNo).first();
    if (existing) return json({ error: "external_order_no_already_used", order: existing }, 409);
    const orderId = randomId(16);
    const orderNo = "QT" + Date.now().toString() + randomId(5).toUpperCase();
    const paymentId = randomId(16);
    const notifyUrl = "https://pay.lynli.me/api/alipay/notify";
    await env.DB.prepare("INSERT INTO orders(id,site_id,order_no,external_order_no,product_id,buyer_ref,buyer_email,amount_minor,currency,status,subject,notify_url,return_url,metadata_json) VALUES(?,?,?,?,?,?,?,?,?,'pending',?,?,?,?)")
      .bind(orderId, siteKey.site_id, orderNo, externalOrderNo, product.id, String(payload?.buyer_ref || "").slice(0,160) || null, String(payload?.buyer_email || "").slice(0,254) || null, product.amount_minor, product.currency, product.name, notifyUrl, null, JSON.stringify(payload?.metadata || {})).run();
    await env.DB.prepare("INSERT INTO payments(id,site_id,order_id,channel,channel_out_trade_no,amount_minor,status) VALUES(?,?,?,'alipay',?,?,'processing')")
      .bind(paymentId, siteKey.site_id, orderId, orderNo, product.amount_minor).run();
    try {
      const result = await alipayRequest(env, "alipay.trade.create", { out_trade_no: orderNo, total_amount: amountText(product.amount_minor), subject: product.name.slice(0,128), product_code: "JSAPI", buyer_id: String(payload?.buyer_id || "") }, notifyUrl);
      await env.DB.prepare("UPDATE payments SET status='created',channel_trade_no=?,channel_response_json=?,updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(result.trade_no || null, JSON.stringify(result), paymentId).run();
      return json({ order_no: orderNo, trade_no: result.trade_no, status: "pending", payment_method: "alipay_jsapi", invoke: { tradeNO: result.trade_no } }, 201);
    } catch (error) {
      await env.DB.prepare("UPDATE payments SET status='failed',channel_response_json=?,updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(JSON.stringify({ error: String(error?.message || error) }), paymentId).run();
      await env.DB.prepare("UPDATE orders SET status='failed',updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(orderId).run();
      return json({ error: "alipay_create_failed", detail: String(error?.message || error) }, 502);
    }
  }

  if (path === "/api/alipay/notify" && method === "POST") {
    const form = await request.formData();
    const params = {};
    for (const [key, value] of form.entries()) if (typeof value === "string") params[key] = value;
    if (!(await verifyAlipayNotify(env, params))) return new Response("failure", { status: 400, headers: { "content-type": "text/plain" } });
    const order = await env.DB.prepare("SELECT o.*,p.id AS payment_id,p.amount_minor AS payment_amount FROM orders o JOIN payments p ON p.order_id=o.id WHERE o.order_no=? AND p.channel='alipay' LIMIT 1").bind(params.out_trade_no).first();
    if (!order || Number(order.payment_amount) !== Math.round(Number(params.total_amount) * 100) || params.app_id !== env.ALIPAY_APP_ID) return new Response("failure", { status: 400, headers: { "content-type": "text/plain" } });
    if (params.trade_status === "TRADE_SUCCESS" || params.trade_status === "TRADE_FINISHED") {
      await env.DB.prepare("UPDATE payments SET status='succeeded',channel_trade_no=?,notified_at=CURRENT_TIMESTAMP,paid_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE id=? AND status!='succeeded'").bind(params.trade_no || null, order.payment_id).run();
      await env.DB.prepare("UPDATE orders SET status='paid',paid_at=COALESCE(paid_at,CURRENT_TIMESTAMP),updated_at=CURRENT_TIMESTAMP WHERE id=? AND status='pending'").bind(order.id).run();
      await runDelivery(env.DB, env, order.id);
    } else if (params.trade_status === "TRADE_CLOSED") {
      await env.DB.prepare("UPDATE payments SET status='closed',notified_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE id=? AND status!='succeeded'").bind(order.payment_id).run();
      await env.DB.prepare("UPDATE orders SET status='closed',updated_at=CURRENT_TIMESTAMP WHERE id=? AND status='pending'").bind(order.id).run();
    }
    return new Response("success", { status: 200, headers: { "content-type": "text/plain" } });
  }

  if (path.startsWith("/api/v1/orders/") && method === "GET") {
    const siteKey = await siteFromApiKey(request, env.DB);
    if (!siteKey) return json({ error: "invalid_site_api_key" }, 401);
    const orderNo = decodeURIComponent(path.slice("/api/v1/orders/".length));
    let order = await env.DB.prepare("SELECT o.order_no,o.id,o.external_order_no,o.status,o.amount_minor,o.currency,o.created_at,o.paid_at,p.id AS payment_id FROM orders o JOIN payments p ON p.order_id=o.id WHERE o.order_no=? AND o.site_id=?").bind(orderNo, siteKey.site_id).first();
    if (!order) return json({ error: "order_not_found" }, 404);
    if (order.status === "pending") {
      try {
        const result = await alipayRequest(env, "alipay.trade.query", { out_trade_no: order.order_no });
        if (["TRADE_SUCCESS","TRADE_FINISHED"].includes(result.trade_status) && Math.round(Number(result.total_amount) * 100) === order.amount_minor) {
          await env.DB.prepare("UPDATE payments SET status='succeeded',channel_trade_no=?,channel_response_json=?,paid_at=COALESCE(paid_at,CURRENT_TIMESTAMP),updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(result.trade_no || null,JSON.stringify(result),order.payment_id).run();
          await env.DB.prepare("UPDATE orders SET status='paid',paid_at=COALESCE(paid_at,CURRENT_TIMESTAMP),updated_at=CURRENT_TIMESTAMP WHERE id=? AND status='pending'").bind(order.id).run();
          await runDelivery(env.DB,env,order.id);
        } else if (result.trade_status === "TRADE_CLOSED") {
          await env.DB.prepare("UPDATE payments SET status='closed',channel_response_json=?,updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(JSON.stringify(result),order.payment_id).run();
          await env.DB.prepare("UPDATE orders SET status='closed',updated_at=CURRENT_TIMESTAMP WHERE id=? AND status='pending'").bind(order.id).run();
        }
      } catch {}
      order = await env.DB.prepare("SELECT order_no,external_order_no,status,amount_minor,currency,created_at,paid_at FROM orders WHERE id=?").bind(order.id).first();
    } else {
      const { id, payment_id, ...publicOrder } = order;
      order = publicOrder;
    }
    return json({ order });
  }

  if (path === "/api/payments" && method === "GET") {
    const rows = await env.DB.prepare("SELECT p.id,p.site_id,s.name AS site_name,o.order_no,p.channel,p.channel_trade_no,p.amount_minor,o.currency,p.status,p.paid_at,p.created_at FROM payments p JOIN orders o ON o.id=p.order_id JOIN business_sites s ON s.id=p.site_id ORDER BY p.created_at DESC LIMIT 200").all();
    return json({ items: rows.results || [] });
  }
  if (path === "/api/refunds" && method === "GET") {
    const rows = await env.DB.prepare("SELECT r.*,s.name AS site_name,o.order_no FROM refunds r JOIN business_sites s ON s.id=r.site_id JOIN orders o ON o.id=r.order_id ORDER BY r.created_at DESC LIMIT 200").all();
    return json({ items: rows.results || [] });
  }
  if (path === "/api/refunds" && method === "POST") {
    const payload = await body(request);
    const order = await env.DB.prepare("SELECT o.*,p.id AS payment_id,p.channel_out_trade_no FROM orders o JOIN payments p ON p.order_id=o.id WHERE o.id=? AND o.status='paid' AND p.status='succeeded'").bind(String(payload?.order_id || "")).first();
    const amount = Number(payload?.amount_minor ?? order?.amount_minor);
    const refunded = order ? await env.DB.prepare("SELECT COALESCE(SUM(amount_minor),0) AS total FROM refunds WHERE order_id=? AND status IN ('succeeded','processing')").bind(order.id).first() : null;
    const remaining = order ? order.amount_minor - Number(refunded?.total || 0) : 0;
    if (!order || !Number.isSafeInteger(amount) || amount <= 0 || amount > remaining) return json({ error: "invalid_refund" }, 400);
    const refundId = randomId(16), refundNo = "RF" + Date.now() + randomId(5).toUpperCase();
    await env.DB.prepare("INSERT INTO refunds(id,site_id,order_id,payment_id,refund_no,amount_minor,reason,status,requested_by) VALUES(?,?,?,?,?,?,?,'processing',?)")
      .bind(refundId, order.site_id, order.id, order.payment_id, refundNo, amount, String(payload?.reason || "").slice(0,256), admin.id).run();
    try {
      const result = await alipayRequest(env, "alipay.trade.refund", { out_trade_no: order.order_no, refund_amount: amountText(amount), out_request_no: refundNo, refund_reason: String(payload?.reason || "商户退款").slice(0,256) });
      await env.DB.prepare("UPDATE refunds SET status='succeeded',channel_refund_no=?,processed_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(result.trade_no || result.out_trade_no || null, refundId).run();
      const totalRefunded = await env.DB.prepare("SELECT COALESCE(SUM(amount_minor),0) AS total FROM refunds WHERE order_id=? AND status='succeeded'").bind(order.id).first();
      if (Number(totalRefunded?.total || 0) >= order.amount_minor) await env.DB.prepare("UPDATE orders SET status='refunded',updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(order.id).run();
      await audit(env.DB, admin.id, "refund.create", "refunds", refundId);
      return json({ id: refundId, refund_no: refundNo, status: "succeeded", result });
    } catch (error) {
      await env.DB.prepare("UPDATE refunds SET status='failed',updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(refundId).run();
      return json({ error: "alipay_refund_failed", detail: String(error?.message || error) }, 502);
    }
  }
  if (path === "/api/deliveries" && method === "GET") {
    const rows = await env.DB.prepare("SELECT d.*,s.name AS site_name,o.order_no FROM delivery_records d JOIN business_sites s ON s.id=d.site_id JOIN orders o ON o.id=d.order_id ORDER BY d.created_at DESC LIMIT 200").all();
    return json({ items: rows.results || [] });
  }
  if (path.startsWith("/api/deliveries/") && path.endsWith("/retry") && method === "POST") {
    const id = path.split("/")[3];
    const task = await env.DB.prepare("SELECT order_id FROM delivery_records WHERE id=? AND status!='succeeded'").bind(id).first();
    if (!task) return json({ error: "delivery_not_retryable" }, 404);
    await runDelivery(env.DB, env, task.order_id);
    const updated = await env.DB.prepare("SELECT status,attempt_count,last_error FROM delivery_records WHERE id=?").bind(id).first();
    await audit(env.DB, admin.id, "delivery.retry", "delivery_records", id);
    return json({ id, ...updated });
  }

  if (path === "/api/analytics/revenue" && method === "GET") {
    const rows = await env.DB.prepare("SELECT date(o.created_at) AS date,s.name AS site_name,COUNT(o.id) AS order_count,SUM(CASE WHEN o.status IN ('paid','refunding','refunded') THEN 1 ELSE 0 END) AS paid_count,COALESCE(SUM(CASE WHEN o.status IN ('paid','refunding','refunded') THEN o.amount_minor ELSE 0 END),0) AS gross_minor,COALESCE((SELECT SUM(r.amount_minor) FROM refunds r WHERE r.site_id=o.site_id AND date(r.created_at)=date(o.created_at) AND r.status='succeeded'),0) AS refund_minor FROM orders o JOIN business_sites s ON s.id=o.site_id GROUP BY date(o.created_at),o.site_id ORDER BY date DESC LIMIT 90").all();
    return json({ items: (rows.results || []).map(x => ({ ...x, net_minor: Number(x.gross_minor || 0) - Number(x.refund_minor || 0) })) });
  }
  if (path === "/api/ledger" && method === "GET") {
    const rows = await env.DB.prepare("SELECT p.id,p.site_id,s.name AS site_name,o.order_no,'收款' AS type,p.amount_minor,p.channel_trade_no,p.created_at FROM payments p JOIN orders o ON o.id=p.order_id JOIN business_sites s ON s.id=p.site_id WHERE p.status='succeeded' UNION ALL SELECT r.id,r.site_id,s.name AS site_name,o.order_no,'退款' AS type,-r.amount_minor AS amount_minor,p.channel_trade_no,r.created_at FROM refunds r JOIN orders o ON o.id=r.order_id JOIN payments p ON p.id=r.payment_id JOIN business_sites s ON s.id=r.site_id WHERE r.status='succeeded' ORDER BY created_at DESC LIMIT 300").all();
    return json({ items: rows.results || [] });
  }

  if (path === "/api/audit-logs" && method === "GET") {
    const rows = await env.DB.prepare("SELECT l.*,a.email AS actor_email FROM audit_logs l LEFT JOIN admin_accounts a ON a.id=l.actor_admin_id ORDER BY l.created_at DESC LIMIT 300").all();
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
