// Phục hồi thứ hạng: tạo ca, quét site theo lô (trong request bằng waitUntil, phần còn lại do cron), phân tích, lập việc, duyệt việc.

import { HttpError, json, now, readJson, str } from "./http";
import { logActivity } from "./activity";
import { analyze, disavowFile, plan, RECOVERY_AGENTS, type ScannedPage, type SiteChecks, type Traffic } from "./recovery-analyze";
import { ga4ByPage, gscTraffic, hasGoogle, type PageTraffic } from "./google";
import { checkEdits, type Edit } from "./recovery-gate";
import { aiJson, writingRules } from "./ai";
import { wpApply, wpGetPost, wpRestore, type WpEdit } from "./wordpress";
import { extractPage, type PageData } from "./recovery-extract";
import { parseRules, readRules, type SiteRules } from "./recovery-rules";
import { normalizeDomain } from "./sites";
import type { Env, ExecCtx, User } from "./types";

const MAX_PAGES = 400;
const BATCH = 6;
const UA = "Mozilla/5.0 (compatible; DuyOiBot/1.0; +https://duyoi.duy.digital)";

interface CaseRow {
  id: number; site_id: number; status: string; drop_month: string | null; rules: string; sitemap_url: string | null;
  pages_total: number; pages_done: number; score: number | null; diagnosis: string | null; site_checks: string | null;
  error: string | null; created_at: number; updated_at: number; finished_at: number | null;
  domain?: string; name?: string; language?: string;
}

const canEdit = (u: User) => { if (u.role === "viewer") throw new HttpError(403, "Tài khoản chỉ xem.", "forbidden"); };

// ---------------- Tải trang ----------------

function publicUrl(u: string): URL {
  const url = new URL(u);
  if (!/^https?:$/.test(url.protocol)) throw new Error("Chỉ hỗ trợ http/https");
  if (/^(localhost|127\.|10\.|192\.168\.|169\.254\.|0\.|\[)/i.test(url.hostname) || /^\d+\.\d+\.\d+\.\d+$/.test(url.hostname) || !url.hostname.includes(".")) throw new Error("Địa chỉ không hợp lệ");
  return url;
}

async function getText(u: string, maxBytes = 2_000_000): Promise<{ status: number; url: string; text: string; type: string }> {
  const res = await fetch(publicUrl(u).href, { headers: { "User-Agent": UA, Accept: "text/html,application/xml;q=0.9,*/*;q=0.5" }, redirect: "follow", signal: AbortSignal.timeout(15000) });
  const type = res.headers.get("content-type") || "";
  let text = "";
  if (res.body && !/image|video|audio|pdf|zip|octet/.test(type)) {
    const reader = res.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      chunks.push(value);
      if (size > maxBytes) { await reader.cancel(); break; }
    }
    const all = new Uint8Array(Math.min(size, maxBytes + 65536));
    let o = 0;
    for (const c of chunks) { if (o + c.byteLength > all.length) break; all.set(c, o); o += c.byteLength; }
    text = new TextDecoder().decode(all.subarray(0, o));
  }
  return { status: res.status, url: res.url || u, text, type };
}

