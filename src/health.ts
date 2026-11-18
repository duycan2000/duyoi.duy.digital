// Kiểm tra kết nối: gọi thật từng dịch vụ để biết phần nào chạy được ngoài đời thật.
// Chỉ đọc, không ghi gì lên site hay dịch vụ ngoài. Kết quả lưu lại; lỗi mới thì ghi nhật ký và vào báo cáo tuần.

import { logActivity } from "./activity";
import { cf, creds } from "./cfmedia";
import { encryptionProblem } from "./crypto";
import { gh } from "./github";
import { googleToken, hasGoogle } from "./google";
import { HttpError, json, now } from "./http";
import { indexKey, keyServed } from "./indexnow";
import { readMon } from "./monitor";
import { readPublishProfile } from "./publish";
import { getSettingsMap, readSecret } from "./settings";
import { postizCheck } from "./social";
import { wpCall } from "./wordpress";
import type { Env, User } from "./types";

const DAY = 86400000;
export type HStatus = "ok" | "warn" | "fail" | "skip";
export interface HCheck { key: string; label: string; status: HStatus; message: string; fix?: string; link?: string }

const errMsg = (e: unknown) => ((e as Error)?.message || String(e)).slice(0, 300);
const timeout = (ms: number) => AbortSignal.timeout(ms);

async function safe(key: string, label: string, fn: () => Promise<Omit<HCheck, "key" | "label">>): Promise<HCheck> {
  try { return { key, label, ...(await fn()) }; }
  catch (e) { return { key, label, status: "fail", message: errMsg(e) }; }
}

// ---------------- Kiểm tra chung ----------------

