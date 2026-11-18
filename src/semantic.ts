// Semantic SEO theo cách Koray Tuğberk Gübür mô tả Topical Authority (mô hình của ông, không phải công thức Google công bố):
// Topical Authority ≈ (Topical Coverage × Historical Data) / Cost of Retrieval.
// Module này đo những gì đo được bằng máy, không cần AI:
//  - Cost of Retrieval / Predictive IR: chủ đề nói rõ ngay 4 câu đầu và 2 mục đầu, phân cấp heading, khối nội dung rõ (visual semantics).
//  - Topical Coverage: bản đồ Core (trang kiếm tiền) / Outer (trang kiến thức), Outer phải link về Core; truy vấn mở rộng (query fan-out) từ Search Console
//    chưa có heading/đoạn trả lời; truy vấn nên thành trang riêng.
//  - Source Context: loại site Google đang cho lên top các từ khoá theo dõi (lấy từ Rank Tracker, không tốn thêm lệnh).
//  - Web Entity: Organization sameAs, mạng xã hội còn hoạt động, citations.
// Không tự sửa site: kết quả là danh sách việc; sửa nội dung và link nội bộ đi qua ca Phục hồi (Gác cổng, anh duyệt).

import { logActivity } from "./activity";
import type { GateProblem } from "./recovery-gate";
import { readRules } from "./recovery-rules";
import { getSettingsMap } from "./settings";
import { HttpError, json, now } from "./http";
import { fetchText, sitemapUrls } from "./web";
import type { Env, User } from "./types";

