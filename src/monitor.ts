// Monitor: theo dõi traffic (Search Console hoặc tracker riêng), thứ hạng từ khoá (DataForSEO SERP), backlink (DataForSEO Backlinks)
// cho từng site. Khi tụt đột ngột: tự chẩn đoán (lỗi kỹ thuật, bản cập nhật Google, mất backlink, SERP đổi) và mở phương án.
// Không tự sửa gì trên site: việc sửa đi qua ca Phục hồi (Gác cổng, anh duyệt). Việc tự làm: kiểm tra, ghi nhận, báo, ping IndexNow sau khi lỗi hết.

import { logActivity } from "./activity";
import { backlinkChanges, backlinkSummary, rankCheck } from "./dataforseo";
import { gpost, hasGoogle } from "./google";
import { kindOf, mergeUpdates, type GoogleUpdate } from "./google-updates";
import { HttpError, json, now, readJson } from "./http";
import { submitUrls } from "./indexnow";
import { reclaimCore } from "./manual";
import { parseRules, readRules } from "./recovery-rules";
import { getSettingsMap, readSecret } from "./settings";
import type { Env, User } from "./types";

const DAY = 86400000;
const UA = "Mozilla/5.0 (compatible; DuyOiMonitor/1.0; +https://duyoi.duy.digital)";

interface SiteRow { id: number; name: string; domain: string; platform: string; market: string; language: string; status: string }
export interface MonSettings { gscProperty: string; autoKeywords: boolean; maxKeywords: number; rankEvery: number; backlinks: boolean; autoCase: boolean }
interface MonState { gscAt?: number; rankAt?: number; blAt?: number; detectAt?: number; gscError?: string | null; lastError?: string | null; source?: "gsc" | "tracker" | null }
interface PlanStep { text: string; auto: boolean; status: "done" | "waiting" | "todo" }
interface Alert { kind: string; severity: "critical" | "high" | "medium"; title: string; detail: Record<string, unknown>; plan: PlanStep[]; watch: boolean; recheckDays: number }

const canEdit = (u: User) => { if (u.role === "viewer") throw new HttpError(403, "Tài khoản chỉ xem.", "forbidden"); };
const parse = <T>(t: string | null | undefined, d: T): T => { try { return t ? (JSON.parse(t) as T) : d; } catch { return d; } };
const dayStr = (t: number) => new Date(t).toISOString().slice(0, 10);
const pct = (a: number, b: number) => (b > 0 ? Math.round(((a - b) / b) * 100) : 0);
const host = (d: string) => d.replace(/^www\./, "").toLowerCase();

// Gộp nhiều dòng vào ít câu lệnh (D1 giới hạn số câu mỗi lần chạy và 100 tham số mỗi câu)
function multiInsert(env: Env, head: string, cols: number, rows: unknown[][], tail = ""): ReturnType<Env["DB"]["prepare"]>[] {
  const per = Math.max(1, Math.floor(99 / cols)), out = [];
  for (let i = 0; i < rows.length; i += per) {
    const chunk = rows.slice(i, i + per);
    out.push(env.DB.prepare(`${head} VALUES ${chunk.map(() => `(${Array(cols).fill("?").join(", ")})`).join(", ")} ${tail}`).bind(...chunk.flat()));
  }
  return out;
}

async function siteOf(env: Env, id: number): Promise<SiteRow> {
  const s = await env.DB.prepare("SELECT id, name, domain, platform, market, language, status FROM sites WHERE id = ?").bind(id).first<SiteRow>();
  if (!s) throw new HttpError(404, "Không tìm thấy site.", "not_found");
  return s;
}

function cleanSettings(v: Partial<MonSettings>, s: SiteRow, gscDefault: string): MonSettings {
  const prop = String(v.gscProperty ?? "").trim().slice(0, 200);
  return {
    gscProperty: /^(sc-domain:[a-z0-9.-]+|https?:\/\/\S+)$/i.test(prop) ? prop : gscDefault || `sc-domain:${host(s.domain)}`,
    autoKeywords: v.autoKeywords !== false,
    maxKeywords: Math.min(100, Math.max(5, Number(v.maxKeywords) || 20)),
    rankEvery: Math.min(14, Math.max(1, Number(v.rankEvery) || 3)),
    backlinks: v.backlinks !== false,
    autoCase: v.autoCase !== false
  };
}

export async function readMon(env: Env, s: SiteRow): Promise<{ settings: MonSettings; state: MonState }> {
  const r = await env.DB.prepare("SELECT settings, state FROM mon_state WHERE site_id = ?").bind(s.id).first<{ settings: string; state: string }>();
  const c = await env.DB.prepare("SELECT rules FROM recovery_cases WHERE site_id = ? ORDER BY id DESC LIMIT 1").bind(s.id).first<{ rules: string }>();
  return { settings: cleanSettings(parse(r?.settings, {}), s, readRules(c?.rules).gscProperty || ""), state: parse(r?.state, {}) };
}

async function setState(env: Env, siteId: number, patch: Partial<MonState>): Promise<void> {
  const r = await env.DB.prepare("SELECT state FROM mon_state WHERE site_id = ?").bind(siteId).first<{ state: string }>();
  const st = { ...parse<MonState>(r?.state, {}), ...patch };
  await env.DB.prepare("INSERT INTO mon_state (site_id, state, updated_at) VALUES (?, ?, ?) ON CONFLICT(site_id) DO UPDATE SET state = excluded.state, updated_at = excluded.updated_at").bind(siteId, JSON.stringify(st), now()).run();
}

// ---------------- Bản cập nhật Google ----------------

// Đọc Google Search Status Dashboard (nguồn chính thức) mỗi ngày; lỗi thì dùng danh sách có sẵn
export async function syncGoogleUpdates(env: Env): Promise<number> {
  const last = await env.DB.prepare("SELECT MAX(updated_at) AS t FROM google_updates").first<{ t: number | null }>();
  if (last?.t && now() - last.t < DAY) return 0;
  type Inc = { external_desc?: string; begin?: string; end?: string | null; service_name?: string; affected_products?: { title?: string }[] };
  let list: Inc[] = [];
  try {
    const res = await fetch("https://status.search.google.com/incidents.json", { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(10000) });
    if (res.ok) list = (await res.json()) as Inc[];
  } catch { /* để lần sau */ }
  const t = now();
  const rows = (Array.isArray(list) ? list : []).filter((i) => i.begin && i.external_desc && /ranking/i.test(`${i.service_name || ""} ${(i.affected_products || []).map((p) => p.title).join(" ")}`) && /update/i.test(i.external_desc));
  const stmts = rows.slice(0, 40).map((i) => env.DB.prepare("INSERT INTO google_updates (name, kind, started, ended, note, updated_at) VALUES (?, ?, ?, ?, '', ?) ON CONFLICT(name) DO UPDATE SET ended = excluded.ended, updated_at = excluded.updated_at")
    .bind(i.external_desc!.slice(0, 120), kindOf(i.external_desc!), i.begin!.slice(0, 10), i.end ? i.end.slice(0, 10) : null, t));
  // Ghi một dòng mốc để không gọi lại trong ngày dù feed rỗng
  stmts.push(env.DB.prepare("INSERT INTO google_updates (name, kind, started, ended, note, updated_at) VALUES ('_sync', 'core', '1970-01-01', '1970-01-01', '', ?) ON CONFLICT(name) DO UPDATE SET updated_at = excluded.updated_at").bind(t));
  await env.DB.batch(stmts);
  return rows.length;
}

