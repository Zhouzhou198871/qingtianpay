-- 晴天支付中心第二阶段：超管初始化、安全限流与系统设置
-- 仅应用于新项目独立 D1，不要在旧 qingtian-pay-auth 上执行。

CREATE TABLE IF NOT EXISTS system_settings (
  setting_key TEXT PRIMARY KEY,
  setting_value TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS auth_attempts (
  identity_key TEXT PRIMARY KEY,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  window_started_at INTEGER NOT NULL,
  locked_until INTEGER,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_auth_attempts_lock ON auth_attempts(locked_until);

INSERT OR IGNORE INTO admin_accounts
  (id, email, role, status, is_protected)
VALUES
  ('superadmin-01', 'chulingli1988@outlook.com', 'superadmin', 'pending', 1),
  ('superadmin-02', '295297477@qq.com', 'superadmin', 'pending', 1),
  ('superadmin-03', 'Boss@lynli.me', 'superadmin', 'pending', 1);

INSERT OR IGNORE INTO system_settings (setting_key, setting_value)
VALUES ('bootstrap_completed', 'false');
