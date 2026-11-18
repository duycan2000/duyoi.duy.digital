// Đọc trang web cho team off-page và Social Entity: tải có giới hạn, đọc sitemap, rút tiêu đề/mô tả/ảnh/đoạn đầu, email liên hệ.

import { clean, decode } from "./recovery-extract";

export const UA = "Mozilla/5.0 (compatible; DuyOi/1.0; +https://duyoi.duy.digital)";

export async function fetchText(url: string, maxBytes = 400_000, timeout = 10000): Promise<{ status: number; url: string; text: string; type: string } | null> {
  let res: Response;
  try { res = await fetch(url, { headers: { "User-Agent": UA, Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.5" }, redirect: "follow", signal: AbortSignal.timeout(timeout) }); }
  catch { return null; }
  const type = res.headers.get("content-type") || "";
  if (!res.body) return { status: res.status, url: res.url || url, text: "", type };
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (size < maxBytes) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value); size += value.length;
    }
  } catch { /* trả phần đã đọc */ }
  try { await reader.cancel(); } catch { /* bỏ qua */ }
  const all = new Uint8Array(Math.min(size, maxBytes));
  let o = 0;
  for (const c of chunks) { const n = Math.min(c.length, all.length - o); all.set(c.subarray(0, n), o); o += n; if (o >= all.length) break; }
  return { status: res.status, url: res.url || url, text: new TextDecoder().decode(all), type };
}

export const hostOf = (u: string) => { try { return new URL(u).hostname.replace(/^www\./, "").toLowerCase(); } catch { return ""; } };
const attr = (tag: string, name: string) => decode((tag.match(new RegExp(`${name}\\s*=\\s*["']([^"']*)["']`, "i")) || [])[1] || "");
const meta = (html: string, key: string) => {
  for (const m of html.matchAll(/<meta\b[^>]*>/gi)) {
    const t = m[0];
    if (attr(t, "property").toLowerCase() === key || attr(t, "name").toLowerCase() === key) return attr(t, "content");
  }
  return "";
};

export interface PageInfo { url: string; title: string; description: string; image: string; excerpt: string; lang: string }
export function pageInfo(html: string, url: string): PageInfo {
  const body = (html.match(/<article[\s\S]*?<\/article>/i) || html.match(/<main[\s\S]*?<\/main>/i) || [html])[0];
  const paras = [...body.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/gi)].map((m) => clean(m[1]!)).filter((t) => t.length > 40);
  let image = meta(html, "og:image") || meta(html, "twitter:image");
  try { if (image) image = new URL(image, url).href; } catch { image = ""; }
  return {
    url,
    title: (meta(html, "og:title") || clean((html.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1] || "")).slice(0, 200),
    description: (meta(html, "og:description") || meta(html, "description")).slice(0, 400),
    image: image.startsWith("https://") ? image : "",
    excerpt: paras.join("\n").slice(0, 1500),
    lang: ((html.match(/<html[^>]*\blang=["']([a-zA-Z-]+)/i) || [])[1] || "").slice(0, 2).toLowerCase()
  };
}

export function linksIn(html: string, base: string): { href: string; text: string; rel: string }[] {
  const out: { href: string; text: string; rel: string }[] = [];
  for (const m of html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)) {
    const href = attr(m[1]!, "href");
    if (!href || href.startsWith("#") || /^(javascript|tel):/i.test(href)) continue;
    let abs = href;
    try { abs = new URL(href, base).href; } catch { continue; }
    out.push({ href: abs, text: clean(m[2]!).slice(0, 120), rel: attr(m[1]!, "rel").toLowerCase() });
    if (out.length >= 600) break;
  }
  return out;
}

const BAD_EMAIL = /\.(png|jpe?g|gif|webp|svg)$|example\.|sentry|wixpress|@2x|noreply|no-reply|donotreply/i;
export function emailsIn(html: string): string[] {
  const set = new Set<string>();
  for (const m of html.matchAll(/mailto:([^"'?>\s]+)/gi)) set.add(decodeURIComponent(m[1]!).toLowerCase());
  for (const m of clean(html).matchAll(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi)) set.add(m[0].toLowerCase());
  return [...set].filter((e) => !BAD_EMAIL.test(e) && e.length < 80).slice(0, 10);
}

const locs = (xml: string) => [...xml.matchAll(/<loc>\s*(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?\s*<\/loc>/gi)].map((m) => m[1]!.trim().replace(/&amp;/g, "&"));
const NOT_ARTICLE = /\/(tag|tags|category|categories|kategorie|author|autor|page|feed|search|cart|checkout|my-account|wp-json)\/|\/(impressum|datenschutz|privacy|privacy-policy|terms|agb|kontakt|contact|about|ueber-uns|about-us|cookie|disclaimer|sitemap)\/?$/i;

// URL bài viết của site lấy từ sitemap (Astro: sitemap-index.xml; WordPress: sitemap_index.xml / wp-sitemap.xml)
export async function sitemapUrls(domain: string, limit = 1500): Promise<string[]> {
  const origin = `https://${domain}`;
  const cands: string[] = [];
  const robots = await fetchText(`${origin}/robots.txt`, 50_000, 8000);
  if (robots && robots.status < 400) for (const m of robots.text.matchAll(/^\s*sitemap:\s*(\S+)/gim)) cands.push(m[1]!);
  cands.push(`${origin}/sitemap-index.xml`, `${origin}/sitemap_index.xml`, `${origin}/sitemap.xml`, `${origin}/wp-sitemap.xml`);
  const urls = new Set<string>();
  for (const sm of [...new Set(cands)]) {
    const r = await fetchText(sm, 2_000_000, 10000);
    if (!r || r.status >= 400 || !/<(urlset|sitemapindex)\b/i.test(r.text)) continue;
    if (/<sitemapindex\b/i.test(r.text)) {
      const kids = locs(r.text).filter((u) => !/image|tag|author|category|video/i.test(u)).sort((a, b) => Number(/post|blog|article|ratgeber/i.test(b)) - Number(/post|blog|article|ratgeber/i.test(a))).slice(0, 6);
      for (const k of kids) { const x = await fetchText(k, 2_000_000, 10000); if (x && x.status < 400) locs(x.text).forEach((u) => urls.add(u)); if (urls.size >= limit) break; }
    } else locs(r.text).forEach((u) => urls.add(u));
    if (urls.size) break;
  }
  return [...urls].filter((u) => hostOf(u) === domain && !NOT_ARTICLE.test(new URL(u).pathname) && new URL(u).pathname !== "/").slice(0, limit);
}

export const tokens = (s: string) => new Set(s.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").split(/[^a-z0-9äöüß]+/).filter((w) => w.length > 3));
export function overlap(a: string, b: string): number { const A = tokens(a), B = tokens(b); let n = 0; for (const w of A) if (B.has(w)) n++; return n; }
