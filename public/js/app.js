// Duy Ơi · khởi động, định tuyến, các màn của giai đoạn 1.

import { api, ApiError } from "./api.js";
import { MENU, ITEMS, PHASES } from "./menu.js";
import { viewRecovery } from "./recovery.js";
import { viewHq } from "./hq.js";
import { viewStudio } from "./studio.js";
import { viewStats } from "./stats.js";
import { viewRankings } from "./rankings.js";
import { viewSemantic } from "./semantic.js";
import { viewHealth } from "./health.js";
import { viewQuickWins } from "./quickwins.js";
import { mountReport } from "./report.js";
import { viewOffpage } from "./offpage.js";
import { $, $$, esc, fmtTime, ago, showMsg, busy, formData, floatLabels } from "./ui.js";

const app = $("#app");
// Mọi form được vẽ ra đều có nhãn nổi trên viền ô nhập
new MutationObserver(() => floatLabels(app)).observe(app, { childList: true, subtree: true });
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
      enter();
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) return renderLogin();
      throw e;
    }
  } catch (e) {
    app.innerHTML = `<div class="auth"><div class="auth-card"><h2>Không kết nối được máy chủ</h2><p class="lead">${esc(e.message)}</p><button type="button" class="primary" id="retry">Thử lại</button></div>${AUTH_ART()}</div>`;
    $("#retry").addEventListener("click", boot);
  }
}

window.addEventListener("duyoi:unauthorized", () => { state.user = null; renderLogin("Phiên đăng nhập đã hết. Anh đăng nhập lại nhé."); });

// Cây trang trí hai góc dưới màn đăng nhập, vẽ bằng SVG đơn giản
const PLANT = (cls) => `<svg class="plant ${cls}" viewBox="0 0 120 220" aria-hidden="true">
  <path d="M60 210 C60 150 58 110 62 60" stroke="#6f4cf6" stroke-opacity=".35" stroke-width="3" fill="none"/>
  <path d="M61 70 C30 40 34 6 62 2 C88 8 92 42 61 70Z" fill="#6f4cf6" fill-opacity=".55"/>
  <path d="M60 120 C24 112 8 80 20 62 C46 62 62 92 60 120Z" fill="#d65ce0" fill-opacity=".55"/>
  <path d="M61 150 C96 140 112 108 100 90 C74 92 58 122 61 150Z" fill="#6f4cf6" fill-opacity=".4"/>
  <rect x="44" y="196" width="32" height="22" rx="3" fill="#c9cdd8"/>
</svg>`;
const AUTH_ART = () => `<div class="auth-art" aria-hidden="true"><span class="ground"></span>${PLANT("l")}${PLANT("r")}</div>`;

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
  </div>${AUTH_ART()}</div>`;
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
    <h2>Chào mừng tới ${esc(state.appName)}! 👋🏻</h2>
    <p class="lead">Đăng nhập để điều hành đội AI agent làm SEO, AEO, GEO cho các site của anh.</p>
    <form id="login-form" novalidate>
      <label>Email <input name="email" type="email" autocomplete="username" required></label>
      <label>Mật khẩu <input name="password" type="password" autocomplete="current-password" required></label>
      <div class="msg ${notice ? "warn" : ""}" id="login-msg" ${notice ? "" : "hidden"}>${esc(notice)}</div>
      <button class="primary" type="submit">Đăng nhập</button>
    </form>
  </div>${AUTH_ART()}</div>`;
  const form = $("#login-form");
  form.email.focus();
  form.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const d = formData(form);
    await busy(form.querySelector("button[type=submit]"), "Đang đăng nhập…", async () => {
      try {
        const res = await api("/api/auth/login", { method: "POST", body: { email: d.email, password: d.password } });
        state.user = res.user;
        enter();
      } catch (e) {
        showMsg($("#login-msg"), e.message);
      }
    });
  });
}

// ---------------- Mật khẩu tạm: bắt đổi trước khi vào app ----------------

function enter() {
  if (state.user.mustChangePassword) return renderForcePassword();
  renderShell();
}

function renderForcePassword() {
  app.innerHTML = `
  <div class="auth"><div class="auth-card">
    <div class="logo"><img src="/favicon.svg" alt=""><b>${esc(state.appName)}</b></div>
    <h2>Đặt mật khẩu của anh</h2>
    <p class="lead">Chào ${esc(state.user.name)}. Admin đã tạo tài khoản cho anh bằng mật khẩu tạm. Anh đặt mật khẩu riêng để bắt đầu dùng app.</p>
    <form id="force-form" novalidate>
      <label>Mật khẩu tạm admin gửi <input name="current" type="password" autocomplete="current-password" required></label>
      <label>Mật khẩu mới (ít nhất 10 ký tự) <input name="next" type="password" autocomplete="new-password" required minlength="10"></label>
      <label>Nhập lại mật khẩu mới <input name="next2" type="password" autocomplete="new-password" required minlength="10"></label>
      <div class="msg" id="force-msg" hidden></div>
      <button class="primary" type="submit">Lưu và vào app</button>
    </form>
    <p class="note mt"><a href="#" id="force-logout">Đăng xuất</a></p>
  </div>${AUTH_ART()}</div>`;
  const form = $("#force-form");
  form.current.focus();
  $("#force-logout").addEventListener("click", async (ev) => {
    ev.preventDefault();
    try { await api("/api/auth/logout", { method: "POST" }); } catch { /* vẫn về màn đăng nhập */ }
    state.user = null;
    renderLogin();
  });
  form.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const d = formData(form);
    if (d.next !== d.next2) return showMsg($("#force-msg"), "Hai lần nhập mật khẩu mới không khớp.");
    await busy(form.querySelector("button[type=submit]"), "Đang lưu…", async () => {
      try {
        await api("/api/auth/password", { method: "POST", body: { current: d.current, next: d.next } });
        state.user.mustChangePassword = false;
        location.hash = "#/overview";
        renderShell();
      } catch (e) { showMsg($("#force-msg"), e.message); }
    });
  });
}

// ---------------- Khung app ----------------

