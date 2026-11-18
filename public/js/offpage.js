// Off-page team: Prospects, email outreach (anh duyệt từng thư), mạng xã hội (Social Entity), cộng đồng (anh tự đăng), backlink, citations.

import { api } from "./api.js";
import { $, $$, esc, showMsg, busy, formData, ago } from "./ui.js";
import { mountManual } from "./manual.js";

const KIND = { guest_post: "Guest post", mention: "Nhắc tên chưa link", resource: "Trang tài nguyên", broken_link: "Link chết", roundup: "Bài tổng hợp", image_credit: "Ghi nguồn ảnh" };
const PST = { new: ["Mới", "info"], drafted: ["Đã soạn thư", "fmt"], contacted: ["Đã gửi", "ok"], replied: ["Đã trả lời", "ok"], won: ["Có link", "ok"], lost: ["Không được", ""], skipped: ["Bỏ", ""] };
const MST = { needs_fix: ["Cần sửa", "err"], ready: ["Chờ anh duyệt", "warn"], approved: ["Đã duyệt, chờ gửi", "info"], sent: ["Đã gửi", "ok"], replied: ["Có trả lời", "ok"], cancelled: ["Đã bỏ", ""], failed: ["Lỗi gửi", "err"], blocked: ["Bị chặn", "err"], draft: ["Nháp", ""] };
const SST = { connected: ["Đang đăng", "ok"], choose_target: ["Chọn trang để đăng", "warn"], expired: ["Hết hạn", "err"], profile: ["Chỉ sameAs", ""] };
const POST = { queued: ["Chờ đăng", "info"], posted: ["Đã đăng", "ok"], failed: ["Lỗi", "err"], blocked: ["Gác cổng chặn", "err"], skipped: ["Bỏ", ""] };
const LST = { live: ["Còn link", "ok"], nofollow: ["Nofollow", "warn"], missing: ["Mất link", "err"], error: ["Không mở được", "warn"], unchecked: ["Chưa kiểm tra", ""] };
const NET = { pinterest: "Pinterest", facebook: "Facebook Page", linkedin: "LinkedIn Page", x: "X (Twitter)", bluesky: "Bluesky", threads: "Threads", instagram: "Instagram", mastodon: "Mastodon", gmb: "Google Business Profile", youtube: "YouTube", tiktok: "TikTok", crunchbase: "Crunchbase", other: "Profile khác" };
const VIA_POSTIZ = ["threads", "instagram", "mastodon", "gmb"];
const OAUTH = ["pinterest", "facebook", "linkedin", "x"];
const tag = (x) => (x ? `<span class="tag ${x[1]}">${esc(x[0])}</span>` : "");
const probs = (list) => (list || []).map((p) => `<span class="tag ${p.level === "block" ? "err" : "warn"}">${esc(p.message)}</span>`).join(" ");
const when = (t) => (t ? esc(ago(t)) : "chưa");

