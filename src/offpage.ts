// Team off-page: Prospector → Outreach Writer → Outreach Reviewer → anh duyệt → gửi qua Cloudflare Email Service (địa chỉ riêng của site)
// → follow-up 1 lần nếu chưa trả lời → thư trả lời về qua Email Routing (handler email()) thì dừng follow-up.
// Community Scout soạn câu trả lời Reddit/Quora/gutefrage cho anh tự đăng. Link Monitor kiểm tra link đã có. Citations cho site dịch vụ có NAP thật.
// Luật cứng: không mua/bán link, không đổi link; site Đức (và người nhận .de/.at/.ch) không email lạnh; không tự đăng diễn đàn; mọi email chờ anh duyệt.

import { logActivity } from "./activity";
import { aiJson, writingRules } from "./ai";
import { cf, creds } from "./cfmedia";
import { serpOrganic, trafficEstimate } from "./dataforseo";
import { readProfile } from "./docs";
import { HttpError, json, now, readJson } from "./http";
import { extractNumbers } from "./recovery-extract";
import { readRules } from "./recovery-rules";
import { getSettingsMap, readSecret } from "./settings";
import { entityLd, siteApps, socialRun } from "./social";
import { emailsIn, fetchText, hostOf, linksIn, overlap, pageInfo } from "./web";
import type { Env, InboundEmail, User } from "./types";

export const WORKER_NAME = "duyoi";
const DAY = 86400000;

export interface OpSettings {
  brand: string; senderName: string; outreachEmail: string; forwardTo: string; postalAddress: string;
  topics: string[]; brandTerms: string[]; dailyCap: number; followupDays: number; minTraffic: number;
  prospecting: boolean; community: boolean; social: boolean; socialDailyCap: number;
  nap: { name: string; address: string; phone: string; city: string };
}
interface OpState { prospectAt?: number; draftAt?: number; threadsAt?: number; linksAt?: number; socialAt?: number; topicIdx?: number; lastError?: string | null; lastSendAt?: number }
interface SiteRow { id: number; name: string; domain: string; site_type: string; market: string; language: string; status: string }

const str = (v: unknown, max: number) => String(v ?? "").trim().slice(0, max);
const list = (v: unknown, max: number, len = 80) => [...new Set((Array.isArray(v) ? v : String(v ?? "").split(/[\n,]/)).map((x) => str(x, len)).filter((x) => x.length >= 2))].slice(0, max);
const emailOk = (v: string) => /^[^\s@<>]+@[a-z0-9.-]+\.[a-z]{2,}$/i.test(v);
const canEdit = (u: User) => { if (u.role === "viewer") throw new HttpError(403, "Tài khoản chỉ xem.", "forbidden"); };

export const germanSite = (s: Pick<SiteRow, "language" | "market" | "domain">) => s.language === "de" || ["DE", "AT", "CH"].includes(s.market) || /\.(de|at|ch)$/i.test(s.domain);
const germanRecipient = (email: string) => /\.(de|at|ch)$/i.test(email.split("@")[1] || "");

export async function siteOf(env: Env, id: number): Promise<SiteRow> {
  const s = await env.DB.prepare("SELECT id, name, domain, site_type, market, language, status FROM sites WHERE id = ?").bind(id).first<SiteRow>();
  if (!s) throw new HttpError(404, "Không tìm thấy site.", "not_found");
  return s;
}

export function cleanSettings(raw: unknown, s: SiteRow): OpSettings {
  const b = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const n = (b.nap && typeof b.nap === "object" ? b.nap : {}) as Record<string, unknown>;
  const num = (v: unknown, d: number, lo: number, hi: number) => { const x = Number(v); return Number.isFinite(x) ? Math.min(hi, Math.max(lo, Math.round(x))) : d; };
  const email = str(b.outreachEmail, 120).toLowerCase();
  const fwd = str(b.forwardTo, 120).toLowerCase();
  return {
    brand: str(b.brand, 80) || s.name, senderName: str(b.senderName, 80),
    outreachEmail: emailOk(email) && email.endsWith(`@${s.domain.replace(/^www\./, "")}`) ? email : "",
    forwardTo: emailOk(fwd) ? fwd : "", postalAddress: str(b.postalAddress, 200),
    topics: list(b.topics, 8), brandTerms: list(b.brandTerms, 5),
    dailyCap: num(b.dailyCap, 8, 1, 30), followupDays: num(b.followupDays, 5, 3, 14), minTraffic: num(b.minTraffic, 100, 0, 1_000_000),
    prospecting: b.prospecting !== false, community: b.community !== false, social: b.social !== false, socialDailyCap: num(b.socialDailyCap, 2, 1, 6),
    nap: { name: str(n.name, 100), address: str(n.address, 200), phone: str(n.phone, 40), city: str(n.city, 60) }
  };
}

export async function readOp(env: Env, s: SiteRow): Promise<{ settings: OpSettings; state: OpState }> {
  const r = await env.DB.prepare("SELECT data, state FROM op_settings WHERE site_id = ?").bind(s.id).first<{ data: string; state: string }>();
  const parse = (t: string | undefined) => { try { return t ? JSON.parse(t) : {}; } catch { return {}; } };
  const settings = cleanSettings(parse(r?.data), s);
  if (!settings.topics.length) {
    const p = await readProfile(env, s.id);
    const kw = (await env.DB.prepare("SELECT keyword FROM content_ideas WHERE site_id = ? ORDER BY COALESCE(volume, 0) DESC LIMIT 4").bind(s.id).all<{ keyword: string }>()).results.map((x) => x.keyword);
    settings.topics = [...new Set([...p.services.slice(0, 3), ...kw])].slice(0, 5);
  }
  if (!settings.brandTerms.length) settings.brandTerms = [settings.brand];
  return { settings, state: parse(r?.state) as OpState };
}
async function setState(env: Env, siteId: number, patch: Partial<OpState>): Promise<void> {
  const r = await env.DB.prepare("SELECT state FROM op_settings WHERE site_id = ?").bind(siteId).first<{ state: string }>();
  const cur = (() => { try { return r ? JSON.parse(r.state) : {}; } catch { return {}; } })();
  await env.DB.prepare("INSERT INTO op_settings (site_id, data, state, updated_at) VALUES (?, '{}', ?, ?) ON CONFLICT(site_id) DO UPDATE SET state = excluded.state, updated_at = excluded.updated_at").bind(siteId, JSON.stringify({ ...cur, ...patch }), now()).run();
}

// ---------------- Prospector ----------------

const SKIP_DOMAINS = /(^|\.)(reddit|quora|youtube|facebook|pinterest|amazon|ebay|wikipedia|linkedin|twitter|x|instagram|tiktok|medium|google|apple|github|trustpilot|yelp|gutefrage)\.[a-z.]+$/i;
const SPAMMY = /guest-?post|backlink|link-?build|seo-?(agency|service)|outreach|marketplace|casino|cbd|escort|loan/i;
const PAID = /sponsored (post|article)s? (cost|price|fee)|paid (guest )?post|price list|our (rates|prices)|\$\s?\d{2,}|€\s?\d{2,}|bezahlte(r)? (artikel|beitrag)|casino|gambling/i;

