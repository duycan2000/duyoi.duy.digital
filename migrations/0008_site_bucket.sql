-- Site Astro trên Cloudflare: mỗi site một bucket R2 riêng, ảnh phục vụ ở https://ten-mien/images/... qua một Worker nhỏ gắn route
ALTER TABLE sites ADD COLUMN media_bucket TEXT;
ALTER TABLE sites ADD COLUMN media_verified_at INTEGER;
