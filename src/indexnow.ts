// IndexNow: báo Bing, Yandex, Seznam, Naver (và Copilot qua Bing) ngay khi site có bài mới hoặc trang vừa được sửa.
// Google không dùng IndexNow. File khoá phải nằm ở gốc tên miền (https://ten-mien/<key>.txt):
// - site có tên miền trong tài khoản Cloudflare: Worker bộ đo của site phục vụ file này (route riêng);
// - WordPress: plugin Duy Ơi Connector 1.3+ phục vụ file khoá.
// Chỉ gửi URL thật sự mới hoặc vừa đổi, mỗi URL tối đa 1 lần/24 giờ.

import { HttpError, json, now } from "./http";
import { wpCall } from "./wordpress";
import { fetchText } from "./web";
import type { Env, User } from "./types";

interface Row { site_id: number; key: string; mode: string | null; verified_at: number | null; last_error: string | null }
const DAY = 86400000;

export async function indexKey(env: Env, siteId: number): Promise<Row> {
  const r = await env.DB.prepare("SELECT * FROM indexnow WHERE site_id = ?").bind(siteId).first<Row>();
  if (r) return r;
  const key = [...crypto.getRandomValues(new Uint8Array(16))].map((b) => b.toString(16).padStart(2, "0")).join("");
  await env.DB.prepare("INSERT OR IGNORE INTO indexnow (site_id, key, updated_at) VALUES (?, ?, ?)").bind(siteId, key, now()).run();
  return (await env.DB.prepare("SELECT * FROM indexnow WHERE site_id = ?").bind(siteId).first<Row>())!;
}

export async function keyServed(domain: string, key: string): Promise<boolean> {
  const r = await fetchText(`https://${domain}/${key}.txt`, 2000, 8000);
  return !!r && r.status === 200 && r.text.trim() === key;
}

// Bảo đảm file khoá có trên site; trả về true khi đã kiểm tra được
export async function ensureKeyHosted(env: Env, siteId: number): Promise<{ ok: boolean; message: string; key: string }> {
  const s = await env.DB.prepare("SELECT id, domain, platform, wp_user FROM sites WHERE id = ?").bind(siteId).first<{ id: number; domain: string; platform: string; wp_user: string | null }>();
  if (!s) throw new HttpError(404, "Không tìm thấy site.", "not_found");
  const k = await indexKey(env, siteId);
  const mark = async (mode: string | null, ok: boolean, err: string | null) => { await env.DB.prepare("UPDATE indexnow SET mode = ?, verified_at = ?, last_error = ?, updated_at = ? WHERE site_id = ?").bind(mode, ok ? now() : null, err, now(), siteId).run(); };
  if (await keyServed(s.domain, k.key)) { await mark(k.mode || "worker", true, null); return { ok: true, message: "File khoá IndexNow đã có trên site.", key: k.key }; }
  if (s.platform !== "astro" && s.wp_user) {
    try {
      await wpCall(env, siteId, "/indexnow-key", { method: "POST", body: { key: k.key } });
      if (await keyServed(s.domain, k.key)) { await mark("wordpress", true, null); return { ok: true, message: "Plugin WordPress đang phục vụ file khoá IndexNow.", key: k.key }; }
    } catch (e) { await mark(null, false, `Plugin chưa hỗ trợ (cần Duy Ơi Connector 1.3+): ${(e as Error).message.slice(0, 120)}`); }
  }
  const msg = s.platform === "astro"
    ? "File khoá chưa có: Worker bộ đo của site cần dựng lại (Số liệu site › Dựng lại) hoặc tên miền chưa vào Cloudflare."
    : "File khoá chưa có: cập nhật plugin Duy Ơi Connector 1.3+ (hoặc bật IndexNow của Rank Math).";
  const cur = await env.DB.prepare("SELECT last_error FROM indexnow WHERE site_id = ?").bind(siteId).first<{ last_error: string | null }>();
  await mark(null, false, cur?.last_error || msg);
  return { ok: false, message: msg, key: k.key };
}