function settingsHtml(d, canEdit) {
  const s = d.settings, dis = canEdit ? "" : " disabled";
  return `
  ${d.german ? `<p class="msg warn">Site Đức: không gửi email lạnh (§ 7 UWG), Prospector và Outreach không chạy cho site này. Social, cộng đồng (anh tự đăng), backlink và citations vẫn chạy.</p>` : ""}
  <div class="op-team">
    <div><b>Prospector</b><small>Lần cuối: ${when(d.state.prospectAt)}</small></div>
    <div><b>Outreach</b><small>Soạn lần cuối: ${when(d.state.draftAt)}</small></div>
    <div><b>Social Entity</b><small>Lần cuối: ${when(d.state.socialAt)}</small></div>
    <div><b>Community Scout</b><small>Lần cuối: ${when(d.state.threadsAt)}</small></div>
    <div><b>Link Monitor</b><small>Lần cuối: ${when(d.state.linksAt)}</small></div>
  </div>
  ${d.state.lastError ? `<p class="msg err">Lỗi gần nhất: ${esc(d.state.lastError)}</p>` : ""}
  ${canEdit ? `<div class="toolbar op-run">
    ${d.german ? "" : `<button type="button" data-run="prospects">Tìm nơi xin link</button><button type="button" data-run="drafts">Soạn email</button>`}
    <button type="button" data-run="threads">Tìm thread cộng đồng</button><button type="button" data-run="social">Đăng social ngay</button><button type="button" data-run="links">Kiểm tra backlink</button>
    ${d.german ? "" : `<button type="button" data-run="send">Gửi thư đã duyệt</button>`}
  </div>` : ""}
  <div class="op-index">
    <b>IndexNow</b> ${d.indexnow.verifiedAt ? tag(["Đang chạy", "ok"]) : tag(["Chưa có file khoá", "warn"])}
    <small>Báo Bing, Yandex, Seznam, Naver (và Copilot) ngay khi site có bài mới hoặc app vừa sửa trang. Google không dùng IndexNow. File khoá: <code>https://${esc(d.site.domain)}/${esc(d.indexnow.key)}.txt</code>${d.indexnow.mode ? ` (${d.indexnow.mode === "wordpress" ? "plugin WordPress" : "Worker bộ đo"})` : ""}</small>
    ${d.indexnow.lastError ? `<small class="err">${esc(d.indexnow.lastError)}</small>` : ""}
    ${canEdit ? `<button type="button" id="op-indexnow">Kiểm tra IndexNow</button>` : ""}
    ${d.indexnow.log.length ? `<details><summary>${d.indexnow.log.length} lần gửi gần nhất</summary><ul>${d.indexnow.log.map((l) => `<li>${esc(l.url)} · ${esc(l.reason || "")} · ${l.status || "lỗi"} · ${esc(ago(l.at))}</li>`).join("")}</ul></details>` : ""}
  </div>
  <form id="op-settings" class="op-form" novalidate>
    <fieldset><legend>Người gửi</legend>
      <label>Tên thương hiệu<input name="brand" value="${esc(s.brand)}"${dis}></label>
      <label>Tên người gửi (bút danh được)<input name="senderName" value="${esc(s.senderName)}" placeholder="VD: Lena Hart"${dis}></label>
      <label>Email gửi (thuộc ${esc(d.site.domain)})<input name="outreachEmail" type="email" value="${esc(s.outreachEmail)}" placeholder="hello@${esc(d.site.domain)}"${dis}></label>
      <label>Chuyển tiếp thư trả lời tới (đã xác minh ở Email Routing)<input name="forwardTo" type="email" value="${esc(s.forwardTo)}"${dis}></label>
      <label class="wide">Địa chỉ bưu chính (CAN-SPAM cho người nhận ở Mỹ)<input name="postalAddress" value="${esc(s.postalAddress)}"${dis}></label>
    </fieldset>
    <fieldset><legend>Agent tìm theo</legend>
      <label class="wide">Chủ đề (mỗi dòng một chủ đề)<textarea name="topics" rows="3"${dis}>${esc(s.topics.join("\n"))}</textarea></label>
      <label>Tên thương hiệu để tìm mention<input name="brandTerms" value="${esc(s.brandTerms.join(", "))}"${dis}></label>
      <label>Traffic tối thiểu của nơi xin link<input name="minTraffic" type="number" min="0" value="${s.minTraffic}"${dis}></label>
      <label>Tối đa email/ngày<input name="dailyCap" type="number" min="1" max="30" value="${s.dailyCap}"${dis}></label>
      <label>Follow-up sau (ngày)<input name="followupDays" type="number" min="3" max="14" value="${s.followupDays}"${dis}></label>
      <label>Tối đa bài social/mạng/ngày<input name="socialDailyCap" type="number" min="1" max="6" value="${s.socialDailyCap}"${dis}></label>
      <div class="wide checks">
        <label class="check"><input type="checkbox" name="prospecting"${s.prospecting ? " checked" : ""}${dis}> Tự tìm nơi xin link và soạn email</label>
        <label class="check"><input type="checkbox" name="social"${s.social ? " checked" : ""}${dis}> Tự đăng bài mới lên mạng xã hội</label>
        <label class="check"><input type="checkbox" name="community"${s.community ? " checked" : ""}${dis}> Tự tìm thread cộng đồng</label>
        <label class="check"><input type="checkbox" name="pinterestFresh"${s.pinterestFresh ? " checked" : ""}${dis}> Pinterest: thêm Pin mới cho bài cũ (ảnh khác, cách 7 ngày)</label>
      </div>
    </fieldset>
    ${d.site.site_type === "service" ? `<fieldset><legend>NAP thật (cho citations)</legend>
      <label>Tên doanh nghiệp<input name="nap.name" value="${esc(s.nap.name)}"${dis}></label>
      <label>Điện thoại<input name="nap.phone" value="${esc(s.nap.phone)}"${dis}></label>
      <label class="wide">Địa chỉ<input name="nap.address" value="${esc(s.nap.address)}"${dis}></label>
      <label>Thành phố<input name="nap.city" value="${esc(s.nap.city)}"${dis}></label>
    </fieldset>` : ""}
    ${canEdit ? `<div class="toolbar"><button type="submit" class="primary" id="op-save">Lưu cài đặt</button></div>` : ""}
  </form>
  ${d.german ? "" : `<details class="op-help"><summary>Dựng email gửi (Cloudflare Email Service)</summary>
    <ol>
      <li>Cloudflare › Email Service › Sending: bật tên miền <b>${esc(d.site.domain)}</b>, thêm các bản ghi SPF/DKIM/DMARC Cloudflare đưa ra. Gửi email cần gói Workers Paid.</li>
      <li>Cloudflare › tên miền › Email › Email Routing: bật (Cloudflare tự thêm bản ghi MX).</li>
      <li>Bấm <b>Dựng hộp thư</b>: app tạo quy tắc chuyển thư gửi tới địa chỉ trên về Worker <code>${esc(d.workerName)}</code> để biết ai đã trả lời và dừng follow-up. Token Cloudflare cần thêm quyền Zone › Email Routing Rules Edit.</li>
      <li>Bấm <b>Gửi thư thử</b> tới email của anh để kiểm tra.</li>
    </ol>
    ${canEdit ? `<div class="toolbar"><button type="button" id="op-mailbox">Dựng hộp thư</button><input id="op-test-to" type="email" placeholder="email nhận thư thử"><button type="button" id="op-test">Gửi thư thử</button></div><div id="op-mailbox-out"></div>` : ""}
    ${d.emailBinding ? "" : `<p class="msg warn">Worker chưa có binding EMAIL: deploy bản mới (wrangler.jsonc đã thêm send_email).</p>`}
  </details>`}`;
}

function prospectsHtml(d, canEdit) {
  if (d.german) return `<p class="note">Site Đức: không outreach email lạnh nên không tìm nơi xin link.</p>`;
  return d.prospects.length ? `<div class="tablewrap boxed"><table class="op-table"><thead><tr><th>Nơi</th><th>Loại</th><th>Traffic</th><th>Điểm</th><th>Liên hệ</th><th>Trạng thái</th><th></th></tr></thead><tbody>
    ${d.prospects.map((p) => `<tr>
      <td class="op-url"><a href="${esc(p.url)}" target="_blank" rel="noopener">${esc(p.title || p.domain)}</a><small>${esc(p.domain)} · ${esc(p.why || "")}</small>${p.dead_url ? `<small>Link chết: ${esc(p.dead_url)}</small>` : ""}${p.note ? `<small>${esc(p.note)}</small>` : ""}</td>
      <td>${esc(KIND[p.kind] || p.kind)}</td><td>${p.traffic == null ? "—" : Number(p.traffic).toLocaleString("vi-VN")}</td><td>${p.score}</td>
      <td>${p.contact_email ? esc(p.contact_email) : p.contact_page ? `<a href="${esc(p.contact_page)}" target="_blank" rel="noopener">Trang liên hệ</a>` : "—"}</td>
      <td>${tag(PST[p.status])}</td>
      <td class="op-actions">${canEdit ? `${p.status === "new" && p.contact_email ? `<button type="button" data-p-draft="${p.id}">Soạn email</button>` : ""}${["new", "drafted", "contacted", "replied"].includes(p.status) ? `<button type="button" data-p-won="${p.id}">Có link</button><button type="button" data-p-skip="${p.id}">Bỏ</button>` : ""}` : ""}</td>
    </tr>`).join("")}</tbody></table></div>` : `<p class="note">Chưa có. Bấm "Tìm nơi xin link" ở tab Team & cài đặt hoặc để agent tự chạy mỗi tuần.</p>`;
}

