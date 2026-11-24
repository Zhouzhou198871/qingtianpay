-- 晴天专属支付中心初始数据库结构
-- Cloudflare D1 / SQLite。此迁移只定义结构，不连接或修改任何现有数据库。

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS admin_accounts (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT,
  role TEXT NOT NULL DEFAULT 'superadmin' CHECK (role IN ('superadmin', 'operator', 'viewer')),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'active', 'disabled')),
  is_protected INTEGER NOT NULL DEFAULT 0 CHECK (is_protected IN (0, 1)),
  password_changed_at TEXT,
  last_login_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS admin_sessions (
  id TEXT PRIMARY KEY,
  admin_id TEXT NOT NULL REFERENCES admin_accounts(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_seen_at TEXT,
  ip_digest TEXT,
  user_agent TEXT
);
CREATE INDEX IF NOT EXISTS idx_admin_sessions_admin ON admin_sessions(admin_id);
CREATE INDEX IF NOT EXISTS idx_admin_sessions_expiry ON admin_sessions(expires_at);

CREATE TABLE IF NOT EXISTS business_sites (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  base_url TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
  delivery_mode TEXT NOT NULL DEFAULT 'manual' CHECK (delivery_mode IN ('manual', 'webhook', 'internal')),
  delivery_config_json TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS site_api_keys (
  id TEXT PRIMARY KEY,
  site_id TEXT NOT NULL REFERENCES business_sites(id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  key_prefix TEXT NOT NULL,
  secret_hash TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'revoked')),
  last_used_at TEXT,
  expires_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_site_api_keys_site ON site_api_keys(site_id);

CREATE TABLE IF NOT EXISTS products (
  id TEXT PRIMARY KEY,
  site_id TEXT NOT NULL REFERENCES business_sites(id) ON DELETE RESTRICT,
  external_product_id TEXT,
  name TEXT NOT NULL,
  description TEXT,
  amount_minor INTEGER NOT NULL CHECK (amount_minor >= 0),
  currency TEXT NOT NULL DEFAULT 'CNY',
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  delivery_rule_json TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(site_id, external_product_id)
);
CREATE INDEX IF NOT EXISTS idx_products_site_status ON products(site_id, status);

CREATE TABLE IF NOT EXISTS orders (
  id TEXT PRIMARY KEY,
  site_id TEXT NOT NULL REFERENCES business_sites(id) ON DELETE RESTRICT,
  order_no TEXT NOT NULL UNIQUE,
  external_order_no TEXT,
  product_id TEXT REFERENCES products(id) ON DELETE SET NULL,
  buyer_ref TEXT,
  buyer_email TEXT,
  amount_minor INTEGER NOT NULL CHECK (amount_minor >= 0),
  currency TEXT NOT NULL DEFAULT 'CNY',
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'paid', 'closed', 'refunding', 'refunded', 'failed')),
  subject TEXT NOT NULL,
  notify_url TEXT,
  return_url TEXT,
  paid_at TEXT,
  expires_at TEXT,
  metadata_json TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(site_id, external_order_no)
);
CREATE INDEX IF NOT EXISTS idx_orders_site_created ON orders(site_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_orders_site_status ON orders(site_id, status);

CREATE TABLE IF NOT EXISTS payments (
  id TEXT PRIMARY KEY,
  site_id TEXT NOT NULL REFERENCES business_sites(id) ON DELETE RESTRICT,
  order_id TEXT NOT NULL REFERENCES orders(id) ON DELETE RESTRICT,
  channel TEXT NOT NULL CHECK (channel IN ('alipay')),
  channel_trade_no TEXT,
  channel_out_trade_no TEXT NOT NULL UNIQUE,
  amount_minor INTEGER NOT NULL CHECK (amount_minor >= 0),
  status TEXT NOT NULL DEFAULT 'created' CHECK (status IN ('created', 'processing', 'succeeded', 'failed', 'closed')),
  request_payload_json TEXT,
  channel_response_json TEXT,
  notified_at TEXT,
  paid_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_payments_site_created ON payments(site_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_payments_order ON payments(order_id);

CREATE TABLE IF NOT EXISTS refunds (
  id TEXT PRIMARY KEY,
  site_id TEXT NOT NULL REFERENCES business_sites(id) ON DELETE RESTRICT,
  order_id TEXT NOT NULL REFERENCES orders(id) ON DELETE RESTRICT,
  payment_id TEXT NOT NULL REFERENCES payments(id) ON DELETE RESTRICT,
  refund_no TEXT NOT NULL UNIQUE,
  channel_refund_no TEXT,
  amount_minor INTEGER NOT NULL CHECK (amount_minor > 0),
  reason TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'succeeded', 'failed')),
  requested_by TEXT REFERENCES admin_accounts(id) ON DELETE SET NULL,
  processed_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_refunds_site_created ON refunds(site_id, created_at DESC);

CREATE TABLE IF NOT EXISTS delivery_records (
  id TEXT PRIMARY KEY,
  site_id TEXT NOT NULL REFERENCES business_sites(id) ON DELETE RESTRICT,
  order_id TEXT NOT NULL REFERENCES orders(id) ON DELETE RESTRICT,
  idempotency_key TEXT NOT NULL UNIQUE,
  mode TEXT NOT NULL CHECK (mode IN ('manual', 'webhook', 'internal')),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'succeeded', 'failed')),
  attempt_count INTEGER NOT NULL DEFAULT 0,
  request_json TEXT,
  response_json TEXT,
  last_error TEXT,
  delivered_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_delivery_site_status ON delivery_records(site_id, status);

CREATE TABLE IF NOT EXISTS audit_logs (
  id TEXT PRIMARY KEY,
  actor_admin_id TEXT REFERENCES admin_accounts(id) ON DELETE SET NULL,
  site_id TEXT REFERENCES business_sites(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  resource_type TEXT,
  resource_id TEXT,
  result TEXT NOT NULL CHECK (result IN ('success', 'denied', 'failure')),
  detail_json TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_site_created ON audit_logs(site_id, created_at DESC);