export async function allUpdates(env: Env): Promise<GoogleUpdate[]> {
  const r = await env.DB.prepare("SELECT name, kind, started AS start, ended AS end, note FROM google_updates WHERE name != '_sync'").all<GoogleUpdate>();
  return mergeUpdates(r.results.map((u) => ({ ...u, note: u.note || "Theo Google Search Status Dashboard." })));
}

// Bản cập nhật đang chạy hoặc vừa xong (trong 14 ngày) quanh lúc tụt
function updatesAround(list: GoogleUpdate[], dropStart: number): GoogleUpdate[] {
  return list.filter((u) => {
    const s = Date.parse(`${u.start}T00:00:00Z`), e = u.end ? Date.parse(`${u.end}T23:59:59Z`) : Date.now();
    return s <= Date.now() && e >= dropStart - 14 * DAY && s <= dropStart + 10 * DAY && u.kind !== "measurement";
  });
}

// ---------------- Search Console ----------------

type GRow = { keys: string[]; clicks: number; impressions: number; position: number };

async function gscQuery(env: Env, prop: string, start: number, end: number, dims: string[], rowLimit: number): Promise<GRow[]> {
  const url = `https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(prop)}/searchAnalytics/query`;
  const r = await gpost<{ rows?: GRow[] }>(env, url, { startDate: dayStr(start), endDate: dayStr(end), dimensions: dims, rowLimit, dataState: "all" });
  return r.rows || [];
}

export async function syncGsc(env: Env, s: SiteRow, settings: MonSettings): Promise<{ days: number; pages: number; queries: number }> {
  const end = Date.now() - 2 * DAY, t = now();
  const [daily, p7, p28, q7, q28] = await Promise.all([
    gscQuery(env, settings.gscProperty, end - 69 * DAY, end, ["date"], 100),
    gscQuery(env, settings.gscProperty, end - 6 * DAY, end, ["page"], 2000),
    gscQuery(env, settings.gscProperty, end - 34 * DAY, end - 7 * DAY, ["page"], 2000),
    gscQuery(env, settings.gscProperty, end - 6 * DAY, end, ["query", "page"], 1000),
    gscQuery(env, settings.gscProperty, end - 34 * DAY, end - 7 * DAY, ["query", "page"], 1000)
  ]);
  const stmts = multiInsert(env, "INSERT INTO mon_daily (site_id, day, clicks, impressions, position)", 5, daily.map((r) => [s.id, r.keys[0], r.clicks, r.impressions, +r.position.toFixed(1)]),
    "ON CONFLICT(site_id, day) DO UPDATE SET clicks = excluded.clicks, impressions = excluded.impressions, position = excluded.position");
  // Kỳ trước 28 ngày quy về 1 tuần để so cùng thang
  const prev = new Map(p28.map((r) => [r.keys[0]!, r]));
  const pages = new Map<string, { c7: number; cp: number; i7: number; ip: number; pos7: number | null; posp: number | null }>();
  for (const r of p7) { const q = prev.get(r.keys[0]!); pages.set(r.keys[0]!, { c7: r.clicks, cp: (q?.clicks || 0) / 4, i7: r.impressions, ip: (q?.impressions || 0) / 4, pos7: +r.position.toFixed(1), posp: q ? +q.position.toFixed(1) : null }); }
  for (const q of p28) if (!pages.has(q.keys[0]!)) pages.set(q.keys[0]!, { c7: 0, cp: q.clicks / 4, i7: 0, ip: q.impressions / 4, pos7: null, posp: +q.position.toFixed(1) });
  const topPages = [...pages.entries()].sort((a, b) => Math.max(b[1].cp, b[1].c7) - Math.max(a[1].cp, a[1].c7) || Math.max(b[1].ip, b[1].i7) - Math.max(a[1].ip, a[1].i7)).slice(0, 200);
  stmts.push(env.DB.prepare("DELETE FROM mon_pages WHERE site_id = ?").bind(s.id));
  stmts.push(...multiInsert(env, "INSERT INTO mon_pages (site_id, page, clicks7, clicks_prev, impr7, impr_prev, pos7, pos_prev, updated_at)", 9, topPages.map(([page, v]) => [s.id, page, v.c7, v.cp, v.i7, v.ip, v.pos7, v.posp, t])));
  const qprev = new Map(q28.map((r) => [`${r.keys[0]}\n${r.keys[1]}`, r]));
  const topQ = q7.sort((a, b) => b.impressions - a.impressions).slice(0, 200);
  stmts.push(env.DB.prepare("DELETE FROM mon_queries WHERE site_id = ?").bind(s.id));
  stmts.push(...multiInsert(env, "INSERT OR IGNORE INTO mon_queries (site_id, query, page, clicks7, clicks_prev, impr7, pos7, pos_prev, updated_at)", 9, topQ.map((r) => { const q = qprev.get(`${r.keys[0]}\n${r.keys[1]}`); return [s.id, r.keys[0], r.keys[1], r.clicks, (q?.clicks || 0) / 4, r.impressions, +r.position.toFixed(1), q ? +q.position.toFixed(1) : null, t]; })));
  await env.DB.batch(stmts);
  // Từ khoá theo dõi tự động: truy vấn mang click nhiều nhất 4 tuần qua
  if (settings.autoKeywords) {
    const have = await env.DB.prepare("SELECT COUNT(*) AS n FROM mon_keywords WHERE site_id = ? AND active = 1").bind(s.id).first<{ n: number }>();
    const room = settings.maxKeywords - (have?.n || 0);
    if (room > 0) {
      const byQ = new Map<string, number>();
      for (const r of [...q28, ...q7]) byQ.set(r.keys[0]!, (byQ.get(r.keys[0]!) || 0) + r.clicks);
      const picks = [...byQ.entries()].filter(([k, c]) => c >= 3 && k.length <= 80).sort((a, b) => b[1] - a[1]).slice(0, room * 2);
      const ins = multiInsert(env, "INSERT OR IGNORE INTO mon_keywords (site_id, keyword, source, created_at)", 4, picks.map(([k]) => [s.id, k.toLowerCase().trim(), "gsc", t]));
      if (ins.length) await env.DB.batch(ins);
      // Giữ đúng trần: tắt bớt các từ gsc mới thêm nếu vượt
      const now1 = await env.DB.prepare("SELECT COUNT(*) AS n FROM mon_keywords WHERE site_id = ? AND active = 1").bind(s.id).first<{ n: number }>();
      const over = (now1?.n || 0) - settings.maxKeywords;
      if (over > 0) await env.DB.prepare("UPDATE mon_keywords SET active = 0 WHERE id IN (SELECT id FROM mon_keywords WHERE site_id = ? AND active = 1 AND source = 'gsc' AND checked_at IS NULL ORDER BY id DESC LIMIT ?)").bind(s.id, over).run();
    }
  }
  return { days: daily.length, pages: topPages.length, queries: topQ.length };
}