export async function globalChecks(env: Env): Promise<HCheck[]> {
  const st = await getSettingsMap(env);
  const out: HCheck[] = [];
  const enc = encryptionProblem(env.ENCRYPTION_KEY);
  out.push({ key: "encryption", label: "Khoá mã hoá (ENCRYPTION_KEY)", status: enc ? "fail" : "ok", message: enc ? (enc === "missing" ? "Worker chưa có secret ENCRYPTION_KEY." : "ENCRYPTION_KEY sai định dạng.") : "Có, đúng định dạng.", link: "#/settings" });

  out.push(await safe("cron", "Cron (việc định kỳ)", async () => {
    const last = Number(st.cron_last_run || 0);
    if (!last) return { status: "warn", message: "Cron chưa chạy lần nào (bản deploy mới hoặc chưa bật Cron Triggers)." };
    const age = Date.now() - last;
    return age > 40 * 60000 ? { status: "fail", message: `Lần chạy cuối cách đây ${Math.round(age / 60000)} phút (lịch 15 phút một lần).`, fix: "Cloudflare › Workers › duyoi › Settings › Triggers: kiểm tra 3 lịch cron còn bật." } : { status: "ok", message: `Chạy cách đây ${Math.max(1, Math.round(age / 60000))} phút.` };
  }));

  out.push(await safe("openrouter", "OpenRouter (AI)", async () => {
    const key = await readSecret(env, "openrouter_api_key");
    if (!key) return { status: "fail", message: "Chưa nhập API key.", link: "#/settings/keys" };
    const res = await fetch("https://openrouter.ai/api/v1/key", { headers: { Authorization: `Bearer ${key}` }, signal: timeout(12000) });
    if (res.status === 401 || res.status === 403) return { status: "fail", message: "OpenRouter từ chối key (sai hoặc đã thu hồi).", link: "#/settings/keys" };
    if (!res.ok) return { status: "warn", message: `OpenRouter trả ${res.status}.` };
    const d = ((await res.json().catch(() => ({}))) as { data?: { usage?: number; limit?: number | null; limit_remaining?: number | null } }).data || {};
    if (d.limit_remaining != null && d.limit_remaining <= 0) return { status: "fail", message: "Key đã hết hạn mức chi tiêu đặt trên OpenRouter." };
    return { status: "ok", message: `Key hợp lệ${d.usage != null ? `, đã dùng $${Number(d.usage).toFixed(2)}` : ""}${d.limit != null ? ` / hạn mức $${d.limit}` : ""}.` };
  }));

  out.push(await safe("dataforseo", "DataForSEO", async () => {
    const login = await readSecret(env, "dataforseo_login"), pass = await readSecret(env, "dataforseo_password");
    if (!login || !pass) return { status: "fail", message: "Chưa nhập login và password.", link: "#/settings/keys" };
    const res = await fetch("https://api.dataforseo.com/v3/appendix/user_data", { headers: { Authorization: `Basic ${btoa(`${login}:${pass}`)}` }, signal: timeout(15000) });
    const d = (await res.json().catch(() => ({}))) as { status_code?: number; status_message?: string; tasks?: { result?: { money?: { balance?: number } }[] }[] };
    if (res.status === 401 || d.status_code === 40100) return { status: "fail", message: "DataForSEO từ chối login/password (dùng API password, không phải mật khẩu đăng nhập web).", link: "#/settings/keys" };
    if (!res.ok || (d.status_code && d.status_code !== 20000)) return { status: "warn", message: `DataForSEO: ${d.status_message || res.status}.` };
    const bal = d.tasks?.[0]?.result?.[0]?.money?.balance;
    if (bal == null) return { status: "ok", message: "Đăng nhập được." };
    return bal < 1 ? { status: "fail", message: `Số dư $${bal.toFixed(2)}: gần hết, các lệnh SERP/backlink sẽ lỗi.`, fix: "Nạp thêm ở app.dataforseo.com." } : { status: "ok", message: `Số dư $${bal.toFixed(2)}.` };
  }));

  out.push(await safe("google", "Google service account", async () => {
    if (!(await hasGoogle(env))) return { status: "warn", message: "Chưa nhập. Không có thì không đọc được Search Console và GA4.", link: "#/settings/keys" };
    await googleToken(env);
    const raw = await readSecret(env, "google_service_account");
    const email = raw ? (JSON.parse(raw) as { client_email?: string }).client_email : "";
    return { status: "ok", message: `Lấy được token. Email cần thêm vào từng property Search Console: ${email}.` };
  }));

  out.push(await safe("cloudflare", "Cloudflare API token", async () => {
    let c: { token: string; account: string };
    try { c = await creds(env); } catch { return { status: "warn", message: "Chưa có token hoặc Account ID. Cần cho ảnh R2, bộ đo, hộp thư outreach.", link: "#/settings/keys" }; }
    const r = await cf<{ status?: string }>(env, `/accounts/${c.account}/tokens/verify`, {}, true).catch(() => null) || await cf<{ status?: string }>(env, "/user/tokens/verify", {}, true).catch(() => null);
    if (!r) return { status: "fail", message: "Cloudflare không xác nhận được token.", link: "#/settings/keys" };
    return r.status && r.status !== "active" ? { status: "fail", message: `Token đang ở trạng thái ${r.status}.` } : { status: "ok", message: "Token đang hoạt động." };
  }));

  out.push(await safe("github", "GitHub token (site Astro)", async () => {
    const t = await readSecret(env, "github_token");
    const astro = await env.DB.prepare("SELECT COUNT(*) AS n FROM sites WHERE platform = 'astro' AND status != 'archived'").first<{ n: number }>();
    if (!t) return { status: astro?.n ? "fail" : "skip", message: astro?.n ? "Có site Astro nhưng chưa nhập token: không đăng bài hay mở pull request được." : "Không có site Astro.", link: "#/settings/keys" };
    const u = await gh<{ login: string }>(env, "/user");
    return { status: "ok", message: `Đăng nhập là ${u?.login}.` };
  }));

  out.push({ key: "email", label: "Gửi email (Cloudflare Email Service)", status: env.EMAIL ? "ok" : "fail", message: env.EMAIL ? "Worker có binding EMAIL. Từng tên miền gửi vẫn cần bật ở Email Service › Sending." : "Worker chưa có binding EMAIL (wrangler.jsonc › send_email)." });
  return out;
}

// ---------------- Kiểm tra từng site ----------------

interface SiteRow { id: number; name: string; domain: string; platform: string; market: string; language: string; status: string; repo: string | null; publish_profile: string | null; wp_user: string | null }

