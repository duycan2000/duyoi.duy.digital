// Agent HQ: đội agent theo khu, trạng thái thật; cấp Quản lý duyệt prompt và theo dõi chi tiêu; chế độ tự động.

import { api } from "./api.js";
import { $, $$, esc, fmtTime, ago, showMsg, busy } from "./ui.js";

let K;
const STATE = { working: ["Đang làm", "info"], waiting: ["Có việc chờ", "warn"], idle: ["Rảnh", ""], blocked: ["Chờ Quản lý duyệt prompt", "err"] };
const ZONES = [["manager", "Điều hành", "Quản lý kiểm prompt và chi tiêu trước khi agent được làm"], ["recovery", "Phục hồi thứ hạng", "Quét, chẩn đoán, sửa site bị tụt hạng"], ["content", "Nội dung mới", "Cấu trúc, từ khoá, dàn ý, bài nháp"], ["auto", "Tự động", "Lịch chạy 15 phút một lần"]];
const money = (n) => `$${(Number(n) || 0).toFixed(Number(n) >= 1 ? 2 : 4)}`;
const tag = ([l, c]) => `<span class="tag ${c}">${esc(l)}</span>`;
const ACTOR = { doctor: "Bác sĩ SEO", linker: "Nối link nội bộ", funnel: "Phễu CTA", geo: "GEO", research: "Nghiên cứu từ khoá", planner: "Biên tập viên", writer: "Người viết", autopilot: "Tự động", manager: "Quản lý" };

export async function viewHq(main, args, kit) {
  K = kit;
  if (args[0]) K.state.tabs.hq = args[0];
  const [hq, prompts, spend, lead] = await Promise.all([api("/api/hq"), api("/api/manager/prompts"), api("/api/manager/spend"), api("/api/lead")]);
  const admin = K.state.user.role === "admin";
  main.innerHTML = `
  <div class="page">
    <div class="page-head"><div><h2>Agent HQ</h2><p>Đội agent làm việc cho các site của anh. Mọi prompt phải được Quản lý duyệt, mọi lần gọi AI và DataForSEO đều được kiểm trần chi phí và ghi lại.</p></div>
      <div class="toolbar"><button type="button" id="hq-refresh">${K.icon(K.ICON.clock)}Làm mới</button></div></div>
    ${hq.asks?.length ? `<div class="msg warn"><b>Agent đang hỏi anh (${hq.asks.length}):</b> ${hq.asks.slice(0, 4).map((a) => `<a href="#/recovery/${a.caseId}/content">${esc(a.domain)} · "${esc(a.keyword)}"</a>: ${esc(a.text)}`).join(" · ")}</div>` : ""}
    ${hq.manager.promptsPending ? `<div class="msg warn">${hq.manager.promptsPending} prompt chưa được duyệt: agent dùng prompt đó sẽ bị chặn. ${admin ? `<a href="#/hq/prompts" data-tab-go="prompts">Duyệt ngay</a>` : "Nhờ admin duyệt."}</div>` : ""}
    <div class="card tabbed">
      ${K.tabsNav("hq", [["lead", "Trưởng nhóm", "spark"], ["team", "Đội agent", "users"], ["prompts", `Quản lý prompt${hq.manager.promptsPending ? ` (${hq.manager.promptsPending})` : ""}`, "shield"], ["spend", "Chi tiêu", "money"], ["auto", "Tự động", "clock"]], "lead")}
      <div class="tab-body" ${K.panelAttr("hq", "lead", "lead")}>${leadHtml(lead, hq, admin)}</div>
      <div class="tab-body" ${K.panelAttr("hq", "team", "lead")}>${teamHtml(hq, spend)}</div>
      <div class="tab-body" ${K.panelAttr("hq", "prompts", "lead")}>${promptsHtml(prompts.prompts, admin)}</div>
      <div class="tab-body" ${K.panelAttr("hq", "spend", "lead")}>${spendHtml(spend)}</div>
      <div class="tab-body" ${K.panelAttr("hq", "auto", "lead")}>${autoHtml(hq)}</div>
    </div>
  </div>`;
  K.bindTabs(main, "hq");
  $("#hq-refresh").addEventListener("click", () => viewHq(main, [], K));
  $$("[data-tab-go]", main).forEach((a) => a.addEventListener("click", (e) => { e.preventDefault(); $(`[data-tab-key="${a.dataset.tabGo}"]`, main).click(); }));
  $$("[data-review]", main).forEach((b) => b.addEventListener("click", () => busy(b, "Đang lưu…", async () => {
    try { await api(`/api/manager/prompts/${b.dataset.id}`, { method: "PUT", body: { status: b.dataset.review } }); K.state.tabs.hq = "prompts"; await viewHq(main, [], K); }
    catch (e) { showMsg($("#prompt-msg"), e.message); }
  })));
  bindLead(main);
  $$(".agent-card[data-href]", main).forEach((c) => c.addEventListener("click", () => { location.hash = c.dataset.href; }));
}

