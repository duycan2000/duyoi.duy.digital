// Duy Ơi · khởi động, định tuyến, các màn của giai đoạn 1.

import { api, ApiError } from "./api.js";
import { MENU, ITEMS, PHASES } from "./menu.js";
import { $, $$, esc, fmtTime, ago, showMsg, busy, formData } from "./ui.js";

const app = $("#app");
const state = { user: null, appName: "Duy Ơi", paused: false };

const PLATFORM = { astro: "Astro", wordpress: "WordPress", woocommerce: "WooCommerce" };
const SITE_TYPE = { service: "Dịch vụ (lead)", rank_rent: "Rank & rent", affiliate: "Affiliate", adsense: "AdSense", ecommerce: "Thương mại điện tử" };

// ---------------- Khởi động ----------------

async function boot() {
  try {
    const status = await api("/api/setup/status");
    state.appName = status.appName || "Duy Ơi";
    document.title = state.appName;
    if (status.needsSetup) return renderSetup(status);
    try {
      const me = await api("/api/auth/me");
      state.user = me.user;
      renderShell();
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) return renderLogin();
      throw e;
    }
  } catch (e) {
    app.innerHTML = `<div class="auth"><div class="auth-card"><b>Không kết nối được máy chủ</b><p class="lead">${esc(e.message)}</p><button type="button" id="retry">Thử lại</button></div></div>`;
    $("#retry").addEventListener("click", boot);
  }
}

window.addEventListener("duyoi:unauthorized", () => { state.user = null; renderLogin("Phiên đăng nhập đã hết. Anh đăng nhập lại nhé."); });

// ---------------- Tạo admin đầu tiên ----------------

function renderSetup(status) {
  app.innerHTML = `
  <div class="auth"><div class="auth-card">
    <div class="logo"><img src="/favicon.svg" alt=""><b>${esc(state.appName)}</b></div>
    <h2>Tạo tài khoản admin</h2>
    <p class="lead">Lần đầu chạy app. Tài khoản này có toàn quyền; sau khi tạo xong, màn hình này sẽ không còn nữa.</p>
    ${status.setupTokenConfigured ? "" : `<div class="msg warn">Worker chưa có <code>SETUP_TOKEN</code>. Chạy <code>npx wrangler secret put SETUP_TOKEN</code> (ít nhất 12 ký tự) rồi tải lại trang.</div>`}
    <form id="setup-form" novalidate>
      <label>Mã cài đặt (SETUP_TOKEN)
        <input name="setupToken" type="password" autocomplete="off" required>
      </label>
      <label>Tên hiển thị
        <input name="name" autocomplete="name" required minlength="2" maxlength="80">
      </label>
      <label>Email
        <input name="email" type="email" autocomplete="email" required>
      </label>
      <label>Mật khẩu (ít nhất 10 ký tự)
        <input name="password" type="password" autocomplete="new-password" required minlength="10">
      </label>
      <label>Nhập lại mật khẩu
        <input name="password2" type="password" autocomplete="new-password" required minlength="10">
      </label>
      <div class="msg" id="setup-msg" hidden></div>
      <button class="primary" type="submit"${status.setupTokenConfigured ? "" : " disabled"}>Tạo admin và vào app</button>
    </form>
    <p class="note mt">Mã cài đặt chỉ có người deploy biết, để người lạ mở được trang này cũng không tạo được admin.</p>
  </div></div>`;
  const form = $("#setup-form");
  form.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const d = formData(form);
    const msg = $("#setup-msg");
    if (d.password !== d.password2) return showMsg(msg, "Hai lần nhập mật khẩu không khớp.");
    await busy(form.querySelector("button[type=submit]"), "Đang tạo…", async () => {
      try {
        const res = await api("/api/setup", { method: "POST", body: { setupToken: d.setupToken, name: d.name, email: d.email, password: d.password } });
        state.user = res.user;
        location.hash = "#/overview";
        renderShell();
      } catch (e) {
        if (e.code === "already_setup") return renderLogin("Đã có admin. Anh đăng nhập nhé.");
        showMsg(msg, e.message);
      }
    });
  });
}

// ---------------- Đăng nhập ----------------