// Gửi danh sách URL (bỏ URL đã gửi trong 24 giờ)
export async function submitUrls(env: Env, siteId: number, urls: string[], reason: string): Promise<{ sent: number; skipped: number; status?: number; error?: string }> {
  const s = await env.DB.prepare("SELECT domain FROM sites WHERE id = ?").bind(siteId).first<{ domain: string }>();
  if (!s) return { sent: 0, skipped: urls.length, error: "Không có site" };
  const host = s.domain.toLowerCase();
  const recent = new Set((await env.DB.prepare("SELECT url FROM indexnow_log WHERE site_id = ? AND at > ? AND status BETWEEN 200 AND 299").bind(siteId, now() - DAY).all<{ url: string }>()).results.map((r) => r.url));
  const list = [...new Set(urls)].filter((u) => { try { const h = new URL(u).hostname.toLowerCase(); return (h === host || h === `www.${host}` || `www.${h}` === host) && !recent.has(u); } catch { return false; } }).slice(0, 500);
  if (!list.length) return { sent: 0, skipped: urls.length };
  let k = await indexKey(env, siteId);
  if (!k.verified_at || now() - k.verified_at > 7 * DAY) {
    const h = await ensureKeyHosted(env, siteId);
    if (!h.ok) return { sent: 0, skipped: list.length, error: h.message };
    k = await indexKey(env, siteId);
  }
  const hostOf = new URL(list[0]!).hostname;
  let status = 0, error: string | undefined;
  try {
    const res = await fetch("https://api.indexnow.org/indexnow", { method: "POST", headers: { "Content-Type": "application/json; charset=utf-8" }, body: JSON.stringify({ host: hostOf, key: k.key, keyLocation: `https://${hostOf}/${k.key}.txt`, urlList: list }), signal: AbortSignal.timeout(15000) });
    status = res.status;
    if (status >= 300) error = `IndexNow trả ${status}${status === 403 ? " (khoá không khớp file trên site)" : status === 422 ? " (URL không thuộc tên miền hoặc khoá sai)" : status === 429 ? " (gửi quá nhiều)" : ""}`;
  } catch (e) { error = (e as Error).message.slice(0, 200); }
  const stmts = list.map((u) => env.DB.prepare("INSERT INTO indexnow_log (site_id, url, reason, status, at) VALUES (?, ?, ?, ?, ?)").bind(siteId, u, reason.slice(0, 60), status, now()));
  for (let i = 0; i < stmts.length; i += 80) await env.DB.batch(stmts.slice(i, i + 80));
  await env.DB.prepare("DELETE FROM indexnow_log WHERE site_id = ? AND id NOT IN (SELECT id FROM indexnow_log WHERE site_id = ? ORDER BY id DESC LIMIT 300)").bind(siteId, siteId).run();
  if (error) await env.DB.prepare("UPDATE indexnow SET last_error = ?, updated_at = ? WHERE site_id = ?").bind(error, now(), siteId).run();
  return { sent: error ? 0 : list.length, skipped: urls.length - list.length, status, error };
}

// Gọi sau khi app vừa sửa một trang (không ném lỗi)
export async function pingChanged(env: Env, siteId: number, url: string | null | undefined, reason: string): Promise<void> {
  if (!url) return;
  try { await submitUrls(env, siteId, [url], reason); } catch (e) { console.error("indexnow", (e as Error).message); }
}

export async function indexnowView(env: Env, siteId: number) {
  const k = await indexKey(env, siteId);
  const log = (await env.DB.prepare("SELECT url, reason, status, at FROM indexnow_log WHERE site_id = ? ORDER BY id DESC LIMIT 20").bind(siteId).all<Record<string, unknown>>()).results;
  return { key: k.key, mode: k.mode, verifiedAt: k.verified_at, lastError: k.last_error, log };
}

// POST /api/offpage/:siteId/indexnow — kiểm tra/dựng file khoá
export async function apiIndexnowCheck(env: Env, user: User, siteId: number): Promise<Response> {
  if (user.role === "viewer") throw new HttpError(403, "Tài khoản chỉ xem.", "forbidden");
  return json(await ensureKeyHosted(env, siteId));
}