function agentCard(a, href) {
  const st = STATE[a.state] || STATE.idle;
  const counts = a.tasks ? `${a.tasks.open} chờ duyệt · ${a.tasks.approved} đã duyệt · ${a.tasks.done} xong${a.tasks.blocked ? ` · ${a.tasks.blocked} bị chặn` : ""}` : a.waiting != null ? `${a.waiting} việc đang chờ` : "";
  return `<div class="agent-card s-${esc(a.state)}"${href ? ` data-href="${esc(href)}" tabindex="0"` : ""}>
    <div class="agent-top"><span class="agent-ava">${K.icon(K.ICON[a.icon] || K.ICON.spark)}<i></i></span><div><b>${esc(a.name)}</b>${tag(st)}</div></div>
    <p class="note">${esc(a.role)}</p>
    ${a.detail ? `<p class="busy">${esc(a.detail)}</p>` : ""}
    <div class="agent-foot"><small>${esc(counts)}</small><small>${a.spend?.calls ? `${a.spend.calls} lần gọi · ${money(a.spend.cost)} tháng này` : ""}</small></div>
    ${a.last ? `<small class="last">${esc(ago(a.last.at))}: ${esc(a.last.detail || a.last.action)}</small>` : ""}
  </div>`;
}

function teamHtml(hq, spend) {
  const m = hq.manager;
  const manager = { id: "manager", name: "Quản lý", icon: "shield", role: "Duyệt prompt trước khi agent dùng (đúng từng phiên bản), giữ trần chi phí tháng và trần AI mỗi site/ngày, ghi lại mọi lần gọi.", state: m.promptsPending ? "blocked" : "idle", waiting: m.promptsPending, detail: `OpenRouter ${money(spend.spent.openrouter)} / $${spend.caps.openrouter} · DataForSEO ${money(spend.spent.dataforseo)} / $${spend.caps.dataforseo}${spend.blockedMonth ? ` · đã chặn ${spend.blockedMonth} lần gọi tháng này` : ""}` };
  const auto = { id: "autopilot", name: "Tự động", icon: "clock", role: "Cứ 15 phút: quét lại định kỳ, cho AI viết câu chèn, nghiên cứu từ khoá, lập dàn ý, viết nháp, tạo bản nháp WordPress. Không tự đăng, không tự duyệt việc sửa site.", state: hq.autopilot.sites.length ? "working" : "idle", detail: hq.autopilot.sites.length ? hq.autopilot.sites.map((x) => `${x.domain}: ${x.lastStep || "chưa chạy"}`).join(" · ") : "Chưa site nào bật. Bật ở Phục hồi › ca của site › Luật an toàn.", last: hq.autopilot.last };
  const zone = (key) => {
    const [, title, desc] = ZONES.find((z) => z[0] === key);
    const leadCard = { id: "lead", name: "Trưởng nhóm", icon: "spark", role: "Anh chat trực tiếp: Trưởng nhóm đọc tình trạng thật của các site, trả lời và đề xuất phương án giao cho agent sẵn có. Anh chọn việc rồi bấm Giao việc.", state: hq.lead.blockedPrompt ? "blocked" : hq.lead.running ? "working" : hq.lead.queued ? "waiting" : "idle", detail: `${hq.lead.queued} việc chờ · ${hq.lead.running} đang chạy · ${hq.lead.done} xong${hq.lead.failed ? ` · ${hq.lead.failed} lỗi` : ""}`, spend: hq.lead.spend, last: hq.lead.last };
    const agents = key === "manager" ? [leadCard, manager] : key === "auto" ? [auto] : hq.zones[key];
    return `<section class="zone z-${key}"><header><b>${esc(title)}</b><small>${esc(desc)}</small></header><div class="zone-grid">${agents.map((a) => agentCard(a, a.id === "lead" ? "#/hq/lead" : key === "recovery" ? "#/recovery" : key === "content" ? "#/content" : key === "manager" ? "#/hq/prompts" : null)).join("")}</div></section>`;
  };
  return `<div class="hq-floor">${zone("manager")}${zone("auto")}${zone("recovery")}${zone("content")}</div>
    <h3 class="sub">${K.icon(K.ICON.list)}Agent vừa làm</h3>
    ${hq.recent.length ? `<div class="activity">${hq.recent.map((r) => `<a href="#/activity"><span><b>${esc(ACTOR[r.actor.replace("agent:", "")] || r.actor)}</b> · ${esc(r.detail || r.action)}</span><time>${esc(fmtTime(r.at))}</time></a>`).join("")}</div>` : `<p class="note">Chưa có hoạt động của agent.</p>`}`;
}