function renderLogin(notice = "") {
  app.innerHTML = `
  <div class="auth"><div class="auth-card">
    <div class="logo"><img src="/favicon.svg" alt=""><b>${esc(state.appName)}</b></div>
    <h2>Đăng nhập</h2>
    <p class="lead">Nền tảng AI agent làm SEO, AEO, GEO cho các site của anh.</p>
    <form id="login-form" novalidate>
      <label>Email <input name="email" type="email" autocomplete="username" required></label>
      <label>Mật khẩu <input name="password" type="password" autocomplete="current-password" required></label>
      <div class="msg ${notice ? "warn" : ""}" id="login-msg" ${notice ? "" : "hidden"}>${esc(notice)}</div>
      <button class="primary" type="submit">Đăng nhập</button>
    </form>
  </div></div>`;
  const form = $("#login-form");
  form.email.focus();
  form.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const d = formData(form);
    await busy(form.querySelector("button[type=submit]"), "Đang đăng nhập…", async () => {
      try {
        const res = await api("/api/auth/login", { method: "POST", body: { email: d.email, password: d.password } });
        state.user = res.user;
        renderShell();
      } catch (e) {
        showMsg($("#login-msg"), e.message);
      }
    });
  });
}

// ---------------- Khung app ----------------

// Thanh dưới cùng trên điện thoại: các màn dùng nhiều nhất + nút mở toàn bộ menu
const TABBAR = [["overview", "Tổng quan", "M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"], ["sites", "Site", "M3 5h18v14H3zM3 9h18"], ["activity", "Nhật ký", "M5 4h14v16H5zM8 8h8M8 12h8M8 16h5"], ["settings", "Cài đặt", "M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"]];
const icon = (d) => `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${d}"/></svg>`;

function renderShell() {
  app.innerHTML = `
  <div class="shell">
    <header class="topbar">
      <a class="brand" href="#/overview"><img src="/favicon.svg" alt=""><b>${esc(state.appName)}</b></a>
      <span class="pill" id="sys-pill"><i></i><span>Đang chạy</span></span>
      <span class="who">${esc(state.user.name)} · ${esc(state.user.email)}</span>
      <button type="button" class="logout-top" data-logout>Đăng xuất</button>
    </header>
    <div class="scrim" id="scrim" hidden></div>
    <nav class="side" id="side" aria-label="Menu chính">
      <div class="side-head"><b>Menu</b><button type="button" class="icon-btn" id="side-close" aria-label="Đóng menu">✕</button></div>
      ${MENU.map((g) => `<div class="group"><p>${esc(g.group)}</p>${g.items.map((i) => `<a href="#/${i.id}" data-view="${i.id}">${esc(i.label)}${i.live ? "" : `<span class="soon">GĐ${i.phase}</span>`}</a>`).join("")}</div>`).join("")}
      <div class="side-foot"><small>${esc(state.user.name)} · ${esc(state.user.email)}</small><button type="button" data-logout>Đăng xuất</button></div>
    </nav>
    <main class="main" id="main" tabindex="-1"></main>
    <nav class="tabbar" aria-label="Lối tắt">
      ${TABBAR.map(([id, label, d]) => `<a href="#/${id}" data-tab="${id}">${icon(d)}<span>${esc(label)}</span></a>`).join("")}
      <button type="button" id="menu-btn" aria-controls="side" aria-expanded="false">${icon("M4 6h16M4 12h16M4 18h16")}<span>Menu</span></button>
    </nav>
  </div>`;
  $$("[data-logout]").forEach((b) => b.addEventListener("click", async () => {
    try { await api("/api/auth/logout", { method: "POST" }); } catch { /* vẫn về màn đăng nhập */ }
    state.user = null;
    document.body.classList.remove("menu-open");
    renderLogin();
  }));
  $("#menu-btn").addEventListener("click", () => toggleMenu(true));
  $("#side-close").addEventListener("click", () => toggleMenu(false));
  $("#scrim").addEventListener("click", () => toggleMenu(false));
  $$(".side a").forEach((a) => a.addEventListener("click", () => toggleMenu(false)));
  document.onkeydown = (e) => { if (e.key === "Escape" && document.body.classList.contains("menu-open")) toggleMenu(false); };
  window.onhashchange = route;
  route();
}

