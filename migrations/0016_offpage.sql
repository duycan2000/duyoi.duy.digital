-- Team off-page: Prospector, Outreach (Writer + Reviewer, gửi qua Cloudflare Email Service, anh duyệt từng thư),
-- Hộp thư đến (Email Routing → Worker), Community Scout (anh tự đăng), Link Monitor, Citations, Social Entity.
CREATE TABLE IF NOT EXISTS op_settings (site_id INTEGER PRIMARY KEY REFERENCES sites(id) ON DELETE CASCADE, data TEXT NOT NULL DEFAULT '{}', state TEXT NOT NULL DEFAULT '{}', updated_at INTEGER NOT NULL);

CREATE TABLE IF NOT EXISTS op_prospects (id INTEGER PRIMARY KEY AUTOINCREMENT, site_id INTEGER NOT NULL REFERENCES sites(id) ON DELETE CASCADE, kind TEXT NOT NULL, url TEXT NOT NULL, domain TEXT NOT NULL, title TEXT, snippet TEXT,
  contact_email TEXT, contact_page TEXT, dead_url TEXT, traffic REAL, score INTEGER NOT NULL DEFAULT 0, why TEXT, query TEXT, status TEXT NOT NULL DEFAULT 'new', note TEXT, found_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, UNIQUE (site_id, url));
CREATE INDEX IF NOT EXISTS idx_op_prospects ON op_prospects(site_id, status);

CREATE TABLE IF NOT EXISTS op_messages (id INTEGER PRIMARY KEY AUTOINCREMENT, site_id INTEGER NOT NULL REFERENCES sites(id) ON DELETE CASCADE, prospect_id INTEGER, kind TEXT NOT NULL DEFAULT 'initial', parent_id INTEGER,
  to_email TEXT NOT NULL, subject TEXT NOT NULL, body TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'draft', review TEXT, send_after INTEGER, sent_at INTEGER, message_id TEXT, error TEXT, approved_by TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS idx_op_messages ON op_messages(site_id, status);

CREATE TABLE IF NOT EXISTS op_inbox (id INTEGER PRIMARY KEY AUTOINCREMENT, site_id INTEGER, from_email TEXT NOT NULL, to_email TEXT NOT NULL, subject TEXT, snippet TEXT, message_id TEXT, in_reply_to TEXT, matched_id INTEGER, prospect_id INTEGER, read INTEGER NOT NULL DEFAULT 0, received_at INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS idx_op_inbox ON op_inbox(site_id, received_at);

CREATE TABLE IF NOT EXISTS op_threads (id INTEGER PRIMARY KEY AUTOINCREMENT, site_id INTEGER NOT NULL REFERENCES sites(id) ON DELETE CASCADE, platform TEXT NOT NULL, url TEXT NOT NULL, title TEXT, snippet TEXT, risk INTEGER, factors TEXT, page TEXT,
  draft TEXT, include_link INTEGER NOT NULL DEFAULT 0, status TEXT NOT NULL DEFAULT 'new', found_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, UNIQUE (site_id, url));

CREATE TABLE IF NOT EXISTS op_links (id INTEGER PRIMARY KEY AUTOINCREMENT, site_id INTEGER NOT NULL REFERENCES sites(id) ON DELETE CASCADE, prospect_id INTEGER, source_url TEXT NOT NULL, target_url TEXT, anchor TEXT, rel TEXT, status TEXT NOT NULL DEFAULT 'unchecked',
  first_seen INTEGER, last_checked INTEGER, note TEXT, created_at INTEGER NOT NULL, UNIQUE (site_id, source_url));

CREATE TABLE IF NOT EXISTS op_citations (id INTEGER PRIMARY KEY AUTOINCREMENT, site_id INTEGER NOT NULL REFERENCES sites(id) ON DELETE CASCADE, directory TEXT NOT NULL, url TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'todo', listing_url TEXT, note TEXT, updated_at INTEGER NOT NULL, UNIQUE (site_id, directory));

CREATE TABLE IF NOT EXISTS social_accounts (id INTEGER PRIMARY KEY AUTOINCREMENT, site_id INTEGER NOT NULL REFERENCES sites(id) ON DELETE CASCADE, network TEXT NOT NULL, handle TEXT, profile_url TEXT, target_id TEXT, target_name TEXT,
  status TEXT NOT NULL DEFAULT 'profile', error TEXT, expires_at INTEGER, connected_at INTEGER, updated_at INTEGER NOT NULL, UNIQUE (site_id, network));

CREATE TABLE IF NOT EXISTS social_posts (id INTEGER PRIMARY KEY AUTOINCREMENT, site_id INTEGER NOT NULL REFERENCES sites(id) ON DELETE CASCADE, network TEXT NOT NULL, source_url TEXT NOT NULL, source_title TEXT, text TEXT, title TEXT, image_url TEXT,
  status TEXT NOT NULL DEFAULT 'queued', gate TEXT, remote_id TEXT, remote_url TEXT, error TEXT, posted_at INTEGER, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, UNIQUE (site_id, network, source_url));
CREATE INDEX IF NOT EXISTS idx_social_posts ON social_posts(site_id, status);

CREATE TABLE IF NOT EXISTS social_seen (site_id INTEGER NOT NULL REFERENCES sites(id) ON DELETE CASCADE, url TEXT NOT NULL, first_seen INTEGER NOT NULL, PRIMARY KEY (site_id, url));

CREATE TABLE IF NOT EXISTS oauth_states (state TEXT PRIMARY KEY, site_id INTEGER NOT NULL, network TEXT NOT NULL, verifier TEXT, user_id INTEGER, created_at INTEGER NOT NULL);
