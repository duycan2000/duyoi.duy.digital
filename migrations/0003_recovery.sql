-- Phục hồi thứ hạng: mỗi lần chẩn đoán một site là một "ca" (case).
-- Agent quét trang, ghi vấn đề, rồi đề xuất việc. Không việc nào tự đăng lên site: phải được duyệt.

CREATE TABLE recovery_cases (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  site_id       INTEGER NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  status        TEXT NOT NULL DEFAULT 'discovering' CHECK (status IN ('discovering', 'scanning', 'analyzing', 'ready', 'failed', 'archived')),
  drop_month    TEXT,                       -- YYYY-MM: tháng anh thấy tụt (để đối chiếu bản cập nhật Google)
  rules         TEXT NOT NULL DEFAULT '{}', -- JSON: luật an toàn riêng của site (blocklist, ngôn ngữ, trang thương mại…)
  sitemap_url   TEXT,
  pages_total   INTEGER NOT NULL DEFAULT 0,
  pages_done    INTEGER NOT NULL DEFAULT 0,
  score         INTEGER,                    -- điểm sức khoẻ 0–100
  diagnosis     TEXT,                       -- JSON: nguyên nhân, bằng chứng, đối chiếu cập nhật
  site_checks   TEXT,                       -- JSON: robots.txt, sitemap, https…
  error         TEXT,
  created_by    INTEGER,
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL,
  finished_at   INTEGER
);
CREATE INDEX idx_recovery_cases_status ON recovery_cases(status);
CREATE INDEX idx_recovery_cases_site ON recovery_cases(site_id);

CREATE TABLE recovery_pages (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  case_id      INTEGER NOT NULL REFERENCES recovery_cases(id) ON DELETE CASCADE,
  url          TEXT NOT NULL,
  path         TEXT NOT NULL,
  lastmod      TEXT,
  status       TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'done', 'error')),
  http_status  INTEGER,
  kind         TEXT,                        -- commercial | informational | system
  data         TEXT,                        -- JSON trích từ HTML
  error        TEXT,
  fetched_at   INTEGER,
  UNIQUE (case_id, url)
);
CREATE INDEX idx_recovery_pages_queue ON recovery_pages(case_id, status);

CREATE TABLE recovery_findings (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  case_id     INTEGER NOT NULL REFERENCES recovery_cases(id) ON DELETE CASCADE,
  code        TEXT NOT NULL,
  category    TEXT NOT NULL,                -- technical | content | links | funnel | safety | offpage | timeline
  severity    TEXT NOT NULL CHECK (severity IN ('critical', 'high', 'medium', 'low', 'info')),
  title       TEXT NOT NULL,
  detail      TEXT,
  urls        TEXT,                         -- JSON mảng URL bị ảnh hưởng
  created_at  INTEGER NOT NULL
);
CREATE INDEX idx_recovery_findings_case ON recovery_findings(case_id);

CREATE TABLE recovery_tasks (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  case_id      INTEGER NOT NULL REFERENCES recovery_cases(id) ON DELETE CASCADE,
  agent        TEXT NOT NULL,
  kind         TEXT NOT NULL,
  title        TEXT NOT NULL,
  detail       TEXT,
  target_url   TEXT,
  payload      TEXT,                        -- JSON: danh sách sửa find/replace, đề xuất meta…
  risk         TEXT NOT NULL CHECK (risk IN ('safe', 'review', 'irreversible')),
  priority     INTEGER NOT NULL DEFAULT 50, -- nhỏ = làm trước
  status       TEXT NOT NULL DEFAULT 'proposed' CHECK (status IN ('proposed', 'approved', 'rejected', 'done', 'blocked')),
  gate         TEXT,                        -- JSON: kết quả Gác cổng
  note         TEXT,
  decided_by   INTEGER,
  decided_at   INTEGER,
  created_at   INTEGER NOT NULL,
  updated_at   INTEGER NOT NULL
);
CREATE INDEX idx_recovery_tasks_case ON recovery_tasks(case_id, status);
