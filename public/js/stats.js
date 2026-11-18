// Số liệu site: bộ đo riêng (lượt xem, thời gian đọc, độ cuộn, click affiliate) cho site tĩnh Astro trên Cloudflare.

import { api } from "./api.js";
import { $, $$, esc, showMsg, busy, ago } from "./ui.js";

const ST = { pending: ["Chờ tên miền", "warn"], installed: ["Đang kiểm tra", "info"], verified: ["Đang đo", "ok"], error: ["Lỗi", "err"] };
const tag = ([l, c]) => `<span class="tag ${c}">${esc(l)}</span>`;
const n = (v) => (v == null ? "—" : Number(v).toLocaleString("vi-VN"));
const sec = (v) => (v == null ? "—" : `${Math.floor(v / 60)}:${String(v % 60).padStart(2, "0")}`);
const pct = (v) => (v == null ? "—" : `${v}%`);

function chart(series) {
  if (!series.length) return "";
  const W = 720, H = 140, max = Math.max(1, ...series.map((s) => s.views)), bw = W / series.length;
  const bars = series.map((s, i) => {
    const h = Math.round((s.views / max) * (H - 18)), ah = Math.round((s.aff / max) * (H - 18));
    return `<g><title>${esc(s.day)}: ${s.views} lượt xem, ${s.aff} click affiliate</title><rect class="bar-v" x="${(i * bw + 1).toFixed(1)}" y="${H - h}" width="${Math.max(1, bw - 2).toFixed(1)}" height="${h}" rx="2"/>${ah ? `<rect class="bar-a" x="${(i * bw + 1).toFixed(1)}" y="${H - ah}" width="${Math.max(1, bw - 2).toFixed(1)}" height="${ah}" rx="2"/>` : ""}</g>`;
  }).join("");
  return `<svg class="st-chart" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="Lượt xem theo ngày">${bars}</svg>
    <p class="st-legend"><span class="lv">Lượt xem</span><span class="la">Click affiliate</span><span>${esc(series[0].day)} → ${esc(series[series.length - 1].day)}</span></p>`;
}

function domainsHtml(d, canEdit) {
  return `${d.domains.length ? `<div class="tablewrap boxed"><table><thead><tr><th>Tên miền</th><th>Trạng thái</th><th>Dòng script dán vào layout</th><th></th></tr></thead><tbody>
    ${d.domains.map((x) => `<tr>
      <td><b>${esc(x.domain)}</b><small>${x.site_id ? `Site: ${esc(x.site_name || x.domain)}` : "Chưa thêm site vào app"}${x.views7 ? ` · ${n(Math.round(x.views7))} lượt xem 7 ngày` : ""}</small></td>
      <td>${tag(ST[x.status] || [x.status, ""])}${x.message ? `<small>${esc(x.message)}</small>` : ""}${x.last_event_at ? `<small>Có dữ liệu ${esc(ago(x.last_event_at))}</small>` : ""}</td>
      <td class="st-snip"><code>${esc(x.snippet)}</code><button type="button" data-copy="${esc(x.snippet)}">Chép (Astro)</button><button type="button" data-copy="${esc(x.html)}">Chép (HTML)</button></td>
      <td>${canEdit ? `<button type="button" data-st-install="${x.id}">${x.status === "verified" ? "Kiểm tra" : "Dựng lại"}</button>` : ""}</td>
    </tr>`).join("")}</tbody></table></div>` : `<p class="note">Chưa có tên miền nào.</p>`}
    ${canEdit ? `<form id="st-add" class="st-add" novalidate><label>Tên miền (site chưa có cũng được)<input name="domain" placeholder="ten-mien.de" required></label><button type="submit" class="primary" id="st-add-btn">Thêm và lấy script</button></form>` : ""}`;
}