export async function findProspectsCore(env: Env, siteId: number, actor: string): Promise<{ found: number; skipped: number; note?: string }> {
  const s = await siteOf(env, siteId);
  if (germanSite(s)) return { found: 0, skipped: 0, note: "Site Đức: không outreach email lạnh (§ 7 UWG), Prospector không tìm." };
  const { settings, state } = await readOp(env, s);
  if (!settings.topics.length) throw new HttpError(409, "Chưa có chủ đề để tìm (Off-page › Cài đặt › Chủ đề, hoặc tải tài liệu site).", "no_topics");
  const lang = s.language || "en";
  const idx = state.topicIdx || 0;
  const topics = [settings.topics[idx % settings.topics.length]!, settings.topics[(idx + 1) % settings.topics.length]!].filter((v, i, a) => a.indexOf(v) === i);
  const queries: { q: string; kind: string }[] = [];
  for (const t of topics) { queries.push({ q: `${t} "write for us"`, kind: "guest_post" }, { q: `${t} intitle:resources`, kind: "resource" }); }
  const brand = settings.brandTerms[0];
  if (brand && brand.length >= 4) queries.push({ q: `"${brand}" -site:${s.domain}`, kind: "mention" });
  const own = s.domain.replace(/^www\./, "");
  const seen = new Set((await env.DB.prepare("SELECT url FROM op_prospects WHERE site_id = ?").bind(siteId).all<{ url: string }>()).results.map((r) => r.url));
  const cands: { url: string; domain: string; title: string; snippet: string; kind: string; query: string }[] = [];
  for (const q of queries) {
    const hits = await serpOrganic(env, siteId, q.q, s.market, lang, "prospector", `offpage.prospect.${q.kind}`, 20);
    for (const h of hits) {
      if (h.domain === own || SKIP_DOMAINS.test(h.domain) || SPAMMY.test(h.domain) || seen.has(h.url) || cands.some((c) => c.domain === h.domain)) continue;
      cands.push({ url: h.url, domain: h.domain, title: h.title, snippet: h.description, kind: q.kind, query: q.q });
    }
  }
  const pick = cands.slice(0, 14);
  let traffic: Record<string, number> = {};
  try { traffic = await trafficEstimate(env, siteId, pick.map((c) => c.domain), s.market, lang, "prospector"); } catch { /* không có số traffic thì vẫn chấm theo nội dung */ }
  let found = 0, skipped = 0;
  for (const c of pick) {
    const page = await fetchText(c.url, 400_000, 9000);
    const html = page && page.status < 400 ? page.text : "";
    const t = traffic[c.domain] ?? null;
    let kind = c.kind, why = "", status = "new", dead: string | null = null;
    let emails = html ? emailsIn(html) : [];
    const links = html ? linksIn(html, c.url) : [];
    const contact = links.find((l) => hostOf(l.href) === c.domain && /contact|kontakt|write-for-us|schreib|about/i.test(l.href))?.href || null;
    if (!html) { status = "skipped"; why = "Không mở được trang"; }
    else if (PAID.test(html)) { status = "skipped"; why = "Trang nhận tiền đăng bài hoặc bán link: không làm (luật: không mua link)"; }
    else if (t !== null && t < settings.minTraffic) { status = "skipped"; why = `Traffic ước tính ${t}/tháng, dưới mức ${settings.minTraffic}`; }
    else if (kind === "mention") {
      if (links.some((l) => hostOf(l.href) === own)) { status = "skipped"; why = "Đã có link về site"; }
      else if (!settings.brandTerms.some((b) => html.toLowerCase().includes(b.toLowerCase()))) { status = "skipped"; why = "Không thấy tên thương hiệu trên trang"; }
      else why = "Nhắc tên thương hiệu nhưng chưa có link";
    } else if (kind === "resource") {
      why = "Trang tài nguyên cùng chủ đề";
      const ext = [...new Set(links.filter((l) => hostOf(l.href) && hostOf(l.href) !== c.domain && !SKIP_DOMAINS.test(hostOf(l.href))).map((l) => l.href))].slice(0, 8);
      for (const u of ext) {
        const r = await fetchText(u, 2000, 6000);
        if (!r || r.status === 404 || r.status === 410) { kind = "broken_link"; dead = u; why = `Link chết trên trang tài nguyên: ${u}`; break; }
      }
    } else why = "Trang \"Write for us\" công khai, cùng chủ đề";
    if (status === "new" && !emails.length && contact) {
      const cp = await fetchText(contact, 300_000, 8000);
      if (cp && cp.status < 400) emails = emailsIn(cp.text);
    }
    const sameDomain = emails.filter((e) => e.endsWith(c.domain));
    const email = sameDomain[0] || emails[0] || null;
    const score = Math.min(100, ({ mention: 40, broken_link: 38, resource: 25, guest_post: 22 } as Record<string, number>)[kind]! + (t ? Math.min(30, Math.round(Math.log10(t + 1) * 8)) : 8) + (email ? 20 : 0) + Math.min(10, overlap(c.title, topics.join(" ")) * 4));
    const r = await env.DB.prepare("INSERT OR IGNORE INTO op_prospects (site_id, kind, url, domain, title, snippet, contact_email, contact_page, dead_url, traffic, score, why, query, status, found_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id")
      .bind(siteId, kind, c.url, c.domain, c.title.slice(0, 200), c.snippet, email, contact, dead, t, score, why, c.query, status, now(), now()).first();
    if (r) { if (status === "new") found++; else skipped++; }
  }
  await setState(env, siteId, { prospectAt: now(), topicIdx: idx + 2 });
  await logActivity(env, actor, "offpage.prospects", `Prospector (${s.domain}): ${found} nơi mới, bỏ ${skipped}`, siteId);
  return { found, skipped };
}

// ---------------- Outreach Writer + Reviewer ----------------

const OPTOUT: Record<string, string> = {
  en: "If you'd rather not hear from me again, just reply \"no\" and I won't follow up.",
  vi: "Nếu anh/chị không muốn nhận thêm thư, chỉ cần trả lời \"không\", tôi sẽ không gửi tiếp.",
  fr: "Si vous préférez ne plus recevoir de message de ma part, répondez simplement « non ».",
  es: "Si prefiere no recibir más mensajes, responda \"no\" y no volveré a escribir."
};
export function footerFor(st: OpSettings, s: SiteRow): string {
  const lines = [st.senderName, `${st.brand} · https://${s.domain}`, st.postalAddress].filter(Boolean).join("\n");
  return `\n\n${lines}\n\n${OPTOUT[s.language] || OPTOUT.en!}`;
}

export interface Problem { rule: string; level: "block" | "warn"; message: string }
export function checkEmail(subject: string, body: string, ctx: { kind: string; target: string; domain: string; recipient: string; recipientTitle: string; facts: string; blocklist: string[]; maxWords: number; german: boolean }): Problem[] {
  const p: Problem[] = [];
  const text = `${subject}\n${body}`;
  if (ctx.german) p.push({ rule: "uwg", level: "block", message: "Site Đức: không gửi email lạnh (§ 7 UWG)." });
  if (germanRecipient(ctx.recipient)) p.push({ rule: "uwg", level: "block", message: "Người nhận ở Đức/Áo/Thuỵ Sĩ (.de/.at/.ch): không gửi email lạnh." });
  if (/\b(pay|paid|payment|fee|price|budget|compensat|sponsor|bezahl|vergütung|honorar)\w*|\$\s?\d|€\s?\d|link (exchange|swap)|exchange links|reciprocal/i.test(text)) p.push({ rule: "paid", level: "block", message: "Nhắc tiền, tài trợ hoặc đổi link: luật cấm mua/bán/đổi link." });
  if (/\b(we|i) (have )?(tested|reviewed it|tried it)|hands-on test|wir haben (getestet|ausprobiert)/i.test(text) && !/test/i.test(ctx.facts)) p.push({ rule: "honesty", level: "block", message: "Nói đã test/dùng thật nhưng Hồ sơ site không có sự thật này." });
  const urls = [...body.matchAll(/https?:\/\/[^\s)>\]]+/gi)].map((m) => m[0].replace(/[.,;:]$/, ""));
  const bad = urls.filter((u) => hostOf(u) !== ctx.domain.replace(/^www\./, ""));
  if (bad.length) p.push({ rule: "links", level: "block", message: `Có link ngoài site: ${bad.slice(0, 2).join(", ")}` });
  for (const b of ctx.blocklist) if (b && text.toLowerCase().includes(b.toLowerCase())) p.push({ rule: "blocklist", level: "block", message: `Có từ cấm "${b}".` });
  const words = body.split(/\s+/).filter(Boolean).length;
  if (words > ctx.maxWords) p.push({ rule: "length", level: "warn", message: `Dài ${words} từ (nên dưới ${ctx.maxWords}).` });
  if (subject.length > 70) p.push({ rule: "subject", level: "warn", message: "Tiêu đề dài hơn 70 ký tự." });
  if (/!{2,}|\b[A-Z]{6,}\b/.test(subject)) p.push({ rule: "subject", level: "warn", message: "Tiêu đề viết hoa hoặc nhiều dấu chấm than." });
  if (ctx.recipientTitle && overlap(body, ctx.recipientTitle) === 0) p.push({ rule: "personal", level: "warn", message: "Thư chưa nhắc tới trang của người nhận." });
  const nums = extractNumbers(body).filter((n) => !ctx.facts.includes(n) && !ctx.target.includes(n) && !ctx.recipientTitle.includes(n));
  if (nums.length) p.push({ rule: "numbers", level: "warn", message: `Có số không có nguồn: ${nums.slice(0, 3).join(", ")}` });
  return p;
}