function promptsHtml(prompts, admin) {
  return `<p class="note">Mỗi prompt có <b>phiên bản</b> (mã băm nội dung). Sửa prompt trong code là ra phiên bản mới và phải duyệt lại. Quản lý tự kiểm tra trước: có chèn luật chung (ngôn ngữ, cấm bịa số liệu, blocklist), độ dài, tầng model, giới hạn đầu ra. Phần <code>{{RULES}}</code> được thay bằng luật riêng của từng site lúc chạy.</p>
    <div class="msg" id="prompt-msg" hidden></div>
    <div class="prompts">${prompts.map((p) => `<div class="task">
      <div class="task-head"><b>${esc(p.title)}</b><span class="tags">${tag(p.review?.status === "approved" ? ["Đã duyệt", "ok"] : p.review?.status === "rejected" ? ["Đã từ chối", "err"] : ["Chờ duyệt", "warn"])}${tag(p.lint.ok ? ["Qua kiểm tra tự động", "ok"] : ["Không qua kiểm tra", "err"])}</span></div>
      <p class="note">Agent: ${esc(p.agent)} · model ${esc(p.tier.replace("model_", "").toUpperCase())} · tối đa ${p.maxTokens} token đầu ra · phiên bản <code>${esc(p.version)}</code>${p.review ? ` · ${p.review.status === "approved" ? "duyệt" : "từ chối"} ${esc(ago(p.review.reviewed_at))}` : ""} · tháng này ${p.usesMonth} lần, ${money(p.costMonth)}</p>
      ${p.formats ? `<details><summary>Khung định dạng (${p.formats.length}) ghép vào prompt</summary>${p.formats.map((f) => `<p><b>${esc(f.label)}</b></p><pre class="prompt">${esc(f.spec)}</pre>`).join("")}</details>` : ""}
      ${p.lint.issues.length ? `<ul class="gate">${p.lint.issues.map((x) => `<li class="block">${esc(x)}</li>`).join("")}</ul>` : ""}
      <details><summary>Xem prompt</summary><pre class="prompt">${esc(p.system)}</pre><p class="note">Dữ liệu gửi kèm: ${esc(p.input)}</p></details>
      ${admin ? `<div class="toolbar">${p.review?.status !== "approved" ? `<button type="button" class="primary" data-review="approved" data-id="${esc(p.id)}">Duyệt phiên bản này</button>` : ""}${p.review?.status !== "rejected" ? `<button type="button" class="danger" data-review="rejected" data-id="${esc(p.id)}">Từ chối</button>` : ""}</div>` : ""}
    </div>`).join("")}</div>`;
}

