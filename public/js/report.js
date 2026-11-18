// Báo cáo tuần qua email (tab trong Cài đặt).

import { api } from "./api.js";
import { $, esc, showMsg, busy, fmtTime } from "./ui.js";

const DAYS = ["Chủ nhật", "Thứ hai", "Thứ ba", "Thứ tư", "Thứ năm", "Thứ sáu", "Thứ bảy"];

export async function mountReport(el, admin) {
  if (!el) return;
  const render = (d) => {
    const s = d.settings;
    const dis = admin ? "" : " disabled";
    el.innerHTML = `
      <p class="note">Giờ tính theo múi giờ trong tab Model AI &amp; chi phí. Mỗi tuần một email: click từng site, từ khoá lên/xuống, backlink mới/mất, cảnh báo tụt, việc chờ anh duyệt và lỗi kết nối. Gửi qua Cloudflare Email Service; địa chỉ gửi phải thuộc tên miền đã bật ở Email Service › Sending.</p>
      ${d.emailBinding ? "" : `<p class="msg warn">Worker chưa có binding EMAIL nên chưa gửi được.</p>`}
      <form id="rp-form" class="op-form" novalidate><fieldset${dis}>
        <label class="check"><input type="checkbox" name="enabled"${s.enabled ? " checked" : ""}><span>Gửi báo cáo hằng tuần</span></label>
        <label>Gửi tới (tối đa 5, cách nhau dấu phẩy)<input name="to" value="${esc(s.to.join(", "))}" placeholder="email của anh" autocomplete="off"></label>
        <label>Địa chỉ gửi<input name="from" value="${esc(s.from)}" placeholder="bao-cao@ten-mien-cua-anh.com" autocomplete="off"></label>
        <div class="form-grid">
          <label>Thứ<select name="weekday">${DAYS.map((n, i) => `<option value="${i}"${i === s.weekday ? " selected" : ""}>${n}</option>`).join("")}</select></label>
          <label>Từ giờ<input type="number" name="hour" min="0" max="23" value="${s.hour}"></label>
        </div>
        ${admin ? `<div class="toolbar"><button type="submit" class="primary" id="rp-save">Lưu</button><button type="button" id="rp-preview">Xem trước</button><button type="button" id="rp-send"${s.from && s.to.length ? "" : " disabled"}>Gửi ngay</button></div>` : ""}
      </fieldset></form>
      <div class="msg" id="rp-msg" hidden></div>
      <div id="rp-preview-box"></div>
      ${d.log.length ? `<h3 class="sub">Đã gửi</h3><ul class="rk-list">${d.log.map((l) => `<li>${esc(fmtTime(l.sent_at))} · ${l.ok ? `${l.recipients} người nhận · ${esc(l.subject || "")}` : `<span class="tag err">Lỗi</span> ${esc(l.error || "")}`}</li>`).join("")}</ul>` : ""}`;
    const msg = (e, ok) => showMsg($("#rp-msg", el), ok || e.message, ok ? "ok" : "err");
    $("#rp-form", el)?.addEventListener("submit", (ev) => {
      ev.preventDefault();
      const f = ev.target.elements;
      busy($("#rp-save", el), "Đang lưu…", async () => {
        try { render(await api("/api/report", { method: "PUT", body: { enabled: f.enabled.checked, to: f.to.value, from: f.from.value, weekday: Number(f.weekday.value), hour: Number(f.hour.value) } })); msg(null, "Đã lưu."); } catch (e) { msg(e); }
      });
    });
    $("#rp-preview", el)?.addEventListener("click", (ev) => busy(ev.currentTarget, "Đang dựng…", async () => {
      try {
        const p = await api("/api/report/preview");
        $("#rp-preview-box", el).innerHTML = `<div class="card rp-preview"><p><b>Tiêu đề:</b> ${esc(p.subject)}</p><pre class="rp-text">${esc(p.text)}</pre></div>`;
      } catch (e) { msg(e); }
    }));
    $("#rp-send", el)?.addEventListener("click", (ev) => busy(ev.currentTarget, "Đang gửi…", async () => {
      try { const r = await api("/api/report/send", { method: "POST" }); render(await api("/api/report")); msg(null, `Đã gửi tới ${r.sent} người nhận.`); } catch (e) { msg(e); }
    }));
  };
  try { render(await api("/api/report")); } catch (e) { el.innerHTML = `<p class="msg err">${esc(e.message)}</p>`; }
}
