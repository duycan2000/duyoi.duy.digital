// Tab "Làm tay" của Off-page: agent chuẩn bị sẵn, anh tự làm rồi đánh dấu kết quả.

import { api } from "./api.js";
import { $, $$, esc, showMsg, busy, ago } from "./ui.js";

const GUIDE = {
  journalist: { why: "Phóng viên cần ý kiến chuyên gia; bài được đăng thường có link về site. Đây là cách lấy link báo chí phổ biến nhất hiện nay.", steps: ["Đăng ký 1–2 nền tảng hợp thị trường bằng email của site, dùng tên thật của anh.", "Mỗi ngày lướt câu hỏi, chỉ trả lời câu đúng chuyên môn.", "Dán câu hỏi vào ô dưới: agent soạn nháp từ Hồ sơ site, anh sửa bằng kinh nghiệm thật và gửi trong vài giờ.", "Khi bài lên, dán link bài vào cột Link để Link Monitor theo dõi."], inputs: ["owner"] },
  image: { why: "Ảnh thật anh chụp hay bị trang khác lấy dùng mà không ghi nguồn. Xin họ thêm link ghi nguồn là cách lấy link nhanh, ít bị từ chối.", steps: ["Bấm Google Lens / Bing / TinEye cạnh từng ảnh để tìm trang đang dùng ảnh.", "Dán link trang đó vào ô của ảnh rồi bấm Kiểm tra: app xem trang có link về site chưa, tìm email.", "Trang chưa ghi nguồn sẽ vào tab Prospects (loại ghi nguồn ảnh): bấm Soạn email, anh duyệt rồi app gửi."], inputs: [] },
  testimonial: { why: "Nhà cung cấp phần mềm, dịch vụ hay đăng nhận xét của khách kèm link về site khách. Chỉ viết cho công cụ anh dùng thật.", steps: ["Nhập tên công cụ/nhà cung cấp anh dùng thật và vài dòng trải nghiệm thật.", "Bấm Chuẩn bị: agent tìm trang testimonial/case study của họ và soạn nhận xét từ ghi chú của anh.", "Anh sửa, gửi qua form của họ, ghi rõ link site."], inputs: ["vendors", "experience", "owner"] },
  partner: { why: "Hãng có trang \"nơi bán\", \"đối tác\", chương trình review: được liệt kê thì có link từ trang uy tín cùng ngành.", steps: ["Agent lấy hãng từ thư viện link affiliate và Hồ sơ site (anh thêm hãng khác nếu có).", "Bấm Chuẩn bị: agent tìm trang đối tác/nơi bán và soạn lời đề nghị.", "Anh gửi qua form đối tác của hãng."], inputs: ["vendors", "owner"] },
  podcast: { why: "Podcast cần khách có chuyên môn; trang ghi chú tập (show notes) thường có link về site khách.", steps: ["Bấm Chuẩn bị: agent tìm podcast cùng chủ đề và soạn thư xin làm khách, 3 chủ đề nói, bio.", "Anh mở trang podcast, điền form khách mời bằng nội dung đã soạn.", "Khi lên sóng, dán link trang tập vào cột Link."], inputs: ["owner"] },
  roundup: { why: "Bài tổng hợp ý kiến chuyên gia thường ghi tên và link từng người góp ý.", steps: ["Bấm Chuẩn bị: agent tìm các bài tổng hợp chuyên gia cùng chủ đề và soạn lời ngỏ, một đoạn góp ý mẫu.", "Anh liên hệ tác giả (form/mạng xã hội), góp ý bằng kinh nghiệm thật."], inputs: ["experience", "owner"] },
  association: { why: "Hiệp hội ngành, phòng thương mại địa phương có danh bạ hội viên kèm link. Hợp site dịch vụ có doanh nghiệp thật.", steps: ["Bấm Chuẩn bị: agent tìm hiệp hội, danh bạ ngành và phòng thương mại ở thành phố trong NAP.", "Anh xem điều kiện tham gia (có nơi thu phí hội viên: đó là phí hội viên, anh tự quyết), đăng ký bằng thông tin thật."], inputs: ["owner"] },
  reclaim: { why: "Trang cũ đã xoá nhưng vẫn còn site khác link tới thì link đó bị phí. Chuyển hướng 301 về trang gần nhất để giữ lại.", steps: ["Search Console › Liên kết › Các trang được liên kết nhiều nhất › Xuất.", "Dán danh sách vào ô dưới, bấm Kiểm tra: app tìm trang lỗi 404 và gợi ý trang để chuyển hướng.", "Anh tự đặt redirect 301 (Rank Math › Redirections, hoặc file _redirects/astro.config của site Astro)."], inputs: [] }
};
const ST = [["todo", "Chưa làm"], ["doing", "Đang làm"], ["done", "Đã gửi"], ["won", "Có link"], ["skip", "Bỏ"]];

