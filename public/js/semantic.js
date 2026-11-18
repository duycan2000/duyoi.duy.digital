// Topical map & Semantic SEO: điểm từng trang, bản đồ Core/Outer, truy vấn mở rộng, Source Context, Web Entity.

import { api } from "./api.js";
import { $, $$, esc, showMsg, busy, ago } from "./ui.js";

const LV = { high: ["Cao", "err"], medium: ["Vừa", "warn"], low: ["Thấp", ""] };
const tag = ([l, c]) => `<span class="tag ${c}">${esc(l)}</span>`;
const path = (u) => { try { const x = new URL(u); return x.pathname; } catch { return u; } };
const scoreTag = (v) => (v == null ? `<span class="tag">—</span>` : `<span class="tag ${v >= 80 ? "ok" : v >= 60 ? "warn" : "err"}">${v}/100</span>`);
const ACTION = { heading: ["Thêm heading", "warn"], paragraph: ["Thêm 1 đoạn", ""], page: ["Trang riêng", "info"] };

function pagesHtml(pages, role) {
  const list = pages.filter((p) => p.role === role);
  if (!list.length) return `<p class="note">Chưa có trang ${role === "core" ? "Core" : "Outer"} nào.</p>`;
  return `<div class="tablewrap boxed"><table class="sm-pages"><thead><tr><th>Trang</th><th>Điểm</th><th>Việc cần làm</th></tr></thead><tbody>
    ${list.map((p) => `<tr><td class="st-path"><a href="${esc(p.url)}" target="_blank" rel="noopener">${esc(path(p.url))}</a><small>${esc(p.h1 || p.title || "")}${p.words ? ` · ${p.words} từ` : ""}</small></td>
      <td>${scoreTag(p.score)}</td>
      <td>${p.checks.length ? `<ul class="rk-list">${p.checks.map((c) => `<li>${tag(LV[c.level] || [c.level, ""])} ${esc(c.message)}</li>`).join("")}</ul>` : `<span class="tag ok">Ổn</span>`}</td></tr>`).join("")}
  </tbody></table></div>`;
}

function siteHtml(d, canEdit) {
  const a = d.audit;
  if (!a) return `<p class="note">Chưa chấm site này. ${canEdit ? "Bấm \"Chấm ngay\" (mất khoảng 1 phút) hoặc đợi lượt tự động hằng tuần." : ""}</p>`;
  const cv = a.coverage, sc = a.sourceContext, en = a.entity;
  return `
  <div class="st-kpis">
    <div><small>Điểm semantic TB</small><b>${a.score}/100</b></div>
    <div><small>Trang Core (kiếm tiền)</small><b>${cv.core}</b></div>
    <div><small>Trang Outer (kiến thức)</small><b>${cv.outer}</b>${cv.ratio != null ? `<small>${cv.ratio} Outer / 1 Core</small>` : ""}</div>
    <div><small>Outer đã link về Core</small><b>${cv.outerLinked}/${cv.outer}</b></div>
    <div><small>Truy vấn chưa có chỗ trả lời</small><b>${a.fanout.length}</b></div>
  </div>
  <p class="note">Chấm ${esc(ago(a.at))}, ${a.pages} trang. Mô hình Topical Authority = (độ bao phủ chủ đề × dữ liệu lịch sử) / chi phí truy xuất là cách Koray Gübür mô tả, không phải công thức Google công bố; app dùng nó làm khung kiểm tra.</p>
  <div class="card sm-block"><h3 class="sub">Truy vấn mở rộng (Search Console)</h3>
    ${a.fanout.length ? `<p class="note">Truy vấn trang đã có hiển thị nhưng chưa có heading trả lời. Không phải truy vấn nào cũng cần bài mới: gần chủ đề thì thêm heading, chi tiết nhỏ thì một đoạn, lệch hẳn chủ đề thì trang riêng (Content Studio).</p>
      <div class="tablewrap boxed"><table><thead><tr><th>Truy vấn</th><th>Trang đang hiện</th><th>Hiển thị 7 ngày</th><th>Vị trí</th><th>Nên</th></tr></thead><tbody>
      ${a.fanout.map((q) => `<tr><td>${esc(q.query)}</td><td class="st-path">${esc(path(q.page))}</td><td>${q.impr}</td><td>${q.pos == null ? "—" : Number(q.pos).toFixed(1)}</td><td>${tag(ACTION[q.action] || [q.action, ""])}</td></tr>`).join("")}</tbody></table></div>` : `<p class="note">${d.hasGsc === false ? "Cần Search Console (Thứ hạng & cảnh báo) để có truy vấn." : "Không có truy vấn nào thiếu chỗ trả lời, hoặc chưa có dữ liệu Search Console."}</p>`}
  </div>
  <div class="card sm-block"><h3 class="sub">Source Context: Google đang cho loại site nào lên top</h3>
    ${sc ? `<p>Site của anh: <b>${esc(sc.mineLabel)}</b>. Top 3 các từ khoá theo dõi:</p>
      <div class="sm-bars">${sc.types.map((t) => `<div><span>${esc(t.label)}</span><b>${t.share}%</b></div>`).join("")}</div>
      ${sc.note ? `<p class="msg warn">${esc(sc.note)}</p>` : ""}
      ${sc.mismatch.length ? `<p class="note">Từ khoá mà top 3 không có loại site như của anh: ${sc.mismatch.map(esc).join(", ")}.</p>` : ""}` : `<p class="note">Cần từ khoá theo dõi đã kiểm vị trí (Thứ hạng & cảnh báo).</p>`}
  </div>
  <div class="card sm-block"><h3 class="sub">Thực thể web (Off-page)</h3>
    <p>Schema Organization trên trang chủ: ${en.organization ? tag(["Có", "ok"]) : tag(["Chưa có", "err"])} · sameAs: ${en.sameAs.length} link · Citations: ${en.citations.done}/${en.citations.total}</p>
    ${en.profiles.length ? `<div class="tablewrap boxed"><table><thead><tr><th>Kênh</th><th>Trạng thái</th><th>Bài 30 ngày</th><th>Trong sameAs</th></tr></thead><tbody>${en.profiles.map((p) => `<tr><td>${esc(p.network)}${p.url ? `<small>${esc(p.url)}</small>` : ""}</td><td>${esc(p.status)}</td><td>${p.posts30}</td><td>${p.inSameAs ? tag(["Có", "ok"]) : tag(["Chưa", "warn"])}</td></tr>`).join("")}</tbody></table></div>` : ""}
    ${en.tasks.length ? `<ul class="rk-list">${en.tasks.map((t) => `<li>${esc(t)}</li>`).join("")}</ul>` : `<p class="note">Thực thể nhất quán.</p>`}
  </div>
  <div class="card sm-block">
    <h3 class="sub">Trang Core (kiếm tiền)</h3>${pagesHtml(d.pages, "core")}
    <h3 class="sub">Trang Outer (kiến thức, phải dẫn về Core)</h3>${pagesHtml(d.pages, "outer")}
    <p class="note">Sửa nội dung và nối link nội bộ: mở ca ở <a href="#/recovery">Phục hồi thứ hạng</a> (Nối link nội bộ, Biên tập, GEO đề xuất, Gác cổng kiểm, anh duyệt). Bài mới viết trong Content Studio được Gác cổng nhắc cùng các lỗi này.</p>
  </div>`;
}