// Từ khoá chưa có nguồn GSC: lấy từ bài đã đăng trong Content Studio
async function seedFromContent(env: Env, s: SiteRow, settings: MonSettings): Promise<void> {
  if (!settings.autoKeywords) return;
  const have = await env.DB.prepare("SELECT COUNT(*) AS n FROM mon_keywords WHERE site_id = ?").bind(s.id).first<{ n: number }>();
  if ((have?.n || 0) > 0) return;
  const r = await env.DB.prepare("SELECT keyword FROM content_ideas WHERE site_id = ? AND status = 'published' ORDER BY COALESCE(volume, 0) DESC LIMIT ?").bind(s.id, settings.maxKeywords).all<{ keyword: string }>();
  if (r.results.length) await env.DB.batch(r.results.map((k) => env.DB.prepare("INSERT OR IGNORE INTO mon_keywords (site_id, keyword, source, created_at) VALUES (?, ?, 'content', ?)").bind(s.id, k.keyword.toLowerCase().trim(), now())));
}

// ---------------- Thứ hạng ----------------

export async function rankRun(env: Env, s: SiteRow, settings: MonSettings, deadline: number, limit = 8): Promise<number> {
  const due = now() - settings.rankEvery * DAY + 3600000;
  const kws = (await env.DB.prepare("SELECT id, keyword, pos, best_pos FROM mon_keywords WHERE site_id = ? AND active = 1 AND (checked_at IS NULL OR checked_at < ?) ORDER BY checked_at IS NOT NULL, checked_at LIMIT ?").bind(s.id, due, limit).all<{ id: number; keyword: string; pos: number | null; best_pos: number | null }>()).results;
  let n = 0;
  for (const k of kws) {
    if (Date.now() > deadline) break;
    const r = await rankCheck(env, s.id, k.keyword, s.domain, s.market, s.language);
    const t = now();
    const best = r.pos == null ? k.best_pos : k.best_pos == null ? r.pos : Math.min(k.best_pos, r.pos);
    await env.DB.batch([
      env.DB.prepare("UPDATE mon_keywords SET prev_pos = pos, pos = ?, url = ?, best_pos = ?, features = ?, checked_at = ? WHERE id = ?").bind(r.pos, r.url, best, JSON.stringify({ top: r.top, features: r.features }), t, k.id),
      env.DB.prepare("INSERT INTO mon_rank_history (keyword_id, day, pos, url) VALUES (?, ?, ?, ?) ON CONFLICT(keyword_id, day) DO UPDATE SET pos = excluded.pos, url = excluded.url").bind(k.id, dayStr(t), r.pos, r.url)
    ]);
    n++;
  }
  return n;
}

// ---------------- Backlink ----------------

export async function backlinkRun(env: Env, s: SiteRow, actor: string): Promise<{ added: number; lost: number }> {
  const d = host(s.domain), t = now();
  const sum = await backlinkSummary(env, s.id, d);
  await env.DB.prepare("INSERT INTO mon_backlinks (site_id, day, backlinks, domains, rank, broken) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(site_id, day) DO UPDATE SET backlinks = excluded.backlinks, domains = excluded.domains, rank = excluded.rank, broken = excluded.broken")
    .bind(s.id, dayStr(t), sum.backlinks, sum.domains, sum.rank, sum.broken).run();
  const [fresh, lost] = await Promise.all([backlinkChanges(env, s.id, d, "new"), backlinkChanges(env, s.id, d, "lost")]);
  const ins = (kind: string, l: typeof fresh[number]) => env.DB.prepare("INSERT OR IGNORE INTO mon_bl_changes (site_id, kind, source_url, domain, target_url, anchor, dofollow, at_date, seen_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")
    .bind(s.id, kind, l.sourceUrl, l.domain, l.targetUrl, l.anchor, l.dofollow ? 1 : 0, l.date, t);
  const stmts = [...fresh.map((l) => ins("new", l)), ...lost.map((l) => ins("lost", l))];
  // Link dofollow mới tìm thấy: đưa vào Link Monitor để kiểm tra hằng tuần
  for (const l of fresh.filter((x) => x.dofollow)) stmts.push(env.DB.prepare("INSERT OR IGNORE INTO op_links (site_id, source_url, target_url, anchor, status, note, created_at) VALUES (?, ?, ?, ?, 'unchecked', 'Monitor tìm thấy', ?)").bind(s.id, l.sourceUrl, l.targetUrl, l.anchor, t));
  if (stmts.length) await env.DB.batch(stmts);
  // Link mất mà trang đích trên site đã 404: tạo việc chuyển hướng 301 (anh tự đặt) trong Link building làm tay
  const targets = [...new Set(lost.map((l) => l.targetUrl).filter((u) => { try { return host(new URL(u).hostname) === d; } catch { return false; } }))];
  if (targets.length) await reclaimCore(env, s.id, targets.join("\n"), actor).catch(() => null);
  await logActivity(env, actor, "monitor.backlinks", `${s.domain}: ${sum.domains} domain, ${sum.backlinks} backlink · ${fresh.length} mới · ${lost.length} mất gần đây`, s.id);
  return { added: fresh.length, lost: lost.length };
}

// ---------------- Kiểm tra kỹ thuật trang tụt ----------------

async function robotsRules(domain: string): Promise<string[]> {
  try {
    const res = await fetch(`https://${domain}/robots.txt`, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(8000) });
    if (!res.ok) return [];
    const out: string[] = [];
    let applies = false, lastWasAgent = false;
    for (const raw of (await res.text()).slice(0, 50000).split(/\r?\n/)) {
      const line = raw.replace(/#.*/, "").trim();
      const m = line.match(/^(user-agent|disallow)\s*:\s*(.*)$/i);
      if (!m) continue;
      if (m[1]!.toLowerCase() === "user-agent") { const a = m[2]!.toLowerCase(); applies = lastWasAgent ? applies || a === "*" || a === "googlebot" : a === "*" || a === "googlebot"; lastWasAgent = true; }
      else { lastWasAgent = false; if (applies && m[2]) out.push(m[2]); }
    }
    return out;
  } catch { return []; }
}

