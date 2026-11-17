// Kiểm thử luồng API giai đoạn 1: tạo admin, đăng nhập, khoá khi sai nhiều lần, site, cài đặt mã hoá, tạm dừng, cron.
// Chạy: npm test  (cần Node 22.5+ vì dùng node:sqlite)

import assert from "node:assert/strict";
import { loadWorker, makeEnv } from "./harness.mjs";

const worker = await loadWorker();
const BASE = "https://duyoi.duy.digital";
let passed = 0;

function client(env) {
  let cookie = "";
  return async function call(method, path, body, { origin = BASE, ip = "1.1.1.1" } = {}) {
    const headers = { "CF-Connecting-IP": ip };
    if (origin) headers.Origin = origin;
    if (cookie) headers.Cookie = cookie;
    if (body !== undefined) headers["Content-Type"] = "application/json";
    const res = await worker.fetch(new Request(BASE + path, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined }), env);
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

await test("đường dẫn không phải /api trả giao diện (SPA)", async () => {
  const res = await worker.fetch(new Request(BASE + "/sites/12"), env);
  assert.equal(res.status, 200);
  assert.match(await res.text(), /<div id="app"/);
});

console.log(`\n${passed} test đạt.`);
