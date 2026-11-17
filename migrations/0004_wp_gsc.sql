-- Kết nối WordPress, dữ liệu Search Console/GA4 và sao lưu trước khi sửa site.

ALTER TABLE recovery_pages ADD COLUMN traffic TEXT;   -- JSON: click, impression, vị trí, lead theo trang

CREATE TABLE recovery_backups (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id         INTEGER REFERENCES recovery_tasks(id) ON DELETE SET NULL,
  site_id         INTEGER NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  post_id         INTEGER NOT NULL,
  url             TEXT NOT NULL,
  content         TEXT,                 -- post_content gốc
  elementor_data  TEXT,                 -- _elementor_data gốc (nếu có)
  meta            TEXT,                 -- JSON meta Rank Math gốc
  modified_gmt    TEXT,
  applied         TEXT,                 -- JSON: những gì đã gửi đi và kết quả
  created_by      INTEGER,
  created_at      INTEGER NOT NULL,
  restored_at     INTEGER,
  restored_by     INTEGER
);
CREATE INDEX idx_recovery_backups_task ON recovery_backups(task_id);
