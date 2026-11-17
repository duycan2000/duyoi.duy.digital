-- Thư viện link affiliate của từng site, đề xuất chèn vào bài đã đăng, và các lần áp dụng (sao lưu để hoàn tác)
CREATE TABLE IF NOT EXISTS affiliate_links (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  site_id INTEGER NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  aliases TEXT NOT NULL DEFAULT '[]',
  url TEXT NOT NULL,
  merchant TEXT NOT NULL DEFAULT '',
  old_urls TEXT NOT NULL DEFAULT '[]',
  active INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS affiliate_edits (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  site_id INTEGER NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  link_id INTEGER,
  page TEXT NOT NULL,              -- URL trang (WordPress) hoặc đường dẫn file trong repo (Astro)
  page_title TEXT,
  kind TEXT NOT NULL,              -- link | button | disclosure | replace_url
  find TEXT NOT NULL,
  replace TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'proposed', -- proposed | approved | rejected | applied | failed
  gate TEXT,
  apply_id INTEGER,
  error TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_aff_edits ON affiliate_edits(site_id, status);
CREATE TABLE IF NOT EXISTS affiliate_applies (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  site_id INTEGER NOT NULL,
  page TEXT NOT NULL,
  platform TEXT NOT NULL,
  backup TEXT,                     -- WordPress: nội dung trước khi sửa (để hoàn tác)
  pr TEXT,                         -- Astro: pull request
  status TEXT NOT NULL,            -- applied | restored | pr_open | merged | failed
  by TEXT,
  at INTEGER NOT NULL
);