async function pageFor(env: Env, s: SiteRow, hint: string): Promise<{ url: string; title: string }> {
  const c = await env.DB.prepare("SELECT id FROM recovery_cases WHERE site_id = ? AND status != 'archived' ORDER BY id DESC LIMIT 1").bind(s.id).first<{ id: number }>();
  const rows = c ? (await env.DB.prepare("SELECT url, json_extract(data, '$.title') AS title FROM recovery_pages WHERE case_id = ? AND status = 'done' LIMIT 300").bind(c.id).all<{ url: string; title: string | null }>()).results : [];
  let best = { url: `https://${s.domain}/`, title: s.name, n: 0 };
  for (const r of rows) { const n = overlap(`${r.title || ""} ${r.url}`, hint); if (n > best.n) best = { url: r.url, title: r.title || r.url, n }; }
  return { url: best.url, title: best.title };
}

export async function draftOutreachCore(env: Env, siteId: number, prospectId: number | null, actor: string): Promise<{ drafted: number; skipped: number; note?: string }> {
  const s = await siteOf(env, siteId);
  if (germanSite(s)) return { drafted: 0, skipped: 0, note: "Site Đức: không outreach email lạnh." };
  const { settings } = await readOp(env, s);
  if (!settings.outreachEmail || !settings.senderName) throw new HttpError(409, "Chưa đặt email gửi và tên người gửi (Off-page › Cài đặt).", "no_sender");
  const rules = readRules((await env.DB.prepare("SELECT rules FROM recovery_cases WHERE site_id = ? AND status != 'archived' ORDER BY id DESC LIMIT 1").bind(siteId).first<{ rules: string }>())?.rules || "{}");
  const profile = await readProfile(env, siteId);
  const facts = [profile.summary, ...profile.facts.map((f) => f.text), ...profile.services].join("\n").slice(0, 2500);
  const ps = prospectId
    ? (await env.DB.prepare("SELECT * FROM op_prospects WHERE id = ? AND site_id = ?").bind(prospectId, siteId).all<Record<string, unknown>>()).results
    : (await env.DB.prepare("SELECT * FROM op_prospects WHERE site_id = ? AND status = 'new' AND contact_email IS NOT NULL ORDER BY score DESC LIMIT 3").bind(siteId).all<Record<string, unknown>>()).results;
  let drafted = 0, skipped = 0;
  const lang = s.language || "en";
  for (const p of ps) {
    const pid = Number(p.id), to = String(p.contact_email || ""), domain = String(p.domain);
    const skip = async (why: string) => { skipped++; await env.DB.prepare("UPDATE op_prospects SET status = 'skipped', note = ?, updated_at = ? WHERE id = ?").bind(why, now(), pid).run(); };
    if (!emailOk(to)) { await skip("Không có email liên hệ"); continue; }
    if (germanRecipient(to)) { await skip("Người nhận ở Đức/Áo/Thuỵ Sĩ: không email lạnh"); continue; }
    const recent = await env.DB.prepare("SELECT COUNT(*) AS n FROM op_messages m JOIN op_prospects x ON x.id = m.prospect_id WHERE x.domain = ? AND m.status IN ('sent', 'replied', 'approved', 'ready', 'needs_fix') AND m.created_at > ?").bind(domain, now() - 30 * DAY).first<{ n: number }>();
    if (recent?.n) { await skip("Tên miền này đã được liên hệ (từ site này hoặc site khác) trong 30 ngày"); continue; }
    const target = await pageFor(env, s, `${p.title} ${p.dead_url || ""} ${p.snippet || ""}`);
    const input = { kind: p.kind, recipient_page: { url: p.url, title: p.title, snippet: p.snippet, dead_link: p.dead_url }, target_page: target, brand: settings.brand, sender_name: settings.senderName, owner_facts: facts, site_articles: p.kind === "guest_post" ? (await env.DB.prepare("SELECT keyword FROM content_ideas WHERE site_id = ? LIMIT 10").bind(siteId).all<{ keyword: string }>()).results.map((x) => x.keyword) : [] };
    const wr = writingRules(lang, extractNumbers(facts), rules.blocklist);
    const d = await aiJson<{ subject: string; body: string; followup_body: string }>(env, { template: "outreach_draft", task: "offpage.outreach_draft", siteId, rules: wr, input });
    let subject = str(d.subject, 120), body = str(d.body, 3000), follow = str(d.followup_body, 1500);
    const ctx = { kind: String(p.kind), target: target.url, domain: s.domain, recipient: to, recipientTitle: String(p.title || ""), facts, blocklist: rules.blocklist, maxWords: 160, german: false };
    let review: { score?: number; issues?: string[]; fixed_subject?: string; fixed_body?: string; fixed_followup?: string } = {};
    try {
      review = await aiJson(env, { template: "outreach_review", task: "offpage.outreach_review", siteId, rules: wr, input: { email: { subject, body, followup: follow }, kind: p.kind, recipient_page: input.recipient_page, target_page: target, owner_facts: facts } });
      if (review.fixed_body) body = str(review.fixed_body, 3000);
      if (review.fixed_subject) subject = str(review.fixed_subject, 120);
      if (review.fixed_followup) follow = str(review.fixed_followup, 1500);
    } catch (e) { review = { issues: [`Reviewer không chạy được: ${(e as Error).message.slice(0, 120)}`] }; }
    const problems = [...checkEmail(subject, body, ctx), ...checkEmail(subject, follow, { ...ctx, maxWords: 90 }).filter((x) => x.level === "block").map((x) => ({ ...x, message: `Follow-up: ${x.message}` }))];
    const footer = footerFor(settings, s);
    const status = problems.some((x) => x.level === "block") ? "needs_fix" : "ready";
    const meta = JSON.stringify({ score: review.score ?? null, issues: (review.issues || []).slice(0, 8), problems, target });
    const m = await env.DB.prepare("INSERT INTO op_messages (site_id, prospect_id, kind, to_email, subject, body, status, review, created_at, updated_at) VALUES (?, ?, 'initial', ?, ?, ?, ?, ?, ?, ?) RETURNING id").bind(siteId, pid, to, subject, body + footer, status, meta, now(), now()).first<{ id: number }>();
    if (follow) await env.DB.prepare("INSERT INTO op_messages (site_id, prospect_id, kind, parent_id, to_email, subject, body, status, created_at, updated_at) VALUES (?, ?, 'followup', ?, ?, ?, ?, 'draft', ?, ?)").bind(siteId, pid, m!.id, to, subject.startsWith("Re:") ? subject : `Re: ${subject}`, follow + footer, now(), now()).run();
    await env.DB.prepare("UPDATE op_prospects SET status = 'drafted', updated_at = ? WHERE id = ?").bind(now(), pid).run();
    drafted++;
  }
  await setState(env, siteId, { draftAt: now() });
  if (drafted) await logActivity(env, actor, "offpage.drafts", `Outreach (${s.domain}): ${drafted} email chờ anh duyệt`, siteId);
  return { drafted, skipped };
}

