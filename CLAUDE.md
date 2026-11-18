# Duy Ơi — ghi chú cho Claude

- Tiếp nhận dự án: đọc `docs/HANDOVER.md` trước (hạ tầng, kiến trúc, luật, quy trình, việc còn dở).

- Worker TypeScript không dùng framework, không dependency lúc chạy. Router ở `src/index.ts`.
- Giao diện là JS thuần (ES modules) trong `public/`, không bước build. CSP không cho inline script hay inline style: dùng class trong `public/css/app.css`.
- Mọi dữ liệu đưa vào HTML phải qua `esc()` (`public/js/ui.js`).
- Thay đổi schema: thêm file mới trong `migrations/` (không sửa file cũ đã chạy).
- API key chỉ đọc qua `readSecret()` trong `src/settings.ts`; không trả ra API, không ghi vào log hay nhật ký.
- Trước khi commit: `npm run typecheck` và `npm test`.
- Giữ chữ tiếng Việt trong giao diện ngắn, rõ, xưng "anh" với người dùng.
- Luật sản phẩm: không mua link, không tác giả giả, không "we tested" khi chưa test, không ảnh AI giả làm ảnh thật, site Đức không email lạnh, không tự đăng Reddit/Quora.
- Cron có 3 lịch (A/B/C trong `src/index.ts`), mỗi lịch phải dưới 1000 truy vấn D1. Thêm việc vào cron thì đo lại.
- Thêm hoặc sửa prompt AI: cập nhật fake trong `tests/fake-site.mjs` và báo chủ dự án duyệt prompt ở Agent HQ › Quản lý.
- Sửa plugin WordPress: tăng Version, chạy `npm run -s plugin:zip`.
- Repo công khai: không commit secret, email riêng, luật riêng của khách.