function spendHtml(s) {
  const bar = (v, cap) => `<meter min="0" max="${Math.max(cap, 0.0001)}" low="${cap * 0.7}" high="${cap * 0.9}" optimum="0" value="${Math.min(v, cap)}"></meter>`;
  return `<div class="traffic-box">
      <div><b>${money(s.spent.openrouter)} / $${s.caps.openrouter}</b><small>OpenRouter tháng này</small>${bar(s.spent.openrouter, s.caps.openrouter)}</div>
      <div><b>${money(s.spent.dataforseo)} / $${s.caps.dataforseo}</b><small>DataForSEO tháng này</small>${bar(s.spent.dataforseo, s.caps.dataforseo)}</div>
      <div><b>$${s.caps.siteDaily}</b><small>trần AI mỗi site / 24 giờ</small></div>
      <div><b>${s.blockedMonth}</b><small>lần gọi bị Quản lý chặn tháng này</small></div>
    </div>
    <p class="note">Chỉnh trần ở <a href="#/settings/models">Cài đặt › Model AI &amp; chi phí</a>. Chạm trần thì mọi agent dừng gọi tới đầu tháng sau (hoặc tới khi anh nâng trần).</p>
    <div class="grid2">
      <div><h3 class="sub">${K.icon(K.ICON.users)}Theo agent</h3>${s.byAgent.length ? `<div class="tablewrap boxed"><table><thead><tr><th>Agent</th><th>Nguồn</th><th>Lần gọi</th><th>Token</th><th>Chi phí</th></tr></thead><tbody>${s.byAgent.map((r) => `<tr><td>${esc(ACTOR[r.agent] || r.agent)}</td><td>${esc(r.provider)}</td><td>${r.calls}</td><td>${(r.tin || 0) + (r.tout || 0)}</td><td>${money(r.cost)}</td></tr>`).join("")}</tbody></table></div>` : `<p class="note">Chưa có chi phí tháng này.</p>`}</div>
      <div><h3 class="sub">${K.icon(K.ICON.globe)}Theo site</h3>${s.bySite.length ? `<div class="tablewrap boxed"><table><thead><tr><th>Site</th><th>Lần gọi</th><th>Chi phí</th></tr></thead><tbody>${s.bySite.map((r) => `<tr><td>${esc(r.domain || "—")}</td><td>${r.calls}</td><td>${money(r.cost)}</td></tr>`).join("")}</tbody></table></div>` : `<p class="note">Chưa có.</p>`}</div>
    </div>
    <h3 class="sub">${K.icon(K.ICON.list)}Nhật ký gọi AI / DataForSEO</h3>
    <p class="note">Không lưu nội dung prompt, chỉ lưu độ dài, số token và chi phí thật do nhà cung cấp trả về.</p>
    <div class="tablewrap boxed"><table><thead><tr><th>Lúc</th><th>Agent</th><th>Việc</th><th>Site</th><th>Model</th><th>Token</th><th>Chi phí</th><th>Kết quả</th></tr></thead><tbody>
      ${s.recent.map((r) => `<tr><td>${esc(fmtTime(r.at))}</td><td>${esc(ACTOR[r.agent] || r.agent)}</td><td>${esc(r.task)}${r.template_id ? `<small>${esc(r.template_id)} · ${esc(r.version || "")}</small>` : ""}</td><td>${esc(r.domain || "—")}</td><td>${esc(r.model || r.provider)}</td><td>${(r.tokens_in || 0) + (r.tokens_out || 0)}</td><td>${money(r.cost_usd)}</td><td>${r.status === "ok" ? `<span class="tag ok">OK</span>` : `<span class="tag ${r.status === "blocked" ? "warn" : "err"}">${r.status === "blocked" ? "Bị chặn" : "Lỗi"}</span><small>${esc(r.reason || "")}</small>`}</td></tr>`).join("") || `<tr><td colspan="8">Chưa có lần gọi nào.</td></tr>`}
    </tbody></table></div>`;
}