function mailHtml(d, canEdit) {
  const init = d.messages.filter((m) => m.kind === "initial");
  const fu = (id) => d.messages.find((m) => m.kind === "followup" && m.parent_id === id);
  const pending = init.filter((m) => ["needs_fix", "ready"].includes(m.status));
  const rest = init.filter((m) => !["needs_fix", "ready"].includes(m.status));
  const card = (m) => {
    const f = fu(m.id), rv = m.review || {};
    return `<div class="op-mail" data-mid="${m.id}">
      <div class="op-mail-head">${tag(MST[m.status])} <b>Tới:</b> ${esc(m.to_email)}${rv.target ? ` · <b>Trang đích:</b> <a href="${esc(rv.target.url)}" target="_blank" rel="noopener">${esc(rv.target.title || rv.target.url)}</a>` : ""}${rv.score != null ? ` · Reviewer ${rv.score}/100` : ""}</div>
      ${probs(rv.problems)}${(rv.issues || []).length ? `<ul class="op-issues">${rv.issues.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>` : ""}
      <label>Tiêu đề<input data-f="subject" value="${esc(m.subject)}"${canEdit ? "" : " disabled"}></label>
      <label>Nội dung<textarea data-f="body" rows="10"${canEdit ? "" : " disabled"}>${esc(m.body)}</textarea></label>
      ${f ? `<label>Follow-up (gửi sau ${d.settings.followupDays} ngày nếu chưa trả lời) ${tag(MST[f.status])}<textarea data-fu="${f.id}" rows="5"${canEdit && f.status === "draft" ? "" : " disabled"}>${esc(f.body)}</textarea></label>` : ""}
      ${canEdit ? `<div class="toolbar"><button type="button" data-m-save="${m.id}">Lưu sửa</button><button type="button" class="primary" data-m-ok="${m.id}"${m.status === "ready" ? "" : " disabled"}>Duyệt gửi</button><button type="button" class="danger" data-m-no="${m.id}">Bỏ</button>${f && f.status === "draft" ? `<button type="button" data-fu-drop="${f.id}">Bỏ follow-up</button>` : ""}</div>` : ""}
    </div>`;
  };
  return `${d.german ? `<p class="msg warn">Site Đức: không gửi email lạnh.</p>` : ""}
    <h3 class="sub">Chờ anh duyệt (${pending.length})</h3>
    ${pending.length ? pending.map(card).join("") : `<p class="note">Không có thư chờ duyệt.</p>`}
    <h3 class="sub">Đã xử lý</h3>
    ${rest.length ? `<div class="tablewrap boxed"><table><thead><tr><th>Tới</th><th>Tiêu đề</th><th>Trạng thái</th><th>Gửi</th></tr></thead><tbody>${rest.map((m) => { const f = fu(m.id); return `<tr><td>${esc(m.to_email)}</td><td>${esc(m.subject)}${m.error ? `<small>${esc(m.error)}</small>` : ""}${f ? `<small>Follow-up: ${esc((MST[f.status] || [f.status])[0])}${f.send_after && f.status === "approved" ? ` · ${new Date(f.send_after).toLocaleDateString("vi-VN")}` : ""}</small>` : ""}</td><td>${tag(MST[m.status])}</td><td>${m.sent_at ? esc(ago(m.sent_at)) : "—"}</td></tr>`; }).join("")}</tbody></table></div>` : `<p class="note">Chưa có.</p>`}
    <h3 class="sub">Thư đến</h3>
    ${d.inbox.length ? d.inbox.map((x) => `<div class="op-in${x.read ? "" : " unread"}"><b>${esc(x.from_email)}</b> · ${esc(x.subject || "(không tiêu đề)")} <small>${esc(ago(x.received_at))}${x.matched_id ? " · trả lời outreach, đã dừng follow-up" : ""}</small><p>${esc(x.snippet || "")}</p>${!x.read && canEdit ? `<button type="button" data-in-read="${x.id}">Đã đọc</button>` : ""}</div>`).join("") : `<p class="note">Chưa có thư đến. Thư trả lời về đây khi đã dựng hộp thư.</p>`}`;
}

function socialHtml(d, canEdit, origin, K_ADMIN) {
  const accs = d.accounts;
  const has = (n) => accs.find((a) => a.network === n);
  return `
  <p class="msg warn">Mỗi site một tài khoản riêng cho từng mạng. Trước khi bấm Kết nối, đăng nhập đúng tài khoản của <b>${esc(d.site.domain)}</b> trên trình duyệt (nên dùng một profile Chrome riêng cho mỗi site). App chặn nếu tài khoản, trang hoặc link profile đã gắn với site khác.</p>
  <div class="tablewrap boxed"><table><thead><tr><th>Mạng</th><th>Tài khoản</th><th>Trạng thái</th><th></th></tr></thead><tbody>
    ${Object.entries(NET).filter(([n]) => (n !== "other" || has(n)) && (n !== "gmb" || d.site.site_type === "service")).map(([n, label]) => { const a = has(n); return `<tr>
      <td><b>${esc(label)}</b>${a?.via === "postiz" ? "<small>Đăng qua Postiz</small>" : OAUTH.includes(n) ? `<small>${d.apps?.[n] ? "App developer riêng của site" : "Đang dùng app chung"}</small>` : VIA_POSTIZ.includes(n) ? "<small>Kết nối qua Postiz</small>" : n === "bluesky" ? "" : "<small>Chỉ ghi profile (sameAs)</small>"}</td>
      <td>${a ? `${a.profile_url ? `<a href="${esc(a.profile_url)}" target="_blank" rel="noopener">${esc(a.handle || a.target_name || a.profile_url)}</a>` : esc(a.handle || "")}${a.target_name ? `<small>Đăng vào: ${esc(a.target_name)}</small>` : ""}${a.error ? `<small>${esc(a.error)}</small>` : ""}` : "—"}</td>
      <td>${a ? tag(SST[a.status] || [a.status, ""]) : ""}</td>
      <td class="op-actions">${canEdit ? `${OAUTH.includes(n) && a?.via !== "postiz" ? `<a class="btn" href="/api/social/oauth/${n}/start?site=${d.site.id}">${a && a.status !== "profile" ? "Kết nối lại" : "Kết nối"}</a>` : ""}${a && a.via !== "postiz" && (a.status === "choose_target" || (OAUTH.includes(n) && a.status === "connected" && n !== "x")) ? `<button type="button" data-targets="${a.id}">${a.target_id ? "Đổi trang" : "Chọn trang"}</button>` : ""}${a ? `<button type="button" class="danger" data-acc-del="${a.id}">Gỡ</button>` : ""}` : ""}</td>
    </tr>`; }).join("")}
  </tbody></table></div>
  <div id="op-targets"></div>
  <details class="op-help"${d.postiz ? " open" : ""}><summary>Postiz (tuỳ chọn): đăng thêm Threads, Instagram, Mastodon${d.site.site_type === "service" ? ", Google Business Profile" : ""} và dùng app đã được các mạng duyệt</summary>
    <p class="note">Postiz là phần mềm lên lịch mạng xã hội mã nguồn mở: dùng Postiz Cloud (trả phí theo số kênh) hoặc tự cài. Anh kết nối tài khoản của site trong Postiz (nên mỗi site một workspace hoặc một "customer"), dán API key vào đây rồi gắn kênh. Agent vẫn soạn bài, Gác cổng vẫn kiểm; Postiz chỉ đăng. Không gắn Reddit, diễn đàn hay kênh chat.</p>
    ${K_ADMIN ? `<form id="op-postiz" class="op-form" novalidate><fieldset><legend>${d.postiz ? "Đã có API key, nhập lại để đổi" : "Kết nối Postiz cho site này"}</legend>
      <label>Địa chỉ API<input name="base" value="https://api.postiz.com/public/v1"></label>
      <label>API key<input name="key" type="password" autocomplete="off"></label>
      <div class="toolbar"><button type="submit">Lưu</button>${d.postiz ? `<button type="button" id="op-postiz-del">Gỡ Postiz</button>` : ""}</div></fieldset></form>` : ""}
    ${d.postiz && canEdit ? `<button type="button" id="op-postiz-list">Tải kênh từ Postiz</button><div id="op-postiz-items"></div>` : ""}
  </details>
  ${canEdit ? `<div class="op-two">
    <form id="op-bsky" class="op-form" novalidate><fieldset><legend>Bluesky (App Password)</legend>
      <label>Handle<input name="handle" placeholder="tensite.bsky.social"></label>
      <label>App Password<input name="app_password" type="password" autocomplete="off"></label>
      <div class="toolbar"><button type="submit">Kết nối Bluesky</button></div></fieldset></form>
    ${K_ADMIN ? `<form id="op-app" class="op-form" novalidate><fieldset><legend>App developer riêng cho site này (khuyên dùng)</legend>
      <label>Mạng<select name="network">${OAUTH.map((n) => `<option value="${n}">${esc(NET[n])}${d.apps?.[n] ? " (đã có)" : ""}</option>`).join("")}</select></label>
      <label>Client ID / App ID<input name="client_id" autocomplete="off"></label>
      <label>Client secret<input name="client_secret" type="password" autocomplete="off"></label>
      <div class="toolbar"><button type="submit">Lưu app</button><button type="button" id="op-app-del">Xoá app riêng</button></div>
      <p class="note wide">Tạo app bằng tài khoản developer của chính site đó, để các thương hiệu không chung một app. Không có app riêng thì dùng app chung ở Cài đặt › API key.</p></fieldset></form>` : ""}
    <form id="op-profile" class="op-form" novalidate><fieldset><legend>Profile chỉ để sameAs (YouTube, Instagram…)</legend>
      <label>Mạng<select name="network">${Object.entries(NET).filter(([n]) => !OAUTH.includes(n) && n !== "bluesky").map(([n, l]) => `<option value="${n}">${esc(l)}</option>`).join("")}</select></label>
      <label>Link profile<input name="profile_url" type="url" placeholder="https://www.youtube.com/@…"></label>
      <div class="toolbar"><button type="submit">Lưu profile</button></div></fieldset></form>
  </div>` : ""}
  <details class="op-help"><summary>Cách tạo app developer cho từng mạng</summary>
    <p>Redirect URI cần khai báo ở mọi app: <code>${esc(origin)}/api/social/oauth/callback</code>. Nên tạo app bằng tài khoản developer của từng site và nhập ở ô "App developer riêng" bên trên; app chung ở Cài đặt › API key chỉ là phương án dự phòng.</p>
    <ul>
      <li>Pinterest: developers.pinterest.com › My apps; quyền boards:read, pins:write. App mới ở chế độ Trial: Pin chỉ mình anh thấy cho tới khi Pinterest duyệt Standard access.</li>
      <li>Facebook Page: developers.facebook.com › tạo app Business, thêm Facebook Login; quyền pages_manage_posts. Anh là admin của Page thì đăng được ngay ở chế độ phát triển.</li>
      <li>LinkedIn Page: developer.linkedin.com › tạo app gắn với trang công ty, xin sản phẩm Community Management API (LinkedIn duyệt).</li>
      <li>X: developer.x.com › bật OAuth 2.0 (Web App, confidential client); đăng bài qua API có thể tính phí theo gói của X.</li>
      <li>YouTube: agent không làm video, nên chỉ ghi link kênh vào sameAs.</li>
    </ul>
  </details>
  <h3 class="sub">Bài đã và sẽ đăng</h3>
  ${d.posts.length ? d.posts.map((p) => `<div class="op-post">
    <div>${tag(POST[p.status])} <b>${esc(NET[p.network] || p.network)}${p.variant ? ` · Pin #${p.variant + 1}` : ""}</b> · <a href="${esc(p.source_url)}" target="_blank" rel="noopener">${esc(p.source_title || p.source_url)}</a>${p.remote_url ? ` · <a href="${esc(p.remote_url)}" target="_blank" rel="noopener">Xem bài</a>` : ""} <small>${esc(ago(p.posted_at || p.created_at))}</small></div>
    ${probs(p.gate?.problems)}${p.error ? `<p class="note err">${esc(p.error)}</p>` : ""}
    ${p.status === "posted" || !canEdit ? `<p>${esc(p.text || "")}</p>` : `<textarea data-post-text="${p.id}" rows="3">${esc(p.text || "")}</textarea><div class="toolbar"><button type="button" data-post-save="${p.id}">Lưu và xếp đăng</button>${["failed", "blocked"].includes(p.status) ? `<button type="button" data-post-retry="${p.id}">Thử lại</button>` : ""}<button type="button" data-post-skip="${p.id}">Bỏ</button></div>`}
  </div>`).join("") : `<p class="note">Chưa có. Khi site có bài mới trên sitemap, Social Entity soạn và tự đăng (bài cũ lúc kết nối không đăng lại).</p>`}
  <h3 class="sub">Schema Organization + sameAs</h3>
  <p class="note">Dán vào layout chung của site (Astro) hoặc thay schema Organization của Rank Math, để Google ghép các profile về cùng một thương hiệu.</p>
  <pre class="op-pre" id="op-ld">${esc(`<script type="application/ld+json">${JSON.stringify(d.entity, null, 2)}</script>`)}</pre>
  <button type="button" data-copy-ld>Chép</button>`;
}

function communityHtml(d, canEdit) {
  return `<p class="note">Agent không đăng. Anh đọc, sửa theo kinh nghiệm thật, rồi tự đăng bằng tài khoản thật của anh. Câu có link luôn kèm dòng công khai anh là người của site; giữ khoảng 1 câu có link trên 10 hoạt động.</p>
  ${d.threads.length ? d.threads.map((t) => `<div class="op-thread">
    <div class="op-thread-head"><div><a href="${esc(t.url)}" target="_blank" rel="noopener"><b>${esc(t.title || t.url)}</b></a><small>${esc(t.platform)} · ${esc(ago(t.found_at))}</small></div><span class="tag ${t.risk < 30 ? "ok" : t.risk < 55 ? "warn" : "err"}">Rủi ro ${t.risk}</span></div>
    <ul>${t.factors.map((f) => `<li>${esc(f)}</li>`).join("")}</ul>
    <textarea data-th="${t.id}" rows="6"${canEdit && t.status !== "posted" ? "" : " disabled"}>${esc(t.draft || "")}</textarea>
    <div class="toolbar">${t.status === "posted" ? tag(["Anh đã đăng", "ok"]) : t.status === "skipped" ? tag(["Đã bỏ", ""]) : canEdit ? `<button type="button" data-th-copy="${t.id}">Chép</button><button type="button" data-th-posted="${t.id}">Đánh dấu đã đăng</button><button type="button" data-th-skip="${t.id}">Bỏ</button>${t.risk >= 55 ? `<span class="note err">Nên bỏ qua hoặc trả lời không link</span>` : ""}` : ""}</div>
  </div>`).join("") : `<p class="note">Chưa có thread.</p>`}`;
}

function linksHtml(d, canEdit) {
  const live = d.links.filter((l) => ["live", "nofollow"].includes(l.status));
  const anchors = {};
  for (const l of live) { const a = (l.anchor || "").toLowerCase().trim() || "(ảnh/không chữ)"; anchors[a] = (anchors[a] || 0) + 1; }
  const top = Object.entries(anchors).sort((a, b) => b[1] - a[1]).slice(0, 8);
  return `${canEdit ? `<form id="op-link" class="st-add" novalidate><label>Trang có link về site<input name="source_url" type="url" placeholder="https://…" required></label><button type="submit" class="primary">Thêm để theo dõi</button></form>` : ""}
    ${top.length ? `<p class="note">Anchor: ${top.map(([a, n]) => `${esc(a)} (${Math.round((100 * n) / live.length)}%)`).join(" · ")}</p>` : ""}
    ${d.links.length ? `<div class="tablewrap boxed"><table><thead><tr><th>Trang nguồn</th><th>Trạng thái</th><th>Anchor</th><th>Kiểm tra</th><th></th></tr></thead><tbody>${d.links.map((l) => `<tr><td class="op-url"><a href="${esc(l.source_url)}" target="_blank" rel="noopener">${esc(l.source_url)}</a>${l.target_url ? `<small>→ ${esc(l.target_url)}</small>` : ""}</td><td>${tag(LST[l.status] || [l.status, ""])}</td><td>${esc(l.anchor || "—")}</td><td>${l.last_checked ? esc(ago(l.last_checked)) : "—"}</td><td>${canEdit ? `<button type="button" class="danger" data-link-del="${l.id}">Xoá</button>` : ""}</td></tr>`).join("")}</tbody></table></div>` : `<p class="note">Chưa theo dõi link nào. Link "Có link" ở Prospects tự vào đây.</p>`}`;
}

function citationsHtml(d, canEdit) {
  const n = d.settings.nap;
  if (d.site.site_type !== "service") return `<p class="note">Citations chỉ cho site dịch vụ có doanh nghiệp thật. Không tạo doanh nghiệp giả cho site affiliate hay rank &amp; rent.</p>`;
  return `${n.name && n.address && n.phone ? `<pre class="op-pre">${esc(`${n.name}\n${n.address}\n${n.phone}\nhttps://${d.site.domain}/`)}</pre><p class="note">Dùng đúng NAP này ở mọi danh bạ (giống từng ký tự).</p>` : `<p class="msg warn">Nhập NAP thật ở tab Team &amp; cài đặt trước.</p>`}
    ${canEdit ? `<button type="button" data-run="citations">Tạo danh sách danh bạ</button>` : ""}
    ${d.citations.length ? `<div class="tablewrap boxed"><table><thead><tr><th>Danh bạ</th><th>Trạng thái</th><th>Link hồ sơ</th></tr></thead><tbody>${d.citations.map((c) => `<tr><td><a href="${esc(c.url)}" target="_blank" rel="noopener">${esc(c.directory)}</a></td><td>${canEdit ? `<select data-cit="${c.id}">${[["todo", "Chưa gửi"], ["submitted", "Đã gửi, chờ xác minh"], ["live", "Đã lên"], ["skip", "Bỏ"]].map(([v, l]) => `<option value="${v}"${v === c.status ? " selected" : ""}>${l}</option>`).join("")}</select>` : esc(c.status)}</td><td>${canEdit ? `<input data-cit-url="${c.id}" type="url" value="${esc(c.listing_url || "")}" placeholder="https://…">` : esc(c.listing_url || "")}</td></tr>`).join("")}</tbody></table></div>` : ""}`;
}

export async function viewOffpage(main, args, K) {
  const canEdit = K.state.user.role !== "viewer";
  const list = await api("/api/offpage");
  if (!list.sites.length) { main.innerHTML = `<div class="page"><div class="page-head"><div><h2>Off-page team</h2></div></div><div class="card"><p class="note">Chưa có site. Thêm site ở menu Site trước.</p></div></div>`; return; }
  const last = String(args[args.length - 1] || "");
  const query = new URLSearchParams(last.includes("?") ? last.split("?")[1] : "");
  const clean = args.map((a) => String(a).split("?")[0]);
  const siteId = Number(clean[0]) || K.state.offpageSite || list.sites[0].id;
  const TABMAP = { prospects: "prospects", mail: "mail", backlinks: "links", citations: "citations", linkfind: "prospects", entity: "social" };
  const preset = clean[1] || TABMAP[K.item?.id] || null;
  if (preset) K.state.tabs.op = preset;
  K.state.offpageSite = siteId;
  const d = await api(`/api/offpage/${siteId}`);
  const pending = d.messages.filter((m) => m.status === "ready" || m.status === "needs_fix").length;
  main.innerHTML = `
  <div class="page">
    <div class="page-head"><div><h2>Off-page team</h2><p>Việc an toàn thì agent tự làm (tìm nơi xin link, đăng bài mới lên mạng xã hội, kiểm tra backlink). Việc với người thật thì agent soạn, anh duyệt (email) hoặc anh tự làm (Reddit/Quora). Không mua link, không đổi link.</p></div>
      <div class="toolbar"><select id="op-site" aria-label="Site">${list.sites.map((s) => `<option value="${s.id}"${s.id === siteId ? " selected" : ""}>${esc(s.domain)}${s.approvals ? ` (${s.approvals} thư chờ)` : ""}</option>`).join("")}</select></div></div>
    <div class="msg" id="op-msg" hidden></div>
    <div class="card tabbed">
      ${K.tabsNav("op", [["team", "Team & cài đặt", "users"], ["prospects", `Prospects (${d.prospects.filter((p) => p.status === "new").length})`, "search"], ["mail", `Email${pending ? ` (${pending})` : ""}`, "pen"], ["social", "Mạng xã hội", "globe"], ["community", `Cộng đồng (${d.threads.filter((t) => t.status === "drafted").length})`, "users"], ["manual", "Làm tay", "bolt"], ["links", "Backlink", "link"], ["citations", "Citations", "list"]], "team")}
      <div class="tab-body" ${K.panelAttr("op", "team", "team")}>${settingsHtml(d, canEdit)}</div>
      <div class="tab-body" ${K.panelAttr("op", "prospects", "team")}>${prospectsHtml(d, canEdit)}</div>
      <div class="tab-body" ${K.panelAttr("op", "mail", "team")}>${mailHtml(d, canEdit)}</div>
      <div class="tab-body" ${K.panelAttr("op", "social", "team")}>${socialHtml(d, canEdit, location.origin, K.state.user.role === "admin")}</div>
      <div class="tab-body" ${K.panelAttr("op", "community", "team")}>${communityHtml(d, canEdit)}</div>
      <div class="tab-body" id="op-manual" ${K.panelAttr("op", "manual", "team")}><p class="note">Đang tải…</p></div>
      <div class="tab-body" ${K.panelAttr("op", "links", "team")}>${linksHtml(d, canEdit)}</div>
      <div class="tab-body" ${K.panelAttr("op", "citations", "team")}>${citationsHtml(d, canEdit)}</div>
    </div>
  </div>`;
  K.bindTabs(main, "op");
  const msgEl = $("#op-msg", main);
  const msg = (e, ok) => showMsg(msgEl, ok || e.message, ok ? "ok" : "err");
  if (query.get("msg")) msg(null, query.get("msg"));
  mountManual($("#op-manual", main), siteId, canEdit, (e, ok) => { msg(e, ok); msgEl.scrollIntoView({ block: "nearest" }); });
  const reload = () => viewOffpage(main, [String(siteId)], K);
  const put = async (url, body, okText) => { try { await api(url, { method: "PUT", body }); await reload(); if (okText) msg(null, okText); } catch (e) { msg(e); } };
  $("#op-site", main).addEventListener("change", (e) => { location.hash = `#/offpage/${e.target.value}`; });
  $$("[data-run]", main).forEach((b) => b.addEventListener("click", () => busy(b, "Đang chạy…", async () => {
    try {
      const r = await api(`/api/offpage/${siteId}/run`, { method: "POST", body: { what: b.dataset.run } });
      await reload();
      msg(null, r.note || Object.entries(r).filter(([, v]) => typeof v === "number").map(([k, v]) => `${({ found: "mới", skipped: "bỏ", drafted: "đã soạn", sent: "đã gửi", failed: "lỗi", live: "còn", lost: "mất", checked: "đã kiểm tra", added: "thêm", newUrls: "bài mới", queued: "chờ đăng", posted: "đã đăng" })[k] || k}: ${v}`).join(", ") || "Xong.");
    } catch (e) { msg(e); }
  })));
  $("#op-settings", main)?.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const f = formData(ev.target);
    const el = ev.target.elements;
    const body = { brand: f.brand, senderName: f.senderName, outreachEmail: f.outreachEmail, forwardTo: f.forwardTo, postalAddress: f.postalAddress, topics: f.topics, brandTerms: f.brandTerms, minTraffic: f.minTraffic, dailyCap: f.dailyCap, followupDays: f.followupDays, socialDailyCap: f.socialDailyCap, prospecting: el.prospecting.checked, social: el.social.checked, community: el.community.checked, pinterestFresh: el.pinterestFresh.checked, nap: { name: f["nap.name"], phone: f["nap.phone"], address: f["nap.address"], city: f["nap.city"] } };
    await busy($("#op-save", main), "Đang lưu…", async () => { await put(`/api/offpage/${siteId}/settings`, body, "Đã lưu."); });
  });
  $("#op-mailbox", main)?.addEventListener("click", (ev) => busy(ev.currentTarget, "Đang dựng…", async () => {
    try { const r = await api(`/api/offpage/${siteId}/mailbox`, { method: "POST" }); $("#op-mailbox-out", main).innerHTML = `<ul class="op-steps">${r.steps.map((s) => `<li class="${s.ok ? "ok" : "warn"}">${esc(s.message)}</li>`).join("")}</ul>`; } catch (e) { msg(e); }
  }));
  $("#op-test", main)?.addEventListener("click", (ev) => busy(ev.currentTarget, "Đang gửi…", async () => {
    try { await api(`/api/offpage/${siteId}/test-email`, { method: "POST", body: { to: $("#op-test-to", main).value } }); msg(null, "Đã gửi thư thử, anh kiểm tra hộp thư (cả mục Spam)."); } catch (e) { msg(e); }
  }));
  // Prospects
  $$("[data-p-draft]", main).forEach((b) => b.addEventListener("click", () => busy(b, "Đang soạn…", async () => { try { const r = await api(`/api/offpage/prospects/${b.dataset.pDraft}`, { method: "PUT", body: { draft: true } }); K.state.tabs.op = "mail"; await reload(); msg(null, r.drafted ? "Đã soạn, xem ở tab Email." : "Không soạn được: nơi này đã bị bỏ (xem ghi chú)."); } catch (e) { msg(e); } })));
  $$("[data-p-skip]", main).forEach((b) => b.addEventListener("click", () => put(`/api/offpage/prospects/${b.dataset.pSkip}`, { status: "skipped" })));
  $$("[data-p-won]", main).forEach((b) => b.addEventListener("click", () => {
    const td = b.closest("td");
    td.innerHTML = `<input type="url" placeholder="Link trang đã đặt link (bỏ trống nếu là trang này)" class="op-won-url"><button type="button" class="primary">Lưu</button>`;
    td.querySelector("button").addEventListener("click", () => put(`/api/offpage/prospects/${b.dataset.pWon}`, { status: "won", link_url: td.querySelector("input").value }, "Đã ghi, Link Monitor sẽ kiểm tra hằng tuần."));
  }));
  // Email
  const mailVals = (id) => { const c = main.querySelector(`[data-mid="${id}"]`); return { subject: c.querySelector('[data-f="subject"]').value, body: c.querySelector('[data-f="body"]').value, fu: c.querySelector("[data-fu]") }; };
  const saveMail = async (id) => {
    const v = mailVals(id);
    const r = await api(`/api/offpage/messages/${id}`, { method: "PUT", body: { subject: v.subject, body: v.body } });
    if (v.fu && !v.fu.disabled) await api(`/api/offpage/messages/${v.fu.dataset.fu}`, { method: "PUT", body: { body: v.fu.value } });
    return r;
  };
  $$("[data-m-save]", main).forEach((b) => b.addEventListener("click", () => busy(b, "Đang lưu…", async () => { try { const r = await saveMail(b.dataset.mSave); await reload(); msg(r.status === "ready" ? null : { message: "Đã lưu, thư vẫn còn lỗi chặn." }, r.status === "ready" ? "Đã lưu, thư sẵn sàng để duyệt." : ""); } catch (e) { msg(e); } })));
  $$("[data-m-ok]", main).forEach((b) => b.addEventListener("click", () => busy(b, "Đang duyệt…", async () => { try { await saveMail(b.dataset.mOk); await api(`/api/offpage/messages/${b.dataset.mOk}`, { method: "PUT", body: { action: "approve" } }); await reload(); msg(null, "Đã duyệt: thư được gửi ở lượt chạy tới (giãn thư, theo trần mỗi ngày)."); } catch (e) { msg(e); } })));
  $$("[data-m-no]", main).forEach((b) => b.addEventListener("click", () => put(`/api/offpage/messages/${b.dataset.mNo}`, { action: "reject" })));
  $$("[data-fu-drop]", main).forEach((b) => b.addEventListener("click", () => put(`/api/offpage/messages/${b.dataset.fuDrop}`, { action: "drop_followup" })));
  $$("[data-in-read]", main).forEach((b) => b.addEventListener("click", () => put(`/api/offpage/inbox/${b.dataset.inRead}`, {})));
  // Social
  $$("[data-targets]", main).forEach((b) => b.addEventListener("click", () => busy(b, "Đang tải…", async () => {
    try {
      const r = await api(`/api/social/accounts/${b.dataset.targets}/targets`);
      const box = $("#op-targets", main);
      box.innerHTML = r.items.length ? `<div class="toolbar"><select id="op-target-sel">${r.items.map((x) => `<option value="${esc(x.id)}" data-name="${esc(x.name)}" data-url="${esc(x.url || "")}">${esc(x.name)}</option>`).join("")}</select><button type="button" class="primary" id="op-target-save">Đăng vào trang này</button></div>` : `<p class="note">Không thấy trang/board nào anh quản lý.</p>`;
      $("#op-target-save", box)?.addEventListener("click", () => { const o = $("#op-target-sel", box).selectedOptions[0]; put(`/api/social/accounts/${b.dataset.targets}`, { target_id: o.value, target_name: o.dataset.name, profile_url: o.dataset.url }, "Đã chọn trang để đăng."); });
    } catch (e) { msg(e); }
  })));
  $$("[data-acc-del]", main).forEach((b) => b.addEventListener("click", async () => { try { await api(`/api/social/accounts/${b.dataset.accDel}`, { method: "DELETE" }); await reload(); } catch (e) { msg(e); } }));
  $("#op-bsky", main)?.addEventListener("submit", async (ev) => { ev.preventDefault(); const f = formData(ev.target); try { await api(`/api/social/${siteId}/accounts`, { method: "POST", body: { network: "bluesky", handle: f.handle, app_password: f.app_password } }); await reload(); msg(null, "Đã kết nối Bluesky."); } catch (e) { msg(e); } });
  $("#op-indexnow", main)?.addEventListener("click", (ev) => busy(ev.currentTarget, "Đang kiểm tra…", async () => { try { const r = await api(`/api/offpage/${siteId}/indexnow`, { method: "POST" }); await reload(); msg(r.ok ? null : { message: r.message }, r.ok ? r.message : ""); } catch (e) { msg(e); } }));
  $("#op-postiz", main)?.addEventListener("submit", async (ev) => { ev.preventDefault(); const f = formData(ev.target); try { await api(`/api/social/${siteId}/postiz`, { method: "PUT", body: { base: f.base, key: f.key } }); K.state.tabs.op = "social"; await reload(); msg(null, "Đã lưu Postiz. Bấm Tải kênh từ Postiz để gắn kênh."); } catch (e) { msg(e); } });
  $("#op-postiz-del", main)?.addEventListener("click", async () => { try { await api(`/api/social/${siteId}/postiz`, { method: "PUT", body: { key: null } }); await reload(); } catch (e) { msg(e); } });
  $("#op-postiz-list", main)?.addEventListener("click", (ev) => busy(ev.currentTarget, "Đang tải…", async () => {
    try {
      const r = await api(`/api/social/${siteId}/postiz/integrations`);
      const box = $("#op-postiz-items", main);
      box.innerHTML = r.items.length ? `<div class="tablewrap boxed"><table><thead><tr><th>Kênh</th><th>Mạng</th><th></th></tr></thead><tbody>${r.items.map((i, k) => `<tr><td>${esc(i.name)}${i.customer ? `<small>Customer: ${esc(i.customer)}</small>` : ""}${i.linkedSite && i.linkedSite !== siteId ? `<small class="err">Đang gắn với site khác</small>` : ""}</td><td>${esc(NET[i.network] || i.identifier)}</td><td>${i.allowed ? `${i.network === "pinterest" ? `<input data-pz-board="${k}" placeholder="ID board Pinterest">` : ""}<button type="button" data-pz="${k}">Gắn vào site</button>` : `<small>Không dùng (không tự đăng kênh này)</small>`}</td></tr>`).join("")}</tbody></table></div>` : `<p class="note">Workspace Postiz chưa có kênh nào.</p>`;
      $$("[data-pz]", box).forEach((b) => b.addEventListener("click", async () => { const i = r.items[Number(b.dataset.pz)]; try { await api(`/api/social/${siteId}/postiz/link`, { method: "POST", body: { integration_id: i.id, identifier: i.identifier, name: i.name, board: box.querySelector(`[data-pz-board="${b.dataset.pz}"]`)?.value } }); K.state.tabs.op = "social"; await reload(); msg(null, `Đã gắn ${i.name}.`); } catch (e) { msg(e); } }));
    } catch (e) { msg(e); }
  }));
  $("#op-app", main)?.addEventListener("submit", async (ev) => { ev.preventDefault(); const f = formData(ev.target); try { await api(`/api/social/${siteId}/app`, { method: "PUT", body: { network: f.network, client_id: f.client_id, client_secret: f.client_secret } }); K.state.tabs.op = "social"; await reload(); msg(null, "Đã lưu app riêng cho site."); } catch (e) { msg(e); } });
  $("#op-app-del", main)?.addEventListener("click", async () => { try { await api(`/api/social/${siteId}/app`, { method: "PUT", body: { network: $("#op-app", main).elements.network.value, client_id: null, client_secret: null } }); await reload(); msg(null, "Đã xoá app riêng: site dùng app chung."); } catch (e) { msg(e); } });
  $("#op-profile", main)?.addEventListener("submit", async (ev) => { ev.preventDefault(); const f = formData(ev.target); try { await api(`/api/social/${siteId}/accounts`, { method: "POST", body: { network: f.network, profile_url: f.profile_url } }); await reload(); msg(null, "Đã lưu profile."); } catch (e) { msg(e); } });
  $$("[data-post-save]", main).forEach((b) => b.addEventListener("click", () => put(`/api/social/posts/${b.dataset.postSave}`, { text: main.querySelector(`[data-post-text="${b.dataset.postSave}"]`).value }, "Đã lưu.")));
  $$("[data-post-retry]", main).forEach((b) => b.addEventListener("click", () => put(`/api/social/posts/${b.dataset.postRetry}`, { action: "retry" })));
  $$("[data-post-skip]", main).forEach((b) => b.addEventListener("click", () => put(`/api/social/posts/${b.dataset.postSkip}`, { action: "skip" })));
  main.querySelector("[data-copy-ld]")?.addEventListener("click", async (ev) => { try { await navigator.clipboard.writeText($("#op-ld", main).textContent); ev.target.textContent = "Đã chép"; } catch { msg({ message: "Không chép được: bôi đen để chép tay." }); } });
  // Cộng đồng
  $$("[data-th-copy]", main).forEach((b) => b.addEventListener("click", async () => { try { await navigator.clipboard.writeText(main.querySelector(`[data-th="${b.dataset.thCopy}"]`).value); b.textContent = "Đã chép"; } catch { msg({ message: "Không chép được: bôi đen để chép tay." }); } }));
  $$("[data-th-posted]", main).forEach((b) => b.addEventListener("click", () => put(`/api/offpage/threads/${b.dataset.thPosted}`, { status: "posted", draft: main.querySelector(`[data-th="${b.dataset.thPosted}"]`).value })));
  $$("[data-th-skip]", main).forEach((b) => b.addEventListener("click", () => put(`/api/offpage/threads/${b.dataset.thSkip}`, { status: "skipped" })));
  // Backlink, citations
  $("#op-link", main)?.addEventListener("submit", async (ev) => { ev.preventDefault(); try { await api(`/api/offpage/${siteId}/links`, { method: "POST", body: { source_url: ev.target.elements.source_url.value } }); await reload(); } catch (e) { msg(e); } });
  $$("[data-link-del]", main).forEach((b) => b.addEventListener("click", async () => { try { await api(`/api/offpage/links/${b.dataset.linkDel}`, { method: "DELETE" }); await reload(); } catch (e) { msg(e); } }));
  $$("[data-cit]", main).forEach((s) => s.addEventListener("change", () => put(`/api/offpage/citations/${s.dataset.cit}`, { status: s.value })));
  $$("[data-cit-url]", main).forEach((i) => i.addEventListener("change", () => put(`/api/offpage/citations/${i.dataset.citUrl}`, { listing_url: i.value })));
}