function toggleMenu(open) {
  const side = $("#side");
  if (!side) return;
  side.classList.toggle("open", open);
  $("#scrim").hidden = !open;
  $("#menu-btn").setAttribute("aria-expanded", String(open));
  document.body.classList.toggle("menu-open", open);
  if (open) {
    const cur = $(".side a.on");
    (cur || $("#side-close")).focus({ preventScroll: true });
    if (cur) cur.scrollIntoView({ block: "center" });
  } else if (side.contains(document.activeElement)) {
    $("#menu-btn").focus({ preventScroll: true });
  }
}

function setPill(paused) {
  state.paused = paused;
  const pill = $("#sys-pill");
  if (!pill) return;
  pill.classList.toggle("paused", paused);
  pill.querySelector("span").textContent = paused ? "Đang tạm dừng" : "Đang chạy";
}

function route() {
  if (!state.user) return;
  const parts = (location.hash.replace(/^#\/?/, "") || "overview").split("/");
  const view = ITEMS[parts[0]] ? parts[0] : "overview";
  $$(".side a").forEach((a) => a.classList.toggle("on", a.dataset.view === view));
  const inBar = TABBAR.some(([id]) => id === view);
  $$(".tabbar a").forEach((a) => a.classList.toggle("on", a.dataset.tab === view));
  const mb = $("#menu-btn");
  if (mb) mb.classList.toggle("on", !inBar);
  const main = $("#main");
  main.innerHTML = `<div class="page"><p class="note">Đang tải…</p></div>`;
  const views = { overview: viewOverview, sites: viewSites, settings: viewSettings, account: viewAccount, activity: viewActivity };
  const fn = views[view] || viewSoon;
  Promise.resolve(fn(main, parts.slice(1), ITEMS[view])).catch((e) => {
    main.innerHTML = `<div class="page"><div class="msg err">${esc(e.message)}</div></div>`;
  });
  main.focus({ preventScroll: true });
  window.scrollTo(0, 0);
}

// ---------------- Tổng quan ----------------

async function viewOverview(main) {
  const [d, act] = await Promise.all([api("/api/dashboard"), api("/api/activity?limit=8")]);
  setPill(d.paused);
  const spend = (p) => (d.spendThisMonth[p] || 0).toFixed(2);
  const done = d.checklist.filter((c) => c.done).length;
  main.innerHTML = `
  <div class="page">
    <div class="page-head">
      <div><h2>Tổng quan</h2><p>Xin chào ${esc(state.user.name)}. Đây là bản thật: chưa có dữ liệu cho tới khi anh thêm site và nhập API key.</p></div>
      <div class="toolbar">${state.user.role === "admin" ? `<button type="button" id="pause">${d.paused ? "Chạy lại agent" : "Tạm dừng toàn bộ"}</button>` : ""}</div>
    </div>
    <div class="kpis">
      <div class="kpi"><b>${d.sites.total}</b><small>site đang theo dõi</small></div>
      <div class="kpi"><b>${(d.jobs.queued || 0) + (d.jobs.running || 0)}</b><small>việc trong hàng đợi</small></div>
      <div class="kpi"><b>$${spend("openrouter")} / $${esc(d.caps.openrouter)}</b><small>OpenRouter tháng này / trần</small></div>
      <div class="kpi"><b>$${spend("dataforseo")} / $${esc(d.caps.dataforseo)}</b><small>DataForSEO tháng này / trần</small></div>
      <div class="kpi"><b class="sm">${esc(ago(d.cronLastRun))}</b><small>cron chạy lần cuối</small></div>
    </div>
    <div class="grid2">
      <div class="card"><h3>Bắt đầu (${done}/${d.checklist.length})</h3>
        <div class="checklist">${d.checklist.map((c) => `<div class="${c.done ? "done" : ""}"><i></i><span>${esc(c.label)}</span></div>`).join("")}</div>
        <div class="toolbar"><a class="btn" href="#/settings">Mở Cài đặt</a><a class="btn" href="#/sites/new">Thêm site</a></div>
      </div>
      <div class="card"><h3>Hoạt động gần đây</h3>
        ${act.activity.length ? `<div class="activity">${act.activity.map(actRow).join("")}</div>` : `<p class="note">Chưa có hoạt động.</p>`}
        <a href="#/activity">Xem toàn bộ nhật ký</a>
      </div>
    </div>
  </div>`;
  const btn = $("#pause");
  if (btn) btn.addEventListener("click", () => busy(btn, "Đang lưu…", async () => {
    await api("/api/system/pause", { method: "POST", body: { paused: !d.paused } });
    route();
  }));
}

const actRow = (a) => `<div><time>${esc(fmtTime(a.at))}</time><span>${esc(a.detail || a.action)}${a.site ? ` · <b>${esc(a.site)}</b>` : ""}</span></div>`;

// ---------------- Site ----------------

async function viewSites(main, args) {
  if (args[0] === "new") return siteForm(main, null);
  if (args[0]) {
    const { site } = await api(`/api/sites/${encodeURIComponent(args[0])}`);
    return siteForm(main, site);
  }
  const { sites } = await api("/api/sites");
  main.innerHTML = `
  <div class="page">
    <div class="page-head">
      <div><h2>Site</h2><p>Các site anh đã dựng (bằng Claude) và muốn agent làm SEO. App không dựng hay đổi thiết kế site.</p></div>
      <div class="toolbar"><a class="btn primary" href="#/sites/new">+ Thêm site</a></div>
    </div>
    <div class="card">
      ${sites.length ? `<div class="tablewrap"><table>
        <thead><tr><th>Site</th><th>Nền tảng</th><th>Loại</th><th>Thị trường</th><th>Trạng thái</th></tr></thead>
        <tbody>${sites.map((s) => `<tr class="click" data-id="${s.id}" tabindex="0">
          <td><b>${esc(s.name)}</b><small>${esc(s.domain)}</small></td>
          <td>${esc(PLATFORM[s.platform] || s.platform)}</td>
          <td>${esc(SITE_TYPE[s.siteType] || s.siteType)}</td>
          <td>${esc(s.market)} · ${esc(s.language)}</td>
          <td><span class="tag ${s.status === "active" ? "ok" : "warn"}">${s.status === "active" ? "Đang chạy" : "Tạm dừng"}</span></td></tr>`).join("")}</tbody>
      </table></div>`
      : `<div class="empty"><b>Chưa có site nào</b><span>Thêm site đầu tiên để agent bắt đầu làm việc.</span><a class="btn" href="#/sites/new">+ Thêm site</a></div>`}
    </div>
  </div>`;
  $$("tr.click", main).forEach((tr) => {
    const open = () => { location.hash = `#/sites/${tr.dataset.id}`; };
    tr.addEventListener("click", open);
    tr.addEventListener("keydown", (e) => { if (e.key === "Enter") open(); });
  });
}

function siteForm(main, site) {
  const s = site || { name: "", domain: "", platform: "astro", siteType: "affiliate", market: "US", language: "en", repo: "", wpUser: "", notes: "", status: "active" };
  const opt = (map, cur) => Object.entries(map).map(([k, v]) => `<option value="${k}"${k === cur ? " selected" : ""}>${esc(v)}</option>`).join("");
  main.innerHTML = `
  <div class="page">
    <div class="page-head"><div><h2>${site ? esc(site.name) : "Thêm site"}</h2><p>${site ? esc(site.domain) : "Khai báo site để agent làm SEO. Thông tin đăng nhập WordPress, GitHub và email của site sẽ thêm ở giai đoạn sau."}</p></div>
      <div class="toolbar"><a class="btn" href="#/sites">← Danh sách site</a></div></div>
    <form class="card" id="site-form" novalidate>
      <div class="form-grid">
        <label>Tên site <input name="name" required maxlength="80" value="${esc(s.name)}" placeholder="vd: Golf Garage Lab"></label>
        <label>Domain <input name="domain" required value="${esc(s.domain)}" placeholder="vd: golfgaragelab.com"></label>
        <label>Nền tảng <select name="platform">${opt(PLATFORM, s.platform)}</select></label>
        <label>Loại site <select name="siteType">${opt(SITE_TYPE, s.siteType)}</select></label>
        <label>Thị trường chính (mã quốc gia) <input name="market" maxlength="2" value="${esc(s.market)}" placeholder="US, AU, DE, CA…"></label>
        <label>Ngôn ngữ <input name="language" maxlength="5" value="${esc(s.language)}" placeholder="en, de…"></label>
        <label class="full" data-for="astro">Repo GitHub của site (owner/repo) <input name="repo" value="${esc(s.repo || "")}" placeholder="vd: duycan2000/golfgaragelab.com"></label>
        <label class="full" data-for="wp">User WordPress dành riêng cho app (quyền Editor) <input name="wpUser" value="${esc(s.wpUser || "")}" placeholder="vd: duyoi-bot"></label>
        <label class="full">Ghi chú <textarea name="notes" maxlength="2000" placeholder="Luật riêng, đối thủ chính, điều agent cần biết…">${esc(s.notes || "")}</textarea></label>
        ${site ? `<label>Trạng thái <select name="status">${opt({ active: "Đang chạy", paused: "Tạm dừng", archived: "Lưu trữ (ẩn khỏi danh sách)" }, s.status)}</select></label>` : ""}
      </div>
      <div class="msg" id="site-msg" hidden></div>
      <div class="toolbar"><button class="primary" type="submit">${site ? "Lưu thay đổi" : "Thêm site"}</button></div>
    </form>
  </div>`;
  const form = $("#site-form");
  const sync = () => {
    const p = form.platform.value;
    $('[data-for="astro"]', form).hidden = p !== "astro";
    $('[data-for="wp"]', form).hidden = p === "astro";
  };
  form.platform.addEventListener("change", sync);
  sync();
  form.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const d = formData(form);
    if (d.platform === "astro") d.wpUser = ""; else d.repo = "";
    await busy(form.querySelector("button[type=submit]"), "Đang lưu…", async () => {
      try {
        const res = site ? await api(`/api/sites/${site.id}`, { method: "PUT", body: d }) : await api("/api/sites", { method: "POST", body: d });
        if (!site) location.hash = `#/sites/${res.site.id}`;
        else showMsg($("#site-msg"), "Đã lưu.", "ok");
      } catch (e) {
        showMsg($("#site-msg"), e.message);
      }
    });
  });
}

