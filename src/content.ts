// Đội Nội dung: rà cấu trúc bài viết, nghiên cứu từ khoá, lập dàn ý, viết bài nháp và tạo bản nháp WordPress.
// Chống spam: chỉ viết chủ đề site chưa có, gắn với một trang dịch vụ, giới hạn số bài mỗi tháng, không bao giờ tự đăng.

import { HttpError, json, now, readJson } from "./http";
import { logActivity } from "./activity";
import { aiJson, writingRules } from "./ai";
import { keywordIdeas, serpInfo } from "./dataforseo";
import { blockHitsIn, extractNumbers, langRatios, MARKER_RE, standardNumbers, wordCount, type PageData } from "./recovery-extract";
import { toks } from "./recovery-analyze";
import type { GateProblem, GateResult } from "./recovery-gate";
import { readRules, type SiteRules } from "./recovery-rules";
import { wpCall } from "./wordpress";
import { mediaReady, mediaSite, storeImage } from "./media";
import { profileFor, profileNumbers, readProfile, type Profile } from "./docs";
import { clean as decodeText } from "./recovery-extract";
import { checkStructure, checkVoice, clichesFor, markdownToHtml } from "./style";
import { imageSize, MAX_IMAGE_BYTES, sniffImage, stripJpegMeta } from "./images";
import { checkFormat, detectFormat, FORMATS, formatOf, formatSpec, parseProducts, productNumbers, readImages, readProducts, renderDraft, slotsFor, type FormatId, type Slot, type UploadedImage } from "./formats";
import type { Env, User } from "./types";

interface CaseInfo { id: number; site_id: number; rules: string; domain: string; market: string; language: string; site_type: string }
interface Pg { path: string; url: string; kind: string | null; d: PageData | null; traffic: { clicks?: number } | null }

const canEdit = (u: User) => { if (u.role === "viewer") throw new HttpError(403, "Tài khoản chỉ xem.", "forbidden"); };

async function caseInfo(env: Env, caseId: number): Promise<CaseInfo> {
  const c = await env.DB.prepare("SELECT c.id, c.site_id, c.rules, s.domain, s.market, s.language, s.site_type FROM recovery_cases c JOIN sites s ON s.id = c.site_id WHERE c.id = ?").bind(caseId).first<CaseInfo>();
  if (!c) throw new HttpError(404, "Không tìm thấy ca.", "not_found");
  return c;
}

// Blocklist của site + điều cấm rút từ tài liệu (chỉ cụm ngắn)
const blockOf = (rules: SiteRules, p: Profile): string[] => [...rules.blocklist, ...p.banned.filter((x) => x.length <= 40)];

async function pagesOf(env: Env, caseId: number): Promise<Pg[]> {
  const { results } = await env.DB.prepare("SELECT path, url, kind, data, traffic FROM recovery_pages WHERE case_id = ? AND status = 'done'").bind(caseId).all<{ path: string; url: string; kind: string | null; data: string | null; traffic: string | null }>();
  return results.map((r) => ({ path: r.path, url: r.url, kind: r.kind, d: r.data ? JSON.parse(r.data) : null, traffic: r.traffic ? JSON.parse(r.traffic) : null }));
}

const brandless = (s: string) => (s.split(/\s[|–—]\s/)[0] || s).trim();
const jac = (a: string[], b: string[]) => { const A = new Set(a), B = new Set(b); const i = [...A].filter((x) => B.has(x)).length; return i / (new Set([...A, ...B]).size || 1); };
const ovl = (a: string[], b: string[]) => { const B = new Set(b); return [...new Set(a)].filter((w) => B.has(w) || [...B].some((x) => x.length > 5 && w.length > 5 && x.slice(0, 6) === w.slice(0, 6))).length; };

// ---------------- Cấu trúc bài viết: trang dịch vụ (hub) và bài hỗ trợ ----------------

export function structure(pages: Pg[]) {
  const hubs = pages.filter((p) => p.kind === "commercial" && p.d);
  const info = pages.filter((p) => p.kind === "informational" && p.d);
  const hubToks = new Map(hubs.map((h) => [h.path, toks(`${h.d!.h1[0] || ""} ${h.d!.title} ${h.path.replace(/[-/]/g, " ")}`)]));
  const rows = hubs.map((h) => ({ path: h.path, title: brandless(h.d!.h1[0] || h.d!.title), linking: [] as string[], related: [] as string[], clicks: h.traffic?.clicks ?? null }));
  const unassigned: string[] = [];
  for (const p of info) {
    const linksTo = p.d!.internalLinks;
    let best: { path: string; s: number } | null = null;
    for (const h of hubs) {
      const s = ovl(toks(`${p.d!.title} ${p.d!.h2.join(" ")} ${p.path.replace(/[-/]/g, " ")}`), hubToks.get(h.path)!);
      if (s > 0 && (!best || s > best.s)) best = { path: h.path, s };
    }
    const linked = hubs.find((h) => linksTo.includes(h.path));
    const row = rows.find((r) => r.path === (linked?.path || best?.path));
    if (!row) { unassigned.push(p.path); continue; }
    (linked ? row.linking : row.related).push(p.path);
  }
  const gaps = rows.filter((r) => r.linking.length < 3).map((r) => ({ path: r.path, title: r.title, linking: r.linking.length, related: r.related.length }));
  return { hubs: rows, unassigned, gaps, counts: { hubs: hubs.length, info: info.length } };
}

// ---------------- Nghiên cứu từ khoá ----------------

export async function researchCore(env: Env, caseId: number, actor: string): Promise<{ added: number; covered: number; considered: number }> {
  const c = await caseInfo(env, caseId);
  const rules = readRules(c.rules);
  const pages = await pagesOf(env, caseId);
  const hubs = pages.filter((p) => p.kind === "commercial" && p.d);
  const seeds = rules.seedKeywords.length ? rules.seedKeywords : hubs.map((h) => brandless(h.d!.h1[0] || h.d!.title)).filter((s) => s.split(/\s+/).length <= 5).slice(0, 8);
  if (!seeds.length) throw new HttpError(400, "Chưa có từ khoá gốc: nhập ở Luật an toàn › Từ khoá gốc, hoặc khai báo trang dịch vụ.", "no_seeds");
  const lang = rules.language || c.language || "en";
  const ideas = await keywordIdeas(env, c.site_id, seeds, c.market || "US", lang);
  const existing = pages.filter((p) => p.d && p.kind !== "system").map((p) => ({ path: p.path, t: toks(`${p.d!.h1[0] || ""} ${p.d!.title} ${p.path.replace(/[-/]/g, " ")}`) }));
  const hubToks = hubs.map((h) => ({ path: h.path, t: toks(`${h.d!.h1[0] || ""} ${h.d!.title} ${h.path.replace(/[-/]/g, " ")}`) }));
  const block = rules.blocklist.map((b) => b.toLowerCase());
  const t = now();
  let added = 0, covered = 0;
  const stmts = [];
  for (const k of ideas) {
    if (block.some((b) => b && k.keyword.includes(b))) continue;
    if (k.intent === "navigational") continue;
    if (k.volume < rules.minVolume) continue;
    const kt = toks(k.keyword);
    if (!kt.length) continue;
    const cov = existing.map((e) => ({ path: e.path, s: jac(kt, e.t) + (ovl(kt, e.t) === kt.length ? 0.3 : 0) })).sort((a, b) => b.s - a.s)[0];
    const coveredBy = cov && cov.s >= 0.6 ? cov.path : null;
    const hub = hubToks.map((h) => ({ path: h.path, s: ovl(kt, h.t) })).sort((a, b) => b.s - a.s)[0];
    const hubPath = hub && hub.s > 0 ? hub.path : null;
    const intentW = k.intent === "commercial" || k.intent === "transactional" ? 1.5 : 1;
    const score = coveredBy ? 0 : +((k.volume / ((k.kd ?? 30) + 10)) * intentW * (hubPath || c.site_type === "affiliate" ? 1 : 0.3)).toFixed(2);
    if (coveredBy) covered++;
    stmts.push(env.DB.prepare("INSERT INTO content_ideas (site_id, case_id, keyword, volume, kd, intent, cpc, cluster, hub_path, covered_by, score, format, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(site_id, keyword) DO UPDATE SET volume = excluded.volume, kd = excluded.kd, intent = excluded.intent, covered_by = excluded.covered_by, hub_path = excluded.hub_path, score = CASE WHEN content_ideas.status = 'idea' THEN excluded.score ELSE content_ideas.score END, updated_at = excluded.updated_at")
      .bind(c.site_id, caseId, k.keyword, k.volume, k.kd, k.intent, k.cpc, kt.slice(0, 2).join(" "), hubPath, coveredBy, score, detectFormat(k.keyword), t, t));
    added++;
  }
  for (let i = 0; i < stmts.length; i += 50) await env.DB.batch(stmts.slice(i, i + 50));
  await setAuto(env, c.site_id, { lastResearch: t });
  await logActivity(env, actor, "content.research", `Nghiên cứu từ khoá ${c.domain}: ${ideas.length} gợi ý, ${added} giữ lại, ${covered} đã có trang`, c.site_id);
  return { added, covered, considered: ideas.length };
}