export async function viewSemantic(main, args, K) {
  const canEdit = K.state.user.role !== "viewer";
  const list = await api("/api/semantic");
  const sid = Number(args[0]) || K.state.semSite || list.sites[0]?.id;
  main.innerHTML = `
  <div class="page">
    <div class="page-head"><div><h2>Topical map & Semantic SEO</h2><p>Giúp Google hiểu site nhanh và đúng: chủ đề nói rõ ngay đầu trang, khối nội dung rõ ràng, giá trị cụ thể có nguồn, bài kiến thức (Outer) dẫn về trang kiếm tiền (Core), trả lời các truy vấn mở rộng, đúng loại site Google muốn, thực thể nhất quán trên các kênh.</p></div></div>
    <div class="msg" id="sm-msg" hidden></div>
    <div class="card"><div class="tablewrap boxed"><table><thead><tr><th>Site</th><th>Điểm</th><th>Core / Outer</th><th>Truy vấn thiếu</th><th>Chấm lúc</th></tr></thead><tbody>
      ${list.sites.map((s) => `<tr class="${s.id === sid ? "sm-on" : ""}"><td><a href="#/topical/${s.id}"><b>${esc(s.domain)}</b></a></td><td>${scoreTag(s.score)}</td><td>${s.coverage ? `${s.coverage.core} / ${s.coverage.outer}` : "—"}</td><td>${s.fanout ?? "—"}</td><td>${s.at ? esc(ago(s.at)) : "chưa"}</td></tr>`).join("")}
    </tbody></table></div></div>
    ${sid ? `<div class="toolbar"><h3 class="sub sm-title">${esc(list.sites.find((s) => s.id === sid)?.domain || "")}</h3>${canEdit ? `<button type="button" class="primary" id="sm-run">Chấm ngay</button>` : ""}</div><div id="sm-site"><p class="note">Đang tải…</p></div>` : `<p class="note">Chưa có site.</p>`}
  </div>`;
  if (!sid) return;
  K.state.semSite = sid;
  const msg = (e, ok) => showMsg($("#sm-msg", main), ok || e.message, ok ? "ok" : "err");
  const load = async () => { try { $("#sm-site", main).innerHTML = siteHtml(await api(`/api/semantic/${sid}`), canEdit); } catch (e) { $("#sm-site", main).innerHTML = `<p class="msg err">${esc(e.message)}</p>`; } };
  $("#sm-run", main)?.addEventListener("click", (ev) => busy(ev.currentTarget, "Đang chấm…", async () => {
    try { const r = await api(`/api/semantic/${sid}/run`, { method: "POST" }); await viewSemantic(main, [String(sid)], K); msg(null, `Đã chấm ${r.pages} trang: điểm ${r.score}/100.`); } catch (e) { msg(e); }
  }));
  await load();
}