// ---------------- Cài đặt ----------------

const MODEL_FIELDS = [
  ["model_free", "Tầng Free (dữ liệu công khai)"],
  ["model_free_private", "Tầng Free riêng tư (thư, GSC)"],
  ["model_t0", "T0 · trích xuất, brief"],
  ["model_t1", "T1 · viết bài, email"],
  ["model_t2", "T2 · humanizer, chỉnh giọng"],
  ["model_t3", "T3 · kế hoạch, Auditor"],
  ["model_image", "Ảnh bài viết (trả phí)"]
];

const SECRET_HELP = {
  openrouter_api_key: "openrouter.ai › Keys. Đặt giới hạn chi tiêu ngay trên OpenRouter.",
  dataforseo_login: "app.dataforseo.com › API Access",
  dataforseo_password: "Mật khẩu API (khác mật khẩu đăng nhập web)",
  groq_api_key: "console.groq.com › API Keys (model free riêng tư)",
  cloudflare_api_token: "Quyền: DNS Edit, Email Routing Edit, Email Sending, chỉ các zone của site",
  google_api_key: "Knowledge Graph Search API (cho tab Entity)"
};

async function viewSettings(main) {
  const s = await api("/api/settings");
  const admin = state.user.role === "admin";
  const v = s.values;
  main.innerHTML = `
  <div class="page">
    <div class="page-head"><div><h2>Cài đặt</h2><p>API key được mã hoá trước khi lưu vào D1 và không bao giờ gửi ngược về trình duyệt; ở đây chỉ hiện vài ký tự cuối.</p></div></div>
    ${s.encryptionReady ? "" : `<div class="msg warn">${s.encryptionProblem === "invalid"
      ? `<code>ENCRYPTION_KEY</code> đã có nhưng sai định dạng: cần đúng 32 byte mã hoá base64 (44 ký tự, kết thúc bằng <code>=</code>). Tạo lại giá trị và sửa secret.`
      : `Worker chưa có secret <code>ENCRYPTION_KEY</code> nên chưa lưu được API key.`}
      Cách đặt: Cloudflare › Workers &amp; Pages › duyoi › Settings › Variables and Secrets › Add, chọn Type <b>Secret</b>, tên <code>ENCRYPTION_KEY</code>. Lưu xong tải lại trang này.</div>`}
    <div class="card"><h3>API key</h3>
      ${Object.entries(s.secrets).map(([k, info]) => `
        <div class="secret-row">
          <div><b>${esc(info.label)}</b><small>${info.set ? `Đã lưu ${esc(info.hint)} · ${esc(fmtTime(info.updatedAt))}` : "Chưa có"}</small></div>
          <div><input type="password" autocomplete="off" data-secret="${k}" placeholder="${info.set ? "Nhập để thay key mới" : "Dán key vào đây"}" ${admin && s.encryptionReady ? "" : "disabled"}><small class="note">${esc(SECRET_HELP[k] || "")}</small></div>
          <div class="toolbar">${admin ? `<button type="button" data-save="${k}" ${s.encryptionReady ? "" : "disabled"}>Lưu</button>${info.set ? `<button type="button" class="danger" data-clear="${k}">Xoá</button>` : ""}` : ""}</div>
        </div>`).join("")}
      <div class="msg" id="secret-msg" hidden></div>
    </div>

    <form class="card" id="values-form" novalidate><h3>Model AI theo tầng (rẻ trước)</h3>
      <div class="form-grid">${MODEL_FIELDS.map(([k, l]) => `<label>${esc(l)}<input name="${k}" value="${esc(v[k])}" ${admin ? "" : "disabled"}></label>`).join("")}</div>
      <label class="check"><input type="checkbox" name="free_models_enabled" ${v.free_models_enabled ? "checked" : ""} ${admin ? "" : "disabled"}><span>Dùng model free cho việc nền<small>Dữ liệu riêng (thư, GSC, GA4) không bao giờ gửi tới OpenRouter free.</small></span></label>
      <h3>Trần chi phí</h3>
      <div class="form-grid">
        <label>Chuyển sang model trả phí khi đã dùng (%) lượt free <input type="number" name="free_guard_percent" min="50" max="100" value="${esc(v.free_guard_percent)}" ${admin ? "" : "disabled"}></label>
        <label>Múi giờ hiển thị <input name="timezone" value="${esc(v.timezone)}" ${admin ? "" : "disabled"}></label>
        <label>Trần OpenRouter mỗi tháng (USD) <input type="number" name="openrouter_monthly_cap_usd" min="0" step="1" value="${esc(v.openrouter_monthly_cap_usd)}" ${admin ? "" : "disabled"}></label>
        <label>Trần DataForSEO mỗi tháng (USD) <input type="number" name="dataforseo_monthly_cap_usd" min="0" step="1" value="${esc(v.dataforseo_monthly_cap_usd)}" ${admin ? "" : "disabled"}></label>
      </div>
      <div class="msg" id="values-msg" hidden></div>
      ${admin ? `<div class="toolbar"><button class="primary" type="submit">Lưu cài đặt</button></div>` : ""}
    </form>
  </div>`;

  $$("[data-save]", main).forEach((btn) => btn.addEventListener("click", () => {
    const k = btn.dataset.save;
    const input = $(`[data-secret="${k}"]`, main);
    if (!input.value.trim()) return showMsg($("#secret-msg"), "Chưa nhập key.");
    busy(btn, "Đang lưu…", async () => {
      try {
        await api("/api/settings", { method: "PUT", body: { secrets: { [k]: input.value } } });
        input.value = "";
        await viewSettings(main);
        showMsg($("#secret-msg"), "Đã lưu key.", "ok");
      } catch (e) { showMsg($("#secret-msg"), e.message); }
    });
  }));
  $$("[data-clear]", main).forEach((btn) => btn.addEventListener("click", () => {
    if (!confirm("Xoá key này? Các việc dùng key sẽ dừng cho tới khi nhập lại.")) return;
    busy(btn, "Đang xoá…", async () => {
      try {
        await api("/api/settings", { method: "PUT", body: { secrets: { [btn.dataset.clear]: null } } });
        await viewSettings(main);
      } catch (e) { showMsg($("#secret-msg"), e.message); }
    });
  }));
  const form = $("#values-form");
  form.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const d = formData(form);
    await busy(form.querySelector("button[type=submit]"), "Đang lưu…", async () => {
      try {
        await api("/api/settings", { method: "PUT", body: { values: d } });
        showMsg($("#values-msg"), "Đã lưu cài đặt.", "ok");
      } catch (e) { showMsg($("#values-msg"), e.message); }
    });
  });
}