// ---------------- Duyệt ý tưởng (giới hạn bài/tháng) ----------------

async function monthCount(env: Env, siteId: number): Promise<number> {
  const d = new Date();
  const since = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1);
  const r = await env.DB.prepare("SELECT COUNT(*) AS n FROM content_ideas WHERE site_id = ? AND status IN ('approved', 'briefed', 'drafted', 'published') AND updated_at >= ?").bind(siteId, since).first<{ n: number }>();
  return r?.n ?? 0;
}

export async function approveIdeaCore(env: Env, ideaId: number, actor: string): Promise<void> {
  const i = await idea(env, ideaId);
  const c = await caseInfo(env, i.case_id!);
  const rules = readRules(c.rules);
  if (i.covered_by) throw new HttpError(409, `Site đã có trang ${i.covered_by} cho chủ đề này: viết thêm sẽ ăn thịt từ khoá. Hãy cải thiện trang đó.`, "covered");
  if ((await monthCount(env, c.site_id)) >= rules.maxNewArticlesPerMonth) throw new HttpError(409, `Đã đủ ${rules.maxNewArticlesPerMonth} bài mới tháng này (giới hạn chống spam, chỉnh ở Luật an toàn).`, "limit");
  await env.DB.prepare("UPDATE content_ideas SET status = 'approved', updated_at = ? WHERE id = ?").bind(now(), ideaId).run();
  await logActivity(env, actor, "content.approved", `Duyệt chủ đề bài mới: "${i.keyword}"`, c.site_id);
}

interface IdeaRow { id: number; site_id: number; case_id: number | null; keyword: string; volume: number | null; intent: string | null; hub_path: string | null; covered_by: string | null; status: string; brief: string | null; draft: string | null; gate: string | null; wp_post_id: number | null; format: FormatId; products: string | null; images: string | null; interview: string | null; author: string | null }
async function idea(env: Env, id: number): Promise<IdeaRow> {
  const r = await env.DB.prepare("SELECT * FROM content_ideas WHERE id = ?").bind(id).first<IdeaRow>();
  if (!r) throw new HttpError(404, "Không tìm thấy ý tưởng.", "not_found");
  return r;
}

// ---------------- Dàn ý ----------------