function reportHtml(r) {
  const t = r.totals;
  const low = r.pages.filter((p) => p.views >= 50 && p.affRate < 1 && p.aff >= 0);
  return `
  <div class="st-kpis">
    <div><small>Lượt xem</small><b>${n(t.views)}</b></div>
    <div><small>Thời gian đọc TB</small><b>${sec(t.avgSec)}</b></div>
    <div><small>Cuộn TB</small><b>${pct(t.scroll)}</b></div>
    <div><small>Click affiliate</small><b>${n(t.aff)}</b></div>
    <div><small>Tỉ lệ click affiliate</small><b>${t.affRate}%</b></div>
  </div>
  ${chart(r.series)}
  ${low.length ? `<p class="msg warn">${low.length} trang có từ 50 lượt xem nhưng dưới 1% click affiliate: nên xem lại vị trí bảng so sánh và nút mua (${low.slice(0, 3).map((p) => esc(p.path)).join(", ")}${low.length > 3 ? "…" : ""}).</p>` : ""}
  <h3 class="sub">Theo trang</h3>
  ${r.pages.length ? `<div class="tablewrap boxed"><table class="st-pages"><thead><tr><th>Trang</th><th>Xem</th><th>Đọc TB</th><th>Cuộn</th><th>Click aff.</th><th>Tỉ lệ</th><th>CTA</th><th>LCP</th><th>Mobile</th></tr></thead><tbody>
    ${r.pages.map((p) => `<tr${p.views >= 50 && p.affRate < 1 ? ` class="st-low"` : ""}><td class="st-path">${esc(p.path)}</td><td>${n(p.views)}</td><td>${sec(p.avgSec)}</td><td>${pct(p.scroll)}</td><td>${n(p.aff)}</td><td>${p.affRate}%</td><td>${n(p.cta)}</td><td>${p.lcp == null ? "—" : `${(p.lcp / 1000).toFixed(1)}s`}</td><td>${pct(p.mobile)}</td></tr>`).join("")}
  </tbody></table></div>` : `<p class="note">Chưa có số liệu trong khoảng này. Số liệu được gộp mỗi giờ.</p>`}
  <div class="st-two">
    <div><h3 class="sub">Link được click nhiều</h3>${r.clicks.length ? `<div class="tablewrap boxed"><table><thead><tr><th>Link</th><th>Loại</th><th>Click</th></tr></thead><tbody>${r.clicks.map((c) => `<tr><td class="st-path">${esc(c.target)}${c.label ? `<small>${esc(c.label)}</small>` : ""}</td><td>${esc({ aff: "Affiliate", out: "Ra ngoài", cta: "CTA" }[c.kind] || c.kind)}</td><td>${n(c.n)}</td></tr>`).join("")}</tbody></table></div>` : `<p class="note">Chưa có click.</p>`}</div>
    <div><h3 class="sub">Nguồn khách</h3>${r.sources.length ? `<div class="tablewrap boxed"><table><thead><tr><th>Nguồn</th><th>Xem</th></tr></thead><tbody>${r.sources.map((s) => `<tr><td>${esc(s.source)}</td><td>${n(s.views)}</td></tr>`).join("")}</tbody></table></div>` : `<p class="note">Chưa có.</p>`}</div>
  </div>`;
}

