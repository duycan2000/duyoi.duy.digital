// Quick wins: trang vị trí 4–15 nhiều hiển thị nhưng ít click → title/meta mới (qua Gác cổng, anh duyệt) hoặc đẩy bằng nội dung.

import { api } from "./api.js";
import { $, $$, esc, showMsg, busy, ago } from "./ui.js";

const pct = (v) => (v == null ? "—" : `${(v * 100).toFixed(1)}%`);
const tag = (l, c = "") => `<span class="tag ${c}">${esc(l)}</span>`;
const path = (u) => { try { return new URL(u).pathname; } catch { return u; } };
const STATUS = { new: ["Mới", ""], drafted: ["Có đề xuất", "info"], approved: ["Đã duyệt", "warn"], applied: ["Đã áp dụng", "ok"], rejected: ["Bỏ qua", ""], failed: ["Lỗi", "err"] };

function gateHtml(g) {
  if (!g) return "";
  const items = g.problems || [];
  return `<div class="qw-gate">${g.ok ? tag("Gác cổng: qua", "ok") : tag("Gác cổng: chặn", "err")}${items.length ? `<ul class="rk-list">${items.map((p) => `<li>${tag(p.level === "block" ? "Chặn" : "Lưu ý", p.level === "block" ? "err" : "warn")} ${esc(p.message)}</li>`).join("")}</ul>` : ""}</div>`;
}

function itemHtml(i, platform, canEdit) {
  const st = STATUS[i.status] || [i.status, ""];
  const head = `<div class="qw-head"><a href="${esc(i.page)}" target="_blank" rel="noopener"><b>${esc(path(i.page))}</b></a> ${tag(st[0], st[1])} ${i.kind === "push" ? tag("Vị trí 8–15: đẩy bằng nội dung", "info") : tag("CTR thấp", "warn")}</div>
    <p class="qw-metrics">Vị trí ${Number(i.pos).toFixed(1)} · ${Math.round(i.impr)} hiển thị/tuần · ${Math.round(i.clicks)} click · CTR ${pct(i.ctr)} (trang cùng nhóm vị trí của site: ${pct(i.expected)})${i.query ? ` · truy vấn chính: <b>${esc(i.query)}</b>` : ""}</p>`;
  if (i.kind === "push" && !i.new_title) {
    return `<div class="card qw-item">${head}
      <p>Title/CTR ổn so với site; trang cần lên thêm vài bậc. Thêm một mục trả lời thẳng truy vấn chính, nối 2–3 link nội bộ từ bài cùng chủ đề, kiểm tra 4 câu đầu nói rõ chủ đề.</p>
      <div class="toolbar"><a class="btn" href="#/topical">Xem chấm semantic</a><a class="btn" href="#/recovery">Mở ca Phục hồi (nối link nội bộ)</a>${canEdit ? `<button type="button" data-act="draft" data-id="${i.id}">Vẫn viết title/meta mới</button><button type="button" data-act="reject" data-id="${i.id}">Bỏ qua</button>` : ""}</div></div>`;
  }
  const after = i.after ? `<p class="qw-after">Sau khi áp dụng: CTR ${pct(i.base_ctr)} → <b>${pct(i.after.ctr)}</b>, vị trí ${Number(i.base_pos).toFixed(1)} → <b>${Number(i.after.pos).toFixed(1)}</b></p>` : i.applied_at ? `<p class="note">Áp dụng ${esc(ago(i.applied_at))}; đo lại sau 7 ngày (Search Console trễ khoảng 2 ngày).</p>` : "";
  const editable = canEdit && ["drafted", "new", "rejected"].includes(i.status);
  return `<div class="card qw-item">${head}
    ${i.new_title ? `<div class="qw-diff">
      <div><small>Đang chạy</small><p class="qw-old"><b>${esc(i.old_title || "(không có)")}</b><br>${esc(i.old_desc || "(không có description)")}</p></div>
      <div><small>Đề xuất</small>${editable ? `<label><span>Title · <span data-len="t${i.id}">${i.new_title.length}</span> ký tự</span><input data-t="${i.id}" value="${esc(i.new_title)}" maxlength="120"></label><label><span>Description · <span data-len="d${i.id}">${i.new_desc.length}</span> ký tự</span><textarea data-d="${i.id}" rows="3" maxlength="300">${esc(i.new_desc)}</textarea></label>` : `<p class="qw-new"><b>${esc(i.new_title)}</b><br>${esc(i.new_desc)}</p>`}
        ${i.reason ? `<p class="note">${esc(i.reason)}</p>` : ""}</div>
    </div>${gateHtml(i.gate)}` : ""}
    ${i.pr ? `<p>Pull request: <a href="${esc(i.pr.url)}" target="_blank" rel="noopener">${esc(i.pr.url)}</a></p>` : ""}
    ${i.error ? `<p class="msg err">${esc(i.error)}</p>` : ""}
    ${after}
    ${canEdit ? `<div class="toolbar">
      ${["new", "drafted", "rejected"].includes(i.status) ? `<button type="button" data-act="draft" data-id="${i.id}">${i.new_title ? "Viết lại" : "Viết đề xuất"}</button>` : ""}
      ${i.status === "drafted" ? `<button type="button" data-act="edit" data-id="${i.id}">Lưu chỗ sửa</button><button type="button" class="primary" data-act="approve" data-id="${i.id}" ${i.gate?.ok ? "" : "disabled"}>Duyệt</button>` : ""}
      ${i.status === "approved" ? `<button type="button" class="primary" data-act="apply" data-id="${i.id}">${platform === "astro" ? "Mở pull request" : "Ghi lên site"}</button>` : ""}
      ${i.canRollback ? `<button type="button" class="danger" data-act="rollback" data-id="${i.id}">Hoàn tác</button>` : ""}
      ${["new", "drafted", "approved"].includes(i.status) ? `<button type="button" data-act="reject" data-id="${i.id}">Bỏ qua</button>` : ""}
    </div>` : ""}
  </div>`;
}

