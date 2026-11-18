-- Kiểm tra kết nối (site_id 0 = kiểm tra chung), Quick wins từ Search Console, nhật ký báo cáo tuần
CREATE TABLE IF NOT EXISTS health_checks (site_id INTEGER NOT NULL, key TEXT NOT NULL, label TEXT NOT NULL, status TEXT NOT NULL, message TEXT NOT NULL, fix TEXT, link TEXT, checked_at INTEGER NOT NULL, PRIMARY KEY (site_id, key));
CREATE TABLE IF NOT EXISTS qw_items (id INTEGER PRIMARY KEY AUTOINCREMENT, site_id INTEGER NOT NULL REFERENCES sites(id) ON DELETE CASCADE, page TEXT NOT NULL, query TEXT,
  impr REAL NOT NULL DEFAULT 0, clicks REAL NOT NULL DEFAULT 0, ctr REAL NOT NULL DEFAULT 0, pos REAL NOT NULL DEFAULT 0, expected REAL NOT NULL DEFAULT 0, kind TEXT NOT NULL DEFAULT 'ctr',
  status TEXT NOT NULL DEFAULT 'new', old_title TEXT, old_desc TEXT, new_title TEXT, new_desc TEXT, reason TEXT, gate TEXT, backup TEXT, pr TEXT, error TEXT,
  base_ctr REAL, base_pos REAL, applied_at INTEGER, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, UNIQUE (site_id, page));
CREATE TABLE IF NOT EXISTS report_log (id INTEGER PRIMARY KEY AUTOINCREMENT, sent_at INTEGER NOT NULL, recipients INTEGER NOT NULL DEFAULT 0, subject TEXT, ok INTEGER NOT NULL, error TEXT);