const locs = (xml: string): { loc: string; lastmod: string | null }[] =>
  [...xml.matchAll(/<(?:url|sitemap)>([\s\S]*?)<\/(?:url|sitemap)>/gi)].map((m) => ({
    loc: (((m[1] ?? "").match(/<loc>\s*(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?\s*<\/loc>/i) || [])[1] || "").trim().replace(/&amp;/g, "&"),
    lastmod: (((m[1] ?? "").match(/<lastmod>([\s\S]*?)<\/lastmod>/i) || [])[1] || "").trim() || null
  })).filter((x) => x.loc);

const sameHost = (u: string, domain: string) => { try { return new URL(u).hostname.replace(/^www\./, "").toLowerCase() === domain; } catch { return false; } };
const pathOf = (u: string) => { try { return new URL(u).pathname || "/"; } catch { return "/"; } };

// Bước 1: robots.txt, sitemap, danh sách URL
async function discover(env: Env, c: CaseRow, domain: string): Promise<void> {
  const origin = `https://${domain}`;
  const checks: SiteChecks = { https: false, robotsTxt: null, robotsBlocksAll: false, sitemapUrl: null, homepageStatus: null, wordpress: false, elementor: false };
  let home: Awaited<ReturnType<typeof getText>> | null = null;
  try {
    home = await getText(`${origin}/`);
    checks.homepageStatus = home.status;
    checks.https = home.url.startsWith("https://");
    checks.wordpress = /\/wp-content\//.test(home.text);
    checks.elementor = /elementor/i.test(home.text);
  } catch (e) {
    throw new Error(`Không mở được trang chủ ${origin}: ${(e as Error).message}`);
  }
  const sitemapCands: string[] = [];
  try {
    const r = await getText(`${origin}/robots.txt`, 200_000);
    if (r.status < 400 && !/<html/i.test(r.text)) {
      checks.robotsTxt = r.text.slice(0, 5000);
      let star = false;
      for (const line of r.text.split(/\r?\n/)) {
        const [k, ...v] = line.split(":");
        const key = (k ?? "").trim().toLowerCase(), val = v.join(":").trim();
        if (key === "user-agent") star = val === "*";
        if (star && key === "disallow" && val === "/") checks.robotsBlocksAll = true;
        if (key === "sitemap" && val) sitemapCands.push(val);
      }
    }
  } catch { /* không có robots.txt */ }
  sitemapCands.push(`${origin}/sitemap_index.xml`, `${origin}/sitemap.xml`, `${origin}/wp-sitemap.xml`);

  const found = new Map<string, string | null>();
  for (const sm of [...new Set(sitemapCands)]) {
    try {
      const r = await getText(sm, 5_000_000);
      if (r.status >= 400 || !/<(urlset|sitemapindex)\b/i.test(r.text)) continue;
      checks.sitemapUrl = sm;
      if (/<sitemapindex\b/i.test(r.text)) {
        // Bỏ sitemap của ảnh, tag, tác giả
        const subs = locs(r.text).map((x) => x.loc).filter((l) => !/(image|attachment|author|tag|category|kategorie|post_tag|elementor|wp-sitemap-users|wp-sitemap-taxonomies)/i.test(l)).slice(0, 12);
        for (const s of subs) {
          try { const rr = await getText(s, 5_000_000); for (const x of locs(rr.text)) if (sameHost(x.loc, domain)) found.set(x.loc, x.lastmod); } catch { /* bỏ qua sitemap con lỗi */ }
          if (found.size >= MAX_PAGES) break;
        }
      } else for (const x of locs(r.text)) if (sameHost(x.loc, domain)) found.set(x.loc, x.lastmod);
      if (found.size) break;
    } catch { /* thử sitemap kế tiếp */ }
  }
  // Không có sitemap: lấy link từ trang chủ
  if (!found.size && home) {
    found.set(home.url, null);
    for (const m of home.text.matchAll(/<a\b[^>]*href=["']([^"'#]+)["']/gi)) {
      try {
        const u = new URL(m[1] ?? "", home.url);
        if (sameHost(u.href, domain) && !/\.(jpe?g|png|webp|gif|pdf|zip|xml)$/i.test(u.pathname) && !/\/wp-(content|admin|json)/.test(u.pathname)) found.set(`${u.origin}${u.pathname}`, null);
      } catch { /* bỏ qua */ }
      if (found.size >= 150) break;
    }
  }
  const urls = [...found.entries()].slice(0, MAX_PAGES);
  const stmts = urls.map(([u, lm]) => env.DB.prepare("INSERT OR IGNORE INTO recovery_pages (case_id, url, path, lastmod) VALUES (?, ?, ?, ?)").bind(c.id, u, pathOf(u), lm));
  for (let i = 0; i < stmts.length; i += 50) await env.DB.batch(stmts.slice(i, i + 50));
  await env.DB.prepare("UPDATE recovery_cases SET status = 'scanning', sitemap_url = ?, site_checks = ?, pages_total = ?, updated_at = ? WHERE id = ?")
    .bind(checks.sitemapUrl, JSON.stringify(checks), urls.length, now(), c.id).run();
}

// Bước 2: tải từng trang theo lô
async function scanBatch(env: Env, c: CaseRow, rules: SiteRules): Promise<number> {
  const { results } = await env.DB.prepare("SELECT id, url FROM recovery_pages WHERE case_id = ? AND status = 'queued' LIMIT ?").bind(c.id, BATCH).all<{ id: number; url: string }>();
  if (!results.length) return 0;
  const rows = await Promise.all(results.map(async (p) => {
    try {
      const r = await getText(p.url);
      const data: PageData | null = r.status < 400 && /html/i.test(r.type || "text/html") ? extractPage(r.text, r.url, rules) : null;
      if (data && r.url !== p.url) data.finalUrl = r.url;
      return env.DB.prepare("UPDATE recovery_pages SET status = 'done', http_status = ?, data = ?, fetched_at = ? WHERE id = ?").bind(r.status, data ? JSON.stringify(data) : null, now(), p.id);
    } catch (e) {
      return env.DB.prepare("UPDATE recovery_pages SET status = 'error', error = ?, fetched_at = ? WHERE id = ?").bind(String((e as Error).message || e).slice(0, 300), now(), p.id);
    }
  }));
  await env.DB.batch(rows);
  await env.DB.prepare("UPDATE recovery_cases SET pages_done = (SELECT COUNT(*) FROM recovery_pages WHERE case_id = ? AND status != 'queued'), updated_at = ? WHERE id = ?").bind(c.id, now(), c.id).run();
  return results.length;
}

async function loadPages(env: Env, caseId: number): Promise<ScannedPage[]> {
  const { results } = await env.DB.prepare("SELECT id, url, path, lastmod, status, http_status, data FROM recovery_pages WHERE case_id = ?").bind(caseId)
    .all<{ id: number; url: string; path: string; lastmod: string | null; status: string; http_status: number | null; data: string | null }>();
  return results.map((r) => ({ ...r, data: r.data ? (JSON.parse(r.data) as PageData) : null }));
}

// Bước 3: phân tích và lập việc
async function finish(env: Env, c: CaseRow, rules: SiteRules, domain: string): Promise<void> {
  const pages = await loadPages(env, c.id);
  const checks: SiteChecks = c.site_checks ? JSON.parse(c.site_checks) : { https: true, robotsTxt: null, robotsBlocksAll: false, sitemapUrl: null, homepageStatus: null, wordpress: false, elementor: false };
  // Traffic thật (nếu đã nối Google)
  const traffic: Traffic = new Map();
  const notes: string[] = [];
  if ((rules.gscProperty || rules.ga4Property) && (await hasGoogle(env))) {
    if (rules.gscProperty) {
      try { for (const [k, v] of await gscTraffic(env, rules.gscProperty, c.drop_month)) traffic.set(k.endsWith("/") || /\.[a-z0-9]{2,5}$/i.test(k) ? k : `${k}/`, v); }
      catch (e) { notes.push(`Search Console (${rules.gscProperty}): ${(e as Error).message}`); }
    }
    if (rules.ga4Property) {
      try { for (const [k, v] of await ga4ByPage(env, rules.ga4Property)) traffic.set(k, { ...(traffic.get(k) || { clicks: 0, impressions: 0, position: null, clicksPrev: 0, impressionsPrev: 0 }), ...v }); }
      catch (e) { notes.push(`GA4 (${rules.ga4Property}): ${(e as Error).message}`); }
    }
  } else if (rules.gscProperty || rules.ga4Property) notes.push("Đã nhập property nhưng chưa có Google service account trong Cài đặt.");
  const a = analyze(pages, checks, rules, c.drop_month, traffic, notes);
  const tasks = plan({ pages, analysis: a, rules, elementor: checks.elementor, traffic });
  const t = now();
  const kindStmts = pages.map((p) => { const t = traffic.get(p.path); return env.DB.prepare("UPDATE recovery_pages SET kind = ?, traffic = ? WHERE id = ?").bind(a.kinds.get(p.id) || null, t ? JSON.stringify(t) : null, p.id); });
  for (let i = 0; i < kindStmts.length; i += 80) await env.DB.batch(kindStmts.slice(i, i + 80));
  // Giữ việc đã duyệt/đã làm từ lần quét trước; thay các đề xuất cũ
  await env.DB.batch([
    env.DB.prepare("DELETE FROM recovery_findings WHERE case_id = ?").bind(c.id),
    env.DB.prepare("DELETE FROM recovery_tasks WHERE case_id = ? AND status IN ('proposed', 'blocked')").bind(c.id),
    ...a.findings.map((f) => env.DB.prepare("INSERT INTO recovery_findings (case_id, code, category, severity, title, detail, urls, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
      .bind(c.id, f.code, f.category, f.severity, f.title, f.detail, JSON.stringify(f.urls), t))
  ]);
  const keep = await env.DB.prepare("SELECT kind, target_url FROM recovery_tasks WHERE case_id = ?").bind(c.id).all<{ kind: string; target_url: string | null }>();
  const kept = new Set(keep.results.map((r) => `${r.kind}|${r.target_url || ""}`));
  const ins = tasks.filter((x) => !kept.has(`${x.kind}|${x.target_url || ""}`)).map((x) => env.DB.prepare(
    "INSERT INTO recovery_tasks (case_id, agent, kind, title, detail, target_url, payload, risk, priority, status, gate, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
  ).bind(c.id, x.agent, x.kind, x.title, x.detail, x.target_url, JSON.stringify(x.payload), x.risk, x.priority, x.gate && !x.gate.ok ? "blocked" : "proposed", x.gate ? JSON.stringify(x.gate) : null, t, t));
  for (let i = 0; i < ins.length; i += 50) await env.DB.batch(ins.slice(i, i + 50));
  await env.DB.prepare("UPDATE recovery_cases SET status = 'ready', score = ?, diagnosis = ?, error = NULL, updated_at = ?, finished_at = ? WHERE id = ?")
    .bind(a.score, JSON.stringify(a.diagnosis), t, t, c.id).run();
  await logActivity(env, "agent:recovery", "recovery.ready", `Chẩn đoán xong ${domain}: điểm ${a.score}/100, ${a.findings.length} vấn đề, ${ins.length} việc mới`, c.site_id);
}

async function getCaseRow(env: Env, id: number): Promise<CaseRow> {
  const c = await env.DB.prepare("SELECT c.*, s.domain, s.name, s.language FROM recovery_cases c JOIN sites s ON s.id = c.site_id WHERE c.id = ?").bind(id).first<CaseRow>();
  if (!c) throw new HttpError(404, "Không tìm thấy ca phục hồi.", "not_found");
  return c;
}

// Chạy tiếp một ca trong giới hạn thời gian. Gọi từ request (waitUntil) và từ cron.
export async function processCase(env: Env, caseId: number, budgetMs: number): Promise<void> {
  const deadline = Date.now() + budgetMs;
  let c = await getCaseRow(env, caseId);
  const rules = readRules(c.rules);
  try {
    if (c.status === "discovering") { await discover(env, c, c.domain!); c = await getCaseRow(env, caseId); }
    if (c.status === "scanning") {
      while (Date.now() < deadline - 4000) if (!(await scanBatch(env, c, rules))) break;
      const left = await env.DB.prepare("SELECT COUNT(*) AS n FROM recovery_pages WHERE case_id = ? AND status = 'queued'").bind(caseId).first<{ n: number }>();
      if ((left?.n ?? 0) > 0) return;
      await env.DB.prepare("UPDATE recovery_cases SET status = 'analyzing', updated_at = ? WHERE id = ?").bind(now(), caseId).run();
      c.status = "analyzing";
    }
    if (c.status === "analyzing") await finish(env, c, rules, c.domain!);
  } catch (e) {
    await env.DB.prepare("UPDATE recovery_cases SET status = 'failed', error = ?, updated_at = ? WHERE id = ?").bind(String((e as Error).message || e).slice(0, 500), now(), caseId).run();
  }
}

// Cron: chạy tiếp các ca đang dở
export async function processRecoveryQueue(env: Env, budgetMs = 20000): Promise<void> {
  const { results } = await env.DB.prepare("SELECT id FROM recovery_cases WHERE status IN ('discovering', 'scanning', 'analyzing') ORDER BY updated_at LIMIT 2").all<{ id: number }>();
  for (const r of results) await processCase(env, r.id, budgetMs / results.length);
}

const run = (env: Env, ctx: ExecCtx | undefined, id: number): Promise<void> | void => {
  const p = processCase(env, id, 25000);
  if (ctx) ctx.waitUntil(p); else return p;
};

// ---------------- API ----------------

// POST /api/recovery { url, dropMonth?, language?, rules? }
export async function createCase(env: Env, req: Request, user: User, ctx?: ExecCtx): Promise<Response> {
  canEdit(user);
  const body = await readJson(req);
  const domain = normalizeDomain(body.url);
  const dropMonth = str(body.dropMonth, "Tháng tụt", { optional: true, max: 7 });
  if (dropMonth && !/^\d{4}-(0[1-9]|1[0-2])$/.test(dropMonth)) throw new HttpError(400, "Tháng tụt dạng YYYY-MM.", "validation");
  const t = now();
  let site = await env.DB.prepare("SELECT id, language FROM sites WHERE domain = ?").bind(domain).first<{ id: number; language: string }>();
  const lang = String(body.language || site?.language || "en").toLowerCase().slice(0, 2);
  if (!site) {
    const r = await env.DB.prepare("INSERT INTO sites (name, domain, platform, site_type, market, language, status, created_at, updated_at) VALUES (?, ?, 'wordpress', 'service', ?, ?, 'active', ?, ?)")
      .bind(domain, domain, lang === "de" ? "DE" : "US", lang, t, t).run();
    site = { id: Number(r.meta.last_row_id), language: lang };
    await logActivity(env, `user:${user.id}`, "site.created", `${domain} (${domain})`, site.id);
  }
  const busy = await env.DB.prepare("SELECT id FROM recovery_cases WHERE site_id = ? AND status IN ('discovering', 'scanning', 'analyzing')").bind(site.id).first<{ id: number }>();
  if (busy) throw new HttpError(409, "Site này đang được quét. Đợi xong rồi quét lại.", "busy");
  // Lấy luật của ca gần nhất làm nền để không phải nhập lại
  const prev = await env.DB.prepare("SELECT rules FROM recovery_cases WHERE site_id = ? ORDER BY id DESC LIMIT 1").bind(site.id).first<{ rules: string }>();
  const rules = parseRules({ language: lang, ...(body.rules && typeof body.rules === "object" ? body.rules : {}) }, readRules(prev?.rules));
  const r = await env.DB.prepare("INSERT INTO recovery_cases (site_id, drop_month, rules, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)")
    .bind(site.id, dropMonth || null, JSON.stringify(rules), user.id, t, t).run();
  const id = Number(r.meta.last_row_id);
  await logActivity(env, `user:${user.id}`, "recovery.created", `Bắt đầu chẩn đoán ${domain}`, site.id);
  await run(env, ctx, id);
  return json({ id }, 201);
}

const caseApi = (c: CaseRow) => ({
  id: c.id, siteId: c.site_id, domain: c.domain, name: c.name, status: c.status, dropMonth: c.drop_month,
  pagesTotal: c.pages_total, pagesDone: c.pages_done, score: c.score, error: c.error,
  createdAt: c.created_at, updatedAt: c.updated_at, finishedAt: c.finished_at
});

// GET /api/recovery
export async function listCases(env: Env): Promise<Response> {
  const { results } = await env.DB.prepare(
    "SELECT c.*, s.domain, s.name, (SELECT COUNT(*) FROM recovery_tasks t WHERE t.case_id = c.id AND t.status IN ('proposed', 'blocked')) AS open_tasks FROM recovery_cases c JOIN sites s ON s.id = c.site_id WHERE c.status != 'archived' ORDER BY c.id DESC LIMIT 100"
  ).all<CaseRow & { open_tasks: number }>();
  // Trạng thái cài đặt cho phần hướng dẫn (không trả bí mật, chỉ biết đã có hay chưa)
  const sec = await env.DB.prepare("SELECT key, hint FROM secrets WHERE key IN ('google_service_account', 'openrouter_api_key') OR key LIKE 'wp:%'").all<{ key: string; hint: string }>();
  const has = (k: string) => sec.results.find((r) => r.key === k);
  const wpSites = await env.DB.prepare("SELECT id, domain, platform, wp_user FROM sites WHERE status != 'archived' AND platform != 'astro' ORDER BY domain").all<{ id: number; domain: string; platform: string; wp_user: string | null }>();
  const rulesRows = await env.DB.prepare("SELECT c.site_id, c.rules FROM recovery_cases c WHERE c.id IN (SELECT MAX(id) FROM recovery_cases GROUP BY site_id)").all<{ site_id: number; rules: string }>();
  const ruleOf = new Map(rulesRows.results.map((r) => [r.site_id, readRules(r.rules)]));
  const setup = {
    googleServiceAccount: Boolean(has("google_service_account")),
    googleEmail: has("google_service_account")?.hint || null,
    openrouter: Boolean(has("openrouter_api_key")),
    sites: wpSites.results.map((x) => ({ id: x.id, domain: x.domain, wpConnected: Boolean(x.wp_user && has(`wp:${x.id}`)), gscProperty: ruleOf.get(x.id)?.gscProperty || "", ga4Property: ruleOf.get(x.id)?.ga4Property || "" }))
  };
  return json({ cases: results.map((c) => ({ ...caseApi(c), openTasks: c.open_tasks })), agents: RECOVERY_AGENTS, setup });
}

// GET /api/recovery/:id
export async function getCase(env: Env, id: number): Promise<Response> {
  const c = await getCaseRow(env, id);
  const [findings, tasks, pages] = await Promise.all([
    env.DB.prepare("SELECT * FROM recovery_findings WHERE case_id = ? ORDER BY CASE severity WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 WHEN 'low' THEN 3 ELSE 4 END, id").bind(id).all<Record<string, unknown>>(),
    env.DB.prepare("SELECT * FROM recovery_tasks WHERE case_id = ? ORDER BY CASE status WHEN 'blocked' THEN 1 WHEN 'proposed' THEN 0 WHEN 'approved' THEN 2 WHEN 'done' THEN 3 ELSE 4 END, priority, id").bind(id).all<Record<string, unknown>>(),
    env.DB.prepare("SELECT id, url, path, status, http_status, kind, data, traffic, error FROM recovery_pages WHERE case_id = ? ORDER BY path LIMIT 500").bind(id).all<{ id: number; url: string; path: string; status: string; http_status: number | null; kind: string | null; data: string | null; traffic: string | null; error: string | null }>()
  ]);
  const inbound = new Map<string, number>();
  const parsed = pages.results.map((p) => ({ ...p, d: p.data ? (JSON.parse(p.data) as PageData) : null }));
  for (const p of parsed) for (const l of p.d?.internalLinks || []) if (l !== p.path) inbound.set(l, (inbound.get(l) || 0) + 1);
  return json({
    case: { ...caseApi(c), diagnosis: c.diagnosis ? JSON.parse(c.diagnosis) : null, siteChecks: c.site_checks ? JSON.parse(c.site_checks) : null, rules: readRules(c.rules) },
    agents: RECOVERY_AGENTS,
    findings: findings.results.map((f) => ({ ...f, urls: JSON.parse(String(f.urls || "[]")) })),
    tasks: tasks.results.map((t) => ({ ...t, payload: t.payload ? JSON.parse(String(t.payload)) : null, gate: t.gate ? JSON.parse(String(t.gate)) : null })),
    backups: (await env.DB.prepare("SELECT id, task_id, url, created_at, restored_at FROM recovery_backups WHERE site_id = ? ORDER BY id DESC LIMIT 100").bind(c.site_id).all()).results,
    wpConnected: Boolean((await env.DB.prepare("SELECT wp_user FROM sites WHERE id = ?").bind(c.site_id).first<{ wp_user: string | null }>())?.wp_user) && Boolean(await env.DB.prepare("SELECT 1 FROM secrets WHERE key = ?").bind(`wp:${c.site_id}`).first()),
    pages: parsed.map((p) => ({
      id: p.id, url: p.url, path: p.path, status: p.status, httpStatus: p.http_status, kind: p.kind, error: p.error,
      title: p.d?.title || "", words: p.d?.words ?? null, inbound: inbound.get(p.path) || 0, outLinks: p.d?.internalLinks.length ?? 0,
      cta: p.d?.ctaFound ?? null, elementor: p.d?.elementor ?? null, noindex: p.d ? /noindex/.test(p.d.robots) : null, blockHits: p.d?.blockHits || [],
      traffic: p.traffic ? (JSON.parse(p.traffic) as PageTraffic) : null
    }))
  });
}

// POST /api/recovery/:id/rescan — quét lại từ đầu (giữ việc đã duyệt/đã làm)
export async function rescanCase(env: Env, user: User, id: number, ctx?: ExecCtx): Promise<Response> {
  canEdit(user);
  const c = await getCaseRow(env, id);
  if (["discovering", "scanning", "analyzing"].includes(c.status)) { await run(env, ctx, id); return json({ ok: true, continued: true }); }
  await env.DB.batch([
    env.DB.prepare("DELETE FROM recovery_pages WHERE case_id = ?").bind(id),
    env.DB.prepare("UPDATE recovery_cases SET status = 'discovering', pages_total = 0, pages_done = 0, error = NULL, updated_at = ? WHERE id = ?").bind(now(), id)
  ]);
  await logActivity(env, `user:${user.id}`, "recovery.rescan", `Quét lại ${c.domain}`, c.site_id);
  await run(env, ctx, id);
  return json({ ok: true });
}

// PUT /api/recovery/:id/rules — luật an toàn; phân tích lại ngay nếu đã quét xong
export async function updateRules(env: Env, req: Request, user: User, id: number, ctx?: ExecCtx): Promise<Response> {
  canEdit(user);
  const c = await getCaseRow(env, id);
  const body = await readJson(req);
  const rules = parseRules(body.rules, readRules(c.rules));
  const dropMonth = body.dropMonth === undefined ? c.drop_month : str(body.dropMonth, "Tháng tụt", { optional: true, max: 7 }) || null;
  if (dropMonth && !/^\d{4}-(0[1-9]|1[0-2])$/.test(dropMonth)) throw new HttpError(400, "Tháng tụt dạng YYYY-MM.", "validation");
  await env.DB.prepare("UPDATE recovery_cases SET rules = ?, drop_month = ?, updated_at = ? WHERE id = ?").bind(JSON.stringify(rules), dropMonth, now(), id).run();
  await logActivity(env, `user:${user.id}`, "recovery.rules", `Cập nhật luật an toàn cho ${c.domain}`, c.site_id);
  if (c.status === "ready") {
    // Blocklist/từ khoá đổi thì phải đọc lại trang; còn lại chỉ cần phân tích lại
    const pages = await loadPages(env, id);
    const needReExtract = JSON.stringify(readRules(c.rules).blocklist) !== JSON.stringify(rules.blocklist) || JSON.stringify(readRules(c.rules).blockedFilenames) !== JSON.stringify(rules.blockedFilenames);
    if (needReExtract && pages.length) {
      await env.DB.prepare("UPDATE recovery_pages SET status = 'queued' WHERE case_id = ?").bind(id).run();
      await env.DB.prepare("UPDATE recovery_cases SET status = 'scanning', pages_done = 0, updated_at = ? WHERE id = ?").bind(now(), id).run();
      await run(env, ctx, id);
      return json({ ok: true, rescanning: true });
    }
    await finish(env, { ...c, rules: JSON.stringify(rules), drop_month: dropMonth }, rules, c.domain!);
  }
  return json({ ok: true });
}

// PUT /api/recovery/tasks/:id { status, note? }
export async function decideTask(env: Env, req: Request, user: User, taskId: number): Promise<Response> {
  canEdit(user);
  const body = await readJson(req);
  const status = String(body.status || "");
  if (!["approved", "rejected", "done", "proposed"].includes(status)) throw new HttpError(400, "Trạng thái không hợp lệ.", "validation");
  const t = await env.DB.prepare("SELECT t.*, c.site_id FROM recovery_tasks t JOIN recovery_cases c ON c.id = t.case_id WHERE t.id = ?").bind(taskId)
    .first<{ id: number; status: string; risk: string; title: string; gate: string | null; site_id: number }>();
  if (!t) throw new HttpError(404, "Không tìm thấy việc.", "not_found");
  if (status === "approved" && t.status === "blocked") throw new HttpError(409, "Gác cổng đã chặn việc này. Sửa luật hoặc nội dung rồi quét lại.", "blocked");
  if (t.risk === "irreversible" && status === "approved" && user.role !== "admin") throw new HttpError(403, "Việc khó đảo ngược chỉ admin được duyệt.", "forbidden");
  const note = str(body.note, "Ghi chú", { optional: true, max: 1000 }) || null;
  await env.DB.prepare("UPDATE recovery_tasks SET status = ?, note = COALESCE(?, note), decided_by = ?, decided_at = ?, updated_at = ? WHERE id = ?").bind(status, note, user.id, now(), now(), taskId).run();
  const verb = { approved: "Duyệt", rejected: "Từ chối", done: "Đánh dấu xong", proposed: "Mở lại" }[status];
  await logActivity(env, `user:${user.id}`, "recovery.task", `${verb}: ${t.title}`, t.site_id);
  return json({ ok: true });
}

// GET /api/recovery/:id/disavow — tải file disavow
export async function disavow(env: Env, id: number): Promise<Response> {
  const c = await getCaseRow(env, id);
  const rules = readRules(c.rules);
  if (!rules.toxicDomains.length) throw new HttpError(400, "Chưa có domain nào trong danh sách backlink xấu.", "validation");
  return new Response(disavowFile(c.domain!, rules.toxicDomains), {
    headers: { "Content-Type": "text/plain; charset=utf-8", "Content-Disposition": `attachment; filename="disavow-${c.domain}.txt"`, "Cache-Control": "no-store" }
  });
}

// POST /api/recovery/:id/archive
export async function archiveCase(env: Env, user: User, id: number): Promise<Response> {
  canEdit(user);
  const c = await getCaseRow(env, id);
  await env.DB.prepare("UPDATE recovery_cases SET status = 'archived', updated_at = ? WHERE id = ?").bind(now(), id).run();
  await logActivity(env, `user:${user.id}`, "recovery.archived", `Lưu trữ ca phục hồi ${c.domain}`, c.site_id);
  return json({ ok: true });
}


// ---------------- Áp dụng việc đã duyệt lên WordPress (có sao lưu, hoàn tác) ----------------

interface TaskRow {
  id: number; case_id: number; agent: string; kind: string; title: string; target_url: string | null; payload: string | null;
  risk: string; status: string; gate: string | null; site_id: number; rules: string; domain: string;
}

async function taskRow(env: Env, id: number): Promise<TaskRow> {
  const t = await env.DB.prepare("SELECT t.*, c.site_id, c.rules, s.domain FROM recovery_tasks t JOIN recovery_cases c ON c.id = t.case_id JOIN sites s ON s.id = c.site_id WHERE t.id = ?").bind(id).first<TaskRow>();
  if (!t) throw new HttpError(404, "Không tìm thấy việc.", "not_found");
  return t;
}

async function pageData(env: Env, caseId: number, url: string): Promise<PageData | null> {
  const r = await env.DB.prepare("SELECT data FROM recovery_pages WHERE case_id = ? AND url = ?").bind(caseId, url).first<{ data: string | null }>();
  return r?.data ? (JSON.parse(r.data) as PageData) : null;
}

function gateContext(rules: SiteRules, d: PageData | null, titleOf: (path: string) => string, occ?: (find: string) => number) {
  return {
    rules,
    pageNumbers: d?.numbers || [],
    occurrences: occ || ((find: string) => (d?.sections.find((s) => s.lastSentence === find)?.occurrences ?? d?.sections.find((s) => s.firstSentence === find)?.firstOccurrences ?? (d?.title === find || d?.metaDescription === find ? 1 : 0))),
    elementor: Boolean(d?.elementor) || rules.builder === "elementor",
    targetText: titleOf
  };
}

async function titleLookup(env: Env, caseId: number): Promise<(path: string) => string> {
  const { results } = await env.DB.prepare("SELECT path, data FROM recovery_pages WHERE case_id = ? AND kind IN ('commercial', 'conversion', 'home')").bind(caseId).all<{ path: string; data: string | null }>();
  const m = new Map(results.map((r) => { const d = r.data ? (JSON.parse(r.data) as PageData) : null; return [r.path, d ? d.h1[0] || d.title.split(/\s[|–—]\s/)[0] || d.title : r.path]; }));
  return (path: string) => m.get(path) || path;
}

// POST /api/recovery/tasks/:id/apply
export async function applyTask(env: Env, user: User, taskId: number): Promise<Response> {
  canEdit(user);
  const t = await taskRow(env, taskId);
  if (t.status !== "approved") throw new HttpError(409, "Chỉ áp dụng được việc đã duyệt.", "not_approved");
  const p = t.payload ? (JSON.parse(t.payload) as { edits?: Edit[]; applied?: unknown }) : {};
  if (!p.edits?.length || !t.target_url) throw new HttpError(400, "Việc này không có nội dung sửa để áp dụng tự động; làm tay rồi bấm Đã xong.", "manual");
  const rules = readRules(t.rules);
  // Gác cổng chạy lại ngay trước khi ghi (luật có thể đã đổi sau lúc duyệt). Việc khớp đúng 1 chỗ do plugin kiểm trên dữ liệu thật.
  const gate = checkEdits(p.edits, gateContext(rules, await pageData(env, t.case_id, t.target_url), await titleLookup(env, t.case_id), () => 1));
  if (!gate.ok) {
    await env.DB.prepare("UPDATE recovery_tasks SET status = 'blocked', gate = ?, updated_at = ? WHERE id = ?").bind(JSON.stringify(gate), now(), taskId).run();
    throw new HttpError(409, `Gác cổng chặn: ${gate.problems.filter((x) => x.level === "block").map((x) => x.message).join(" ")}`, "blocked");
  }
  const post = await wpGetPost(env, t.site_id, t.target_url);
  const content: WpEdit[] = [];
  const meta: Record<string, string> = {};
  for (const e of p.edits) {
    if (e.type === "meta_title") meta.rank_math_title = e.replace;
    else if (e.type === "meta_description") meta.rank_math_description = e.replace;
    else if (e.type === "insert") content.push({ find: e.find, insert: e.insert || e.replace.slice(e.find.length), mode: e.mode === "before_block" ? "before_block" : "after_block" });
    else content.push({ find: e.find, replace: e.replace, mode: "replace" });
  }
  // Thử trước (không ghi) để biết chắc mọi sửa đều khớp, rồi mới sao lưu và ghi thật
  await wpApply(env, t.site_id, { id: post.id, expected_modified: post.modified_gmt, edits: content, meta, dry_run: true });
  const b = await env.DB.prepare("INSERT INTO recovery_backups (task_id, site_id, post_id, url, content, elementor_data, meta, modified_gmt, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
    .bind(taskId, t.site_id, post.id, t.target_url, post.content, post.elementor_data, JSON.stringify(post.meta || {}), post.modified_gmt, user.id, now()).run();
  const backupId = Number(b.meta.last_row_id);
  const res = await wpApply(env, t.site_id, { id: post.id, expected_modified: post.modified_gmt, edits: content, meta });
  const applied = { backupId, at: now(), postId: post.id, changes: res.changes, meta: res.meta, elementor: res.elementor, purged: res.purged || [] };
  await env.DB.batch([
    env.DB.prepare("UPDATE recovery_backups SET applied = ? WHERE id = ?").bind(JSON.stringify({ edits: content, meta, result: res }), backupId),
    env.DB.prepare("UPDATE recovery_tasks SET status = 'done', payload = ?, gate = ?, updated_at = ? WHERE id = ?").bind(JSON.stringify({ ...p, applied }), JSON.stringify(gate), now(), taskId)
  ]);
  await logActivity(env, `user:${user.id}`, "recovery.applied", `Áp dụng lên site: ${t.title} (${res.changes} sửa${res.meta.length ? `, meta ${res.meta.join(", ")}` : ""}${res.purged?.length ? `, xoá cache ${res.purged.join(", ")}` : ""})`, t.site_id);
  return json({ ok: true, applied });
}

// POST /api/recovery/tasks/:id/rollback
export async function rollbackTask(env: Env, user: User, taskId: number): Promise<Response> {
  canEdit(user);
  const t = await taskRow(env, taskId);
  const b = await env.DB.prepare("SELECT * FROM recovery_backups WHERE task_id = ? AND restored_at IS NULL ORDER BY id DESC LIMIT 1").bind(taskId)
    .first<{ id: number; post_id: number; content: string | null; elementor_data: string | null; meta: string | null }>();
  if (!b) throw new HttpError(404, "Không có bản sao lưu nào để hoàn tác cho việc này.", "no_backup");
  const meta = JSON.parse(b.meta || "{}") as Record<string, unknown>;
  const r = await wpRestore(env, t.site_id, { id: b.post_id, content: b.elementor_data ? null : b.content, elementor_data: b.elementor_data, meta: { rank_math_title: meta.rank_math_title ?? "", rank_math_description: meta.rank_math_description ?? "", rank_math_focus_keyword: meta.rank_math_focus_keyword ?? "" } });
  const p = t.payload ? JSON.parse(t.payload) : {};
  delete p.applied;
  await env.DB.batch([
    env.DB.prepare("UPDATE recovery_backups SET restored_at = ?, restored_by = ? WHERE id = ?").bind(now(), user.id, b.id),
    env.DB.prepare("UPDATE recovery_tasks SET status = 'approved', payload = ?, updated_at = ? WHERE id = ?").bind(JSON.stringify(p), now(), taskId)
  ]);
  await logActivity(env, `user:${user.id}`, "recovery.rollback", `Hoàn tác: ${t.title}${r.purged?.length ? ` (xoá cache ${r.purged.join(", ")})` : ""}`, t.site_id);
  return json({ ok: true });
}

// ---------------- AI viết câu chèn link / CTA ----------------

// POST /api/recovery/tasks/:id/ai
export async function aiRewriteTask(env: Env, user: User, taskId: number): Promise<Response> {
  canEdit(user);
  const t = await taskRow(env, taskId);
  if (!["proposed", "blocked"].includes(t.status) || !["internal_links", "cta"].includes(t.kind) || !t.target_url) throw new HttpError(400, "Chỉ viết lại được việc chèn link/CTA đang chờ duyệt.", "validation");
  const rules = readRules(t.rules);
  const d = await pageData(env, t.case_id, t.target_url);
  const titleOf = await titleLookup(env, t.case_id);
  const p = JSON.parse(t.payload || "{}") as { edits: Edit[]; templateEdits?: Edit[] };
  const base = p.templateEdits || p.edits;
  const out: Edit[] = [];
  for (const e of base) {
    const isLink = e.type === "internal_link";
    const href = (e.replace.match(/href="([^"]+)"/) || [])[1] || e.target || "";
    const r = await aiJson<{ sentence?: string; anchor?: string }>(env, {
      task: `recovery.${t.kind}`, siteId: t.site_id, tier: "model_t1", maxTokens: 300,
      system: `You are a careful B2B copy editor adding ONE short sentence after an existing sentence on a live web page.\n${writingRules(rules.language, [...(d?.numbers || []), ...rules.verifiedNumbers], rules.blocklist)}`,
      user: JSON.stringify({
        page_title: d?.title, section_heading: e.section, existing_sentence: e.find,
        goal: isLink ? "Write one natural follow-up sentence that links to the target page. The anchor must describe the target page (use its main keyword or a close natural variant), 2–6 words, not generic." : "Write one short, friendly call-to-action sentence inviting the reader to contact the team. No promises, no numbers.",
        target_page: isLink ? { path: href, title: titleOf(href) } : { path: href, purpose: "contact" },
        avoid_anchors: base.filter((x) => x !== e).map((x) => x.anchor).filter(Boolean),
        output: { sentence: "the full new sentence", anchor: "exact substring of sentence to turn into the link" }
      })
    });
    const sentence = String(r.sentence || "").replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
    const anchor = String(r.anchor || "").replace(/<[^>]+>/g, "").trim();
    if (!sentence || !anchor || !sentence.includes(anchor) || sentence.length > 300) { out.push(e); continue; }
    const html = sentence.replace(anchor, `<a href="${href}">${anchor}</a>`);
    out.push({ ...e, replace: `${e.find} ${html}`, anchor: isLink ? anchor : e.anchor });
  }
  const gate = checkEdits(out, gateContext(rules, d, titleOf));
  await env.DB.prepare("UPDATE recovery_tasks SET payload = ?, gate = ?, status = ?, note = ?, updated_at = ? WHERE id = ?")
    .bind(JSON.stringify({ ...p, edits: out, templateEdits: base, ai: true }), JSON.stringify(gate), gate.ok ? "proposed" : "blocked", "AI viết lại câu chèn, đã qua Gác cổng", now(), taskId).run();
  await logActivity(env, `user:${user.id}`, "recovery.ai", `AI viết lại: ${t.title}${gate.ok ? "" : " (Gác cổng chặn)"}`, t.site_id);
  return json({ ok: true, gate });
}

// ---------------- GEO: đoạn trả lời trực tiếp + FAQ cho một trang ----------------

// POST /api/recovery/:id/geo { url }
export async function geoDraft(env: Env, req: Request, user: User, caseId: number): Promise<Response> {
  canEdit(user);
  const c = await getCaseRow(env, caseId);
  const body = await readJson(req);
  const url = str(body.url, "URL", { max: 500 });
  const d = await pageData(env, caseId, url);
  if (!d) throw new HttpError(404, "Trang này chưa được quét.", "not_found");
  const rules = readRules(c.rules);
  const secs = d.sections.filter((s) => s.firstSentence && s.firstOccurrences === 1).slice(0, 8);
  const last = [...d.sections].reverse().find((s) => s.lastSentence && s.occurrences === 1);
  if (!secs.length || !last) throw new HttpError(400, "Trang không có mục H2 với đoạn văn đủ rõ để chèn an toàn.", "validation");
  const r = await aiJson<{ answers?: { heading?: string; answer?: string }[]; faq_title?: string; faq?: { q?: string; a?: string }[] }>(env, {
    task: "recovery.geo", siteId: c.site_id, tier: "model_t1", maxTokens: 1400,
    system: `You improve pages so AI answer engines can cite them. You only ADD text, never change existing text.\n${writingRules(rules.language, [...d.numbers, ...rules.verifiedNumbers], rules.blocklist)}`,
    user: JSON.stringify({
      page_title: d.title, h1: d.h1[0],
      task: "For up to 3 of the sections below, write a direct answer (2–4 sentences) to the question the heading implies, based ONLY on the section text given. Then write 3–5 FAQ items a potential B2B customer would ask before hiring (commercial intent), answered only with what the page supports.",
      sections: secs.map((s) => ({ heading: s.heading, text: s.sample })),
      output: { answers: [{ heading: "exact heading from input", answer: "..." }], faq_title: "short FAQ heading", faq: [{ q: "...", a: "..." }] }
    })
  });
  const clean = (x: unknown) => String(x || "").replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
  const escHtml = (x: string) => x.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const edits: Edit[] = [];
  for (const a of (r.answers || []).slice(0, 3)) {
    const s = secs.find((x) => x.heading === clean(a.heading));
    const ans = clean(a.answer);
    if (!s || !ans) continue;
    const insert = `<p>${escHtml(ans)}</p>`;
    edits.push({ type: "insert", mode: "before_block", section: s.heading, find: s.firstSentence!, insert, replace: `${s.firstSentence} ${insert}` });
  }
  const faq = (r.faq || []).map((x) => ({ q: clean(x.q), a: clean(x.a) })).filter((x) => x.q && x.a).slice(0, 5);
  if (faq.length >= 3) {
    const insert = `<h2>${escHtml(clean(r.faq_title) || (rules.language === "de" ? "Häufige Fragen" : "Frequently asked questions"))}</h2>${faq.map((x) => `<h3>${escHtml(x.q)}</h3><p>${escHtml(x.a)}</p>`).join("")}`;
    edits.push({ type: "insert", mode: "after_block", section: last.heading, find: last.lastSentence, insert, replace: `${last.lastSentence} ${insert}` });
  }
  if (!edits.length) throw new HttpError(502, "AI không trả về nội dung dùng được. Thử lại.", "ai_empty");
  const gate = checkEdits(edits, gateContext(rules, d, await titleLookup(env, caseId)));
  const tNow = now();
  const path = new URL(url).pathname;
  await env.DB.prepare("DELETE FROM recovery_tasks WHERE case_id = ? AND kind = 'geo' AND target_url = ? AND status IN ('proposed', 'blocked')").bind(caseId, url).run();
  const ins = await env.DB.prepare("INSERT INTO recovery_tasks (case_id, agent, kind, title, detail, target_url, payload, risk, priority, status, gate, created_at, updated_at) VALUES (?, 'geo', 'geo', ?, ?, ?, ?, 'review', 62, ?, ?, ?, ?)")
    .bind(caseId, `GEO cho ${path}`, `${edits.filter((e) => e.mode === "before_block").length} đoạn trả lời trực tiếp${faq.length >= 3 ? ` + FAQ ${faq.length} câu` : ""}. Nội dung do AI soạn từ chính trang này: đọc kỹ trước khi duyệt.`, url,
      JSON.stringify({ edits, elementor: d.elementor, ai: true }), gate.ok ? "proposed" : "blocked", JSON.stringify(gate), tNow, tNow).run();
  await logActivity(env, `user:${user.id}`, "recovery.geo", `Soạn GEO cho ${path}${gate.ok ? "" : " (Gác cổng chặn)"}`, c.site_id);
  return json({ ok: true, taskId: Number(ins.meta.last_row_id), gate });
}