export async function techCheck(url: string, disallow: string[]): Promise<string | null> {
  let path = "/";
  try { path = new URL(url).pathname; } catch { return null; }
  // Chỉ xét Disallow dạng tiền tố đơn giản; mẫu có * hoặc $ bỏ qua để tránh báo nhầm
  const blocked = disallow.find((d) => !/[*$]/.test(d) && path.startsWith(d));
  if (blocked) return `robots.txt chặn (Disallow: ${blocked})`;
  let res: Response;
  try { res = await fetch(url, { headers: { "User-Agent": UA, Accept: "text/html" }, redirect: "manual", signal: AbortSignal.timeout(10000) }); }
  catch { return "Không mở được trang (timeout hoặc lỗi kết nối)"; }
  if (res.status >= 300 && res.status < 400) return `Chuyển hướng ${res.status} tới ${res.headers.get("location") || "?"}`;
  if (res.status >= 400) return `Lỗi HTTP ${res.status}`;
  if (/noindex/i.test(res.headers.get("x-robots-tag") || "")) return "Header X-Robots-Tag: noindex";
  const html = (await res.text().catch(() => "")).slice(0, 300000);
  const metas = html.match(/<meta[^>]+>/gi) || [];
  if (metas.some((m) => /name=["']?(robots|googlebot)["']?/i.test(m) && /noindex/i.test(m))) return "Thẻ meta robots noindex";
  const can = (html.match(/<link[^>]+rel=["']?canonical["']?[^>]*>/i)?.[0] || "").match(/href=["']([^"']+)["']/i)?.[1];
  if (can) {
    try {
      const a = new URL(can, url), b = new URL(url);
      if (host(a.hostname) !== host(b.hostname) || a.pathname.replace(/\/$/, "") !== b.pathname.replace(/\/$/, "")) return `Canonical trỏ sang ${a.href}`;
    } catch { /* bỏ qua */ }
  }
  return null;
}

// ---------------- Phát hiện tụt và chẩn đoán ----------------

interface Series { cur: number; base: number; source: "gsc" | "tracker"; impCur: number; impBase: number; start: number }

async function trafficSeries(env: Env, s: SiteRow): Promise<Series | null> {
  const g = (await env.DB.prepare("SELECT day, clicks, impressions FROM mon_daily WHERE site_id = ? ORDER BY day DESC LIMIT 35").bind(s.id).all<{ day: string; clicks: number; impressions: number }>()).results;
  if (g.length >= 21) {
    const cur = g.slice(0, 7), base = g.slice(7, 35);
    const sum = (a: typeof g, k: "clicks" | "impressions") => a.reduce((x, r) => x + r[k], 0);
    return { cur: sum(cur, "clicks"), base: (sum(base, "clicks") / base.length) * 7, impCur: sum(cur, "impressions"), impBase: (sum(base, "impressions") / base.length) * 7, source: "gsc", start: Date.parse(`${cur[cur.length - 1]!.day}T00:00:00Z`) };
  }
  // Không có Search Console: dùng lượt xem từ tracker của app (chỉ khi đã có ít nhất 3 tuần dữ liệu)
  const d = host(s.domain);
  const t = (await env.DB.prepare("SELECT day, SUM(visits) AS v FROM stats_daily WHERE domain IN (?, ?) AND day < ? GROUP BY day ORDER BY day DESC LIMIT 35").bind(d, `www.${d}`, dayStr(Date.now())).all<{ day: string; v: number }>()).results;
  if (t.length < 21) return null;
  const cur = t.slice(0, 7), base = t.slice(7, 35);
  const sum = (a: typeof t) => a.reduce((x, r) => x + (r.v || 0), 0);
  return { cur: sum(cur), base: (sum(base) / base.length) * 7, impCur: 0, impBase: 0, source: "tracker", start: Date.parse(`${cur[cur.length - 1]!.day}T00:00:00Z`) };
}

export async function detect(env: Env, s: SiteRow): Promise<Alert[]> {
  const alerts: Alert[] = [];
  const series = await trafficSeries(env, s);
  const updates = await allUpdates(env);
  const dropPages = (await env.DB.prepare("SELECT page, clicks7, clicks_prev, impr7, impr_prev, pos7, pos_prev FROM mon_pages WHERE site_id = ? AND clicks_prev >= 5 AND clicks7 <= clicks_prev * 0.5 ORDER BY (clicks_prev - clicks7) DESC LIMIT 15").bind(s.id).all<{ page: string; clicks7: number; clicks_prev: number; impr7: number; impr_prev: number; pos7: number | null; pos_prev: number | null }>()).results;
  const gone = (await env.DB.prepare("SELECT page, impr_prev FROM mon_pages WHERE site_id = ? AND impr_prev >= 100 AND impr7 = 0 ORDER BY impr_prev DESC LIMIT 20").bind(s.id).all<{ page: string; impr_prev: number }>()).results;
  const kwDrops = (await env.DB.prepare("SELECT keyword, pos, prev_pos, url, features FROM mon_keywords WHERE site_id = ? AND active = 1 AND prev_pos IS NOT NULL AND prev_pos <= 20 AND ((pos IS NULL) OR (prev_pos <= 10 AND pos > 10) OR (pos - prev_pos >= 5)) ORDER BY prev_pos LIMIT 30").bind(s.id).all<{ keyword: string; pos: number | null; prev_pos: number; url: string | null; features: string | null }>()).results;
  const top10 = await env.DB.prepare("SELECT COUNT(*) AS n FROM mon_keywords WHERE site_id = ? AND active = 1 AND prev_pos <= 10").bind(s.id).first<{ n: number }>();
  const qDrops = (await env.DB.prepare("SELECT query, page, pos7, pos_prev, impr7 FROM mon_queries WHERE site_id = ? AND pos_prev IS NOT NULL AND impr7 >= 50 AND pos7 - pos_prev >= 5 ORDER BY impr7 DESC LIMIT 15").bind(s.id).all<{ query: string; page: string; pos7: number; pos_prev: number; impr7: number }>()).results;

  const trafficChange = series && series.base >= 35 ? pct(series.cur, series.base) : null;
  const trafficDrop = trafficChange != null && trafficChange <= -30;
  const rankDrop = kwDrops.length >= 3 || (kwDrops.length >= 1 && (top10?.n || 0) > 0 && kwDrops.filter((k) => k.prev_pos <= 10).length / (top10?.n || 1) >= 0.3);

  if (trafficDrop || rankDrop || gone.length >= 3) {
    const dropStart = series?.start || Date.now() - 7 * DAY;
    const near = updatesAround(updates, dropStart);
    // Kiểm tra kỹ thuật: trang chủ + các trang tụt mạnh nhất
    const disallow = await robotsRules(s.domain);
    const urls = [...new Set([`https://${s.domain}/`, ...dropPages.map((p) => p.page), ...gone.map((p) => p.page), ...kwDrops.map((k) => k.url).filter((u): u is string => !!u)])].slice(0, 12);
    const tech: { url: string; problem: string }[] = [];
    for (const u of urls) { const p = await techCheck(u, disallow); if (p) tech.push({ url: u, problem: p }); }
    const lost = (await env.DB.prepare("SELECT source_url, domain, target_url, anchor, dofollow, at_date FROM mon_bl_changes WHERE site_id = ? AND kind = 'lost' AND seen_at > ? ORDER BY dofollow DESC, id DESC LIMIT 20").bind(s.id, now() - 35 * DAY).all<Record<string, unknown>>()).results;
    const dropUrls = new Set(dropPages.map((p) => p.page.replace(/\/$/, "")));
    const lostToDropped = lost.filter((l) => dropUrls.has(String(l.target_url).replace(/\/$/, "")));
    const serp = kwDrops.map((k) => ({ keyword: k.keyword, ...parse<{ top?: string[]; features?: string[] }>(k.features, {}) })).filter((k) => k.features?.includes("ai_overview"));
    const cannibal = (await env.DB.prepare("SELECT query, COUNT(DISTINCT page) AS n, GROUP_CONCAT(page, ' | ') AS pages FROM mon_queries WHERE site_id = ? AND impr7 >= 20 GROUP BY query HAVING n >= 2 ORDER BY SUM(impr7) DESC LIMIT 8").bind(s.id).all<{ query: string; n: number; pages: string }>()).results;
    const impOnly = series?.source === "gsc" && series.impBase > 0 && pct(series.impCur, series.impBase) <= -30 && (trafficChange ?? 0) > -15;

    const ongoing = near.filter((u) => !u.end || Date.parse(`${u.end}T00:00:00Z`) > Date.now() - 7 * DAY);
    const cause = tech.length ? "technical" : ongoing.length ? "update_rolling" : near.some((u) => u.kind === "spam") ? "spam_update" : near.length ? "core_update" : lostToDropped.length >= 2 ? "links" : serp.length ? "serp_change" : "unknown";
    const sev: Alert["severity"] = tech.some((x) => x.url === `https://${s.domain}/`) || (trafficChange ?? 0) <= -50 ? "critical" : trafficDrop || kwDrops.length >= 5 ? "high" : "medium";
    const plan: PlanStep[] = [];
    if (tech.length) {
      plan.push({ text: `Sửa ${tech.length} lỗi kỹ thuật (noindex, canonical, chuyển hướng, lỗi HTTP, robots.txt). Đổi canonical/redirect cần anh duyệt.`, auto: false, status: "todo" });
      plan.push({ text: "Kiểm tra lại mỗi ngày; khi hết lỗi tự gửi IndexNow cho các trang đó.", auto: true, status: "waiting" });
    }
    if (ongoing.length) plan.push({ text: `Google đang/vừa chạy ${ongoing.map((u) => u.name).join(", ")}: chưa sửa nội dung, theo dõi đến 7 ngày sau khi rollout xong rồi đánh giá lại.`, auto: true, status: "waiting" });
    if (!ongoing.length && !tech.length) plan.push({ text: "Mở ca Phục hồi: Bác sĩ SEO quét toàn site, xếp nguyên nhân, đề xuất sửa (nội dung, link nội bộ, meta, CTA) qua Gác cổng để anh duyệt.", auto: true, status: "todo" });
    if (near.some((u) => u.kind === "spam")) plan.push({ text: "Bản spam update: rà nội dung hàng loạt, trang mỏng, link chéo giữa các site của anh. Không tự disavow; chỉ lập file khi từng mua link hoặc có manual action.", auto: false, status: "todo" });
    if (lost.length) plan.push({ text: `${lost.length} backlink mất gần đây${lostToDropped.length ? ` (${lostToDropped.length} trỏ vào trang tụt)` : ""}: trang đích 404 đã có việc chuyển hướng trong Link building làm tay; link bị gỡ thì anh liên hệ chủ site nếu đáng.`, auto: false, status: "todo" });
    if (cannibal.length) plan.push({ text: `${cannibal.length} truy vấn có nhiều trang cùng tranh: ca Phục hồi đề xuất gộp hoặc phân lại ý định (anh quyết).`, auto: false, status: "todo" });
    if (serp.length) plan.push({ text: `${serp.length} từ khoá tụt có AI Overview: thêm đoạn trả lời trực tiếp, bảng, FAQ (agent GEO) để được trích dẫn.`, auto: false, status: "todo" });
    if (impOnly) plan.push({ text: "Chỉ impressions giảm, click giữ: có thể do Google đổi cách đo, chưa phải tụt thật.", auto: true, status: "done" });
    const what = [trafficDrop ? `traffic ${trafficChange}% (7 ngày so với 4 tuần trước, nguồn ${series!.source === "gsc" ? "Search Console" : "tracker"})` : "", rankDrop ? `${kwDrops.length} từ khoá tụt` : "", gone.length >= 3 ? `${gone.length} trang mất hết hiển thị` : ""].filter(Boolean).join(" · ");
    alerts.push({
      kind: "drop", severity: impOnly && !rankDrop && !gone.length ? "medium" : sev, title: `${s.domain}: ${what}`, plan, watch: !!ongoing.length && !tech.length,
      recheckDays: tech.length ? 1 : ongoing.length ? 3 : 7,
      detail: { cause, traffic: series ? { change: trafficChange, cur: Math.round(series.cur), base: Math.round(series.base), source: series.source } : null, pages: dropPages, gone, keywords: kwDrops.map((k) => ({ keyword: k.keyword, pos: k.pos, prev: k.prev_pos, url: k.url })), queries: qDrops, updates: near, tech, lost, cannibal, serp }
    });
  }

  // Mất backlink đáng kể giữa 2 lần đo
  const bl = (await env.DB.prepare("SELECT day, domains, backlinks FROM mon_backlinks WHERE site_id = ? ORDER BY day DESC LIMIT 2").bind(s.id).all<{ day: string; domains: number; backlinks: number }>()).results;
  const lostDf = await env.DB.prepare("SELECT COUNT(*) AS n FROM mon_bl_changes WHERE site_id = ? AND kind = 'lost' AND dofollow = 1 AND seen_at > ?").bind(s.id, now() - 8 * DAY).first<{ n: number }>();
  if ((bl.length === 2 && bl[1]!.domains >= 20 && bl[0]!.domains <= bl[1]!.domains * 0.9 && bl[1]!.domains - bl[0]!.domains >= 5) || (lostDf?.n || 0) >= 5) {
    alerts.push({
      kind: "backlinks", severity: "medium", watch: false, recheckDays: 7,
      title: `${s.domain}: ${bl.length === 2 ? `domain trỏ về ${bl[1]!.domains} → ${bl[0]!.domains}` : ""}${lostDf?.n ? ` · ${lostDf.n} link dofollow mất tuần này` : ""}`.replace(": ·", ":"),
      plan: [
        { text: "Trang đích 404 → việc chuyển hướng 301 trong Link building làm tay (anh tự đặt).", auto: true, status: "done" },
        { text: "Link dofollow mới đã đưa vào Link Monitor để theo dõi hằng tuần.", auto: true, status: "done" },
        { text: "Link bị gỡ từ trang còn sống: anh xem danh sách, liên hệ chủ site nếu link đáng giữ. Không mua lại link.", auto: false, status: "todo" }
      ],
      detail: { history: bl, lost: (await env.DB.prepare("SELECT source_url, domain, target_url, anchor, dofollow, at_date FROM mon_bl_changes WHERE site_id = ? AND kind = 'lost' AND seen_at > ? ORDER BY dofollow DESC, id DESC LIMIT 30").bind(s.id, now() - 8 * DAY).all()).results }
    });
  }
  return alerts;
}

// Mở ca Phục hồi để tận dụng quy trình quét → đề xuất → Gác cổng → anh duyệt
async function startCase(env: Env, s: SiteRow, settings: MonSettings, actor: string): Promise<number | null> {
  const recent = await env.DB.prepare("SELECT id FROM recovery_cases WHERE site_id = ? AND (status IN ('discovering', 'scanning', 'analyzing') OR created_at > ?) ORDER BY id DESC LIMIT 1").bind(s.id, now() - 14 * DAY).first<{ id: number }>();
  if (recent) return recent.id;
  const prev = await env.DB.prepare("SELECT rules FROM recovery_cases WHERE site_id = ? ORDER BY id DESC LIMIT 1").bind(s.id).first<{ rules: string }>();
  const base = prev ? readRules(prev.rules) : undefined;
  const rules = parseRules({ language: s.language, ...(base || {}), gscProperty: base?.gscProperty || settings.gscProperty }, base);
  const t = now();
  const r = await env.DB.prepare("INSERT INTO recovery_cases (site_id, drop_month, rules, created_by, created_at, updated_at) VALUES (?, ?, ?, NULL, ?, ?)").bind(s.id, dayStr(t).slice(0, 7), JSON.stringify(rules), t, t).run();
  const id = Number(r.meta.last_row_id);
  await logActivity(env, actor, "recovery.created", `Monitor mở ca chẩn đoán ${s.domain} vì tụt đột ngột`, s.id);
  return id;
}

// Ghi cảnh báo (mỗi loại một cảnh báo mở mỗi site) và chạy phương án tự động
export async function handleAlerts(env: Env, s: SiteRow, settings: MonSettings, found: Alert[], actor: string): Promise<number> {
  const t = now();
  let opened = 0;
  for (const a of found) {
    const open = await env.DB.prepare("SELECT id, status, plan FROM mon_alerts WHERE site_id = ? AND kind = ? AND status IN ('open', 'watching') ORDER BY id DESC LIMIT 1").bind(s.id, a.kind).first<{ id: number; status: string; plan: string }>();
    // Ca phục hồi: chỉ mở khi không còn lỗi kỹ thuật và không có bản cập nhật đang chạy
    const caseStep = a.plan.find((p) => p.text.startsWith("Mở ca Phục hồi"));
    if (caseStep && settings.autoCase) {
      const id = await startCase(env, s, settings, actor);
      if (id) { caseStep.status = "done"; caseStep.text += ` (ca #${id})`; }
    } else if (caseStep) caseStep.auto = false;
    const status = a.watch ? "watching" : "open";
    if (open) {
      await env.DB.prepare("UPDATE mon_alerts SET severity = ?, title = ?, detail = ?, plan = ?, status = ?, recheck_at = ?, updated_at = ? WHERE id = ?").bind(a.severity, a.title, JSON.stringify(a.detail), JSON.stringify(a.plan), status, t + a.recheckDays * DAY, t, open.id).run();
    } else {
      await env.DB.prepare("INSERT INTO mon_alerts (site_id, kind, severity, title, detail, plan, status, recheck_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").bind(s.id, a.kind, a.severity, a.title, JSON.stringify(a.detail), JSON.stringify(a.plan), status, t + a.recheckDays * DAY, t, t).run();
      await logActivity(env, actor, "monitor.alert", a.title, s.id);
      opened++;
    }
  }
  // Cảnh báo cũ không còn tín hiệu: lỗi kỹ thuật đã hết thì ping IndexNow, rồi đóng
  const kinds = new Set(found.map((a) => a.kind));
  const stale = (await env.DB.prepare("SELECT id, kind, detail FROM mon_alerts WHERE site_id = ? AND status IN ('open', 'watching')").bind(s.id).all<{ id: number; kind: string; detail: string }>()).results.filter((r) => !kinds.has(r.kind));
  for (const r of stale) {
    const tech = parse<{ tech?: { url: string }[] }>(r.detail, {}).tech || [];
    if (tech.length) await submitUrls(env, s.id, tech.map((x) => x.url), "monitor.fixed").catch(() => null);
    await env.DB.prepare("UPDATE mon_alerts SET status = 'resolved', updated_at = ? WHERE id = ?").bind(t, r.id).run();
    await logActivity(env, actor, "monitor.resolved", `${s.domain}: tín hiệu ${r.kind === "drop" ? "tụt" : "mất backlink"} đã hết`, s.id);
  }
  return opened;
}

// ---------------- Cron ----------------

export async function runMonitor(env: Env, deadline: number): Promise<void> {
  const st = await getSettingsMap(env);
  if (st.paused) return;
  await syncGoogleUpdates(env).catch((e) => console.error("google updates", (e as Error).message));
  const google = await hasGoogle(env);
  const dfs = !!(await readSecret(env, "dataforseo_login"));
  const sites = (await env.DB.prepare("SELECT id, name, domain, platform, market, language, status FROM sites WHERE status = 'active' ORDER BY id").all<SiteRow>()).results;
  let gscRuns = 0;
  for (const s of sites) {
    if (Date.now() > deadline) return;
    const { settings, state } = await readMon(env, s);
    const due = (at: number | undefined, every: number) => !at || now() - at > every;
    let changed = false;
    try {
      // Tối đa 3 site đọc Search Console mỗi lượt cron (giới hạn số câu lệnh D1 mỗi lần chạy)
      if (google && gscRuns < 3 && due(state.gscAt, 20 * 3600000)) {
        gscRuns++;
        try { const g = await syncGsc(env, s, settings); await setState(env, s.id, { gscAt: now(), gscError: null, source: "gsc" }); await logActivity(env, "agent:rank_tracker", "monitor.gsc", `${s.domain}: Search Console ${g.days} ngày, ${g.pages} trang, ${g.queries} truy vấn`, s.id); }
        catch (e) { await setState(env, s.id, { gscAt: now(), gscError: (e as Error).message.slice(0, 200) }); }
        changed = true;
      }
      if (Date.now() > deadline) return;
      if (dfs) {
        await seedFromContent(env, s, settings);
        const n = await rankRun(env, s, settings, deadline);
        if (n) { await setState(env, s.id, { rankAt: now() }); await logActivity(env, "agent:rank_tracker", "monitor.rank", `${s.domain}: kiểm vị trí ${n} từ khoá`, s.id); changed = true; }
        if (settings.backlinks && due(state.blAt, 7 * DAY) && Date.now() < deadline) { await backlinkRun(env, s, "agent:backlink_watch"); await setState(env, s.id, { blAt: now() }); changed = true; }
      }
      const recheck = await env.DB.prepare("SELECT id FROM mon_alerts WHERE site_id = ? AND status IN ('open', 'watching') AND recheck_at < ? LIMIT 1").bind(s.id, now()).first();
      if ((changed || recheck || due(state.detectAt, DAY)) && Date.now() < deadline) {
        await handleAlerts(env, s, settings, await detect(env, s), "agent:drop_doctor");
        await setState(env, s.id, { detectAt: now() });
      }
      if (state.lastError) await setState(env, s.id, { lastError: null });
    } catch (e) {
      const msg = (e as Error).message.slice(0, 300);
      if (state.lastError !== msg) await logActivity(env, "agent:monitor", "monitor.error", `${s.domain}: ${msg}`, s.id);
      await setState(env, s.id, { lastError: msg, blAt: state.blAt && !due(state.blAt, 7 * DAY) ? state.blAt : now(), rankAt: now() });
    }
  }
}

// ---------------- API ----------------

export async function apiMonitorList(env: Env): Promise<Response> {
  const sites = (await env.DB.prepare("SELECT id, name, domain, platform, market, language, status FROM sites WHERE status != 'archived' ORDER BY id").all<SiteRow>()).results;
  const out = [];
  for (const s of sites) {
    const series = await trafficSeries(env, s);
    const c = await env.DB.prepare(`SELECT (SELECT COUNT(*) FROM mon_keywords WHERE site_id = ?1 AND active = 1) AS keywords, (SELECT COUNT(*) FROM mon_keywords WHERE site_id = ?1 AND active = 1 AND pos <= 10) AS top10,
      (SELECT COUNT(*) FROM mon_keywords WHERE site_id = ?1 AND active = 1 AND pos <= 3) AS top3, (SELECT domains FROM mon_backlinks WHERE site_id = ?1 ORDER BY day DESC LIMIT 1) AS refDomains,
      (SELECT COUNT(*) FROM mon_alerts WHERE site_id = ?1 AND status = 'open') AS alerts, (SELECT COUNT(*) FROM mon_alerts WHERE site_id = ?1 AND status = 'watching') AS watching`).bind(s.id).first<Record<string, number | null>>();
    out.push({ id: s.id, name: s.name, domain: s.domain, traffic: series ? { cur: Math.round(series.cur), base: Math.round(series.base), change: series.base >= 1 ? pct(series.cur, series.base) : null, source: series.source } : null, ...c });
  }
  const google = await hasGoogle(env), dfs = !!(await readSecret(env, "dataforseo_login"));
  const live = (await allUpdates(env)).filter((u) => !u.end || Date.parse(`${u.end}T00:00:00Z`) > Date.now() - 14 * DAY);
  return json({ sites: out, google, dataforseo: dfs, updates: live });
}

export async function apiMonitorView(env: Env, siteId: number): Promise<Response> {
  const s = await siteOf(env, siteId);
  const { settings, state } = await readMon(env, s);
  const q = <T>(sql: string, ...b: unknown[]) => env.DB.prepare(sql).bind(...b).all<T>().then((r) => r.results);
  const [daily, pages, gains, queries, keywords, bl, changes, alerts] = await Promise.all([
    q("SELECT day, clicks, impressions, position FROM mon_daily WHERE site_id = ? ORDER BY day DESC LIMIT 70", siteId),
    q("SELECT page, clicks7, clicks_prev, impr7, impr_prev, pos7, pos_prev FROM mon_pages WHERE site_id = ? ORDER BY (clicks_prev - clicks7) DESC LIMIT 15", siteId),
    q("SELECT page, clicks7, clicks_prev, pos7, pos_prev FROM mon_pages WHERE site_id = ? AND clicks7 > clicks_prev ORDER BY (clicks7 - clicks_prev) DESC LIMIT 10", siteId),
    q("SELECT query, page, clicks7, clicks_prev, impr7, pos7, pos_prev FROM mon_queries WHERE site_id = ? ORDER BY impr7 DESC LIMIT 60", siteId),
    q<{ id: number; features: string | null }>("SELECT id, keyword, source, pos, prev_pos, best_pos, url, features, checked_at, active FROM mon_keywords WHERE site_id = ? ORDER BY active DESC, COALESCE(pos, 999), keyword LIMIT 200", siteId),
    q("SELECT day, backlinks, domains, rank, broken FROM mon_backlinks WHERE site_id = ? ORDER BY day DESC LIMIT 12", siteId),
    q("SELECT kind, source_url, domain, target_url, anchor, dofollow, at_date FROM mon_bl_changes WHERE site_id = ? ORDER BY seen_at DESC, id DESC LIMIT 60", siteId),
    q<{ detail: string; plan: string }>("SELECT * FROM mon_alerts WHERE site_id = ? ORDER BY CASE status WHEN 'open' THEN 0 WHEN 'watching' THEN 1 ELSE 2 END, id DESC LIMIT 20", siteId)
  ]);
  const hist = await q<{ keyword_id: number; day: string; pos: number | null }>("SELECT h.keyword_id, h.day, h.pos FROM mon_rank_history h JOIN mon_keywords k ON k.id = h.keyword_id WHERE k.site_id = ? AND h.day >= ? ORDER BY h.day", siteId, dayStr(Date.now() - 60 * DAY));
  const byKw = new Map<number, (number | null)[]>();
  for (const h of hist) byKw.set(h.keyword_id, [...(byKw.get(h.keyword_id) || []), h.pos]);
  const series = await trafficSeries(env, s);
  return json({
    site: { id: s.id, name: s.name, domain: s.domain, market: s.market, language: s.language }, settings, state,
    google: await hasGoogle(env), dataforseo: !!(await readSecret(env, "dataforseo_login")),
    traffic: series ? { cur: Math.round(series.cur), base: Math.round(series.base), change: series.base >= 1 ? pct(series.cur, series.base) : null, source: series.source } : null,
    daily: daily.reverse(), pages, gains, queries,
    keywords: keywords.map((k) => ({ ...k, features: parse(k.features, {}), history: byKw.get(k.id) || [] })),
    backlinks: bl.reverse(), changes,
    alerts: alerts.map((a) => ({ ...a, detail: parse(a.detail, {}), plan: parse(a.plan, []) }))
  });
}

export async function apiMonitorSettings(env: Env, req: Request, user: User, siteId: number): Promise<Response> {
  canEdit(user);
  const s = await siteOf(env, siteId);
  const body = await readJson(req);
  const prop = String(body.gscProperty ?? "").trim();
  if (prop && !/^(sc-domain:[a-z0-9.-]+|https?:\/\/\S+)$/i.test(prop)) throw new HttpError(400, "Property dạng sc-domain:ten-mien.com hoặc https://ten-mien.com/.", "validation");
  const settings = cleanSettings(body as Partial<MonSettings>, s, "");
  await env.DB.prepare("INSERT INTO mon_state (site_id, settings, updated_at) VALUES (?, ?, ?) ON CONFLICT(site_id) DO UPDATE SET settings = excluded.settings, updated_at = excluded.updated_at").bind(siteId, JSON.stringify(settings), now()).run();
  await logActivity(env, `user:${user.id}`, "monitor.settings", `Cập nhật theo dõi ${s.domain}`, siteId);
  return json({ settings });
}

export async function apiMonitorKeywords(env: Env, req: Request, user: User, siteId: number): Promise<Response> {
  canEdit(user);
  const s = await siteOf(env, siteId);
  const { settings } = await readMon(env, s);
  const body = await readJson(req);
  const list = [...new Set(String(body.keywords ?? "").split(/[\n,]/).map((k) => k.trim().toLowerCase()).filter((k) => k.length >= 2 && k.length <= 80))];
  if (!list.length) throw new HttpError(400, "Nhập ít nhất một từ khoá.", "validation");
  const have = await env.DB.prepare("SELECT COUNT(*) AS n FROM mon_keywords WHERE site_id = ? AND active = 1").bind(siteId).first<{ n: number }>();
  const room = settings.maxKeywords - (have?.n || 0);
  if (room <= 0) throw new HttpError(400, `Đã đủ ${settings.maxKeywords} từ khoá. Tăng trần trong Cài đặt theo dõi hoặc tắt bớt.`, "limit");
  const t = now();
  const res = await env.DB.batch(list.slice(0, room).map((k) => env.DB.prepare("INSERT INTO mon_keywords (site_id, keyword, source, created_at) VALUES (?, ?, 'manual', ?) ON CONFLICT(site_id, keyword) DO UPDATE SET active = 1, source = 'manual'").bind(siteId, k, t)));
  await logActivity(env, `user:${user.id}`, "monitor.keywords", `Thêm ${res.length} từ khoá theo dõi cho ${s.domain}`, siteId);
  return json({ added: res.length, skipped: list.length - res.length });
}

export async function apiMonitorKeyword(env: Env, req: Request, user: User, id: number): Promise<Response> {
  canEdit(user);
  const body = await readJson(req);
  const r = await env.DB.prepare("UPDATE mon_keywords SET active = ? WHERE id = ?").bind(body.active ? 1 : 0, id).run();
  if (!r.meta.changes) throw new HttpError(404, "Không tìm thấy từ khoá.", "not_found");
  return json({ ok: true });
}

export async function apiMonitorAlert(env: Env, req: Request, user: User, id: number): Promise<Response> {
  canEdit(user);
  const body = await readJson(req);
  const status = String(body.status || "");
  if (!["open", "resolved", "dismissed"].includes(status)) throw new HttpError(400, "Trạng thái không hợp lệ.", "validation");
  const a = await env.DB.prepare("SELECT site_id, title FROM mon_alerts WHERE id = ?").bind(id).first<{ site_id: number; title: string }>();
  if (!a) throw new HttpError(404, "Không tìm thấy cảnh báo.", "not_found");
  await env.DB.prepare("UPDATE mon_alerts SET status = ?, updated_at = ? WHERE id = ?").bind(status, now(), id).run();
  await logActivity(env, `user:${user.id}`, `monitor.alert_${status}`, a.title, a.site_id);
  return json({ ok: true });
}

// POST /api/monitor/:id/run { what: gsc | rank | backlinks | check }
export async function apiMonitorRun(env: Env, req: Request, user: User, siteId: number): Promise<Response> {
  canEdit(user);
  const s = await siteOf(env, siteId);
  const { settings } = await readMon(env, s);
  const what = String((await readJson(req)).what || "check");
  const actor = `user:${user.id}`;
  if (what === "gsc") {
    if (!(await hasGoogle(env))) throw new HttpError(400, "Chưa có Google service account trong Cài đặt.", "no_google");
    try { const r = await syncGsc(env, s, settings); await setState(env, s.id, { gscAt: now(), gscError: null, source: "gsc" }); return json(r); }
    catch (e) { await setState(env, s.id, { gscError: (e as Error).message.slice(0, 200) }); throw new HttpError(502, `Search Console (${settings.gscProperty}): ${(e as Error).message}. Thêm email service account vào property với quyền xem.`, "gsc_error"); }
  }
  if (what === "rank") { await seedFromContent(env, s, settings); const n = await rankRun(env, s, settings, Date.now() + 25000, 15); await setState(env, s.id, { rankAt: now() }); return json({ checked: n }); }
  if (what === "backlinks") { const r = await backlinkRun(env, s, actor); await setState(env, s.id, { blAt: now() }); return json(r); }
  if (what === "check") { await syncGoogleUpdates(env).catch(() => 0); const found = await detect(env, s); const opened = await handleAlerts(env, s, settings, found, actor); await setState(env, s.id, { detectAt: now() }); return json({ alerts: found.length, opened }); }
  throw new HttpError(400, "Việc không hợp lệ.", "validation");
}

// Cho HQ: cảnh báo đang mở
export async function monitorAsks(env: Env): Promise<{ kind: string; siteId: number; domain: string; text: string }[]> {
  const r = await env.DB.prepare("SELECT a.site_id, s.domain, a.title, a.status, a.severity FROM mon_alerts a JOIN sites s ON s.id = a.site_id WHERE a.status IN ('open', 'watching') ORDER BY CASE a.severity WHEN 'critical' THEN 0 WHEN 'high' THEN 1 ELSE 2 END LIMIT 10").all<{ site_id: number; domain: string; title: string; status: string; severity: string }>();
  return r.results.map((a) => ({ kind: a.status === "watching" ? "watch" : "alert", siteId: a.site_id, domain: a.domain, text: `${a.status === "watching" ? "Đang theo dõi" : a.severity === "critical" ? "Khẩn" : "Cần xem"}: ${a.title.replace(`${a.domain}: `, "")}` }));
}
