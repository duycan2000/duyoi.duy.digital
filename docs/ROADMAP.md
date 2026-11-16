# Lộ trình Duy Ơi

Giao diện và cách hoạt động theo bản demo đã duyệt (`docs/prototype.html`, mở bằng trình duyệt). Mỗi giai đoạn chỉ bắt đầu khi giai đoạn trước chạy ổn trên Cloudflare.

## Giai đoạn 1 · Nền tảng (bản này)
- Tạo admin lần đầu bằng `SETUP_TOKEN`, đăng nhập, đổi mật khẩu, xem phiên.
- Khai báo site: Astro (repo GitHub), WordPress, WooCommerce.
- Cài đặt: API key mã hoá (OpenRouter, DataForSEO, Groq, Cloudflare, Google), model theo tầng, trần chi phí.
- Tạm dừng toàn bộ hệ thống, nhật ký, cron 15 phút ghi nhịp.

## Giai đoạn 2 · Dữ liệu SEO
- Client DataForSEO có Budget Guard: ghi `usage_events`, dừng khi chạm trần tháng.
- Rankings: desktop và mobile hằng ngày, SERP feature, AI Overview, đối thủ, cannibalization.
- Site audit (DataForSEO On-Page), Kiểm tra kỹ thuật (CrUX, index, sitemap).
- Backlink monitoring hằng ngày.
- Keyword Hub, câu hỏi thật (PAA mở 4 lớp, autocomplete, diễn đàn).
- Lịch chạy: Queues theo loại việc, mỗi site lệch phút cố định, hạn mức từng nhà cung cấp (Durable Object).

## Giai đoạn 3 · Nội dung
- Import PDF topical map, Project context (giọng văn, tác giả, luật riêng).
- Content Studio: gói nghiên cứu → hỏi anh 2–3 câu → Writer → Auditor 100 điểm (cổng "Thông tin mới") → tự viết lại tối đa 3 vòng.
- Ảnh bài viết bằng model trả phí, chân thực; không tạo ảnh giả làm ảnh sản phẩm thật.
- Đăng bài: WordPress qua Application Password + plugin kết nối; Astro qua PR vào repo.
- Quick wins, trang so sánh, free tool.

## Giai đoạn 4 · Off-page
- Prospects: tìm, chấm điểm, tìm email, đọc quy định nhận bài.
- Hộp thư riêng từng site (Email Routing + Email Service), agent soạn, anh duyệt; báo về điện thoại.
- Off-page team, Tìm link, Citations. Site Đức: không email lạnh.

## Giai đoạn 5 · AI, phân tích, tối ưu
- AI visibility, Entity, Analytics (GSC, GA4, Bing), Penalty, chấm điểm domain.
- Prompt Optimizer (cache, rút ngữ cảnh, gom lô, A/B trước khi áp dụng).
- Agent HQ 3D đọc trạng thái thật.
