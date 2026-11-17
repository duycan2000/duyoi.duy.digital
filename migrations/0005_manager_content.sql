-- Cấp Quản lý (duyệt prompt, nhật ký chi tiêu) và đội Nội dung (ý tưởng bài mới, brief, bản nháp), chế độ tự động.

CREATE TABLE prompt_reviews (
  template_id  TEXT NOT NULL,
  version      TEXT NOT NULL,             -- SHA-256 rút gọn của nội dung prompt: sửa prompt = phiên bản mới, phải duyệt lại
  status       TEXT NOT NULL CHECK (status IN ('approved', 'rejected')),
  notes        TEXT,
  reviewed_by  INTEGER,
  reviewed_at  INTEGER NOT NULL,
  PRIMARY KEY (template_id, version)
);

CREATE TABLE ai_calls (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  provider     TEXT NOT NULL,             -- openrouter | dataforseo
  agent        TEXT NOT NULL,
  task         TEXT NOT NULL,
  site_id      INTEGER REFERENCES sites(id) ON DELETE SET NULL,
  template_id  TEXT,
  version      TEXT,
  model        TEXT,
  prompt_chars INTEGER NOT NULL DEFAULT 0,
  tokens_in    INTEGER NOT NULL DEFAULT 0,
  tokens_out   INTEGER NOT NULL DEFAULT 0,
  cost_usd     REAL NOT NULL DEFAULT 0,
  status       TEXT NOT NULL CHECK (status IN ('ok', 'blocked', 'error')),
  reason       TEXT,
  at           INTEGER NOT NULL
);
CREATE INDEX idx_ai_calls_at ON ai_calls(at);
CREATE INDEX idx_ai_calls_site ON ai_calls(site_id, at);

CREATE TABLE content_ideas (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  site_id      INTEGER NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  case_id      INTEGER REFERENCES recovery_cases(id) ON DELETE SET NULL,
  keyword      TEXT NOT NULL,
  volume       INTEGER,
  kd           INTEGER,
  intent       TEXT,
  cpc          REAL,
  cluster      TEXT,
  hub_path     TEXT,                      -- trang dịch vụ bài mới sẽ dẫn về
  covered_by   TEXT,                      -- trang có sẵn đã nói về từ khoá này (không viết trùng)
  score        REAL NOT NULL DEFAULT 0,
  status       TEXT NOT NULL DEFAULT 'idea' CHECK (status IN ('idea', 'approved', 'rejected', 'briefed', 'drafted', 'published', 'failed')),
  brief        TEXT,                      -- JSON dàn ý
  draft        TEXT,                      -- JSON bài nháp (title, slug, html, meta)
  gate         TEXT,
  wp_post_id   INTEGER,
  wp_edit_url  TEXT,
  note         TEXT,
  created_at   INTEGER NOT NULL,
  updated_at   INTEGER NOT NULL,
  UNIQUE (site_id, keyword)
);
CREATE INDEX idx_content_ideas_status ON content_ideas(site_id, status);

CREATE TABLE autopilot_state (
  site_id      INTEGER PRIMARY KEY REFERENCES sites(id) ON DELETE CASCADE,
  data         TEXT NOT NULL DEFAULT '{}',  -- JSON: lần quét/nghiên cứu cuối, bước đang chạy
  updated_at   INTEGER NOT NULL
);