// Thanh dưới cùng trên điện thoại: các màn dùng nhiều nhất + nút mở toàn bộ menu
// Icon nét 24px, vẽ riêng cho app
const ICON = {
  grid: "M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z",
  globe: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM3 12h18M12 3c2.5 2.6 3.8 5.6 3.8 9s-1.3 6.4-3.8 9c-2.5-2.6-3.8-5.6-3.8-9S9.5 5.6 12 3z",
  list: "M5 4h14v16H5zM8 8h8M8 12h8M8 16h5",
  gear: "M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19 12a7 7 0 0 0-.1-1.2l2-1.6-2-3.4-2.4 1a7 7 0 0 0-2-1.2L14 3h-4l-.5 2.6a7 7 0 0 0-2 1.2l-2.4-1-2 3.4 2 1.6a7 7 0 0 0 0 2.4l-2 1.6 2 3.4 2.4-1a7 7 0 0 0 2 1.2L10 21h4l.5-2.6a7 7 0 0 0 2-1.2l2.4 1 2-3.4-2-1.6c.1-.4.1-.8.1-1.2z",
  user: "M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 21c.8-4 4-6 8-6s7.2 2 8 6",
  users: "M9 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zM2.5 20c.7-3.5 3.3-5.5 6.5-5.5s5.8 2 6.5 5.5M16 4.3a3.5 3.5 0 0 1 0 6.4M18 14.8c1.9.7 3.1 2.5 3.5 5.2",
  plus: "M12 5v14M5 12h14",
  search: "M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM20 20l-4-4",
  chevron: "M9 6l6 6-6 6",
  dot: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z",
  circle: "M12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8z",
  chart: "M4 20V4M4 20h16M8 16v-5M12 16V8M16 16v-3",
  pen: "M4 20h4L19 9l-4-4L4 16zM14 6l4 4",
  shield: "M12 3l8 3v6c0 4.5-3.4 8-8 9-4.6-1-8-4.5-8-9V6z",
  link: "M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1",
  spark: "M12 3l2.2 5.8L20 11l-5.8 2.2L12 19l-2.2-5.8L4 11l5.8-2.2z",
  sliders: "M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0M14 4v4M8 10v4M16 16v4",
  layers: "M12 3l9 5-9 5-9-5zM3 13l9 5 9-5",
  queue: "M4 6h16M4 12h10M4 18h6M17 15l3 3-3 3",
  money: "M3 6h18v12H3zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM6 9v.01M18 15v.01",
  clock: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 7v5l3 2",
  trend: "M3 17l6-6 4 4 8-8M15 7h6v6",
  logout: "M15 4h4v16h-4M10 8l-4 4 4 4M6 12h10",
  menu: "M4 6h16M4 12h16M4 18h16",
  bolt: "M13 2 4.5 13.5H11L10 22l8.5-11.5H12z",
  home: "M4 11 12 4l8 7v9h-5v-6H9v6H4z",
  close: "M6 6l12 12M18 6L6 18"
};
const GROUP_ICON = { rec: "trend", ops: "chart", site: "layers", content: "pen", tech: "shield", off: "link", ai: "spark", sys: "sliders" };
const ITEM_ICON = { health: "bolt", wins: "spark", roadmap: "queue", topical: "grid", recovery: "shield", analytics: "chart", rankings: "trend", offpage: "users", prospects: "search", mail: "pen", backlinks: "link", citations: "list", entity: "globe", hq: "users", overview: "home", sites: "globe", members: "users", activity: "list", settings: "gear", account: "user" };
const itemIcon = (id) => ICON[ITEM_ICON[id] || GROUP_ICON[ITEMS[id].group]];
const icon = (d) => `<svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><path d="${d}"/></svg>`;

// Thanh dưới cùng trên điện thoại: các màn dùng nhiều nhất + nút mở toàn bộ menu
// Thứ tự: 2 lối tắt, nút giữa (Trưởng nhóm), 1 lối tắt, nút mở menu
const TABBAR = [["overview", "Tổng quan"], ["recovery", "Phục hồi"], ["hq", "Trưởng nhóm", "fab"], ["content", "Bài viết"]];
const ROLE_NAME = { admin: "Admin", editor: "Biên tập", viewer: "Chỉ xem" };
const canSee = (item) => !item.admin || state.user?.role === "admin";
const initials = (name) => (name || "?").trim().split(/\s+/).slice(-1)[0].slice(0, 1).toUpperCase();

function renderShell() {
  app.innerHTML = `
  <div class="shell${miniPref() ? " mini" : ""}" id="shell">
    <header class="topbar">
      <a class="brand" href="#/overview"><img src="/favicon.svg" alt=""><b>${esc(state.appName)}</b></a>
      <div class="search" id="search">
        <button type="button" class="icon-btn" id="search-btn" aria-label="Tìm màn hình">${icon(ICON.search)}</button>
        <input id="search-input" type="search" placeholder="Tìm màn hình (Ctrl + K)" autocomplete="off" aria-label="Tìm màn hình" hidden>
        <div class="pop search-pop" id="search-pop" hidden></div>
      </div>
      <span class="spacer"></span>
      <span class="pill" id="sys-pill"><i></i><span>Đang chạy</span></span>
      <div class="user-wrap">
        <button type="button" class="user-chip" id="user-btn" aria-haspopup="menu" aria-expanded="false" aria-label="Menu tài khoản"><span class="avatar" aria-hidden="true">${esc(initials(state.user.name))}<i></i></span></button>
        <div class="pop user-pop" id="user-pop" role="menu" hidden>
          <div class="user-head"><span class="avatar" aria-hidden="true">${esc(initials(state.user.name))}<i></i></span><span><b>${esc(state.user.name)}</b><small>${esc(ROLE_NAME[state.user.role] || state.user.role)}</small></span></div>
          <a role="menuitem" href="#/account">${icon(ICON.user)}Tài khoản</a>
          ${state.user.role === "admin" ? `<a role="menuitem" href="#/settings">${icon(ICON.gear)}Cài đặt</a><a role="menuitem" href="#/members">${icon(ICON.users)}Thành viên</a>` : ""}
          <a role="menuitem" href="#/activity">${icon(ICON.list)}Nhật ký</a>
          <hr>
          <button type="button" role="menuitem" data-logout>${icon(ICON.logout)}Đăng xuất</button>
        </div>
      </div>
    </header>
    <div class="scrim" id="scrim" hidden></div>
    <nav class="side" id="side" aria-label="Menu chính">
      <div class="side-top"><a class="brand" href="#/overview"><img src="/favicon.svg" alt=""><b>${esc(state.appName)}</b></a>
      <button type="button" class="icon-btn" id="side-mini" aria-label="Thu gọn menu" title="Thu gọn menu">${icon(ICON.dot)}</button>
      <button type="button" class="icon-btn" id="side-close" aria-label="Đóng menu">${icon(ICON.close)}</button></div>
      <div class="side-nav">
        ${MENU.map((g) => [g, g.items.filter((i) => canSee(i) && i.live && !i.hidden)]).filter(([, items]) => items.length).map(([g, items]) => `<div class="group g-${g.key}"><p><span>${esc(g.group)}</span></p>${items.map((i) => `<a class="item" href="#/${i.id}" data-view="${i.id}" title="${esc(i.label)}">${icon(itemIcon(i.id))}<span>${esc(i.label)}</span></a>`).join("")}</div>`).join("")}
      </div>
    </nav>
    <main class="main" id="main" tabindex="-1"></main>
    <footer class="foot"><span>© ${new Date().getFullYear()}, ${esc(state.appName)} · AI agent làm SEO cho site của anh</span>
      <nav><a href="#/overview">Tổng quan</a><a href="#/sites">Site</a><a href="#/activity">Nhật ký</a><a href="#/account">Tài khoản</a></nav></footer>
    <nav class="tabbar" aria-label="Lối tắt">
      ${TABBAR.map(([id, label, kind]) => kind === "fab"
        ? `<a href="#/${id}/lead" data-tab="${id}" class="fab" aria-label="${esc(label)}"><span class="fab-btn">${icon(ICON.bolt)}</span><span>${esc(label)}</span></a>`
        : `<a href="#/${id}" data-tab="${id}">${icon(itemIcon(id))}<span>${esc(label)}</span></a>`).join("")}
      <button type="button" id="menu-btn" aria-controls="side" aria-expanded="false">${icon(ICON.menu)}<span>Thêm</span></button>
    </nav>
  </div>`;
  $$("[data-logout]").forEach((b) => b.addEventListener("click", async () => {
    try { await api("/api/auth/logout", { method: "POST" }); } catch { /* vẫn về màn đăng nhập */ }
    state.user = null;
    document.body.classList.remove("menu-open");
    renderLogin();
  }));
  $("#menu-btn").addEventListener("click", () => toggleMenu(true));
  $("#side-mini").addEventListener("click", () => {
    const mini = $("#shell").classList.toggle("mini");
    try { localStorage.setItem("duyoi_mini", mini ? "1" : ""); } catch { /* không lưu được thì thôi */ }
  });
  bindUserMenu();
  bindSearch();
  $("#side-close").addEventListener("click", () => toggleMenu(false));
  $("#scrim").addEventListener("click", () => toggleMenu(false));
  $$(".side a.item").forEach((a) => a.addEventListener("click", () => toggleMenu(false)));
  document.onkeydown = (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") { e.preventDefault(); openSearch(); return; }
    if (e.key !== "Escape") return;
    if (document.body.classList.contains("menu-open")) toggleMenu(false);
    closePops();
  };
  window.onhashchange = route;
  route();
}