export async function siteChecks(env: Env, s: SiteRow): Promise<HCheck[]> {
  const out: HCheck[] = [];
  const apex = s.domain.replace(/^www\./, "");

  out.push(await safe("reach", "Site mở được", async () => {
    const res = await fetch(`https://${s.domain}/`, { headers: { "User-Agent": "Mozilla/5.0 (compatible; DuyOiHealth/1.0)" }, signal: timeout(12000) });
    return res.status < 400 ? { status: "ok", message: `Trang chủ trả ${res.status}.` } : { status: "fail", message: `Trang chủ trả ${res.status}.` };
  }));

  out.push(await safe("gsc", "Search Console", async () => {
    if (!(await hasGoogle(env))) return { status: "skip", message: "Chưa có Google service account." };
    const { settings, state } = await readMon(env, { id: s.id, name: s.name, domain: s.domain, platform: s.platform, market: s.market, language: s.language, status: s.status });
    const token = await googleToken(env);
    const res = await fetch(`https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(settings.gscProperty)}`, { headers: { Authorization: `Bearer ${token}` }, signal: timeout(12000) });
    const d = (await res.json().catch(() => ({}))) as { permissionLevel?: string; error?: { message?: string } };
    if (res.status === 403 || res.status === 404) return { status: "fail", message: `Service account chưa có quyền với ${settings.gscProperty}.`, fix: "Search Console › Cài đặt › Người dùng và quyền › Thêm email service account (quyền Hạn chế là đủ). Sai property thì sửa ở Thứ hạng › Cài đặt.", link: `#/rankings/${s.id}` };
    if (!res.ok) return { status: "warn", message: `Google trả ${res.status}: ${d.error?.message || ""}` };
    if (d.permissionLevel === "siteUnverifiedUser") return { status: "fail", message: `Property ${settings.gscProperty} chưa xác minh quyền sở hữu.` };
    return { status: state.gscError ? "warn" : "ok", message: `${settings.gscProperty}: quyền ${d.permissionLevel || "đọc"}.${state.gscError ? ` Lần đọc gần nhất lỗi: ${state.gscError}` : ""}` };
  }));

  if (s.platform === "wordpress") {
    out.push(await safe("wordpress", "WordPress (Duy Ơi Connector)", async () => {
      if (!s.wp_user) return { status: "fail", message: "Chưa nhập user và Application Password.", link: `#/sites/${s.id}` };
      const r = await wpCall<{ version?: string; rankmath?: boolean; elementor?: boolean }>(env, s.id, "/ping");
      const old = r.version && r.version.localeCompare("1.3.0", undefined, { numeric: true }) < 0;
      return { status: old ? "warn" : "ok", message: `Plugin ${r.version || "?"}${r.rankmath ? " · Rank Math" : " · không thấy Rank Math (title/meta sẽ không sửa được)"}${r.elementor ? " · Elementor" : ""}.${old ? " Nên cập nhật lên 1.3.0." : ""}` };
    }));
  } else {
    out.push(await safe("github_repo", "Repo GitHub (Astro)", async () => {
      if (!s.repo) return { status: "fail", message: "Chưa gắn repo.", link: `#/sites/${s.id}` };
      const r = await gh<{ full_name: string; permissions?: { push?: boolean } }>(env, `/repos/${s.repo}`);
      if (r?.permissions && !r.permissions.push) return { status: "fail", message: `Token chỉ đọc được ${s.repo}, không ghi được.` };
      return readPublishProfile(s) ? { status: "ok", message: `${r?.full_name}: ghi được, có hồ sơ đăng bài.` } : { status: "warn", message: `${r?.full_name}: chưa đọc hồ sơ đăng bài (Content Studio › Đăng lên GitHub › Đọc repo).` };
    }));
  }

  out.push(await safe("indexnow", "IndexNow", async () => {
    const k = await indexKey(env, s.id);
    return (await keyServed(s.domain, k.key)) ? { status: "ok", message: "File khoá có trên site." } : { status: "warn", message: k.last_error || "File khoá chưa có trên site: bài mới chưa báo được cho Bing.", link: "#/offpage" };
  }));

  out.push(await safe("tracker", "Bộ đo riêng (Số liệu site)", async () => {
    const d = await env.DB.prepare("SELECT status, message, last_event_at FROM stats_domains WHERE domain IN (?, ?)").bind(apex, `www.${apex}`).first<{ status: string; message: string | null; last_event_at: number | null }>();
    if (!d) return { status: "skip", message: "Chưa cài cho site này.", link: "#/analytics" };
    if (d.status !== "active" && d.status !== "verified") return { status: "warn", message: d.message || `Trạng thái ${d.status}.`, link: "#/analytics" };
    if (!d.last_event_at || Date.now() - d.last_event_at > 3 * DAY) return { status: "warn", message: "3 ngày chưa nhận lượt xem nào: kiểm tra dòng script trong <head>.", link: "#/analytics" };
    return { status: "ok", message: "Đang nhận dữ liệu." };
  }));

  out.push(await safe("mailbox", "Hộp thư outreach", async () => {
    const r = await env.DB.prepare("SELECT data FROM op_settings WHERE site_id = ?").bind(s.id).first<{ data: string }>();
    const email = r ? String((JSON.parse(r.data) as { outreachEmail?: string }).outreachEmail || "") : "";
    if (!email) return { status: "skip", message: "Chưa đặt email gửi (Off-page › Đội Off-page)." };
    try { await creds(env); } catch { return { status: "warn", message: `${email}: chưa có Cloudflare token để kiểm Email Routing.` }; }
    const zone = (await cf<{ id: string }[]>(env, `/zones?name=${encodeURIComponent(apex)}`))?.[0];
    if (!zone) return { status: "fail", message: `Tên miền ${apex} không có trong tài khoản Cloudflare.` };
    const routing = await cf<{ enabled?: boolean }>(env, `/zones/${zone.id}/email/routing`, {}, true).catch(() => null);
    if (!routing?.enabled) return { status: "fail", message: "Email Routing chưa bật: thư trả lời sẽ không về app.", link: "#/offpage" };
    const rules = (await cf<{ matchers: { value?: string }[]; actions: { type: string }[] }[]>(env, `/zones/${zone.id}/email/routing/rules`).catch(() => null)) || [];
    const rule = rules.find((x) => x.matchers.some((m) => (m.value || "").toLowerCase() === email.toLowerCase()));
    if (!rule) return { status: "fail", message: `Chưa có quy tắc nhận thư cho ${email}: bấm Dựng hộp thư ở Off-page.`, link: "#/offpage" };
    return rule.actions.some((a) => a.type === "worker") ? { status: "ok", message: `${email} → Worker duyoi.` } : { status: "warn", message: `${email} đang chuyển tiếp chứ không vào Worker: app không thấy thư trả lời.` };
  }));

  const acc = (await env.DB.prepare("SELECT network, status, error, expires_at, via FROM social_accounts WHERE site_id = ? AND status != 'profile'").bind(s.id).all<{ network: string; status: string; error: string | null; expires_at: number | null; via: string }>()).results;
  for (const a of acc) {
    const exp = a.expires_at ? a.expires_at - Date.now() : null;
    const st: HStatus = a.status === "error" || (exp != null && exp <= 0) ? "fail" : exp != null && exp < 7 * DAY ? "warn" : a.status === "active" ? "ok" : "warn";
    out.push({ key: `social_${a.network}`, label: `Mạng xã hội: ${a.network}${a.via === "postiz" ? " (Postiz)" : ""}`, status: st, link: "#/offpage",
      message: a.error ? a.error.slice(0, 200) : exp != null && exp <= 0 ? "Token đã hết hạn: kết nối lại." : exp != null && exp < 7 * DAY ? `Token hết hạn sau ${Math.ceil(exp / DAY)} ngày: kết nối lại sớm.` : `Trạng thái ${a.status}.` });
  }

  out.push(await safe("postiz", "Postiz", async () => {
    const r = await postizCheck(env, s.id);
    if (!r.configured) return { status: "skip", message: "Không dùng." };
    return r.error ? { status: "fail", message: r.error, link: "#/offpage" } : { status: "ok", message: `${r.count} kênh trong workspace.` };
  }));
  return out;
}