// ---------------- Gửi (Cloudflare Email Service) ----------------

async function sendOne(env: Env, s: SiteRow, st: OpSettings, m: { id: number; to_email: string; subject: string; body: string }, inReplyTo: string | null): Promise<string> {
  if (!env.EMAIL) throw new Error("Worker chưa có binding EMAIL (send_email) trong wrangler.jsonc.");
  const headers: Record<string, string> = {};
  if (inReplyTo) { headers["In-Reply-To"] = inReplyTo; headers.References = inReplyTo; }
  const r = await env.EMAIL.send({ from: { email: st.outreachEmail, name: `${st.senderName} · ${st.brand}` }, to: [{ email: m.to_email }], subject: m.subject, text: m.body, replyTo: { email: st.outreachEmail }, ...(inReplyTo ? { headers } : {}) });
  return String((r as { messageId?: string })?.messageId || "");
}

export async function sendDue(env: Env, deadline: number): Promise<{ sent: number; failed: number }> {
  let sent = 0, failed = 0;
  const due = (await env.DB.prepare(`SELECT m.id, m.site_id, m.kind, m.to_email, m.subject, m.body, m.parent_id, p.message_id AS parent_mid, p.status AS parent_status FROM op_messages m LEFT JOIN op_messages p ON p.id = m.parent_id
    WHERE m.status = 'approved' AND (m.kind = 'initial' OR (m.send_after IS NOT NULL AND m.send_after <= ?)) ORDER BY m.kind = 'followup' DESC, m.id LIMIT 20`).bind(now()).all<{ id: number; site_id: number; kind: string; to_email: string; subject: string; body: string; parent_id: number | null; parent_mid: string | null; parent_status: string | null }>()).results;
  const perSite = new Map<number, number>();
  for (const m of due) {
    if (Date.now() > deadline) break;
    if ((perSite.get(m.site_id) || 0) >= 2) continue; // giãn thư: tối đa 2 thư/site mỗi lượt cron
    const s = await siteOf(env, m.site_id);
    const { settings, state } = await readOp(env, s);
    if (m.kind === "followup" && m.parent_status !== "sent") { await env.DB.prepare("UPDATE op_messages SET status = 'cancelled', error = 'Thư đầu đã có trả lời hoặc chưa gửi', updated_at = ? WHERE id = ?").bind(now(), m.id).run(); continue; }
    const today = await env.DB.prepare("SELECT COUNT(*) AS n FROM op_messages WHERE site_id = ? AND sent_at >= ?").bind(m.site_id, now() - DAY).first<{ n: number }>();
    if ((today?.n || 0) >= settings.dailyCap) continue;
    if (state.lastSendAt && now() - state.lastSendAt < 10 * 60000) continue;
    if (germanSite(s) || germanRecipient(m.to_email)) { await env.DB.prepare("UPDATE op_messages SET status = 'blocked', error = 'UWG: không email lạnh', updated_at = ? WHERE id = ?").bind(now(), m.id).run(); continue; }
    if (!settings.outreachEmail || !settings.senderName) continue;
    try {
      const mid = await sendOne(env, s, settings, m, m.kind === "followup" ? m.parent_mid : null);
      await env.DB.prepare("UPDATE op_messages SET status = 'sent', sent_at = ?, message_id = ?, error = NULL, updated_at = ? WHERE id = ?").bind(now(), mid || null, now(), m.id).run();
      if (m.kind === "initial") {
        await env.DB.prepare("UPDATE op_messages SET send_after = ? WHERE parent_id = ? AND kind = 'followup'").bind(now() + settings.followupDays * DAY, m.id).run();
        await env.DB.prepare("UPDATE op_prospects SET status = 'contacted', updated_at = ? WHERE id = (SELECT prospect_id FROM op_messages WHERE id = ?)").bind(now(), m.id).run();
      }
      await setState(env, m.site_id, { lastSendAt: now() });
      perSite.set(m.site_id, (perSite.get(m.site_id) || 0) + 1);
      sent++;
      await logActivity(env, "agent:outreach_reviewer", "offpage.sent", `Đã gửi ${m.kind === "followup" ? "follow-up" : "email"} "${m.subject}" tới ${m.to_email} (${s.domain})`, m.site_id);
    } catch (e) {
      failed++;
      await env.DB.prepare("UPDATE op_messages SET status = 'failed', error = ?, updated_at = ? WHERE id = ?").bind((e as Error).message.slice(0, 300), now(), m.id).run();
    }
  }
  return { sent, failed };
}

// ---------------- Thư đến (Email Routing → Worker) ----------------

export async function handleInbound(msg: InboundEmail & { forward?: (to: string) => Promise<void> }, env: Env): Promise<void> {
  const to = String(msg.to || "").toLowerCase(), from = String(msg.from || "").toLowerCase();
  const rows = (await env.DB.prepare("SELECT o.site_id, o.data, s.name, s.domain, s.site_type, s.market, s.language, s.status FROM op_settings o JOIN sites s ON s.id = o.site_id").all<{ site_id: number; data: string; name: string; domain: string; site_type: string; market: string; language: string; status: string }>()).results;
  let siteId: number | null = null, fwd = "";
  for (const r of rows) {
    const st = cleanSettings((() => { try { return JSON.parse(r.data); } catch { return {}; } })(), { id: r.site_id, name: r.name, domain: r.domain, site_type: r.site_type, market: r.market, language: r.language, status: r.status });
    if (st.outreachEmail === to) { siteId = r.site_id; fwd = st.forwardTo; break; }
  }
  const subject = (msg.headers.get("subject") || "").slice(0, 200);
  const mid = msg.headers.get("message-id") || "";
  const irt = `${msg.headers.get("in-reply-to") || ""} ${msg.headers.get("references") || ""}`.trim();
  let raw = "";
  try {
    const reader = msg.raw.getReader(); const parts: Uint8Array[] = []; let n = 0;
    while (n < 100_000) { const { done, value } = await reader.read(); if (done) break; parts.push(value); n += value.length; }
    raw = new TextDecoder().decode(parts.reduce((a, b) => { const c = new Uint8Array(a.length + b.length); c.set(a); c.set(b, a.length); return c; }, new Uint8Array()));
  } catch { /* chỉ lưu tiêu đề */ }
  const bodyPart = raw.split(/\r?\n\r?\n/).slice(1).join("\n\n");
  const snippet = bodyPart.replace(/<[^>]+>/g, " ").split(/\r?\n/).filter((l) => !l.startsWith(">") && !/^(content-|--)/i.test(l)).join(" ").replace(/=\r?\n/g, "").replace(/\s+/g, " ").trim().slice(0, 600);
  let matched: { id: number; prospect_id: number | null } | null = null;
  if (siteId) {
    const sent = (await env.DB.prepare("SELECT id, prospect_id, message_id, to_email FROM op_messages WHERE site_id = ? AND kind = 'initial' AND status IN ('sent', 'replied') ORDER BY id DESC LIMIT 300").bind(siteId).all<{ id: number; prospect_id: number | null; message_id: string | null; to_email: string }>()).results;
    matched = sent.find((m) => m.message_id && irt.includes(m.message_id)) || sent.find((m) => m.to_email.toLowerCase() === from) || null;
  }
  await env.DB.prepare("INSERT INTO op_inbox (site_id, from_email, to_email, subject, snippet, message_id, in_reply_to, matched_id, prospect_id, received_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").bind(siteId, from, to, subject, snippet, mid, irt.slice(0, 300), matched?.id ?? null, matched?.prospect_id ?? null, now()).run();
  if (matched) {
    await env.DB.batch([
      env.DB.prepare("UPDATE op_messages SET status = 'replied', updated_at = ? WHERE id = ?").bind(now(), matched.id),
      env.DB.prepare("UPDATE op_messages SET status = 'cancelled', error = 'Đã có trả lời', updated_at = ? WHERE parent_id = ? AND status IN ('draft', 'approved')").bind(now(), matched.id),
      env.DB.prepare("UPDATE op_prospects SET status = 'replied', updated_at = ? WHERE id = ?").bind(now(), matched.prospect_id)
    ]);
  }
  if (siteId) await logActivity(env, "agent:outreach_reviewer", "offpage.reply", `Thư đến từ ${from}: "${subject}"${matched ? " (trả lời outreach, đã dừng follow-up)" : ""}`, siteId);
  if (fwd && msg.forward) { try { await msg.forward(fwd); } catch (e) { console.error("forward failed", (e as Error).message); } }
}

