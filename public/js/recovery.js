// Màn Phục hồi thứ hạng: nhập site → app quét, chẩn đoán, giao việc cho đội agent → anh duyệt.

import { api } from "./api.js";
import { $, $$, esc, fmtTime, ago, showMsg, busy, formData } from "./ui.js";

let K; // các tiện ích dùng chung từ app.js: state, icon, ICON, tabsNav, panelAttr, bindTabs

const RUNNING = ["discovering", "scanning", "analyzing"];
const STATUS = { discovering: "Đang tìm trang", scanning: "Đang quét", analyzing: "Đang phân tích", ready: "Đã chẩn đoán", failed: "Lỗi", archived: "Đã lưu trữ" };
const SEV = { critical: ["Nghiêm trọng", "err"], high: ["Cao", "warn"], medium: ["Vừa", "info"], low: ["Thấp", ""], info: ["Thông tin", "info"] };
const RISK = { safe: ["An toàn", "ok"], review: ["Cần duyệt", "info"], irreversible: ["Khó đảo ngược", "err"] };
const TSTATUS = { proposed: ["Chờ duyệt", "info"], approved: ["Đã duyệt", "ok"], rejected: ["Đã từ chối", ""], done: ["Đã xong", "ok"], blocked: ["Gác cổng chặn", "err"] };
const KIND = { home: "Trang chủ", commercial: "Dịch vụ", conversion: "Liên hệ", informational: "Thông tin", system: "Hệ thống" };
const CAT = { technical: "Kỹ thuật", content: "Nội dung", funnel: "Phễu & link nội bộ", safety: "An toàn", offpage: "Liên kết ngoài", timeline: "Thời điểm" };

const tag = ([label, cls]) => `<span class="tag ${cls}">${esc(label)}</span>`;
const scoreCls = (s) => (s == null ? "" : s >= 75 ? "good" : s >= 50 ? "mid" : "bad");
const lines = (arr) => (arr || []).join("\n");

export async function viewRecovery(main, args, kit) {
  K = kit;
  if (args[0] && /^\d+$/.test(args[0])) return viewCase(main, Number(args[0]));
  return viewList(main);
}

// ---------------- Danh sách ca + form nhập site ----------------

