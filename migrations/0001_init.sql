-- Duy Ơi · schema giai đoạn 1: người dùng, phiên, site, cài đặt, nhật ký, hàng việc.
-- Các bảng dữ liệu SEO (rank, audit, backlink, prospects, hộp thư…) thêm ở migration của từng giai đoạn.

CREATE TABLE users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  email         TEXT NOT NULL UNIQUE COLLATE NOCASE,
  name          TEXT NOT NULL,
  role          TEXT NOT NULL DEFAULT 'admin' CHECK (role IN ('admin', 'editor', 'viewer')),
  password_hash TEXT NOT NULL,           -- pbkdf2$sha256$<iterations>$<salt b64>$<hash b64>
  created_at    INTEGER NOT NULL,
  last_login_at INTEGER
);

CREATE TABLE sessions (
  id          TEXT PRIMARY KEY,          -- SHA-256 của token trong cookie (không lưu token gốc)
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at  INTEGER NOT NULL,
  expires_at  INTEGER NOT NULL,
  ip          TEXT,
  user_agent  TEXT
);
CREATE INDEX idx_sessions_user ON sessions(user_id);
CREATE INDEX idx_sessions_expires ON sessions(expires_at);

CREATE TABLE login_attempts (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  ip         TEXT NOT NULL,
  email      TEXT NOT NULL COLLATE NOCASE,
  at         INTEGER NOT NULL
);
CREATE INDEX idx_login_attempts_ip ON login_attempts(ip, at);
CREATE INDEX idx_login_attempts_email ON login_attempts(email, at);

-- Cài đặt thường (model, trần chi phí, tạm dừng…), giá trị JSON
CREATE TABLE settings (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

-- API key và mật khẩu dịch vụ, mã hoá AES-GCM bằng ENCRYPTION_KEY
CREATE TABLE secrets (
  key        TEXT PRIMARY KEY,
  iv         TEXT NOT NULL,
  ciphertext TEXT NOT NULL,
  hint       TEXT NOT NULL,              -- vài ký tự cuối để nhận ra key, không đủ để dùng
  updated_at INTEGER NOT NULL
);

CREATE TABLE sites (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT NOT NULL,
  domain      TEXT NOT NULL UNIQUE COLLATE NOCASE,
  platform    TEXT NOT NULL CHECK (platform IN ('astro', 'wordpress', 'woocommerce')),
  site_type   TEXT NOT NULL DEFAULT 'affiliate' CHECK (site_type IN ('service', 'rank_rent', 'affiliate', 'adsense', 'ecommerce')),
  market      TEXT NOT NULL DEFAULT 'US',  -- mã quốc gia chính: US, AU, DE, CA…
  language    TEXT NOT NULL DEFAULT 'en',
  repo        TEXT,                        -- Astro: owner/repo trên GitHub
  wp_user     TEXT,                        -- WordPress: user Editor riêng cho app
  notes       TEXT,
  status      TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'paused', 'archived')),
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
);
CREATE INDEX idx_sites_status ON sites(status);

-- Hàng việc: cron đọc việc đến hạn (giai đoạn 2 đẩy sang Queues/Workflows)
CREATE TABLE jobs (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  site_id     INTEGER REFERENCES sites(id) ON DELETE CASCADE,
  kind        TEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'running', 'waiting', 'done', 'failed', 'skipped')),
  run_at      INTEGER NOT NULL,
  payload     TEXT,
  result      TEXT,
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
);
CREATE INDEX idx_jobs_due ON jobs(status, run_at);

-- Chi phí theo lần gọi API (OpenRouter, DataForSEO…), dùng cho Budget Guard
CREATE TABLE usage_events (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  site_id    INTEGER REFERENCES sites(id) ON DELETE SET NULL,
  provider   TEXT NOT NULL,
  task       TEXT NOT NULL,
  tokens_in  INTEGER NOT NULL DEFAULT 0,
  tokens_out INTEGER NOT NULL DEFAULT 0,
  cost_usd   REAL NOT NULL DEFAULT 0,
  at         INTEGER NOT NULL
);
CREATE INDEX idx_usage_at ON usage_events(at);

-- Nhật ký hoạt động (người và agent)
CREATE TABLE activity (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  actor     TEXT NOT NULL,               -- 'user:<id>' hoặc 'agent:<tên>' hoặc 'system'
  action    TEXT NOT NULL,
  detail    TEXT,
  site_id   INTEGER REFERENCES sites(id) ON DELETE SET NULL,
  at        INTEGER NOT NULL
);
CREATE INDEX idx_activity_at ON activity(at);
