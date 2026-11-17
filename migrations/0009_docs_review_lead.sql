-- Tài liệu site (PDF) và Hồ sơ site rút ra từ đó
CREATE TABLE IF NOT EXISTS site_docs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  site_id INTEGER NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  size INTEGER NOT NULL,
  sha256 TEXT NOT NULL,
  kind TEXT,
  status TEXT NOT NULL DEFAULT 'reading',  -- reading | ready | failed
  error TEXT,
  result TEXT,                             -- JSON do agent Đọc tài liệu rút ra
  created_by INTEGER,
  created_at INTEGER NOT NULL,
  UNIQUE (site_id, sha256)
);
CREATE TABLE IF NOT EXISTS site_profiles (
  site_id INTEGER PRIMARY KEY REFERENCES sites(id) ON DELETE CASCADE,
  data TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  updated_by TEXT
);
-- Hàng việc giao cho agent (Trưởng nhóm đề xuất, anh duyệt)
CREATE TABLE IF NOT EXISTS agent_jobs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  site_id INTEGER REFERENCES sites(id) ON DELETE CASCADE,
  action TEXT NOT NULL,
  params TEXT NOT NULL,
  agent TEXT NOT NULL,
  why TEXT,
  status TEXT NOT NULL DEFAULT 'queued',   -- queued | running | done | failed
  result TEXT,
  error TEXT,
  message_id INTEGER,
  created_by INTEGER,
  created_at INTEGER NOT NULL,
  started_at INTEGER,
  finished_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_jobs_status ON agent_jobs(status, created_at);
-- Trò chuyện với Trưởng nhóm
CREATE TABLE IF NOT EXISTS lead_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  role TEXT NOT NULL,                      -- user | lead
  content TEXT NOT NULL,
  plan TEXT,                               -- JSON phương án (chỉ với role lead)
  ran_at INTEGER,
  at INTEGER NOT NULL
);