async function viewList(main) {
  const { cases, agents } = await api("/api/recovery");
  const canEdit = K.state.user.role !== "viewer";
  main.innerHTML = `
  <div class="page">
    <div class="page-head"><div><h2>Phục hồi thứ hạng</h2><p>Nhập địa chỉ site bị tụt hạng. Đội agent quét toàn bộ trang, đối chiếu thời điểm tụt với các bản cập nhật Google, tìm nguyên nhân và đề xuất việc. Không việc nào tự đăng lên site: anh duyệt trước.</p></div></div>
    ${canEdit ? `<form class="card" id="rec-new" novalidate><h3>Chẩn đoán site</h3>
      <div class="form-grid">
        <label>Địa chỉ site <input name="url" required placeholder="vd: caddienstleistungen.de" autocomplete="off"></label>
        <label>Tháng bắt đầu tụt <input name="dropMonth" type="month" max="${new Date().toISOString().slice(0, 7)}"></label>
        <label>Ngôn ngữ của site <select name="language"><option value="en">Tiếng Anh</option><option value="de">Tiếng Đức</option><option value="vi">Tiếng Việt</option></select></label>
        <label>Trang dịch vụ chính (mỗi dòng một đường dẫn, không bắt buộc) <textarea name="commercialPaths" rows="3" placeholder="/cad-dienstleistung-tga/"></textarea></label>
        <label class="full">Từ/cụm bị cấm xuất hiện trên site (mỗi dòng một mục, không bắt buộc) <textarea name="blocklist" rows="2" placeholder="Tên đối tác có thoả thuận pháp lý…"></textarea></label>
      </div>
      <p class="note">App chỉ đọc site như Googlebot: không cần mật khẩu, không sửa gì. Quét khoảng 1–3 phút cho 100 trang; phần còn lại chạy nền mỗi 15 phút.</p>
      <div class="msg" id="rec-msg" hidden></div>
      <div class="toolbar"><button class="primary" type="submit">${K.icon(K.ICON.search)}Quét và chẩn đoán</button></div>
    </form>` : ""}
    <div class="card">
      ${cases.length ? `<div class="tablewrap"><table>
        <thead><tr><th>Site</th><th>Trạng thái</th><th>Điểm sức khoẻ</th><th>Việc chờ duyệt</th><th>Cập nhật</th></tr></thead>
        <tbody>${cases.map((c) => `<tr class="click" data-href="#/recovery/${c.id}" tabindex="0">
          <td><b>${esc(c.domain)}</b>${c.dropMonth ? `<small>Tụt từ ${esc(c.dropMonth)}</small>` : ""}</td>
          <td>${tag([STATUS[c.status] || c.status, c.status === "ready" ? "ok" : c.status === "failed" ? "err" : "info"])}${RUNNING.includes(c.status) ? `<small>${c.pagesDone}/${c.pagesTotal || "?"} trang</small>` : ""}</td>
          <td>${c.score == null ? "—" : `<span class="score ${scoreCls(c.score)}">${c.score}</span>`}</td>
          <td>${c.openTasks || 0}</td>
          <td>${esc(ago(c.updatedAt))}</td></tr>`).join("")}</tbody></table></div>`
      : `<div class="empty"><b>Chưa có site nào được chẩn đoán</b><span>Nhập địa chỉ site ở trên để đội agent bắt đầu.</span></div>`}
    </div>
    <div class="card"><h3>Đội agent phục hồi</h3>${agentGrid(agents)}</div>
  </div>`;
  $$("tr[data-href]", main).forEach((tr) => {
    const go = () => { location.hash = tr.dataset.href; };
    tr.addEventListener("click", go);
    tr.addEventListener("keydown", (e) => { if (e.key === "Enter") go(); });
  });
  const form = $("#rec-new");
  if (!form) return;
  form.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const d = formData(form);
    if (!d.url.trim()) return showMsg($("#rec-msg"), "Anh nhập địa chỉ site.");
    await busy(form.querySelector("button[type=submit]"), "Đang bắt đầu…", async () => {
      try {
        const r = await api("/api/recovery", { method: "POST", body: { url: d.url, dropMonth: d.dropMonth, language: d.language, rules: { commercialPaths: d.commercialPaths, blocklist: d.blocklist, language: d.language } } });
        location.hash = `#/recovery/${r.id}`;
      } catch (e) { showMsg($("#rec-msg"), e.message); }
    });
  });
}

const agentGrid = (agents, tasks = []) => `<div class="agent-grid">${agents.map((a) => {
  const mine = tasks.filter((t) => t.agent === a.id);
  const open = mine.filter((t) => t.status === "proposed" || t.status === "blocked").length;
  return `<div class="agent"><span class="agent-ic">${K.icon(K.ICON[a.icon] || K.ICON.spark)}</span><div><b>${esc(a.name)}</b>${tasks.length ? `<small>${mine.length ? `${mine.length} việc · ${open} chờ duyệt` : "Chưa có việc"}</small>` : ""}<p class="note">${esc(a.role)}</p></div></div>`;
}).join("")}</div>`;

// ---------------- Một ca ----------------

