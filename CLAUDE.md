# Duy Ơi — ghi chú cho Claude

- Worker TypeScript không dùng framework, không dependency lúc chạy. Router ở `src/index.ts`.
- Giao diện là JS thuần (ES modules) trong `public/`, không bước build. CSP không cho inline script hay inline style: dùng class trong `public/css/app.css`.
- Mọi dữ liệu đưa vào HTML phải qua `esc()` (`public/js/ui.js`).
- Thay đổi schema: thêm file mới trong `migrations/` (không sửa file cũ đã chạy).
- API key chỉ đọc qua `readSecret()` trong `src/settings.ts`; không trả ra API, không ghi vào log hay nhật ký.
- Trước khi commit: `npm run typecheck` và `npm test`.
- Giữ chữ tiếng Việt trong giao diện ngắn, rõ, xưng "anh" với người dùng.
- Luật sản phẩm: không mua link, không tác giả giả, không "we tested" khi chưa test, không ảnh AI giả làm ảnh thật, site Đức không email lạnh, không tự đăng Reddit/Quora.
