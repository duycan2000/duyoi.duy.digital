-- Giới hạn bài mới mỗi tháng tính theo ngày duyệt (trước đây theo ngày sửa, sửa bài cũ cũng bị tính)
ALTER TABLE content_ideas ADD COLUMN approved_at INTEGER;
UPDATE content_ideas SET approved_at = updated_at WHERE status IN ('approved', 'briefed', 'drafted', 'published');