async function viewCase(main, id) {
  const data = await api(`/api/recovery/${id}`);
  const { case: c, findings, tasks, pages, agents } = data;
  const canEdit = K.state.user.role !== "viewer";
  const running = RUNNING.includes(c.status);
  const openTasks = tasks.filter((t) => t.status === "proposed" || t.status === "blocked").length;
  const d = c.diagnosis;
  main.innerHTML = `
  <div class="page">
    <div class="page-head">
      <div><h2>${esc(c.domain)}</h2><p>${tag([STATUS[c.status] || c.status, c.status === "ready" ? "ok" : c.status === "failed" ? "err" : "info"])} ${c.finishedAt ? `Chẩn đoán lúc ${esc(fmtTime(c.finishedAt))}` : ""}${c.dropMonth ? ` · tụt từ ${esc(c.dropMonth)}` : ""}</p></div>
      <div class="toolbar"><a class="btn" href="#/recovery">← Danh sách</a>${canEdit ? `<button type="button" id="rec-rescan"${running ? " disabled" : ""}>${K.icon(K.ICON.search)}Quét lại</button>` : ""}<a class="btn" href="https://${esc(c.domain)}/" target="_blank" rel="noopener">Mở site</a></div>
    </div>
    <div class="msg" id="case-msg" hidden></div>
    ${c.status === "failed" ? `<div class="msg err">${esc(c.error || "Quét thất bại.")}</div>` : ""}
    ${running ? `<div class="card"><h3>${esc(STATUS[c.status])}…</h3>
      <progress max="${Math.max(1, c.pagesTotal)}" value="${c.pagesDone}"></progress>
      <p class="note">${c.pagesDone}/${c.pagesTotal || "?"} trang. Trang này tự cập nhật; anh có thể rời đi, việc quét vẫn chạy nền.</p></div>` : ""}
    <div class="card tabbed">
      ${K.tabsNav("rec", [["diag", "Chẩn đoán", "spark"], ["tasks", `Việc của agent (${openTasks})`, "list"], ["findings", `Vấn đề (${findings.length})`, "shield"], ["pages", `Trang (${pages.length})`, "globe"], ["rules", "Luật an toàn", "sliders"], ["links", "Liên kết ngoài", "link"]], "diag")}
      <div class="tab-body" ${K.panelAttr("rec", "diag", "diag")}>${diagHtml(c, d, findings, agents, tasks)}</div>
      <div class="tab-body" ${K.panelAttr("rec", "tasks", "diag")}>${tasksHtml(tasks, agents, canEdit)}</div>
      <div class="tab-body" ${K.panelAttr("rec", "findings", "diag")}>${findingsHtml(findings)}</div>
      <div class="tab-body" ${K.panelAttr("rec", "pages", "diag")}>${pagesHtml(pages)}</div>
      <div class="tab-body" ${K.panelAttr("rec", "rules", "diag")}>${rulesHtml(c, canEdit)}</div>
      <div class="tab-body" ${K.panelAttr("rec", "links", "diag")}>${linksHtml(c, canEdit)}</div>
    </div>
  </div>`;
  K.bindTabs(main, "rec");
  bindCase(main, c, canEdit);
  if (running) {
    const hash = location.hash;
    setTimeout(() => { if (location.hash === hash && document.contains(main)) viewCase(main, id).catch(() => {}); }, 3000);
  }
}