// ---------------- Tài khoản ----------------

async function viewAccount(main) {
  const { sessions } = await api("/api/auth/sessions");
  main.innerHTML = `
  <div class="page">
    <div class="page-head"><div><h2>Tài khoản</h2><p>${esc(state.user.name)} · ${esc(state.user.email)} · ${state.user.role === "admin" ? "Admin" : esc(state.user.role)}</p></div></div>
    <div class="grid2">
      <form class="card" id="pw-form" novalidate><h3>Đổi mật khẩu</h3>
        <label>Mật khẩu hiện tại <input name="current" type="password" autocomplete="current-password" required></label>
        <label>Mật khẩu mới (ít nhất 10 ký tự) <input name="next" type="password" autocomplete="new-password" required minlength="10"></label>
        <label>Nhập lại mật khẩu mới <input name="next2" type="password" autocomplete="new-password" required minlength="10"></label>
        <div class="msg" id="pw-msg" hidden></div>
        <div class="toolbar"><button class="primary" type="submit">Đổi mật khẩu</button></div>
        <p class="note">Đổi xong, các thiết bị khác sẽ bị đăng xuất.</p>
      </form>
      <div class="card"><h3>Phiên đang đăng nhập</h3>
        <div class="tablewrap"><table><thead><tr><th>Thiết bị</th><th>Từ</th><th>Hết hạn</th></tr></thead><tbody>
          ${sessions.map((x) => `<tr><td>${esc((x.userAgent || "—").slice(0, 60))}${x.current ? ` <span class="tag ok">thiết bị này</span>` : ""}<small>${esc(x.ip || "")}</small></td><td>${esc(fmtTime(x.createdAt))}</td><td>${esc(fmtTime(x.expiresAt))}</td></tr>`).join("")}
        </tbody></table></div>
      </div>
    </div>
  </div>`;
  const form = $("#pw-form");
  form.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const d = formData(form);
    if (d.next !== d.next2) return showMsg($("#pw-msg"), "Hai lần nhập mật khẩu mới không khớp.");
    await busy(form.querySelector("button[type=submit]"), "Đang lưu…", async () => {
      try {
        await api("/api/auth/password", { method: "POST", body: { current: d.current, next: d.next } });
        form.reset();
        showMsg($("#pw-msg"), "Đã đổi mật khẩu.", "ok");
      } catch (e) { showMsg($("#pw-msg"), e.message); }
    });
  });
}