export async function viewQuickWins(main, args, K) {
  const canEdit = K.state.user.role !== "viewer";
  const load = async (sid) => {
    const d = await api(`/api/quickwins${sid ? `/${sid}` : ""}`);
    const site = d.sites.find((s) => s.id === d.siteId);
    const open = d.items.filter((i) => !["applied", "rejected"].includes(i.status));
    const done = d.items.filter((i) => ["applied", "rejected"].includes(i.status));
    main.innerHTML = `
    <div class="page">
      <div class="page-head"><div><h2>Quick wins</h2><p>Trang đã ở vị trí 4–15 với nhiều hiển thị nhưng ít click so với các trang cùng nhóm vị trí của chính site. Viết lại title/meta qua Gác cổng, anh duyệt từng trang; WordPress ghi qua plugin (có sao lưu, hoàn tác được), Astro mở pull request. App đo lại sau 7 ngày.</p></div></div>
      <div class="msg" id="qw-msg" hidden></div>
      ${d.sites.length ? `<div class="toolbar qw-sites">${d.sites.map((s) => `<a class="btn ${s.id === d.siteId ? "primary" : ""}" href="#/wins/${s.id}">${esc(s.domain)}${s.open ? ` (${s.open})` : ""}</a>`).join("")}</div>` : `<p class="note">Chưa có site.</p>`}
      ${site ? `<div class="toolbar"><span class="note">${site.gscAt ? `Search Console cập nhật ${esc(ago(site.gscAt))}.` : "Chưa có số liệu Search Console: vào Thứ hạng & cảnh báo › Đọc Search Console."}</span>${canEdit ? `<button type="button" id="qw-find">Tìm lại</button>` : ""}</div>` : ""}
      ${open.length ? open.map((i) => itemHtml(i, site?.platform, canEdit)).join("") : site ? `<p class="note">Không có trang nào đủ điều kiện lúc này${site.gscAt ? "" : " (cần số liệu Search Console)"}.</p>` : ""}
      ${done.length ? `<h3 class="sub">Đã xử lý</h3>${done.map((i) => itemHtml(i, site?.platform, canEdit)).join("")}` : ""}
    </div>`;
    const msg = (e, ok) => showMsg($("#qw-msg", main), ok || e.message, ok ? "ok" : "err");
    $("#qw-find", main)?.addEventListener("click", (ev) => busy(ev.currentTarget, "Đang tìm…", async () => { try { const r = await api(`/api/quickwins/${d.siteId}/find`, { method: "POST" }); await load(d.siteId); msg(null, `Tìm thấy ${r.found} trang.`); } catch (e) { msg(e); } }));
    $$("[data-t]", main).forEach((el) => el.addEventListener("input", () => { const n = $(`[data-len="t${el.dataset.t}"]`, main); if (n) n.textContent = el.value.length; }));
    $$("[data-d]", main).forEach((el) => el.addEventListener("input", () => { const n = $(`[data-len="d${el.dataset.d}"]`, main); if (n) n.textContent = el.value.length; }));
    const LABEL = { draft: "Đang viết…", approve: "…", reject: "…", apply: "Đang ghi…", rollback: "Đang hoàn tác…", edit: "Đang kiểm…" };
    const DONE = { draft: "Đã có đề xuất, Gác cổng đã kiểm.", approve: "Đã duyệt.", apply: site?.platform === "astro" ? "Đã mở pull request." : "Đã ghi title/meta mới lên site.", rollback: "Đã trả lại title/meta cũ.", edit: "Đã lưu và kiểm lại." };
    $$("[data-act]", main).forEach((b) => b.addEventListener("click", () => busy(b, LABEL[b.dataset.act] || "…", async () => {
      const id = b.dataset.id, act = b.dataset.act;
      const body = act === "edit" ? { new_title: $(`[data-t="${id}"]`, main)?.value, new_desc: $(`[data-d="${id}"]`, main)?.value } : {};
      try { await api(`/api/quickwins/items/${id}/${act}`, { method: "POST", body }); await load(d.siteId); if (DONE[act]) msg(null, DONE[act]); } catch (e) { msg(e); }
    })));
  };
  await load(Number(args[0]) || null);
}