export async function briefCore(env: Env, ideaId: number, actor: string): Promise<void> {
  const i = await idea(env, ideaId);
  if (i.status !== "approved" && i.status !== "briefed") throw new HttpError(409, "Chỉ lập dàn ý cho chủ đề đã duyệt.", "not_approved");
  const c = await caseInfo(env, i.case_id!);
  const rules = readRules(c.rules);
  const lang = rules.language || c.language;
  const f = formatOf(i.format);
  const products = readProducts(i.products);
  if (products.items.length < f.minProducts) throw new HttpError(409, `Định dạng ${f.label} cần anh nhập ít nhất ${f.minProducts} sản phẩm (tên, link affiliate, đã dùng thật hay chưa) trước khi lập dàn ý.`, "need_products");
  const pages = await pagesOf(env, c.id);
  const hub = pages.find((p) => p.path === i.hub_path);
  const serp = await serpInfo(env, c.site_id, i.keyword, c.market || "US", lang);
  const profile = await readProfile(env, c.site_id);
  const b = await aiJson<Record<string, unknown>>(env, {
    template: "content_brief", task: "content.brief", siteId: c.site_id, format: formatSpec(f.id),
    rules: writingRules(lang, [...rules.verifiedNumbers, ...productNumbers(products), ...profileNumbers(profile)], blockOf(rules, profile)),
    input: {
      site_profile: profileFor(profile, i.keyword),
      format: f.id, site_type: c.site_type, keyword: i.keyword, monthly_searches: i.volume, intent: i.intent,
      products: products.items.map((p, n) => ({ n: n + 1, name: p.name, best_for: p.bestFor, tested: p.tested })), method: products.method,
      service_page: hub ? { path: hub.path, title: brandless(hub.d?.h1[0] || hub.d?.title || hub.path) } : null,
      top_results: serp.top.map((x) => ({ title: x.title, snippet: x.description })),
      people_also_ask: serp.paa,
      existing_pages_on_site: pages.filter((p) => p.d && p.kind !== "system").slice(0, 80).map((p) => ({ path: p.path, title: p.d!.title })),
      notes_from_owner: rules.notes.slice(0, 800)
    }
  });
  const slug = String(b.slug || i.keyword).toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/ä/g, "ae").replace(/ö/g, "oe").replace(/ü/g, "ue").replace(/ß/g, "ss").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 70);
  if (pages.some((p) => p.path.replace(/\//g, "") === slug)) throw new HttpError(409, `Slug "${slug}" trùng với trang có sẵn.`, "duplicate");
  const photo_requests = (Array.isArray(b.photo_requests) ? b.photo_requests : []).map((x: { key?: unknown; what?: unknown }) => ({ key: String(x?.key || "").toLowerCase(), what: String(x?.what || "").slice(0, 160) })).filter((x: { key: string; what: string }) => /^[sg]\d{1,2}$/.test(x.key) && x.what).slice(0, 6);
  const brief = { ...b, photo_requests, slug, serp, keyword: i.keyword, hub: i.hub_path, format: f.id };
  const questions = (Array.isArray(b.interview) ? b.interview : []).map((q: unknown) => String(q || "").trim().slice(0, 300)).filter(Boolean).slice(0, 5);
  const prevIv = readInterview(i.interview);
  const interview: Interview = prevIv && answered(prevIv).length ? prevIv : { questions, answers: [], skipped: false };
  await env.DB.prepare("UPDATE content_ideas SET brief = ?, interview = ?, status = 'briefed', updated_at = ? WHERE id = ?").bind(JSON.stringify(brief), JSON.stringify(interview), now(), ideaId).run();
  await logActivity(env, actor, "content.brief", `Lập dàn ý: "${String(b.title || i.keyword)}"`, c.site_id);
}

// ---------------- Bài nháp ----------------

const ALLOWED = new Set(["h2", "h3", "p", "ul", "ol", "li", "strong", "em", "a", "table", "thead", "tbody", "tr", "th", "td", "br"]);
// allowExternal: danh sách link nguồn được phép (dữ liệu tra Google), hoặc "all" cho bài anh tự viết
export function cleanHtml(html: string, allowExternal: string[] | "all" = []): string {
  const norm = (u: string) => u.replace(/#.*$/, "").replace(/\/$/, "");
  const okExt = (href: string) => /^https?:\/\//i.test(href) && (allowExternal === "all" || allowExternal.some((x) => norm(x) === norm(href)));
  return html
    .replace(/<(script|style|iframe|object|embed)\b[\s\S]*?<\/\1>/gi, "")
    .replace(/<\/?([a-z0-9]+)\b([^>]*)>/gi, (m, tag: string, attrs: string) => {
      const t = tag.toLowerCase();
      if (!ALLOWED.has(t)) return "";
      if (m.startsWith("</")) return `</${t}>`;
      // Chỉ giữ link nội bộ: model không được tự viết URL ngoài (link affiliate do hệ thống chèn)
      if (t === "a") {
        const href = ((attrs.match(/href\s*=\s*"([^"]*)"/i) || attrs.match(/href\s*=\s*'([^']*)'/i) || [])[1] || "").replace(/&amp;/g, "&");
        if (/^\/(?!\/)/.test(href)) return `<a href="${href.replace(/"/g, "")}">`;
        if (okExt(href) && !/^javascript:/i.test(href)) return `<a href="${href.replace(/"/g, "%22")}" rel="noopener" target="_blank">`;
        return "<a>";
      }
      return `<${t}>`;
    })
    .replace(/<a>([\s\S]*?)<\/a>/g, "$1")
    .trim();
}

export function checkArticle(html: string, rules: SiteRules, hubPath: string | null, opts: { minWords?: number; extraNumbers?: string[]; extra?: GateProblem[]; numbersLevel?: "block" | "warn" } = {}): GateResult {
  const problems: GateProblem[] = [];
  const text = html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
  const hits = blockHitsIn(text, [], rules);
  if (hits.length) problems.push({ rule: "blocklist", level: "block", message: `Bài chứa từ bị cấm: ${hits.join(", ")}.` });
  const marks = text.match(MARKER_RE);
  if (marks) problems.push({ rule: "markers", level: "block", message: `Còn dấu biên tập: ${[...new Set(marks)].join(", ")}.` });
  const r = langRatios(text);
  if (rules.language === "de" && r.en > r.de) problems.push({ rule: "language", level: "block", message: "Bài có vẻ là tiếng Anh, site chỉ viết tiếng Đức." });
  if (rules.language === "en" && r.de > r.en) problems.push({ rule: "language", level: "block", message: "Bài có vẻ là tiếng Đức, site viết tiếng Anh." });
  const allowed = new Set([...rules.verifiedNumbers.flatMap(extractNumbers), ...standardNumbers(text), ...(opts.extraNumbers || [])]);
  const risky = extractNumbers(text).filter((n) => !allowed.has(n) && (/[%€$]|eur|usd/.test(n) || Number(n.replace(/[^\d]/g, "")) >= 10));
  if (risky.length) problems.push({ rule: "numbers", level: opts.numbersLevel || "block", message: `Có số liệu chưa có nguồn: ${risky.slice(0, 8).join(", ")}. ${opts.numbersLevel === "warn" ? "Anh tự viết: kiểm lại nguồn trước khi đăng." : "Xoá hoặc ghi nguồn đã kiểm chứng."}` });
  const words = wordCount(text);
  const minWords = opts.minWords ?? 600;
  if (words < minWords) problems.push({ rule: "length", level: "block", message: `Bài quá ngắn (${words} từ, cần ${minWords}): dễ thành nội dung mỏng.` });
  problems.push(...(opts.extra || []));
  if (hubPath && !html.includes(`href="${hubPath}"`)) problems.push({ rule: "hub_link", level: "warn", message: `Bài chưa có link tới trang dịch vụ ${hubPath}.` });
  problems.push({ rule: "expertise", level: "warn", message: "Trước khi đăng: chủ site thêm kinh nghiệm thật, chọn tác giả thật trong WordPress; không dùng ảnh AI giả làm ảnh thật." });
  return { ok: !problems.some((p) => p.level === "block"), checkedAt: now(), problems };
}

interface Review { score: number; criteria: { name: string; score: number; note: string }[]; issues: { where: string; problem: string; fix: string }[]; verdict: string; rounds: number[]; at: number }
interface Draft { title: string; slug: string; raw: string; html: string; meta_description: string; words: number; review?: Review | null; reviewError?: string; author?: "agent" | "owner" }

const TOKEN_RE = /\[\[(?:DISCLOSURE|BUY:\d+|IMG:[a-z0-9]+)\]\]/g;
const tokensOf = (h: string) => new Set(h.match(TOKEN_RE) || []);

interface Ctx { i: IdeaRow; c: CaseInfo; rules: SiteRules; lang: string; profile: Profile; products: ReturnType<typeof readProducts>; brief: Record<string, unknown> & { serp?: { paa?: string[] }; outline?: unknown; title?: unknown } }
async function ctxOf(env: Env, i: IdeaRow): Promise<Ctx> {
  const c = await caseInfo(env, i.case_id!);
  const rules = readRules(c.rules);
  return { i, c, rules, lang: rules.language || c.language, profile: await readProfile(env, c.site_id), products: readProducts(i.products), brief: i.brief ? JSON.parse(i.brief) : {} };
}
interface Interview { questions: string[]; answers: string[]; skipped: boolean }
const readInterview = (s: string | null): Interview | null => { try { const v = s ? JSON.parse(s) as Interview : null; return v && Array.isArray(v.questions) ? { questions: v.questions, answers: Array.isArray(v.answers) ? v.answers : [], skipped: !!v.skipped } : null; } catch { return null; } };
const answered = (iv: Interview | null) => (iv ? iv.questions.map((q, n) => ({ q, a: String(iv.answers[n] || "").trim() })).filter((x) => x.a) : []);
// Agent còn chờ anh trả lời phỏng vấn?
export const waitingInterview = (iv: Interview | null, required: boolean) => required && !!iv && iv.questions.length > 0 && !iv.skipped && answered(iv).length === 0;
const interviewNumbers = (iv: Interview | null) => answered(iv).flatMap((x) => extractNumbers(x.a));
interface WebFact { text: string; source_url: string; source_title: string }
const webFactsOf = (brief: unknown): WebFact[] => { const w = (brief as { web_facts?: WebFact[] } | null)?.web_facts; return Array.isArray(w) ? w : []; };
const webNumbers = (brief: unknown) => webFactsOf(brief).flatMap((f) => extractNumbers(f.text));
const webSources = (brief: unknown) => [...new Set(webFactsOf(brief).map((f) => f.source_url))];

// Không có trải nghiệm của anh: tra top Google, rút dữ kiện có nguồn (agent Nghiên cứu)
export async function webFactsCore(env: Env, ideaId: number, actor: string): Promise<number> {
  const i = await idea(env, ideaId);
  if (!i.brief) throw new HttpError(409, "Cần lập dàn ý trước.", "no_brief");
  const c = await caseInfo(env, i.case_id!);
  const rules = readRules(c.rules);
  const brief = JSON.parse(i.brief) as Record<string, unknown> & { serp?: { top?: { title: string; url: string }[] }; outline?: { h2?: string }[] };
  let top = brief.serp?.top || [];
  if (!top.length) top = (await serpInfo(env, c.site_id, i.keyword, c.market || "US", rules.language || c.language)).top;
  const own = c.domain.replace(/^www\./, "");
  const skip = [own, ...rules.relatedDomains, ...rules.blocklist].map((d) => d.toLowerCase()).filter(Boolean);
  const pages: { url: string; title: string; text: string }[] = [];
  for (const t of top) {
    if (pages.length >= 5) break;
    let host = "";
    try { host = new URL(t.url).hostname.replace(/^www\./, "").toLowerCase(); } catch { continue; }
    if (skip.some((d) => host === d || host.endsWith(`.${d}`) || t.url.toLowerCase().includes(d))) continue;
    const res = await fetch(t.url, { headers: { "User-Agent": "Mozilla/5.0 (compatible; DuyOi/1.0)" }, signal: AbortSignal.timeout(12000) }).catch(() => null);
    if (!res?.ok || !/html/i.test(res.headers.get("content-type") || "html")) continue;
    const html = (await res.text()).slice(0, 600000);
    const main = (html.match(/<article[\s\S]*?<\/article>/i) || html.match(/<main[\s\S]*?<\/main>/i) || [html])[0].replace(/<(script|style|nav|header|footer|aside|form)[\s\S]*?<\/\1>/gi, " ");
    const text = decodeText(main).split(" ").slice(0, 1500).join(" ");
    if (text.split(" ").length >= 120) pages.push({ url: t.url, title: t.title, text });
  }
  if (!pages.length) throw new HttpError(502, "Không đọc được trang nào trong top Google cho từ khoá này.", "no_sources");
  const r = await aiJson<{ facts?: unknown[] }>(env, {
    template: "web_facts", task: "content.web_facts", siteId: c.site_id,
    rules: `${writingRules(rules.language || c.language, [], rules.blocklist).replace(/Do NOT write any number[^\n]*/, "Copy numbers exactly as the source states them; never add numbers.")}`,
    input: { keyword: i.keyword, outline: (brief.outline || []).map((o) => o.h2), sources: pages }
  });
  const urls = new Set(pages.map((p) => p.url));
  const facts: WebFact[] = (Array.isArray(r.facts) ? r.facts : []).slice(0, 15).map((f) => { const x = (f || {}) as Record<string, unknown>; return { text: String(x.text || "").trim().slice(0, 400), source_url: String(x.source_url || ""), source_title: String(x.source_title || "").slice(0, 160) }; })
    .filter((f) => f.text && urls.has(f.source_url)).map((f) => ({ ...f, source_title: f.source_title || pages.find((p) => p.url === f.source_url)!.title }));
  await env.DB.prepare("UPDATE content_ideas SET brief = ?, updated_at = ? WHERE id = ?").bind(JSON.stringify({ ...brief, web_facts: facts, web_facts_at: now() }), now(), ideaId).run();
  await logActivity(env, actor, "content.web_facts", `Tra Google cho "${i.keyword}": ${facts.length} dữ kiện có nguồn từ ${pages.length} trang`, c.site_id);
  return facts.length;
}

const writerInput = (x: Ctx) => ({
  format: x.i.format, keyword: x.i.keyword,
  outline: { title: x.brief.title, sections: x.brief.outline },
  products: x.products.items.map((p, n) => ({ n: n + 1, name: p.name, best_for: p.bestFor, tested: p.tested, owner_notes: p.notes, specs: p.specs, pros: p.pros, cons: p.cons })),
  voice: profileFor(x.profile, x.i.keyword).voice, owner_interview: answered(readInterview(x.i.interview)), web_facts: webFactsOf(x.brief),
  site_profile: profileFor(x.profile, x.i.keyword), paa: x.brief.serp?.paa || []
});
const rulesFor = (x: Ctx) => `${writingRules(x.lang, [...x.rules.verifiedNumbers, ...productNumbers(x.products), ...profileNumbers(x.profile), ...interviewNumbers(readInterview(x.i.interview)), ...webNumbers(x.brief)], blockOf(x.rules, x.profile))}\nNever use these stock phrases: ${clichesFor(x.lang).join(" | ")}.`;

// Biên tập viên chấm (model khác người viết)
async function reviewOnce(env: Env, x: Ctx, raw: string): Promise<Omit<Review, "rounds" | "at">> {
  const r = await aiJson<{ score?: unknown; criteria?: unknown; issues?: unknown; verdict?: unknown }>(env, {
    template: "article_review", task: "content.review", siteId: x.c.site_id, format: formatSpec(x.i.format),
    rules: "Notes, problems, fixes and verdict in Vietnamese. Reply with a single JSON object only.",
    input: { ...writerInput(x), draft_html: raw }
  });
  const num = (v: unknown) => Math.max(0, Math.min(100, Math.round(Number(v) || 0)));
  return {
    score: num(r.score),
    criteria: (Array.isArray(r.criteria) ? r.criteria : []).slice(0, 8).map((c: Record<string, unknown>) => ({ name: String(c?.name || "").slice(0, 40), score: num(c?.score), note: String(c?.note || "").slice(0, 300) })),
    issues: (Array.isArray(r.issues) ? r.issues : []).slice(0, 8).map((c: Record<string, unknown>) => ({ where: String(c?.where || "").slice(0, 120), problem: String(c?.problem || "").slice(0, 400), fix: String(c?.fix || "").slice(0, 400) })),
    verdict: String(r.verdict || "").slice(0, 600)
  };
}

// Người viết sửa theo nhận xét; bỏ bản sửa nếu làm mất token (ảnh, nút mua, công khai)
async function reviseOnce(env: Env, x: Ctx, raw: string, issues: Review["issues"]): Promise<string> {
  const r = await aiJson<{ html?: string }>(env, {
    template: "article_revise", task: "content.revise", siteId: x.c.site_id, format: formatSpec(x.i.format),
    rules: rulesFor(x), input: { ...writerInput(x), draft_html: raw, issues }
  });
  const out = cleanHtml(String(r.html || ""), x.i.author === "owner" ? "all" : webSources(x.brief));
  const need = tokensOf(raw);
  const have = tokensOf(out);
  if (!out || [...need].some((t) => !have.has(t))) return raw;
  return out;
}

// Lỗi cấu trúc và câu sáo (kiểm bằng code) đưa vào vòng sửa như nhận xét của Biên tập viên
function codeIssues(x: Ctx, raw: string): Review["issues"] {
  const slots = slotsFor(x.i.format, x.products, (x.brief as { photo_requests?: { key: string; what: string }[] }).photo_requests || [], {});
  return [...checkStructure(x.i.format, raw, x.products, slots), ...checkVoice(raw, x.lang)].filter((p) => p.level === "block")
    .map((p) => ({ where: p.rule === "structure" ? "Cấu trúc" : "Giọng văn", problem: p.message, fix: p.rule === "structure" ? "Thêm phần còn thiếu đúng theo khung định dạng." : "Viết lại các câu đó cụ thể, tự nhiên hơn." }));
}

// Chấm → nếu dưới mức hoặc thiếu phần/câu sáo thì sửa → chấm lại (tối đa maxRevisions vòng)
async function qualityLoop(env: Env, x: Ctx, raw: string, maxRevisions: number, prev?: Review | null): Promise<{ raw: string; review: Review }> {
  const rounds = [...(prev?.rounds || [])];
  let cur = raw;
  let rv = prev && maxRevisions > 0 ? { score: prev.score, criteria: prev.criteria, issues: prev.issues, verdict: prev.verdict } : await reviewOnce(env, x, cur);
  if (!(prev && maxRevisions > 0)) rounds.push(rv.score);
  let code = codeIssues(x, cur);
  for (let n = 0; n < maxRevisions && (rv.score < x.rules.minQualityScore || code.length) && (rv.issues.length || code.length); n++) {
    const next = await reviseOnce(env, x, cur, [...code, ...rv.issues].slice(0, 12));
    if (next === cur) break;
    const r2 = await reviewOnce(env, x, next);
    const code2 = codeIssues(x, next);
    rounds.push(r2.score);
    if (r2.score >= rv.score || code2.length < code.length) { cur = next; rv = r2; code = code2; } else break;
  }
  return { raw: cur, review: { ...rv, rounds, at: now() } };
}

// Dựng lại bài (chèn công khai, nút mua, ảnh thật) và chạy Gác cổng: dùng sau khi viết, khi đổi sản phẩm hoặc tải ảnh
async function regate(env: Env, i: IdeaRow, c: CaseInfo, draft: Draft): Promise<{ draft: Draft; gate: GateResult; slots: Slot[] }> {
  const rules = readRules(c.rules);
  const products = readProducts(i.products);
  const brief = i.brief ? JSON.parse(i.brief) as { photo_requests?: { key: string; what: string }[] } : {};
  const slots = slotsFor(i.format, products, brief.photo_requests || [], readImages(i.images));
  const html = renderDraft(draft.raw ?? draft.html, { format: i.format, products, slots, rules, preview: false });
  const f = formatOf(i.format);
  const profile = await readProfile(env, c.site_id);
  const extra = checkFormat({ format: i.format, title: draft.title, html, products, slots, rules });
  extra.push(...checkStructure(i.format, draft.raw ?? draft.html, products, slots), ...checkVoice(html, rules.language || c.language));
  const wf = webSources(i.brief ? JSON.parse(i.brief) : null);
  if (wf.length && draft.author !== "owner" && !wf.some((u) => html.includes(u.replace(/"/g, "%22")))) extra.push({ rule: "sources", level: "warn", message: "Bài dùng dữ liệu tra từ Google nhưng chưa có link nguồn nào: thêm link tới nguồn trong câu có số liệu." });
  const rv = draft.review;
  if (!rv) extra.push({ rule: "quality", level: "warn", message: `Chưa được Biên tập viên chấm${draft.reviewError ? `: ${draft.reviewError}` : ""}.` });
  else if (rv.score < 60) extra.push({ rule: "quality", level: "block", message: `Biên tập viên chấm ${rv.score}/100 (dưới 60): bấm "Sửa theo nhận xét" hoặc viết lại.` });
  else if (rv.score < rules.minQualityScore) extra.push({ rule: "quality", level: "warn", message: `Biên tập viên chấm ${rv.score}/100, dưới mức anh đặt (${rules.minQualityScore}).` });
  const media = await mediaReady(env, await mediaSite(env, c.site_id));
  if (!media.verified && slots.some((s) => s.image)) extra.push({ rule: "media", level: "block", message: `Site chưa phục vụ ảnh ở ${media.base}: bấm "Dựng kho ảnh" (hoặc Kiểm tra lại) ở mục Ảnh thật.` });
  const gate = checkArticle(html, { ...rules, blocklist: blockOf(rules, profile) }, f.affiliate ? null : i.hub_path, { minWords: f.minWords, extraNumbers: [...productNumbers(products), ...profileNumbers(profile), ...interviewNumbers(readInterview(i.interview)), ...webNumbers(i.brief ? JSON.parse(i.brief) : null)], extra, numbersLevel: draft.author === "owner" ? "warn" : "block" });
  const out = { ...draft, raw: draft.raw ?? draft.html, html, words: wordCount(html.replace(/<[^>]+>/g, " ")) };
  await env.DB.prepare("UPDATE content_ideas SET draft = ?, gate = ?, updated_at = ? WHERE id = ?").bind(JSON.stringify(out), JSON.stringify(gate), now(), i.id).run();
  return { draft: out, gate, slots };
}

export async function draftCore(env: Env, ideaId: number, actor: string): Promise<GateResult> {
  const i = await idea(env, ideaId);
  if (!["briefed", "drafted"].includes(i.status) || !i.brief) throw new HttpError(409, "Cần có dàn ý trước khi viết.", "no_brief");
  if (i.wp_post_id) throw new HttpError(409, "Bài đã có bản nháp trên WordPress: sửa tiếp ở WordPress.", "exists");
  const c = await caseInfo(env, i.case_id!);
  const rules = readRules(c.rules);
  const lang = rules.language || c.language;
  const f = formatOf(i.format);
  const products = readProducts(i.products);
  if (products.items.length < f.minProducts) throw new HttpError(409, `Định dạng ${f.label} cần ít nhất ${f.minProducts} sản phẩm.`, "need_products");
  const brief = JSON.parse(i.brief) as Record<string, unknown> & { serp?: { paa?: string[] }; photo_requests?: { key: string; what: string }[] };
  const slots = slotsFor(i.format, products, brief.photo_requests || [], {});
  const iv = readInterview(i.interview);
  if (waitingInterview(iv, rules.requireInterview)) throw new HttpError(409, "Agent đang chờ anh trả lời phỏng vấn trải nghiệm (hoặc bấm Bỏ qua).", "need_interview");
  void lang;
  // Anh không có trải nghiệm để kể: agent tra Google lấy dữ kiện có nguồn trước khi viết
  if (!answered(iv).length && !(brief as { web_facts_at?: number }).web_facts_at) {
    try { await webFactsCore(env, ideaId, "agent:research"); } catch { /* không tra được thì viết với dữ kiện sẵn có */ }
  }
  const fresh0 = await idea(env, ideaId);
  const x0 = await ctxOf(env, fresh0);
  const r = await aiJson<{ title?: string; html?: string; meta_description?: string }>(env, {
    template: "article_draft", task: "content.draft", siteId: c.site_id, format: formatSpec(f.id),
    rules: rulesFor(x0),
    input: {
      format: f.id, keyword: i.keyword, voice: x0.profile.voice ? profileFor(x0.profile, i.keyword).voice : null, owner_interview: answered(iv), web_facts: webFactsOf(x0.brief),
      outline: { title: brief.title, angle: brief.angle, sections: brief.outline, faq: brief.faq },
      products: products.items.map((p, n) => ({ n: n + 1, name: p.name, merchant: p.merchant, best_for: p.bestFor, tested: p.tested, owner_notes: p.notes, specs: p.specs, pros: p.pros, cons: p.cons })),
      method: products.method, photo_slots: slots.map((s) => ({ key: s.key, what: s.label })), site_profile: profileFor(await readProfile(env, c.site_id), i.keyword),
      service_page: f.affiliate ? null : i.hub_path, anchor: f.affiliate ? null : brief.internal_link_anchor, paa: brief.serp?.paa || []
    }
  });
  let raw = cleanHtml(String(r.html || ""), webSources(x0.brief));
  let review: Review | null = null;
  let reviewError = "";
  try {
    const q = await qualityLoop(env, x0, raw, 2);
    raw = q.raw; review = q.review;
  } catch (e) { reviewError = (e as Error).message.slice(0, 200); }
  const base: Draft = { title: String(r.title || brief.title || i.keyword).slice(0, 120), slug: String(brief.slug || ""), raw, html: raw, meta_description: String(r.meta_description || brief.meta_description || "").slice(0, 160), words: 0, review, reviewError, author: "agent" };
  await env.DB.prepare("UPDATE content_ideas SET status = 'drafted', author = 'agent' WHERE id = ?").bind(ideaId).run();
  const { draft, gate, slots: s2 } = await regate(env, i, c, base);
  const missing = s2.filter((x) => x.required && !x.image).length;
  await logActivity(env, actor, "content.draft", `Viết bài nháp "${draft.title}" (${draft.words} từ${review ? `, Biên tập viên ${review.rounds.join(" → ")}/100` : ""})${missing ? ` — cần anh tải ${missing} ảnh thật` : gate.ok ? "" : " — Gác cổng chặn"}`, c.site_id);
  return gate;
}

// Tạo bản nháp trên WordPress (luôn status=draft, chống trùng slug)
export async function wpDraftCore(env: Env, ideaId: number, actor: string): Promise<{ id: number; edit: string }> {
  const i = await idea(env, ideaId);
  if (i.status !== "drafted" || !i.draft) throw new HttpError(409, "Chưa có bài nháp.", "no_draft");
  if (i.wp_post_id) throw new HttpError(409, "Bài này đã có bản nháp trên WordPress.", "exists");
  const c = await caseInfo(env, i.case_id!);
  const fresh = await regate(env, i, c, JSON.parse(i.draft) as Draft);
  if (!fresh.gate.ok) throw new HttpError(409, "Gác cổng chưa cho qua bài này.", "blocked");
  const d = fresh.draft;
  const r = await wpCall<{ id: number; edit_link: string }>(env, c.site_id, "/create", { method: "POST", body: { title: d.title, slug: d.slug, content: d.html, meta: { rank_math_description: d.meta_description, rank_math_focus_keyword: i.keyword } } });
  await env.DB.prepare("UPDATE content_ideas SET wp_post_id = ?, wp_edit_url = ?, updated_at = ? WHERE id = ?").bind(r.id, r.edit_link, now(), ideaId).run();
  await logActivity(env, actor, "content.wp_draft", `Tạo bản nháp WordPress "${d.title}" (chưa đăng)`, c.site_id);
  return { id: r.id, edit: r.edit_link };
}

// Chấm lại (revise=false) hoặc sửa theo nhận xét rồi chấm lại (revise=true, 1 vòng)
export async function reviewCore(env: Env, ideaId: number, revise: boolean, actor: string): Promise<GateResult> {
  const i = await idea(env, ideaId);
  if (i.status !== "drafted" || !i.draft) throw new HttpError(409, "Chưa có bài nháp.", "no_draft");
  if (i.wp_post_id) throw new HttpError(409, "Bài đã có bản nháp trên WordPress: sửa tiếp ở WordPress.", "exists");
  const d = JSON.parse(i.draft) as Draft;
  const x = await ctxOf(env, i);
  const q = await qualityLoop(env, x, d.raw ?? d.html, revise ? 1 : 0, revise ? d.review : null);
  const { gate } = await regate(env, i, x.c, { ...d, raw: q.raw, review: q.review, reviewError: "" });
  await logActivity(env, actor, "content.review", `Biên tập viên ${revise ? "sửa và chấm lại" : "chấm lại"} "${d.title}": ${q.review.rounds.join(" → ")}/100`, x.c.site_id);
  return gate;
}
export const apiReview = async (env: Env, req: Request, user: User, id: number) => { const b = await readJson(req).catch(() => ({})) as { revise?: boolean }; return run(user, () => reviewCore(env, id, b.revise === true, `user:${user.id}`)); };

// PUT /api/content/ideas/:id/interview { answers[], skip? } — anh trả lời phỏng vấn trải nghiệm
export async function apiInterview(env: Env, req: Request, user: User, id: number): Promise<Response> {
  canEdit(user);
  const i = await idea(env, id);
  const iv = readInterview(i.interview);
  if (!iv) throw new HttpError(409, "Bài này chưa có câu hỏi phỏng vấn (lập dàn ý trước).", "no_interview");
  const body = await readJson<{ answers?: unknown; skip?: unknown }>(req);
  const answers = iv.questions.map((_, n) => String((Array.isArray(body.answers) ? body.answers[n] : "") ?? "").trim().slice(0, 2000));
  const next: Interview = { questions: iv.questions, answers, skipped: body.skip === true && !answers.some(Boolean) };
  await env.DB.prepare("UPDATE content_ideas SET interview = ?, updated_at = ? WHERE id = ?").bind(JSON.stringify(next), now(), id).run();
  if (next.skipped) { try { await webFactsCore(env, id, "agent:research"); } catch { /* tra sau khi viết */ } }
  await logActivity(env, `user:${user.id}`, "content.interview", next.skipped ? `Bỏ qua phỏng vấn cho "${i.keyword}"` : `Trả lời ${answers.filter(Boolean).length} câu phỏng vấn cho "${i.keyword}"`, i.site_id);
  return json({ ok: true });
}

// Gói yêu cầu để anh dán vào Claude của anh: đủ dàn ý, khung định dạng, giọng văn, dữ kiện, sản phẩm, token
export async function handoffText(env: Env, id: number): Promise<{ text: string; filename: string }> {
  const i = await idea(env, id);
  if (!i.brief) throw new HttpError(409, "Cần lập dàn ý trước.", "no_brief");
  const x = await ctxOf(env, i);
  const f = formatOf(i.format);
  const b = x.brief as Record<string, unknown> & { outline?: { h2?: string; points?: string[]; h3?: string[] }[]; faq?: string[]; slug?: string; internal_link_anchor?: string; meta_description?: string; photo_requests?: { key: string; what: string }[] };
  const slots = slotsFor(i.format, x.products, b.photo_requests || [], {});
  const pf = profileFor(x.profile, i.keyword);
  const LANG = { de: "Tiếng Đức (xưng Sie)", en: "Tiếng Anh", vi: "Tiếng Việt" } as Record<string, string>;
  const lines: string[] = [
    `# Yêu cầu viết bài: ${String(b.title || i.keyword)}`,
    "",
    "Anh dán toàn bộ nội dung này vào Claude. Claude viết xong thì anh dán bài (Markdown) vào Duy Ơi › Bài mới › bài này › \"Đưa bài vào\".",
    "",
    "## Thông tin bài",
    `- Từ khoá chính: ${i.keyword}`,
    `- Định dạng: ${f.label}`,
    `- Ngôn ngữ: ${LANG[x.lang] || x.lang}`,
    `- Độ dài tối thiểu: ${f.minWords} từ`,
    i.hub_path && !f.affiliate ? `- Chèn đúng 1 link nội bộ tới ${i.hub_path} với anchor "${b.internal_link_anchor || ""}" (dạng Markdown [anchor](${i.hub_path}))` : "- Không chèn link ra ngoài; link mua do hệ thống chèn qua token",
    "",
    "## Khung định dạng (bắt buộc đúng thứ tự)",
    f.spec,
    "",
    "## Token (giữ nguyên, mỗi token một dòng riêng)",
    "- [[DISCLOSURE]]: câu công khai link affiliate (hệ thống tự thay).",
    ...x.products.items.map((p, n) => `- [[BUY:${n + 1}]]: nút mua ${p.name}`),
    ...slots.map((s) => `- [[IMG:${s.key}]]: ${s.label}${s.required ? " (bắt buộc)" : ""}`),
    "",
    "## Dàn ý đã duyệt",
    ...(b.outline || []).flatMap((o) => [`### ${o.h2 || ""}`, ...(o.points || []).map((p) => `- ${p}`), ...(o.h3 || []).map((h) => `- (H3) ${h}`)]),
    ...(b.faq?.length ? ["", "FAQ gợi ý:", ...b.faq.map((q) => `- ${q}`)] : []),
    "",
    ...(x.products.items.length ? ["## Sản phẩm (chỉ viết về các sản phẩm này, đúng thứ tự)", ...x.products.items.map((p, n) => `${n + 1}. ${p.name}: dùng tốt cho ${p.bestFor || "?"}; ${p.tested ? "ĐÃ dùng thật" : "CHƯA dùng thật (không được viết là đã test)"}${p.specs ? `; thông số: ${p.specs}` : ""}${p.notes ? `; trải nghiệm: ${p.notes}` : ""}${p.pros ? `; ưu: ${p.pros}` : ""}${p.cons ? `; nhược: ${p.cons}` : ""}`), ...(x.products.method ? [`Cách chọn: ${x.products.method}`] : []), ""] : []),
    ...(answered(readInterview(i.interview)).length ? ["## Trải nghiệm thật của chủ site (dùng làm chất liệu chính)", ...answered(readInterview(i.interview)).map((q) => `- Hỏi: ${q.q}\n  Đáp: ${q.a}`), ""] : []),
    ...(pf.voice ? ["## Giọng văn của site", `- Xưng hô: ${pf.voice.person}`, `- Mức trang trọng: ${pf.voice.formality}`, `- Câu: ${pf.voice.sentence_style}`, `- Đoạn: ${pf.voice.paragraphing}`, `- Mở bài: ${pf.voice.opening_style}`, ...(pf.voice.avoid.length ? [`- Không bao giờ: ${pf.voice.avoid.join("; ")}`] : []), ...pf.voice.excerpts.map((e) => `> ${e}`), ""] : []),
    ...(webFactsOf(x.brief).length ? ["## Dữ liệu tra từ Google (dùng phải ghi nguồn và gắn link trong câu, không viết như trải nghiệm của chủ site)", ...webFactsOf(x.brief).map((w) => `- ${w.text} — [${w.source_title}](${w.source_url})`), ""] : []),
    ...(pf.facts.length ? ["## Dữ kiện có nguồn (chỉ dùng số liệu trong danh sách này hoặc trong trải nghiệm ở trên)", ...pf.facts.map((f2) => `- ${f2.text}${f2.source ? ` (${f2.source})` : ""}`), ""] : []),
    "## Luật",
    "- Không bịa số liệu, giá, thống kê. Không ghi giá hay sao đánh giá.",
    "- Không viết \"chúng tôi đã test\" nếu sản phẩm chưa được đánh dấu đã dùng thật.",
    ...(blockOf(x.rules, x.profile).length ? [`- Không nhắc tới: ${blockOf(x.rules, x.profile).join(", ")}`] : []),
    `- Tránh câu sáo kiểu AI: ${clichesFor(x.lang).slice(0, 14).join(" | ")}`,
    "",
    "## Cách trả bài",
    "Trả về Markdown: dòng đầu \"# Tiêu đề\", các mục \"##\", mục con \"###\", bảng Markdown, token mỗi cái một dòng. Dòng cuối: \"Meta description: …\" (tối đa 155 ký tự)."
  ];
  return { text: lines.filter((l) => l !== undefined).join("\n"), filename: `${(b.slug || i.keyword).replace(/[^a-z0-9-]+/gi, "-").toLowerCase()}-yeu-cau.md` };
}

// GET /api/content/ideas/:id/handoff.md
export async function apiHandoff(env: Env, user: User, id: number): Promise<Response> {
  canEdit(user);
  const h = await handoffText(env, id);
  await env.DB.prepare("UPDATE content_ideas SET author = 'owner', updated_at = ? WHERE id = ? AND author IS NULL").bind(now(), id).run();
  return new Response(h.text, { headers: { "Content-Type": "text/markdown; charset=utf-8", "Content-Disposition": `attachment; filename="${h.filename}"`, "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } });
}

// POST /api/content/ideas/:id/import { content, revise? } — anh dán bài viết bằng Claude (Markdown hoặc HTML)
export async function importCore(env: Env, id: number, content: string, revise: boolean, actor: string): Promise<GateResult> {
  const i = await idea(env, id);
  if (!["approved", "briefed", "drafted"].includes(i.status)) throw new HttpError(409, "Chỉ đưa bài vào chủ đề đang làm.", "locked");
  if (i.wp_post_id) throw new HttpError(409, "Bài đã có bản nháp trên WordPress: sửa tiếp ở WordPress.", "exists");
  const text = String(content || "").trim();
  if (text.split(/\s+/).length < 150) throw new HttpError(400, "Bài quá ngắn: dán toàn bộ bài Claude viết.", "validation");
  if (text.length > 120000) throw new HttpError(413, "Bài quá dài.", "too_large");
  const meta = (text.match(/^\s*meta[- ]description\s*:\s*(.+)$/im) || [])[1]?.trim() || "";
  const body = text.replace(/^\s*meta[- ]description\s*:.*$/im, "").trim();
  const isHtml = /<(h2|p|ul|table)\b/i.test(body);
  const conv = isHtml ? { title: (body.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i) || [])[1]?.replace(/<[^>]+>/g, "").trim() || "", html: body.replace(/<h1[^>]*>[\s\S]*?<\/h1>/i, "") } : markdownToHtml(body);
  let raw = cleanHtml(conv.html, "all");
  const x = await ctxOf(env, { ...i, author: "owner" });
  const b = x.brief as { title?: string; slug?: string; meta_description?: string };
  let review: Review | null = null;
  let reviewError = "";
  try { const q = await qualityLoop(env, x, raw, revise ? 2 : 0); raw = q.raw; review = q.review; } catch (e) { reviewError = (e as Error).message.slice(0, 200); }
  const slug = String(b.slug || i.keyword).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 70);
  const base: Draft = { title: (conv.title || String(b.title || i.keyword)).slice(0, 120), slug, raw, html: raw, meta_description: (meta || String(b.meta_description || "")).slice(0, 160), words: 0, review, reviewError, author: "owner" };
  await env.DB.prepare("UPDATE content_ideas SET status = 'drafted', author = 'owner', updated_at = ? WHERE id = ?").bind(now(), id).run();
  const { draft, gate } = await regate(env, { ...i, author: "owner" }, x.c, base);
  await logActivity(env, actor, "content.import", `Đưa bài anh viết vào "${draft.title}" (${draft.words} từ${review ? `, Biên tập viên ${review.rounds.join(" → ")}/100` : ""})`, x.c.site_id);
  return gate;
}
export const apiImport = async (env: Env, req: Request, user: User, id: number) => { const b = await readJson<{ content?: string; revise?: boolean }>(req); return run(user, () => importCore(env, id, String(b.content || ""), b.revise !== false, `user:${user.id}`)); };

export const apiWebFacts = (env: Env, user: User, id: number) => run(user, () => webFactsCore(env, id, `user:${user.id}`));

// Site Astro: xuất bài thành file Markdown (frontmatter + HTML) để đưa vào repo; luôn draft: true
export async function apiExportMarkdown(env: Env, user: User, id: number): Promise<Response> {
  canEdit(user);
  const i = await idea(env, id);
  if (i.status !== "drafted" || !i.draft) throw new HttpError(409, "Chưa có bài nháp.", "no_draft");
  const c = await caseInfo(env, i.case_id!);
  const { draft, gate, slots } = await regate(env, i, c, JSON.parse(i.draft) as Draft);
  if (!gate.ok) throw new HttpError(409, "Gác cổng chưa cho qua bài này.", "blocked");
  const hero = slots.find((s) => s.image)?.image;
  const y = (v: string) => JSON.stringify(v);
  const md = [
    "---",
    `title: ${y(draft.title)}`,
    `description: ${y(draft.meta_description)}`,
    `slug: ${y(draft.slug)}`,
    `keyword: ${y(i.keyword)}`,
    `format: ${y(i.format)}`,
    `pubDate: ${y(new Date().toISOString().slice(0, 10))}`,
    hero ? `heroImage: ${y(hero.url)}\nheroImageAlt: ${y(hero.alt)}` : "",
    "author: \"\"   # điền tác giả thật trước khi đăng",
    "draft: true",
    "---",
    "",
    draft.html,
    ""
  ].filter((l) => l !== "").join("\n").replace("---\n\n", "---\n");
  await logActivity(env, `user:${user.id}`, "content.export", `Xuất file Markdown "${draft.title}" cho Astro`, c.site_id);
  return new Response(md, { headers: { "Content-Type": "text/markdown; charset=utf-8", "Content-Disposition": `attachment; filename="${(draft.slug || "bai-moi").replace(/[^a-z0-9-]/g, "")}.md"`, "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } });
}

// ---------------- Trạng thái tự động theo site ----------------

export async function getAuto(env: Env, siteId: number): Promise<Record<string, unknown>> {
  const r = await env.DB.prepare("SELECT data FROM autopilot_state WHERE site_id = ?").bind(siteId).first<{ data: string }>();
  try { return JSON.parse(r?.data || "{}"); } catch { return {}; }
}
export async function setAuto(env: Env, siteId: number, patch: Record<string, unknown>): Promise<void> {
  const cur = await getAuto(env, siteId);
  await env.DB.prepare("INSERT INTO autopilot_state (site_id, data, updated_at) VALUES (?, ?, ?) ON CONFLICT(site_id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at").bind(siteId, JSON.stringify({ ...cur, ...patch }), now()).run();
}

// ---------------- API ----------------

const parse = (v: unknown) => (v ? JSON.parse(String(v)) : null);

// GET /api/content/:caseId
export async function contentView(env: Env, caseId: number): Promise<Response> {
  const c = await caseInfo(env, caseId);
  const rules = readRules(c.rules);
  const pages = await pagesOf(env, caseId);
  const { results } = await env.DB.prepare("SELECT * FROM content_ideas WHERE site_id = ? ORDER BY CASE status WHEN 'drafted' THEN 0 WHEN 'briefed' THEN 1 WHEN 'approved' THEN 2 WHEN 'idea' THEN 3 ELSE 4 END, (covered_by IS NOT NULL), score DESC LIMIT 200").bind(c.site_id).all<Record<string, unknown>>();
  const wp = await env.DB.prepare("SELECT 1 FROM secrets WHERE key = ?").bind(`wp:${c.site_id}`).first();
  const ms = await mediaSite(env, c.site_id);
  return json({
    structure: structure(pages),
    siteType: c.site_type, platform: ms.platform, wpConnected: !!wp, media: await mediaReady(env, ms),
    formats: FORMATS.map((f) => ({ id: f.id, label: f.label, hint: f.hint, affiliate: f.affiliate, minProducts: f.minProducts, maxProducts: f.maxProducts })),
    ideas: results.map((r) => {
      const format = formatOf(String(r.format)).id;
      const products = readProducts(r.products as string | null);
      const brief = parse(r.brief);
      const draft = parse(r.draft) as Draft | null;
      const slots = slotsFor(format, products, brief?.photo_requests || [], readImages(r.images as string | null));
      const preview = draft ? renderDraft(draft.raw ?? draft.html, { format, products, slots, rules, preview: true }) : null;
      return { ...r, format, products, images: undefined, slots, brief, interview: readInterview(r.interview as string | null), waitingInterview: waitingInterview(readInterview(r.interview as string | null), rules.requireInterview), draft: draft ? { ...draft, raw: undefined, html: preview } : null, gate: parse(r.gate) };
    }),
    authorMode: rules.authorMode,
    limits: { perMonth: rules.maxNewArticlesPerMonth, usedThisMonth: await monthCount(env, c.site_id), minVolume: rules.minVolume },
    auto: await getAuto(env, c.site_id)
  });
}

// Tạo chủ đề (anh tự thêm hoặc Trưởng nhóm giao): vẫn qua kiểm trùng; khi duyệt vẫn qua giới hạn tháng
export async function createIdeaCore(env: Env, caseId: number, o: { keyword: string; format?: string; hub_path?: string | null }, actor: string): Promise<number> {
  const c = await caseInfo(env, caseId);
  const keyword = String(o.keyword || "").trim().toLowerCase().replace(/\s+/g, " ").slice(0, 120);
  if (keyword.length < 3) throw new HttpError(400, "Nhập từ khoá chính của bài.", "validation");
  const format = o.format ? formatOf(String(o.format)).id : detectFormat(keyword);
  const rules = readRules(c.rules);
  const profile = await readProfile(env, c.site_id);
  if (blockOf(rules, profile).some((b) => b && keyword.includes(b.toLowerCase()))) throw new HttpError(400, "Từ khoá chứa từ trong blocklist của site.", "blocklist");
  const pages = await pagesOf(env, caseId);
  const kt = toks(keyword);
  const cov = pages.filter((p) => p.d && p.kind !== "system").map((p) => ({ path: p.path, s: jac(kt, toks(`${p.d!.h1[0] || ""} ${p.d!.title} ${p.path.replace(/[-/]/g, " ")}`)) })).sort((a, b) => b.s - a.s)[0];
  const hub = typeof o.hub_path === "string" && pages.some((p) => p.path === o.hub_path) ? o.hub_path : null;
  const t = now();
  const r = await env.DB.prepare("INSERT INTO content_ideas (site_id, case_id, keyword, cluster, hub_path, covered_by, score, format, source, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, 0, ?, 'manual', ?, ?) ON CONFLICT(site_id, keyword) DO NOTHING RETURNING id")
    .bind(c.site_id, caseId, keyword, kt.slice(0, 2).join(" "), hub, cov && cov.s >= 0.6 ? cov.path : null, format, t, t).first<{ id: number }>();
  if (!r) throw new HttpError(409, "Chủ đề này đã có trong danh sách.", "duplicate");
  await logActivity(env, actor, "content.idea", `Thêm chủ đề "${keyword}" (${formatOf(format).label})`, c.site_id);
  return r.id;
}

// POST /api/content/:caseId/ideas { keyword, format, hub_path? }
export async function apiCreateIdea(env: Env, req: Request, user: User, caseId: number): Promise<Response> {
  canEdit(user);
  const body = await readJson(req);
  const id = await createIdeaCore(env, caseId, { keyword: String(body.keyword || ""), format: body.format ? String(body.format) : undefined, hub_path: typeof body.hub_path === "string" ? body.hub_path : null }, `user:${user.id}`);
  const row = await env.DB.prepare("SELECT covered_by FROM content_ideas WHERE id = ?").bind(id).first<{ covered_by: string | null }>();
  return json({ ok: true, id, coveredBy: row?.covered_by ?? null }, 201);
}

// PUT /api/content/ideas/:id/products { method, items[] }
export async function apiProducts(env: Env, req: Request, user: User, id: number): Promise<Response> {
  canEdit(user);
  const i = await idea(env, id);
  if (["published", "rejected"].includes(i.status) || i.wp_post_id) throw new HttpError(409, "Bài đã lên WordPress hoặc đã bỏ: sửa trực tiếp trên WordPress.", "locked");
  const f = formatOf(i.format);
  const products = parseProducts(await readJson(req));
  if (f.maxProducts && products.items.length > f.maxProducts) throw new HttpError(400, `${f.label} tối đa ${f.maxProducts} sản phẩm.`, "validation");
  if (f.affiliate) {
    const bad = products.items.filter((p) => !p.url).map((p) => p.name);
    if (bad.length) throw new HttpError(400, `Thiếu link (https) cho: ${bad.join(", ")}.`, "validation");
  }
  await env.DB.prepare("UPDATE content_ideas SET products = ?, updated_at = ? WHERE id = ?").bind(JSON.stringify(products), now(), id).run();
  if (i.draft) { const c = await caseInfo(env, i.case_id!); await regate(env, { ...i, products: JSON.stringify(products) }, c, JSON.parse(i.draft) as Draft); }
  await logActivity(env, `user:${user.id}`, "content.products", `Cập nhật ${products.items.length} sản phẩm cho "${i.keyword}"`, i.site_id);
  return json({ ok: true });
}

// POST /api/content/ideas/:id/images/:slot (thân request là file ảnh; query alt, caption, source, real=1)
export async function apiUploadImage(env: Env, req: Request, user: User, id: number, key: string): Promise<Response> {
  canEdit(user);
  const i = await idea(env, id);
  if (i.wp_post_id) throw new HttpError(409, "Bài đã lên WordPress: thêm ảnh trực tiếp trên WordPress.", "locked");
  const u = new URL(req.url);
  if (u.searchParams.get("real") !== "1") throw new HttpError(400, "Xác nhận đây là ảnh thật (không phải ảnh AI).", "not_real");
  const source = u.searchParams.get("source");
  if (!["own", "maker", "screenshot"].includes(source || "")) throw new HttpError(400, "Chọn nguồn ảnh.", "validation");
  const alt = String(u.searchParams.get("alt") || "").trim().slice(0, 160);
  if (alt.length < 5) throw new HttpError(400, "Nhập mô tả ảnh (alt) cho người không xem được ảnh.", "validation");
  const caption = String(u.searchParams.get("caption") || "").trim().slice(0, 200);
  const brief = i.brief ? JSON.parse(i.brief) as { photo_requests?: { key: string; what: string }[]; slug?: string } : {};
  const slot = slotsFor(i.format, readProducts(i.products), brief.photo_requests || [], {}).find((s) => s.key === key);
  if (!slot) throw new HttpError(404, "Bài này không có chỗ ảnh đó.", "not_found");
  const buf = new Uint8Array(await req.arrayBuffer());
  if (!buf.length) throw new HttpError(400, "File trống.", "validation");
  if (buf.length > MAX_IMAGE_BYTES) throw new HttpError(413, "Ảnh lớn hơn 8 MB: giảm kích thước rồi tải lại.", "too_large");
  const kind = sniffImage(buf);
  if (!kind) throw new HttpError(400, "Chỉ nhận ảnh JPEG, PNG hoặc WebP.", "validation");
  const bytes = kind.type === "image/jpeg" ? stripJpegMeta(buf) : buf;
  const c = await caseInfo(env, i.case_id!);
  const rules = readRules(c.rules);
  const filename = `${(brief.slug || i.keyword).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) || "anh"}-${key}.${kind.ext}`;
  if (rules.blockedFilenames.some((b) => b.endsWith("*") ? filename.startsWith(b.slice(0, -1).toLowerCase()) : filename === b.toLowerCase())) throw new HttpError(400, `Tên file ${filename} bị cấm theo luật site.`, "blocked_filename");
  const size = imageSize(bytes, kind.type);
  const m = await storeImage(env, await mediaSite(env, c.site_id), { bytes, type: kind.type, filename, alt, caption, width: size?.width ?? null, height: size?.height ?? null });
  const images = readImages(i.images);
  const im: UploadedImage = { id: m.id, url: m.url, alt, caption, source: source as UploadedImage["source"], width: m.width ?? size?.width ?? null, height: m.height ?? size?.height ?? null, at: now(), by: `user:${user.id}` };
  images[key] = im;
  await env.DB.prepare("UPDATE content_ideas SET images = ?, updated_at = ? WHERE id = ?").bind(JSON.stringify(images), now(), id).run();
  let gate: GateResult | null = null;
  if (i.draft) gate = (await regate(env, { ...i, images: JSON.stringify(images) }, c, JSON.parse(i.draft) as Draft)).gate;
  await logActivity(env, `user:${user.id}`, "content.image", `Tải ảnh thật "${slot.label.split(" (")[0]}" cho "${i.keyword}"`, c.site_id);
  return json({ ok: true, image: im, gate });
}

// DELETE /api/content/ideas/:id/images/:slot (ảnh vẫn nằm trong Thư viện Media của WordPress)
export async function apiDeleteImage(env: Env, user: User, id: number, key: string): Promise<Response> {
  canEdit(user);
  const i = await idea(env, id);
  if (i.wp_post_id) throw new HttpError(409, "Bài đã lên WordPress.", "locked");
  const images = readImages(i.images);
  delete images[key];
  await env.DB.prepare("UPDATE content_ideas SET images = ?, updated_at = ? WHERE id = ?").bind(JSON.stringify(images), now(), id).run();
  if (i.draft) { const c = await caseInfo(env, i.case_id!); await regate(env, { ...i, images: JSON.stringify(images) }, c, JSON.parse(i.draft) as Draft); }
  return json({ ok: true });
}

const run = async (user: User, fn: () => Promise<unknown>): Promise<Response> => { canEdit(user); return json({ ok: true, result: await fn() }); };

export const apiResearch = (env: Env, user: User, caseId: number) => run(user, () => researchCore(env, caseId, `user:${user.id}`));
export const apiBrief = (env: Env, user: User, id: number) => run(user, () => briefCore(env, id, `user:${user.id}`));
export const apiDraft = (env: Env, user: User, id: number) => run(user, () => draftCore(env, id, `user:${user.id}`));
export const apiWpDraft = (env: Env, user: User, id: number) => run(user, () => wpDraftCore(env, id, `user:${user.id}`));

// PUT /api/content/ideas/:id { status: approved | rejected | idea | published }
export async function apiIdeaStatus(env: Env, req: Request, user: User, id: number): Promise<Response> {
  canEdit(user);
  const body = await readJson(req);
  if (body.author !== undefined) {
    const i = await idea(env, id);
    const author = body.author === "owner" ? "owner" : body.author === "agent" ? "agent" : null;
    if (i.wp_post_id) throw new HttpError(409, "Bài đã lên WordPress.", "locked");
    await env.DB.prepare("UPDATE content_ideas SET author = ?, updated_at = ? WHERE id = ?").bind(author, now(), id).run();
    await logActivity(env, `user:${user.id}`, "content.author", `"${i.keyword}": ${author === "owner" ? "anh tự viết bằng Claude" : author === "agent" ? "agent viết" : "chưa chọn người viết"}`, i.site_id);
    return json({ ok: true });
  }
  if (body.format !== undefined) {
    const i = await idea(env, id);
    if (!["idea", "approved", "briefed"].includes(i.status)) throw new HttpError(409, "Chỉ đổi định dạng trước khi viết bài.", "locked");
    const f = formatOf(String(body.format));
    await env.DB.prepare("UPDATE content_ideas SET format = ?, brief = NULL, status = CASE status WHEN 'briefed' THEN 'approved' ELSE status END, updated_at = ? WHERE id = ?").bind(f.id, now(), id).run();
    await logActivity(env, `user:${user.id}`, "content.format", `Đổi định dạng "${i.keyword}" thành ${f.label}`, i.site_id);
    return json({ ok: true });
  }
  const status = String(body.status);
  if (status === "approved") await approveIdeaCore(env, id, `user:${user.id}`);
  else if (["rejected", "idea", "published"].includes(status)) {
    const i = await idea(env, id);
    await env.DB.prepare("UPDATE content_ideas SET status = ?, updated_at = ? WHERE id = ?").bind(status, now(), id).run();
    await logActivity(env, `user:${user.id}`, "content.status", `${status === "rejected" ? "Bỏ" : status === "published" ? "Đánh dấu đã đăng" : "Mở lại"} chủ đề "${i.keyword}"`, i.site_id);
  } else throw new HttpError(400, "Trạng thái không hợp lệ.", "validation");
  return json({ ok: true });
}