function autoHtml(hq) {
  return `<p class="note">Bật tự động cho từng site ở <b>Phục hồi › ca của site › Luật an toàn › Chế độ tự động</b>. Mỗi 15 phút, mỗi site làm tối đa một bước nặng, theo thứ tự:</p>
    <ol class="steps">
      <li>Quét lại site sau số ngày anh chọn (mặc định 7 ngày), phân tích và lập việc mới.</li>
      <li>Nếu anh bật "Tự áp dụng việc đã duyệt": áp dụng việc <b>người đã duyệt</b> lên WordPress, tối đa 3 trang mỗi ngày, có sao lưu.</li>
      <li>AI viết lại câu chèn link/CTA còn dùng câu mẫu (vẫn chờ anh duyệt).</li>
      <li>Nghiên cứu từ khoá 30 ngày một lần.</li>
      <li>Nếu anh bật "Tự duyệt chủ đề": chọn chủ đề tốt nhất chưa có trang, trong giới hạn bài/tháng.</li>
      <li>Chủ đề đã duyệt → dàn ý → bài nháp (qua Gác cổng) → bản nháp WordPress. Không bao giờ tự đăng.</li>
    </ol>
    ${hq.autopilot.sites.length ? `<div class="tablewrap boxed"><table><thead><tr><th>Site</th><th>Bước gần nhất</th><th>Lúc</th><th>Lỗi</th></tr></thead><tbody>${hq.autopilot.sites.map((x) => `<tr><td><a href="#/recovery/${x.caseId}">${esc(x.domain)}</a></td><td>${esc(x.lastStep || "chưa chạy")}</td><td>${esc(x.lastRun ? ago(x.lastRun) : "—")}</td><td>${x.lastError ? `<span class="tag err">${esc(x.lastError)}</span>` : "—"}</td></tr>`).join("")}</tbody></table></div>` : `<p class="note">Chưa site nào bật tự động.</p>`}
    <p class="note">Tạm dừng toàn bộ (nút ở Tổng quan) cũng dừng chế độ tự động.</p>`;
}

const ACTION_LABEL = { research_keywords: "Nghiên cứu từ khoá", create_article: "Tạo chủ đề bài mới", write_brief: "Lập dàn ý", write_draft: "Viết bài nháp (kèm chấm)", review_draft: "Sửa và chấm lại", rescan_site: "Quét lại site" };
const FMT = { roundup: "Best X / Top N", review: "Review", comparison: "So sánh", how_to: "How-to", guide: "Guide", article: "Bài thông tin" };
const JSTATUS = { queued: ["Chờ chạy", "warn"], running: ["Đang chạy", "info"], done: ["Xong", "ok"], failed: ["Lỗi", "err"] };
const SUGGEST = ["Từ nay ưu tiên site …, mỗi tháng … bài loại …", "Tháng này nên viết bài gì cho từng site?", "Bài nào đang chờ tôi (sản phẩm, ảnh)?", "Site nào nên ưu tiên phục hồi trước?", "Tài liệu tôi tải lên gợi ý được bài nào?"];

const PB_EXAMPLE = `Ví dụ:
- Ưu tiên: site A trước, rồi site B. Site C tạm dừng viết bài.
- Site affiliate: ưu tiên Best X / review; mỗi tháng tối đa 3 bài.
- Site dịch vụ: ưu tiên guide và how-to dẫn về trang dịch vụ.
- caddienstleistungen.de: chỉ tiếng Đức, không nhắc đối thủ.
- Bài mới phải dựa trên tài liệu site khi có.`;
let BOOK = "";
const inBook = (t) => BOOK.split("\n").some((l) => l.replace(/^[-*]\s*/, "").trim() === t.trim());

function playbookHtml(pb) {
  return `<details class="pb-box" open><summary>${K.icon(K.ICON.list)}Sổ tay Trưởng nhóm</summary>
    <p class="note">Cách anh muốn Trưởng nhóm ra quyết định: site nào ưu tiên, mỗi site viết loại bài gì, luật riêng. Trưởng nhóm đọc sổ tay mỗi lần trả lời. Sổ tay không vượt được Gác cổng và luật sản phẩm.</p>
    <form id="pb-form"><textarea name="body" rows="9" maxlength="8000" placeholder="${esc(PB_EXAMPLE)}" aria-label="Sổ tay Trưởng nhóm">${esc(pb.body)}</textarea>
      <div class="toolbar"><button type="submit" class="primary">Lưu sổ tay</button>${pb.at ? `<small class="note">Sửa ${esc(ago(pb.at))}</small>` : ""}</div></form>
    ${pb.versions.length > 1 ? `<details><summary>Phiên bản trước (${pb.versions.length - 1})</summary><div class="pb-versions">${pb.versions.slice(1).map((v) => `<div><small>${esc(fmtTime(v.at))} · ${esc(v.note || "")} · ${v.chars} ký tự</small><button type="button" data-pb-restore="${v.id}">Khôi phục</button></div>`).join("")}</div></details>` : ""}
  </details>`;
}

