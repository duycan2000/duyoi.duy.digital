-- Sổ tay Trưởng nhóm: cách anh muốn ra quyết định (ưu tiên site, định dạng, luật riêng). Lưu mọi phiên bản để khôi phục.
CREATE TABLE IF NOT EXISTS lead_playbook (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  body TEXT NOT NULL,
  note TEXT,
  by TEXT NOT NULL,
  at INTEGER NOT NULL
);
