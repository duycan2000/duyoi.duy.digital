// Kiểm tra kết nối: gọi thật từng dịch vụ (chỉ đọc) để biết phần nào chạy được.

import { api } from "./api.js";
import { $, $$, esc, showMsg, busy, ago } from "./ui.js";

const ST = { ok: ["Ổn", "ok"], warn: ["Cần xem", "warn"], fail: ["Lỗi", "err"], skip: ["Không dùng", ""] };
const tag = ([l, c]) => `<span class="tag ${c}">${esc(l)}</span>`;
const count = (checks, st) => checks.filter((c) => c.status === st).length;

function checksHtml(checks) {
  if (!checks.length) return `<p class="note">Chưa kiểm tra.</p>`;
  return `<ul class="hc-list">${checks.map((c) => `<li class="hc-${esc(c.status)}">
    <div class="hc-head">${tag(ST[c.status] || [c.status, ""])} <b>${esc(c.label)}</b></div>
    <p>${esc(c.message)}${c.link ? ` <a href="${esc(c.link)}">Mở</a>` : ""}</p>
    ${c.fix ? `<p class="note">Cách sửa: ${esc(c.fix)}</p>` : ""}
  </li>`).join("")}</ul>`;
}

function summary(checks) {
  const f = count(checks, "fail"), w = count(checks, "warn");
  return f ? tag([`${f} lỗi`, "err"]) + (w ? ` ${tag([`${w} cần xem`, "warn"])}` : "") : w ? tag([`${w} cần xem`, "warn"]) : checks.length ? tag(["Ổn", "ok"]) : tag(["Chưa kiểm", ""]);
}

export async function viewHealth(main, _args, K) {
  const canEdit = K.state.user.role !== "viewer";
  const render = (d) => {
    main.innerHTML = `
    <div class="page">
      <div class="page-head"><div><h2>Kiểm tra kết nối</h2><p>Gọi thật từng dịch vụ để biết phần nào chạy được: API key, Search Console, WordPress, GitHub, hộp thư, mạng xã hội. Chỉ đọc, không ghi gì lên site. App tự kiểm mỗi ngày; lỗi mới vào Nhật ký và báo cáo tuần.</p></div>
        ${canEdit ? `<div class="toolbar"><button type="button" class="primary" id="hc-all">Kiểm tra tất cả</button></div>` : ""}</div>
      <div class="msg" id="hc-msg" hidden></div>
      <div class="card hc-card"><div class="hc-title"><h3 class="sub">Chung</h3>${summary(d.global.checks)}<small>${d.global.at ? esc(ago(d.global.at)) : ""}</small>${canEdit ? `<button type="button" data-run="0">Kiểm tra</button>` : ""}</div>${checksHtml(d.global.checks)}</div>
      ${d.sites.map((s) => `<div class="card hc-card"><div class="hc-title"><h3 class="sub">${esc(s.domain)} <small class="note">${esc(s.platform === "astro" ? "Astro" : "WordPress")}</small></h3>${summary(s.checks)}<small>${s.at ? esc(ago(s.at)) : ""}</small>${canEdit ? `<button type="button" data-run="${s.id}">Kiểm tra</button>` : ""}</div>${checksHtml(s.checks)}</div>`).join("")}
    </div>`;
    const msg = (e) => showMsg($("#hc-msg", main), e.message, "err");
    $("#hc-all", main)?.addEventListener("click", (ev) => busy(ev.currentTarget, "Đang kiểm tra…", async () => { try { render(await api("/api/connections/run", { method: "POST" })); showMsg($("#hc-msg", main), "Đã kiểm tra xong.", "ok"); } catch (e) { msg(e); } }));
    $$("[data-run]", main).forEach((b) => b.addEventListener("click", () => busy(b, "Đang kiểm…", async () => {
      try { render(await api(`/api/connections/run/${b.dataset.run}`, { method: "POST" })); } catch (e) { msg(e); }
    })));
  };
  render(await api("/api/connections"));
}
