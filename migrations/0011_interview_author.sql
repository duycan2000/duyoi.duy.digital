-- Phỏng vấn trải nghiệm của anh trước khi viết, và ai viết bài (agent hay anh tự viết bằng Claude)
ALTER TABLE content_ideas ADD COLUMN interview TEXT;   -- JSON {questions[], answers[], skipped}
ALTER TABLE content_ideas ADD COLUMN author TEXT;      -- agent | owner (NULL = chưa chọn)