// ---------------- Community Scout ----------------

const STRICT_SUBS = /r\/(smallbusiness|entrepreneur|marketing|seo|webdev|startups|business|personalfinance)\b/i;
export function threadRisk(platform: string, url: string, title: string, withLink: boolean): { risk: number; factors: string[] } {
  const f: string[] = [];
  let r = platform === "reddit" ? 30 : platform === "quora" ? 20 : 25;
  f.push(platform === "reddit" ? "Reddit: mỗi subreddit có luật tự quảng bá riêng" : platform === "quora" ? "Quora: cho phép link nếu thật sự liên quan" : "gutefrage: không link thương mại");
  if (STRICT_SUBS.test(url)) { r += 25; f.push("Subreddit rất chặt với người làm dịch vụ/marketing"); }
  if (/\?/.test(title)) { r -= 5; f.push("Là câu hỏi cụ thể, trả lời đúng trọng tâm được"); }
  if (withLink) { r += platform === "gutefrage" ? 40 : 20; f.push("Câu trả lời có link về site"); } else f.push("Không đặt link");
  return { risk: Math.max(5, Math.min(95, r)), factors: f };
}

export async function findThreadsCore(env: Env, siteId: number, actor: string): Promise<{ drafted: number }> {
  const s = await siteOf(env, siteId);
  const { settings } = await readOp(env, s);
  if (!settings.topics.length) throw new HttpError(409, "Chưa có chủ đề.", "no_topics");
  const rules = readRules((await env.DB.prepare("SELECT rules FROM recovery_cases WHERE site_id = ? AND status != 'archived' ORDER BY id DESC LIMIT 1").bind(siteId).first<{ rules: string }>())?.rules || "{}");
  const profile = await readProfile(env, siteId);
  const facts = [profile.summary, ...profile.facts.map((f) => f.text)].join("\n").slice(0, 1500);
  const lang = s.language || "en";
  const platforms: [string, string][] = germanSite(s) ? [["gutefrage", "gutefrage.net"], ["reddit", "reddit.com"]] : [["reddit", "reddit.com"], ["quora", "quora.com"]];
  const topic = settings.topics[Math.floor(Date.now() / (7 * DAY)) % settings.topics.length]!;
  const seen = new Set((await env.DB.prepare("SELECT url FROM op_threads WHERE site_id = ?").bind(siteId).all<{ url: string }>()).results.map((r) => r.url));
  let drafted = 0;
  for (const [platform, host] of platforms) {
    const hits = (await serpOrganic(env, siteId, `site:${host} ${topic}`, s.market, lang, "community", "offpage.threads", 10)).filter((h) => !seen.has(h.url)).slice(0, 3);
    for (const h of hits) {
      const page = await pageFor(env, s, `${h.title} ${h.description}`);
      const pre = threadRisk(platform, h.url, h.title, true);
      const linkAllowed = pre.risk < 45 && page.url !== `https://${s.domain}/`;
      let d: { answer?: string; include_link?: boolean; why?: string } = {};
      try {
        d = await aiJson(env, { template: "community_answer", task: "offpage.community", siteId, rules: writingRules(lang, extractNumbers(facts), rules.blocklist), input: { platform, thread: { title: h.title, snippet: h.description, url: h.url }, link_allowed: linkAllowed, site_page: page, owner_facts: facts } });
      } catch (e) { d = { answer: "", why: (e as Error).message.slice(0, 150) }; }
      const withLink = !!d.include_link && linkAllowed;
      const { risk, factors } = threadRisk(platform, h.url, h.title, withLink);
      let answer = str(d.answer, 4000).replace(/https?:\/\/\S+/g, (u) => (withLink && hostOf(u) === s.domain.replace(/^www\./, "") ? u : ""));
      if (withLink && !answer.includes(page.url)) answer += `\n\n${page.url}`;
      if (withLink) answer += lang === "de" ? `\n\n(Offenlegung: Ich betreibe ${settings.brand}.)` : lang === "vi" ? `\n\n(Công khai: tôi là người làm ${settings.brand}.)` : `\n\n(Disclosure: I run ${settings.brand}.)`;
      await env.DB.prepare("INSERT OR IGNORE INTO op_threads (site_id, platform, url, title, snippet, risk, factors, page, draft, include_link, status, found_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
        .bind(siteId, platform, h.url, h.title.slice(0, 200), h.description, risk, JSON.stringify(factors), page.url, answer, withLink ? 1 : 0, answer ? "drafted" : "new", now(), now()).run();
      if (answer) drafted++;
    }
  }
  await setState(env, siteId, { threadsAt: now() });
  await logActivity(env, actor, "offpage.threads", `Community Scout (${s.domain}): ${drafted} câu trả lời nháp chờ anh tự đăng`, siteId);
  return { drafted };
}

// ---------------- Link Monitor ----------------

export async function checkLinksCore(env: Env, siteId: number, actor: string): Promise<{ live: number; lost: number; checked: number }> {
  const s = await siteOf(env, siteId);
  const own = s.domain.replace(/^www\./, "");
  const rows = (await env.DB.prepare("SELECT id, source_url, status FROM op_links WHERE site_id = ? ORDER BY COALESCE(last_checked, 0) LIMIT 25").bind(siteId).all<{ id: number; source_url: string; status: string }>()).results;
  let live = 0, lost = 0;
  for (const r of rows) {
    const page = await fetchText(r.source_url, 800_000, 10000);
    let status = "error", anchor: string | null = null, rel: string | null = null, target: string | null = null;
    if (page && page.status < 400) {
      const l = linksIn(page.text, page.url).find((x) => hostOf(x.href) === own);
      if (l) { status = /nofollow|sponsored|ugc/.test(l.rel) ? "nofollow" : "live"; anchor = l.text; rel = l.rel; target = l.href; } else status = "missing";
    } else if (page) status = page.status === 404 || page.status === 410 ? "missing" : "error";
    if (status === "live" || status === "nofollow") live++;
    if (status === "missing" && ["live", "nofollow"].includes(r.status)) { lost++; await logActivity(env, "agent:link_monitor", "offpage.link_lost", `Mất link từ ${r.source_url} (${s.domain})`, siteId); }
    await env.DB.prepare("UPDATE op_links SET status = ?, anchor = COALESCE(?, anchor), rel = COALESCE(?, rel), target_url = COALESCE(?, target_url), first_seen = CASE WHEN first_seen IS NULL AND ? IN ('live', 'nofollow') THEN ? ELSE first_seen END, last_checked = ? WHERE id = ?")
      .bind(status, anchor, rel, target, status, now(), now(), r.id).run();
  }
  await setState(env, siteId, { linksAt: now() });
  if (rows.length) await logActivity(env, actor, "offpage.links", `Link Monitor (${s.domain}): kiểm tra ${rows.length} link, ${live} còn, ${lost} mới mất`, siteId);
  return { live, lost, checked: rows.length };
}

// ---------------- Citations ----------------

const DIRS: Record<string, [string, string][]> = {
  ALL: [["Bing Places", "https://www.bingplaces.com/"], ["Apple Business Connect", "https://businessconnect.apple.com/"], ["Foursquare", "https://foursquare.com/add-place"]],
  US: [["Yelp", "https://biz.yelp.com/"], ["BBB", "https://www.bbb.org/get-listed"], ["Yellow Pages", "https://www.yellowpages.com/"], ["Nextdoor", "https://business.nextdoor.com/"]],
  AU: [["Yellow Pages AU", "https://www.yellowpages.com.au/"], ["True Local", "https://www.truelocal.com.au/"], ["Hotfrog AU", "https://www.hotfrog.com.au/"], ["StartLocal", "https://www.startlocal.com.au/"]],
  CA: [["Yellow Pages CA", "https://www.yellowpages.ca/"], ["Yelp CA", "https://biz.yelp.ca/"], ["Hotfrog CA", "https://www.hotfrog.ca/"]],
  GB: [["Yell", "https://www.yell.com/"], ["Thomson Local", "https://www.thomsonlocal.com/"], ["Yelp UK", "https://biz.yelp.co.uk/"]],
  DE: [["Gelbe Seiten", "https://www.gelbeseiten.de/"], ["Das Örtliche", "https://www.dasoertliche.de/"], ["11880", "https://www.11880.com/"], ["Cylex", "https://www.cylex.de/"], ["Yelp DE", "https://biz.yelp.de/"]],
  NZ: [["Finda", "https://www.finda.co.nz/"], ["Yellow NZ", "https://yellow.co.nz/"]]
};
export async function ensureCitations(env: Env, s: SiteRow, st: OpSettings): Promise<{ added: number; note?: string }> {
  if (s.site_type !== "service") return { added: 0, note: "Citations chỉ cho site dịch vụ có doanh nghiệp thật (không tạo doanh nghiệp giả cho affiliate hay rank & rent)." };
  if (!st.nap.name || !st.nap.address || !st.nap.phone) return { added: 0, note: "Cần tên, địa chỉ, số điện thoại thật (NAP) ở Off-page › Cài đặt." };
  let added = 0;
  for (const [name, url] of [...(DIRS[s.market] || []), ...DIRS.ALL!]) {
    const r = await env.DB.prepare("INSERT OR IGNORE INTO op_citations (site_id, directory, url, updated_at) VALUES (?, ?, ?, ?) RETURNING id").bind(s.id, name, url, now()).first();
    if (r) added++;
  }
  return { added };
}

// ---------------- Chạy tự động ----------------

export async function runOffpage(env: Env, deadline: number): Promise<void> {
  const st = await getSettingsMap(env);
  if (st.paused) return;
  await sendDue(env, deadline).catch((e) => console.error("offpage send", (e as Error).message));
  const hasDfs = !!(await readSecret(env, "dataforseo_login"));
  const sites = (await env.DB.prepare("SELECT id, name, domain, site_type, market, language, status FROM sites WHERE status = 'active' ORDER BY id").all<SiteRow>()).results;
  for (const s of sites) {
    if (Date.now() > deadline) return;
    const { settings, state } = await readOp(env, s);
    const A = "agent:offpage";
    const due = (at: number | undefined, every: number) => !at || now() - at > every;
    try {
      if (settings.social && due(state.socialAt, 2 * 3600000)) { await socialRun(env, s.id, settings, "agent:social"); await setState(env, s.id, { socialAt: now() }); }
      if (Date.now() > deadline) return;
      if (settings.prospecting && hasDfs && !germanSite(s) && due(state.prospectAt, 7 * DAY)) await findProspectsCore(env, s.id, "agent:prospector");
      else if (settings.outreachEmail && settings.senderName && !germanSite(s) && due(state.draftAt, DAY)) {
        const waiting = await env.DB.prepare("SELECT COUNT(*) AS n FROM op_messages WHERE site_id = ? AND status IN ('ready', 'needs_fix')").bind(s.id).first<{ n: number }>();
        if ((waiting?.n || 0) < 6) await draftOutreachCore(env, s.id, null, "agent:outreach_writer");
        else await setState(env, s.id, { draftAt: now() });
      } else if (settings.community && hasDfs && due(state.threadsAt, 7 * DAY)) await findThreadsCore(env, s.id, "agent:community");
      else if (due(state.linksAt, 7 * DAY)) await checkLinksCore(env, s.id, "agent:link_monitor");
      if (state.lastError) await setState(env, s.id, { lastError: null });
    } catch (e) {
      const msg = (e as Error).message.slice(0, 300);
      if (state.lastError !== msg) await logActivity(env, A, "offpage.error", `${s.domain}: ${msg}`, s.id);
      // Lỗi thì lùi lịch bước vừa chạy để không gọi lại liên tục
      await setState(env, s.id, { lastError: msg, prospectAt: state.prospectAt && !due(state.prospectAt, 7 * DAY) ? state.prospectAt : now(), draftAt: now(), threadsAt: state.threadsAt && !due(state.threadsAt, 7 * DAY) ? state.threadsAt : now() });
    }
  }
}

// ---------------- API ----------------

export async function apiOffpageList(env: Env): Promise<Response> {
  const sites = (await env.DB.prepare("SELECT id, name, domain, site_type, market, language, status FROM sites WHERE status != 'archived' ORDER BY id").all<SiteRow>()).results;
  const out = [];
  for (const s of sites) {
    const c = await env.DB.prepare(`SELECT (SELECT COUNT(*) FROM op_prospects WHERE site_id = ?1 AND status = 'new') AS prospects, (SELECT COUNT(*) FROM op_messages WHERE site_id = ?1 AND status IN ('ready', 'needs_fix')) AS approvals,
      (SELECT COUNT(*) FROM op_inbox WHERE site_id = ?1 AND read = 0) AS unread, (SELECT COUNT(*) FROM op_threads WHERE site_id = ?1 AND status = 'drafted') AS threads, (SELECT COUNT(*) FROM social_posts WHERE site_id = ?1 AND status = 'posted' AND posted_at > ?2) AS posts7`).bind(s.id, now() - 7 * DAY).first<Record<string, number>>();
    out.push({ ...s, german: germanSite(s), ...c });
  }
  return json({ sites: out, emailBinding: !!env.EMAIL });
}

export async function apiOffpageView(env: Env, siteId: number): Promise<Response> {
  const s = await siteOf(env, siteId);
  const { settings, state } = await readOp(env, s);
  const q = <T>(sql: string, ...b: unknown[]) => env.DB.prepare(sql).bind(...b).all<T>().then((r) => r.results);
  const [prospects, messages, inbox, threads, links, citations, accounts, posts] = await Promise.all([
    q<Record<string, unknown>>("SELECT * FROM op_prospects WHERE site_id = ? ORDER BY status = 'new' DESC, score DESC, id DESC LIMIT 120", siteId),
    q<Record<string, unknown>>("SELECT * FROM op_messages WHERE site_id = ? ORDER BY CASE status WHEN 'needs_fix' THEN 0 WHEN 'ready' THEN 1 WHEN 'approved' THEN 2 ELSE 3 END, id DESC LIMIT 80", siteId),
    q<Record<string, unknown>>("SELECT * FROM op_inbox WHERE site_id = ? ORDER BY id DESC LIMIT 40", siteId),
    q<Record<string, unknown>>("SELECT * FROM op_threads WHERE site_id = ? ORDER BY status = 'drafted' DESC, id DESC LIMIT 40", siteId),
    q<Record<string, unknown>>("SELECT * FROM op_links WHERE site_id = ? ORDER BY id DESC LIMIT 200", siteId),
    q<Record<string, unknown>>("SELECT * FROM op_citations WHERE site_id = ? ORDER BY status = 'live', directory", siteId),
    q<Record<string, unknown>>("SELECT id, network, handle, profile_url, target_id, target_name, status, error, expires_at, connected_at FROM social_accounts WHERE site_id = ? ORDER BY network", siteId),
    q<Record<string, unknown>>("SELECT * FROM social_posts WHERE site_id = ? ORDER BY id DESC LIMIT 60", siteId)
  ]);
  const parse = (v: unknown) => { try { return v ? JSON.parse(String(v)) : null; } catch { return null; } };
  return json({
    site: s, german: germanSite(s), settings, state, emailBinding: !!env.EMAIL, workerName: WORKER_NAME, entity: await entityLd(env, siteId, settings.brand), apps: await siteApps(env, siteId),
    prospects, messages: messages.map((m) => ({ ...m, review: parse(m.review) })), inbox, threads: threads.map((t) => ({ ...t, factors: parse(t.factors) || [] })),
    links, citations, accounts, posts: posts.map((p) => ({ ...p, gate: parse(p.gate) }))
  });
}

export async function apiSaveOpSettings(env: Env, req: Request, user: User, siteId: number): Promise<Response> {
  canEdit(user);
  const s = await siteOf(env, siteId);
  const b = await readJson<Record<string, unknown>>(req);
  if (b.outreachEmail && !cleanSettings(b, s).outreachEmail) throw new HttpError(400, `Email gửi phải thuộc tên miền ${s.domain} (ví dụ: hello@${s.domain}).`, "validation");
  const st = cleanSettings(b, s);
  await env.DB.prepare("INSERT INTO op_settings (site_id, data, state, updated_at) VALUES (?, ?, '{}', ?) ON CONFLICT(site_id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at").bind(siteId, JSON.stringify(st), now()).run();
  await logActivity(env, `user:${user.id}`, "offpage.settings", `Cài đặt off-page cho ${s.domain}`, siteId);
  return json({ ok: true, settings: st });
}

export async function apiOffpageRun(env: Env, req: Request, user: User, siteId: number): Promise<Response> {
  canEdit(user);
  const s = await siteOf(env, siteId);
  const b = await readJson<{ what?: string }>(req);
  const actor = `user:${user.id}`;
  const { settings } = await readOp(env, s);
  switch (b.what) {
    case "prospects": return json(await findProspectsCore(env, siteId, actor));
    case "drafts": return json(await draftOutreachCore(env, siteId, null, actor));
    case "threads": return json(await findThreadsCore(env, siteId, actor));
    case "links": return json(await checkLinksCore(env, siteId, actor));
    case "citations": return json(await ensureCitations(env, s, settings));
    case "social": return json(await socialRun(env, siteId, settings, actor, true));
    case "send": return json(await sendDue(env, Date.now() + 60000));
  }
  throw new HttpError(400, "Việc không hợp lệ.", "validation");
}

export async function apiProspect(env: Env, req: Request, user: User, id: number): Promise<Response> {
  canEdit(user);
  const p = await env.DB.prepare("SELECT * FROM op_prospects WHERE id = ?").bind(id).first<{ id: number; site_id: number; url: string }>();
  if (!p) throw new HttpError(404, "Không có nơi này.", "not_found");
  const b = await readJson<{ status?: string; note?: string; contact_email?: string; link_url?: string; draft?: boolean }>(req);
  if (b.draft) return json(await draftOutreachCore(env, p.site_id, id, `user:${user.id}`));
  const status = ["new", "skipped", "won", "lost", "contacted", "replied"].includes(String(b.status)) ? String(b.status) : null;
  const email = b.contact_email !== undefined ? str(b.contact_email, 120).toLowerCase() : undefined;
  if (email && !emailOk(email)) throw new HttpError(400, "Email không hợp lệ.", "validation");
  await env.DB.prepare("UPDATE op_prospects SET status = COALESCE(?, status), note = COALESCE(?, note), contact_email = COALESCE(?, contact_email), updated_at = ? WHERE id = ?").bind(status, b.note !== undefined ? str(b.note, 500) : null, email ?? null, now(), id).run();
  if (status === "won") {
    const src = str(b.link_url, 500) || p.url;
    await env.DB.prepare("INSERT OR IGNORE INTO op_links (site_id, prospect_id, source_url, status, created_at) VALUES (?, ?, ?, 'unchecked', ?)").bind(p.site_id, id, src, now()).run();
  }
  return json({ ok: true });
}

// PUT /api/offpage/messages/:id { subject?, body?, action?: approve|reject|reopen }
export async function apiMessage(env: Env, req: Request, user: User, id: number): Promise<Response> {
  canEdit(user);
  const m = await env.DB.prepare("SELECT * FROM op_messages WHERE id = ?").bind(id).first<{ id: number; site_id: number; prospect_id: number | null; kind: string; to_email: string; subject: string; body: string; status: string; review: string | null; parent_id: number | null }>();
  if (!m) throw new HttpError(404, "Không có thư này.", "not_found");
  const b = await readJson<{ subject?: string; body?: string; action?: string }>(req);
  const s = await siteOf(env, m.site_id);
  if (["sent", "replied"].includes(m.status)) throw new HttpError(409, "Thư đã gửi.", "sent");
  if (b.subject !== undefined || b.body !== undefined) {
    const subject = b.subject !== undefined ? str(b.subject, 120) : m.subject, body = b.body !== undefined ? str(b.body, 4000) : m.body;
    if (subject.length < 3 || body.length < 20) throw new HttpError(400, "Tiêu đề hoặc nội dung quá ngắn.", "validation");
    const rules = readRules((await env.DB.prepare("SELECT rules FROM recovery_cases WHERE site_id = ? AND status != 'archived' ORDER BY id DESC LIMIT 1").bind(m.site_id).first<{ rules: string }>())?.rules || "{}");
    const pr = m.prospect_id ? await env.DB.prepare("SELECT title FROM op_prospects WHERE id = ?").bind(m.prospect_id).first<{ title: string | null }>() : null;
    const rv = (() => { try { return m.review ? JSON.parse(m.review) : {}; } catch { return {}; } })();
    const profile = await readProfile(env, m.site_id);
    const problems = checkEmail(subject, body, { kind: "", target: rv.target?.url || "", domain: s.domain, recipient: m.to_email, recipientTitle: pr?.title || "", facts: [profile.summary, ...profile.facts.map((f) => f.text)].join("\n"), blocklist: rules.blocklist, maxWords: m.kind === "followup" ? 120 : 200, german: germanSite(s) });
    const status = m.kind === "followup" ? (m.status === "approved" ? "approved" : "draft") : problems.some((x) => x.level === "block") ? "needs_fix" : "ready";
    await env.DB.prepare("UPDATE op_messages SET subject = ?, body = ?, status = ?, review = ?, updated_at = ? WHERE id = ?").bind(subject, body, status, JSON.stringify({ ...rv, problems, edited: true }), now(), id).run();
    if (!b.action) return json({ ok: true, status, problems });
  }
  if (b.action === "approve") {
    const cur = await env.DB.prepare("SELECT status, review FROM op_messages WHERE id = ?").bind(id).first<{ status: string; review: string | null }>();
    if (m.kind !== "initial") throw new HttpError(400, "Duyệt thư đầu; follow-up đi kèm.", "validation");
    if (cur?.status !== "ready") throw new HttpError(409, "Thư còn lỗi chặn (UWG, tiền/đổi link, link ngoài, từ cấm): sửa trước khi duyệt.", "blocked");
    if (germanSite(s) || germanRecipient(m.to_email)) throw new HttpError(409, "UWG: không gửi email lạnh tới Đức/Áo/Thuỵ Sĩ.", "uwg");
    await env.DB.batch([
      env.DB.prepare("UPDATE op_messages SET status = 'approved', approved_by = ?, updated_at = ? WHERE id = ?").bind(`user:${user.id}`, now(), id),
      env.DB.prepare("UPDATE op_messages SET status = 'approved', approved_by = ?, updated_at = ? WHERE parent_id = ? AND kind = 'followup' AND status = 'draft'").bind(`user:${user.id}`, now(), id)
    ]);
    await logActivity(env, `user:${user.id}`, "offpage.approve", `Duyệt email "${m.subject}" tới ${m.to_email}`, m.site_id);
    return json({ ok: true, status: "approved" });
  }
  if (b.action === "reject") {
    await env.DB.batch([
      env.DB.prepare("UPDATE op_messages SET status = 'cancelled', updated_at = ? WHERE id = ? OR parent_id = ?").bind(now(), id, id),
      env.DB.prepare("UPDATE op_prospects SET status = 'skipped', note = 'Anh bỏ email', updated_at = ? WHERE id = ?").bind(now(), m.prospect_id)
    ]);
    return json({ ok: true, status: "cancelled" });
  }
  if (b.action === "drop_followup" && m.kind === "followup") { await env.DB.prepare("UPDATE op_messages SET status = 'cancelled', updated_at = ? WHERE id = ?").bind(now(), id).run(); return json({ ok: true }); }
  return json({ ok: true });
}

export async function apiThread(env: Env, req: Request, user: User, id: number): Promise<Response> {
  canEdit(user);
  const b = await readJson<{ status?: string; draft?: string }>(req);
  const status = ["posted", "skipped", "drafted"].includes(String(b.status)) ? String(b.status) : null;
  await env.DB.prepare("UPDATE op_threads SET status = COALESCE(?, status), draft = COALESCE(?, draft), updated_at = ? WHERE id = ?").bind(status, b.draft !== undefined ? str(b.draft, 5000) : null, now(), id).run();
  return json({ ok: true });
}

export async function apiAddLink(env: Env, req: Request, user: User, siteId: number): Promise<Response> {
  canEdit(user);
  await siteOf(env, siteId);
  const b = await readJson<{ source_url?: string; note?: string }>(req);
  let u = "";
  try { u = new URL(str(b.source_url, 500)).href; } catch { throw new HttpError(400, "Link nguồn không hợp lệ.", "validation"); }
  await env.DB.prepare("INSERT OR IGNORE INTO op_links (site_id, source_url, note, status, created_at) VALUES (?, ?, ?, 'unchecked', ?)").bind(siteId, u, str(b.note, 200) || null, now()).run();
  return json({ ok: true }, 201);
}
export async function apiDeleteLink(env: Env, user: User, id: number): Promise<Response> {
  canEdit(user);
  await env.DB.prepare("DELETE FROM op_links WHERE id = ?").bind(id).run();
  return json({ ok: true });
}
export async function apiCitation(env: Env, req: Request, user: User, id: number): Promise<Response> {
  canEdit(user);
  const b = await readJson<{ status?: string; listing_url?: string }>(req);
  const status = ["todo", "submitted", "live", "skip"].includes(String(b.status)) ? String(b.status) : null;
  await env.DB.prepare("UPDATE op_citations SET status = COALESCE(?, status), listing_url = COALESCE(?, listing_url), updated_at = ? WHERE id = ?").bind(status, b.listing_url ? str(b.listing_url, 500) : null, now(), id).run();
  return json({ ok: true });
}
export async function apiInboxRead(env: Env, user: User, id: number): Promise<Response> {
  canEdit(user);
  await env.DB.prepare("UPDATE op_inbox SET read = 1 WHERE id = ?").bind(id).run();
  return json({ ok: true });
}

// POST /api/offpage/:siteId/mailbox — Email Routing: thư gửi tới địa chỉ outreach của site → Worker duyoi (để dừng follow-up khi có trả lời)
export async function apiSetupMailbox(env: Env, user: User, siteId: number): Promise<Response> {
  if (user.role !== "admin") throw new HttpError(403, "Chỉ admin.", "forbidden");
  const s = await siteOf(env, siteId);
  const { settings } = await readOp(env, s);
  if (!settings.outreachEmail) throw new HttpError(409, "Chưa đặt email gửi của site.", "no_sender");
  await creds(env);
  const steps: { step: string; ok: boolean; message: string }[] = [];
  const apex = s.domain.replace(/^www\./, "");
  const zone = (await cf<{ id: string }[]>(env, `/zones?name=${encodeURIComponent(apex)}`))?.[0];
  if (!zone) return json({ ok: false, steps: [{ step: "zone", ok: false, message: `Tên miền ${apex} chưa có trong tài khoản Cloudflare.` }] });
  const routing = await cf<{ enabled?: boolean; status?: string }>(env, `/zones/${zone.id}/email/routing`, {}, true).catch(() => null);
  if (!routing?.enabled) steps.push({ step: "routing", ok: false, message: "Email Routing của tên miền chưa bật: Cloudflare › tên miền › Email › Email Routing › Enable (Cloudflare tự thêm bản ghi MX)." });
  else steps.push({ step: "routing", ok: true, message: "Email Routing đã bật." });
  const rules = (await cf<{ id: string; matchers: { field?: string; value?: string }[]; actions: { type: string; value?: string[] }[] }[]>(env, `/zones/${zone.id}/email/routing/rules`).catch(() => null)) || [];
  const has = rules.find((r) => r.matchers.some((m) => (m.value || "").toLowerCase() === settings.outreachEmail));
  if (has && has.actions.some((a) => a.type === "worker" && (a.value || []).includes(WORKER_NAME))) steps.push({ step: "rule", ok: true, message: `${settings.outreachEmail} → Worker ${WORKER_NAME} đã có.` });
  else if (has) steps.push({ step: "rule", ok: false, message: `${settings.outreachEmail} đang có quy tắc khác (chuyển tiếp?). Đổi hành động thành "Send to a Worker: ${WORKER_NAME}" để app biết thư trả lời.` });
  else {
    await cf(env, `/zones/${zone.id}/email/routing/rules`, { method: "POST", json: { name: "Duy Ơi outreach", enabled: true, matchers: [{ type: "literal", field: "to", value: settings.outreachEmail }], actions: [{ type: "worker", value: [WORKER_NAME] }] } });
    steps.push({ step: "rule", ok: true, message: `Đã tạo quy tắc ${settings.outreachEmail} → Worker ${WORKER_NAME}.` });
  }
  steps.push({ step: "sending", ok: !!env.EMAIL, message: env.EMAIL ? `Gửi đi: bật tên miền ${apex} ở Cloudflare › Email Service › Sending (thêm bản ghi SPF/DKIM theo hướng dẫn), rồi bấm "Gửi thư thử".` : "Worker chưa có binding EMAIL: deploy lại sau khi cập nhật wrangler.jsonc." });
  await logActivity(env, `user:${user.id}`, "offpage.mailbox", `Dựng hộp thư outreach ${settings.outreachEmail}`, siteId);
  return json({ ok: steps.every((x) => x.ok), steps });
}

export async function apiTestEmail(env: Env, req: Request, user: User, siteId: number): Promise<Response> {
  if (user.role !== "admin") throw new HttpError(403, "Chỉ admin.", "forbidden");
  const s = await siteOf(env, siteId);
  const { settings } = await readOp(env, s);
  const b = await readJson<{ to?: string }>(req);
  const to = str(b.to, 120).toLowerCase();
  if (!emailOk(to)) throw new HttpError(400, "Nhập email nhận thư thử.", "validation");
  if (!settings.outreachEmail || !settings.senderName) throw new HttpError(409, "Chưa đặt email gửi và tên người gửi.", "no_sender");
  try {
    const mid = await sendOne(env, s, settings, { id: 0, to_email: to, subject: `Thư thử từ ${settings.brand}`, body: `Thư thử của Duy Ơi: ${settings.outreachEmail} gửi được qua Cloudflare Email Service.${footerFor(settings, s)}` }, null);
    return json({ ok: true, messageId: mid });
  } catch (e) {
    throw new HttpError(502, `Không gửi được: ${(e as Error).message.slice(0, 200)}. Kiểm tra tên miền đã bật ở Email Service › Sending chưa.`, "send_failed");
  }
}