function kitHtml(kit) {
  if (!kit?.items?.length) return "";
  return `<div class="mk-kit">${kit.items.map((i, k) => `<div class="mk-item"><div class="mk-item-head"><b>${esc(i.label)}</b><button type="button" data-copy-kit="${k}">Chép</button></div><pre>${esc(i.text)}</pre></div>`).join("")}
    ${kit.owner_todo?.length ? `<p class="note"><b>Anh cần kiểm tra:</b> ${kit.owner_todo.map(esc).join(" · ")}</p>` : ""}
    <small class="note">Soạn ${esc(ago(kit.at || kit.updatedAt))}</small></div>`;
}

function rowsHtml(method, rows) {
  if (!rows.length) return "";
  return `<div class="tablewrap boxed"><table class="mk-table"><thead><tr><th>${method === "image" ? "Ảnh" : method === "reclaim" ? "Trang lỗi" : "Nơi"}</th><th>${method === "image" ? "Tìm trang dùng ảnh" : method === "reclaim" ? "Chuyển hướng tới" : "Ghi chú"}</th><th>Trạng thái</th><th>Link (khi có)</th></tr></thead><tbody>
    ${rows.map((r) => `<tr>
      <td class="op-url">${method === "image" ? `<a href="${esc(r.url)}" target="_blank" rel="noopener">${esc(r.title || r.url)}</a>` : `<a href="${esc(r.url)}" target="_blank" rel="noopener">${esc(r.title || r.url)}</a><small>${esc(new URL(r.url).hostname)}</small>`}${r.note ? `<small>${esc(r.note)}</small>` : ""}</td>
      <td>${method === "image" ? `<div class="mk-rev"><a href="${esc(r.detail.google)}" target="_blank" rel="noopener">Google Lens</a><a href="${esc(r.detail.bing)}" target="_blank" rel="noopener">Bing</a><a href="${esc(r.detail.tineye)}" target="_blank" rel="noopener">TinEye</a><a href="${esc(r.detail.yandex)}" target="_blank" rel="noopener">Yandex</a></div><div class="mk-found"><input type="url" data-found-in="${r.id}" placeholder="Link trang đang dùng ảnh"><button type="button" data-found="${r.id}">Kiểm tra</button></div>`
        : method === "reclaim" ? `<a href="${esc(r.detail.suggest)}" target="_blank" rel="noopener">${esc(r.detail.suggestTitle || r.detail.suggest)}</a><small>301: ${esc(new URL(r.url).pathname)} → ${esc(new URL(r.detail.suggest).pathname)}</small>`
        : esc(r.detail.snippet || r.detail.vendor || r.detail.brand || "")}</td>
      <td><select data-mst="${r.id}">${ST.map(([v, l]) => `<option value="${v}"${v === r.status ? " selected" : ""}>${l}</option>`).join("")}</select></td>
      <td><input type="url" data-mlink="${r.id}" value="${esc(r.link_url || "")}" placeholder="https://…"></td>
    </tr>`).join("")}</tbody></table></div>`;
}

