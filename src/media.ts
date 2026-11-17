// Nơi lưu ảnh thật: Thư viện Media WordPress, hoặc Cloudflare R2 (site Astro, hay site nào đã điền "Tên miền ảnh").
// R2: một bucket chung (binding MEDIA), mỗi site một thư mục theo tên miền; ảnh phục vụ qua tên miền ảnh riêng của site.

import { HttpError } from "./http";
import { wpMedia } from "./wordpress";
import type { Env } from "./types";

export interface MediaSite { id: number; domain: string; platform: string; media_base_url: string | null; wp_user: string | null }

export const mediaMode = (s: MediaSite): "r2" | "wordpress" => (s.media_base_url || s.platform === "astro" ? "r2" : "wordpress");

export async function mediaSite(env: Env, siteId: number): Promise<MediaSite> {
  const s = await env.DB.prepare("SELECT id, domain, platform, media_base_url, wp_user FROM sites WHERE id = ?").bind(siteId).first<MediaSite>();
  if (!s) throw new HttpError(404, "Không tìm thấy site.", "not_found");
  return s;
}

export async function mediaReady(env: Env, s: MediaSite): Promise<{ mode: "r2" | "wordpress"; ready: boolean; why: string }> {
  const mode = mediaMode(s);
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
  const st = await mediaReady(env, s);
  if (!st.ready) throw new HttpError(400, st.why, "media_not_ready");
  const month = new Date().toISOString().slice(0, 7).replace("-", "/");
  let key = `${s.domain}/${month}/${f.filename}`;
  if (await env.MEDIA!.head(key)) key = key.replace(/(\.\w+)$/, `-${Date.now().toString(36)}$1`);
  await env.MEDIA!.put(key, f.bytes, { httpMetadata: { contentType: f.type, cacheControl: "public, max-age=31536000, immutable" }, customMetadata: { alt: f.alt.slice(0, 160) } });
  return { id: 0, url: `${s.media_base_url}/${key}`, width: f.width, height: f.height, key };
}