export async function viewStats(main, args, K) {
  const canEdit = K.state.user.role !== "viewer";
  const d = await api("/api/stats");
  const live = d.domains.filter((x) => x.status === "verified" || x.last_event_at);
  const pick = K.state.statsDomain && d.domains.some((x) => x.domain === K.state.statsDomain) ? K.state.statsDomain : (live[0] || d.domains[0])?.domain;
  const days = K.state.statsDays || 28;
  main.innerHTML = `
  <div class="page">
    <div class="page-head"><div><h2>Số liệu site</h2><p>Bộ đo riêng cho site tĩnh: lượt xem, thời gian đọc thật, độ cuộn, click link affiliate, CTA và tốc độ trang. Không cookie, không lưu IP; dữ liệu nằm trong tài khoản Cloudflare của anh.</p></div></div>
    <div class="msg" id="st-msg" hidden></div>
    ${d.cfReady ? "" : `<p class="msg warn">Chưa có Cloudflare API token hoặc Account ID: vào <a href="#/settings">Cài đặt</a>. Anh vẫn thêm tên miền và dán script trước được.</p>`}
    <div class="card"><h3 class="sub">${K.icon(K.ICON.globe)}Tên miền</h3>
      ${domainsHtml(d, canEdit)}
      <details class="st-help"><summary>Cách gắn vào site</summary>
        <ol>
          <li>Astro: dán dòng "Chép (Astro)" vào <code>&lt;head&gt;</code> của layout chung (thường là <code>src/layouts/BaseLayout.astro</code> hoặc <code>src/components/BaseHead.astro</code>). Cần <code>is:inline</code> để Astro không xử lý thẻ này.</li>
          <li>Site chưa thêm vào app vẫn dán trước được: khi tên miền có trong tài khoản Cloudflare, app tự dựng bộ đo (thử lại mỗi giờ). Site đã thêm vào app thì tên miền tự có ở đây.</li>
          <li>Link affiliate (<code>rel="sponsored"</code>) tự được đếm. Muốn đếm nút liên hệ hay nút dịch vụ: bọc vùng đó bằng <code>data-dy-cta</code>.</li>
          <li>Mỗi lượt xem tốn khoảng 2–3 request Worker. Gói Workers Free có 100.000 request/ngày cho cả tài khoản; nhiều site có traffic thì cần gói Workers Paid (5 USD/tháng).</li>
          <li>Token Cloudflare cần thêm quyền Account › Account Analytics Read để app đọc số liệu.</li>
        </ol>
      </details>
    </div>
    ${pick ? `<div class="card"><h3 class="sub">${K.icon(K.ICON.chart)}Báo cáo</h3>
      <div class="toolbar">
        <select id="st-domain" aria-label="Tên miền">${d.domains.map((x) => `<option value="${esc(x.domain)}"${x.domain === pick ? " selected" : ""}>${esc(x.domain)}</option>`).join("")}</select>
        <select id="st-days" aria-label="Khoảng thời gian">${[7, 28, 90].map((v) => `<option value="${v}"${v === days ? " selected" : ""}>${v} ngày</option>`).join("")}</select>
        ${canEdit ? `<button type="button" id="st-refresh">Cập nhật số liệu</button>` : ""}
        <span class="note">${d.rolledAt ? `Gộp lần cuối ${esc(ago(d.rolledAt))}` : "Chưa gộp lần nào"}</span>
      </div>
      <div id="st-report"><p class="note">Đang tải…</p></div>
    </div>` : ""}
  </div>`;
  const msg = (e, ok) => showMsg($("#st-msg", main), ok || e.message, ok ? "ok" : "err");
  const reload = () => viewStats(main, args, K);
  $$("[data-copy]", main).forEach((b) => b.addEventListener("click", async () => {
    try { await navigator.clipboard.writeText(b.dataset.copy); b.textContent = "Đã chép"; } catch { msg({ message: "Trình duyệt không cho chép: bôi đen dòng script để chép tay." }); }
  }));
  $("#st-add", main)?.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    await busy($("#st-add-btn", main), "Đang dựng…", async () => {
      try { const r = await api("/api/stats/domains", { method: "POST", body: { domain: ev.target.elements.domain.value } }); await reload(); msg(null, r.message); } catch (e) { msg(e); }
    });
  });
  $$("[data-st-install]", main).forEach((b) => b.addEventListener("click", () => busy(b, "Đang dựng…", async () => {
    try { const r = await api(`/api/stats/domains/${b.dataset.stInstall}/install`, { method: "POST" }); await reload(); msg(r.ok ? null : { message: r.message }, r.ok ? r.message : ""); } catch (e) { msg(e); }
  })));
  if (!pick) return;
  const load = async () => {
    const el = $("#st-report", main);
    try { el.innerHTML = reportHtml(await api(`/api/stats/report?domain=${encodeURIComponent(K.state.statsDomain || pick)}&days=${K.state.statsDays || 28}`)); } catch (e) { el.innerHTML = `<p class="msg err">${esc(e.message)}</p>`; }
  };
  $("#st-domain", main).addEventListener("change", (e) => { K.state.statsDomain = e.target.value; load(); });
  $("#st-days", main).addEventListener("change", (e) => { K.state.statsDays = Number(e.target.value); load(); });
  $("#st-refresh", main)?.addEventListener("click", (ev) => busy(ev.currentTarget, "Đang cập nhật…", async () => {
    try { await api("/api/stats/refresh", { method: "POST" }); K.state.statsDomain = $("#st-domain", main).value; await reload(); } catch (e) { msg(e); }
  }));
  await load();
}
