// Kiểm thử luồng API giai đoạn 1: tạo admin, đăng nhập, khoá khi sai nhiều lần, site, cài đặt mã hoá, tạm dừng, cron.
// Chạy: npm test  (cần Node 22.5+ vì dùng node:sqlite)

import assert from "node:assert/strict";
import { loadWorker, makeEnv } from "./harness.mjs";
import { fakeSite } from "./fake-site.mjs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const worker = await loadWorker();
const BASE = "https://duyoi.duy.digital";
let passed = 0;

function client(env) {
  let cookie = "";
  return async function call(method, path, body, { origin = BASE, ip = "1.1.1.1", ...extra } = {}) {
    const headers = { "CF-Connecting-IP": ip };
    if (origin) headers.Origin = origin;
    if (cookie) headers.Cookie = cookie;
    const raw = body instanceof Uint8Array;
    if (body !== undefined) headers["Content-Type"] = raw ? extra["Content-Type"] : "application/json";
    const res = await worker.fetch(new Request(BASE + path, { method, headers, body: body !== undefined ? (raw ? body : JSON.stringify(body)) : undefined }), env);
    const set = res.headers.get("Set-Cookie");
    if (set) cookie = set.split(";")[0].endsWith("=") ? "" : set.split(";")[0];
    let data = null;
    try { data = await res.json(); } catch { /* không phải JSON */ }
    return { status: res.status, data, setCookie: set };
  };
}

async function test(name, fn) {
  try { await fn(); passed++; console.log("  ✓", name); }
  catch (e) { console.error("  ✗", name); throw e; }
}

console.log("Duy Ơi · API tests");

await test("setup status khi chưa có admin", async () => {
  const env = makeEnv();
  const r = await client(env)("GET", "/api/setup/status");
  assert.equal(r.status, 200);
  assert.equal(r.data.needsSetup, true);
  assert.equal(r.data.setupTokenConfigured, true);
});

await test("thiếu SETUP_TOKEN thì không tạo được admin", async () => {
  const env = makeEnv({ SETUP_TOKEN: undefined });
  const r = await client(env)("POST", "/api/setup", { setupToken: "x", name: "Duy", email: "duy@example.com", password: "mat-khau-dai-123" });
  assert.equal(r.status, 503);
});

const env = makeEnv();
const call = client(env);

await test("sai mã cài đặt bị từ chối", async () => {
  const r = await call("POST", "/api/setup", { setupToken: "sai-ma", name: "Duy", email: "duy@example.com", password: "mat-khau-dai-123" });
  assert.equal(r.status, 403);
});

await test("mật khẩu ngắn bị từ chối", async () => {
  const r = await call("POST", "/api/setup", { setupToken: "test-setup-token-123", name: "Duy", email: "duy@example.com", password: "ngan" });
  assert.equal(r.status, 400);
});

await test("request khác origin bị chặn (CSRF)", async () => {
  const r = await call("POST", "/api/setup", { setupToken: "test-setup-token-123", name: "Duy", email: "duy@example.com", password: "mat-khau-dai-123" }, { origin: "https://evil.example" });
  assert.equal(r.status, 403);
  assert.equal(r.data.error, "bad_origin");
});

await test("tạo admin đầu tiên, nhận cookie phiên HttpOnly", async () => {
  const r = await call("POST", "/api/setup", { setupToken: "test-setup-token-123", name: "Duy", email: "Duy@Example.com", password: "mat-khau-dai-123" });
  assert.equal(r.status, 201);
  assert.equal(r.data.user.email, "duy@example.com");
  assert.equal(r.data.user.role, "admin");
  assert.match(r.setCookie, /HttpOnly/);
  assert.match(r.setCookie, /SameSite=Strict/);
  assert.match(r.setCookie, /Secure/);
});

await test("không tạo được admin thứ hai qua setup", async () => {
  const other = client(env);
  const r = await other("POST", "/api/setup", { setupToken: "test-setup-token-123", name: "X", email: "x@example.com", password: "mat-khau-dai-123" });
  assert.equal(r.status, 409);
  const s = await other("GET", "/api/setup/status");
  assert.equal(s.data.needsSetup, false);
});

await test("mật khẩu lưu dạng PBKDF2, không lưu bản gốc", async () => {
  const row = env.DB.raw.prepare("SELECT password_hash FROM users").get();
  assert.match(row.password_hash, /^pbkdf2\$sha256\$100000\$/);
  assert.ok(!row.password_hash.includes("mat-khau-dai-123"));
  const sess = env.DB.raw.prepare("SELECT id FROM sessions").get();
  assert.equal(sess.id.length, 64); // chỉ lưu SHA-256 của token
});

await test("me trả về người dùng đang đăng nhập", async () => {
  const r = await call("GET", "/api/auth/me");
  assert.equal(r.status, 200);
  assert.equal(r.data.user.name, "Duy");
});

await test("API cần đăng nhập trả 401 khi chưa có phiên", async () => {
  const anon = client(env);
  for (const p of ["/api/dashboard", "/api/sites", "/api/settings", "/api/activity"]) {
    const r = await anon("GET", p);
    assert.equal(r.status, 401, p);
  }
});

await test("đăng nhập sai 5 lần thì bị khoá 15 phút", async () => {
  const c = client(env);
  for (let i = 0; i < 5; i++) {
    const r = await c("POST", "/api/auth/login", { email: "duy@example.com", password: "sai-mat-khau" }, { ip: "9.9.9.9" });
    assert.equal(r.status, 401);
  }
  const locked = await c("POST", "/api/auth/login", { email: "duy@example.com", password: "mat-khau-dai-123" }, { ip: "9.9.9.9" });
  assert.equal(locked.status, 429);
  // xoá lượt sai để các test sau đăng nhập được
  env.DB.raw.exec("DELETE FROM login_attempts");
});

await test("email không tồn tại trả cùng thông báo như sai mật khẩu", async () => {
  const r = await client(env)("POST", "/api/auth/login", { email: "khongco@example.com", password: "gi-cung-duoc-1" }, { ip: "8.8.8.8" });
  assert.equal(r.status, 401);
  assert.equal(r.data.error, "bad_credentials");
});

