// Content Studio: chọn site để làm bài mới theo định dạng chuẩn (Best X / Top N, review, so sánh, how-to, guide).

import { api } from "./api.js";
import { esc, ago } from "./ui.js";

const FORMATS = [
  ["Best X / Top N", "Danh sách xếp hạng sản phẩm: bảng chọn nhanh, mỗi sản phẩm có lý do, nhược điểm, ảnh thật, nút mua; bảng so sánh, cách chọn, FAQ, kết luận."],
  ["Review 1 sản phẩm", "Kết luận ngay đầu, ưu/nhược, ai nên mua, trải nghiệm thật theo từng tiêu chí, thông số, sản phẩm thay thế. Bắt buộc anh đã dùng thật."],
  ["So sánh X vs Y", "Trả lời nhanh nên chọn cái nào, bảng so sánh, từng tiêu chí có người thắng, ai nên mua cái nào."],
  ["How-to", "Kết quả đạt được, cần chuẩn bị gì, từng bước có cách kiểm tra, lỗi hay gặp, xử lý sự cố, FAQ."],
  ["Guide / cẩm nang", "Tóm tắt, ý chính, từ cơ bản đến nâng cao, danh sách kiểm tra khi chọn, FAQ."],
  ["Bài thông tin", "Trả lời thẳng câu hỏi, mỗi mục một câu hỏi phụ, dẫn về trang dịch vụ/trang tiền."]
];

export async function viewStudio(main, args, K) {
  const [{ cases }, hq] = await Promise.all([api("/api/recovery"), api("/api/hq")]);
  main.innerHTML = `
  <div class="page">
    <div class="page-head"><div><h2>Content Studio</h2><p>Bài mới theo khung chuẩn cho agent. Bài affiliate tự có câu công khai link, nút mua gắn rel="sponsored", và chỉ đưa lên WordPress (dạng nháp) khi đủ ảnh thật anh tải lên.</p></div></div>
    ${hq.asks.length ? `<div class="card"><h3 class="sub">${K.icon(K.ICON.users)}Agent đang hỏi anh</h3><div class="asks">${hq.asks.map((a) => `<a href="#/recovery/${a.caseId}/content"><b>${esc(a.domain)}</b> · "${esc(a.keyword)}": ${esc(a.text)}</a>`).join("")}</div></div>` : ""}
    <div class="card"><h3 class="sub">${K.icon(K.ICON.globe)}Chọn site</h3>
      ${cases.length ? `<div class="tablewrap boxed"><table><thead><tr><th>Site</th><th>Quét cấu trúc</th><th></th></tr></thead><tbody>
        ${cases.map((c) => `<tr><td><b>${esc(c.domain)}</b></td><td>${c.status === "ready" ? `xong ${esc(ago(c.finishedAt))}` : esc(c.status)}</td><td><a class="btn primary" href="#/recovery/${c.id}/content">Mở Bài mới</a></td></tr>`).join("")}
      </tbody></table></div>` : ""}
      <p class="note">Site chưa có ở đây? Vào <a href="#/recovery">Phục hồi thứ hạng</a>, nhập địa chỉ site để app quét cấu trúc (chỉ đọc, không sửa gì). Agent cần biết site đang có bài nào để không viết trùng.</p>
    </div>
    <div class="card"><h3 class="sub">${K.icon(K.ICON.list)}Các định dạng agent viết</h3>
      <div class="fmt-grid">${FORMATS.map(([t, d]) => `<div><b>${esc(t)}</b><p class="note">${esc(d)}</p></div>`).join("")}</div>
      <p class="note">Theo hướng dẫn viết review của Google (bằng chứng trải nghiệm thật, ưu/nhược, so sánh, link nhiều nơi bán, lý do cho từng lựa chọn), yêu cầu công khai link affiliate của FTC và rel="sponsored" cho link affiliate. Không chèn schema HowTo/FAQ vì Google đã bỏ rich result của hai loại này.</p>
    </div>
  </div>`;
}
