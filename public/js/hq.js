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
  const [hq, prompts, spend] = await Promise.all([api("/api/hq"), api("/api/manager/prompts"), api("/api/manager/spend")]);
  const admin = K.state.user.role === "admin";
  main.innerHTML = `
  <div class="page">
    <div class="page-head"><div><h2>Agent HQ</h2><p>Đội agent làm việc cho các site của anh. Mọi prompt phải được Quản lý duyệt, mọi lần gọi AI và DataForSEO đều được kiểm trần chi phí và ghi lại.</p></div>
      <div class="toolbar"><button type="button" id="hq-refresh">${K.icon(K.ICON.clock)}Làm mới</button></div></div>
    ${hq.manager.promptsPending ? `<div class="msg warn">${hq.manager.promptsPending} prompt chưa được duyệt: agent dùng prompt đó sẽ bị chặn. ${admin ? `<a href="#/hq/prompts" data-tab-go="prompts">Duyệt ngay</a>` : "Nhờ admin duyệt."}</div>` : ""}
    <div class="card tabbed">
      ${K.tabsNav("hq", [["team", "Đội agent", "users"], ["prompts", `Quản lý prompt${hq.manager.promptsPending ? ` (${hq.manager.promptsPending})` : ""}`, "shield"], ["spend", "Chi tiêu", "money"], ["auto", "Tự động", "clock"]], "team")}
      <div class="tab-body" ${K.panelAttr("hq", "team", "team")}>${teamHtml(hq, spend)}</div>
      <div class="tab-body" ${K.panelAttr("hq", "prompts", "team")}>${promptsHtml(prompts.prompts, admin)}</div>
      <div class="tab-body" ${K.panelAttr("hq", "spend", "team")}>${spendHtml(spend)}</div>
      <div class="tab-body" ${K.panelAttr("hq", "auto", "team")}>${autoHtml(hq)}</div>
    </div>
  </div>`;
  K.bindTabs(main, "hq");
  $("#hq-refresh").addEventListener("click", () => viewHq(main, [], K));
  $$("[data-tab-go]", main).forEach((a) => a.addEventListener("click", (e) => { e.preventDefault(); $(`[data-tab-key="${a.dataset.tabGo}"]`, main).click(); }));
  $$("[data-review]", main).forEach((b) => b.addEventListener("click", () => busy(b, "Đang lưu…", async () => {
    try { await api(`/api/manager/prompts/${b.dataset.id}`, { method: "PUT", body: { status: b.dataset.review } }); K.state.tabs.hq = "prompts"; await viewHq(main, [], K); }
    catch (e) { showMsg($("#prompt-msg"), e.message); }
  })));
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
    const agents = key === "manager" ? [manager] : key === "auto" ? [auto] : hq.zones[key];
    return `<section class="zone z-${key}"><header><b>${esc(title)}</b><small>${esc(desc)}</small></header><div class="zone-grid">${agents.map((a) => agentCard(a, key === "recovery" ? "#/recovery" : key === "content" ? "#/recovery" : key === "manager" ? "#/hq/prompts" : null)).join("")}</div></section>`;
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
