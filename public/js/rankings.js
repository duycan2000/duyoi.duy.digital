// Thứ hạng & cảnh báo: traffic Search Console, vị trí từ khoá, backlink của từng site; cảnh báo tụt đột ngột và phương án.

import { api } from "./api.js";
import { $, $$, esc, showMsg, busy, ago } from "./ui.js";

const n = (v) => (v == null ? "—" : Number(v).toLocaleString("vi-VN", { maximumFractionDigits: 1 }));
const change = (v) => (v == null ? `<span class="tag">—</span>` : `<span class="tag ${v <= -30 ? "err" : v < -10 ? "warn" : v > 10 ? "ok" : ""}">${v > 0 ? "+" : ""}${v}%</span>`);
const SEV = { critical: ["Khẩn", "err"], high: ["Cao", "err"], medium: ["Vừa", "warn"] };
const STATUS = { open: ["Cần xem", "err"], watching: ["Đang theo dõi", "info"], resolved: ["Đã hết", "ok"], dismissed: ["Đã bỏ qua", ""] };
const CAUSE = { technical: "Lỗi kỹ thuật", update_rolling: "Google đang chạy bản cập nhật", spam_update: "Trùng spam update", core_update: "Trùng core update", links: "Mất backlink", serp_change: "SERP đổi (AI Overview)", unknown: "Chưa rõ: cần quét site" };
const tag = ([l, c]) => `<span class="tag ${c}">${esc(l)}</span>`;
const path = (u) => { try { const x = new URL(u); return x.pathname + x.search; } catch { return u; } };

function moveCell(pos, prev) {
  if (pos == null && prev == null) return "—";
  if (pos == null) return `<span class="rk-down">ngoài top 30</span>`;
  if (prev == null) return `<b>${pos}</b>`;
  const d = prev - pos;
  return `<b>${pos}</b> ${d ? `<span class="${d > 0 ? "rk-up" : "rk-down"}">${d > 0 ? "▲" : "▼"}${Math.abs(d)}</span>` : ""}`;
}

// Đường vị trí nhỏ: thấp hơn là tốt hơn, nên trục đảo
function spark(hist) {
  const pts = hist.map((p, i) => [i, p == null ? 31 : p]);
  if (pts.length < 2) return "";
  const W = 90, H = 24, max = 31, stepX = W / (pts.length - 1);
  const d = pts.map(([i, p], k) => `${k ? "L" : "M"}${(i * stepX).toFixed(1)},${((p / max) * H).toFixed(1)}`).join(" ");
  return `<svg class="rk-spark" viewBox="0 0 ${W} ${H}" aria-hidden="true"><path d="${d}"/></svg>`;
}

function trafficChart(daily) {
  if (daily.length < 2) return `<p class="note">Chưa có số liệu Search Console.</p>`;
  const W = 720, H = 140, max = Math.max(1, ...daily.map((d) => d.clicks)), bw = W / daily.length;
  const bars = daily.map((d, i) => { const h = Math.round((d.clicks / max) * (H - 16)); return `<g><title>${esc(d.day)}: ${n(d.clicks)} click, ${n(d.impressions)} hiển thị, vị trí ${n(d.position)}</title><rect class="bar-a" x="${(i * bw + 1).toFixed(1)}" y="${H - h}" width="${Math.max(1, bw - 2).toFixed(1)}" height="${h}" rx="2"/></g>`; }).join("");
  return `<svg class="st-chart" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="Click Search Console theo ngày">${bars}</svg>
    <p class="st-legend"><span class="la">Click từ Google</span><span>${esc(daily[0].day)} → ${esc(daily[daily.length - 1].day)}</span></p>`;
}