export async function mountManual(el, siteId, canEdit, onMsg) {
  if (!el) return;
  let d;
  try { d = await api(`/api/offpage/${siteId}/manual`); } catch (e) { el.innerHTML = `<p class="msg err">${esc(e.message)}</p>`; return; }
  const by = (m) => d.targets.filter((t) => t.method === m);
  const done = d.targets.filter((t) => t.status === "won").length;
  el.innerHTML = `
  <p class="note">Agent chuẩn bị sẵn nơi cần liên hệ, đoạn văn để dán và link tra cứu; anh tự làm và đánh dấu kết quả. Link "Có link" tự vào Link Monitor. ${done ? `<b>${done} link đã có từ việc làm tay.</b>` : ""}</p>
  ${Object.entries(d.methods).map(([m, info]) => {
    const g = GUIDE[m], kit = d.kits[m], rows = by(m);
    const open = rows.filter((r) => r.status === "todo" || r.status === "doing").length;
    return `<details class="mk" data-m="${m}"${kit || rows.length ? "" : ""}>
      <summary><b>${esc(info.label)}</b>${rows.length ? `<span class="tag info">${open} việc</span>` : ""}${kit?.items?.length ? `<span class="tag ok">Đã chuẩn bị</span>` : ""}</summary>
      <p>${esc(g.why)}</p>
      <ol class="mk-steps">${g.steps.map((x) => `<li>${esc(x)}</li>`).join("")}</ol>
      ${m === "journalist" ? `<div class="mk-plat">${d.platforms.map((p) => `<a href="${esc(p.url)}" target="_blank" rel="noopener"><b>${esc(p.name)}</b><small>${esc(p.note)}</small></a>`).join("")}</div>
        ${d.german ? `<p class="note">Site Đức: trả lời phóng viên là việc họ hỏi trước, không phải email lạnh, nên dùng được.</p>` : ""}` : ""}
      ${canEdit && m !== "image" && m !== "reclaim" ? `<form class="op-form mk-form" data-prep="${m}" novalidate><fieldset><legend>Chuẩn bị</legend>
        ${g.inputs.includes("vendors") ? `<label class="wide">${m === "partner" ? "Hãng thêm (mỗi dòng một hãng)" : "Công cụ, nhà cung cấp anh dùng thật (mỗi dòng một tên)"}<textarea name="vendors" rows="3">${esc((kit?.inputs?.vendors || []).join("\n"))}</textarea></label>` : ""}
        ${g.inputs.includes("experience") ? `<label class="wide">Trải nghiệm thật của anh (agent chỉ dùng những gì anh ghi)<textarea name="experience" rows="3">${esc(kit?.inputs?.experience || "")}</textarea></label>` : ""}
        <label>Tên thật của anh<input name="ownerName" value="${esc(kit?.inputs?.ownerName || "")}"></label>
        <label>Vai trò<input name="ownerRole" value="${esc(kit?.inputs?.ownerRole || "")}" placeholder="VD: Founder, kỹ sư CAD 10 năm"></label>
        <div class="toolbar wide"><button type="submit" class="primary">${kit ? "Chuẩn bị lại" : "Chuẩn bị"}</button></div></fieldset></form>` : ""}
      ${canEdit && m === "image" ? `<button type="button" data-prep-btn="image">${rows.length ? "Cập nhật danh sách ảnh" : "Lấy danh sách ảnh thật"}</button>` : ""}
      ${canEdit && m === "reclaim" ? `<form class="mk-reclaim" data-reclaim novalidate><textarea name="text" rows="5" placeholder="Dán danh sách URL (hoặc cả file CSV xuất từ Search Console)"></textarea><button type="submit" class="primary">Kiểm tra</button></form>` : ""}
      ${kitHtml(kit)}
      ${m === "journalist" && canEdit ? `<form class="op-form mk-pr" data-pr novalidate><fieldset><legend>Soạn trả lời một câu hỏi</legend>
        <label class="wide">Câu hỏi của phóng viên (dán nguyên văn)<textarea name="query" rows="5"></textarea></label>
        <label class="wide">Ghi chú thêm của anh (số liệu thật, ví dụ thật)<textarea name="notes" rows="2"></textarea></label>
        <div class="toolbar wide"><button type="submit" class="primary">Soạn nháp</button></div></fieldset></form><div class="mk-pr-out"></div>` : ""}
      ${rowsHtml(m, rows)}
    </details>`;
  }).join("")}`;
  const reload = () => mountManual(el, siteId, canEdit, onMsg);
  const keepOpen = (m) => { el.dataset.open = m; };
  if (el.dataset.open) { const det = el.querySelector(`details[data-m="${el.dataset.open}"]`); if (det) det.open = true; }
  const put = async (id, body) => { try { const r = await api(`/api/offpage/manual/${id}`, { method: "PUT", body }); return r; } catch (e) { onMsg(e); return null; } };
  $$("form[data-prep]", el).forEach((f) => f.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const m = f.dataset.prep; keepOpen(m);
    await busy(f.querySelector("button[type=submit]"), "Đang chuẩn bị…", async () => {
      try { const r = await api(`/api/offpage/${siteId}/manual`, { method: "POST", body: { method: m, vendors: f.elements.vendors?.value, experience: f.elements.experience?.value, ownerName: f.elements.ownerName.value, ownerRole: f.elements.ownerRole.value } }); await reload(); onMsg(null, r.note || `Đã chuẩn bị: ${r.targets} nơi mới, ${r.items} đoạn văn.`); } catch (e) { onMsg(e); }
    });
  }));
  $$("[data-prep-btn]", el).forEach((b) => b.addEventListener("click", () => { keepOpen(b.dataset.prepBtn); busy(b, "Đang lấy…", async () => { try { const r = await api(`/api/offpage/${siteId}/manual`, { method: "POST", body: { method: b.dataset.prepBtn } }); await reload(); onMsg(null, r.note || `${r.targets} ảnh mới.`); } catch (e) { onMsg(e); } }); }));
  $$("form[data-reclaim]", el).forEach((f) => f.addEventListener("submit", async (ev) => { ev.preventDefault(); keepOpen("reclaim"); await busy(f.querySelector("button"), "Đang kiểm tra…", async () => { try { const r = await api(`/api/offpage/${siteId}/reclaim`, { method: "POST", body: { text: f.elements.text.value } }); await reload(); onMsg(null, `Đã kiểm tra ${r.checked} trang: ${r.broken} trang lỗi cần chuyển hướng.`); } catch (e) { onMsg(e); } }); }));
  $$("form[data-pr]", el).forEach((f) => f.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const out = f.parentElement.querySelector(".mk-pr-out");
    await busy(f.querySelector("button"), "Đang soạn…", async () => {
      try {
        const r = await api(`/api/offpage/${siteId}/pr-answer`, { method: "POST", body: { query: f.elements.query.value, notes: f.elements.notes.value } });
        out.innerHTML = `<div class="mk-item"><p class="note"><b>Có hợp để trả lời không:</b> ${esc(r.fit)}</p>${r.subject ? `<div class="mk-item-head"><b>Tiêu đề</b></div><pre>${esc(r.subject)}</pre>` : ""}<div class="mk-item-head"><b>Nháp trả lời</b><button type="button" data-copy-pr>Chép</button></div><pre class="mk-pr-text">${esc(r.answer)}</pre>${r.missing.length ? `<p class="note"><b>Anh cần bổ sung:</b> ${r.missing.map(esc).join(" · ")}</p>` : ""}</div>`;
        out.querySelector("[data-copy-pr]").addEventListener("click", (e) => navigator.clipboard.writeText(out.querySelector(".mk-pr-text").textContent).then(() => { e.target.textContent = "Đã chép"; }));
      } catch (e) { onMsg(e); }
    });
  }));
  $$("[data-copy-kit]", el).forEach((b) => b.addEventListener("click", () => navigator.clipboard.writeText(b.closest(".mk-item").querySelector("pre").textContent).then(() => { b.textContent = "Đã chép"; }, () => onMsg({ message: "Không chép được: bôi đen để chép tay." }))));
  $$("[data-mst]", el).forEach((s) => s.addEventListener("change", async () => { keepOpen(s.closest("details").dataset.m); const link = el.querySelector(`[data-mlink="${s.dataset.mst}"]`).value; if (s.value === "won" && !link) onMsg({ message: "Dán link trang đã đặt link về site để Link Monitor theo dõi." }); await put(s.dataset.mst, { status: s.value, link_url: link || undefined }); }));
  $$("[data-mlink]", el).forEach((i) => i.addEventListener("change", async () => { keepOpen(i.closest("details").dataset.m); if (i.value) await put(i.dataset.mlink, { link_url: i.value, status: "won" }); await reload(); }));
  $$("[data-found]", el).forEach((b) => b.addEventListener("click", () => { keepOpen("image"); busy(b, "Đang kiểm tra…", async () => { const v = el.querySelector(`[data-found-in="${b.dataset.found}"]`).value; const r = await put(b.dataset.found, { found_url: v }); if (r) { await reload(); onMsg(r.ok ? null : { message: r.message }, r.ok ? r.message : ""); } }); }));
}