// ---------------- Chạy và lưu ----------------

async function save(env: Env, siteId: number, checks: HCheck[], actor: string, domain: string): Promise<void> {
  const prev = new Map((await env.DB.prepare("SELECT key, status FROM health_checks WHERE site_id = ?").bind(siteId).all<{ key: string; status: string }>()).results.map((r) => [r.key, r.status]));
  const t = now();
  await env.DB.batch([
    env.DB.prepare("DELETE FROM health_checks WHERE site_id = ?").bind(siteId),
    ...checks.map((c) => env.DB.prepare("INSERT INTO health_checks (site_id, key, label, status, message, fix, link, checked_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)").bind(siteId, c.key, c.label, c.status, c.message, c.fix || null, c.link || null, t))
  ]);
  const newFails = checks.filter((c) => c.status === "fail" && prev.get(c.key) !== "fail");
  if (newFails.length) await logActivity(env, actor, "health.fail", `${domain}: ${newFails.map((c) => `${c.label} (${c.message.slice(0, 80)})`).join("; ")}`, siteId || null);
}

export async function runChecks(env: Env, siteId: number | null, actor: string): Promise<void> {
  if (siteId == null || siteId === 0) await save(env, 0, await globalChecks(env), actor, "Chung");
  const sites = (await env.DB.prepare(`SELECT id, name, domain, platform, market, language, status, repo, publish_profile, wp_user FROM sites WHERE status != 'archived' ${siteId ? "AND id = ?" : ""} ORDER BY id`).bind(...(siteId ? [siteId] : [])).all<SiteRow>()).results;
  if (siteId && !sites.length) throw new HttpError(404, "Không tìm thấy site.", "not_found");
  for (const s of sites) await save(env, s.id, await siteChecks(env, s), actor, s.domain);
}