function diagHtml(c, d, findings, agents, tasks) {
  if (!d) return `<p class="note">Chưa có kết quả. ${RUNNING.includes(c.status) ? "Đội agent đang quét." : ""}</p>${agentGrid(agents, tasks)}`;
  const s = d.summary;
  return `
    <div class="diag-top">
      <div class="score-box ${scoreCls(c.score)}"><b>${c.score}</b><small>/ 100 điểm sức khoẻ</small><meter min="0" max="100" low="50" high="75" optimum="100" value="${c.score}"></meter></div>
      <div class="mini-kpis">
        <div><b>${s.scanned}</b><small>trang đọc được</small></div>
        <div><b>${s.kinds.commercial}</b><small>trang dịch vụ</small></div>
        <div><b>${s.kinds.informational}</b><small>bài thông tin</small></div>
        <div><b>${s.errors}</b><small>URL lỗi</small></div>
        <div><b>${findings.filter((f) => f.severity === "critical" || f.severity === "high").length}</b><small>vấn đề nặng</small></div>
        <div><b>${s.elementor ? "Elementor" : s.wordpress ? "WordPress" : "Khác"}</b><small>nền tảng</small></div>
      </div>
    </div>
    <div class="timeline-box">
      <h3 class="sub">${K.icon(K.ICON.clock)}Thời điểm tụt so với cập nhật Google</h3>
      ${d.timeline.updates.length ? `<ul class="upd">${d.timeline.updates.map((u) => `<li class="u-${esc(u.kind)}"><b>${esc(u.name)}</b><small>${esc(u.start)} → ${esc(u.end)}</small><span>${esc(u.note)}</span></li>`).join("")}</ul>` : ""}
      <p>${esc(d.timeline.hint)}</p>
    </div>
    <h3 class="sub">${K.icon(K.ICON.spark)}Nguyên nhân có khả năng nhất</h3>
    ${d.causes.length ? `<div class="causes">${d.causes.map((x, i) => `<div class="cause">
      <div class="cause-head"><span class="rank">${i + 1}</span><b>${esc(x.title)}</b><meter min="0" max="60" value="${Math.min(60, x.weight)}"></meter></div>
      <ul>${x.evidence.map((e) => `<li>${esc(e)}</li>`).join("")}</ul>
      <p class="note">Việc cần làm: ${esc(x.actions.join(" · "))}</p></div>`).join("")}</div>` : `<p class="note">Không thấy vấn đề lớn trên site. Nguyên nhân có thể nằm ở backlink hoặc đối thủ: cần dữ liệu Search Console.</p>`}
    <div class="grid2">
      <div><h3 class="sub">${K.icon(K.ICON.list)}Cần thêm dữ liệu để chắc chắn</h3><ul class="plain">${d.needsData.map((x) => `<li>${esc(x)}</li>`).join("")}</ul></div>
      <div><h3 class="sub">${K.icon(K.ICON.trend)}Bao lâu thì phục hồi</h3><p>${esc(d.recovery)}</p>
        <p class="note">Nguồn: ${d.sources.map((x) => `<a href="${esc(x.url)}" target="_blank" rel="noopener">${esc(x.title)}</a>`).join(" · ")}</p></div>
    </div>
    <h3 class="sub">${K.icon(K.ICON.users)}Đội agent</h3>${agentGrid(agents, tasks)}`;
}

// Hiện phần chữ được thêm vào, link hiện thành chữ gạch chân kèm đích
const renderAdded = (html) => esc(html).replace(/&lt;a href=&quot;([^&]*)&quot;&gt;(.*?)&lt;\/a&gt;/g, '<u>$2</u> <small class="to">→ $1</small>');

function editsHtml(edits) {
  return `<div class="edits">${edits.map((e) => {
    const isMeta = e.type === "meta_title" || e.type === "meta_description";
    if (isMeta) return `<div class="edit"><small class="note">${e.type === "meta_title" ? "SEO title" : "Meta description"} · ${e.replace.length} ký tự</small>
      ${e.find ? `<div class="diff"><del>${esc(e.find)}</del></div>` : `<div class="diff"><span class="note">(đang trống)</span></div>`}
      <div class="diff"><ins>${esc(e.replace)}</ins></div></div>`;
    const added = e.replace.startsWith(e.find) ? e.replace.slice(e.find.length) : e.replace;
    return `<div class="edit"><small class="note">${e.section ? `Mục "${esc(e.section)}"` : ""}${e.anchor ? ` · anchor "${esc(e.anchor)}"` : ""}</small>
      <div class="diff"><span>${esc(e.find)}</span><ins>${renderAdded(added)}</ins></div></div>`;
  }).join("")}</div>`;
}

