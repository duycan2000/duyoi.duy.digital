// Báo cáo tuần qua email: mỗi site click, từ khoá lên/xuống, backlink mới/mất, cảnh báo, việc chờ anh duyệt; kèm lỗi kết nối.
// Gửi qua Cloudflare Email Service (binding EMAIL). Người nhận do anh tự nhập; mặc định tắt.

import { logActivity } from "./activity";
import { healthSummary } from "./health";
import { HttpError, json, now, readJson } from "./http";
import { PROMPTS, promptApproved } from "./manager";
import { quickWinCounts } from "./quickwins";
import { getSettingsMap } from "./settings";
import type { Env, User } from "./types";

const DAY = 86400000;
const APP_URL = "https://duyoi.duy.digital";
export interface ReportSettings { enabled: boolean; to: string[]; from: string; weekday: number; hour: number }
const DEFAULT: ReportSettings = { enabled: false, to: [], from: "", weekday: 1, hour: 8 };
const EMAIL_RE = /^[^\s@<>"]+@[a-z0-9.-]+\.[a-z]{2,}$/i;

export async function readReportSettings(env: Env): Promise<ReportSettings> {
  const r = await env.DB.prepare("SELECT value FROM settings WHERE key = 'report'").first<{ value: string }>();
  try { return { ...DEFAULT, ...(r ? JSON.parse(r.value) : {}) }; } catch { return DEFAULT; }
}

const esc = (s: unknown) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const pct = (a: number, b: number) => (b > 0 ? Math.round(((a - b) / b) * 100) : null);
const dayStr = (t: number) => new Date(t).toISOString().slice(0, 10);

interface SiteReport {
  id: number; domain: string; source: "gsc" | "tracker" | null; cur: number; prev: number; change: number | null;
  up: { keyword: string; from: number | null; to: number | null }[]; down: { keyword: string; from: number | null; to: number | null }[];
  blNew: number; blLost: number; domains: number | null; alerts: { title: string; severity: string; status: string }[];
  waiting: { drafts: number; tasks: number; emails: number; quickwins: number };
  quick: { open: number; approved: number; applied30: number }; semantic: number | null;
}

async function siteReport(env: Env, s: { id: number; domain: string }): Promise<SiteReport> {
  const t = now();
  // Click 7 ngày so với 7 ngày trước (Search Console); không có thì lượt xem tracker
  const g = (await env.DB.prepare("SELECT day, clicks FROM mon_daily WHERE site_id = ? ORDER BY day DESC LIMIT 14").bind(s.id).all<{ day: string; clicks: number }>()).results;
  let source: SiteReport["source"] = null, cur = 0, prev = 0;
  if (g.length >= 14) { source = "gsc"; cur = g.slice(0, 7).reduce((a, r) => a + r.clicks, 0); prev = g.slice(7).reduce((a, r) => a + r.clicks, 0); }
  else {
    const d = s.domain.replace(/^www\./, "");
    const v = (await env.DB.prepare("SELECT day, SUM(visits) AS v FROM stats_daily WHERE domain IN (?, ?) AND day < ? GROUP BY day ORDER BY day DESC LIMIT 14").bind(d, `www.${d}`, dayStr(t)).all<{ day: string; v: number }>()).results;
    if (v.length >= 14) { source = "tracker"; cur = v.slice(0, 7).reduce((a, r) => a + (r.v || 0), 0); prev = v.slice(7).reduce((a, r) => a + (r.v || 0), 0); }
  }
  // Từ khoá: vị trí mới nhất so với lần đo cách đây ≥ 6 ngày
  const hist = (await env.DB.prepare("SELECT k.keyword, h.day, h.pos FROM mon_rank_history h JOIN mon_keywords k ON k.id = h.keyword_id WHERE k.site_id = ? AND k.active = 1 AND h.day >= ? ORDER BY h.day").bind(s.id, dayStr(t - 21 * DAY)).all<{ keyword: string; day: string; pos: number | null }>()).results;
  const byKw = new Map<string, { day: string; pos: number | null }[]>();
  for (const h of hist) byKw.set(h.keyword, [...(byKw.get(h.keyword) || []), h]);
  const moves: { keyword: string; from: number | null; to: number | null; d: number }[] = [];
  for (const [kw, list] of byKw) {
    const last = list[list.length - 1]!;
    const old = [...list].reverse().find((x) => Date.parse(last.day) - Date.parse(x.day) >= 6 * DAY);
    if (!old) continue;
    const a = old.pos ?? 31, b = last.pos ?? 31;
    if (a !== b && (a <= 30 || b <= 30)) moves.push({ keyword: kw, from: old.pos, to: last.pos, d: a - b });
  }
  const bl = await env.DB.prepare("SELECT SUM(kind = 'new') AS n, SUM(kind = 'lost') AS l FROM mon_bl_changes WHERE site_id = ? AND seen_at > ?").bind(s.id, t - 7 * DAY).first<{ n: number | null; l: number | null }>();
  const dom = await env.DB.prepare("SELECT domains FROM mon_backlinks WHERE site_id = ? ORDER BY day DESC LIMIT 1").bind(s.id).first<{ domains: number }>();
  const alerts = (await env.DB.prepare("SELECT title, severity, status FROM mon_alerts WHERE site_id = ? AND status IN ('open', 'watching') ORDER BY id DESC LIMIT 5").bind(s.id).all<{ title: string; severity: string; status: string }>()).results;
  const w = await env.DB.prepare(`SELECT (SELECT COUNT(*) FROM content_ideas WHERE site_id = ?1 AND status = 'drafted') AS drafts,
    (SELECT COUNT(*) FROM recovery_tasks t JOIN recovery_cases c ON c.id = t.case_id WHERE c.site_id = ?1 AND t.status = 'proposed') AS tasks,
    (SELECT COUNT(*) FROM op_messages WHERE site_id = ?1 AND status IN ('ready', 'needs_fix')) AS emails,
    (SELECT score FROM sem_audits WHERE site_id = ?1 ORDER BY id DESC LIMIT 1) AS semantic`).bind(s.id).first<{ drafts: number; tasks: number; emails: number; semantic: number | null }>();
  const quick = await quickWinCounts(env, s.id);
  return {
    id: s.id, domain: s.domain, source, cur, prev, change: source ? pct(cur, prev) : null,
    up: moves.filter((m) => m.d > 0).sort((a, b) => b.d - a.d).slice(0, 5).map(({ keyword, from, to }) => ({ keyword, from, to })),
    down: moves.filter((m) => m.d < 0).sort((a, b) => a.d - b.d).slice(0, 5).map(({ keyword, from, to }) => ({ keyword, from, to })),
    blNew: bl?.n || 0, blLost: bl?.l || 0, domains: dom?.domains ?? null, alerts,
    waiting: { drafts: w?.drafts || 0, tasks: w?.tasks || 0, emails: w?.emails || 0, quickwins: quick.open }, quick, semantic: w?.semantic ?? null
  };
}

export async function buildReport(env: Env): Promise<{ subject: string; html: string; text: string; sites: SiteReport[] }> {
  const sites = (await env.DB.prepare("SELECT id, domain FROM sites WHERE status = 'active' ORDER BY id").all<{ id: number; domain: string }>()).results;
  const reports: SiteReport[] = [];
  for (const s of sites) reports.push(await siteReport(env, s));
  const health = await healthSummary(env);
  const prompts = (await Promise.all(PROMPTS.map(async (p) => (await promptApproved(env, p)).ok))).filter((ok) => !ok).length;
  const totalCur = reports.reduce((a, r) => a + (r.source === "gsc" ? r.cur : 0), 0), totalPrev = reports.reduce((a, r) => a + (r.source === "gsc" ? r.prev : 0), 0);
  const alertN = reports.reduce((a, r) => a + r.alerts.length, 0);
  const waitN = reports.reduce((a, r) => a + r.waiting.drafts + r.waiting.tasks + r.waiting.emails + r.quick.approved, 0) + prompts;
  const tch = pct(totalCur, totalPrev);
  const subject = `Duy Ơi tuần ${dayStr(now())}: ${totalPrev || totalCur ? `click ${tch == null ? "" : `${tch > 0 ? "+" : ""}${tch}% · `}` : ""}${alertN ? `${alertN} cảnh báo · ` : ""}${waitN} việc chờ anh${health.fail ? ` · ${health.fail} lỗi kết nối` : ""}`;

  const pos = (p: number | null) => (p == null ? "ngoài top 30" : String(p));
  const chg = (c: number | null) => (c == null ? "" : `<span style="color:${c <= -20 ? "#d64545" : c >= 10 ? "#2e9e5b" : "#666"}">${c > 0 ? "+" : ""}${c}%</span>`);
  const block = (r: SiteReport) => `
    <tr><td style="padding:16px 0 4px;border-top:1px solid #eee"><a href="${APP_URL}/#/rankings/${r.id}" style="font-size:17px;font-weight:600;color:#5b3fd1;text-decoration:none">${esc(r.domain)}</a></td></tr>
    <tr><td style="font-size:14px;line-height:1.6;color:#222">
      ${r.source ? `${r.source === "gsc" ? "Click từ Google" : "Lượt xem (bộ đo riêng)"}: <b>${r.cur}</b> (tuần trước ${r.prev}) ${chg(r.change)}<br>` : "Chưa có số liệu traffic.<br>"}
      ${r.up.length ? `Lên: ${r.up.map((m) => `${esc(m.keyword)} ${pos(m.from)}→${pos(m.to)}`).join(", ")}<br>` : ""}
      ${r.down.length ? `Xuống: ${r.down.map((m) => `${esc(m.keyword)} ${pos(m.from)}→${pos(m.to)}`).join(", ")}<br>` : ""}
      ${r.blNew || r.blLost || r.domains != null ? `Backlink: ${r.blNew} mới, ${r.blLost} mất${r.domains != null ? ` · ${r.domains} domain trỏ về` : ""}<br>` : ""}
      ${r.alerts.map((a) => `<span style="color:${a.status === "watching" ? "#2f7fd6" : "#d64545"}">${a.status === "watching" ? "Đang theo dõi" : "Cảnh báo"}: ${esc(a.title.replace(`${r.domain}: `, ""))}</span><br>`).join("")}
      ${[r.waiting.drafts ? `${r.waiting.drafts} bài nháp` : "", r.waiting.tasks ? `${r.waiting.tasks} việc phục hồi` : "", r.waiting.emails ? `${r.waiting.emails} thư outreach` : "", r.quick.approved ? `${r.quick.approved} quick win đã duyệt chưa áp dụng` : "", r.waiting.quickwins ? `${r.waiting.quickwins} quick win chưa xử lý` : ""].filter(Boolean).join(" · ").replace(/^(.+)$/, "Chờ anh: $1<br>")}
      ${r.semantic != null ? `Điểm semantic: ${r.semantic}/100<br>` : ""}
    </td></tr>`;
  const html = `<!doctype html><html><body style="margin:0;background:#f6f5fb;font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:24px 12px">
  <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;background:#fff;border-radius:14px;padding:24px">
    <tr><td style="font-size:20px;font-weight:700;color:#222">Báo cáo tuần · Duy Ơi</td></tr>
    <tr><td style="font-size:14px;color:#555;padding:6px 0 10px">${totalPrev || totalCur ? `Tổng click từ Google: ${totalCur} (tuần trước ${totalPrev}) ${chg(tch)}. ` : ""}${alertN} cảnh báo, ${waitN} việc chờ anh${prompts ? ` (trong đó ${prompts} prompt chưa duyệt)` : ""}.</td></tr>
    ${health.items.length ? `<tr><td style="font-size:14px;line-height:1.6;padding:8px 12px;background:#fff4f4;border-radius:8px;color:#a33">Lỗi kết nối: ${health.items.slice(0, 8).map((h) => `${esc(h.domain)} · ${esc(h.label)}: ${esc(h.message.slice(0, 120))}`).join("<br>")} <a href="${APP_URL}/#/health" style="color:#a33">Xem</a></td></tr>` : ""}
    ${reports.map(block).join("")}
    <tr><td style="padding-top:18px;font-size:13px;color:#888">Số liệu từ Search Console (trễ khoảng 2 ngày), DataForSEO và bộ đo của app. <a href="${APP_URL}" style="color:#5b3fd1">Mở Duy Ơi</a></td></tr>
  </table></td></tr></table></body></html>`;
  const text = [
    "Báo cáo tuần · Duy Ơi", "",
    totalPrev || totalCur ? `Tổng click từ Google: ${totalCur} (tuần trước ${totalPrev})${tch == null ? "" : ` ${tch > 0 ? "+" : ""}${tch}%`}` : "",
    `${alertN} cảnh báo, ${waitN} việc chờ anh${prompts ? ` (trong đó ${prompts} prompt chưa duyệt)` : ""}.`,
    ...(health.items.length ? ["", "Lỗi kết nối:", ...health.items.slice(0, 8).map((h) => `- ${h.domain} · ${h.label}: ${h.message.slice(0, 120)}`)] : []),
    ...reports.flatMap((r) => ["", r.domain,
      r.source ? `  ${r.source === "gsc" ? "Click" : "Lượt xem"}: ${r.cur} (tuần trước ${r.prev})${r.change == null ? "" : ` ${r.change > 0 ? "+" : ""}${r.change}%`}` : "  Chưa có số liệu traffic.",
      ...(r.up.length ? [`  Lên: ${r.up.map((m) => `${m.keyword} ${pos(m.from)}→${pos(m.to)}`).join(", ")}`] : []),
      ...(r.down.length ? [`  Xuống: ${r.down.map((m) => `${m.keyword} ${pos(m.from)}→${pos(m.to)}`).join(", ")}`] : []),
      `  Backlink: ${r.blNew} mới, ${r.blLost} mất`,
      ...r.alerts.map((a) => `  ${a.status === "watching" ? "Đang theo dõi" : "Cảnh báo"}: ${a.title}`)]),
    "", APP_URL
  ].filter((l) => l !== "").join("\n");
  return { subject, html, text, sites: reports };
}

async function sendReport(env: Env, rs: ReportSettings, actor: string, to?: string[]): Promise<{ sent: number }> {
  if (!env.EMAIL) throw new HttpError(409, "Worker chưa có binding EMAIL.", "no_email");
  const list = to || rs.to;
  if (!rs.from || !list.length) throw new HttpError(409, "Chưa nhập địa chỉ gửi và người nhận.", "no_recipient");
  const r = await buildReport(env);
  let sent = 0;
  for (const addr of list) {
    try {
      await env.EMAIL.send({ to: [{ email: addr }], from: { email: rs.from, name: "Duy Ơi" }, subject: r.subject, html: r.html, text: r.text });
      sent++;
    } catch (e) {
      await env.DB.prepare("INSERT INTO report_log (sent_at, recipients, subject, ok, error) VALUES (?, ?, ?, 0, ?)").bind(now(), list.length, r.subject, (e as Error).message.slice(0, 300)).run();
      throw new HttpError(502, `Cloudflare Email Service từ chối: ${(e as Error).message}. Kiểm tra tên miền của địa chỉ gửi đã bật ở Email Service › Sending.`, "send_failed");
    }
  }
  await env.DB.prepare("INSERT INTO report_log (sent_at, recipients, subject, ok, error) VALUES (?, ?, ?, 1, NULL)").bind(now(), sent, r.subject).run();
  await logActivity(env, actor, "report.sent", `Gửi báo cáo tuần tới ${sent} người nhận`, null);
  return { sent };
}

// Cron (lịch B): đúng thứ và giờ đã chọn theo múi giờ cài đặt, mỗi tuần một lần
export async function runReport(env: Env): Promise<void> {
  const rs = await readReportSettings(env);
  if (!rs.enabled || !rs.from || !rs.to.length) return;
  const tz = String((await getSettingsMap(env)).timezone || "Asia/Ho_Chi_Minh");
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "short", hour: "numeric", hour12: false }).formatToParts(new Date()).map((p) => [p.type, p.value]));
  const wd = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(parts.weekday || "");
  if (wd !== rs.weekday || Number(parts.hour) % 24 < rs.hour) return;
  const last = await env.DB.prepare("SELECT MAX(sent_at) AS t FROM report_log WHERE ok = 1").first<{ t: number | null }>();
  if (last?.t && now() - last.t < 5 * DAY) return;
  await sendReport(env, rs, "agent:reporter").catch((e) => logActivity(env, "agent:reporter", "report.error", (e as Error).message.slice(0, 300), null));
}

// ---------------- API ----------------

export async function apiReport(env: Env): Promise<Response> {
  const rs = await readReportSettings(env);
  const log = (await env.DB.prepare("SELECT sent_at, recipients, subject, ok, error FROM report_log ORDER BY id DESC LIMIT 8").all()).results;
  return json({ settings: rs, log, emailBinding: !!env.EMAIL });
}

export async function apiReportPreview(env: Env): Promise<Response> {
  const r = await buildReport(env);
  return json({ subject: r.subject, html: r.html, text: r.text });
}

export async function apiSaveReport(env: Env, req: Request, user: User): Promise<Response> {
  if (user.role !== "admin") throw new HttpError(403, "Chỉ admin.", "forbidden");
  const b = await readJson<Partial<ReportSettings> & { to?: string[] | string }>(req);
  const to = (Array.isArray(b.to) ? b.to : String(b.to || "").split(/[\s,;]+/)).map((x) => x.trim().toLowerCase()).filter(Boolean);
  if (to.length > 5) throw new HttpError(400, "Tối đa 5 người nhận.", "validation");
  const bad = to.find((x) => !EMAIL_RE.test(x));
  if (bad) throw new HttpError(400, `Email không hợp lệ: ${bad}`, "validation");
  const from = String(b.from || "").trim().toLowerCase();
  if (from && !EMAIL_RE.test(from)) throw new HttpError(400, "Địa chỉ gửi không hợp lệ.", "validation");
  const weekday = Number(b.weekday ?? 1), hour = Number(b.hour ?? 8);
  if (!(weekday >= 0 && weekday <= 6) || !(hour >= 0 && hour <= 23)) throw new HttpError(400, "Thứ hoặc giờ không hợp lệ.", "validation");
  const enabled = !!b.enabled;
  if (enabled && (!from || !to.length)) throw new HttpError(400, "Bật báo cáo cần địa chỉ gửi và ít nhất một người nhận.", "validation");
  const rs: ReportSettings = { enabled, to, from, weekday, hour };
  await env.DB.prepare("INSERT INTO settings (key, value, updated_at) VALUES ('report', ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at").bind(JSON.stringify(rs), now()).run();
  await logActivity(env, `user:${user.id}`, "report.settings", `Báo cáo tuần: ${enabled ? "bật" : "tắt"}, ${to.length} người nhận`, null);
  return apiReport(env);
}

export async function apiSendReport(env: Env, user: User): Promise<Response> {
  if (user.role !== "admin") throw new HttpError(403, "Chỉ admin.", "forbidden");
  return json(await sendReport(env, await readReportSettings(env), `user:${user.id}`));
}