function miniPref() {
  try { return localStorage.getItem("duyoi_mini") === "1"; } catch { return false; }
}

function closePops() {
  const up = $("#user-pop");
  if (up && !up.hidden) { up.hidden = true; $("#user-btn").setAttribute("aria-expanded", "false"); }
  closeSearch();
}

function bindUserMenu() {
  const btn = $("#user-btn");
  const pop = $("#user-pop");
  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    const open = pop.hidden;
    closePops();
    pop.hidden = !open;
    btn.setAttribute("aria-expanded", String(open));
  });
  pop.addEventListener("click", (e) => { if (e.target.closest("a")) closePops(); });
  document.onclick = (e) => { if (!e.target.closest(".user-wrap, .search")) closePops(); };
}

// Tìm nhanh một màn trong menu (không gọi API)
function openSearch() {
  const input = $("#search-input");
  if (!input) return;
  $("#search").classList.add("open");
  input.hidden = false;
  input.focus();
  renderSearch("");
}

function closeSearch() {
  const input = $("#search-input");
  if (!input || input.hidden) return;
  input.value = "";
  input.hidden = true;
  $("#search-pop").hidden = true;
  $("#search").classList.remove("open");
}

function renderSearch(q) {
  const norm = (t) => t.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/đ/g, "d").replace(/Đ/g, "D").toLowerCase();
  const nq = norm(q.trim());
  const hits = Object.entries(ITEMS).filter(([, i]) => canSee(i) && (!nq || norm(i.label).includes(nq))).slice(0, 8);
  const pop = $("#search-pop");
  pop.innerHTML = hits.length
    ? hits.map(([id, i], n) => `<a href="#/${id}" class="${n === 0 ? "first" : ""}">${icon(itemIcon(id))}<span>${esc(i.label)}</span>${i.live ? "" : `<em>Sắp có</em>`}</a>`).join("")
    : `<p class="note">Không có màn nào khớp.</p>`;
  pop.hidden = false;
}

function bindSearch() {
  const input = $("#search-input");
  $("#search-btn").addEventListener("click", (e) => { e.stopPropagation(); input.hidden ? openSearch() : closeSearch(); });
  input.addEventListener("input", () => renderSearch(input.value));
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      const first = $("#search-pop a");
      if (first) { location.hash = first.getAttribute("href"); closeSearch(); }
    }
  });
  $("#search-pop").addEventListener("click", (e) => { if (e.target.closest("a")) closeSearch(); });
}

function toggleMenu(open) {
  const side = $("#side");
  if (!side) return;
  side.classList.toggle("open", open);
  $("#scrim").hidden = !open;
  $("#menu-btn").setAttribute("aria-expanded", String(open));
  document.body.classList.toggle("menu-open", open);
  if (open) {
    const cur = $(".side a.item.on");
    (cur || $("#side-close")).focus({ preventScroll: true });
    if (cur) cur.scrollIntoView({ block: "center" });
  } else if (side.contains(document.activeElement)) {
    $("#menu-btn").focus({ preventScroll: true });
  }
}

function setPill(paused) {
  state.paused = paused;
  $$("#sys-pill").forEach((pill) => {
    pill.classList.toggle("paused", paused);
    pill.querySelector("span").textContent = paused ? "Đang tạm dừng" : "Đang chạy";
  });
}