function alertHtml(a, canEdit) {
  const d = a.detail || {};
  const list = (title, rows) => (rows.length ? `<h4>${esc(title)}</h4><ul class="rk-list">${rows.join("")}</ul>` : "");
  return `<div class="card rk-alert rk-${esc(a.status)}">
    <div class="rk-alert-head">${tag(SEV[a.severity] || [a.severity, ""])} ${tag(STATUS[a.status] || [a.status, ""])} <b>${esc(a.title)}</b><small>${esc(ago(a.created_at))}${a.recheck_at && (a.status === "open" || a.status === "watching") ? ` · kiểm lại ${esc(new Date(a.recheck_at).toLocaleDateString("vi-VN"))}` : ""}</small></div>
    ${d.cause ? `<p><b>Nguyên nhân khả dĩ:</b> ${esc(CAUSE[d.cause] || d.cause)}</p>` : ""}
    <h4>Phương án</h4>
    <ol class="rk-plan">${(a.plan || []).map((p) => `<li class="rk-${esc(p.status)}">${tag(p.auto ? ["Tự động", "info"] : ["Anh làm/duyệt", "warn"])} ${tag(p.status === "done" ? ["Xong", "ok"] : p.status === "waiting" ? ["Đang chờ", ""] : ["Chưa làm", ""])} ${esc(p.text)}${/ca #(\d+)/.test(p.text) ? ` <a href="#/recovery/${esc(p.text.match(/ca #(\d+)/)[1])}">Mở ca</a>` : ""}</li>`).join("")}</ol>
    <details><summary>Chi tiết</summary>
      ${d.traffic ? `<p>Traffic 7 ngày: ${n(d.traffic.cur)} so với ${n(d.traffic.base)} (tuần trung bình 4 tuần trước) ${change(d.traffic.change)} · nguồn ${esc(d.traffic.source === "gsc" ? "Search Console" : "tracker")}</p>` : ""}
      ${list("Lỗi kỹ thuật", (d.tech || []).map((t) => `<li><a href="${esc(t.url)}" target="_blank" rel="noopener">${esc(path(t.url))}</a>: ${esc(t.problem)}</li>`))}
      ${list("Bản cập nhật Google liên quan", (d.updates || []).map((u) => `<li><b>${esc(u.name)}</b> (${esc(u.start)} → ${esc(u.end || "đang chạy")}): ${esc(u.note)}</li>`))}
      ${list("Trang tụt mạnh nhất (click/tuần)", (d.pages || []).map((p) => `<li>${esc(path(p.page))}: ${n(p.clicks_prev)} → ${n(p.clicks7)}${p.pos_prev != null ? ` · vị trí ${n(p.pos_prev)} → ${n(p.pos7)}` : ""}</li>`))}
      ${list("Trang mất hết hiển thị", (d.gone || []).map((p) => `<li>${esc(path(p.page))} (trước ${n(p.impr_prev)} hiển thị/tuần)</li>`))}
      ${list("Từ khoá tụt", (d.keywords || []).map((k) => `<li>${esc(k.keyword)}: ${n(k.prev)} → ${k.pos == null ? "ngoài top 30" : n(k.pos)}</li>`))}
      ${list("Truy vấn tụt (Search Console)", (d.queries || []).map((q) => `<li>${esc(q.query)}: ${n(q.pos_prev)} → ${n(q.pos7)}</li>`))}
      ${list("Backlink mất", (d.lost || []).map((l) => `<li><a href="${esc(l.source_url)}" target="_blank" rel="noopener">${esc(l.domain || l.source_url)}</a> → ${esc(path(l.target_url))}${l.dofollow ? "" : " (nofollow)"}</li>`))}
      ${list("Nhiều trang cùng tranh một truy vấn", (d.cannibal || []).map((c) => `<li>${esc(c.query)}: ${esc(String(c.pages).split(" | ").map(path).join(", "))}</li>`))}
    </details>
    ${canEdit ? `<div class="toolbar">${a.status === "open" || a.status === "watching" ? `<button type="button" data-alert="${a.id}" data-st="resolved">Đã xử lý</button><button type="button" data-alert="${a.id}" data-st="dismissed">Bỏ qua</button>` : `<button type="button" data-alert="${a.id}" data-st="open">Mở lại</button>`}</div>` : ""}
  </div>`;
}

function keywordsHtml(d, canEdit) {
  const active = d.keywords.filter((k) => k.active);
  return `${active.length ? `<div class="tablewrap boxed"><table class="rk-kw"><thead><tr><th>Từ khoá</th><th>Vị trí</th><th>Tốt nhất</th><th>60 ngày</th><th>Trang xếp hạng</th><th>SERP</th><th>Kiểm</th><th></th></tr></thead><tbody>
    ${d.keywords.map((k) => `<tr class="${k.active ? "" : "rk-off"}"><td><b>${esc(k.keyword)}</b><small>${esc({ gsc: "Từ Search Console", manual: "Anh thêm", content: "Bài đã đăng" }[k.source] || k.source)}</small></td>
      <td>${moveCell(k.pos, k.prev_pos)}</td><td>${n(k.best_pos)}</td><td>${spark(k.history)}</td>
      <td class="st-path">${k.url ? esc(path(k.url)) : "—"}</td>
      <td>${(k.features.features || []).map((f) => `<span class="tag">${esc({ ai_overview: "AI Overview", featured_snippet: "Snippet", people_also_ask: "PAA", local_pack: "Local", video: "Video", images: "Ảnh", shopping: "Mua sắm" }[f] || f)}</span>`).join(" ")}${k.features.top?.length ? `<small>Top: ${esc(k.features.top.join(", "))}</small>` : ""}</td>
      <td>${k.checked_at ? esc(ago(k.checked_at)) : "chưa"}</td>
      <td>${canEdit ? `<button type="button" data-kw="${k.id}" data-on="${k.active ? 0 : 1}">${k.active ? "Tắt" : "Bật"}</button>` : ""}</td></tr>`).join("")}
  </tbody></table></div>` : `<p class="note">Chưa có từ khoá. ${d.google ? "Khi Search Console có dữ liệu, app tự chọn các truy vấn mang click nhiều nhất." : ""}</p>`}
  ${canEdit ? `<form id="rk-add" class="rk-add" novalidate><label>Thêm từ khoá (mỗi dòng một từ)<textarea name="keywords" rows="3"></textarea></label><button type="submit" class="primary" id="rk-add-btn">Thêm</button></form>` : ""}`;
}

function trafficHtml(d) {
  return `${d.state.gscError ? `<p class="msg err">Search Console (${esc(d.settings.gscProperty)}): ${esc(d.state.gscError)}</p>` : ""}
  ${trafficChart(d.daily)}
  <div class="st-two">
    <div><h3 class="sub">Trang tụt (click/tuần)</h3>${d.pages.length ? `<div class="tablewrap boxed"><table><thead><tr><th>Trang</th><th>Trước</th><th>7 ngày</th><th>Vị trí</th></tr></thead><tbody>${d.pages.filter((p) => p.clicks_prev > p.clicks7).map((p) => `<tr><td class="st-path">${esc(path(p.page))}</td><td>${n(p.clicks_prev)}</td><td>${n(p.clicks7)}</td><td>${n(p.pos_prev)} → ${n(p.pos7)}</td></tr>`).join("")}</tbody></table></div>` : `<p class="note">Chưa có.</p>`}</div>
    <div><h3 class="sub">Trang tăng</h3>${d.gains.length ? `<div class="tablewrap boxed"><table><thead><tr><th>Trang</th><th>Trước</th><th>7 ngày</th></tr></thead><tbody>${d.gains.map((p) => `<tr><td class="st-path">${esc(path(p.page))}</td><td>${n(p.clicks_prev)}</td><td>${n(p.clicks7)}</td></tr>`).join("")}</tbody></table></div>` : `<p class="note">Chưa có.</p>`}</div>
  </div>
  <h3 class="sub">Truy vấn (7 ngày)</h3>
  ${d.queries.length ? `<div class="tablewrap boxed"><table><thead><tr><th>Truy vấn</th><th>Trang</th><th>Hiển thị</th><th>Click</th><th>Vị trí</th></tr></thead><tbody>${d.queries.map((q) => `<tr><td>${esc(q.query)}</td><td class="st-path">${esc(path(q.page))}</td><td>${n(q.impr7)}</td><td>${n(q.clicks7)}</td><td>${moveCell(q.pos7 == null ? null : Math.round(q.pos7), q.pos_prev == null ? null : Math.round(q.pos_prev))}</td></tr>`).join("")}</tbody></table></div>` : `<p class="note">Chưa có.</p>`}`;
}

function backlinksHtml(d) {
  const last = d.backlinks[d.backlinks.length - 1], prev = d.backlinks[d.backlinks.length - 2];
  const rows = (kind) => d.changes.filter((c) => c.kind === kind);
  const tbl = (list) => (list.length ? `<div class="tablewrap boxed"><table><thead><tr><th>Trang nguồn</th><th>Trỏ tới</th><th>Anchor</th><th>Ngày</th></tr></thead><tbody>${list.map((c) => `<tr><td class="st-path"><a href="${esc(c.source_url)}" target="_blank" rel="noopener">${esc(c.domain || c.source_url)}</a>${c.dofollow ? "" : `<small>nofollow</small>`}</td><td class="st-path">${esc(path(c.target_url))}</td><td>${esc(c.anchor || "")}</td><td>${esc(c.at_date || "")}</td></tr>`).join("")}</tbody></table></div>` : `<p class="note">Chưa có.</p>`);
  return `${last ? `<div class="st-kpis">
      <div><small>Domain trỏ về</small><b>${n(last.domains)}</b>${prev ? `<small>trước ${n(prev.domains)}</small>` : ""}</div>
      <div><small>Backlink</small><b>${n(last.backlinks)}</b></div>
      <div><small>Rank DataForSEO</small><b>${n(last.rank)}</b></div>
      <div><small>Link hỏng</small><b>${n(last.broken)}</b></div>
    </div><p class="note">Đo lần cuối ${esc(last.day)}. Link dofollow mới tự vào Link Monitor (Off-page › Backlink); link mất mà trang đích 404 thành việc chuyển hướng ở Off-page › Làm tay.</p>` : `<p class="note">Chưa đo backlink.</p>`}
    <div class="st-two"><div><h3 class="sub">Mới</h3>${tbl(rows("new"))}</div><div><h3 class="sub">Mất</h3>${tbl(rows("lost"))}</div></div>`;
}

function settingsHtml(d, canEdit) {
  const s = d.settings;
  const dis = canEdit ? "" : " disabled";
  return `<form id="rk-set" class="op-form" novalidate><fieldset${dis}>
    <label>Search Console property<input name="gscProperty" value="${esc(s.gscProperty)}" placeholder="sc-domain:ten-mien.com"><small>Thêm email service account (Cài đặt) vào property này với quyền xem.</small></label>
    <label>Số từ khoá theo dõi tối đa<input name="maxKeywords" type="number" min="5" max="100" value="${s.maxKeywords}"></label>
    <label>Kiểm vị trí mỗi (ngày)<input name="rankEvery" type="number" min="1" max="14" value="${s.rankEvery}"><small>Mỗi lần kiểm 1 từ khoá là 1 lệnh DataForSEO SERP, tính vào trần chi tiêu tháng.</small></label>
    <label class="check"><input type="checkbox" name="autoKeywords"${s.autoKeywords ? " checked" : ""}> Tự chọn từ khoá từ Search Console</label>
    <label class="check"><input type="checkbox" name="backlinks"${s.backlinks ? " checked" : ""}> Đo backlink mỗi tuần (DataForSEO Backlinks)</label>
    <label class="check"><input type="checkbox" name="autoCase"${s.autoCase ? " checked" : ""}> Tụt đột ngột thì tự mở ca Phục hồi (vẫn qua Gác cổng và anh duyệt từng sửa)</label>
    ${canEdit ? `<button type="submit" class="primary" id="rk-set-btn">Lưu</button>` : ""}
  </fieldset></form>`;
}

async function siteView(main, sid, K) {
  const canEdit = K.state.user.role !== "viewer";
  const d = await api(`/api/monitor/${sid}`);
  const open = d.alerts.filter((a) => a.status === "open" || a.status === "watching").length;
  main.innerHTML = `
  <div class="page">
    <div class="page-head"><div><h2><a href="#/rankings">Thứ hạng</a> › ${esc(d.site.domain)}</h2><p>Traffic 7 ngày ${d.traffic ? `${n(d.traffic.cur)} ${change(d.traffic.change)} so với 4 tuần trước (${esc(d.traffic.source === "gsc" ? "Search Console" : "tracker")})` : "chưa có số liệu"}.</p></div></div>
    <div class="msg" id="rk-msg" hidden></div>
    ${canEdit ? `<div class="toolbar rk-run">
      <button type="button" data-run="gsc"${d.google ? "" : " disabled"}>Đọc Search Console</button>
      <button type="button" data-run="rank"${d.dataforseo ? "" : " disabled"}>Kiểm vị trí</button>
      <button type="button" data-run="backlinks"${d.dataforseo ? "" : " disabled"}>Đo backlink</button>
      <button type="button" data-run="check" class="primary">Kiểm tra tụt</button>
      <span class="note">${d.state.gscAt ? `GSC ${esc(ago(d.state.gscAt))}` : ""}${d.state.rankAt ? ` · vị trí ${esc(ago(d.state.rankAt))}` : ""}${d.state.blAt ? ` · backlink ${esc(ago(d.state.blAt))}` : ""}</span>
    </div>` : ""}
    ${d.state.lastError ? `<p class="msg err">${esc(d.state.lastError)}</p>` : ""}
    <div class="card">
      ${K.tabsNav("rk", [["alerts", `Cảnh báo${open ? ` (${open})` : ""}`, "shield"], ["keywords", `Từ khoá (${d.keywords.filter((k) => k.active).length})`, "search"], ["traffic", "Search Console", "chart"], ["backlinks", "Backlink", "link"], ["settings", "Cài đặt", "gear"]], open ? "alerts" : "keywords")}
      <div class="tab-body" ${K.panelAttr("rk", "alerts", open ? "alerts" : "keywords")}>${d.alerts.length ? d.alerts.map((a) => alertHtml(a, canEdit)).join("") : `<p class="note">Chưa có cảnh báo. App kiểm mỗi ngày và sau mỗi lần đọc số liệu.</p>`}</div>
      <div class="tab-body" ${K.panelAttr("rk", "keywords", open ? "alerts" : "keywords")}>${keywordsHtml(d, canEdit)}</div>
      <div class="tab-body" ${K.panelAttr("rk", "traffic", open ? "alerts" : "keywords")}>${trafficHtml(d)}</div>
      <div class="tab-body" ${K.panelAttr("rk", "backlinks", open ? "alerts" : "keywords")}>${backlinksHtml(d)}</div>
      <div class="tab-body" ${K.panelAttr("rk", "settings", open ? "alerts" : "keywords")}>${settingsHtml(d, canEdit)}</div>
    </div>
  </div>`;
  K.bindTabs(main, "rk");
  const msg = (e, ok) => showMsg($("#rk-msg", main), ok || e.message, ok ? "ok" : "err");
  const reload = async (ok) => { await siteView(main, sid, K); if (ok) msg(null, ok); };
  const DONE = { gsc: (r) => `Đã đọc ${r.days} ngày, ${r.pages} trang, ${r.queries} truy vấn.`, rank: (r) => `Đã kiểm ${r.checked} từ khoá.`, backlinks: (r) => `${r.added} link mới, ${r.lost} link mất gần đây.`, check: (r) => (r.alerts ? `${r.alerts} tín hiệu, ${r.opened} cảnh báo mới.` : "Không thấy tụt bất thường.") };
  $$("[data-run]", main).forEach((b) => b.addEventListener("click", () => busy(b, "Đang chạy…", async () => {
    try { const r = await api(`/api/monitor/${sid}/run`, { method: "POST", body: { what: b.dataset.run } }); await reload(DONE[b.dataset.run](r)); } catch (e) { msg(e); }
  })));
  $$("[data-alert]", main).forEach((b) => b.addEventListener("click", () => busy(b, "…", async () => {
    try { await api(`/api/monitor/alerts/${b.dataset.alert}`, { method: "PUT", body: { status: b.dataset.st } }); await reload(); } catch (e) { msg(e); }
  })));
  $$("[data-kw]", main).forEach((b) => b.addEventListener("click", () => busy(b, "…", async () => {
    try { K.state.tabs.rk = "keywords"; await api(`/api/monitor/keywords/${b.dataset.kw}`, { method: "PUT", body: { active: b.dataset.on === "1" } }); await reload(); } catch (e) { msg(e); }
  })));
  $("#rk-add", main)?.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    K.state.tabs.rk = "keywords";
    await busy($("#rk-add-btn", main), "Đang thêm…", async () => {
      try { const r = await api(`/api/monitor/${sid}/keywords`, { method: "POST", body: { keywords: ev.target.elements.keywords.value } }); await reload(`Đã thêm ${r.added} từ khoá${r.skipped ? `, ${r.skipped} vượt trần` : ""}. Bấm "Kiểm vị trí" để đo ngay.`); } catch (e) { msg(e); }
    });
  });
  $("#rk-set", main)?.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    K.state.tabs.rk = "settings";
    const f = ev.target.elements;
    await busy($("#rk-set-btn", main), "Đang lưu…", async () => {
      try { await api(`/api/monitor/${sid}/settings`, { method: "PUT", body: { gscProperty: f.gscProperty.value, maxKeywords: Number(f.maxKeywords.value), rankEvery: Number(f.rankEvery.value), autoKeywords: f.autoKeywords.checked, backlinks: f.backlinks.checked, autoCase: f.autoCase.checked } }); await reload("Đã lưu."); } catch (e) { msg(e); }
    });
  });
}

export async function viewRankings(main, args, K) {
  if (args[0] && /^\d+$/.test(args[0])) return siteView(main, Number(args[0]), K);
  const d = await api("/api/monitor");
  main.innerHTML = `
  <div class="page">
    <div class="page-head"><div><h2>Thứ hạng & cảnh báo</h2><p>Mỗi site: click từ Google (Search Console), vị trí từ khoá (DataForSEO), backlink mới và mất. Tụt đột ngột thì app tự kiểm lỗi kỹ thuật, đối chiếu bản cập nhật Google, mất link, rồi mở phương án.</p></div></div>
    ${d.google ? "" : `<p class="msg warn">Chưa có Google service account: vào <a href="#/settings">Cài đặt</a>. Không có Search Console thì app dùng lượt xem từ bộ đo riêng (Số liệu site) để phát hiện tụt.</p>`}
    ${d.dataforseo ? "" : `<p class="msg warn">Chưa có DataForSEO: chưa kiểm vị trí từ khoá và backlink được.</p>`}
    ${d.updates.length ? `<p class="msg info"><b>Bản cập nhật Google gần đây:</b> ${d.updates.map((u) => `${esc(u.name)} (${esc(u.start)} → ${esc(u.end || "đang chạy")})`).join(" · ")}. Trong lúc rollout, app chỉ theo dõi, chưa đề xuất sửa nội dung.</p>` : ""}
    <div class="card"><div class="tablewrap boxed"><table class="rk-sites"><thead><tr><th>Site</th><th>Click 7 ngày</th><th>So 4 tuần trước</th><th>Top 3</th><th>Top 10</th><th>Từ khoá</th><th>Domain trỏ về</th><th>Cảnh báo</th></tr></thead><tbody>
      ${d.sites.map((s) => `<tr><td><a href="#/rankings/${s.id}"><b>${esc(s.domain)}</b></a>${s.traffic ? `<small>${esc(s.traffic.source === "gsc" ? "Search Console" : "Tracker")}</small>` : ""}</td>
        <td>${s.traffic ? n(s.traffic.cur) : "—"}</td><td>${s.traffic ? change(s.traffic.change) : "—"}</td><td>${n(s.top3)}</td><td>${n(s.top10)}</td><td>${n(s.keywords)}</td><td>${n(s.refDomains)}</td>
        <td>${s.alerts ? tag([`${s.alerts} cần xem`, "err"]) : ""}${s.watching ? ` ${tag([`${s.watching} theo dõi`, "info"])}` : ""}${!s.alerts && !s.watching ? (s.traffic || s.keywords ? `<span class="tag ok">Ổn</span>` : `<span class="tag">Chưa có số liệu</span>`) : ""}</td></tr>`).join("")}
    </tbody></table></div></div>
  </div>`;
}
