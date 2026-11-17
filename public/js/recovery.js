// Màn Phục hồi thứ hạng: nhập site → app quét, chẩn đoán, giao việc cho đội agent → anh duyệt.

import { api } from "./api.js";
import { $, $$, esc, fmtTime, ago, showMsg, busy, formData } from "./ui.js";

let K; // các tiện ích dùng chung từ app.js: state, icon, ICON, tabsNav, panelAttr, bindTabs
let CTX = { caseId: 0, siteId: 0, wp: false, backups: [] };

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
  if (args[0] && /^\d+$/.test(args[0])) { if (args[1]) K.state.tabs.rec = args[1]; return viewCase(main, Number(args[0])); }
  return viewList(main);
}

// ---------------- Danh sách ca + form nhập site ----------------

async function viewList(main) {
  const { cases, agents, setup } = await api("/api/recovery");
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
    ${guideHtml(setup)}
    <div class="card"><h3>Đội agent phục hồi</h3>${agentGrid(agents)}</div>
  </div>`;
  try { if (sessionStorage.getItem("duyoi_open_guide")) { sessionStorage.removeItem("duyoi_open_guide"); const g = $("#guide"); g.open = true; g.scrollIntoView({ block: "start" }); } } catch { /* bỏ qua */ }
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

// ---------------- Hướng dẫn cài đặt (cho mọi người dùng app) ----------------

const done = (ok) => `<span class="step-ic ${ok ? "ok" : ""}">${ok ? "✓" : "!"}</span>`;

function guideHtml(st) {
  const admin = K.state.user.role === "admin";
  const sites = st?.sites || [];
  const allWp = sites.length > 0 && sites.every((x) => x.wpConnected);
  const allGsc = sites.length > 0 && sites.every((x) => x.gscProperty);
  const complete = st && st.googleServiceAccount && st.openrouter && allWp && allGsc;
  return `<details class="card guide" id="guide"${complete ? "" : " open"}>
    <summary><h3>Hướng dẫn cài đặt để chạy với site thật</h3><span class="tag ${complete ? "ok" : "warn"}">${complete ? "Đã đủ" : "Còn thiếu bước"}</span></summary>
    <p class="note">Không có các bước này, app vẫn quét và chẩn đoán được (chỉ đọc site như Googlebot). Các bước dưới đây để app <b>áp dụng việc đã duyệt</b>, <b>đọc traffic thật</b> và <b>dùng AI viết</b>.</p>

    <div class="guide-step">
      <div class="guide-head">${done(allWp)}<b>1. Kết nối WordPress (làm cho từng site)</b></div>
      <ol class="steps">
        <li><a href="/duyoi-connector.zip" download>Tải plugin Duy Ơi Connector</a>. Vào WordPress › Plugins › Add New › Upload Plugin, chọn file zip, cài và bật.</li>
        <li>Vào Users › Add New: tạo user riêng cho app, ví dụ <code>duyoi-bot</code>, quyền <b>Editor</b>. Không dùng tài khoản admin.</li>
        <li>Đăng nhập bằng user đó › Users › Profile › mục <b>Application Passwords</b>: đặt tên "Duy Ơi" › Add New Application Password. Copy mật khẩu (dạng <code>xxxx xxxx xxxx xxxx</code>, chỉ hiện một lần).</li>
        <li>Trong app: Site › chọn site › khung <b>Kết nối WordPress</b> › nhập user và mật khẩu › Lưu kết nối › <b>Thử kết nối</b>. Thấy "Kết nối được" là xong.</li>
      </ol>
      ${sites.length ? `<ul class="site-status">${sites.map((x) => `<li>${done(x.wpConnected)}<a href="#/sites/${x.id}">${esc(x.domain)}</a><span class="note">${x.wpConnected ? "đã kết nối" : "chưa kết nối"}</span></li>`).join("")}</ul>` : `<p class="note">Chưa có site WordPress nào. Site sẽ được thêm khi anh chẩn đoán ở trên.</p>`}
    </div>

    <div class="guide-step">
      <div class="guide-head">${done(st?.googleServiceAccount)}<b>2. Google Search Console và GA4 (làm một lần cho cả app)</b></div>
      <ol class="steps">
        <li>Vào <a href="https://console.cloud.google.com/" target="_blank" rel="noopener">Google Cloud Console</a>, tạo (hoặc chọn) một project.</li>
        <li>APIs &amp; Services › Library: bật <b>Google Search Console API</b> và <b>Google Analytics Data API</b>.</li>
        <li>IAM &amp; Admin › Service Accounts › Create service account (không cần cấp role). Mở service account › Keys › Add key › JSON: file JSON được tải về.</li>
        <li>Trong app: ${admin ? `<a href="#/settings/keys">Cài đặt › API key</a>` : "Cài đặt › API key (admin làm)"} › <b>Google service account (JSON)</b> › dán nguyên nội dung file › Lưu.</li>
        <li>Search Console › chọn property › Settings › Users and permissions › Add user: dán email service account${st?.googleEmail ? ` (<code>${esc(st.googleEmail)}</code>)` : ""}, quyền <b>Restricted</b>. Làm cho từng site.</li>
        <li>GA4 › Admin › Property access management › thêm cùng email đó, quyền <b>Viewer</b>. Lấy <b>Property ID</b> (dãy số) ở Admin › Property details.</li>
        <li>Mở ca phục hồi của từng site › tab <b>Luật an toàn</b> › nhập property: Domain property ghi <code>sc-domain:ten-mien.de</code>, URL-prefix ghi nguyên <code>https://ten-mien.com/</code> (có dấu / cuối); nhập GA4 property ID › Lưu. Ghi sai loại property sẽ báo "không có quyền" dù đã cấp quyền.</li>
      </ol>
      ${sites.length ? `<ul class="site-status">${sites.map((x) => `<li>${done(Boolean(x.gscProperty))}<span>${esc(x.domain)}</span><span class="note">${x.gscProperty ? esc(x.gscProperty) : "chưa nhập property Search Console"}${x.ga4Property ? ` · GA4 ${esc(x.ga4Property)}` : " · chưa có GA4"}</span></li>`).join("")}</ul>` : ""}
    </div>

    <div class="guide-step">
      <div class="guide-head">${done(st?.openrouter)}<b>3. AI viết (OpenRouter)</b></div>
      <ol class="steps">
        <li>Tạo key tại <a href="https://openrouter.ai/keys" target="_blank" rel="noopener">openrouter.ai › Keys</a>, nên đặt giới hạn chi tiêu ngay trên OpenRouter.</li>
        <li>Dán vào ${admin ? `<a href="#/settings/keys">Cài đặt › API key</a>` : "Cài đặt › API key"} › OpenRouter API key. Trần chi phí tháng chỉnh ở tab Model AI &amp; chi phí.</li>
      </ol>
    </div>

    <div class="guide-step">
      <div class="guide-head"><span class="step-ic">i</span><b>Quy trình làm việc an toàn</b></div>
      <ol class="steps">
        <li>Chẩn đoán site › đọc tab Chẩn đoán › mở tab Việc của agent.</li>
        <li>Đọc diff từng việc, bấm <b>Duyệt</b>. Việc "Khó đảo ngược" (redirect, xoá trang, canonical, disavow) chỉ admin duyệt và người làm tay.</li>
        <li>Bấm <b>Áp dụng lên site</b>: app chạy thử, sao lưu bản gốc rồi mới ghi, tự xoá cache. Mở trang ra kiểm tra; sai thì bấm <b>Hoàn tác</b>.</li>
        <li>Mỗi lần chỉ sửa vài trang. Lần đầu nên thử một việc chèn link rồi thử Hoàn tác để chắc mọi thứ chạy đúng.</li>
      </ol>
    </div>
  </details>`;
}

const agentGrid = (agents, tasks = []) => `<div class="agent-grid">${agents.map((a) => {
  const mine = tasks.filter((t) => t.agent === a.id);
  const open = mine.filter((t) => t.status === "proposed" || t.status === "blocked").length;
  return `<div class="agent"><span class="agent-ic">${K.icon(K.ICON[a.icon] || K.ICON.spark)}</span><div><b>${esc(a.name)}</b>${tasks.length ? `<small>${mine.length ? `${mine.length} việc · ${open} chờ duyệt` : "Chưa có việc"}</small>` : ""}<p class="note">${esc(a.role)}</p></div></div>`;
}).join("")}</div>`;

// ---------------- Một ca ----------------

async function viewCase(main, id) {
  const [data, content] = await Promise.all([api(`/api/recovery/${id}`), api(`/api/content/${id}`).catch(() => null)]);
  if (content) content.docs = await api(`/api/sites/${content.media.siteId}/docs`).catch(() => null);
  const { case: c, findings, tasks, pages, agents } = data;
  CTX = { caseId: c.id, siteId: c.siteId, wp: data.wpConnected, backups: data.backups || [], content };
  const canEdit = K.state.user.role !== "viewer";
  const running = RUNNING.includes(c.status);
  const openTasks = tasks.filter((t) => t.status === "proposed" || t.status === "blocked").length;
  const d = c.diagnosis;
  main.innerHTML = `
  <div class="page">
    <div class="page-head">
      <div><h2>${esc(c.domain)}</h2><p>${tag([STATUS[c.status] || c.status, c.status === "ready" ? "ok" : c.status === "failed" ? "err" : "info"])} ${c.finishedAt ? `Chẩn đoán lúc ${esc(fmtTime(c.finishedAt))}` : ""}${c.dropMonth ? ` · tụt từ ${esc(c.dropMonth)}` : ""}</p></div>
      <div class="toolbar"><a class="btn" href="#/recovery">← Danh sách</a>${canEdit ? `<button type="button" id="rec-rescan"${running ? " disabled" : ""}>${K.icon(K.ICON.search)}Quét lại</button>` : ""}<a class="btn" href="https://${esc(c.domain)}/" target="_blank" rel="noopener">Mở site</a><a class="btn" href="#/recovery" data-guide>Hướng dẫn</a></div>
    </div>
    <div class="msg" id="case-msg" hidden></div>
    ${c.status === "failed" ? `<div class="msg err">${esc(c.error || "Quét thất bại.")}</div>` : ""}
    ${running ? `<div class="card"><h3>${esc(STATUS[c.status])}…</h3>
      <progress max="${Math.max(1, c.pagesTotal)}" value="${c.pagesDone}"></progress>
      <p class="note">${c.pagesDone}/${c.pagesTotal || "?"} trang. Trang này tự cập nhật; anh có thể rời đi, việc quét vẫn chạy nền.</p></div>` : ""}
    <div class="card tabbed">
      ${K.tabsNav("rec", [["diag", "Chẩn đoán", "spark"], ["tasks", `Việc của agent (${openTasks})`, "list"], ["findings", `Vấn đề (${findings.length})`, "shield"], ["pages", `Trang (${pages.length})`, "globe"], ["content", `Bài mới${content ? ` (${content.ideas.filter((i) => ["approved", "briefed", "drafted"].includes(i.status)).length})` : ""}`, "pen"], ["rules", "Luật an toàn", "sliders"], ["links", "Liên kết ngoài", "link"]], "diag")}
      <div class="tab-body" ${K.panelAttr("rec", "diag", "diag")}>${diagHtml(c, d, findings, agents, tasks)}</div>
      <div class="tab-body" ${K.panelAttr("rec", "tasks", "diag")}>${tasksHtml(tasks, agents, canEdit)}</div>
      <div class="tab-body" ${K.panelAttr("rec", "findings", "diag")}>${findingsHtml(findings)}</div>
      <div class="tab-body" ${K.panelAttr("rec", "pages", "diag")}>${pagesHtml(pages)}</div>
      <div class="tab-body" ${K.panelAttr("rec", "content", "diag")}>${content ? contentHtml(c, content, canEdit) : `<p class="note">Chưa có dữ liệu.</p>`}</div>
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
    ${s.traffic ? `<div class="traffic-box">
      <div><b>${s.traffic.clicks}</b><small>click 28 ngày gần nhất</small></div>
      <div><b>${s.traffic.clicksPrev}</b><small>click 28 ngày trước đó</small></div>
      ${s.traffic.clicksBefore ? `<div><b>${s.traffic.clicksBefore} → ${s.traffic.clicksAfter}</b><small>click trước → sau tháng tụt</small></div>` : ""}
      <div><b>${s.traffic.leads}</b><small>lead GA4 (28 ngày, chậm 24–48 giờ)</small></div>
    </div>` : ""}
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
// Khối HTML chèn thêm (FAQ, đoạn trả lời): hiện thành chữ có định dạng đơn giản, không chạy HTML thật
const renderBlock = (html) => esc(html).replace(/&lt;h[23]&gt;(.*?)&lt;\/h[23]&gt;/g, "<b>$1</b><br>").replace(/&lt;p&gt;(.*?)&lt;\/p&gt;/g, "$1<br>");
const renderAdded = (html) => esc(html).replace(/&lt;a href=&quot;([^&]*)&quot;&gt;(.*?)&lt;\/a&gt;/g, '<u>$2</u> <small class="to">→ $1</small>');

function editsHtml(edits) {
  return `<div class="edits">${edits.map((e) => {
    const isMeta = e.type === "meta_title" || e.type === "meta_description";
    if (isMeta) return `<div class="edit"><small class="note">${e.type === "meta_title" ? "SEO title" : "Meta description"} · ${e.replace.length} ký tự</small>
      ${e.find ? `<div class="diff"><del>${esc(e.find)}</del></div>` : `<div class="diff"><span class="note">(đang trống)</span></div>`}
      <div class="diff"><ins>${esc(e.replace)}</ins></div></div>`;
    if (e.type === "insert") return `<div class="edit"><small class="note">${e.mode === "before_block" ? "Chèn đoạn mới phía trước" : "Chèn khối mới phía sau"} · mục "${esc(e.section || "")}"</small>
      <div class="diff">${e.mode === "before_block" ? `<ins class="block">${renderBlock(e.insert)}</ins><span>${esc(e.find)}</span>` : `<span>${esc(e.find)}</span><ins class="block">${renderBlock(e.insert)}</ins>`}</div></div>`;
    const added = e.replace.startsWith(e.find) ? e.replace.slice(e.find.length) : e.replace;
    return `<div class="edit"><small class="note">${e.section ? `Mục "${esc(e.section)}"` : ""}${e.anchor ? ` · anchor "${esc(e.anchor)}"` : ""}</small>
      <div class="diff"><span>${esc(e.find)}</span><ins>${renderAdded(added)}</ins></div></div>`;
  }).join("")}</div>`;
}

function taskCard(t, canEdit) {
  const p = t.payload || {};
  const gate = t.gate && t.gate.problems && t.gate.problems.length ? `<ul class="gate">${t.gate.problems.map((x) => `<li class="${x.level}">${esc(x.message)}</li>`).join("")}</ul>` : "";
  const list = t.kind === "geo_plan" ? null : p.urls || p.pages?.map((x) => typeof x === "string" ? x : `${x.label} · ${x.url} (${x.words} từ, ${x.inbound} link vào${x.clicks != null ? `, ${x.clicks} click` : ""})`) || p.domains?.map((x) => `domain:${x}`);
  const canAi = canEdit && ["proposed", "blocked"].includes(t.status) && ["internal_links", "cta"].includes(t.kind);
  const geoList = t.kind === "geo_plan" ? `<ul class="geo-list">${(p.urls || []).map((u) => `<li><a href="${esc(u)}" target="_blank" rel="noopener">${esc(new URL(u).pathname)}</a>${canEdit ? `<button type="button" data-geo="${esc(u)}">${K.icon(K.ICON.spark)}Soạn GEO bằng AI</button>` : ""}</li>`).join("")}</ul>` : "";
  const applied = p.applied ? `<div class="msg ok">Đã áp dụng lên site lúc ${esc(fmtTime(p.applied.at))}: ${p.applied.changes} sửa${p.applied.meta?.length ? `, meta ${esc(p.applied.meta.join(", "))}` : ""}${p.applied.purged?.length ? `, đã xoá cache ${esc(p.applied.purged.join(", "))}` : ""}. Có bản sao lưu #${p.applied.backupId}.</div>` : "";
  const applyBtn = canEdit && t.status === "approved" && p.edits ? (CTX.wp ? `<button type="button" class="primary" data-apply>${K.icon(K.ICON.trend)}Áp dụng lên site</button>` : `<a class="btn" href="#/sites/${CTX.siteId}">Kết nối WordPress để áp dụng</a>`) : "";
  const undoBtn = canEdit && t.status === "done" && p.applied ? `<button type="button" class="danger" data-rollback>Hoàn tác</button>` : "";
  const aiBtn = canAi ? `<button type="button" data-ai>${K.icon(K.ICON.spark)}${p.ai ? "Viết lại lần nữa" : "Viết lại bằng AI"}</button>` : "";
  const actions = !canEdit ? "" : t.status === "proposed" ? `<button type="button" class="primary" data-act="approved">Duyệt</button><button type="button" data-act="rejected">Từ chối</button>${t.risk !== "safe" ? "" : `<button type="button" data-act="done">Đã xong</button>`}`
    : t.status === "approved" ? `${applyBtn}${p.edits ? "" : `<button type="button" data-act="done">Đánh dấu đã xong</button>`}<button type="button" data-act="proposed">Mở lại</button>`
    : t.status === "blocked" ? `<button type="button" data-act="rejected">Bỏ qua</button>` : t.status === "done" ? undoBtn : `<button type="button" data-act="proposed">Mở lại</button>`;
  const after = t.status === "approved" && p.edits ? `<p class="note">Đã duyệt. Bấm "Áp dụng lên site": app chạy thử trước, sao lưu bản gốc, rồi mới ghi; ${p.elementor ? "trang Elementor được sửa trong _elementor_data và xoá cache CSS." : "cache được xoá sau khi sửa."} Hoàn tác được bất cứ lúc nào.</p>`
    : t.status === "approved" && t.risk === "irreversible" ? `<p class="note">Đã duyệt: anh hoặc người phụ trách làm trên site, xong bấm "Đánh dấu đã xong".</p>` : "";
  return `<div class="task" data-task="${t.id}">
    <div class="task-head"><b>${esc(t.title)}</b><span class="tags">${tag(RISK[t.risk] || [t.risk, ""])}${tag(TSTATUS[t.status] || [t.status, ""])}</span></div>
    ${t.detail ? `<p>${esc(t.detail)}</p>` : ""}
    ${t.target_url ? `<p class="note"><a href="${esc(t.target_url)}" target="_blank" rel="noopener">${esc(t.target_url)}</a></p>` : ""}
    ${gate}
    ${p.ai ? `<p class="note">${K.icon(K.ICON.spark)} Câu chèn do AI viết, đã qua Gác cổng. Đọc kỹ trước khi duyệt.</p>` : ""}
    ${p.edits ? editsHtml(p.edits) : ""}
    ${geoList}${applied}
    ${list && list.length ? `<details><summary>${list.length} mục</summary><ul class="urls">${list.slice(0, 200).map((u) => `<li>${esc(u)}</li>`).join("")}</ul></details>` : ""}
    ${after}
    ${actions || aiBtn ? `<div class="toolbar">${actions}${aiBtn}</div>` : ""}
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
  const hasT = pages.some((p) => p.traffic);
  return `<div class="tablewrap boxed"><table><thead><tr><th>Trang</th><th>Loại</th>${hasT ? "<th>Click 28 ngày</th><th>Lead</th>" : ""}<th>Số từ</th><th>Link vào</th><th>Link ra</th><th>CTA</th><th>Ghi chú</th></tr></thead><tbody>
    ${[...pages].sort((a, b) => (b.traffic?.clicks || 0) - (a.traffic?.clicks || 0)).map((p) => `<tr>
      <td><a href="${esc(p.url)}" target="_blank" rel="noopener">${esc(p.path)}</a><small>${esc(p.title)}</small></td>
      <td>${esc(KIND[p.kind] || "—")}</td>
      ${hasT ? `<td>${p.traffic ? `${p.traffic.clicks}${p.traffic.clicksPrev !== p.traffic.clicks ? `<small>trước: ${p.traffic.clicksPrev}</small>` : ""}` : "0"}</td><td>${p.traffic?.leads ?? "—"}</td>` : ""}
      <td>${p.words ?? "—"}</td><td>${p.inbound}</td><td>${p.outLinks}</td>
      <td>${p.cta == null ? "—" : p.cta ? "Có" : `<span class="tag warn">Không</span>`}</td>
      <td>${[p.status === "error" ? `<span class="tag err">${esc(p.error || "lỗi")}</span>` : "", p.httpStatus >= 400 ? `<span class="tag err">HTTP ${p.httpStatus}</span>` : "", p.noindex ? `<span class="tag warn">noindex</span>` : "", p.blockHits.length ? `<span class="tag err">blocklist</span>` : "", p.status === "queued" ? `<span class="tag">chờ quét</span>` : ""].join(" ")}</td></tr>`).join("")}
  </tbody></table></div>`;
}

// Bài HTML (đã lọc ở máy chủ) hiện bằng cách esc() rồi dựng lại vài thẻ cố định: không chạy HTML lạ
const renderArticle = (html) => esc(html)
  .replace(/&lt;(\/?)(h2|h3|p|ul|ol|li|strong|em|table|thead|tbody|tr|th|td|figure|figcaption)&gt;/g, "<$1$2>")
  .replace(/&lt;p class=&quot;(affiliate-disclosure|buy-buttons)&quot;&gt;/g, '<p class="art-$1">')
  .replace(/&lt;figure class=&quot;wp-block-image&quot;&gt;/g, "<figure>")
  .replace(/&lt;img src=&quot;(https:\/\/[^"&\s]+(?:&amp;[^"&\s]+)*)&quot; alt=&quot;([^"]*?)&quot;.*?&gt;/g, '<img src="$1" alt="$2">')
  .replace(/&lt;a class=&quot;buy-button&quot; href=&quot;(https?:\/\/[^"\s]*?)&quot;.*?&gt;(.*?)&lt;\/a&gt;/g, '<a class="buy-btn" href="$1" target="_blank" rel="noopener noreferrer">$2</a>')
  .replace(/&lt;a href=&quot;(\/[^"]*)&quot;&gt;(.*?)&lt;\/a&gt;/g, '<u>$2</u> <small class="to">→ $1</small>')
  .replace(/<p><em>⟪(.*?)⟫<\/em><\/p>/g, '<p class="img-need">$1</p>');
const ISTATUS = { idea: ["Ý tưởng", ""], approved: ["Đã duyệt", "info"], briefed: ["Có dàn ý", "info"], drafted: ["Có bài nháp", "ok"], published: ["Đã đăng", "ok"], rejected: ["Đã bỏ", ""], failed: ["Lỗi", "err"] };

const DOC_KIND = { catalog: "Catalog", price_list: "Bảng giá", company_profile: "Hồ sơ công ty", seo_handover: "Handover SEO", process_guide: "Quy trình", knowledge: "Kiến thức", other: "Khác" };
const FMT_LABEL = { roundup: "Best X / Top N", review: "Review", comparison: "So sánh", how_to: "How-to", guide: "Guide", article: "Bài thông tin" };

function docsHtml(ct, canEdit) {
  const d = ct.docs;
  if (!d) return "";
  const p = d.profile;
  const have = (p.facts.length + p.services.length + p.products.length) > 0;
  const taken = new Set(ct.ideas.map((i) => i.keyword));
  const ideas = p.ideas.filter((i) => i.keyword && !taken.has(i.keyword));
  const lines = (a) => esc(a.join("\n"));
  return `<details class="docs-box"${have && !ideas.length ? "" : " open"}><summary>${K.icon(K.ICON.list)}Tài liệu &amp; Hồ sơ site <span class="tag ${have ? "ok" : "warn"}">${have ? `${d.docs.filter((x) => x.status === "ready").length} tài liệu · ${p.facts.length} dữ kiện` : "chưa có"}</span></summary>
    <p class="note">Tải PDF của site (catalog, bảng giá, hồ sơ công ty, handover SEO, quy trình, ghi chú kinh nghiệm). Agent Đọc tài liệu rút ra Hồ sơ site; người viết chỉ dùng dữ kiện trong hồ sơ, số liệu trong hồ sơ được coi là có nguồn. File PDF không lưu lại.</p>
    <div class="msg" id="doc-msg" hidden></div>
    ${canEdit ? `<form id="doc-up" class="form-grid">
      <label>File PDF (tối đa 15 MB) <input type="file" name="file" accept="application/pdf" required></label>
      <label class="check"><input type="checkbox" name="ocr"><span>PDF scan (ảnh chụp trang)<small>Dùng OCR trả phí của OpenRouter để đọc chữ trong ảnh.</small></span></label>
      <div class="toolbar full"><button type="submit" class="primary">${K.icon(K.ICON.plus)}Tải lên và đọc</button></div>
    </form>` : ""}
    ${d.docs.length ? `<div class="tablewrap boxed"><table><thead><tr><th>Tài liệu</th><th>Loại</th><th>Rút được</th><th></th></tr></thead><tbody>${d.docs.map((x) => `<tr>
      <td><b>${esc(x.title || x.name)}</b><small>${esc(x.name)} · ${Math.round(x.size / 1024)} KB</small>${x.summary ? `<small>${esc(x.summary)}</small>` : ""}${x.error ? `<small class="err">${esc(x.error)}</small>` : ""}</td>
      <td>${x.status === "ready" ? esc(DOC_KIND[x.kind] || x.kind || "") : x.status === "failed" ? `<span class="tag err">Lỗi</span>` : `<span class="tag info">Đang đọc</span>`}</td>
      <td>${x.counts ? `${x.counts.facts} dữ kiện · ${x.counts.products} sản phẩm · ${x.counts.ideas} gợi ý bài` : "—"}</td>
      <td>${canEdit ? `<button type="button" class="danger" data-doc-del="${x.id}">Bỏ</button>` : ""}</td></tr>`).join("")}</tbody></table></div>` : ""}
    ${ideas.length ? `<h3 class="sub">${K.icon(K.ICON.pen)}Bài viết gợi ý từ tài liệu</h3><div class="tablewrap boxed"><table><thead><tr><th>Bài</th><th>Định dạng</th><th>Vì sao</th><th></th></tr></thead><tbody>${ideas.map((i) => `<tr><td><b>${esc(i.title)}</b><small>${esc(i.keyword)}</small></td><td><span class="tag fmt">${esc(FMT_LABEL[i.format] || i.format)}</span></td><td>${esc(i.why)}<small>${esc(i.source)}</small></td><td>${canEdit ? `<button type="button" data-doc-idea="${esc(i.keyword)}" data-fmt="${esc(i.format)}">Thêm thành chủ đề</button>` : ""}</td></tr>`).join("")}</tbody></table></div>` : ""}
    <div class="voice">
      <h3 class="sub">${K.icon(K.ICON.pen)}Giọng văn của site</h3>
      ${p.voice ? `<p><b>${esc(p.voice.summary)}</b></p><p class="note">Xưng hô: ${esc(p.voice.person)} · ${esc(p.voice.formality)} · Câu: ${esc(p.voice.sentence_style)}${p.voice.avoid.length ? ` · Tránh: ${esc(p.voice.avoid.join("; "))}` : ""}</p>` : `<p class="note">Chưa có. Người viết sẽ dùng giọng chung, dễ nghe như AI.</p>`}
      ${canEdit ? `<form id="voice-form" class="form-grid">
        <label>Địa chỉ 1–5 bài hay nhất trên chính site (mỗi dòng một bài) <textarea name="urls" rows="3" placeholder="https://${esc(ct.docs.domain || "ten-mien")}/bai-hay/"></textarea></label>
        <label>Hoặc dán đoạn anh tự viết (từ 150 chữ) <textarea name="text" rows="3"></textarea></label>
        <div class="toolbar full"><button type="submit">${p.voice ? "Rút lại giọng văn" : "Rút giọng văn"}</button></div>
      </form>` : ""}
    </div>
    <form id="profile-form" class="profile">
      <h3 class="sub">${K.icon(K.ICON.users)}Hồ sơ site (anh sửa được)</h3>
      <div class="form-grid">
        <label class="full">Tóm tắt <textarea name="summary" rows="2">${esc(p.summary)}</textarea></label>
        <label>Khách hàng / người đọc <textarea name="audience" rows="2">${esc(p.audience)}</textarea></label>
        <label>Giọng văn <textarea name="tone" rows="2">${esc(p.tone)}</textarea></label>
        <label>Dịch vụ (mỗi dòng một dịch vụ) <textarea name="services" rows="4">${lines(p.services)}</textarea></label>
        <label>Điều cấm (mỗi dòng: từ, thương hiệu, câu hứa không được dùng) <textarea name="banned" rows="4">${lines(p.banned)}</textarea></label>
        <label class="full">Dữ kiện có nguồn (mỗi dòng: dữ kiện | nguồn) <textarea name="facts" rows="6">${esc(p.facts.map((f) => `${f.text}${f.source ? ` | ${f.source}` : ""}`).join("\n"))}</textarea></label>
      </div>
      ${p.products.length ? `<p class="note">Sản phẩm trong tài liệu: ${p.products.map((x) => esc(x.name)).join(", ")}</p>` : ""}
      ${canEdit ? `<div class="toolbar"><button type="submit" class="primary">Lưu Hồ sơ site</button></div>` : ""}
    </form>
  </details>`;
}

let AUTHOR_MODE = "ask";
const writerOf = (i) => i.author || (AUTHOR_MODE === "ask" ? null : AUTHOR_MODE);

function interviewBox(i) {
  const iv = i.interview;
  if (!iv || !iv.questions.length || !["briefed", "drafted"].includes(i.status)) return "";
  const done = iv.answers.some((a) => a && a.trim());
  const open = i.waitingInterview;
  return `<details class="iv-box"${open ? " open" : ""}><summary>Phỏng vấn trải nghiệm ${done ? `<span class="tag ok">Đã trả lời</span>` : iv.skipped ? `<span class="tag">Đã bỏ qua</span>` : `<span class="tag warn">Agent đang hỏi anh</span>`}</summary>
    <p class="note">Vài dòng trải nghiệm thật của anh (dự án, con số của chính anh, lỗi từng gặp) làm bài khác hẳn văn AI. Số liệu anh ghi ở đây được coi là có nguồn.</p>
    <form data-iv="${i.id}" class="iv">${iv.questions.map((q, n) => `<label>${esc(q)}<textarea name="a${n}" rows="2" maxlength="2000">${esc(iv.answers[n] || "")}</textarea></label>`).join("")}
      <div class="toolbar"><button type="submit" class="primary">Lưu câu trả lời</button>${!done ? `<button type="button" data-iv-skip="${i.id}">Bỏ qua, viết luôn</button>` : ""}</div>
    </form></details>`;
}

function authorBox(i) {
  if (i.status !== "briefed" && !(i.status === "drafted" && i.draft?.author === "owner" && !i.wp_post_id)) return "";
  if (i.waitingInterview) return "";
  const who = writerOf(i);
  if (!who) return `<div class="author-pick"><b>Ai viết bài này?</b>
    <div class="toolbar"><button type="button" class="primary" data-author="agent" data-id="${i.id}">Agent viết</button><button type="button" data-author="owner" data-id="${i.id}">Tôi tự viết bằng Claude</button></div>
    <small class="note">Anh tự viết: lấy gói yêu cầu dán vào Claude của anh, rồi dán bài vào đây; Biên tập viên chấm và sửa nếu chưa đạt.</small></div>`;
  if (who !== "owner") return i.author ? `<p class="note">Agent viết bài này. <button type="button" class="linkish" data-author="owner" data-id="${i.id}">Đổi: tôi tự viết</button></p>` : "";
  return `<div class="owner-box">
    <b>Anh tự viết bằng Claude</b>
    <ol class="steps"><li>Lấy gói yêu cầu (đủ dàn ý, khung định dạng, giọng văn, dữ kiện, sản phẩm, token) và dán vào Claude của anh.</li><li>Dán bài Claude trả về (Markdown hoặc HTML) vào ô dưới.</li><li>Biên tập viên chấm theo khung; nếu chưa đạt thì sửa (tuỳ anh chọn).</li></ol>
    <div class="toolbar"><button type="button" data-handoff="${i.id}">Xem gói yêu cầu</button><button type="button" data-handoff-dl="${i.id}">Tải file .md</button>${i.status === "briefed" ? `<button type="button" class="linkish" data-author="agent" data-id="${i.id}">Đổi: để agent viết</button>` : ""}</div>
    <div class="handoff" id="handoff-${i.id}" hidden><textarea readonly rows="12" aria-label="Gói yêu cầu"></textarea><div class="toolbar"><button type="button" data-copy="${i.id}">Sao chép</button></div></div>
    <form data-import="${i.id}" class="import">
      <label>${i.draft?.author === "owner" ? "Dán bản mới (thay bản hiện tại)" : "Dán bài anh viết"}<textarea name="content" rows="8" placeholder="# Tiêu đề&#10;&#10;Đoạn mở bài…&#10;&#10;## Mục 1…"></textarea></label>
      <label class="check"><input type="checkbox" name="revise" checked><span>Cho phép sửa nếu chưa đạt<small>Biên tập viên chấm; dưới mức hoặc thiếu phần của khung thì Người viết sửa đúng chỗ đó (tối đa 2 vòng). Bỏ chọn nếu anh chỉ muốn chấm.</small></span></label>
      <div class="toolbar"><button type="submit" class="primary">Đưa bài vào và chấm</button></div>
    </form>
  </div>`;
}

function reviewBox(i) {
  const r = i.draft?.review;
  if (!i.draft) return "";
  if (!r) return i.draft.reviewError ? `<p class="note">Biên tập viên chưa chấm: ${esc(i.draft.reviewError)}</p>` : "";
  const cls = r.score >= 80 ? "ok" : r.score >= 60 ? "warn" : "err";
  return `<details class="review-box"><summary>Biên tập viên: <span class="tag ${cls}">${r.score}/100</span>${r.rounds.length > 1 ? ` <small>qua các vòng ${r.rounds.join(" → ")}</small>` : ""}</summary>
    ${r.verdict ? `<p>${esc(r.verdict)}</p>` : ""}
    ${r.criteria.length ? `<div class="crit">${r.criteria.map((c) => `<div><b>${esc(c.name)}</b> <span class="tag ${c.score >= 80 ? "ok" : c.score >= 60 ? "warn" : "err"}">${c.score}</span><small>${esc(c.note)}</small></div>`).join("")}</div>` : ""}
    ${r.issues.length ? `<ol class="issues">${r.issues.map((x) => `<li><b>${esc(x.where)}</b>: ${esc(x.problem)}<small>Sửa: ${esc(x.fix)}</small></li>`).join("")}</ol>` : ""}
  </details>`;
}

function contentHtml(c, ct, canEdit) {
  AUTHOR_MODE = ct.authorMode || "ask";
  const st = ct.structure;
  const active = ct.ideas.filter((i) => ["approved", "briefed", "drafted", "published"].includes(i.status));
  const ideas = ct.ideas.filter((i) => i.status === "idea");
  const btn = (i, act, label, cls = "") => canEdit ? `<button type="button" class="${cls}" data-idea="${i.id}" data-iact="${act}">${label}</button>` : "";
  const F = Object.fromEntries(ct.formats.map((f) => [f.id, f]));
  const fmtTag = (i) => `<span class="tag fmt">${esc(F[i.format]?.label || i.format)}</span>`;
  const fmtSelect = (i) => canEdit && ["idea", "approved", "briefed"].includes(i.status) && !i.wp_post_id
    ? `<div class="inline-field"><span>Định dạng bài</span><select data-format="${i.id}" aria-label="Định dạng bài">${ct.formats.map((f) => `<option value="${f.id}"${f.id === i.format ? " selected" : ""}>${esc(f.label)}</option>`).join("")}</select></div>` : "";
  const productRow = (p = {}) => `<div class="prod-row">
      <div class="form-grid">
        <label>Tên sản phẩm <input name="name" value="${esc(p.name || "")}" maxlength="120"></label>
        <label>Dùng tốt nhất cho (ví dụ: người mới, nhóm 5 người) <input name="bestFor" value="${esc(p.bestFor || "")}" maxlength="80"></label>
        <label>Link affiliate (https) <input name="url" type="url" value="${esc(p.url || "")}" placeholder="https://"></label>
        <label>Nơi bán (Amazon, tên shop…) <input name="merchant" value="${esc(p.merchant || "")}" maxlength="40"></label>
        <label class="full">Nơi bán khác (mỗi dòng: Tên | https://link) <textarea name="links" rows="2">${esc((p.links || []).map((l) => `${l.merchant} | ${l.url}`).join("\n"))}</textarea></label>
        <label>Thông số anh đã kiểm (agent chỉ dùng số ở đây) <textarea name="specs" rows="3">${esc(p.specs || "")}</textarea></label>
        <label>Ghi chú trải nghiệm thật (dùng bao lâu, dùng vào việc gì, thấy gì) <textarea name="notes" rows="3">${esc(p.notes || "")}</textarea></label>
        <label>Ưu điểm <textarea name="pros" rows="2">${esc(p.pros || "")}</textarea></label>
        <label>Nhược điểm <textarea name="cons" rows="2">${esc(p.cons || "")}</textarea></label>
      </div>
      <div class="toolbar"><label class="check"><input type="checkbox" name="tested"${p.tested ? " checked" : ""}><span>Tôi/đội đã dùng thật sản phẩm này<small>Chỉ khi đúng. Không đánh dấu thì bài không được nói "đã test".</small></span></label><button type="button" class="danger" data-prod-del>Xoá</button></div>
    </div>`;
  const productsBox = (i) => {
    const f = F[i.format];
    if (!f || (!f.minProducts && !f.maxProducts)) return "";
    const n = i.products.items.length;
    const need = n < f.minProducts;
    const locked = !!i.wp_post_id || !canEdit;
    return `<details class="prod-box"${need ? " open" : ""}><summary>Sản phẩm (${n}${f.minProducts ? `/${f.minProducts} tối thiểu` : ", không bắt buộc"})</summary>
      ${need ? `<div class="msg warn">Người viết cần anh nhập ít nhất ${f.minProducts} sản phẩm: tên, link affiliate, nơi bán, đã dùng thật hay chưa và ghi chú trải nghiệm. Agent chỉ viết về sản phẩm anh nhập, không tự thêm.</div>` : ""}
      ${locked ? i.products.items.map((p) => `<p><b>${esc(p.name)}</b> · ${esc(p.merchant)}${p.tested ? " · đã dùng thật" : ""}</p>`).join("") : `<form data-products="${i.id}">
        <label class="full">Cách anh chọn sản phẩm (hiện ở mục "cách chọn" trong bài) <textarea name="method" rows="2">${esc(i.products.method || "")}</textarea></label>
        <div class="prod-list">${(n ? i.products.items : [{}]).map(productRow).join("")}</div>
        <div class="toolbar"><button type="button" data-prod-add>${K.icon(K.ICON.plus)}Thêm sản phẩm</button><button type="submit" class="primary">Lưu sản phẩm</button></div>
      </form>`}</details>`;
  };
  const slotsBox = (i) => {
    if (!i.slots.length) return "";
    const miss = i.slots.filter((s) => s.required && !s.image).length;
    const locked = !!i.wp_post_id || !canEdit;
    return `<details class="img-box"${miss && i.status === "drafted" ? " open" : ""}><summary>Ảnh thật (${i.slots.filter((s) => s.image).length}/${i.slots.length}${miss ? `, thiếu ${miss} bắt buộc` : ""})</summary>
      ${miss ? `<div class="msg warn">Người viết cần anh tải ${miss} ảnh thật. Ảnh tự chụp khi dùng sản phẩm là tốt nhất; ảnh nhà sản xuất chỉ khi có quyền dùng. Không dùng ảnh AI, không tải ảnh lấy từ Amazon. ${ct.media.mode === "r2" ? "Ảnh lưu ở Cloudflare R2, phục vụ qua tên miền ảnh của site" : "Ảnh lên thẳng Thư viện Media WordPress"}; app xoá dữ liệu vị trí GPS trong ảnh JPEG.</div>` : ""}
      ${!ct.media.ready ? `<div class="msg">${esc(ct.media.why)} <a href="#/settings/keys/cloudflare_api_token">Mở Cài đặt</a></div>` : ""}
      ${ct.media.mode === "site" && ct.media.ready ? `<div class="msg ${ct.media.verified ? "ok" : "warn"}">${ct.media.verified ? `Ảnh lưu ở bucket R2 riêng của site, hiện tại ${esc(ct.media.base)}` : `Kho ảnh của site chưa chạy: bấm Dựng kho ảnh để app tạo bucket R2 riêng, Worker phục vụ ảnh và route ${esc(ct.media.base)}*, rồi tự kiểm tra.`}
        <div class="toolbar">${K.state.user.role === "admin" && !ct.media.verified ? `<button type="button" class="primary" data-media-setup="${ct.media.siteId}">Dựng kho ảnh trên Cloudflare</button>` : ""}<button type="button" data-media-check="${ct.media.siteId}">Kiểm tra lại</button></div>
        <ul class="gate" id="media-steps" hidden></ul></div>` : ""}
      <div class="slots">${i.slots.map((s) => `<div class="slot${s.image ? " done" : ""}">
        <div class="slot-head"><b>${esc(s.label)}</b>${tag(s.image ? ["Đã có", "ok"] : s.required ? ["Bắt buộc", "warn"] : ["Nên có", ""])}</div>
        ${s.image ? `<figure class="thumb"><img src="${esc(s.image.url)}" alt="${esc(s.image.alt)}"><figcaption>${esc(s.image.alt)}</figcaption></figure>` : ""}
        ${locked || !ct.media.ready ? "" : `${s.image ? `<details><summary>Thay hoặc gỡ ảnh</summary>` : ""}<form data-upload="${i.id}" data-slot="${esc(s.key)}" class="upload">
          <label>File ảnh (JPEG, PNG, WebP, tối đa 8 MB) <input type="file" name="file" accept="image/jpeg,image/png,image/webp" required></label>
          <label>Mô tả ảnh (alt) <input name="alt" required minlength="5" maxlength="160" value="${esc(s.image?.alt || "")}"></label>
          <label>Chú thích (không bắt buộc) <input name="caption" maxlength="200" value="${esc(s.image?.caption || "")}"></label>
          <label>Nguồn ảnh <select name="source"><option value="own">Tôi/đội tự chụp</option><option value="maker">Ảnh nhà sản xuất (có quyền dùng)</option><option value="screenshot">Ảnh chụp màn hình</option></select></label>
          <label class="check"><input type="checkbox" name="real" required><span>Đây là ảnh thật, không phải ảnh AI</span></label>
          <div class="toolbar"><button type="submit" class="primary">${s.image ? "Thay ảnh" : "Tải ảnh lên"}</button>${s.image ? `<button type="button" class="danger" data-img-del="${i.id}" data-slot="${esc(s.key)}">Gỡ khỏi bài</button>` : ""}</div>
        </form>${s.image ? "</details>" : ""}`}
      </div>`).join("")}</div></details>`;
  };
  const card = (i) => {
    const b = i.brief, d = i.draft;
    return `<div class="task">
      <div class="task-head"><b>${esc(d?.title || b?.title || i.keyword)}</b><span class="tags">${fmtTag(i)}${tag(ISTATUS[i.status] || [i.status, ""])}</span></div>
      <p class="note">Từ khoá "${esc(i.keyword)}"${i.volume != null ? ` · ${i.volume} lượt tìm/tháng · KD ${i.kd ?? "?"}` : " · anh tự thêm"}${i.intent ? ` · ${esc(i.intent)}` : ""}${i.hub_path ? ` · dẫn về ${esc(i.hub_path)}` : ""}</p>
      ${fmtSelect(i)}
      ${productsBox(i)}
      ${b ? `<details><summary>Dàn ý</summary><div class="diff">${(b.outline || []).map((o) => `<b>${esc(o.h2 || "")}</b><br>${(o.points || []).map((x) => `· ${esc(x)}`).join("<br>")}`).join("<br>")}${b.expert_input?.length ? `<br><br><b>Chủ site cần bổ sung (kinh nghiệm thật):</b><br>${b.expert_input.map((x) => `· ${esc(x)}`).join("<br>")}` : ""}${b.serp?.paa?.length ? `<br><br><b>People Also Ask:</b><br>${b.serp.paa.map((x) => `· ${esc(x)}`).join("<br>")}` : ""}</div></details>` : ""}
      ${interviewBox(i)}
      ${authorBox(i)}
      ${slotsBox(i)}
      ${reviewBox(i)}
      ${i.gate?.problems?.length ? `<ul class="gate">${i.gate.problems.map((x) => `<li class="${x.level}">${esc(x.message)}</li>`).join("")}</ul>` : ""}
      ${d ? `<details><summary>Bài nháp (${d.words} từ) <span class="tag ${d.author === "owner" ? "fmt" : "info"}">${d.author === "owner" ? "Anh viết" : "Agent viết"}</span></summary><div class="article">${renderArticle(d.html)}</div><p class="note">Meta description: ${esc(d.meta_description)}</p></details>` : ""}
      ${i.wp_edit_url ? `<div class="msg ok">Đã có bản nháp trên WordPress (chưa đăng). <a href="${esc(i.wp_edit_url)}" target="_blank" rel="noopener">Mở để sửa, chọn tác giả thật và đăng</a></div>` : ""}
      <div class="toolbar">
        ${i.status === "approved" && i.products.items.length >= (F[i.format]?.minProducts || 0) ? btn(i, "brief", "Lập dàn ý", "primary") : ""}
        ${i.status === "briefed" && writerOf(i) === "agent" && !i.waitingInterview ? btn(i, "draft", "Agent viết bài nháp", "primary") : ""}
        ${i.status === "briefed" ? btn(i, "brief", "Lập lại dàn ý") : ""}
        ${i.status === "drafted" && !i.wp_post_id && i.gate?.ok ? (ct.platform === "astro" ? `<button type="button" class="primary" data-export="${i.id}">Tải file Markdown cho Astro</button>` : btn(i, "wp", "Tạo bản nháp WordPress", "primary")) : ""}
        ${i.status === "drafted" && !i.wp_post_id && i.draft?.review?.issues?.length ? btn(i, "revise", "Sửa theo nhận xét") : ""}
        ${i.status === "drafted" && !i.wp_post_id ? btn(i, "review", "Chấm lại") : ""}
        ${i.status === "drafted" && !i.wp_post_id && i.draft?.author !== "owner" ? btn(i, "draft", "Viết lại") : ""}
        ${i.wp_post_id && i.status !== "published" ? btn(i, "published", "Đã đăng") : ""}
        ${["approved", "briefed", "drafted"].includes(i.status) ? btn(i, "rejected", "Bỏ chủ đề", "danger") : ""}
      </div></div>`;
  };
  return `
    ${docsHtml(ct, canEdit)}
    <h3 class="sub">${K.icon(K.ICON.layers)}Cấu trúc bài viết hiện tại</h3>
    <p class="note">Mỗi trang dịch vụ nên có ít nhất 3 bài hỗ trợ dẫn link về. "Liên quan" là bài cùng chủ đề nhưng chưa có link: việc chèn link nằm ở tab Việc của agent.</p>
    ${st.hubs.length ? `<div class="tablewrap boxed"><table><thead><tr><th>Trang dịch vụ</th><th>Bài có link về</th><th>Bài liên quan chưa link</th>${st.hubs.some((h) => h.clicks != null) ? "<th>Click 28 ngày</th>" : ""}</tr></thead><tbody>
      ${st.hubs.map((h) => `<tr><td><b>${esc(h.title)}</b><small>${esc(h.path)}</small></td><td>${h.linking.length < 3 ? `<span class="tag warn">${h.linking.length}</span>` : h.linking.length}${h.linking.length ? `<small>${h.linking.map(esc).join(", ")}</small>` : ""}</td><td>${h.related.length}${h.related.length ? `<small>${h.related.map(esc).join(", ")}</small>` : ""}</td>${st.hubs.some((x) => x.clicks != null) ? `<td>${h.clicks ?? 0}</td>` : ""}</tr>`).join("")}
    </tbody></table></div>` : `<p class="note">Chưa xác định được trang dịch vụ: khai báo ở Luật an toàn › Trang dịch vụ.</p>`}
    ${st.unassigned.length ? `<details><summary>${st.unassigned.length} bài không thuộc cụm nào (ứng viên gộp/gỡ)</summary><ul class="urls">${st.unassigned.map((x) => `<li>${esc(x)}</li>`).join("")}</ul></details>` : ""}

    <div class="task-head"><h3 class="sub">${K.icon(K.ICON.pen)}Bài mới đang làm</h3><span class="tag ${ct.limits.usedThisMonth >= ct.limits.perMonth ? "warn" : "info"}">${ct.limits.usedThisMonth}/${ct.limits.perMonth} bài tháng này</span></div>
    <div class="msg" id="idea-msg" hidden></div>
    ${canEdit ? `<details class="new-idea"><summary>${K.icon(K.ICON.plus)}Tạo bài mới theo định dạng</summary>
      <form id="idea-new" class="form-grid">
        <label>Từ khoá chính <input name="keyword" required minlength="3" maxlength="120" placeholder="best robot vacuum for pet hair"></label>
        <label>Định dạng <select name="format"><option value="">Tự đoán từ từ khoá</option>${ct.formats.map((f) => `<option value="${f.id}">${esc(f.label)}: ${esc(f.hint)}</option>`).join("")}</select></label>
        ${st.hubs.length ? `<label>Dẫn về trang (không bắt buộc) <select name="hub_path"><option value="">—</option>${st.hubs.map((h) => `<option value="${esc(h.path)}">${esc(h.title)}</option>`).join("")}</select></label>` : ""}
        <div class="toolbar full"><button type="submit" class="primary">Thêm chủ đề</button></div>
      </form>
      <p class="note">Chủ đề anh thêm vẫn phải qua kiểm trùng với trang có sẵn và giới hạn bài/tháng khi duyệt.</p>
    </details>` : ""}
    ${active.length ? active.map(card).join("") : `<p class="note">Chưa có. Tạo bài mới hoặc duyệt một chủ đề bên dưới.</p>`}

    <div class="task-head"><h3 class="sub">${K.icon(K.ICON.search)}Ý tưởng từ nghiên cứu từ khoá</h3>${canEdit ? `<button type="button" id="research">${K.icon(K.ICON.search)}Nghiên cứu từ khoá</button>` : ""}</div>
    <p class="note">Từ DataForSEO, đã bỏ từ khoá điều hướng, từ khoá trong blocklist và dưới ${ct.limits.minVolume} lượt tìm. Chủ đề site đã có trang thì không viết bài mới (tránh ăn thịt từ khoá): cải thiện trang đó thay vào.${ct.auto?.lastResearch ? ` Lần nghiên cứu gần nhất: ${esc(ago(ct.auto.lastResearch))}.` : ""}</p>
    ${ideas.length ? `<div class="tablewrap boxed"><table><thead><tr><th>Từ khoá</th><th>Định dạng</th><th>Lượt tìm</th><th>KD</th><th>Ý định</th><th>Dẫn về</th><th>Điểm</th><th></th></tr></thead><tbody>
      ${ideas.map((i) => `<tr><td><b>${esc(i.keyword)}</b>${i.covered_by ? `<small>Đã có trang: ${esc(i.covered_by)}</small>` : ""}</td><td>${fmtTag(i)}</td><td>${i.volume ?? "—"}</td><td>${i.kd ?? "—"}</td><td>${esc(i.intent || "—")}</td><td>${esc(i.hub_path || "—")}</td><td>${i.score}</td>
        <td>${!canEdit ? "" : i.covered_by ? `<span class="note">cải thiện trang có sẵn</span>` : `${btn(i, "approved", "Duyệt", "primary")}${btn(i, "rejected", "Bỏ")}`}</td></tr>`).join("")}
    </tbody></table></div>` : `<p class="note">Chưa có ý tưởng. Bấm Nghiên cứu từ khoá (cần DataForSEO trong Cài đặt).</p>`}`;
}

function rulesHtml(c, canEdit) {
  const r = c.rules;
  const dis = canEdit ? "" : " disabled";
  return `<form id="rules-form" novalidate>
    <p class="note">Luật riêng của site. Gác cổng dùng các luật này để chặn mọi đề xuất vi phạm. Đổi blocklist thì app đọc lại toàn bộ trang.</p>
    <p class="note">Search Console: Domain property ghi <code>sc-domain:ten-mien.de</code>; URL-prefix ghi nguyên <code>https://ten-mien.com/</code>. Ghi sai loại sẽ báo "không có quyền" dù đã cấp quyền. Cần nhập Google service account trong Cài đặt.</p>
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
      <label>Property Search Console <input name="gscProperty" value="${esc(r.gscProperty || "")}" placeholder="sc-domain:ten-mien.de hoặc https://ten-mien.com/"${dis}></label>
      <label>GA4 property ID <input name="ga4Property" value="${esc(r.ga4Property || "")}" placeholder="123456789"${dis}></label>
      <label>Link nội bộ mới tối đa mỗi trang <select name="maxLinksPerPage"${dis}>${[1, 2, 3].map((n) => `<option${r.maxLinksPerPage === n ? " selected" : ""}>${n}</option>`).join("")}</select></label>
      <label class="full">Ghi chú cho agent <textarea name="notes" rows="3"${dis}>${esc(r.notes)}</textarea></label>
    </div>
    <h3 class="sub">${K.icon(K.ICON.pen)}Bài mới (chống spam)</h3>
    <div class="form-grid">
      <label>Từ khoá gốc để nghiên cứu (mỗi dòng một từ; trống = lấy H1 trang dịch vụ) <textarea name="seedKeywords" rows="3"${dis}>${esc(lines(r.seedKeywords))}</textarea></label>
      <div class="form-grid inner">
        <label>Tối đa bài mới mỗi tháng <input type="number" name="maxNewArticlesPerMonth" min="0" max="8" value="${r.maxNewArticlesPerMonth}"${dis}></label>
        <label>Lượng tìm kiếm tối thiểu <input type="number" name="minVolume" min="0" value="${r.minVolume}"${dis}></label>
        <label>Điểm Biên tập viên tối thiểu (60–95; dưới mức này agent tự sửa, tối đa 2 vòng) <input type="number" name="minQualityScore" min="60" max="95" value="${r.minQualityScore ?? 75}"${dis}></label>
      </div>
      <label>Câu công khai link affiliate (đặt đầu bài; trống = câu mặc định theo ngôn ngữ, có chữ "paid link"/"Werbung") <textarea name="affiliateDisclosure" rows="3" maxlength="500"${dis}>${esc(r.affiliateDisclosure || "")}</textarea></label>
      <label>Chữ trên nút mua ({merchant} = nơi bán; trống = "Check price at {merchant}") <input name="buyButtonText" maxlength="60" value="${esc(r.buyButtonText || "")}"${dis}></label>
    </div>
    <h3 class="sub">${K.icon(K.ICON.clock)}Chế độ tự động</h3>
    <label class="check"><input type="checkbox" name="autopilot"${r.autopilot ? " checked" : ""}${dis}><span>Bật tự động cho site này<small>Cứ 15 phút agent làm tiếp một bước: quét lại định kỳ, AI viết câu chèn, nghiên cứu từ khoá, dàn ý, bài nháp, bản nháp WordPress. Mọi bước AI qua Quản lý. Không tự đăng bài.</small></span></label>
    <div class="form-grid">
      <label>Quét lại sau (ngày) <input type="number" name="autoRescanDays" min="3" max="60" value="${r.autoRescanDays}"${dis}></label>
    </div>
    <label class="check"><input type="checkbox" name="autoApproveIdeas"${r.autoApproveIdeas ? " checked" : ""}${dis}><span>Tự duyệt chủ đề bài mới tốt nhất<small>Chỉ chủ đề site chưa có trang, gắn với một trang dịch vụ, trong giới hạn bài/tháng.</small></span></label>
    <div class="form-grid">
      <label>Ai viết bài mới <select name="authorMode"${dis}>${[["ask", "Hỏi anh từng bài"], ["agent", "Agent viết (model viết bài)"], ["owner", "Anh tự viết bằng Claude, agent kiểm"]].map(([v, l]) => `<option value="${v}"${(r.authorMode || "ask") === v ? " selected" : ""}>${l}</option>`).join("")}</select></label>
    </div>
    <label class="check"><input type="checkbox" name="requireInterview"${r.requireInterview !== false ? " checked" : ""}${dis}><span>Phỏng vấn trải nghiệm trước khi viết<small>Sau khi lập dàn ý, agent hỏi anh 3–5 câu về trải nghiệm thật; agent chỉ viết khi anh đã trả lời hoặc bấm Bỏ qua. Đây là thứ làm bài giống người viết nhất.</small></span></label>
    <label class="check"><input type="checkbox" name="autoApplyApproved"${r.autoApplyApproved ? " checked" : ""}${dis}><span>Tự áp dụng việc người đã duyệt<small>Chỉ việc anh đã bấm Duyệt; tối đa 3 trang mỗi ngày; có sao lưu và Hoàn tác. Để tắt nếu muốn tự bấm Áp dụng.</small></span></label>
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
  $("[data-guide]", main)?.addEventListener("click", () => { sessionStorage.setItem("duyoi_open_guide", "1"); });
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
  const taskPost = (b, path, label) => busy(b, label, async () => {
    const id = b.closest("[data-task]").dataset.task;
    try { await api(`/api/recovery/tasks/${id}/${path}`, { method: "POST" }); await reload(); }
    catch (e) { showMsg($("#task-msg"), e.message); $("#task-msg").scrollIntoView({ block: "center" }); }
  });
  $$("[data-apply]", main).forEach((b) => b.addEventListener("click", () => taskPost(b, "apply", "Đang áp dụng…")));
  $$("[data-rollback]", main).forEach((b) => b.addEventListener("click", () => {
    if (!b.dataset.armed) { b.dataset.armed = "1"; b.textContent = "Bấm lần nữa để hoàn tác"; return; }
    taskPost(b, "rollback", "Đang hoàn tác…");
  }));
  $$("[data-ai]", main).forEach((b) => b.addEventListener("click", () => taskPost(b, "ai", "AI đang viết…")));
  $$("[data-geo]", main).forEach((b) => b.addEventListener("click", () => busy(b, "AI đang soạn…", async () => {
    try { await api(`/api/recovery/${c.id}/geo`, { method: "POST", body: { url: b.dataset.geo } }); await reload(); }
    catch (e) { showMsg($("#task-msg"), e.message); $("#task-msg").scrollIntoView({ block: "center" }); }
  })));
  const ideaMsg = (e) => { showMsg($("#idea-msg"), e.message); $("#idea-msg")?.scrollIntoView({ block: "center" }); };
  $("#research")?.addEventListener("click", (ev) => busy(ev.currentTarget, "Đang nghiên cứu…", async () => {
    try { await api(`/api/content/${c.id}/research`, { method: "POST" }); K.state.tabs.rec = "content"; await reload(); } catch (e) { ideaMsg(e); }
  }));
  $$("[data-iact]", main).forEach((b) => b.addEventListener("click", () => {
    const id = b.dataset.idea, act = b.dataset.iact;
    const label = { brief: "Đang lập dàn ý…", draft: "Đang viết và chấm…", wp: "Đang tạo bản nháp…", review: "Đang chấm…", revise: "Đang sửa và chấm…" }[act] || "…";
    busy(b, label, async () => {
      try {
        if (["approved", "rejected", "published"].includes(act)) await api(`/api/content/ideas/${id}`, { method: "PUT", body: { status: act } });
        else if (act === "review" || act === "revise") await api(`/api/content/ideas/${id}/review`, { method: "POST", body: { revise: act === "revise" } });
        else await api(`/api/content/ideas/${id}/${act}`, { method: "POST" });
        K.state.tabs.rec = "content";
        await reload();
      } catch (e) { ideaMsg(e); }
    });
  }));
  const content = CTX.content;
  const docMsg = (e) => { showMsg($("#doc-msg"), e.message); $("#doc-msg")?.scrollIntoView({ block: "center" }); };
  $("#doc-up")?.addEventListener("submit", (ev) => {
    ev.preventDefault();
    const f = ev.currentTarget;
    const file = $('[name="file"]', f).files[0];
    if (!file) return;
    busy(ev.submitter, "Đang đọc tài liệu…", async () => {
      try {
        if (file.size > 15 * 1024 * 1024) throw new Error("PDF lớn hơn 15 MB: tách nhỏ rồi tải từng phần.");
        const q = new URLSearchParams({ name: file.name, ocr: $('[name="ocr"]', f).checked ? "1" : "0" });
        const res = await fetch(`/api/sites/${content.media.siteId}/docs?${q}`, { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/pdf" }, body: file });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.message || `Lỗi ${res.status}`);
        K.state.tabs.rec = "content"; await reload();
      } catch (e) { docMsg(e); }
    });
  });
  $$("[data-doc-del]", main).forEach((b) => b.addEventListener("click", () => busy(b, "…", async () => {
    try { await api(`/api/sites/${content.media.siteId}/docs/${b.dataset.docDel}`, { method: "DELETE" }); K.state.tabs.rec = "content"; await reload(); } catch (e) { docMsg(e); }
  })));
  $$("[data-doc-idea]", main).forEach((b) => b.addEventListener("click", () => busy(b, "Đang thêm…", async () => {
    try { await api(`/api/content/${c.id}/ideas`, { method: "POST", body: { keyword: b.dataset.docIdea, format: b.dataset.fmt } }); K.state.tabs.rec = "content"; await reload(); } catch (e) { docMsg(e); }
  })));
  $("#profile-form")?.addEventListener("submit", (ev) => {
    ev.preventDefault();
    const f = ev.currentTarget;
    const v = (n) => $(`[name="${n}"]`, f).value;
    const ls = (n) => v(n).split("\n").map((x) => x.trim()).filter(Boolean);
    const body = { ...content.docs.profile, summary: v("summary"), audience: v("audience"), tone: v("tone"), services: ls("services"), banned: ls("banned"),
      facts: ls("facts").map((l) => { const k = l.lastIndexOf(" | "); return k > 0 ? { text: l.slice(0, k), source: l.slice(k + 3) } : { text: l, source: "anh nhập" }; }) };
    busy(ev.submitter, "Đang lưu…", async () => {
      try { await api(`/api/sites/${content.media.siteId}/profile`, { method: "PUT", body }); K.state.tabs.rec = "content"; await reload(); } catch (e) { docMsg(e); }
    });
  });
  $("#voice-form")?.addEventListener("submit", (ev) => {
    ev.preventDefault();
    const f = ev.currentTarget;
    busy(ev.submitter, "Đang đọc bài mẫu…", async () => {
      try { await api(`/api/sites/${content.media.siteId}/voice`, { method: "POST", body: { urls: $('[name="urls"]', f).value.split(/\s+/).filter(Boolean), text: $('[name="text"]', f).value } }); K.state.tabs.rec = "content"; await reload(); } catch (e) { docMsg(e); }
    });
  });
  $$("form[data-iv]", main).forEach((f) => f.addEventListener("submit", (ev) => {
    ev.preventDefault();
    const answers = $$("textarea", f).map((t) => t.value);
    busy(ev.submitter, "Đang lưu…", async () => {
      try { await api(`/api/content/ideas/${f.dataset.iv}/interview`, { method: "PUT", body: { answers } }); K.state.tabs.rec = "content"; await reload(); } catch (e) { ideaMsg(e); }
    });
  }));
  $$("[data-iv-skip]", main).forEach((b) => b.addEventListener("click", () => busy(b, "…", async () => {
    try { await api(`/api/content/ideas/${b.dataset.ivSkip}/interview`, { method: "PUT", body: { skip: true } }); K.state.tabs.rec = "content"; await reload(); } catch (e) { ideaMsg(e); }
  })));
  $$("[data-author]", main).forEach((b) => b.addEventListener("click", () => busy(b, "…", async () => {
    try { await api(`/api/content/ideas/${b.dataset.id}`, { method: "PUT", body: { author: b.dataset.author } }); K.state.tabs.rec = "content"; await reload(); } catch (e) { ideaMsg(e); }
  })));
  const handoff = async (id) => {
    const res = await fetch(`/api/content/ideas/${id}/handoff.md`, { credentials: "same-origin" });
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).message || `Lỗi ${res.status}`);
    return { text: await res.text(), name: (/filename="([^"]+)"/.exec(res.headers.get("Content-Disposition") || "") || [])[1] || "yeu-cau.md" };
  };
  $$("[data-handoff]", main).forEach((b) => b.addEventListener("click", () => busy(b, "…", async () => {
    try { const h = await handoff(b.dataset.handoff); const box = $(`#handoff-${b.dataset.handoff}`); $("textarea", box).value = h.text; box.hidden = false; } catch (e) { ideaMsg(e); }
  })));
  $$("[data-handoff-dl]", main).forEach((b) => b.addEventListener("click", () => busy(b, "…", async () => {
    try { const h = await handoff(b.dataset.handoffDl); const url = URL.createObjectURL(new Blob([h.text], { type: "text/markdown" })); const a = document.createElement("a"); a.href = url; a.download = h.name; document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 2000); } catch (e) { ideaMsg(e); }
  })));
  $$("[data-copy]", main).forEach((b) => b.addEventListener("click", async () => {
    const t = $(`#handoff-${b.dataset.copy} textarea`);
    try { await navigator.clipboard.writeText(t.value); b.textContent = "Đã chép"; } catch { t.select(); document.execCommand("copy"); b.textContent = "Đã chép"; }
  }));
  $$("form[data-import]", main).forEach((f) => f.addEventListener("submit", (ev) => {
    ev.preventDefault();
    const content = $('[name="content"]', f).value;
    busy(ev.submitter, "Đang đưa bài vào và chấm…", async () => {
      try { await api(`/api/content/ideas/${f.dataset.import}/import`, { method: "POST", body: { content, revise: $('[name="revise"]', f).checked } }); K.state.tabs.rec = "content"; await reload(); } catch (e) { ideaMsg(e); }
    });
  }));
  $("#idea-new")?.addEventListener("submit", (ev) => {
    ev.preventDefault();
    const d = formData(ev.currentTarget);
    busy(ev.submitter, "Đang thêm…", async () => {
      try { await api(`/api/content/${c.id}/ideas`, { method: "POST", body: { keyword: d.keyword, format: d.format || undefined, hub_path: d.hub_path || undefined } }); K.state.tabs.rec = "content"; await reload(); } catch (e) { ideaMsg(e); }
    });
  });
  $$("[data-format]", main).forEach((s) => s.addEventListener("change", async () => {
    try { await api(`/api/content/ideas/${s.dataset.format}`, { method: "PUT", body: { format: s.value } }); K.state.tabs.rec = "content"; await reload(); } catch (e) { ideaMsg(e); }
  }));
  $$("form[data-products]", main).forEach((f) => {
    const list = $(".prod-list", f);
    const tpl = list.firstElementChild.outerHTML;
    f.addEventListener("click", (e) => {
      if (e.target.closest("[data-prod-add]")) { list.insertAdjacentHTML("beforeend", tpl); const last = list.lastElementChild; $$("input, textarea", last).forEach((x) => { if (x.type === "checkbox") x.checked = false; else x.value = ""; }); }
      const del = e.target.closest("[data-prod-del]");
      if (del && list.children.length > 1) del.closest(".prod-row").remove();
    });
    f.addEventListener("submit", (ev) => {
      ev.preventDefault();
      const items = $$(".prod-row", f).map((r) => {
        const v = (n) => $(`[name="${n}"]`, r).value.trim();
        return { name: v("name"), bestFor: v("bestFor"), url: v("url"), merchant: v("merchant"), specs: v("specs"), notes: v("notes"), pros: v("pros"), cons: v("cons"), tested: $('[name="tested"]', r).checked,
          links: v("links").split("\n").map((l) => l.split("|").map((x) => x.trim())).filter((x) => x.length === 2 && x[1]).map(([merchant, url]) => ({ merchant, url })) };
      }).filter((p) => p.name);
      busy(ev.submitter, "Đang lưu…", async () => {
        try { await api(`/api/content/ideas/${f.dataset.products}/products`, { method: "PUT", body: { method: $('[name="method"]', f).value, items } }); K.state.tabs.rec = "content"; await reload(); } catch (e) { ideaMsg(e); }
      });
    });
  });
  $$("form[data-upload]", main).forEach((f) => f.addEventListener("submit", (ev) => {
    ev.preventDefault();
    const file = $('[name="file"]', f).files[0];
    if (!file) return;
    const q = new URLSearchParams({ alt: $('[name="alt"]', f).value.trim(), caption: $('[name="caption"]', f).value.trim(), source: $('[name="source"]', f).value, real: $('[name="real"]', f).checked ? "1" : "0" });
    busy(ev.submitter, "Đang tải lên…", async () => {
      try {
        if (file.size > 8 * 1024 * 1024) throw new Error("Ảnh lớn hơn 8 MB: giảm kích thước rồi tải lại.");
        const res = await fetch(`/api/content/ideas/${f.dataset.upload}/images/${f.dataset.slot}?${q}`, { method: "POST", credentials: "same-origin", headers: { "Content-Type": file.type || "application/octet-stream" }, body: file });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.message || `Lỗi ${res.status}`);
        K.state.tabs.rec = "content"; await reload();
      } catch (e) { ideaMsg(e); }
    });
  }));
  const mediaRun = (b, path, label) => busy(b, label, async () => {
    const box = $("#media-steps");
    try {
      const r = await api(path, { method: "POST" });
      box.innerHTML = r.steps.map((s) => `<li class="${s.ok ? "ok" : "block"}">${esc(s.message)}</li>`).join("");
      box.hidden = false;
      if (r.ok) { K.state.tabs.rec = "content"; setTimeout(reload, 1200); }
    } catch (e) { box.innerHTML = `<li class="block">${esc(e.message)}</li>`; box.hidden = false; }
  });
  $$("[data-media-setup]", main).forEach((b) => b.addEventListener("click", () => mediaRun(b, `/api/sites/${b.dataset.mediaSetup}/media`, "Đang dựng…")));
  $$("[data-media-check]", main).forEach((b) => b.addEventListener("click", () => mediaRun(b, `/api/sites/${b.dataset.mediaCheck}/media/check`, "Đang kiểm tra…")));
  $$("[data-export]", main).forEach((b) => b.addEventListener("click", () => busy(b, "Đang xuất…", async () => {
    try {
      const res = await fetch(`/api/content/ideas/${b.dataset.export}/export.md`, { credentials: "same-origin" });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).message || `Lỗi ${res.status}`);
      const name = (/filename="([^"]+)"/.exec(res.headers.get("Content-Disposition") || "") || [])[1] || "bai-moi.md";
      const url = URL.createObjectURL(await res.blob());
      const a = document.createElement("a"); a.href = url; a.download = name; document.body.append(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
    } catch (e) { ideaMsg(e); }
  })));
  $$("[data-img-del]", main).forEach((b) => b.addEventListener("click", () => busy(b, "…", async () => {
    try { await api(`/api/content/ideas/${b.dataset.imgDel}/images/${b.dataset.slot}`, { method: "DELETE" }); K.state.tabs.rec = "content"; await reload(); } catch (e) { ideaMsg(e); }
  })));
  const rf = $("#rules-form");
  rf?.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const d = formData(rf);
    let rules;
    if (d.json.trim()) {
      try { rules = JSON.parse(d.json); } catch { return showMsg($("#rules-msg"), "JSON không hợp lệ."); }
    } else {
      const { json: _j, dropMonth: _m, ...rest } = d;
      rules = { ...rest, maxLinksPerPage: Number(d.maxLinksPerPage), maxNewArticlesPerMonth: Number(d.maxNewArticlesPerMonth), minVolume: Number(d.minVolume), minQualityScore: Number(d.minQualityScore), autoRescanDays: Number(d.autoRescanDays) };
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
