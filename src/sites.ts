// Quản lý site. App không dựng site: anh dựng site bằng Claude, ở đây chỉ khai báo để agent làm SEO.

import { HttpError, json, now, readJson, str } from "./http";
import { logActivity } from "./activity";
import type { Env, User } from "./types";

const PLATFORMS = ["astro", "wordpress", "woocommerce"] as const;
const TYPES = ["service", "rank_rent", "affiliate", "adsense", "ecommerce"] as const;
const STATUSES = ["active", "paused", "archived"] as const;

export interface SiteRow {
  id: number; name: string; domain: string; platform: string; site_type: string; market: string; language: string;
  repo: string | null; wp_user: string | null; media_base_url?: string | null; notes: string | null; status: string; created_at: number; updated_at: number;
}

function oneOf<T extends readonly string[]>(v: unknown, list: T, field: string, fallback?: T[number]): T[number] {
  if ((v == null || v === "") && fallback) return fallback;
  if (typeof v === "string" && (list as readonly string[]).includes(v)) return v as T[number];
  throw new HttpError(400, `${field} không hợp lệ.`, "validation");
}

export function normalizeDomain(v: unknown): string {
  let d = str(v, "Domain", { max: 253 }).toLowerCase();
  d = d.replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/.*$/, "");
  if (!/^(?=.{3,253}$)([a-z0-9-]+\.)+[a-z]{2,}$/.test(d)) throw new HttpError(400, "Domain không hợp lệ (ví dụ: golfgaragelab.com).", "validation");
  return d;
}

function parseSite(body: Record<string, unknown>, partial: boolean) {
  const out: Record<string, unknown> = {};
  if (!partial || body.name !== undefined) out.name = str(body.name, "Tên site", { min: 2, max: 80 });
  if (!partial || body.domain !== undefined) out.domain = normalizeDomain(body.domain);
  if (!partial || body.platform !== undefined) out.platform = oneOf(body.platform, PLATFORMS, "Nền tảng");
  if (!partial || body.siteType !== undefined) out.site_type = oneOf(body.siteType, TYPES, "Loại site", "affiliate");
  if (!partial || body.market !== undefined) {
    const m = str(body.market, "Thị trường", { optional: true, max: 2 }).toUpperCase() || "US";
    if (!/^[A-Z]{2}$/.test(m)) throw new HttpError(400, "Thị trường là mã quốc gia 2 chữ (US, AU, DE…).", "validation");
    out.market = m;
  }
  if (!partial || body.language !== undefined) {
    const l = str(body.language, "Ngôn ngữ", { optional: true, max: 5 }).toLowerCase() || "en";
    if (!/^[a-z]{2}(-[a-z]{2})?$/.test(l)) throw new HttpError(400, "Ngôn ngữ dạng en, de, vi…", "validation");
    out.language = l;
  }
  if (body.repo !== undefined) {
    const r = str(body.repo, "Repo", { optional: true, max: 140 });
    if (r && !/^[\w.-]+\/[\w.-]+$/.test(r)) throw new HttpError(400, "Repo dạng owner/ten-repo.", "validation");
    out.repo = r || null;
  }
  if (body.wpUser !== undefined) out.wp_user = str(body.wpUser, "User WordPress", { optional: true, max: 60 }) || null;
  if (body.mediaBaseUrl !== undefined) {
    const v = str(body.mediaBaseUrl, "Tên miền ảnh", { optional: true, max: 200 }).replace(/\/+$/, "");
    if (v && !/^https:\/\/([a-z0-9-]+\.)+[a-z]{2,}(\/[\w./-]*)?$/i.test(v)) throw new HttpError(400, "Tên miền ảnh dạng https://img.ten-mien.com (https, không có dấu / ở cuối).", "validation");
    out.media_base_url = v || null;
  }
  if (body.notes !== undefined) out.notes = str(body.notes, "Ghi chú", { optional: true, max: 2000 }) || null;
  if (body.status !== undefined) out.status = oneOf(body.status, STATUSES, "Trạng thái");
  return out;
}

const toApi = (s: SiteRow) => ({
  id: s.id, name: s.name, domain: s.domain, platform: s.platform, siteType: s.site_type, market: s.market,
  language: s.language, repo: s.repo, wpUser: s.wp_user, mediaBaseUrl: s.media_base_url ?? null, notes: s.notes, status: s.status, createdAt: s.created_at, updatedAt: s.updated_at
});

export async function listSites(env: Env, url: URL): Promise<Response> {
  const includeArchived = url.searchParams.get("archived") === "1";
  const { results } = await env.DB.prepare(
    `SELECT * FROM sites ${includeArchived ? "" : "WHERE status != 'archived'"} ORDER BY name COLLATE NOCASE`
  ).all<SiteRow>();
  return json({ sites: results.map(toApi) });
}

export async function getSite(env: Env, id: number): Promise<Response> {
  const s = await env.DB.prepare("SELECT * FROM sites WHERE id = ?").bind(id).first<SiteRow>();
  if (!s) throw new HttpError(404, "Không tìm thấy site.", "not_found");
  return json({ site: toApi(s) });
}

export async function createSite(env: Env, req: Request, user: User): Promise<Response> {
  if (user.role === "viewer") throw new HttpError(403, "Tài khoản chỉ xem.", "forbidden");
  const v = parseSite(await readJson(req), false);
  const t = now();
  try {
    const res = await env.DB.prepare(
      "INSERT INTO sites (name, domain, platform, site_type, market, language, repo, wp_user, media_base_url, notes, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?)"
    ).bind(v.name, v.domain, v.platform, v.site_type, v.market, v.language, v.repo ?? null, v.wp_user ?? null, v.media_base_url ?? null, v.notes ?? null, t, t).run();
    const id = Number(res.meta.last_row_id);
    await logActivity(env, `user:${user.id}`, "site.created", `${v.name} (${v.domain})`, id);
    return getSite(env, id).then((r) => new Response(r.body, { status: 201, headers: r.headers }));
  } catch (e) {
    if (String(e).includes("UNIQUE")) throw new HttpError(409, "Domain này đã có trong app.", "duplicate");
    throw e;
  }
}

export async function updateSite(env: Env, req: Request, user: User, id: number): Promise<Response> {
  if (user.role === "viewer") throw new HttpError(403, "Tài khoản chỉ xem.", "forbidden");
  const v = parseSite(await readJson(req), true);
  const keys = Object.keys(v);
  if (!keys.length) throw new HttpError(400, "Không có gì để cập nhật.", "validation");
  const exists = await env.DB.prepare("SELECT id FROM sites WHERE id = ?").bind(id).first();
  if (!exists) throw new HttpError(404, "Không tìm thấy site.", "not_found");
  try {
    await env.DB.prepare(`UPDATE sites SET ${keys.map((k) => `${k} = ?`).join(", ")}, updated_at = ? WHERE id = ?`)
      .bind(...keys.map((k) => v[k]), now(), id).run();
  } catch (e) {
    if (String(e).includes("UNIQUE")) throw new HttpError(409, "Domain này đã có trong app.", "duplicate");
    throw e;
  }
  await logActivity(env, `user:${user.id}`, "site.updated", keys.join(", "), id);
  return getSite(env, id);
}