function taskCard(t, canEdit) {
  const p = t.payload || {};
  const gate = t.gate && t.gate.problems && t.gate.problems.length ? `<ul class="gate">${t.gate.problems.map((x) => `<li class="${x.level}">${esc(x.message)}</li>`).join("")}</ul>` : "";
  const list = p.urls || p.pages?.map((x) => typeof x === "string" ? x : `${x.label} · ${x.url} (${x.words} từ, ${x.inbound} link vào)`) || p.domains?.map((x) => `domain:${x}`);
  const actions = !canEdit ? "" : t.status === "proposed" ? `<button type="button" class="primary" data-act="approved">Duyệt</button><button type="button" data-act="rejected">Từ chối</button>${t.risk !== "safe" ? "" : `<button type="button" data-act="done">Đã xong</button>`}`
    : t.status === "approved" ? `<button type="button" data-act="done">Đánh dấu đã xong</button><button type="button" data-act="proposed">Mở lại</button>`
    : t.status === "blocked" ? `<button type="button" data-act="rejected">Bỏ qua</button>` : `<button type="button" data-act="proposed">Mở lại</button>`;
  const after = t.status === "approved" && p.edits ? `<p class="note">Đã duyệt. Khi app được kết nối WordPress (giai đoạn kế tiếp), việc này sẽ được áp dụng dạng bản nháp/revision, có sao lưu để hoàn tác; ${p.elementor ? "trang Elementor sửa trong _elementor_data rồi xoá cache." : "xoá cache sau khi sửa."}</p>`
    : t.status === "approved" && t.risk === "irreversible" ? `<p class="note">Đã duyệt: anh hoặc người phụ trách làm trên site, xong bấm "Đánh dấu đã xong".</p>` : "";
  return `<div class="task" data-task="${t.id}">
    <div class="task-head"><b>${esc(t.title)}</b><span class="tags">${tag(RISK[t.risk] || [t.risk, ""])}${tag(TSTATUS[t.status] || [t.status, ""])}</span></div>
    ${t.detail ? `<p>${esc(t.detail)}</p>` : ""}
    ${t.target_url ? `<p class="note"><a href="${esc(t.target_url)}" target="_blank" rel="noopener">${esc(t.target_url)}</a></p>` : ""}
    ${gate}
    ${p.edits ? editsHtml(p.edits) : ""}
    ${list && list.length ? `<details><summary>${list.length} mục</summary><ul class="urls">${list.slice(0, 200).map((u) => `<li>${esc(u)}</li>`).join("")}</ul></details>` : ""}
    ${after}
    ${actions ? `<div class="toolbar">${actions}</div>` : ""}
  </div>`;
}

function tasksHtml(tasks, agents, canEdit) {
  if (!tasks.length) return `<p class="note">Chưa có việc. Việc được lập sau khi quét xong.</p>`;
  return `<p class="note">Việc xếp theo thứ tự nên làm. "Cần duyệt" = anh xem diff rồi duyệt; "Khó đảo ngược" (redirect, xoá trang, đổi canonical, disavow) chỉ admin duyệt và người làm tay. Mỗi lần chỉ sửa tối đa 3 trang để tránh thay đổi đột ngột trên toàn site.</p>
    <div class="msg" id="task-msg" hidden></div>
    ${agents.filter((a) => tasks.some((t) => t.agent === a.id)).map((a) => `<div class="agent-tasks"><h3 class="sub">${K.icon(K.ICON[a.icon] || K.ICON.spark)}${esc(a.name)}</h3>
      ${tasks.filter((t) => t.agent === a.id).map((t) => taskCard(t, canEdit)).join("")}</div>`).join("")}`;
}

function findingsHtml(findings) {
  if (!findings.length) return `<p class="note">Chưa có vấn đề nào được ghi nhận.</p>`;
  return `<div class="findings">${findings.map((f) => `<div class="finding">
    <div class="task-head"><b>${esc(f.title)}</b><span class="tags">${tag(SEV[f.severity] || [f.severity, ""])}<span class="tag">${esc(CAT[f.category] || f.category)}</span></span></div>
    ${f.detail ? `<p class="pre">${esc(f.detail)}</p>` : ""}
    ${f.urls.length ? `<details><summary>${f.urls.length} URL</summary><ul class="urls">${f.urls.slice(0, 200).map((u) => `<li>${esc(u)}</li>`).join("")}</ul></details>` : ""}
  </div>`).join("")}</div>`;
}

