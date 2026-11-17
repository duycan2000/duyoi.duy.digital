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
import type { Env, User } from "./types";

interface CaseInfo { id: number; site_id: number; rules: string; domain: string; market: string; language: string }
interface Pg { path: string; url: string; kind: string | null; d: PageData | null; traffic: { clicks?: number } | null }

const canEdit = (u: User) => { if (u.role === "viewer") throw new HttpError(403, "Tài khoản chỉ xem.", "forbidden"); };

async function caseInfo(env: Env, caseId: number): Promise<CaseInfo> {
  const c = await env.DB.prepare("SELECT c.id, c.site_id, c.rules, s.domain, s.market, s.language FROM recovery_cases c JOIN sites s ON s.id = c.site_id WHERE c.id = ?").bind(caseId).first<CaseInfo>();
  if (!c) throw new HttpError(404, "Không tìm thấy ca.", "not_found");
  return c;
}

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
    const score = coveredBy ? 0 : +((k.volume / ((k.kd ?? 30) + 10)) * intentW * (hubPath ? 1 : 0.3)).toFixed(2);
    if (coveredBy) covered++;
    stmts.push(env.DB.prepare("INSERT INTO content_ideas (site_id, case_id, keyword, volume, kd, intent, cpc, cluster, hub_path, covered_by, score, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(site_id, keyword) DO UPDATE SET volume = excluded.volume, kd = excluded.kd, intent = excluded.intent, covered_by = excluded.covered_by, hub_path = excluded.hub_path, score = CASE WHEN content_ideas.status = 'idea' THEN excluded.score ELSE content_ideas.score END, updated_at = excluded.updated_at")
      .bind(c.site_id, caseId, k.keyword, k.volume, k.kd, k.intent, k.cpc, kt.slice(0, 2).join(" "), hubPath, coveredBy, score, t, t));
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