// Cron: mỗi ngày một lần
export async function runHealth(env: Env): Promise<void> {
  const last = await env.DB.prepare("SELECT MAX(checked_at) AS t FROM health_checks WHERE site_id = 0").first<{ t: number | null }>();
  if (last?.t && now() - last.t < DAY) return;
  await runChecks(env, null, "agent:health");
}

export async function healthSummary(env: Env): Promise<{ fail: number; warn: number; items: { siteId: number; domain: string; label: string; message: string; status: string }[] }> {
  const r = await env.DB.prepare("SELECT h.site_id, COALESCE(s.domain, 'Chung') AS domain, h.label, h.message, h.status FROM health_checks h LEFT JOIN sites s ON s.id = h.site_id WHERE h.status IN ('fail', 'warn') ORDER BY h.status = 'warn', h.site_id").all<{ site_id: number; domain: string; label: string; message: string; status: string }>();
  return { fail: r.results.filter((x) => x.status === "fail").length, warn: r.results.filter((x) => x.status === "warn").length, items: r.results.map((x) => ({ siteId: x.site_id, domain: x.domain, label: x.label, message: x.message, status: x.status })) };
}

// ---------------- API ----------------

export async function apiHealth(env: Env): Promise<Response> {
  const rows = (await env.DB.prepare("SELECT site_id, key, label, status, message, fix, link, checked_at FROM health_checks ORDER BY site_id, rowid").all<{ site_id: number; key: string; label: string; status: string; message: string; fix: string | null; link: string | null; checked_at: number }>()).results;
  const sites = (await env.DB.prepare("SELECT id, name, domain, platform FROM sites WHERE status != 'archived' ORDER BY id").all<{ id: number; name: string; domain: string; platform: string }>()).results;
  const group = (id: number) => rows.filter((r) => r.site_id === id);
  return json({
    global: { checks: group(0), at: group(0)[0]?.checked_at || null },
    sites: sites.map((s) => ({ ...s, checks: group(s.id), at: group(s.id)[0]?.checked_at || null }))
  });
}

export async function apiRunHealth(env: Env, user: User, siteId: number | null): Promise<Response> {
  if (user.role === "viewer") throw new HttpError(403, "Tài khoản chỉ xem.", "forbidden");
  await runChecks(env, siteId, `user:${user.id}`);
  return apiHealth(env);
}