function pagesHtml(pages) {
  if (!pages.length) return `<p class="note">Chưa có trang nào.</p>`;
  return `<div class="tablewrap boxed"><table><thead><tr><th>Trang</th><th>Loại</th><th>Số từ</th><th>Link vào</th><th>Link ra</th><th>CTA</th><th>Ghi chú</th></tr></thead><tbody>
    ${pages.map((p) => `<tr>
      <td><a href="${esc(p.url)}" target="_blank" rel="noopener">${esc(p.path)}</a><small>${esc(p.title)}</small></td>
      <td>${esc(KIND[p.kind] || "—")}</td>
      <td>${p.words ?? "—"}</td><td>${p.inbound}</td><td>${p.outLinks}</td>
      <td>${p.cta == null ? "—" : p.cta ? "Có" : `<span class="tag warn">Không</span>`}</td>
      <td>${[p.status === "error" ? `<span class="tag err">${esc(p.error || "lỗi")}</span>` : "", p.httpStatus >= 400 ? `<span class="tag err">HTTP ${p.httpStatus}</span>` : "", p.noindex ? `<span class="tag warn">noindex</span>` : "", p.blockHits.length ? `<span class="tag err">blocklist</span>` : "", p.status === "queued" ? `<span class="tag">chờ quét</span>` : ""].join(" ")}</td></tr>`).join("")}
  </tbody></table></div>`;
}

function rulesHtml(c, canEdit) {
  const r = c.rules;
  const dis = canEdit ? "" : " disabled";
  return `<form id="rules-form" novalidate>
    <p class="note">Luật riêng của site. Gác cổng dùng các luật này để chặn mọi đề xuất vi phạm. Đổi blocklist thì app đọc lại toàn bộ trang.</p>
    <div class="form-grid">
      <label>Ngôn ngữ duy nhất của site <select name="language"${dis}>${[["en", "Tiếng Anh"], ["de", "Tiếng Đức"], ["vi", "Tiếng Việt"]].map(([k, l]) => `<option value="${k}"${r.language === k ? " selected" : ""}>${l}</option>`).join("")}</select></label>
      <label>Tháng bắt đầu tụt <input type="month" name="dropMonth" value="${esc(c.dropMonth || "")}"${dis}></label>
      <label>Trình dựng trang <select name="builder"${dis}>${[["", "Chưa rõ"], ["elementor", "Elementor"], ["gutenberg", "Gutenberg"], ["classic", "Classic editor"]].map(([k, l]) => `<option value="${k}"${r.builder === k ? " selected" : ""}>${l}</option>`).join("")}</select></label>
      <label>Plugin cache cần xoá sau khi sửa <input name="cachePlugin" value="${esc(r.cachePlugin)}" placeholder="flyingpress, wp-rocket…"${dis}></label>
      <label>Trang dịch vụ (mỗi dòng một đường dẫn) <textarea name="commercialPaths" rows="5"${dis}>${esc(lines(r.commercialPaths))}</textarea></label>
      <label>Từ/cụm bị cấm (blocklist) <textarea name="blocklist" rows="5"${dis}>${esc(lines(r.blocklist))}</textarea></label>
      <label>Tên file ảnh bị cấm (dùng * ở cuối) <textarea name="blockedFilenames" rows="3"${dis}>${esc(lines(r.blockedFilenames))}</textarea></label>
      <label>Các site khác của anh (link chéo cần gỡ) <textarea name="relatedDomains" rows="3"${dis}>${esc(lines(r.relatedDomains))}</textarea></label>
      <label>Số liệu đã kiểm chứng, được phép dùng lại <textarea name="verifiedNumbers" rows="3" placeholder="Über 50% Kostenersparnis"${dis}>${esc(lines(r.verifiedNumbers))}</textarea></label>
      <label>Link nội bộ mới tối đa mỗi trang <select name="maxLinksPerPage"${dis}>${[1, 2, 3].map((n) => `<option${r.maxLinksPerPage === n ? " selected" : ""}>${n}</option>`).join("")}</select></label>
      <label class="full">Ghi chú cho agent <textarea name="notes" rows="3"${dis}>${esc(r.notes)}</textarea></label>
    </div>
    <details><summary>Dán luật dạng JSON</summary><textarea name="json" rows="6" placeholder='{"language":"de","blocklist":["…"]}'${dis}></textarea><p class="note">Nếu ô này có nội dung, app dùng JSON thay cho các ô ở trên.</p></details>
    <div class="msg" id="rules-msg" hidden></div>
    ${canEdit ? `<div class="toolbar"><button class="primary" type="submit">Lưu luật và phân tích lại</button></div>` : ""}
  </form>`;
}