// ---------------- Nhật ký ----------------

async function viewActivity(main) {
  const { activity } = await api("/api/activity?limit=200");
  main.innerHTML = `
  <div class="page">
    <div class="page-head"><div><h2>Nhật ký</h2><p>Việc người và agent đã làm. Giá trị API key không bao giờ được ghi vào đây.</p></div></div>
    <div class="card">${activity.length ? `<div class="activity">${activity.map(actRow).join("")}</div>` : `<p class="note">Chưa có hoạt động.</p>`}</div>
  </div>`;
}

// ---------------- Màn của giai đoạn sau ----------------

function viewSoon(main, _args, item) {
  main.innerHTML = `
  <div class="page">
    <div class="page-head"><div><h2>${esc(item.label)}</h2><p>Màn này đang được xây trong ${esc(PHASES[item.phase] || "giai đoạn sau")}.</p></div></div>
    <div class="card soon-card">
      <span class="phase">${esc(PHASES[item.phase] || "")}</span>
      <h3>Sẽ có</h3>
      <ul>${(item.plan || []).map((p) => `<li>${esc(p)}</li>`).join("")}</ul>
      <p class="note">Giao diện và cách hoạt động theo bản demo đã duyệt; dữ liệu lấy từ site và API key thật của anh.</p>
    </div>
  </div>`;
}

boot();
