-- IndexNow (Bing, Yandex, Seznam, Naver): khoá theo site, nhật ký gửi
CREATE TABLE IF NOT EXISTS indexnow (site_id INTEGER PRIMARY KEY REFERENCES sites(id) ON DELETE CASCADE, key TEXT NOT NULL, mode TEXT, verified_at INTEGER, last_error TEXT, updated_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS indexnow_log (id INTEGER PRIMARY KEY AUTOINCREMENT, site_id INTEGER NOT NULL REFERENCES sites(id) ON DELETE CASCADE, url TEXT NOT NULL, reason TEXT, status INTEGER, at INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS idx_indexnow_log ON indexnow_log(site_id, at);
-- Worker bộ đo phiên bản 2 phục vụ thêm file khoá IndexNow ở gốc tên miền
ALTER TABLE stats_domains ADD COLUMN worker_v INTEGER NOT NULL DEFAULT 1;
-- Tài khoản mạng xã hội: kết nối trực tiếp hoặc qua Postiz
ALTER TABLE social_accounts ADD COLUMN via TEXT NOT NULL DEFAULT 'direct';
ALTER TABLE social_accounts ADD COLUMN extra TEXT;
-- Bài social có nhiều phiên bản (Pinterest: nhiều Pin mới cho cùng một bài, mỗi Pin một ảnh thật khác)
CREATE TABLE social_posts_v2 (id INTEGER PRIMARY KEY AUTOINCREMENT, site_id INTEGER NOT NULL REFERENCES sites(id) ON DELETE CASCADE, network TEXT NOT NULL, source_url TEXT NOT NULL, variant INTEGER NOT NULL DEFAULT 0, source_title TEXT, text TEXT, title TEXT, image_url TEXT, images TEXT,
  status TEXT NOT NULL DEFAULT 'queued', gate TEXT, remote_id TEXT, remote_url TEXT, error TEXT, posted_at INTEGER, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, UNIQUE (site_id, network, source_url, variant));
INSERT INTO social_posts_v2 (id, site_id, network, source_url, variant, source_title, text, title, image_url, status, gate, remote_id, remote_url, error, posted_at, created_at, updated_at)
  SELECT id, site_id, network, source_url, 0, source_title, text, title, image_url, status, gate, remote_id, remote_url, error, posted_at, created_at, updated_at FROM social_posts;
DROP TABLE social_posts;
ALTER TABLE social_posts_v2 RENAME TO social_posts;
CREATE INDEX IF NOT EXISTS idx_social_posts ON social_posts(site_id, status);
