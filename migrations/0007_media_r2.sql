-- Site Astro: ảnh thật lưu ở Cloudflare R2, phục vụ qua tên miền riêng của site (ví dụ https://img.ten-mien.com)
ALTER TABLE sites ADD COLUMN media_base_url TEXT;
