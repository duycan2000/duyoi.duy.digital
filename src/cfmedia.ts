// Ảnh cho site Astro chạy trên Cloudflare: mỗi site một bucket R2 riêng, ảnh nằm ngay trên tên miền của site (/images/...).
// App dùng Cloudflare API token (Cài đặt) để: tạo bucket, dựng Worker "duyoi-img-…" đọc bucket, gắn route ten-mien/images/*,
// rồi tự kiểm tra bằng một file thử. Không có tên miền ảnh dùng chung nên không lộ liên hệ giữa các site.

import { HttpError, json, now } from "./http";
import { logActivity } from "./activity";
import { getSettingsMap, readSecret } from "./settings";
import type { Env, User } from "./types";

export const IMAGE_PREFIX = "/images/";
const slug = (domain: string) => domain.toLowerCase().replace(/^www\./, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
export const bucketNameFor = (domain: string) => `img-${slug(domain)}`.slice(0, 63).replace(/-$/, "");
export const workerNameFor = (domain: string) => `duyoi-img-${slug(domain)}`.slice(0, 63).replace(/-$/, "");

// Mã Worker phục vụ ảnh (chỉ GET/HEAD dưới /images/, có cache để ít lượt đọc R2)
export const IMAGE_WORKER = `export default {
  async fetch(req, env, ctx) {
    const url = new URL(req.url);
    if (!url.pathname.startsWith("${IMAGE_PREFIX}")) return fetch(req);
    if (req.method !== "GET" && req.method !== "HEAD") return new Response("Method not allowed", { status: 405 });
    const cache = caches.default;
    const hit = await cache.match(req);
    if (hit) return hit;
    const key = decodeURIComponent(url.pathname.slice(${IMAGE_PREFIX.length}));
    const obj = await env.IMAGES.get(key);
    if (!obj) return new Response("Not found", { status: 404 });
    const h = new Headers();
    obj.writeHttpMetadata(h);
    h.set("etag", obj.httpEtag);
    h.set("Cache-Control", key.startsWith("_duyoi/") ? "no-store" : "public, max-age=31536000, immutable");
    h.set("X-Content-Type-Options", "nosniff");
    const res = new Response(req.method === "HEAD" ? null : obj.body, { headers: h });
    if (req.method === "GET" && !key.startsWith("_duyoi/")) ctx.waitUntil(cache.put(req, res.clone()));
    return res;
  }
};
`;

async function creds(env: Env): Promise<{ token: string; account: string }> {
  const token = await readSecret(env, "cloudflare_api_token");
  const account = String((await getSettingsMap(env)).cloudflare_account_id || "");
  if (!token || !/^[a-f0-9]{32}$/.test(account)) throw new HttpError(400, "Chưa có Cloudflare API token hoặc Account ID trong Cài đặt.", "no_cloudflare");
  return { token, account };
}

async function cf<T>(env: Env, path: string, init: { method?: string; body?: BodyInit; json?: unknown; headers?: Record<string, string> } = {}, ok404 = false): Promise<T | null> {
  const { token } = await creds(env);
  const headers: Record<string, string> = { Authorization: `Bearer ${token}`, ...(init.headers || {}) };
  if (init.json !== undefined) headers["Content-Type"] = "application/json";
  let res: Response;
  try {
    res = await fetch(`https://api.cloudflare.com/client/v4${path}`, { method: init.method || "GET", headers, body: init.json !== undefined ? JSON.stringify(init.json) : init.body, signal: AbortSignal.timeout(30000) });
  } catch (e) {
    throw new HttpError(502, `Không gọi được Cloudflare API: ${(e as Error).message}`, "cf_unreachable");
  }
  if (ok404 && res.status === 404) return null;
  const data = (await res.json().catch(() => ({}))) as { success?: boolean; result?: T; errors?: { code?: number; message?: string }[] };
  if (!res.ok || data.success === false) {
    const msg = data.errors?.map((e) => e.message).join("; ") || String(res.status);
    if (res.status === 403 || res.status === 401) throw new HttpError(502, `Cloudflare từ chối (thiếu quyền token): ${msg}`, "cf_auth");
    throw new HttpError(502, `Cloudflare báo lỗi: ${msg}`, "cf_error");
  }
  return (data.result ?? ({} as T)) as T;
}

export async function ensureBucket(env: Env, siteId: number, domain: string): Promise<string> {
  const { account } = await creds(env);
  const name = bucketNameFor(domain);
  const found = await cf(env, `/accounts/${account}/r2/buckets/${name}`, {}, true);
  if (!found) await cf(env, `/accounts/${account}/r2/buckets`, { method: "POST", json: { name } });
  await env.DB.prepare("UPDATE sites SET media_bucket = ?, updated_at = ? WHERE id = ?").bind(name, now(), siteId).run();
  return name;
}

export async function putObject(env: Env, bucket: string, key: string, bytes: Uint8Array, type: string, cacheControl = "public, max-age=31536000, immutable"): Promise<void> {
  const { account } = await creds(env);
  await cf(env, `/accounts/${account}/r2/buckets/${bucket}/objects/${key.split("/").map(encodeURIComponent).join("/")}`, { method: "PUT", body: bytes.slice().buffer as ArrayBuffer, headers: { "Content-Type": type, "Cache-Control": cacheControl } });
}

interface SiteM { id: number; domain: string; media_bucket: string | null; media_verified_at: number | null }

async function siteM(env: Env, id: number): Promise<SiteM> {
  const s = await env.DB.prepare("SELECT id, domain, media_bucket, media_verified_at FROM sites WHERE id = ?").bind(id).first<SiteM>();
  if (!s) throw new HttpError(404, "Không tìm thấy site.", "not_found");
  return s;
}

async function verify(env: Env, s: SiteM, bucket: string): Promise<{ ok: boolean; message: string }> {
  const token = crypto.randomUUID();
  const key = `_duyoi/check-${token.slice(0, 8)}.txt`;
  await putObject(env, bucket, key, new TextEncoder().encode(token), "text/plain", "no-store");
  try {
    const res = await fetch(`https://${s.domain}${IMAGE_PREFIX}${key}`, { headers: { "User-Agent": "DuyOi/1.0" }, signal: AbortSignal.timeout(15000) });
    const body = (await res.text()).trim();
    if (res.ok && body === token) {
      await env.DB.prepare("UPDATE sites SET media_verified_at = ?, updated_at = ? WHERE id = ?").bind(now(), now(), s.id).run();
      return { ok: true, message: `https://${s.domain}${IMAGE_PREFIX} đã phục vụ ảnh từ bucket ${bucket}.` };
    }
    return { ok: false, message: `https://${s.domain}${IMAGE_PREFIX}… trả về ${res.status}: route chưa chạy (đợi 1–2 phút rồi Kiểm tra lại) hoặc site chặn đường dẫn này.` };
  } catch (e) {
    return { ok: false, message: `Không mở được https://${s.domain}${IMAGE_PREFIX}: ${(e as Error).message}` };
  }
}

// POST /api/sites/:id/media — dựng toàn bộ: bucket, Worker ảnh, route, kiểm tra
export async function apiSetupMedia(env: Env, user: User, id: number): Promise<Response> {
  if (user.role !== "admin") throw new HttpError(403, "Chỉ admin được dựng kho ảnh.", "forbidden");
  const s = await siteM(env, id);
  const { account } = await creds(env);
  const steps: { step: string; ok: boolean; message: string }[] = [];
  const bucket = await ensureBucket(env, s.id, s.domain);
  steps.push({ step: "bucket", ok: true, message: `Bucket R2 ${bucket}` });
  const worker = workerNameFor(s.domain);
  const fd = new FormData();
  fd.append("metadata", new Blob([JSON.stringify({ main_module: "worker.js", compatibility_date: "2026-11-01", bindings: [{ type: "r2_bucket", name: "IMAGES", bucket_name: bucket }] })], { type: "application/json" }));
  fd.append("worker.js", new Blob([IMAGE_WORKER], { type: "application/javascript+module" }), "worker.js");
  await cf(env, `/accounts/${account}/workers/scripts/${worker}`, { method: "PUT", body: fd });
  steps.push({ step: "worker", ok: true, message: `Worker ${worker}` });
  const apex = s.domain.replace(/^www\./, "");
  const zones = await cf<{ id: string; name: string }[]>(env, `/zones?name=${encodeURIComponent(apex)}`);
  const zone = zones?.[0];
  if (!zone) {
    steps.push({ step: "route", ok: false, message: `Tên miền ${apex} chưa nằm trong tài khoản Cloudflare này (hoặc token thiếu quyền Zone Read).` });
    return json({ ok: false, steps });
  }
  const existing = (await cf<{ pattern: string; script: string }[]>(env, `/zones/${zone.id}/workers/routes`)) || [];
  for (const pattern of [`${apex}${IMAGE_PREFIX}*`, `www.${apex}${IMAGE_PREFIX}*`]) {
    const r = existing.find((x) => x.pattern === pattern);
    if (r && r.script === worker) continue;
    if (r) { steps.push({ step: "route", ok: false, message: `Route ${pattern} đang thuộc Worker ${r.script}: gỡ route đó hoặc đổi đường dẫn ảnh.` }); return json({ ok: false, steps }); }
    await cf(env, `/zones/${zone.id}/workers/routes`, { method: "POST", json: { pattern, script: worker } });
  }
  steps.push({ step: "route", ok: true, message: `Route ${apex}${IMAGE_PREFIX}* (và www)` });
  const v = await verify(env, s, bucket);
  steps.push({ step: "verify", ...v });
  await logActivity(env, `user:${user.id}`, "media.setup", `Dựng kho ảnh cho ${s.domain}: ${v.ok ? "đã chạy" : "chưa kiểm tra được"}`, s.id);
  return json({ ok: v.ok, steps });
}

// POST /api/sites/:id/media/check — chỉ kiểm tra (dùng khi anh tự phục vụ /images/ trong code Astro)
export async function apiCheckMedia(env: Env, user: User, id: number): Promise<Response> {
  if (user.role === "viewer") throw new HttpError(403, "Tài khoản chỉ xem.", "forbidden");
  const s = await siteM(env, id);
  const bucket = s.media_bucket || (await ensureBucket(env, s.id, s.domain));
  const v = await verify(env, s, bucket);
  return json({ ok: v.ok, steps: [{ step: "verify", ...v }] });
}