function route() {
  if (!state.user) return;
  const parts = (location.hash.replace(/^#\/?/, "") || "overview").split("/");
  const view = ITEMS[parts[0]] && canSee(ITEMS[parts[0]]) ? parts[0] : "overview";
  $$(".side a.item").forEach((a) => a.classList.toggle("on", a.dataset.view === view));
  const inBar = TABBAR.some(([id]) => id === view);
  $$(".tabbar a").forEach((a) => a.classList.toggle("on", a.dataset.tab === view));
  const mb = $("#menu-btn");
  if (mb) mb.classList.toggle("on", !inBar);
  const main = $("#main");
  main.className = `main g-${ITEMS[view].group}`;
  main.innerHTML = `<div class="page"><p class="note">Đang tải…</p></div>`;
  const views = { health: (m, a) => viewHealth(m, a, { state }), wins: (m, a) => viewQuickWins(m, a, { state }), roadmap: (m) => viewRoadmap(m), recovery: (m, a) => viewRecovery(m, a, { state, icon, ICON, tabsNav, panelAttr, bindTabs }), hq: (m, a) => viewHq(m, a, { state, icon, ICON, tabsNav, panelAttr, bindTabs }), content: (m, a) => viewStudio(m, a, { state, icon, ICON }), analytics: (m, a) => viewStats(m, a, { state, icon, ICON }), topical: (m, a) => viewSemantic(m, a, { state, icon, ICON }), rankings: (m, a) => viewRankings(m, a, { state, icon, ICON, tabsNav, panelAttr, bindTabs }), ...Object.fromEntries(["offpage", "prospects", "mail", "backlinks", "citations", "entity"].map((id) => [id, (m, a) => viewOffpage(m, a, { state, icon, ICON, tabsNav, panelAttr, bindTabs, item: ITEMS[id] })])), overview: viewOverview, sites: viewSites, members: viewMembers, settings: viewSettings, account: viewAccount, activity: viewActivity };
  const fn = views[view] || viewSoon;
  Promise.resolve(fn(main, parts.slice(1), ITEMS[view])).catch((e) => {
    if (e.code === "must_change_password") { state.user.mustChangePassword = true; return renderForcePassword(); }
    main.innerHTML = `<div class="page"><div class="msg err">${esc(e.message)}</div></div>`;
  });
  main.focus({ preventScroll: true });
  window.scrollTo(0, 0);
}

// ---------------- Thẻ có tab (kiểu Account Settings của mẫu) ----------------

state.tabs = {};
const tabsNav = (id, tabs, def) => { const active = tabOf(id, def); return `<nav class="tabs" role="tablist" data-tabs="${id}">${tabs.map(([k, l, ic]) =>
  `<button type="button" role="tab" data-tab-key="${k}" aria-selected="${k === active}" class="${k === active ? "on" : ""}">${icon(ICON[ic])}<span>${esc(l)}</span></button>`).join("")}</nav>` };
const tabOf = (id, def) => state.tabs[id] || def;
const panelAttr = (id, key, def) => `data-panel="${key}"${tabOf(id, def) === key ? "" : " hidden"}`;

function bindTabs(root, id) {
  const nav = $(`[data-tabs="${id}"]`, root);
  if (!nav) return;
  nav.addEventListener("click", (e) => {
    const b = e.target.closest("[data-tab-key]");
    if (!b) return;
    const k = b.dataset.tabKey;
    state.tabs[id] = k;
    $$("[data-tab-key]", nav).forEach((x) => { x.classList.toggle("on", x === b); x.setAttribute("aria-selected", String(x === b)); });
    $$("[data-panel]", nav.parentElement).forEach((p) => { p.hidden = p.dataset.panel !== k; });
  });
}

// ---------------- Tổng quan ----------------

// value đã là HTML an toàn (số hoặc chuỗi đã esc)
const kpi = (tone, ic, value, label, href, cls = "") => `<a class="kpi ${tone}" href="${href}"><span class="kpi-ic">${icon(ICON[ic])}</span><div><b class="${cls}">${value}</b><small>${esc(label)}</small></div>${icon(ICON.chevron)}</a>`;

// Mỗi bước "Bắt đầu" dẫn tới đúng chỗ cần làm
const CHECK_LINK = {
  encryption: "#/settings/keys",
  prompts: "#/hq/prompts",
  openrouter: "#/settings/keys/openrouter_api_key",
  dataforseo: "#/settings/keys/dataforseo_login",
  site: "#/sites/new",
  cron: "#/schedule"
};

// Vòng đo 270° (kiểu đồng hồ): giá trị đã dùng / trần
function ring(id, used, cap, unit, label, sub, href) {
  const r = 52, C = 2 * Math.PI * r, arc = C * 0.75;
  const ratio = cap > 0 ? Math.min(used / cap, 1) : 0;
  const tone = ratio >= 0.9 ? ["#ff4c51", "#ff8a65"] : ratio >= 0.7 ? ["#ffb400", "#ff7ab6"] : ["#6f4cf6", "#d65ce0"];
  return `<a class="ring" href="${href}"><svg viewBox="0 0 140 130" role="img" aria-label="${esc(label)}: ${esc(sub)}">
    <defs><linearGradient id="g-${id}" x1="0" y1="1" x2="1" y2="0"><stop offset="0" stop-color="${tone[0]}"/><stop offset="1" stop-color="${tone[1]}"/></linearGradient></defs>
    <circle class="track" cx="70" cy="70" r="${r}" stroke-dasharray="${arc.toFixed(1)} ${C.toFixed(1)}" transform="rotate(135 70 70)"/>
    <circle class="val" cx="70" cy="70" r="${r}" stroke="url(#g-${id})"${ratio === 0 ? ' stroke-opacity="0"' : ""} stroke-dasharray="${(arc * ratio).toFixed(1)} ${C.toFixed(1)}" transform="rotate(135 70 70)"/>
    <text class="n" x="70" y="72">${esc(unit)}${used >= 100 ? Math.round(used) : used.toFixed(2)}</text><text class="u" x="70" y="92">đã dùng</text>
  </svg><b>${esc(label)}</b><small>${esc(sub)}</small></a>`;
}

// Biểu tượng tròn cho từng dòng nhật ký (kiểu danh sách hoá đơn)
function actIcon(a) {
  const k = a.action;
  if (/fail|error|blocked|bị chặn/.test(k) || /lỗi/i.test(a.detail || "")) return ["t-err", "close"];
  if (k.startsWith("recovery.")) return ["t-warn", "trend"];
  if (k.startsWith("content.") || k.startsWith("docs.")) return ["t-ok", "pen"];
  if (k.startsWith("lead.")) return ["", "bolt"];
  if (k === "monitor.alert") return ["t-err", "trend"];
  if (k.startsWith("monitor.") || k.startsWith("semantic.") || k.startsWith("stats.")) return ["t-info", "chart"];
  if (/^(offpage|outreach|social|prospect|manual|citation|links?|indexnow)\./.test(k)) return ["t-ok", "link"];
  if (k.startsWith("settings.") || k.startsWith("auth.") || k.startsWith("user.")) return ["t-info", "shield"];
  return ["", "list"];
}

const greet = () => { const h = Number(new Intl.DateTimeFormat("en-GB", { hour: "numeric", hour12: false, timeZone: "Asia/Ho_Chi_Minh" }).format(new Date())); return h < 11 ? "Chào buổi sáng" : h < 14 ? "Chào buổi trưa" : h < 18 ? "Chào buổi chiều" : "Chào buổi tối"; };

async function viewOverview(main) {
  const [d, act, hq] = await Promise.all([api("/api/dashboard"), api("/api/activity?limit=8"), api("/api/hq").catch(() => null)]);
  setPill(d.paused);
  const used = (p) => Number(d.spendThisMonth[p] || 0);
  const cap = (p) => Number(d.caps[p] || 0);
  const total = used("openrouter") + used("dataforseo");
  const done = d.checklist.filter((c) => c.done).length;
  main.innerHTML = `
  <div class="page">
    <div class="page-head">
      <div class="hello"><small>${greet()}, ${esc(state.user.name)}</small><h2>Tổng quan</h2></div>
      <div class="toolbar">${state.user.role === "admin" ? `<button type="button" id="pause">${d.paused ? "Chạy lại agent" : "Tạm dừng toàn bộ"}</button>` : ""}<a class="btn primary" href="#/hq/lead">${icon(ICON.bolt)}Hỏi Trưởng nhóm</a></div>
    </div>
    <div class="hero-row">
      <div class="glass">
        <a class="go" href="#/hq/spend" aria-label="Xem chi tiêu">${icon(ICON.chevron)}</a>
        <small>Chi phí agent tháng này</small>
        <b class="big">$${total.toFixed(2)}</b>
        <div class="row"><small>${d.paused ? "Đội agent đang tạm dừng" : `Đội agent đang chạy · ${d.sites.total} site`}</small>
          <span>$${(cap("openrouter") + cap("dataforseo")).toFixed(0)}<em>trần mỗi tháng</em></span></div>
        ${hq ? `<div class="stats">
          <a href="#/hq/lead"><b>${(hq.asks?.length || 0) + (hq.lead?.queued || 0)}</b><small>Việc chờ anh / chờ chạy</small></a>
          <a href="#/hq/prompts"><b>${hq.manager.promptsPending}</b><small>Prompt chờ duyệt</small></a>
          <a href="#/content"><b>${(hq.ideas?.drafted || 0)}</b><small>Bài nháp chờ xem</small></a>
        </div>` : ""}
      </div>
      <div class="card"><h3>Chi phí AI &amp; dữ liệu</h3>
        <div class="rings">
          ${ring("or", used("openrouter"), cap("openrouter"), "$", "OpenRouter", `trần $${cap("openrouter")} / tháng`, "#/hq/spend")}
          ${ring("dfs", used("dataforseo"), cap("dataforseo"), "$", "DataForSEO", `trần $${cap("dataforseo")} / tháng`, "#/hq/spend")}
        </div>
      </div>
    </div>
    <div class="kpis">
      ${kpi("t-site", "globe", d.sites.total, "Site đang theo dõi", d.sites.total ? "#/sites" : "#/sites/new")}
      ${kpi("t-yellow", "queue", (d.jobs.queued || 0) + (d.jobs.running || 0), "Việc trong hàng đợi", "#/hq/lead")}
      ${kpi("t-ai", "clock", esc(ago(d.cronLastRun)), "Cron chạy lần cuối", "#/schedule", "sm")}
    </div>
    <div class="grid2">
      <div class="card"><h3>Bắt đầu (${done}/${d.checklist.length})</h3>
        <div class="checklist">${d.checklist.map((c, i) => `<a href="${c.id === "site" && c.done ? "#/sites" : CHECK_LINK[c.id] || "#/settings"}" class="${c.done ? "done" : ""}"><i>${c.done ? "✓" : i + 1}</i><span>${esc(c.label)}</span>${c.done ? "" : `<em>Làm ngay</em>`}${icon(ICON.chevron)}</a>`).join("")}</div>
        <div class="toolbar"><a class="btn" href="#/settings">Mở Cài đặt</a><a class="btn" href="#/sites/new">Thêm site</a></div>
      </div>
      <div class="card"><div class="task-head"><h3>Hoạt động gần đây</h3><a class="icon-btn" href="#/activity" aria-label="Xem toàn bộ nhật ký">${icon(ICON.chevron)}</a></div>
        ${act.activity.length ? `<div class="activity bills">${act.activity.map((a) => { const [t, ic] = actIcon(a); return `<a href="${actLink(a)}"><span class="dot-ic ${t}">${icon(ICON[ic] || ICON.list)}</span><span>${esc(actText(a))}${a.site && a.action !== "site.created" ? ` · <b>${esc(a.site)}</b>` : ""}</span><time>${esc(fmtTime(a.at))}</time></a>`; }).join("")}</div>` : `<p class="note">Chưa có hoạt động.</p>`}
      </div>
    </div>
  </div>`;
  const btn = $("#pause");
  if (btn) btn.addEventListener("click", () => busy(btn, "Đang lưu…", async () => {
    await api("/api/system/pause", { method: "POST", body: { paused: !d.paused } });
    route();
  }));
}

// Đổi tên khoá cài đặt thành chữ dễ đọc
function settingsText(detail) {
  const NAMES = { openrouter_api_key: "OpenRouter API key", dataforseo_login: "DataForSEO login", dataforseo_password: "DataForSEO password", groq_api_key: "Groq API key", cloudflare_api_token: "Cloudflare API token", google_api_key: "Google Cloud API key", timezone: "múi giờ" };
  const parts = new Set(String(detail || "").split(/,\s*/).filter(Boolean).map((k) =>
    NAMES[k] || (k.startsWith("model_") ? "model AI" : k.startsWith("free_") ? "model free" : k.endsWith("_cap_usd") ? "trần chi phí" : k)));
  return `Cập nhật cài đặt: ${[...parts].join(", ")}`;
}

function actText(a) {
  if (a.action === "settings.updated") return settingsText(a.detail);
  if (a.action === "site.updated") return `Sửa site (${a.detail})`;
  if (a.action === "site.created") return `Thêm site ${a.detail}`;
  return a.detail || a.action;
}

// Mỗi dòng nhật ký dẫn tới màn liên quan
function actLink(a) {
  const admin = state.user?.role === "admin";
  if (a.action.startsWith("recovery.")) return "#/recovery";
  if (a.action.startsWith("monitor.")) return a.siteId ? `#/rankings/${a.siteId}` : "#/rankings";
  if (a.action.startsWith("semantic.")) return a.siteId ? `#/topical/${a.siteId}` : "#/topical";
  if (a.action.startsWith("stats.")) return "#/analytics";
  if (/^(offpage|outreach|social|prospect|manual|citation|links?|indexnow)\./.test(a.action)) return "#/offpage";
  if (a.action.startsWith("affiliate.")) return "#/content";
  if (a.action.startsWith("content.") || a.action.startsWith("docs.")) return "#/content";
  if (a.siteId) return `#/sites/${a.siteId}`;
  if (a.action.startsWith("settings.")) return /_key|_login|_password|_token/.test(a.detail || "") ? "#/settings/keys" : "#/settings/models";
  if (a.action.startsWith("user.")) return admin ? "#/members" : "#/activity";
  if (a.action.startsWith("auth.") || a.action.startsWith("setup.")) return "#/account/security";
  if (a.action.startsWith("cron.")) return "#/schedule";
  return "#/activity";
}

const actRow = (a) => `<a href="${actLink(a)}"><span>${esc(actText(a))}${a.site && a.action !== "site.created" ? ` · <b>${esc(a.site)}</b>` : ""}</span><time>${esc(fmtTime(a.at))}</time></a>`;

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
    <div class="page-head"><div><h2>${site ? esc(site.name) : "Thêm site"}</h2><p>${site ? esc(site.domain) : "Khai báo site để agent làm SEO."}</p></div>
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
        <label class="full">Tên miền ảnh dùng chung (không bắt buộc: site Astro mặc định có bucket riêng, ảnh ở ten-mien/images/) <input name="mediaBaseUrl" type="url" value="${esc(s.mediaBaseUrl || "")}" placeholder="https://img.ten-mien.com"></label>
        <label class="full">Ghi chú <textarea name="notes" maxlength="2000" placeholder="Luật riêng, đối thủ chính, điều agent cần biết…">${esc(s.notes || "")}</textarea></label>
        ${site ? `<label>Trạng thái <select name="status">${opt({ active: "Đang chạy", paused: "Tạm dừng", archived: "Lưu trữ (ẩn khỏi danh sách)" }, s.status)}</select></label>` : ""}
      </div>
      <div class="msg" id="site-msg" hidden></div>
      <div class="toolbar"><button class="primary" type="submit">${site ? "Lưu thay đổi" : "Thêm site"}</button></div>
    </form>
    ${site && site.platform !== "astro" ? `<form class="card" id="wp-form" novalidate><h3>Kết nối WordPress</h3>
      <p class="note">Để agent áp dụng các việc đã duyệt (chèn link, CTA, meta Rank Math, GEO) có sao lưu và hoàn tác. App không bao giờ dùng mật khẩu đăng nhập web.</p>
      <ol class="steps">
        <li><a href="/duyoi-connector.zip" download>Tải plugin Duy Ơi Connector</a>, vào WordPress › Plugins › Add New › Upload, cài và bật.</li>
        <li>Tạo user riêng cho app (quyền Editor), ví dụ <code>duyoi-bot</code>.</li>
        <li>Đăng nhập bằng user đó › Users › Profile › Application Passwords › đặt tên "Duy Ơi" › Add. Dán mật khẩu vào đây.</li>
      </ol>
      <div class="form-grid">
        <label>User WordPress của app <input name="wpUser" value="${esc(s.wpUser || "")}" placeholder="duyoi-bot" autocomplete="off"></label>
        <label>Application Password <input name="appPassword" type="password" autocomplete="off" placeholder="Đang tải…"></label>
      </div>
      <div class="msg" id="wp-msg" hidden></div>
      <div class="toolbar"><button class="primary" type="submit">Lưu kết nối</button><button type="button" id="wp-test">Thử kết nối</button><button type="button" class="danger" id="wp-clear" hidden>Xoá mật khẩu</button></div>
    </form>` : ""}
  </div>`;
  if (site && site.platform !== "astro") bindWp(site);
  const form = $("#site-form");
  const sync = () => {
    const p = form.platform.value;
    $('[data-for="astro"]', form).hidden = p !== "astro";
  };
  form.platform.addEventListener("change", sync);
  sync();
  form.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const d = formData(form);
    if (d.platform !== "astro") d.repo = "";
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

async function bindWp(site) {
  const f = $("#wp-form");
  const msg = $("#wp-msg");
  const load = async () => {
    const st = await api(`/api/sites/${site.id}/wp`);
    f.appPassword.value = "";
    f.appPassword.placeholder = st.password.set ? `Đã lưu ${st.password.hint} · nhập để thay` : "xxxx xxxx xxxx xxxx xxxx xxxx";
    $("#wp-clear").hidden = !st.password.set;
  };
  load().catch((e) => showMsg(msg, e.message));
  f.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const d = formData(f);
    await busy(f.querySelector("button[type=submit]"), "Đang lưu…", async () => {
      try { await api(`/api/sites/${site.id}/wp`, { method: "PUT", body: { wpUser: d.wpUser, appPassword: d.appPassword || undefined } }); await load(); showMsg(msg, "Đã lưu (mật khẩu được mã hoá).", "ok"); }
      catch (e) { showMsg(msg, e.message); }
    });
  });
  $("#wp-test").addEventListener("click", (ev) => busy(ev.currentTarget, "Đang thử…", async () => {
    try {
      const r = await api(`/api/sites/${site.id}/wp/test`, { method: "POST" });
      const i = r.info;
      showMsg(msg, `Kết nối được: plugin ${i.version}, WordPress ${i.wp || "?"}, user ${i.user}. ${[i.elementor && "Elementor", i.rankmath && "Rank Math", i.flyingpress && "FlyingPress"].filter(Boolean).join(", ") || ""}`.trim(), "ok");
    } catch (e) { showMsg(msg, e.message); }
  }));
  $("#wp-clear").addEventListener("click", (ev) => busy(ev.currentTarget, "Đang xoá…", async () => {
    try { await api(`/api/sites/${site.id}/wp`, { method: "PUT", body: { wpUser: f.wpUser.value || site.wpUser || "duyoi-bot", appPassword: null } }); await load(); showMsg(msg, "Đã xoá mật khẩu.", "ok"); }
    catch (e) { showMsg(msg, e.message); }
  }));
}

// ---------------- Cài đặt ----------------

const MODEL_FIELDS = [
  ["model_free", "Tầng Free (dữ liệu công khai)"],
  ["model_free_private", "Tầng Free riêng tư (thư, GSC)"],
  ["model_t0", "T0 · trích xuất, brief"],
  ["model_t1", "T1 · viết bài, email"],
  ["model_t2", "T2 · humanizer, chỉnh giọng"],
  ["model_t3", "T3 · kế hoạch, Trưởng nhóm"],
  ["model_writer", "Viết bài và sửa bài (nên dùng model viết tự nhiên, ví dụ Claude Sonnet)"],
  ["model_image", "Ảnh bài viết (trả phí)"]
];

const SECRET_HELP = {
  openrouter_api_key: "openrouter.ai › Keys. Đặt giới hạn chi tiêu ngay trên OpenRouter.",
  dataforseo_login: "app.dataforseo.com › API Access",
  dataforseo_password: "Mật khẩu API (khác mật khẩu đăng nhập web)",
  groq_api_key: "console.groq.com › API Keys (model free riêng tư)",
  cloudflare_api_token: "Quyền: Account › Workers R2 Storage Edit + Workers Scripts Edit (kho ảnh, bộ đo site Astro) + Account Analytics Read (đọc số liệu); Zone › Zone Read + Workers Routes Edit + DNS Edit, chỉ các zone của site. Điền Account ID ở tab Model AI & chi phí.",
  google_api_key: "Knowledge Graph Search API (cho tab Entity)",
  github_token: "github.com › Settings › Developer settings › Fine-grained tokens. Chỉ chọn repo các site; quyền Contents: Read and write, Pull requests: Read and write.",
  google_service_account: "Google Cloud › IAM › Service accounts › Keys › JSON. Bật Search Console API và Google Analytics Data API, rồi thêm email service account vào property GSC (Restricted) và GA4 (Viewer)."
};

async function viewSettings(main, args = []) {
  if (args[0] === "keys" || args[0] === "models" || args[0] === "report") state.tabs.settings = args[0];
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
    <div class="card tabbed">
      ${tabsNav("settings", [["keys", "API key", "shield"], ["models", "Model AI & chi phí", "sliders"], ["report", "Báo cáo tuần", "clock"]], "keys")}
      <div class="tab-body" ${panelAttr("settings", "keys", "keys")}>
      ${Object.entries(s.secrets).map(([k, info]) => `
        <div class="secret-row">
          <div><b>${esc(info.label)}</b><small>${info.set ? `Đã lưu ${esc(info.hint)} · ${esc(fmtTime(info.updatedAt))}` : "Chưa có"}</small></div>
          <div><input type="password" autocomplete="off" data-secret="${k}" placeholder="${info.set ? "Nhập để thay key mới" : "Dán key vào đây"}" ${admin && s.encryptionReady ? "" : "disabled"}><small class="note">${esc(SECRET_HELP[k] || "")}</small></div>
          <div class="toolbar">${admin ? `<button type="button" data-save="${k}" ${s.encryptionReady ? "" : "disabled"}>Lưu</button>${info.set ? `<button type="button" class="danger" data-clear="${k}">Xoá</button>` : ""}` : ""}</div>
        </div>`).join("")}
      <div class="msg" id="secret-msg" hidden></div>
      </div>
    <form class="tab-body" id="values-form" novalidate ${panelAttr("settings", "models", "keys")}><h3 class="sub">Model AI theo tầng (rẻ trước)</h3>
      <div class="form-grid">${MODEL_FIELDS.map(([k, l]) => `<label>${esc(l)}<input name="${k}" value="${esc(v[k])}" ${admin ? "" : "disabled"}></label>`).join("")}</div>
      <label class="check"><input type="checkbox" name="free_models_enabled" ${v.free_models_enabled ? "checked" : ""} ${admin ? "" : "disabled"}><span>Dùng model free cho việc nền<small>Dữ liệu riêng (thư, GSC, GA4) không bao giờ gửi tới OpenRouter free.</small></span></label>
      <h3 class="sub">Trần chi phí</h3>
      <div class="form-grid">
        <label>Ngưỡng lượt free trước khi đổi sang trả phí (%) <input type="number" name="free_guard_percent" min="50" max="100" value="${esc(v.free_guard_percent)}" ${admin ? "" : "disabled"}></label>
        <label>Múi giờ hiển thị <input name="timezone" value="${esc(v.timezone)}" ${admin ? "" : "disabled"}></label>
        <label>Trần OpenRouter mỗi tháng (USD) <input type="number" name="openrouter_monthly_cap_usd" min="0" step="1" value="${esc(v.openrouter_monthly_cap_usd)}" ${admin ? "" : "disabled"}></label>
        <label>Trần AI mỗi site trong 24 giờ (USD) <input type="number" name="ai_site_daily_cap_usd" min="0" step="0.5" value="${esc(v.ai_site_daily_cap_usd)}" ${admin ? "" : "disabled"}></label>
        <label>Cloudflare Account ID (kho ảnh site Astro) <input name="cloudflare_account_id" value="${esc(v.cloudflare_account_id === "-" ? "" : v.cloudflare_account_id)}" maxlength="32" placeholder="32 ký tự, ở trang tổng quan tài khoản Cloudflare" ${admin ? "" : "disabled"}></label>
        <label>Trần DataForSEO mỗi tháng (USD) <input type="number" name="dataforseo_monthly_cap_usd" min="0" step="1" value="${esc(v.dataforseo_monthly_cap_usd)}" ${admin ? "" : "disabled"}></label>
      </div>
      <div class="msg" id="values-msg" hidden></div>
      ${admin ? `<div class="toolbar"><button class="primary" type="submit">Lưu cài đặt</button></div>` : ""}
    </form>
    <div class="tab-body" id="report-pane" ${panelAttr("settings", "report", "keys")}><p class="note">Đang tải…</p></div>
    </div>
  </div>`;
  bindTabs(main, "settings");
  mountReport($("#report-pane", main), admin);
  // Mở từ Tổng quan: đưa con trỏ vào đúng ô key cần nhập
  const want = args[1] && $(`[data-secret="${CSS.escape(args[1])}"]`, main);
  if (want && !want.disabled) { want.scrollIntoView({ block: "center" }); want.focus({ preventScroll: true }); want.closest(".secret-row").classList.add("hl"); }

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

async function viewAccount(main, args = []) {
  if (args[0] === "security" || args[0] === "info") state.tabs.account = args[0];
  const { sessions } = await api("/api/auth/sessions");
  const u = state.user;
  main.innerHTML = `
  <div class="page">
    <div class="page-head"><div><h2>Tài khoản</h2><p>Thông tin đăng nhập và bảo mật của anh.</p></div></div>
    <div class="card tabbed">
      ${tabsNav("account", [["info", "Tài khoản", "user"], ["security", "Bảo mật", "shield"]], "info")}
      <div class="tab-body" ${panelAttr("account", "info", "info")}>
        <div class="profile"><span class="avatar xl" aria-hidden="true">${esc(initials(u.name))}</span>
          <div><b>${esc(u.name)}</b><small>${esc(ROLE_NAME[u.role] || u.role)}</small><p class="note">Tên, email và quyền do admin quản lý ở màn Thành viên.</p></div></div>
        <div class="form-grid">
          <label>Tên hiển thị <input value="${esc(u.name)}" readonly></label>
          <label>Email đăng nhập <input value="${esc(u.email)}" readonly></label>
          <label>Quyền <input value="${esc(ROLE_NAME[u.role] || u.role)}" readonly></label>
          <label>Trạng thái <input value="Đang hoạt động" readonly></label>
        </div>
      </div>
      <div class="tab-body" ${panelAttr("account", "security", "info")}>
        <form class="pw-grid" id="pw-form" novalidate>
          <div class="pw-fields">
            <label>Mật khẩu hiện tại <input name="current" type="password" autocomplete="current-password" required></label>
            <label>Mật khẩu mới (ít nhất 10 ký tự) <input name="next" type="password" autocomplete="new-password" required minlength="10"></label>
            <label>Nhập lại mật khẩu mới <input name="next2" type="password" autocomplete="new-password" required minlength="10"></label>
            <div class="msg" id="pw-msg" hidden></div>
            <div class="toolbar"><button class="primary" type="submit">Đổi mật khẩu</button></div>
            <p class="note">Đổi xong, các thiết bị khác sẽ bị đăng xuất.</p>
          </div>
          <div class="pw-side"><span class="lock-ic">${icon(ICON.shield)}</span><b>Giữ tài khoản an toàn</b><p class="note">Dùng mật khẩu dài, không trùng với site khác. Nếu thấy phiên lạ bên dưới, đổi mật khẩu để đăng xuất tất cả.</p></div>
        </form>
        <h3 class="sub">${icon(ICON.list)}Phiên đang đăng nhập</h3>
        <div class="tablewrap boxed"><table><thead><tr><th>Thiết bị</th><th>Từ</th><th>Hết hạn</th></tr></thead><tbody>
          ${sessions.map((x) => `<tr><td>${esc((x.userAgent || "—").slice(0, 60))}${x.current ? ` <span class="tag ok">thiết bị này</span>` : ""}<small>${esc(x.ip || "")}</small></td><td>${esc(fmtTime(x.createdAt))}</td><td>${esc(fmtTime(x.expiresAt))}</td></tr>`).join("")}
        </tbody></table></div>
      </div>
    </div>
  </div>`;
  bindTabs(main, "account");
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

// ---------------- Thành viên ----------------

const ROLE = { admin: "Admin", editor: "Biên tập", viewer: "Chỉ xem" };
const ROLE_HELP = {
  admin: "Toàn quyền: cài đặt, API key, thành viên, tạm dừng hệ thống.",
  editor: "Thêm và sửa site, làm việc với agent. Không vào Cài đặt và Thành viên.",
  viewer: "Chỉ xem số liệu và nhật ký, không sửa gì."
};
const ROLE_ICON = { admin: "shield", editor: "pen", viewer: "user" };
const roleOptions = (cur) => Object.entries(ROLE).map(([k, l]) => `<option value="${k}"${k === cur ? " selected" : ""}>${esc(l)}</option>`).join("");

// Mật khẩu tạm ngẫu nhiên, bỏ các ký tự dễ nhầm (0/O, 1/l/I)
function tempPassword(len = 14) {
  const chars = "abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const buf = new Uint32Array(len);
  crypto.getRandomValues(buf);
  return [...buf].map((n) => chars[n % chars.length]).join("");
}

function memberStatus(u) {
  if (u.disabled) return `<span class="tag">Đã khoá</span>`;
  if (u.mustChangePassword) return `<span class="tag warn">Chờ đổi mật khẩu</span>`;
  return `<span class="tag ok">Đang hoạt động</span>`;
}

async function viewMembers(main, args) {
  const { users } = await api("/api/users");
  const mode = args[0] === "new" ? "new" : args[0] ? users.find((u) => String(u.id) === args[0]) : null;
  main.innerHTML = `
  <div class="page">
    <div class="page-head">
      <div><h2>Thành viên</h2><p>Người được vào app và quyền của từng người. Người mới nhận mật khẩu tạm và phải đổi ở lần đăng nhập đầu.</p></div>
      <div class="toolbar"><a class="btn primary" href="#/members/new">${icon(ICON.plus)}Thêm thành viên</a></div>
    </div>
    ${mode === "new" ? memberNewForm() : mode ? memberEditForm(mode) : ""}
    <div class="card">
      <div class="tablewrap"><table>
        <thead><tr><th>Thành viên</th><th>Quyền</th><th>Trạng thái</th><th>Đăng nhập lần cuối</th></tr></thead>
        <tbody>${users.map((u) => `<tr class="click" data-id="${u.id}" tabindex="0">
          <td><div class="member"><span class="avatar sm">${esc(initials(u.name))}</span><span><b>${esc(u.name)}${u.id === state.user.id ? ` <span class="tag ok">anh</span>` : ""}</b><small>${esc(u.email)}</small></span></div></td>
          <td><span class="role r-${esc(u.role)}">${icon(ICON[ROLE_ICON[u.role]])}${esc(ROLE[u.role] || u.role)}</span></td>
          <td>${memberStatus(u)}</td>
          <td>${esc(u.lastLoginAt ? ago(u.lastLoginAt) : "chưa đăng nhập")}</td></tr>`).join("")}</tbody>
      </table></div>
    </div>
    <div class="card"><h3>Quyền làm được gì</h3>
      <div class="roles">${Object.entries(ROLE).map(([k, l]) => `<div><span class="role r-${k}">${icon(ICON[ROLE_ICON[k]])}${esc(l)}</span><p class="note">${esc(ROLE_HELP[k])}</p></div>`).join("")}</div>
    </div>
  </div>`;
  $$("tr.click", main).forEach((tr) => {
    const open = () => { location.hash = `#/members/${tr.dataset.id}`; };
    tr.addEventListener("click", open);
    tr.addEventListener("keydown", (e) => { if (e.key === "Enter") open(); });
  });
  if (mode === "new") bindMemberNew();
  else if (mode) bindMemberEdit(mode);
}

function memberNewForm() {
  return `<form class="card" id="member-new" novalidate><h3>Thêm thành viên</h3>
    <div class="form-grid">
      <label>Tên hiển thị <input name="name" required minlength="2" maxlength="80" autocomplete="off"></label>
      <label>Email đăng nhập <input name="email" type="email" required autocomplete="off"></label>
      <label>Quyền <select name="role">${roleOptions("editor")}</select><small class="note" id="role-help">${esc(ROLE_HELP.editor)}</small></label>
      <label>Mật khẩu tạm (ít nhất 10 ký tự)
        <span class="input-row"><input name="password" required minlength="10" autocomplete="off" value="${esc(tempPassword())}"><button type="button" id="gen-pw">Tạo mới</button></span>
        <small class="note">Gửi riêng cho người đó (Zalo, gặp trực tiếp). Họ sẽ phải đổi khi đăng nhập lần đầu.</small></label>
    </div>
    <div class="msg" id="member-msg" hidden></div>
    <div class="toolbar"><button class="primary" type="submit">Thêm thành viên</button><a class="btn" href="#/members">Huỷ</a></div>
  </form>`;
}

function bindMemberNew() {
  const form = $("#member-new");
  form.name.focus();
  form.role.addEventListener("change", () => { $("#role-help").textContent = ROLE_HELP[form.role.value]; });
  $("#gen-pw").addEventListener("click", () => { form.password.value = tempPassword(); });
  form.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const d = formData(form);
    await busy(form.querySelector("button[type=submit]"), "Đang thêm…", async () => {
      try {
        const res = await api("/api/users", { method: "POST", body: d });
        form.outerHTML = credentialsCard(res.user, d.password, "Đã thêm thành viên");
        bindCredentials();
        reloadMemberTable();
      } catch (e) { showMsg($("#member-msg"), e.message); }
    });
  });
}

// Hiện thông tin đăng nhập một lần để admin gửi đi; app không lưu mật khẩu gốc.
function credentialsCard(u, password, title) {
  const text = `Link: ${location.origin}\nEmail: ${u.email}\nMật khẩu tạm: ${password}`;
  return `<div class="card cred-card"><h3>${esc(title)}</h3>
    <p class="note">Mật khẩu tạm chỉ hiện lần này. Anh gửi riêng cho ${esc(u.name)}; lần đầu đăng nhập họ sẽ đặt mật khẩu mới.</p>
    <pre class="cred" id="cred-text">${esc(text)}</pre>
    <div class="toolbar"><button type="button" class="primary" id="copy-cred">Sao chép</button><a class="btn" href="#/members">Xong</a></div>
    <div class="msg" id="cred-msg" hidden></div>
  </div>`;
}

function bindCredentials() {
  $("#copy-cred").addEventListener("click", async () => {
    try { await navigator.clipboard.writeText($("#cred-text").textContent); showMsg($("#cred-msg"), "Đã sao chép.", "ok"); }
    catch { showMsg($("#cred-msg"), "Trình duyệt chặn sao chép, anh bôi đen để copy nhé.", "warn"); }
  });
}

async function reloadMemberTable() {
  const main = $("#main");
  const card = $(".cred-card", main);
  const keep = card ? card.outerHTML : "";
  await viewMembers(main, []);
  if (keep) { $(".page-head", main).insertAdjacentHTML("afterend", keep); bindCredentials(); }
}

function memberEditForm(u) {
  const self = u.id === state.user.id;
  return `<form class="card" id="member-edit" novalidate><h3>${esc(u.name)}<small class="note"> · ${esc(u.email)}</small></h3>
    ${self ? `<div class="msg warn">Đây là tài khoản của anh: không tự đổi quyền, khoá hay xoá được. Mật khẩu đổi ở màn Tài khoản.</div>` : ""}
    <div class="form-grid">
      <label>Tên hiển thị <input name="name" required minlength="2" maxlength="80" value="${esc(u.name)}"></label>
      <label>Quyền <select name="role" ${self ? "disabled" : ""}>${roleOptions(u.role)}</select><small class="note" id="role-help">${esc(ROLE_HELP[u.role])}</small></label>
    </div>
    ${self ? "" : `<label class="check"><input type="checkbox" name="disabled" ${u.disabled ? "checked" : ""}><span>Khoá tài khoản<small>Người này bị đăng xuất ngay và không đăng nhập được cho tới khi mở khoá.</small></span></label>`}
    <div class="msg" id="member-msg" hidden></div>
    <div class="toolbar"><button class="primary" type="submit">Lưu thay đổi</button><a class="btn" href="#/members">Đóng</a>
      ${self ? "" : `<span class="spacer"></span><button type="button" id="reset-pw">Đặt lại mật khẩu</button><button type="button" class="danger" id="del-member">Xoá</button>`}</div>
  </form>`;
}

function bindMemberEdit(u) {
  const form = $("#member-edit");
  form.role.addEventListener("change", () => { $("#role-help").textContent = ROLE_HELP[form.role.value]; });
  form.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const d = formData(form);
    const body = { name: d.name };
    if (u.id !== state.user.id) { body.role = d.role; body.disabled = d.disabled; }
    await busy(form.querySelector("button[type=submit]"), "Đang lưu…", async () => {
      try {
        await api(`/api/users/${u.id}`, { method: "PUT", body });
        if (u.id === state.user.id) state.user.name = d.name;
        await viewMembers($("#main"), [String(u.id)]);
        showMsg($("#member-msg"), "Đã lưu.", "ok");
      } catch (e) { showMsg($("#member-msg"), e.message); }
    });
  });
  if (u.id === state.user.id) return;
  $("#reset-pw").addEventListener("click", async (ev) => {
    const password = tempPassword();
    await busy(ev.currentTarget, "Đang đặt lại…", async () => {
      try {
        await api(`/api/users/${u.id}/password`, { method: "POST", body: { password } });
        form.outerHTML = credentialsCard(u, password, "Đã đặt lại mật khẩu");
        bindCredentials();
        reloadMemberTable();
      } catch (e) { showMsg($("#member-msg"), e.message); }
    });
  });
  // Bấm hai lần để xoá, tránh bấm nhầm
  const del = $("#del-member");
  del.addEventListener("click", async () => {
    if (!del.dataset.armed) { del.dataset.armed = "1"; del.textContent = "Bấm lần nữa để xoá"; return; }
    try {
      await api(`/api/users/${u.id}`, { method: "DELETE" });
      location.hash = "#/members";
    } catch (e) { showMsg($("#member-msg"), e.message); }
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

// ---------------- Lộ trình: các màn chưa làm ----------------

function viewRoadmap(main) {
  const items = MENU.flatMap((g) => g.items.filter((i) => !i.live).map((i) => ({ ...i, group: g.group })));
  const byPhase = {};
  for (const i of items) (byPhase[i.phase] ||= []).push(i);
  main.innerHTML = `
  <div class="page">
    <div class="page-head"><div><h2>Lộ trình</h2><p>Các màn chưa làm. Không hiện trên menu để menu gọn; khi làm xong sẽ lên menu.</p></div></div>
    ${Object.keys(byPhase).sort().map((ph) => `<div class="card soon-card"><span class="phase">${esc(PHASES[ph] || "")}</span>
      ${byPhase[ph].map((i) => `<h3>${esc(i.label)} <small class="note">${esc(i.group)}</small></h3><ul>${(i.plan || []).map((p) => `<li>${esc(p)}</li>`).join("")}</ul>`).join("")}</div>`).join("")}
  </div>`;
}

// ---------------- Màn của giai đoạn sau ----------------

function viewSoon(main, _args, item) {
  main.innerHTML = `
  <div class="page">
    <div class="page-head"><div><h2>${esc(item.label)}</h2><p>Sắp có. Màn này nằm trong ${esc(PHASES[item.phase] || "giai đoạn sau")}.</p></div></div>
    <div class="card soon-card">
      <span class="phase">${esc(PHASES[item.phase] || "")}</span>
      <h3>Sẽ có</h3>
      <ul>${(item.plan || []).map((p) => `<li>${esc(p)}</li>`).join("")}</ul>
      <p class="note">Giao diện và cách hoạt động theo bản demo đã duyệt; dữ liệu lấy từ site và API key thật của anh.</p>
    </div>
  </div>`;
}

boot();