interface IdeaRow { id: number; site_id: number; case_id: number | null; keyword: string; volume: number | null; intent: string | null; hub_path: string | null; covered_by: string | null; status: string; brief: string | null; draft: string | null; gate: string | null; wp_post_id: number | null }
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
  const pages = await pagesOf(env, c.id);
  const hub = pages.find((p) => p.path === i.hub_path);
  const serp = await serpInfo(env, c.site_id, i.keyword, c.market || "US", lang);
  const b = await aiJson<Record<string, unknown>>(env, {
    template: "content_brief", task: "content.brief", siteId: c.site_id,
    rules: writingRules(lang, rules.verifiedNumbers, rules.blocklist),
    input: {
      keyword: i.keyword, monthly_searches: i.volume, intent: i.intent,
      service_page: hub ? { path: hub.path, title: brandless(hub.d?.h1[0] || hub.d?.title || hub.path) } : null,
      top_results: serp.top.map((x) => ({ title: x.title, snippet: x.description })),
      people_also_ask: serp.paa,
      existing_pages_on_site: pages.filter((p) => p.d && p.kind !== "system").slice(0, 80).map((p) => ({ path: p.path, title: p.d!.title })),
      notes_from_owner: rules.notes.slice(0, 800)
    }
  });
  const slug = String(b.slug || i.keyword).toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/ä/g, "ae").replace(/ö/g, "oe").replace(/ü/g, "ue").replace(/ß/g, "ss").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 70);
  if (pages.some((p) => p.path.replace(/\//g, "") === slug)) throw new HttpError(409, `Slug "${slug}" trùng với trang có sẵn.`, "duplicate");
  const brief = { ...b, slug, serp, keyword: i.keyword, hub: i.hub_path };
  await env.DB.prepare("UPDATE content_ideas SET brief = ?, status = 'briefed', updated_at = ? WHERE id = ?").bind(JSON.stringify(brief), now(), ideaId).run();
  await logActivity(env, actor, "content.brief", `Lập dàn ý: "${String(b.title || i.keyword)}"`, c.site_id);
}

// ---------------- Bài nháp ----------------

const ALLOWED = new Set(["h2", "h3", "p", "ul", "ol", "li", "strong", "em", "a", "table", "thead", "tbody", "tr", "th", "td", "br"]);
export function cleanHtml(html: string): string {
  return html
    .replace(/<(script|style|iframe|object|embed)\b[\s\S]*?<\/\1>/gi, "")
    .replace(/<\/?([a-z0-9]+)\b([^>]*)>/gi, (m, tag: string, attrs: string) => {
      const t = tag.toLowerCase();
      if (!ALLOWED.has(t)) return "";
      if (m.startsWith("</")) return `</${t}>`;
      if (t === "a") { const href = (attrs.match(/href\s*=\s*"([^"]*)"/i) || [])[1] || ""; return /^(\/|https?:\/\/)/.test(href) && !/^javascript:/i.test(href) ? `<a href="${href.replace(/"/g, "")}">` : ""; }
      return `<${t}>`;
    })
    .trim();
}

export function checkArticle(html: string, rules: SiteRules, hubPath: string | null): GateResult {
  const problems: GateProblem[] = [];
  const text = html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
  const hits = blockHitsIn(text, [], rules);
  if (hits.length) problems.push({ rule: "blocklist", level: "block", message: `Bài chứa từ bị cấm: ${hits.join(", ")}.` });
  const marks = text.match(MARKER_RE);
  if (marks) problems.push({ rule: "markers", level: "block", message: `Còn dấu biên tập: ${[...new Set(marks)].join(", ")}.` });
  const r = langRatios(text);
  if (rules.language === "de" && r.en > r.de) problems.push({ rule: "language", level: "block", message: "Bài có vẻ là tiếng Anh, site chỉ viết tiếng Đức." });
  if (rules.language === "en" && r.de > r.en) problems.push({ rule: "language", level: "block", message: "Bài có vẻ là tiếng Đức, site viết tiếng Anh." });
  const allowed = new Set([...rules.verifiedNumbers.flatMap(extractNumbers), ...standardNumbers(text)]);
  const risky = extractNumbers(text).filter((n) => !allowed.has(n) && (/[%€$]|eur|usd/.test(n) || Number(n.replace(/[^\d]/g, "")) >= 10));
  if (risky.length) problems.push({ rule: "numbers", level: "block", message: `Có số liệu chưa có nguồn: ${risky.slice(0, 8).join(", ")}. Xoá hoặc ghi nguồn đã kiểm chứng.` });
  const words = wordCount(text);
  if (words < 600) problems.push({ rule: "length", level: "block", message: `Bài quá ngắn (${words} từ): dễ thành nội dung mỏng.` });
  if (hubPath && !html.includes(`href="${hubPath}"`)) problems.push({ rule: "hub_link", level: "warn", message: `Bài chưa có link tới trang dịch vụ ${hubPath}.` });
  problems.push({ rule: "expertise", level: "warn", message: "Trước khi đăng: chủ site thêm kinh nghiệm thật, ảnh thật (không dùng ảnh AI cho bản vẽ/BIM), tác giả thật." });
  return { ok: !problems.some((p) => p.level === "block"), checkedAt: now(), problems };
}

export async function draftCore(env: Env, ideaId: number, actor: string): Promise<GateResult> {
  const i = await idea(env, ideaId);
  if (!["briefed", "drafted"].includes(i.status) || !i.brief) throw new HttpError(409, "Cần có dàn ý trước khi viết.", "no_brief");
  const c = await caseInfo(env, i.case_id!);
  const rules = readRules(c.rules);
  const lang = rules.language || c.language;
  const brief = JSON.parse(i.brief) as Record<string, unknown> & { serp?: { paa?: string[] } };
  const r = await aiJson<{ title?: string; html?: string; meta_description?: string }>(env, {
    template: "article_draft", task: "content.draft", siteId: c.site_id,
    rules: writingRules(lang, rules.verifiedNumbers, rules.blocklist),
    input: { outline: { title: brief.title, angle: brief.angle, sections: brief.outline, faq: brief.faq }, service_page: i.hub_path, anchor: brief.internal_link_anchor, keyword: i.keyword, paa: brief.serp?.paa || [] }
  });
  const html = cleanHtml(String(r.html || ""));
  const draft = { title: String(r.title || brief.title || i.keyword).slice(0, 120), slug: String(brief.slug || ""), html, meta_description: String(r.meta_description || brief.meta_description || "").slice(0, 160), words: wordCount(html.replace(/<[^>]+>/g, " ")) };
  const gate = checkArticle(html, rules, i.hub_path);
  await env.DB.prepare("UPDATE content_ideas SET draft = ?, gate = ?, status = 'drafted', updated_at = ? WHERE id = ?").bind(JSON.stringify(draft), JSON.stringify(gate), now(), ideaId).run();
  await logActivity(env, actor, "content.draft", `Viết bài nháp "${draft.title}" (${draft.words} từ)${gate.ok ? "" : " — Gác cổng chặn"}`, c.site_id);
  return gate;
}

// Tạo bản nháp trên WordPress (luôn status=draft, chống trùng slug)
export async function wpDraftCore(env: Env, ideaId: number, actor: string): Promise<{ id: number; edit: string }> {
  const i = await idea(env, ideaId);
  if (i.status !== "drafted" || !i.draft) throw new HttpError(409, "Chưa có bài nháp.", "no_draft");
  const gate = i.gate ? (JSON.parse(i.gate) as GateResult) : null;
  if (!gate?.ok) throw new HttpError(409, "Gác cổng chưa cho qua bài này.", "blocked");
  if (i.wp_post_id) throw new HttpError(409, "Bài này đã có bản nháp trên WordPress.", "exists");
  const c = await caseInfo(env, i.case_id!);
  const d = JSON.parse(i.draft) as { title: string; slug: string; html: string; meta_description: string };
  const r = await wpCall<{ id: number; edit_link: string }>(env, c.site_id, "/create", { method: "POST", body: { title: d.title, slug: d.slug, content: d.html, meta: { rank_math_description: d.meta_description, rank_math_focus_keyword: i.keyword } } });
  await env.DB.prepare("UPDATE content_ideas SET wp_post_id = ?, wp_edit_url = ?, updated_at = ? WHERE id = ?").bind(r.id, r.edit_link, now(), ideaId).run();
  await logActivity(env, actor, "content.wp_draft", `Tạo bản nháp WordPress "${d.title}" (chưa đăng)`, c.site_id);
  return { id: r.id, edit: r.edit_link };
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

// GET /api/content/:caseId
export async function contentView(env: Env, caseId: number): Promise<Response> {
  const c = await caseInfo(env, caseId);
  const rules = readRules(c.rules);
  const pages = await pagesOf(env, caseId);
  const { results } = await env.DB.prepare("SELECT * FROM content_ideas WHERE site_id = ? ORDER BY CASE status WHEN 'drafted' THEN 0 WHEN 'briefed' THEN 1 WHEN 'approved' THEN 2 WHEN 'idea' THEN 3 ELSE 4 END, (covered_by IS NOT NULL), score DESC LIMIT 200").bind(c.site_id).all<Record<string, unknown>>();
  return json({
    structure: structure(pages),
    ideas: results.map((r) => ({ ...r, brief: r.brief ? JSON.parse(String(r.brief)) : null, draft: r.draft ? JSON.parse(String(r.draft)) : null, gate: r.gate ? JSON.parse(String(r.gate)) : null })),
    limits: { perMonth: rules.maxNewArticlesPerMonth, usedThisMonth: await monthCount(env, c.site_id), minVolume: rules.minVolume },
    auto: await getAuto(env, c.site_id)
  });
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
  const status = String(body.status);
  if (status === "approved") await approveIdeaCore(env, id, `user:${user.id}`);
  else if (["rejected", "idea", "published"].includes(status)) {
    const i = await idea(env, id);
    await env.DB.prepare("UPDATE content_ideas SET status = ?, updated_at = ? WHERE id = ?").bind(status, now(), id).run();
    await logActivity(env, `user:${user.id}`, "content.status", `${status === "rejected" ? "Bỏ" : status === "published" ? "Đánh dấu đã đăng" : "Mở lại"} chủ đề "${i.keyword}"`, i.site_id);
  } else throw new HttpError(400, "Trạng thái không hợp lệ.", "validation");
  return json({ ok: true });
}