const DAY = 86400000;
const STOP = new Set("the a an and or of to in for on with is are was be by at as how what why which your you it this that from best vs der die das und oder für mit ist sind ein eine wie was zu im den dem des auf von bei la le les et de du des pour và của cho là có các những một với trong khi như thế nào".split(" "));
const FILLER: Record<string, RegExp> = {
  en: /\b(in today's (fast-paced )?world|it is important to note|in conclusion|when it comes to|plays a (crucial|vital) role|look no further|unlock the (power|potential)|delve into|game[- ]changer)\b/gi,
  de: /\b(in der heutigen (schnelllebigen )?zeit|es ist wichtig zu beachten|zusammenfassend lässt sich sagen|spielt eine (entscheidende|wichtige) rolle|wenn es um .{1,20} geht)\b/gi,
  vi: /(trong thời đại ngày nay|không thể phủ nhận|đóng vai trò quan trọng|tóm lại|nói tóm lại)/gi
};

export interface SemCheck { code: string; level: "high" | "medium" | "low"; message: string }
export interface SemPage {
  url: string; title: string; h1: string; role: "core" | "outer"; words: number; score: number; checks: SemCheck[];
  headings: string[]; links: string[]; outbound: number; status: number;
}

const decode = (s: string) => s.replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#0?39;|&apos;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));
const strip = (h: string) => decode(h.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
export const toks = (s: string) => [...new Set(s.toLowerCase().normalize("NFC").split(/[^\p{L}\p{N}]+/u).filter((w) => w.length >= 3 && !STOP.has(w)))];
// Khớp gần đúng theo gốc từ (Dienstleistung ~ Dienstleistungen, symbol ~ symbole)
const stem = (t: string) => t.slice(0, Math.max(4, t.length - 3));
const has = (text: string, t: string) => text.toLowerCase().includes(stem(t));
const words = (s: string) => (s.match(/[\p{L}\p{N}]+/gu) || []).length;

// Phần nội dung chính: bỏ menu, footer, sidebar; ưu tiên <main>/<article>
function mainHtml(html: string): string {
  const body = html.replace(/<(script|style|noscript|svg|template)[\s\S]*?<\/\1>/gi, " ").replace(/<!--[\s\S]*?-->/g, " ");
  const pick = body.match(/<article[\s>][\s\S]*<\/article>/i)?.[0] || body.match(/<main[\s>][\s\S]*<\/main>/i)?.[0] || body.match(/<body[\s>][\s\S]*<\/body>/i)?.[0] || body;
  return pick.replace(/<(nav|header|footer|aside|form)[\s>][\s\S]*?<\/\1>/gi, " ");
}

const COMMERCIAL = /(dienstleistung|leistung|service|preise?|pricing|kosten|angebot|kontakt|contact|quote|buy|kaufen|shop|product|produkt|best-|review|test-|-vs-|vs-|alternative|dich-vu|bang-gia|bao-gia|lien-he)/i;

export function classifyRole(url: string, html: string, commercialPaths: string[]): "core" | "outer" {
  let path = "/";
  try { path = new URL(url).pathname; } catch { /* giữ / */ }
  if (path === "/" || commercialPaths.some((p) => p && path.startsWith(p))) return "core";
  if (COMMERCIAL.test(path)) return "core";
  if (/rel=["'][^"']*sponsored/i.test(html) || /data-dy-cta|class=["'][^"']*(buy|cta|pricing)/i.test(html)) return "core";
  return "outer";
}

// Đánh giá một trang (hoặc bản nháp) theo các nguyên tắc giảm chi phí truy xuất
export function analyzeHtml(html: string, url: string, opts: { title?: string; lang?: string; role?: "core" | "outer" } = {}): Omit<SemPage, "role" | "status"> & { role?: "core" | "outer" } {
  const main = mainHtml(html);
  const title = opts.title ?? strip(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || "");
  const h1s = [...main.matchAll(/<h1[^>]*>([\s\S]*?)<\/h1>/gi)].map((m) => strip(m[1]!));
  const allH1 = h1s.length ? h1s : [...html.matchAll(/<h1[^>]*>([\s\S]*?)<\/h1>/gi)].map((m) => strip(m[1]!));
  const heads = [...main.matchAll(/<h([1-6])[^>]*>([\s\S]*?)<\/h\1>/gi)].map((m) => ({ level: Number(m[1]), text: strip(m[2]!) }));
  const h2 = heads.filter((h) => h.level === 2).map((h) => h.text);
  const paras = [...main.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/gi)].map((m) => strip(m[1]!)).filter((p) => p.length > 0);
  const text = strip(main);
  const w = words(text);
  const topic = toks(`${allH1[0] || ""} ${title}`);
  const checks: SemCheck[] = [];
  const add = (code: string, level: SemCheck["level"], message: string) => checks.push({ code, level, message });

  // 1. Predictive IR: 4 câu đầu phải nói rõ chủ đề
  const intro = paras.join(" ").split(/(?<=[.!?…])\s+/).slice(0, 4).join(" ");
  const hit = topic.filter((t) => has(intro, t)).length;
  if (topic.length >= 2 && hit < Math.ceil(topic.length / 2)) add("lead", "high", `4 câu đầu chưa nói rõ chủ đề "${allH1[0] || title}": mở bài bằng câu trả lời trực tiếp, nêu đúng thực thể và ý chính.`);
  const first = intro.split(/(?<=[.!?…])\s+/)[0] || "";
  if (words(first) > 40) add("lead_long", "low", "Câu đầu dài trên 40 từ: tách thành câu trả lời ngắn trước, giải thích sau.");
  // 2 mục đầu phải gắn với chủ đề chính
  const early = h2.slice(0, 2);
  if (topic.length && early.length === 2 && early.every((h) => !topic.some((t) => has(h, t)))) add("early_sections", "medium", "2 mục đầu không nhắc chủ đề chính: đưa phần quan trọng nhất (định nghĩa, câu trả lời, giá trị chính) lên đầu.");

  // 2. Visual semantics: phân cấp và khối nội dung
  if (allH1.length !== 1) add("h1", "medium", `Trang có ${allH1.length} H1: cần đúng một H1 nêu thực thể chính.`);
  for (let i = 1; i < heads.length; i++) if (heads[i]!.level > heads[i - 1]!.level + 1) { add("hierarchy", "low", `Heading nhảy cấp (H${heads[i - 1]!.level} → H${heads[i]!.level} ở "${heads[i]!.text.slice(0, 60)}"): giữ cấp liền nhau để máy chia khối đúng.`); break; }
  const walls = paras.filter((p) => words(p) > 120).length;
  if (walls) add("walls", walls >= 3 ? "medium" : "low", `${walls} đoạn văn trên 120 từ: chia thành đoạn ngắn, mỗi đoạn một ý, hoặc chuyển thành danh sách/bảng.`);
  const tables = (main.match(/<table[\s>]/gi) || []).length, lists = (main.match(/<(ul|ol)[\s>]/gi) || []).length;
  const faq = /<details[\s>]/i.test(main) || h2.some((h) => /\?$/.test(h));
  if (w >= 800 && !tables && lists < 2) add("structure", "medium", "Bài dài nhưng gần như chỉ có đoạn văn: thêm bảng so sánh/thông số, danh sách các bước hoặc thẻ thông tin để máy nhận ra cấu trúc.");
  if (h2.length && w / Math.max(1, h2.length) > 450) add("sections", "low", `Trung bình ${Math.round(w / h2.length)} từ mỗi mục H2: chia nhỏ để mỗi mục trả lời một câu hỏi.`);
  const anchors = (main.match(/href=["']#[^"']+["']/gi) || []).length;
  if (w >= 1500 && h2.length >= 5 && anchors < 3) add("toc", "low", "Bài dài, nhiều mục nhưng không có mục lục: thêm mục lục dẫn tới từng H2.");

  // 3. Entity – Attribute – Value: giá trị cụ thể, nguồn trích dẫn
  const values = (text.match(/\b\d+([.,]\d+)?\s?(%|€|\$|usd|eur|mm|cm|m|km|kg|g|ft|in|inch|°c|°f|w|kw|v|gb|tb|mhz|ghz|ms|s|min|h|stunden?|tage?|jahre?|years?|days?|hours?|ngày|giờ|năm)\b/gi) || []).length;
  if (w >= 600 && values / (w / 500) < 1) add("values", "low", "Ít giá trị cụ thể (số đo, thông số, thời gian, chi phí): thêm dữ kiện có nguồn thay cho câu chung chung.");
  const outbound = [...main.matchAll(/<a[^>]+href=["'](https?:\/\/[^"']+)["'][^>]*>/gi)].filter((m) => { try { return url && new URL(m[1]!).hostname.replace(/^www\./, "") !== new URL(url).hostname.replace(/^www\./, "") && !/sponsored|nofollow/i.test(m[0]); } catch { return false; } }).length;
  if (opts.role !== "core" && w >= 800 && values >= 3 && !outbound) add("citations", "medium", "Có số liệu nhưng không dẫn nguồn: thêm trích dẫn nội dòng tới nguồn gốc (nghiên cứu, hãng, cơ quan).");
  const fill = (text.match(FILLER[opts.lang || "en"] || FILLER.en!) || []).length;
  if (fill >= 2) add("filler", "low", `${fill} cụm sáo rỗng: thay bằng câu có thông tin.`);
  if (opts.role === "outer" && h2.length >= 3 && !faq && !h2.some((h) => /^(what|how|why|when|which|was|wie|warum|wann|welche|là gì|như thế nào|tại sao|khi nào)/i.test(h))) add("questions", "low", "Không mục nào trả lời trực tiếp một câu hỏi người dùng hay tìm: đặt vài H2 theo câu hỏi (truy vấn mở rộng).");

  const internal = [...main.matchAll(/<a[^>]+href=["']([^"'#]+)["']/gi)].map((m) => { try { const u = new URL(m[1]!, url); return u.hostname.replace(/^www\./, "") === new URL(url).hostname.replace(/^www\./, "") ? u.pathname : null; } catch { return null; } }).filter((x): x is string => !!x);
  const penalty = checks.reduce((s, c) => s + (c.level === "high" ? 25 : c.level === "medium" ? 12 : 5), 0);
  return { url, title, h1: allH1[0] || "", words: w, score: Math.max(0, 100 - penalty), checks, headings: heads.filter((h) => h.level <= 3).map((h) => h.text).slice(0, 40), links: [...new Set(internal)], outbound, role: opts.role };
}

// Cảnh báo cho bản nháp trong Gác cổng (chỉ "warn", không chặn)
export function draftChecks(title: string, html: string, lang: string): GateProblem[] {
  const r = analyzeHtml(`<article><h1>${title}</h1>${html}</article>`, "", { title, lang, role: "outer" });
  return r.checks.filter((c) => ["lead", "early_sections", "walls", "structure", "hierarchy"].includes(c.code)).map((c) => ({ rule: `semantic_${c.code}`, level: "warn" as const, message: c.message }));
}

// ---------------- Site ----------------

interface SiteRow { id: number; domain: string; site_type: string; language: string; status: string }

const SOURCE_TYPES: [string, RegExp][] = [
  ["forum", /(reddit\.|quora\.|forum|community|gutefrage|stackexchange|stackoverflow|tinhte|voz\.)/i],
  ["video", /(youtube\.|tiktok\.|vimeo\.)/i],
  ["marketplace", /(amazon\.|ebay\.|etsy\.|walmart\.|otto\.de|idealo\.|shopee|lazada|tiki\.vn|alibaba)/i],
  ["education", /(\.edu$|\.ac\.|uni-|university|hochschule|wikipedia\.)/i],
  ["government", /(\.gov$|\.gov\.|bund\.de|europa\.eu)/i],
  ["directory", /(yelp\.|gelbeseiten|11880|trustpilot|clutch\.co|g2\.com|capterra|houzz|yellowpages)/i],
  ["review", /(review|test|vergleich|compare|rtings|wirecutter|chip\.de|techradar|tomsguide|pcmag)/i]
];
export function sourceType(domain: string): string {
  for (const [t, re] of SOURCE_TYPES) if (re.test(domain)) return t;
  return "business";
}
const TYPE_LABEL: Record<string, string> = { forum: "diễn đàn/cộng đồng", video: "video", marketplace: "sàn bán hàng", education: "giáo dục/bách khoa", government: "cơ quan nhà nước", directory: "danh bạ/đánh giá doanh nghiệp", review: "site đánh giá/so sánh", business: "site doanh nghiệp/chuyên gia" };

export async function auditSite(env: Env, siteId: number, actor: string, limit = 60): Promise<{ pages: number; score: number }> {
  const s = await env.DB.prepare("SELECT id, domain, site_type, language, status FROM sites WHERE id = ?").bind(siteId).first<SiteRow>();
  if (!s) throw new HttpError(404, "Không tìm thấy site.", "not_found");
  const c = await env.DB.prepare("SELECT rules FROM recovery_cases WHERE site_id = ? ORDER BY id DESC LIMIT 1").bind(siteId).first<{ rules: string }>();
  const rules = readRules(c?.rules);
  const domain = s.domain.replace(/^www\./, "");
  let urls = await sitemapUrls(domain, 400).catch(() => [] as string[]);
  if (!urls.length) urls = [`https://${domain}/`];
  // Ưu tiên trang có traffic (Search Console), rồi trang chủ, rồi theo sitemap
  const gsc = (await env.DB.prepare("SELECT page FROM mon_pages WHERE site_id = ? ORDER BY clicks_prev + clicks7 DESC LIMIT 40").bind(siteId).all<{ page: string }>()).results.map((r) => r.page);
  const order = [...new Set([`https://${domain}/`, ...gsc.filter((u) => urls.includes(u) || u.includes(domain)), ...urls])].slice(0, limit);
  const pages: SemPage[] = [];
  for (const u of order) {
    const r = await fetchText(u, 600_000, 12000);
    if (!r || r.status >= 400 || !/html/i.test(r.type)) { pages.push({ url: u, title: "", h1: "", role: "outer", words: 0, score: 0, checks: [{ code: "http", level: "high", message: `Không mở được (HTTP ${r?.status || "lỗi"}).` }], headings: [], links: [], outbound: 0, status: r?.status || 0 }); continue; }
    const role = classifyRole(u, r.text, rules.commercialPaths);
    pages.push({ ...analyzeHtml(r.text, u, { lang: s.language, role }), role, status: r.status });
  }
  const ok = pages.filter((p) => p.status && p.status < 400);
  const pathOf = (u: string) => { try { return new URL(u).pathname; } catch { return u; } };
  const core = ok.filter((p) => p.role === "core"), outer = ok.filter((p) => p.role === "outer");
  const corePaths = new Set(core.map((p) => pathOf(p.url)));
  const inbound = new Map<string, number>();
  for (const p of ok) for (const l of p.links) if (l !== pathOf(p.url)) inbound.set(l, (inbound.get(l) || 0) + 1);
  // Outer phải dẫn về Core; Core nên nhận link từ Outer
  for (const p of outer) {
    if (!p.links.some((l) => corePaths.has(l) && l !== "/")) p.checks.push({ code: "outer_to_core", level: "high", message: "Bài kiến thức (Outer) chưa link về trang kiếm tiền (Core) nào cùng chủ đề: thêm một link ngữ cảnh để truyền tín hiệu liên quan." });
  }
  const fromOuter = (path: string) => outer.filter((p) => p.links.includes(path)).length;
  for (const p of core) if (pathOf(p.url) !== "/" && fromOuter(pathOf(p.url)) === 0) p.checks.push({ code: "core_support", level: "medium", message: "Trang kiếm tiền chưa có bài kiến thức nào link tới: viết hoặc nối các bài Outer cùng chủ đề về trang này." });
  for (const p of ok) if (pathOf(p.url) !== "/" && !inbound.get(pathOf(p.url))) p.checks.push({ code: "orphan", level: "medium", message: "Trang mồ côi: không trang nào (trong số đã quét) link tới." });
  for (const p of ok) { const pen = p.checks.reduce((a, c) => a + (c.level === "high" ? 25 : c.level === "medium" ? 12 : 5), 0); p.score = Math.max(0, 100 - pen); }

  // Query fan-out từ Search Console: truy vấn có hiển thị nhưng trang chưa có heading trả lời; truy vấn không trang nào khớp → trang riêng
  const qs = (await env.DB.prepare("SELECT query, page, impr7, pos7 FROM mon_queries WHERE site_id = ? AND impr7 >= 10 ORDER BY impr7 DESC LIMIT 300").bind(siteId).all<{ query: string; page: string; impr7: number; pos7: number }>()).results;
  const byUrl = new Map(ok.map((p) => [p.url.replace(/\/$/, ""), p]));
  const fanout: { query: string; page: string; impr: number; pos: number; action: "heading" | "paragraph" | "page" }[] = [];
  for (const q of qs) {
    const p = byUrl.get(q.page.replace(/\/$/, ""));
    if (!p) continue;
    const qt = toks(q.query);
    if (!qt.length) continue;
    const inHead = p.headings.some((h) => qt.every((t) => has(h, t)));
    if (inHead) continue;
    const topicHits = qt.filter((t) => has(`${p.h1} ${p.title}`, t)).length / qt.length;
    // Truy vấn lệch hẳn chủ đề trang và có nhiều hiển thị → nên có trang riêng; gần chủ đề → heading; chi tiết nhỏ → một đoạn
    const action = topicHits < 0.34 && q.impr7 >= 50 ? "page" : qt.length >= 3 || q.impr7 >= 30 ? "heading" : "paragraph";
    fanout.push({ query: q.query, page: q.page, impr: q.impr7, pos: q.pos7, action });
  }
  // Source Context: loại site đang đứng top các từ khoá theo dõi
  const tops = (await env.DB.prepare("SELECT keyword, features FROM mon_keywords WHERE site_id = ? AND active = 1 AND features IS NOT NULL").bind(siteId).all<{ keyword: string; features: string }>()).results;
  const typeCount: Record<string, number> = {};
  const perKw: { keyword: string; types: string[] }[] = [];
  for (const k of tops) {
    let top: string[] = [];
    try { top = (JSON.parse(k.features) as { top?: string[] }).top || []; } catch { /* bỏ qua */ }
    const types = top.map(sourceType);
    types.forEach((t) => (typeCount[t] = (typeCount[t] || 0) + 1));
    perKw.push({ keyword: k.keyword, types });
  }
  const total = Object.values(typeCount).reduce((a, b) => a + b, 0);
  const mine = s.site_type === "affiliate" ? "review" : "business";
  const dominant = Object.entries(typeCount).sort((a, b) => b[1] - a[1])[0];
  const mismatch = perKw.filter((k) => k.types.length >= 2 && !k.types.includes(mine) && !(mine === "business" && k.types.includes("directory"))).map((k) => k.keyword);
  const sourceContext = total ? {
    mine, mineLabel: TYPE_LABEL[mine], types: Object.entries(typeCount).map(([t, n]) => ({ type: t, label: TYPE_LABEL[t], share: Math.round((n / total) * 100) })).sort((a, b) => b.share - a.share),
    mismatch: mismatch.slice(0, 15),
    note: dominant && dominant[0] !== mine ? `Top các từ khoá theo dõi chủ yếu là ${TYPE_LABEL[dominant[0]]}. Với từ khoá lệch, cân nhắc góc nội dung khác (dữ liệu riêng, kinh nghiệm thật) hoặc chọn từ khoá Google đang cho loại site như của anh lên top.` : ""
  } : null;

  // Web Entity: sameAs, mạng xã hội còn hoạt động, citations
  const acc = (await env.DB.prepare("SELECT network, status, profile_url FROM social_accounts WHERE site_id = ?").bind(siteId).all<{ network: string; status: string; profile_url: string | null }>()).results;
  const posts = (await env.DB.prepare("SELECT network, COUNT(*) AS n FROM social_posts WHERE site_id = ? AND status = 'posted' AND posted_at > ? GROUP BY network").bind(siteId, now() - 30 * DAY).all<{ network: string; n: number }>()).results;
  const cit = await env.DB.prepare("SELECT COUNT(*) AS total, SUM(CASE WHEN status IN ('live', 'submitted') THEN 1 ELSE 0 END) AS done FROM op_citations WHERE site_id = ?").bind(siteId).first<{ total: number; done: number | null }>();
  const home = ok.find((p) => pathOf(p.url) === "/");
  const homeHtml = home ? (await fetchText(home.url, 600_000, 12000))?.text || "" : "";
  const hasOrg = /"@type"\s*:\s*"(Organization|LocalBusiness|[A-Za-z]*Business)"/.test(homeHtml);
  const sameAs = (homeHtml.match(/"sameAs"\s*:\s*\[([^\]]*)\]/)?.[1]?.match(/https?:\/\/[^"\s]+/g) || []);
  const entity = {
    organization: hasOrg, sameAs,
    profiles: acc.map((a) => ({ network: a.network, status: a.status, url: a.profile_url, posts30: posts.find((p) => p.network === a.network)?.n || 0, inSameAs: !!a.profile_url && sameAs.some((x) => x.replace(/\/$/, "") === a.profile_url!.replace(/\/$/, "")) })),
    citations: { total: cit?.total || 0, done: cit?.done || 0 },
    tasks: [
      ...(!hasOrg ? ["Trang chủ chưa có schema Organization: thêm (tên, logo, url, sameAs) để Google gom các kênh về một thực thể."] : []),
      ...acc.filter((a) => a.profile_url && !sameAs.some((x) => x.replace(/\/$/, "") === a.profile_url!.replace(/\/$/, ""))).map((a) => `Thêm ${a.profile_url} vào sameAs của Organization.`),
      ...acc.filter((a) => a.status === "active" && !posts.find((p) => p.network === a.network)).map((a) => `${a.network}: 30 ngày chưa đăng gì; kênh im lặng không giúp thực thể.`),
      ...(!acc.length ? ["Chưa kết nối mạng xã hội nào cho site này (Off-page › Mạng xã hội)."] : [])
    ]
  };

  const score = ok.length ? Math.round(ok.reduce((a, p) => a + p.score, 0) / ok.length) : 0;
  const coverage = { core: core.length, outer: outer.length, ratio: core.length ? +(outer.length / core.length).toFixed(1) : null, outerLinked: outer.filter((p) => !p.checks.some((c) => c.code === "outer_to_core")).length };
  const t = now();
  await env.DB.batch([
    env.DB.prepare("DELETE FROM sem_pages WHERE site_id = ?").bind(siteId),
    ...pages.map((p) => env.DB.prepare("INSERT INTO sem_pages (site_id, url, role, title, h1, words, score, checks, headings, links, status, checked_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .bind(siteId, p.url, p.role, p.title.slice(0, 200), p.h1.slice(0, 200), p.words, p.score, JSON.stringify(p.checks), JSON.stringify(p.headings), JSON.stringify(p.links.slice(0, 200)), p.status, t)),
    env.DB.prepare("INSERT INTO sem_audits (site_id, score, data, created_at) VALUES (?, ?, ?, ?)").bind(siteId, score, JSON.stringify({ coverage, fanout: fanout.slice(0, 60), sourceContext, entity, pages: pages.length }), t)
  ]);
  await logActivity(env, actor, "semantic.audit", `${s.domain}: điểm ${score}/100, ${core.length} Core, ${outer.length} Outer, ${fanout.length} truy vấn chưa có chỗ trả lời`, siteId);
  return { pages: pages.length, score };
}

// Cron: mỗi site 7 ngày quét một lần, mỗi lượt tối đa 1 site (tải trang tốn thời gian)
export async function runSemantic(env: Env, deadline: number): Promise<void> {
  const st = await getSettingsMap(env);
  if (st.paused || Date.now() > deadline - 60000) return;
  const s = await env.DB.prepare("SELECT s.id FROM sites s LEFT JOIN (SELECT site_id, MAX(created_at) AS t FROM sem_audits GROUP BY site_id) a ON a.site_id = s.id WHERE s.status = 'active' AND (a.t IS NULL OR a.t < ?) ORDER BY COALESCE(a.t, 0) LIMIT 1").bind(now() - 7 * DAY).first<{ id: number }>();
  if (!s) return;
  await auditSite(env, s.id, "agent:semantic", 40).catch((e) => logActivity(env, "agent:semantic", "semantic.error", (e as Error).message.slice(0, 200), s.id));
}

// ---------------- API ----------------

const canEdit = (u: User) => { if (u.role === "viewer") throw new HttpError(403, "Tài khoản chỉ xem.", "forbidden"); };

export async function apiSemanticList(env: Env): Promise<Response> {
  const r = await env.DB.prepare("SELECT s.id, s.name, s.domain, s.site_type, a.score, a.data, a.created_at FROM sites s LEFT JOIN sem_audits a ON a.id = (SELECT id FROM sem_audits WHERE site_id = s.id ORDER BY id DESC LIMIT 1) WHERE s.status != 'archived' ORDER BY s.id").all<{ id: number; name: string; domain: string; site_type: string; score: number | null; data: string | null; created_at: number | null }>();
  return json({ sites: r.results.map((x) => { const d = x.data ? JSON.parse(x.data) : null; return { id: x.id, name: x.name, domain: x.domain, siteType: x.site_type, score: x.score, at: x.created_at, coverage: d?.coverage || null, fanout: d?.fanout?.length ?? null }; }) });
}

export async function apiSemanticView(env: Env, siteId: number): Promise<Response> {
  const site = await env.DB.prepare("SELECT id, name, domain, site_type FROM sites WHERE id = ?").bind(siteId).first();
  if (!site) throw new HttpError(404, "Không tìm thấy site.", "not_found");
  const a = await env.DB.prepare("SELECT score, data, created_at FROM sem_audits WHERE site_id = ? ORDER BY id DESC LIMIT 1").bind(siteId).first<{ score: number; data: string; created_at: number }>();
  const hist = (await env.DB.prepare("SELECT score, created_at FROM sem_audits WHERE site_id = ? ORDER BY id DESC LIMIT 12").bind(siteId).all()).results.reverse();
  const pages = (await env.DB.prepare("SELECT url, role, title, h1, words, score, checks, status FROM sem_pages WHERE site_id = ? ORDER BY score, url").bind(siteId).all<{ checks: string }>()).results.map((p) => ({ ...p, checks: JSON.parse(p.checks || "[]") }));
  return json({ site, audit: a ? { score: a.score, at: a.created_at, ...JSON.parse(a.data) } : null, history: hist, pages });
}

export async function apiSemanticRun(env: Env, user: User, siteId: number): Promise<Response> {
  canEdit(user);
  return json(await auditSite(env, siteId, `user:${user.id}`, 40));
}