await test("thêm, sửa, liệt kê site", async () => {
  const bad = await call("POST", "/api/sites", { name: "X", domain: "khong hop le", platform: "astro" });
  assert.equal(bad.status, 400);
  const r = await call("POST", "/api/sites", { name: "Golf Garage Lab", domain: "https://www.GolfGarageLab.com/abc", platform: "astro", siteType: "affiliate", market: "us", language: "en", repo: "duycan2000/golfgaragelab.com" });
  assert.equal(r.status, 201);
  assert.equal(r.data.site.domain, "golfgaragelab.com");
  assert.equal(r.data.site.market, "US");
  const dup = await call("POST", "/api/sites", { name: "Golf 2", domain: "golfgaragelab.com", platform: "astro" });
  assert.equal(dup.status, 409);
  const wp = await call("POST", "/api/sites", { name: "Duy Digital", domain: "duy.digital", platform: "wordpress", siteType: "service", market: "AU", wpUser: "duyoi-bot" });
  assert.equal(wp.status, 201);
  const up = await call("PUT", `/api/sites/${r.data.site.id}`, { status: "paused", notes: "Không viết 'we tested'." });
  assert.equal(up.status, 200);
  assert.equal(up.data.site.status, "paused");
  const list = await call("GET", "/api/sites");
  assert.equal(list.data.sites.length, 2);
  const arch = await call("PUT", `/api/sites/${wp.data.site.id}`, { status: "archived" });
  assert.equal(arch.status, 200);
  assert.equal((await call("GET", "/api/sites")).data.sites.length, 1);
  assert.equal((await call("GET", "/api/sites?archived=1")).data.sites.length, 2);
});

await test("API key được mã hoá, chỉ trả gợi ý", async () => {
  const key = "sk-or-v1-abcdef1234567890ZZ9Y";
  const r = await call("PUT", "/api/settings", { secrets: { openrouter_api_key: key } });
  assert.equal(r.status, 200);
  assert.equal(r.data.secrets.openrouter_api_key.set, true);
  assert.equal(r.data.secrets.openrouter_api_key.hint, "…ZZ9Y");
  assert.ok(!JSON.stringify(r.data).includes(key));
  const row = env.DB.raw.prepare("SELECT ciphertext FROM secrets WHERE key = 'openrouter_api_key'").get();
  assert.ok(!row.ciphertext.includes("abcdef"));
  const act = env.DB.raw.prepare("SELECT detail FROM activity WHERE action = 'settings.updated'").get();
  assert.ok(!act.detail.includes(key));
  // giải mã đúng bằng hàm nội bộ
  const { readSecret } = await import(new URL("../.test-build/settings.js", import.meta.url).href);
  assert.equal(await readSecret(env, "openrouter_api_key"), key);
  // xoá key
  const del = await call("PUT", "/api/settings", { secrets: { openrouter_api_key: null } });
  assert.equal(del.data.secrets.openrouter_api_key.set, false);
});

await test("không có ENCRYPTION_KEY thì từ chối lưu key", async () => {
  const env2 = makeEnv({ ENCRYPTION_KEY: undefined });
  const c = client(env2);
  await c("POST", "/api/setup", { setupToken: "test-setup-token-123", name: "Duy", email: "duy@example.com", password: "mat-khau-dai-123" });
  const r = await c("PUT", "/api/settings", { secrets: { groq_api_key: "gsk_123456789012345678" } });
  assert.equal(r.status, 503);
  const s = await c("GET", "/api/settings");
  assert.equal(s.data.encryptionReady, false);
  assert.equal(s.data.encryptionProblem, "missing");
});

await test("ENCRYPTION_KEY sai định dạng được báo riêng", async () => {
  const env3 = makeEnv({ ENCRYPTION_KEY: "mot-mat-khau-thuong" });
  const c = client(env3);
  await c("POST", "/api/setup", { setupToken: "test-setup-token-123", name: "Duy", email: "duy@example.com", password: "mat-khau-dai-123" });
  const s = await c("GET", "/api/settings");
  assert.equal(s.data.encryptionProblem, "invalid");
  const r = await c("PUT", "/api/settings", { secrets: { groq_api_key: "gsk_123456789012345678" } });
  assert.equal(r.status, 503);
  assert.match(r.data.message, /sai định dạng/);
});

await test("cài đặt thường được kiểm tra kiểu dữ liệu", async () => {
  assert.equal((await call("PUT", "/api/settings", { values: { free_guard_percent: 20 } })).status, 400);
  assert.equal((await call("PUT", "/api/settings", { values: { khong_co: 1 } })).status, 400);
  assert.equal((await call("PUT", "/api/settings", { values: { cron_last_run: 1 } })).status, 400);
  const ok = await call("PUT", "/api/settings", { values: { free_guard_percent: 85, model_t1: "deepseek/deepseek-v4-pro", free_models_enabled: false } });
  assert.equal(ok.status, 200);
  assert.equal(ok.data.values.free_guard_percent, 85);
  assert.equal(ok.data.values.free_models_enabled, false);
});

await test("tạm dừng hệ thống và cron ghi nhịp", async () => {
  const p = await call("POST", "/api/system/pause", { paused: true });
  assert.equal(p.data.paused, true);
  let d = await call("GET", "/api/dashboard");
  assert.equal(d.data.paused, true);
  assert.equal(d.data.cronLastRun, null);
  const waits = [];
  await worker.scheduled({ cron: "*/15 * * * *", scheduledTime: Date.now() }, env, { waitUntil: (pr) => waits.push(pr) });
  await Promise.all(waits);
  d = await call("GET", "/api/dashboard");
  assert.ok(d.data.cronLastRun > 0);
  assert.ok(d.data.checklist.find((c) => c.id === "cron").done);
  await call("POST", "/api/system/pause", { paused: false });
});

await test("đổi mật khẩu đăng xuất các phiên khác", async () => {
  const other = client(env);
  const lg = await other("POST", "/api/auth/login", { email: "duy@example.com", password: "mat-khau-dai-123" }, { ip: "2.2.2.2" });
  assert.equal(lg.status, 200);
  const wrong = await call("POST", "/api/auth/password", { current: "sai", next: "mat-khau-moi-456" });
  assert.equal(wrong.status, 400);
  const ch = await call("POST", "/api/auth/password", { current: "mat-khau-dai-123", next: "mat-khau-moi-456" });
  assert.equal(ch.status, 200);
  assert.equal((await other("GET", "/api/auth/me")).status, 401);
  assert.equal((await call("GET", "/api/auth/me")).status, 200);
});