function leadHtml(lead, hq, admin) {
  BOOK = lead.playbook.body || "";
  const domains = Object.fromEntries((hq.autopilot.sites || []).map((s) => [s.siteId, s.domain]));
  const msg = (m) => {
    if (m.role === "user") return `<div class="bubble me"><p>${esc(m.content).replace(/\n/g, "<br>")}</p><time>${esc(fmtTime(m.at))}</time></div>`;
    const items = m.plan?.items || [];
    const can = !m.ran_at && items.some((x) => x.ok);
    return `<div class="bubble lead"><p>${esc(m.content).replace(/\n/g, "<br>")}</p>
      ${items.length ? `<form class="plan" data-plan="${m.id}">${items.map((x, n) => `<label class="plan-item${x.ok ? "" : " bad"}"><input type="checkbox" name="item" value="${n}"${x.ok && !m.ran_at ? " checked" : ""}${!x.ok || m.ran_at ? " disabled" : ""}>
        <span><b>${esc(ACTION_LABEL[x.action] || x.action)}</b>${x.keyword ? ` · "${esc(x.keyword)}"` : ""}${x.format ? ` · ${esc(FMT[x.format] || x.format)}` : ""} <small>${esc(x.domain || domains[x.site_id] || `site #${x.site_id}`)}</small>
        ${x.why ? `<small>${esc(x.why)}</small>` : ""}${x.ok ? "" : `<small class="err">Không giao được: ${esc(x.problem || "")}</small>`}</span></label>`).join("")}
        ${can ? `<div class="toolbar"><button type="submit" class="primary">Giao việc đã chọn</button></div>` : m.ran_at ? `<small class="note">Đã giao ${esc(fmtTime(m.ran_at))}</small>` : ""}
      </form>` : ""}
      ${m.plan?.playbookAdd?.length ? `<div class="pb-add"><b>Ghi vào Sổ tay Trưởng nhóm?</b>${m.plan.playbookAdd.map((t) => `<div class="pb-line"><span>${esc(t)}</span>${inBook(t) ? `<small class="ok">Đã có trong sổ tay</small>` : `<button type="button" data-pb-add="${esc(t)}">Ghi vào sổ tay</button>`}</div>`).join("")}</div>` : ""}
      ${m.plan?.needs?.length ? `<div class="needs"><b>Anh cần đưa:</b><ul>${m.plan.needs.map((x) => `<li>${esc(x)}</li>`).join("")}</ul></div>` : ""}
      <time>${esc(fmtTime(m.at))}</time></div>`;
  };
  return `<div class="lead-wrap">
    <div class="chat">
      ${hq.lead.blockedPrompt ? `<div class="msg warn">Prompt của Trưởng nhóm chưa được duyệt. ${admin ? `<a href="#/hq/prompts">Duyệt ở Quản lý prompt</a>.` : "Nhờ admin duyệt."}</div>` : ""}
      <div class="chat-log" id="chat-log">${lead.messages.length ? lead.messages.map(msg).join("") : `<div class="bubble lead"><p>Chào anh, em là Trưởng nhóm. Anh hỏi em về tình hình các site hoặc giao mục tiêu (ví dụ: "tháng này 4 bài affiliate chất lượng cho site X"). Em sẽ đề xuất việc cho từng agent, anh chọn rồi bấm Giao việc. Em không tự sửa site hay đăng bài.</p></div>`}</div>
      <div class="msg" id="lead-msg" hidden></div>
      <form id="lead-form" class="composer">
        <div class="chips">${SUGGEST.map((t) => `<button type="button" class="chip" data-suggest="${esc(t)}">${esc(t)}</button>`).join("")}</div>
        <textarea name="text" rows="3" maxlength="2000" placeholder="Hỏi hoặc giao mục tiêu cho đội agent…" aria-label="Tin nhắn cho Trưởng nhóm"></textarea>
        <div class="toolbar"><button type="submit" class="primary">Gửi</button></div>
      </form>
    </div>
    <div class="jobs">
      ${playbookHtml(lead.playbook)}
      <h3 class="sub">${K.icon(K.ICON.list)}Hàng việc</h3>
      <p class="note">Việc nhẹ chạy ngay khi giao; việc nặng (dàn ý, viết, chấm, quét lại) chạy ở lượt cron 15 phút kế tiếp, hoặc anh bấm Chạy ngay.</p>
      ${lead.jobs.length ? lead.jobs.map((j) => `<div class="job">
        <div class="task-head"><b>${esc(j.label)}</b>${tag(JSTATUS[j.status] || [j.status, ""])}</div>
        <small>${esc(j.domain || "")}${j.params.keyword ? ` · "${esc(j.params.keyword)}"` : ""} · ${esc(ago(j.created_at))}</small>
        ${j.result ? `<small class="ok">${esc(j.result)}</small>` : ""}${j.error ? `<small class="err">${esc(j.error)}</small>` : ""}
        ${j.status === "queued" ? `<button type="button" data-job-run="${j.id}">Chạy ngay</button>` : ""}
      </div>`).join("") : `<p class="note">Chưa có việc nào.</p>`}
    </div>
  </div>`;
}

function bindLead(main) {
  const log = $("#chat-log", main);
  if (log) log.scrollTop = log.scrollHeight;
  const form = $("#lead-form", main);
  if (!form) return;
  const ta = $("textarea", form);
  $$("[data-suggest]", form).forEach((b) => b.addEventListener("click", () => { ta.value = b.dataset.suggest; ta.focus(); }));
  ta.addEventListener("keydown", (e) => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) form.requestSubmit(); });
  const again = async () => { K.state.tabs.hq = "lead"; await viewHq(main, [], K); };
  form.addEventListener("submit", (ev) => {
    ev.preventDefault();
    const text = ta.value.trim();
    if (!text) return;
    log.insertAdjacentHTML("beforeend", `<div class="bubble me"><p>${esc(text)}</p></div><div class="bubble lead typing"><p>Trưởng nhóm đang xem tình hình các site…</p></div>`);
    log.scrollTop = log.scrollHeight;
    busy(ev.submitter, "Đang hỏi…", async () => {
      try { await api("/api/lead/messages", { method: "POST", body: { text } }); await again(); }
      catch (e) { $(".typing", log)?.remove(); showMsg($("#lead-msg", main), e.message); }
    });
  });
  $$("form[data-plan]", main).forEach((f) => f.addEventListener("submit", (ev) => {
    ev.preventDefault();
    const items = $$('input[name="item"]:checked', f).map((x) => Number(x.value));
    busy(ev.submitter, "Đang giao…", async () => {
      try { await api(`/api/lead/messages/${f.dataset.plan}/run`, { method: "POST", body: { items } }); await again(); }
      catch (e) { showMsg($("#lead-msg", main), e.message); }
    });
  }));
  $("#pb-form", main)?.addEventListener("submit", (ev) => {
    ev.preventDefault();
    busy(ev.submitter, "Đang lưu…", async () => {
      try { await api("/api/lead/playbook", { method: "PUT", body: { body: $("textarea", ev.currentTarget).value } }); await again(); }
      catch (e) { showMsg($("#lead-msg", main), e.message); }
    });
  });
  $$("[data-pb-add]", main).forEach((b) => b.addEventListener("click", () => busy(b, "Đang ghi…", async () => {
    try { await api("/api/lead/playbook/append", { method: "POST", body: { text: b.dataset.pbAdd } }); await again(); }
    catch (e) { showMsg($("#lead-msg", main), e.message); }
  })));
  $$("[data-pb-restore]", main).forEach((b) => b.addEventListener("click", () => busy(b, "…", async () => {
    try { await api(`/api/lead/playbook/restore/${b.dataset.pbRestore}`, { method: "POST" }); await again(); }
    catch (e) { showMsg($("#lead-msg", main), e.message); }
  })));
  $$("[data-job-run]", main).forEach((b) => b.addEventListener("click", () => busy(b, "Đang chạy…", async () => {
    try { const r = await api(`/api/lead/jobs/${b.dataset.jobRun}/run`, { method: "POST" }); if (!r.ok) showMsg($("#lead-msg", main), r.error); await again(); }
    catch (e) { showMsg($("#lead-msg", main), e.message); }
  })));
}