function linksHtml(c, canEdit) {
  const r = c.rules;
  const dis = canEdit ? "" : " disabled";
  return `<form id="links-form" novalidate>
    <div class="msg info">Google cho biết phần lớn link rác đã bị bỏ qua tự động. Chỉ nên nộp file disavow khi site <b>từng mua link, dùng PBN hoặc dịch vụ link giá rẻ</b>, hoặc có <b>thao tác thủ công</b> về link trong Search Console. Disavow sai có thể làm mất cả link tốt.</div>
    <label>Domain backlink xấu (mỗi dòng một domain; dán từ Semrush/Ahrefs được) <textarea name="toxicDomains" rows="8"${dis}>${esc(lines(r.toxicDomains))}</textarea></label>
    <label class="check"><input type="checkbox" name="linksBought"${r.linksBought ? " checked" : ""}${dis}><span>Site từng mua link / dùng PBN / dịch vụ link (Fiverr…)</span></label>
    <label class="check"><input type="checkbox" name="manualAction"${r.manualAction ? " checked" : ""}${dis}><span>Search Console có thông báo thao tác thủ công về link</span></label>
    <div class="msg" id="links-msg" hidden></div>
    <div class="toolbar">${canEdit ? `<button class="primary" type="submit">Lưu</button>` : ""}${r.toxicDomains.length ? `<a class="btn" href="/api/recovery/${c.id}/disavow" download>Tải file disavow (${r.toxicDomains.length} domain)</a>` : ""}</div>
    <p class="note">App không tự nộp file. Anh nộp tại Search Console › Disavow links, đúng property của site.</p>
  </form>`;
}

function bindCase(main, c, canEdit) {
  const reload = () => viewCase(main, c.id);
  const rescan = $("#rec-rescan");
  if (rescan) rescan.addEventListener("click", () => busy(rescan, "Đang bắt đầu…", async () => {
    try { await api(`/api/recovery/${c.id}/rescan`, { method: "POST" }); await reload(); } catch (e) { showMsg($("#case-msg"), e.message); }
  }));
  if (!canEdit) return;
  $$("[data-task] [data-act]", main).forEach((b) => b.addEventListener("click", () => {
    const id = b.closest("[data-task]").dataset.task;
    busy(b, "…", async () => {
      try { await api(`/api/recovery/tasks/${id}`, { method: "PUT", body: { status: b.dataset.act } }); await reload(); }
      catch (e) { showMsg($("#task-msg"), e.message); }
    });
  }));
  const rf = $("#rules-form");
  rf?.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const d = formData(rf);
    let rules;
    if (d.json.trim()) {
      try { rules = JSON.parse(d.json); } catch { return showMsg($("#rules-msg"), "JSON không hợp lệ."); }
    } else {
      const { json: _j, dropMonth: _m, ...rest } = d;
      rules = { ...rest, maxLinksPerPage: Number(d.maxLinksPerPage) };
    }
    await busy(rf.querySelector("button[type=submit]"), "Đang lưu…", async () => {
      try { await api(`/api/recovery/${c.id}/rules`, { method: "PUT", body: { rules, dropMonth: d.dropMonth } }); await reload(); }
      catch (e) { showMsg($("#rules-msg"), e.message); }
    });
  });
  const lf = $("#links-form");
  lf?.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const d = formData(lf);
    await busy(lf.querySelector("button[type=submit]"), "Đang lưu…", async () => {
      try { await api(`/api/recovery/${c.id}/rules`, { method: "PUT", body: { rules: d } }); await reload(); }
      catch (e) { showMsg($("#links-msg"), e.message); }
    });
  });
}
