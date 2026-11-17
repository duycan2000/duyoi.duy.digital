// Nơi lưu ảnh thật: Thư viện Media WordPress, hoặc Cloudflare R2 (site Astro, hay site nào đã điền "Tên miền ảnh").
// R2: một bucket chung (binding MEDIA), mỗi site một thư mục theo tên miền; ảnh phục vụ qua tên miền ảnh riêng của site.

import { HttpError } from "./http";
import { wpMedia } from "./wordpress";
import { ensureBucket, IMAGE_PREFIX, putObject } from "./cfmedia";
import { readSecret, getSettingsMap } from "./settings";
import type { Env } from "./types";

export interface MediaSite { id: number; domain: string; platform: string; media_base_url: string | null; wp_user: string | null; media_bucket: string | null; media_verified_at: number | null }
export type MediaMode = "site" | "r2" | "wordpress";

// site: bucket riêng của site, ảnh ở https://ten-mien/images/ (site Astro trên Cloudflare); r2: bucket chung + tên miền ảnh; wordpress: Thư viện Media
export const mediaMode = (s: MediaSite): MediaMode => (s.media_base_url ? "r2" : s.platform === "astro" ? "site" : "wordpress");

export async function mediaSite(env: Env, siteId: number): Promise<MediaSite> {
  const s = await env.DB.prepare("SELECT id, domain, platform, media_base_url, wp_user, media_bucket, media_verified_at FROM sites WHERE id = ?").bind(siteId).first<MediaSite>();
  if (!s) throw new HttpError(404, "Không tìm thấy site.", "not_found");
  return s;
}

export async function mediaReady(env: Env, s: MediaSite): Promise<{ mode: MediaMode; ready: boolean; verified: boolean; why: string; siteId: number; base: string }> {
  const r = await ready0(env, s);
  return { ...r, verified: r.mode !== "site" || !!s.media_verified_at, siteId: s.id, base: r.mode === "site" ? `https://${s.domain}${IMAGE_PREFIX}` : r.mode === "r2" ? `${s.media_base_url}/` : "" };
}

async function ready0(env: Env, s: MediaSite): Promise<{ mode: MediaMode; ready: boolean; why: string }> {
  const mode = mediaMode(s);
  if (mode === "site") {
    const token = await readSecret(env, "cloudflare_api_token");
    const account = String((await getSettingsMap(env)).cloudflare_account_id || "");
    if (!token || !/^[a-f0-9]{32}$/.test(account)) return { mode, ready: false, why: "Site Astro: ảnh lưu ở bucket R2 riêng của site. Cần Cloudflare API token và Account ID trong Cài đặt." };
    return { mode, ready: true, why: "" };
  }
  if (mode === "r2") {
    if (!env.MEDIA) return { mode, ready: false, why: "Worker chưa có bucket R2 (binding MEDIA): deploy lại bản mới nhất." };
    if (!s.media_base_url) return { mode, ready: false, why: "Chưa điền Tên miền ảnh cho site (Site › sửa site), ví dụ https://img.ten-mien.com đã gắn vào bucket duyoi-media." };
    return { mode, ready: true, why: "" };
  }
  const wp = await env.DB.prepare("SELECT 1 FROM secrets WHERE key = ?").bind(`wp:${s.id}`).first();
  return wp && s.wp_user ? { mode, ready: true, why: "" } : { mode, ready: false, why: "Cần kết nối WordPress (Site › Kết nối WordPress) để tải ảnh." };
}

export async function storeImage(env: Env, s: MediaSite, f: { bytes: Uint8Array; type: string; filename: string; alt: string; caption: string; width: number | null; height: number | null }): Promise<{ id: number; url: string; width: number | null; height: number | null; key?: string }> {
  if (mediaMode(s) === "wordpress") return wpMedia(env, s.id, f);
  if (mediaMode(s) === "site") {
    const bucket = s.media_bucket || (await ensureBucket(env, s.id, s.domain));
    const month = new Date().toISOString().slice(0, 7).replace("-", "/");
    const key = `${month}/${f.filename.replace(/(\.\w+)$/, `-${Date.now().toString(36)}$1`)}`;
    await putObject(env, bucket, key, f.bytes, f.type);
    return { id: 0, url: `https://${s.domain}${IMAGE_PREFIX}${key}`, width: f.width, height: f.height, key };
  }
  const st = await mediaReady(env, s);
  if (!st.ready) throw new HttpError(400, st.why, "media_not_ready");
  const month = new Date().toISOString().slice(0, 7).replace("-", "/");
  let key = `${s.domain}/${month}/${f.filename}`;
  if (await env.MEDIA!.head(key)) key = key.replace(/(\.\w+)$/, `-${Date.now().toString(36)}$1`);
  await env.MEDIA!.put(key, f.bytes, { httpMetadata: { contentType: f.type, cacheControl: "public, max-age=31536000, immutable" }, customMetadata: { alt: f.alt.slice(0, 160) } });
  return { id: 0, url: `${s.media_base_url}/${key}`, width: f.width, height: f.height, key };
}