await test("admin thêm thành viên; người mới phải đổi mật khẩu tạm trước", async () => {
  const add = await call("POST", "/api/users", { name: "Lan", email: "lan@example.com", role: "editor", password: "tam-thoi-12345" });
  assert.equal(add.status, 201);
  assert.equal(add.data.user.mustChangePassword, true);
  assert.equal(add.data.user.password_hash, undefined);
  assert.equal((await call("POST", "/api/users", { name: "Lan 2", email: "LAN@example.com", role: "viewer", password: "tam-thoi-12345" })).status, 409);
  assert.equal((await call("POST", "/api/users", { name: "X", email: "x@example.com", role: "boss", password: "tam-thoi-12345" })).status, 400);
  const lan = client(env);
  const lg = await lan("POST", "/api/auth/login", { email: "lan@example.com", password: "tam-thoi-12345" }, { ip: "3.3.3.3" });
  assert.equal(lg.status, 200);
  assert.equal(lg.data.user.mustChangePassword, true);
  assert.equal((await lan("GET", "/api/sites")).status, 403);
  assert.equal((await lan("POST", "/api/auth/password", { current: "tam-thoi-12345", next: "tam-thoi-12345" })).status, 400);
  assert.equal((await lan("POST", "/api/auth/password", { current: "tam-thoi-12345", next: "lan-mat-khau-moi" })).status, 200);
  assert.equal((await lan("GET", "/api/sites")).status, 200);
  assert.equal((await lan("GET", "/api/users")).status, 403);
  assert.equal((await lan("POST", "/api/users", { name: "Hack", email: "h@example.com", role: "admin", password: "tam-thoi-12345" })).status, 403);
});

await test("đổi quyền, khoá, đặt lại mật khẩu, xoá thành viên; giữ admin cuối", async () => {
  const list = await call("GET", "/api/users");
  const me = list.data.users.find((u) => u.email === "duy@example.com");
  const lan = list.data.users.find((u) => u.email === "lan@example.com");
  assert.equal((await call("PUT", `/api/users/${me.id}`, { role: "viewer" })).status, 400);
  assert.equal((await call("PUT", `/api/users/${me.id}`, { disabled: true })).status, 400);
  assert.equal((await call("DELETE", `/api/users/${me.id}`)).status, 400);
  const lanC = client(env);
  await lanC("POST", "/api/auth/login", { email: "lan@example.com", password: "lan-mat-khau-moi" }, { ip: "3.3.3.3" });
  const up = await call("PUT", `/api/users/${lan.id}`, { role: "viewer" });
  assert.equal(up.data.user.role, "viewer");
  assert.equal((await lanC("GET", "/api/auth/me")).status, 401);
  await call("PUT", `/api/users/${lan.id}`, { disabled: true });
  const blocked = await lanC("POST", "/api/auth/login", { email: "lan@example.com", password: "lan-mat-khau-moi" }, { ip: "3.3.3.3" });
  assert.equal(blocked.status, 403);
  await call("PUT", `/api/users/${lan.id}`, { disabled: false, role: "admin" });
  assert.equal((await call("POST", `/api/users/${lan.id}/password`, { password: "dat-lai-123456" })).status, 200);
  const re = await lanC("POST", "/api/auth/login", { email: "lan@example.com", password: "dat-lai-123456" }, { ip: "3.3.3.3" });
  assert.equal(re.data.user.mustChangePassword, true);
  assert.equal((await call("DELETE", `/api/users/${lan.id}`)).status, 200);
  assert.equal((await call("GET", "/api/users")).data.users.length, 1);
  const act = await call("GET", "/api/activity?limit=20");
  assert.ok(act.data.activity.some((a) => a.action === "user.created"));
  assert.ok(!JSON.stringify(act.data).includes("tam-thoi-12345"));
});

await test("đăng xuất xoá phiên", async () => {
  const r = await call("POST", "/api/auth/logout");
  assert.equal(r.status, 200);
  assert.match(r.setCookie, /Max-Age=0/);
  assert.equal((await call("GET", "/api/auth/me")).status, 401);
});

// ---------------- Phục hồi thứ hạng (site giả, không ra mạng) ----------------

