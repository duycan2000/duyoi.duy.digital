// Gọi plugin "Duy Ơi Connector" trên site WordPress bằng Application Password (không dùng mật khẩu đăng nhập web).

import { HttpError, json, readJson, str } from "./http";
import { logActivity } from "./activity";
import { readSiteSecret, setSiteSecret, siteSecretInfo } from "./settings";
import { b64 } from "./crypto";
import type { Env, User } from "./types";

export interface WpPost {
  id: number; type: string; status: string; slug: string; link: string; modified_gmt: string;
  content: string; elementor: boolean; elementor_data: string | null; meta: Record<string, unknown>;
}

export interface WpEdit { find: string; replace?: string; insert?: string; mode: "replace" | "after_block" | "before_block" }

interface SiteRow { id: number; domain: string; platform: string; wp_user: string | null }

async function siteOf(env: Env, siteId: number): Promise<SiteRow> {
  const s = await env.DB.prepare("SELECT id, domain, platform, wp_user FROM sites WHERE id = ?").bind(siteId).first<SiteRow>();
  if (!s) throw new HttpError(404, "Không tìm thấy site.", "not_found");
  return s;
}

export async function wpCall<T>(env: Env, siteId: number, path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const site = await siteOf(env, siteId);
  const pass = await readSiteSecret(env, siteId);
  if (!site.wp_user || !pass) throw new HttpError(400, "Site chưa kết nối WordPress (thiếu user hoặc Application Password).", "wp_not_connected");
  const auth = b64(new TextEncoder().encode(`${site.wp_user}:${pass}`));
  let res: Response;
  try {
    res = await fetch(`https://${site.domain}/wp-json/duyoi/v1${path}`, {
      method: init.method || "GET",
      headers: { Authorization: `Basic ${auth}`, "Content-Type": "application/json", Accept: "application/json", "User-Agent": "DuyOi/1.0" },
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
      signal: AbortSignal.timeout(25000)
    });
  } catch (e) {
    throw new HttpError(502, `Không gọi được WordPress: ${(e as Error).message}`, "wp_unreachable");
  }
  const text = await res.text();
  let data: Record<string, unknown> = {};
  try { data = JSON.parse(text); } catch { /* không phải JSON */ }
  if (!res.ok) {
    const msg = typeof data.message === "string" ? data.message : text.slice(0, 200);
    if (res.status === 404 && data.code === "rest_no_route") throw new HttpError(502, "Chưa cài plugin Duy Ơi Connector trên site (hoặc REST API bị chặn).", "wp_no_plugin");
    if (res.status === 401 || res.status === 403) throw new HttpError(502, `WordPress từ chối đăng nhập: ${msg}. Kiểm tra user và Application Password.`, "wp_auth");
    throw new HttpError(res.status === 409 ? 409 : 502, `WordPress báo lỗi: ${msg}`, String(data.code || "wp_error"));
  }
  return data as T;
}

export const wpGetPost = (env: Env, siteId: number, url: string) => wpCall<WpPost>(env, siteId, `/post?url=${encodeURIComponent(url)}`);

export const wpApply = (env: Env, siteId: number, body: { id: number; expected_modified: string; edits: WpEdit[]; meta: Record<string, string>; dry_run?: boolean }) =>
  wpCall<{ ok: boolean; changes: number; meta: string[]; elementor: boolean; purged?: string[]; modified_gmt?: string }>(env, siteId, "/apply", { method: "POST", body });

export const wpRestore = (env: Env, siteId: number, body: { id: number; content: string | null; elementor_data: string | null; meta: Record<string, unknown> }) =>
  wpCall<{ ok: boolean; purged: string[] }>(env, siteId, "/restore", { method: "POST", body });

// ---------------- API cho màn Site ----------------

// GET /api/sites/:id/wp
export async function wpStatus(env: Env, siteId: number): Promise<Response> {
  const s = await siteOf(env, siteId);
  return json({ wpUser: s.wp_user, password: await siteSecretInfo(env, siteId) });
}

// PUT /api/sites/:id/wp { wpUser, appPassword?: string | null }
export async function wpSave(env: Env, req: Request, user: User, siteId: number): Promise<Response> {
  if (user.role === "viewer") throw new HttpError(403, "Tài khoản chỉ xem.", "forbidden");
  const s = await siteOf(env, siteId);
  const body = await readJson(req);
  const wpUser = str(body.wpUser, "User WordPress", { max: 60 });
  await env.DB.prepare("UPDATE sites SET wp_user = ?, updated_at = ? WHERE id = ?").bind(wpUser, Date.now(), siteId).run();
  if (body.appPassword === null) await setSiteSecret(env, siteId, null);
  else if (typeof body.appPassword === "string" && body.appPassword.trim()) await setSiteSecret(env, siteId, body.appPassword);
  await logActivity(env, `user:${user.id}`, "site.wp_connection", `Cập nhật kết nối WordPress cho ${s.domain}`, siteId);
  return wpStatus(env, siteId);
}

// POST /api/sites/:id/wp/test
export async function wpTest(env: Env, siteId: number): Promise<Response> {
  const r = await wpCall<Record<string, unknown>>(env, siteId, "/ping");
  return json({ ok: true, info: r });
}
