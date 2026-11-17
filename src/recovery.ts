// Phục hồi thứ hạng: tạo ca, quét site theo lô (trong request bằng waitUntil, phần còn lại do cron), phân tích, lập việc, duyệt việc.

import { HttpError, json, now, readJson, str } from "./http";
import { logActivity } from "./activity";
import { analyze, disavowFile, plan, RECOVERY_AGENTS, type ScannedPage, type SiteChecks } from "./recovery-analyze";
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
  const a = analyze(pages, checks, rules, c.drop_month);
  const tasks = plan({ pages, analysis: a, rules, elementor: checks.elementor });
  const t = now();
  const kindStmts = pages.map((p) => env.DB.prepare("UPDATE recovery_pages SET kind = ? WHERE id = ?").bind(a.kinds.get(p.id) || null, p.id));
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
  return json({ cases: results.map((c) => ({ ...caseApi(c), openTasks: c.open_tasks })), agents: RECOVERY_AGENTS });
}

// GET /api/recovery/:id
export async function getCase(env: Env, id: number): Promise<Response> {
  const c = await getCaseRow(env, id);
  const [findings, tasks, pages] = await Promise.all([
    env.DB.prepare("SELECT * FROM recovery_findings WHERE case_id = ? ORDER BY CASE severity WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 WHEN 'low' THEN 3 ELSE 4 END, id").bind(id).all<Record<string, unknown>>(),
    env.DB.prepare("SELECT * FROM recovery_tasks WHERE case_id = ? ORDER BY CASE status WHEN 'blocked' THEN 1 WHEN 'proposed' THEN 0 WHEN 'approved' THEN 2 WHEN 'done' THEN 3 ELSE 4 END, priority, id").bind(id).all<Record<string, unknown>>(),
    env.DB.prepare("SELECT id, url, path, status, http_status, kind, data, error FROM recovery_pages WHERE case_id = ? ORDER BY path LIMIT 500").bind(id).all<{ id: number; url: string; path: string; status: string; http_status: number | null; kind: string | null; data: string | null; error: string | null }>()
  ]);
  const inbound = new Map<string, number>();
  const parsed = pages.results.map((p) => ({ ...p, d: p.data ? (JSON.parse(p.data) as PageData) : null }));
  for (const p of parsed) for (const l of p.d?.internalLinks || []) if (l !== p.path) inbound.set(l, (inbound.get(l) || 0) + 1);
  return json({
    case: { ...caseApi(c), diagnosis: c.diagnosis ? JSON.parse(c.diagnosis) : null, siteChecks: c.site_checks ? JSON.parse(c.site_checks) : null, rules: readRules(c.rules) },
    agents: RECOVERY_AGENTS,
    findings: findings.results.map((f) => ({ ...f, urls: JSON.parse(String(f.urls || "[]")) })),
    tasks: tasks.results.map((t) => ({ ...t, payload: t.payload ? JSON.parse(String(t.payload)) : null, gate: t.gate ? JSON.parse(String(t.gate)) : null })),
    pages: parsed.map((p) => ({
      id: p.id, url: p.url, path: p.path, status: p.status, httpStatus: p.http_status, kind: p.kind, error: p.error,
      title: p.d?.title || "", words: p.d?.words ?? null, inbound: inbound.get(p.path) || 0, outLinks: p.d?.internalLinks.length ?? 0,
      cta: p.d?.ctaFound ?? null, elementor: p.d?.elementor ?? null, noindex: p.d ? /noindex/.test(p.d.robots) : null, blockHits: p.d?.blockHits || []
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