await test("phục hồi: quét site, chẩn đoán, lập việc có Gác cổng", async () => {
  const env2 = makeEnv({ SETUP_TOKEN: "setup-token-123456" });
  const c2 = client(env2);
  await c2("POST", "/api/setup", { setupToken: "setup-token-123456", name: "Duy", email: "duy@example.com", password: "mat-khau-dai-123" });
  const realFetch = globalThis.fetch;
  globalThis.fetch = fakeSite();
  try {
    const cr = await c2("POST", "/api/recovery", { url: "https://www.caddemo.de/", dropMonth: "2025-10", language: "de", rules: {
      blocklist: ["3DScan", "3D Scan"], blockedFilenames: ["3dscan.png"], commercialPaths: ["/cad-dienstleistung-tga/", "/cad-outsourcing-kosten-sparen/"], verifiedNumbers: ["Über 50% Kostenersparnis"]
    } });
    assert.equal(cr.status, 201);
    const g = await c2("GET", `/api/recovery/${cr.data.id}`);
    assert.equal(g.data.case.status, "ready", g.data.case.error);
    assert.ok(g.data.case.score < 100);
    const codes = g.data.findings.map((f) => f.code);
    for (const c of ["dead_end", "orphan_commercial", "blocklist", "markers_live", "thin", "http_errors", "timeline"]) assert.ok(codes.includes(c), `thiếu ${c}: ${codes}`);
    const tl = g.data.findings.find((f) => f.code === "timeline");
    assert.match(tl.title, /August 2025 spam update/);
    assert.equal(g.data.pages.find((p) => p.path === "/cad-dienstleistung-tga/").kind, "commercial");
    assert.equal(g.data.pages.find((p) => p.path === "/inventor-vs-solidworks/").kind, "informational");
    const link = g.data.tasks.find((t) => t.kind === "internal_links" && t.target_url.includes("cad-symbole"));
    assert.ok(link, "phải có việc chèn link cho bài CAD-Symbole");
    assert.equal(link.status, "proposed", JSON.stringify(link.gate));
    for (const e of link.payload.edits) {
      assert.ok(e.replace.startsWith(e.find), "replace phải giữ nguyên câu gốc");
      assert.match(e.replace, /<a href="\/cad-/);
      assert.doesNotMatch(e.replace, /Learn more|Related/);
    }
    assert.ok(link.payload.edits.length <= 3);
    assert.ok(g.data.tasks.some((t) => t.kind === "remove_blocked" && t.priority === 1));
    // Gác cổng chặn các trường hợp nguy hiểm
    const gate = await import(pathToFileURL(join(process.cwd(), ".test-build", "recovery-gate.js")).href);
    const rules = g.data.case.rules;
    const base = { find: "Die Zeichnungen sind klar.", type: "internal_link", target: "/cad-dienstleistung-tga/", anchor: "CAD-Dienstleistung TGA" };
    const ctx = { rules, pageNumbers: [], occurrences: () => 1, targetText: () => "CAD-Dienstleistung TGA" };
    assert.equal(gate.checkEdits([{ ...base, replace: base.find + " Learn more about our TGA services and the team that helps you." }], ctx).ok, false);
    assert.equal(gate.checkEdits([{ ...base, replace: base.find + " Das spart 40% Zeit." }], ctx).ok, false);
    assert.equal(gate.checkEdits([{ ...base, replace: base.find + " Über 50% Kostenersparnis mit <a href=\"/x/\">CAD-Dienstleistung TGA</a>." }], ctx).ok, true);
    assert.equal(gate.checkEdits([{ ...base, replace: base.find + " Wie bei 3DScan." }], ctx).ok, false);
    assert.equal(gate.checkEdits([{ ...base, replace: "Neuer Satz ohne Original." }], ctx).ok, false);
    assert.equal(gate.checkEdits([{ ...base, replace: base.find + " Passend dazu: <a>X</a>." }], { ...ctx, occurrences: () => 2 }).ok, false);
    // Disavow chỉ khi có danh sách domain
    assert.equal((await c2("GET", `/api/recovery/${cr.data.id}/disavow`)).status, 400);
    const ru = await c2("PUT", `/api/recovery/${cr.data.id}/rules`, { rules: { toxicDomains: "spam1.sg\ndomain:spam2.md\nhttps://www.spam3.top/x", linksBought: true } });
    assert.equal(ru.status, 200);
    const d = await c2("GET", `/api/recovery/${cr.data.id}/disavow`);
    assert.equal(d.status, 200);
    const g2 = await c2("GET", `/api/recovery/${cr.data.id}`);
    const dis = g2.data.tasks.find((t) => t.kind === "disavow");
    assert.deepEqual(dis.payload.domains, ["spam1.sg", "spam2.md", "spam3.top"]);
    assert.equal(dis.risk, "irreversible");
    // Duyệt / từ chối việc
    const link2 = g2.data.tasks.find((t) => t.kind === "internal_links" && t.target_url === link.target_url);
    assert.equal((await c2("PUT", `/api/recovery/tasks/${link2.id}`, { status: "approved" })).status, 200);
    const blocked = g2.data.tasks.find((t) => t.status === "blocked");
    if (blocked) assert.equal((await c2("PUT", `/api/recovery/tasks/${blocked.id}`, { status: "approved" })).status, 409);
    // Quét lại giữ việc đã duyệt
    assert.equal((await c2("POST", `/api/recovery/${cr.data.id}/rescan`)).status, 200);
    const g3 = await c2("GET", `/api/recovery/${cr.data.id}`);
    assert.equal(g3.data.case.status, "ready");
    assert.equal(g3.data.tasks.find((t) => t.id === link2.id)?.status, "approved");
    assert.equal(g3.data.tasks.filter((t) => t.kind === "internal_links" && t.target_url === link.target_url).length, 1);
    // Site được tạo tự động từ địa chỉ nhập vào
    const sites = await c2("GET", "/api/sites");
    assert.ok(sites.data.sites.some((x) => x.domain === "caddemo.de"));
  } finally {
    globalThis.fetch = realFetch;
  }
});

await test("phục hồi: Search Console/GA4, AI viết lại, áp dụng lên WordPress, hoàn tác, GEO", async () => {
  const env3 = makeEnv({ SETUP_TOKEN: "setup-token-123456" });
  const c3 = client(env3);
  await c3("POST", "/api/setup", { setupToken: "setup-token-123456", name: "Duy", email: "duy@example.com", password: "mat-khau-dai-123" });
  const kp = await crypto.subtle.generateKey({ name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" }, true, ["sign", "verify"]);
  const der = Buffer.from(await crypto.subtle.exportKey("pkcs8", kp.privateKey)).toString("base64");
  const sa = JSON.stringify({ type: "service_account", client_email: "duyoi@proj.iam.gserviceaccount.com", private_key: `-----BEGIN PRIVATE KEY-----\n${der.match(/.{1,64}/g).join("\n")}\n-----END PRIVATE KEY-----\n`, token_uri: "https://oauth2.googleapis.com/token" });
  assert.equal((await c3("PUT", "/api/settings", { secrets: { google_service_account: "{}" } })).status, 400);
  const st = await c3("PUT", "/api/settings", { secrets: { google_service_account: sa, openrouter_api_key: "sk-or-test-123456" } });
  assert.equal(st.status, 200);
  assert.equal(st.data.secrets.google_service_account.hint, "duyoi@proj.iam.gserviceaccount.com");
  // Cấp Quản lý: prompt chưa duyệt thì AI bị chặn; duyệt xong mới chạy
  const pr = await c3("GET", "/api/manager/prompts");
  assert.ok(pr.data.prompts.length >= 5 && pr.data.prompts.every((p) => p.lint.ok && !p.review));
  for (const p of pr.data.prompts) assert.equal((await c3("PUT", `/api/manager/prompts/${p.id}`, { status: "approved" })).status, 200);
  const wp = { user: "duyoi-bot", pass: "abcd efgh ijkl mnop" };
  const realFetch = globalThis.fetch;
  globalThis.fetch = fakeSite({ wp });
  try {
    const cr = await c3("POST", "/api/recovery", { url: "caddemo.de", dropMonth: "2025-10", language: "de", rules: {
      commercialPaths: ["/cad-dienstleistung-tga/", "/cad-outsourcing-kosten-sparen/"], gscProperty: "sc-domain:caddemo.de", ga4Property: "123456789", builder: "elementor", cachePlugin: "flyingpress"
    } });
    assert.equal(cr.status, 201);
    let g = await c3("GET", `/api/recovery/${cr.data.id}`);
    assert.equal(g.data.case.status, "ready", g.data.case.error);
    const codes = g.data.findings.map((f) => f.code);
    assert.ok(codes.includes("traffic_change") && codes.includes("leads"), codes.join(","));
    assert.match(g.data.findings.find((f) => f.code === "traffic_change").title, /-\d+%/);
    assert.equal(g.data.pages.find((p) => p.path === "/12-wichtige-cad-symbole-fur-architektur/").traffic.clicks, 110);
    let link = g.data.tasks.find((t) => t.kind === "internal_links" && t.target_url.includes("symbole"));
    assert.match(link.title, /110 click/);
    assert.equal(g.data.wpConnected, false);
    // Kết nối WordPress
    const siteId = g.data.case.siteId;
    assert.equal((await c3("POST", `/api/sites/${siteId}/wp/test`)).status, 400);
    const ws = await c3("PUT", `/api/sites/${siteId}/wp`, { wpUser: wp.user, appPassword: wp.pass });
    assert.equal(ws.data.password.set, true);
    assert.ok(!JSON.stringify(ws.data).includes("efgh"));
    assert.equal((await c3("POST", `/api/sites/${siteId}/wp/test`)).data.info.version, "1.0.0");
    // AI viết lại câu chèn link, qua Gác cổng
    const ai = await c3("POST", `/api/recovery/tasks/${link.id}/ai`);
    assert.equal(ai.status, 200, JSON.stringify(ai.data));
    assert.equal(ai.data.gate.ok, true, JSON.stringify(ai.data.gate));
    g = await c3("GET", `/api/recovery/${cr.data.id}`);
    link = g.data.tasks.find((t) => t.id === link.id);
    assert.equal(link.payload.ai, true);
    assert.match(link.payload.edits[0].replace, /unsere Experten für <a href="\/cad-dienstleistung-tga\/">CAD-Dienstleistung TGA<\/a>/);
    assert.ok(link.payload.edits[0].replace.startsWith(link.payload.edits[0].find));
    const usage = env3.DB.raw.prepare("SELECT COUNT(*) AS n, SUM(cost_usd) AS c FROM ai_calls WHERE provider = 'openrouter' AND status = 'ok'").get();
    assert.ok(usage.n >= 1 && usage.c > 0);
    // Chưa duyệt thì không áp dụng được
    assert.equal((await c3("POST", `/api/recovery/tasks/${link.id}/apply`)).status, 409);
    await c3("PUT", `/api/recovery/tasks/${link.id}`, { status: "approved" });
    const ap = await c3("POST", `/api/recovery/tasks/${link.id}/apply`);
    assert.equal(ap.status, 200, JSON.stringify(ap.data));
    assert.deepEqual(ap.data.applied.purged, ["flyingpress", "elementor-css"]);
    assert.ok(wp.calls.some((c) => c.route === "/apply" && c.body.dry_run), "phải chạy thử trước khi ghi");
    const live = await (await globalThis.fetch("https://caddemo.de/12-wichtige-cad-symbole-fur-architektur/")).text();
    assert.match(live, /<a href="\/cad-dienstleistung-tga\/">CAD-Dienstleistung TGA<\/a>/);
    g = await c3("GET", `/api/recovery/${cr.data.id}`);
    assert.equal(g.data.tasks.find((t) => t.id === link.id).status, "done");
    assert.equal(g.data.backups.length, 1);
    assert.equal((await c3("POST", `/api/recovery/tasks/${link.id}/apply`)).status, 409);
    // Hoàn tác về đúng bản gốc
    const rb = await c3("POST", `/api/recovery/tasks/${link.id}/rollback`);
    assert.equal(rb.status, 200, JSON.stringify(rb.data));
    const back = await (await globalThis.fetch("https://caddemo.de/12-wichtige-cad-symbole-fur-architektur/")).text();
    assert.doesNotMatch(back, /CAD-Dienstleistung TGA<\/a>/);
    assert.equal((await c3("POST", `/api/recovery/tasks/${link.id}/rollback`)).status, 404);
    // Meta: áp dụng qua Rank Math
    const meta = g.data.tasks.find((t) => t.kind === "meta" && t.status === "proposed");
    if (meta) {
      await c3("PUT", `/api/recovery/tasks/${meta.id}`, { status: "approved" });
      const am = await c3("POST", `/api/recovery/tasks/${meta.id}/apply`);
      assert.equal(am.status, 200, JSON.stringify(am.data));
      assert.ok(am.data.applied.meta.length >= 1);
    }
    // GEO: đoạn trả lời trực tiếp + FAQ, chèn trước/sau khối
    const geo = await c3("POST", `/api/recovery/${cr.data.id}/geo`, { url: "https://caddemo.de/cad-dienstleistung-tga/" });
    assert.equal(geo.status, 200, JSON.stringify(geo.data));
    assert.equal(geo.data.gate.ok, true, JSON.stringify(geo.data.gate));
    await c3("PUT", `/api/recovery/tasks/${geo.data.taskId}`, { status: "approved" });
    const ag = await c3("POST", `/api/recovery/tasks/${geo.data.taskId}/apply`);
    assert.equal(ag.status, 200, JSON.stringify(ag.data));
    const tga = await (await globalThis.fetch("https://caddemo.de/cad-dienstleistung-tga/")).text();
    assert.match(tga, /<h2>TGA Planung<\/h2><p>Kurz gesagt: Bei TGA Planung/);
    assert.match(tga, /<h2>Häufige Fragen<\/h2><h3>/);
    // AI bịa số liệu: Gác cổng chặn
    const bad = await c3("POST", `/api/recovery/${cr.data.id}/geo`, { url: "https://caddemo.de/cad-outsourcing-kosten-sparen/" });
    assert.equal(bad.data.gate.ok, false);
    assert.ok(bad.data.gate.problems.some((p) => p.rule === "numbers"));
    await c3("PUT", `/api/recovery/tasks/${bad.data.taskId}`, { status: "approved" }).then((r) => assert.equal(r.status, 409));
    // Viewer không được áp dụng
    const act = await c3("GET", "/api/activity?limit=50");
    assert.ok(act.data.activity.some((a) => a.action === "recovery.applied"));
    assert.ok(act.data.activity.some((a) => a.action === "recovery.rollback"));
    assert.ok(!JSON.stringify(act.data).includes("efgh"));
  } finally {
    globalThis.fetch = realFetch;
  }
});

await test("Quản lý + đội Nội dung + tự động: duyệt prompt, trần chi phí, từ khoá, dàn ý, bài nháp, bản nháp WP, Agent HQ", async () => {
  const env4 = makeEnv({ SETUP_TOKEN: "setup-token-123456" });
  const c4 = client(env4);
  await c4("POST", "/api/setup", { setupToken: "setup-token-123456", name: "Duy", email: "duy@example.com", password: "mat-khau-dai-123" });
  await c4("PUT", "/api/settings", { secrets: { openrouter_api_key: "sk-or-test-123456", dataforseo_login: "me@example.com", dataforseo_password: "dfs-pass-123" } });
  const wp = { user: "duyoi-bot", pass: "abcd efgh ijkl mnop" };
  const realFetch = globalThis.fetch;
  globalThis.fetch = fakeSite({ wp });
  try {
    const cr = await c4("POST", "/api/recovery", { url: "caddemo.de", language: "de", rules: { commercialPaths: ["/cad-dienstleistung-tga/", "/cad-outsourcing-kosten-sparen/"], blocklist: ["3DScan"], maxNewArticlesPerMonth: 2, autopilot: true } });
    const caseId = cr.data.id;
    const siteId = (await c4("GET", `/api/recovery/${caseId}`)).data.case.siteId;
    // Prompt chưa duyệt: AI bị chặn và được ghi lại
    const link = (await c4("GET", `/api/recovery/${caseId}`)).data.tasks.find((t) => t.kind === "internal_links");
    const blocked = await c4("POST", `/api/recovery/tasks/${link.id}/ai`);
    assert.equal(blocked.status, 403);
    assert.match(blocked.data.message, /Quản lý chưa duyệt prompt/);
    const viewer = await c4("PUT", "/api/manager/prompts/link_sentence", { status: "approved" });
    assert.equal(viewer.status, 200);
    for (const id of ["cta_sentence", "geo_answers", "content_brief", "article_draft"]) await c4("PUT", `/api/manager/prompts/${id}`, { status: "approved" });
    // Cấu trúc + nghiên cứu từ khoá
    let ct = await c4("GET", `/api/content/${caseId}`);
    assert.ok(ct.data.structure.hubs.some((h) => h.path === "/cad-dienstleistung-tga/"));
    assert.ok(ct.data.structure.gaps.length >= 1);
    const rs = await c4("POST", `/api/content/${caseId}/research`);
    assert.equal(rs.status, 200, JSON.stringify(rs.data));
    ct = await c4("GET", `/api/content/${caseId}`);
    const kws = ct.data.ideas.map((i) => i.keyword);
    assert.ok(!kws.includes("autocad download"), "bỏ từ khoá điều hướng");
    assert.ok(!kws.includes("3dscan alternative"), "bỏ từ khoá trong blocklist");
    const covered = ct.data.ideas.find((i) => i.keyword === "12 wichtige cad symbole fur architektur");
    assert.equal(covered.covered_by, "/12-wichtige-cad-symbole-fur-architektur/");
    assert.equal((await c4("PUT", `/api/content/ideas/${covered.id}`, { status: "approved" })).status, 409, "không viết trùng trang có sẵn");
    const good = ct.data.ideas.find((i) => i.keyword === "cad zeichner tga");
    assert.equal(good.hub_path, "/cad-dienstleistung-tga/");
    // Duyệt → dàn ý → bài nháp → Gác cổng → bản nháp WordPress
    assert.equal((await c4("PUT", `/api/content/ideas/${good.id}`, { status: "approved" })).status, 200);
    const br = await c4("POST", `/api/content/ideas/${good.id}/brief`);
    assert.equal(br.status, 200, JSON.stringify(br.data));
    const dr = await c4("POST", `/api/content/ideas/${good.id}/draft`);
    assert.equal(dr.status, 200, JSON.stringify(dr.data));
    assert.equal(dr.data.result.ok, true, JSON.stringify(dr.data.result));
    ct = await c4("GET", `/api/content/${caseId}`);
    const drafted = ct.data.ideas.find((i) => i.id === good.id);
    assert.doesNotMatch(drafted.draft.html, /<script/);
    assert.ok(drafted.draft.words >= 600);
    assert.equal((await c4("POST", `/api/content/ideas/${good.id}/wp`)).status, 400, "chưa kết nối WP");
    await c4("PUT", `/api/sites/${siteId}/wp`, { wpUser: wp.user, appPassword: wp.pass });
    const wd = await c4("POST", `/api/content/ideas/${good.id}/wp`);
    assert.equal(wd.status, 200, JSON.stringify(wd.data));
    assert.equal(wp.created.length, 1);
    assert.equal(wp.created[0].status, "draft");
    assert.equal((await c4("POST", `/api/content/ideas/${good.id}/wp`)).status, 409, "không tạo trùng");
    // Số liệu bịa trong bài: Gác cổng chặn
    const second = ct.data.ideas.find((i) => i.keyword === "tga planung cad");
    assert.equal(second.covered_by, null);
    assert.equal((await c4("PUT", `/api/content/ideas/${second.id}`, { status: "approved" })).status, 200);
    const sb = await c4("POST", `/api/content/ideas/${second.id}/brief`); assert.equal(sb.status, 200, JSON.stringify(sb.data));
    const bad = await c4("POST", `/api/content/ideas/${second.id}/draft`); assert.equal(bad.status, 200, JSON.stringify(bad.data));
    assert.equal(bad.data.result.ok, false);
    assert.ok(bad.data.result.problems.some((p) => p.rule === "numbers"));
    assert.equal((await c4("POST", `/api/content/ideas/${second.id}/wp`)).status, 409);
    // Giới hạn bài/tháng (chống spam)
    const third = ct.data.ideas.find((i) => i.keyword === "haustechnik zeichnung erstellen lassen");
    const lim = await c4("PUT", `/api/content/ideas/${third.id}`, { status: "approved" });
    assert.equal(lim.status, 409);
    assert.match(lim.data.message, /chống spam/);
    // Trần chi phí: hạ trần AI theo site → Quản lý chặn
    await c4("PUT", "/api/settings", { values: { ai_site_daily_cap_usd: 0 } });
    const capped = await c4("POST", `/api/recovery/tasks/${link.id}/ai`);
    assert.equal(capped.status, 429);
    await c4("PUT", "/api/settings", { values: { ai_site_daily_cap_usd: 2 } });
    const sp = await c4("GET", "/api/manager/spend");
    assert.ok(sp.data.spent.openrouter > 0 && sp.data.spent.dataforseo > 0);
    assert.ok(sp.data.blockedMonth >= 2);
    // Tự động: cron chạy tiếp việc
    const waits = [];
    await worker.scheduled({ cron: "*/15 * * * *", scheduledTime: Date.now() }, env4, { waitUntil: (p) => waits.push(p) });
    await Promise.all(waits);
    const acts = await c4("GET", "/api/activity?limit=80");
    assert.ok(acts.data.activity.some((a) => a.actor === "agent:linker" && a.action === "recovery.ai"), "autopilot phải cho AI viết lại câu chèn");
    // Agent HQ
    const hq = await c4("GET", "/api/hq");
    assert.equal(hq.status, 200);
    assert.equal(hq.data.manager.promptsPending, 0);
    assert.ok(hq.data.zones.recovery.length === 9 && hq.data.zones.content.length === 4);
    assert.ok(hq.data.autopilot.sites.some((x) => x.domain === "caddemo.de"));
  } finally {
    globalThis.fetch = realFetch;
  }
});

await test("định dạng bài: Best X có sản phẩm affiliate, công khai, nút mua sponsored, ảnh thật tải lên WordPress, không nói đã test khi chưa test", async () => {
  const env5 = makeEnv({ SETUP_TOKEN: "setup-token-123456" });
  const c5 = client(env5);
  await c5("POST", "/api/setup", { setupToken: "setup-token-123456", name: "Duy", email: "duy@example.com", password: "mat-khau-dai-123" });
  await c5("PUT", "/api/settings", { secrets: { openrouter_api_key: "sk-or-test-123456", dataforseo_login: "me@example.com", dataforseo_password: "dfs-pass-123" } });
  const pr = await c5("GET", "/api/manager/prompts");
  assert.ok(pr.data.prompts.find((p) => p.id === "article_draft").formats.length === 6);
  for (const p of pr.data.prompts) assert.equal((await c5("PUT", `/api/manager/prompts/${p.id}`, { status: "approved" })).status, 200, p.id);
  const wp = { user: "duyoi-bot", pass: "abcd efgh ijkl mnop" };
  const realFetch = globalThis.fetch;
  globalThis.fetch = fakeSite({ wp });
  try {
    const cr = await c5("POST", "/api/recovery", { url: "caddemo.de", language: "de", rules: { commercialPaths: ["/cad-dienstleistung-tga/"] } });
    const caseId = cr.data.id;
    const siteId = (await c5("GET", `/api/recovery/${caseId}`)).data.case.siteId;
    await c5("PUT", `/api/sites/${siteId}/wp`, { wpUser: wp.user, appPassword: wp.pass });
    // Đoán định dạng từ từ khoá
    const a = await c5("POST", `/api/content/${caseId}/ideas`, { keyword: "Beste CAD Software Test" });
    assert.equal(a.status, 201, JSON.stringify(a.data));
    await c5("POST", `/api/content/${caseId}/ideas`, { keyword: "wie man cad zeichnungen erstellt" });
    await c5("POST", `/api/content/${caseId}/ideas`, { keyword: "planwerk vs bauzeichner" });
    assert.equal((await c5("POST", `/api/content/${caseId}/ideas`, { keyword: "beste cad software test" })).status, 409);
    let ct = await c5("GET", `/api/content/${caseId}`);
    const fmt = Object.fromEntries(ct.data.ideas.map((i) => [i.keyword, i.format]));
    assert.deepEqual([fmt["beste cad software test"], fmt["wie man cad zeichnungen erstellt"], fmt["planwerk vs bauzeichner"]], ["roundup", "how_to", "comparison"]);
    const id = a.data.id;
    assert.equal((await c5("PUT", `/api/content/ideas/${id}`, { status: "approved" })).status, 200);
    // Thiếu sản phẩm: agent hỏi anh, không lập dàn ý
    const nb = await c5("POST", `/api/content/ideas/${id}/brief`);
    assert.equal(nb.status, 409);
    assert.match(nb.data.message, /ít nhất 3 sản phẩm/);
    let hq = await c5("GET", "/api/hq");
    assert.ok(hq.data.asks.some((x) => x.kind === "products" && x.ideaId === id));
    const items = [
      { name: "Planwerk Pro", url: "https://www.amazon.de/dp/B000TEST?tag=duy-21", merchant: "Amazon", bestFor: "Einsteiger", specs: "Version 2026, Windows", tested: false },
      { name: "Bauzeichner X", url: "https://shop.example.de/bauzeichner?aff=7", merchant: "Shop", links: [{ merchant: "Hersteller", url: "https://bauzeichner.example/kaufen" }], bestFor: "Teams", specs: "Cloud", tested: false },
      { name: "Linea CAD", url: "https://linea.example/?ref=duy", merchant: "Linea", bestFor: "Mac", specs: "macOS", tested: false }
    ];
    assert.equal((await c5("PUT", `/api/content/ideas/${id}/products`, { items: [...items.slice(0, 2), { name: "Ohne Link" }] })).status, 400);
    assert.equal((await c5("PUT", `/api/content/ideas/${id}/products`, { method: "Nach Funktionen und Bedienung ausgewählt.", items })).status, 200);
    assert.equal((await c5("POST", `/api/content/ideas/${id}/brief`)).status, 200);
    const dr = await c5("POST", `/api/content/ideas/${id}/draft`);
    assert.equal(dr.status, 200, JSON.stringify(dr.data));
    const rules = dr.data.result.problems.filter((p) => p.level === "block").map((p) => p.rule);
    assert.ok(rules.includes("images") && rules.includes("tested"), rules.join(","));
    assert.ok(dr.data.result.problems.some((p) => p.rule === "amazon"));
    ct = await c5("GET", `/api/content/${caseId}`);
    let i = ct.data.ideas.find((x) => x.id === id);
    assert.equal(i.slots.length, 3);
    assert.ok(i.slots.every((s) => s.required && !s.image));
    assert.match(i.draft.html, /class="affiliate-disclosure"><em>Hinweis: Dieser Artikel enthält Affiliate-Links \(Werbung\)/);
    assert.ok(i.draft.html.indexOf("affiliate-disclosure") < i.draft.html.indexOf("buy-button"), "công khai đặt trước link mua đầu tiên");
    assert.match(i.draft.html, /<a class="buy-button" href="https:\/\/www\.amazon\.de\/dp\/B000TEST\?tag=duy-21" rel="sponsored nofollow noopener" target="_blank">Bei Amazon ansehen<\/a>/);
    assert.match(i.draft.html, /Bei Hersteller ansehen/);
    assert.match(i.draft.html, /⟪Ảnh thật cần có: Ảnh thật của Planwerk Pro/);
    assert.ok(!i.draft.html.includes("evil.example") && i.draft.html.includes("hier"), "bỏ link ngoài do AI tự viết");
    hq = await c5("GET", "/api/hq");
    assert.ok(hq.data.asks.some((x) => x.kind === "images" && x.ideaId === id));
    assert.equal((await c5("POST", `/api/content/ideas/${id}/wp`)).status, 409);
    // Anh xác nhận đã dùng thật: hết chặn "đã test"
    await c5("PUT", `/api/content/ideas/${id}/products`, { method: "Nach Funktionen und Bedienung ausgewählt.", items: items.map((x) => ({ ...x, tested: true, notes: "Drei Monate im Büro für Grundrisse genutzt." })) });
    // Tải ảnh thật: phải xác nhận, phải có alt; EXIF bị xoá trước khi gửi WordPress
    const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe1, 0x00, 0x11]), Buffer.from("Exif\0\0GPS-LAT-1"), Buffer.from([0xff, 0xc0, 0x00, 0x0b, 0x08, 0x02, 0x58, 0x03, 0x20, 0x01, 0x01, 0x11, 0x00, 0xff, 0xda, 0x00, 0x02, 0x00, 0xff, 0xd9])]);
    const up = (slot, q, body = jpeg, type = "image/jpeg") => c5("POST", `/api/content/ideas/${id}/images/${slot}?${q}`, body, { "Content-Type": type });
    assert.equal((await up("p1", "alt=Planwerk%20Pro%20am%20Arbeitsplatz&source=own")).status, 400);
    assert.equal((await up("p1", "real=1&source=own&alt=x")).status, 400);
    assert.equal((await up("p9", "real=1&source=own&alt=Planwerk%20Pro%20am%20Arbeitsplatz")).status, 404);
    assert.equal((await up("p1", "real=1&source=own&alt=Planwerk%20Pro", Buffer.from("not an image"), "image/jpeg")).status, 400);
    const u1 = await up("p1", "real=1&source=own&alt=Planwerk%20Pro%20am%20Arbeitsplatz&caption=Im%20B%C3%BCro");
    assert.equal(u1.status, 200, JSON.stringify(u1.data));
    assert.equal(wp.media[0].filename.endsWith("-p1.jpg"), true);
    assert.ok(!Buffer.from(wp.media[0].bytes).includes("GPS-LAT"), "phải xoá EXIF");
    assert.equal(u1.data.gate.ok, false);
    const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(24)]);
    await up("p2", "real=1&source=maker&alt=Bauzeichner%20X%20Oberfl%C3%A4che", png, "image/png");
    const u3 = await up("p3", "real=1&source=own&alt=Linea%20CAD%20auf%20dem%20Mac", png, "image/png");
    assert.equal(u3.data.gate.ok, true, JSON.stringify(u3.data.gate));
    ct = await c5("GET", `/api/content/${caseId}`);
    i = ct.data.ideas.find((x) => x.id === id);
    assert.match(i.draft.html, /<figure class="wp-block-image"><img src="https:\/\/caddemo\.de\/wp-content\/uploads\/[a-z0-9-]+-p1\.jpg" alt="Planwerk Pro am Arbeitsplatz" width="800" height="600" loading="lazy"><figcaption>Im Büro · Foto: eigene Aufnahme<\/figcaption><\/figure>/);
    assert.match(i.draft.html, /Bild: Hersteller/);
    const wd = await c5("POST", `/api/content/ideas/${id}/wp`);
    assert.equal(wd.status, 200, JSON.stringify(wd.data));
    const created = wp.calls.find((x) => x.route === "/create");
    assert.match(created.body.content, /rel="sponsored nofollow noopener"/);
    assert.match(created.body.content, /<figure class="wp-block-image">/);
    assert.ok(!created.body.content.includes("⟪") && !created.body.content.includes("[["));
    assert.equal((await c5("PUT", `/api/content/ideas/${id}`, { format: "guide" })).status, 409);
    assert.equal((await up("p1", "real=1&source=own&alt=Planwerk%20Pro%20am%20Arbeitsplatz")).status, 409);
  } finally {
    globalThis.fetch = realFetch;
  }
});

await test("đường dẫn không phải /api trả giao diện (SPA)", async () => {
  const res = await worker.fetch(new Request(BASE + "/sites/12"), env);
  assert.equal(res.status, 200);
  assert.match(await res.text(), /<div id="app"/);
});

console.log(`\n${passed} test đạt.`);
