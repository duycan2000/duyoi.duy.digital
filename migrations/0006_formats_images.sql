-- Định dạng bài (roundup, review, so sánh, how-to, guide), sản phẩm affiliate và ảnh thật do người tải lên
ALTER TABLE content_ideas ADD COLUMN format TEXT NOT NULL DEFAULT 'article';
ALTER TABLE content_ideas ADD COLUMN products TEXT;   -- JSON {method, items[{name,url,merchant,links[],bestFor,tested,notes,specs,pros,cons}]}
ALTER TABLE content_ideas ADD COLUMN images TEXT;     -- JSON {slot: {id,url,alt,caption,source,width,height,at,by}}
ALTER TABLE content_ideas ADD COLUMN source TEXT NOT NULL DEFAULT 'research';
