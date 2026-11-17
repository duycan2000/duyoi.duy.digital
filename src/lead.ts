// Trưởng nhóm: anh chat trực tiếp, Trưởng nhóm đọc tình trạng thật của các site rồi trả lời và đề xuất phương án
// (chỉ các việc agent sẵn có làm được). Anh chọn việc và bấm Giao việc → vào hàng việc agent_jobs.
// Việc nhẹ (nghiên cứu từ khoá, tạo chủ đề) chạy ngay; việc nặng (dàn ý, viết, chấm, quét lại) chạy bằng cron hoặc nút Chạy ngay.

import { aiJson } from "./ai";
import { logActivity } from "./activity";
import { approveIdeaCore, briefCore, createIdeaCore, draftCore, researchCore, reviewCore } from "./content";
import { readProfile } from "./docs";
import { FORMATS, formatOf, readProducts } from "./formats";
import { HttpError, json, now, readJson } from "./http";
import { spent } from "./manager";
import { resetForRescan } from "./recovery";
import { readRules } from "./recovery-rules";
import { getSettingsMap } from "./settings";
import type { Env, User } from "./types";

export const ACTIONS = {
  research_keywords: { agent: "research", label: "Nghiên cứu từ khoá", heavy: false },
  create_article: { agent: "planner", label: "Tạo chủ đề bài mới", heavy: false },
  write_brief: { agent: "planner", label: "Lập dàn ý", heavy: true },
  write_draft: { agent: "writer", label: "Viết bài nháp (kèm Biên tập viên chấm)", heavy: true },
  review_draft: { agent: "editor", label: "Biên tập viên sửa và chấm lại", heavy: true },
  rescan_site: { agent: "doctor", label: "Quét lại site", heavy: true }
} as const;
type Action = keyof typeof ACTIONS;

interface PlanItem { action: Action; site_id: number; domain?: string; idea_id?: number; keyword?: string; format?: string; hub_path?: string | null; why: string; ok: boolean; problem?: string }

const monthStart = () => { const d = new Date(); return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1); };

// Tình trạng thật gửi cho Trưởng nhóm (gọn, không có khoá hay dữ liệu cá nhân)
export async function leadState(env: Env) {
  const sites = (await env.DB.prepare("SELECT id, name, domain, platform, site_type, language, market, status FROM sites WHERE status != 'archived' ORDER BY id").all<{ id: number; name: string; domain: string; platform: string; site_type: string; language: string; market: string; status: string }>()).results;
  const out = [];
  for (const s of sites.slice(0, 20)) {
    const c = await env.DB.prepare("SELECT id, status, rules, score FROM recovery_cases WHERE site_id = ? AND status != 'archived' ORDER BY id DESC LIMIT 1").bind(s.id).first<{ id: number; status: string; rules: string; score: number | null }>();
    const rules = readRules(c?.rules || "{}");
    const ideas = (await env.DB.prepare("SELECT id, keyword, format, status, covered_by, score, volume, products, gate, wp_post_id, hub_path, updated_at FROM content_ideas WHERE site_id = ? AND status IN ('idea', 'approved', 'briefed', 'drafted') ORDER BY CASE status WHEN 'drafted' THEN 0 WHEN 'briefed' THEN 1 WHEN 'approved' THEN 2 ELSE 3 END, score DESC LIMIT 14").bind(s.id).all<Record<string, unknown>>()).results;
    const used = await env.DB.prepare("SELECT COUNT(*) AS n FROM content_ideas WHERE site_id = ? AND status IN ('approved', 'briefed', 'drafted', 'published') AND updated_at >= ?").bind(s.id, monthStart()).first<{ n: number }>();
    const hubs = c ? (await env.DB.prepare("SELECT path, json_extract(data, '$.title') AS title FROM recovery_pages WHERE case_id = ? AND kind = 'commercial' LIMIT 12").bind(c.id).all<{ path: string; title: string | null }>()).results : [];
    const profile = await readProfile(env, s.id);
    const docs = await env.DB.prepare("SELECT COUNT(*) AS n FROM site_docs WHERE site_id = ? AND status = 'ready'").bind(s.id).first<{ n: number }>();
    out.push({
      site_id: s.id, domain: s.domain, platform: s.platform, type: s.site_type, language: rules.language || s.language,
      scan: c ? { case_id: c.id, status: c.status, recovery_score: c.score } : null,
      monthly_article_limit: rules.maxNewArticlesPerMonth, used_this_month: used?.n || 0, autopilot: rules.autopilot,
      service_pages: hubs.map((h) => ({ path: h.path, title: h.title })),
      documents: docs?.n || 0,
      profile: { summary: profile.summary, services: profile.services.slice(0, 10), products: profile.products.slice(0, 10).map((p) => p.name), facts: profile.facts.length, ideas_from_documents: profile.ideas.slice(0, 10) },
      ideas: ideas.map((i) => {
        const f = formatOf(String(i.format));
        const gate = i.gate ? JSON.parse(String(i.gate)) as { ok: boolean; problems: { rule: string; level: string; message: string }[] } : null;
        const waiting: string[] = [];
        if (readProducts(i.products as string | null).items.length < f.minProducts) waiting.push(`owner must add ${f.minProducts}+ products with affiliate links`);
        if (gate?.problems.some((p) => p.rule === "images" && p.level === "block")) waiting.push("owner must upload real photos");
        return { idea_id: i.id, keyword: i.keyword, format: f.id, status: i.status, volume: i.volume, covered_by: i.covered_by, on_wordpress: !!i.wp_post_id, gate_ok: gate?.ok ?? null, waiting_for_owner: waiting };
      })
    });
  }
  const jobs = (await env.DB.prepare("SELECT id, site_id, action, status, error FROM agent_jobs WHERE status IN ('queued', 'running') OR finished_at >= ? ORDER BY id DESC LIMIT 15").bind(now() - 86400000).all<Record<string, unknown>>()).results;
  const st = await getSettingsMap(env);
  const caps = { openrouter: Number(st.openrouter_monthly_cap_usd), dataforseo: Number(st.dataforseo_monthly_cap_usd) };
  return {
    sites: out, jobs,
    spend_this_month: { openrouter: await spent(env, "openrouter", monthStart()), dataforseo: await spent(env, "dataforseo", monthStart()), caps },
    agents: Object.entries(ACTIONS).map(([k, v]) => ({ action: k, does: v.label })),
    formats: FORMATS.map((f) => ({ id: f.id, label: f.label, needs_products: f.minProducts }))
  };
}

// Kiểm từng việc Trưởng nhóm đề xuất: đúng việc, đúng site, đúng chủ đề, không vượt giới hạn
async function validate(env: Env, raw: unknown[]): Promise<PlanItem[]> {
  const out: PlanItem[] = [];
  for (const x of raw.slice(0, 12)) {
    const p = (x || {}) as Record<string, unknown>;
    const action = String(p.action) as Action;
    const item: PlanItem = { action, site_id: Number(p.site_id), why: String(p.why || "").slice(0, 300), ok: true };
    const bad = (m: string) => { item.ok = false; item.problem = m; };
    if (!(action in ACTIONS)) { bad("Việc không có trong danh sách agent làm được."); out.push(item); continue; }
    if (p.idea_id != null) item.idea_id = Number(p.idea_id);
    if (["write_brief", "write_draft", "review_draft"].includes(action)) {
      const i = item.idea_id ? await env.DB.prepare("SELECT site_id, status, keyword FROM content_ideas WHERE id = ?").bind(item.idea_id).first<{ site_id: number; status: string; keyword: string }>() : null;
      if (!i) bad("Không có chủ đề này.");
      else {
        item.site_id = i.site_id; item.keyword = i.keyword;
        const need = { write_brief: ["approved", "briefed"], write_draft: ["briefed", "drafted"], review_draft: ["drafted"] }[action as "write_brief"];
        if (!need.includes(i.status)) bad(`Chủ đề đang ở bước "${i.status}", chưa làm được việc này.`);
      }
    }
    const site = await env.DB.prepare("SELECT id, domain FROM sites WHERE id = ? AND status != 'archived'").bind(item.site_id).first<{ id: number; domain: string }>();
    if (site) item.domain = site.domain;
    if (!site && item.ok) bad("Không có site này.");
    if (action === "create_article") {
      item.keyword = String(p.keyword || "").trim().toLowerCase().slice(0, 120);
      item.format = formatOf(String(p.format)).id;
      item.hub_path = typeof p.hub_path === "string" && p.hub_path.startsWith("/") ? p.hub_path.slice(0, 200) : null;
      if (item.keyword.length < 3) bad("Thiếu từ khoá.");
      const dup = await env.DB.prepare("SELECT id FROM content_ideas WHERE site_id = ? AND keyword = ?").bind(item.site_id, item.keyword).first();
      if (dup && item.ok) bad("Chủ đề này đã có trong danh sách.");
    }
    if (["research_keywords", "create_article", "rescan_site"].includes(action) && item.ok) {
      const c = await env.DB.prepare("SELECT id FROM recovery_cases WHERE site_id = ? AND status != 'archived' ORDER BY id DESC LIMIT 1").bind(item.site_id).first();
      if (!c) bad("Site chưa được quét cấu trúc: thêm ở Phục hồi trước.");
    }
    out.push(item);
  }
  return out;
}

// POST /api/lead/messages { text }
export async function apiLeadSend(env: Env, req: Request, user: User): Promise<Response> {
  if (user.role === "viewer") throw new HttpError(403, "Tài khoản chỉ xem.", "forbidden");
  const { text } = await readJson<{ text?: string }>(req);
  const msg = String(text || "").trim().slice(0, 2000);
  if (!msg) throw new HttpError(400, "Nhập câu hỏi hoặc yêu cầu.", "validation");
  const history = (await env.DB.prepare("SELECT role, content FROM lead_messages WHERE user_id = ? ORDER BY id DESC LIMIT 8").bind(user.id).all<{ role: string; content: string }>()).results.reverse();
  await env.DB.prepare("INSERT INTO lead_messages (user_id, role, content, at) VALUES (?, 'user', ?, ?)").bind(user.id, msg, now()).run();
  const r = await aiJson<{ reply?: string; plan?: unknown[]; needs_from_owner?: unknown[]; playbook_add?: unknown[] }>(env, {
    template: "lead_plan", task: "lead.plan", siteId: null,
    rules: "Never reveal API keys or settings values. Reply with a single JSON object only.",
    input: { owner_message: msg, playbook: (await readPlaybook(env)).body || "(trống)", recent_conversation: history.map((h) => ({ from: h.role === "user" ? "owner" : "lead", text: h.content.slice(0, 800) })), state: await leadState(env) }
  });
  const plan = await validate(env, Array.isArray(r.plan) ? r.plan : []);
  const needs = (Array.isArray(r.needs_from_owner) ? r.needs_from_owner : []).slice(0, 8).map((x) => String(x).slice(0, 300));
  const playbookAdd = (Array.isArray(r.playbook_add) ? r.playbook_add : []).slice(0, 5).map((x) => String(x).replace(/\s+/g, " ").trim().slice(0, 300)).filter(Boolean);
  const reply = String(r.reply || "Em chưa có câu trả lời.").slice(0, 4000);
  const row = await env.DB.prepare("INSERT INTO lead_messages (user_id, role, content, plan, at) VALUES (?, 'lead', ?, ?, ?) RETURNING id").bind(user.id, reply, JSON.stringify({ items: plan, needs, playbookAdd }), now()).first<{ id: number }>();
  return json({ id: row!.id, reply, plan, needs, playbookAdd });
}

// GET /api/lead → hội thoại + hàng việc
export async function apiLeadView(env: Env, user: User): Promise<Response> {
  const msgs = (await env.DB.prepare("SELECT id, role, content, plan, ran_at, at FROM lead_messages WHERE user_id = ? ORDER BY id DESC LIMIT 40").bind(user.id).all<Record<string, unknown>>()).results.reverse();
  const jobs = (await env.DB.prepare("SELECT j.id, j.site_id, s.domain, j.action, j.params, j.agent, j.why, j.status, j.result, j.error, j.created_at, j.finished_at FROM agent_jobs j LEFT JOIN sites s ON s.id = j.site_id ORDER BY j.id DESC LIMIT 30").all<Record<string, unknown>>()).results;
  return json({
    playbook: await playbookView(env),
    messages: msgs.map((m) => ({ ...m, plan: m.plan ? JSON.parse(String(m.plan)) : null })),
    jobs: jobs.map((j) => ({ ...j, params: JSON.parse(String(j.params)), label: ACTIONS[j.action as Action]?.label || j.action }))
  });
}

// POST /api/lead/messages/:id/run { items: number[] } → giao việc đã chọn
export async function apiLeadRun(env: Env, req: Request, user: User, msgId: number): Promise<Response> {
  if (user.role === "viewer") throw new HttpError(403, "Tài khoản chỉ xem.", "forbidden");
  const m = await env.DB.prepare("SELECT plan, ran_at FROM lead_messages WHERE id = ? AND user_id = ? AND role = 'lead'").bind(msgId, user.id).first<{ plan: string | null; ran_at: number | null }>();
  if (!m?.plan) throw new HttpError(404, "Không có phương án này.", "not_found");
  if (m.ran_at) throw new HttpError(409, "Phương án này đã được giao.", "already_ran");
  const { items } = await readJson<{ items?: number[] }>(req);
  const plan = (JSON.parse(m.plan) as { items: PlanItem[] }).items;
  const chosen = (Array.isArray(items) ? items : []).map(Number).filter((n) => plan[n]?.ok);
  if (!chosen.length) throw new HttpError(400, "Chọn ít nhất một việc hợp lệ.", "validation");
  const fresh = await validate(env, chosen.map((n) => plan[n]));
  const ids: number[] = [];
  for (const it of fresh) {
    const row = await env.DB.prepare("INSERT INTO agent_jobs (site_id, action, params, agent, why, status, error, message_id, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id")
      .bind(it.site_id, it.action, JSON.stringify({ idea_id: it.idea_id, keyword: it.keyword, format: it.format, hub_path: it.hub_path }), ACTIONS[it.action].agent, it.why, it.ok ? "queued" : "failed", it.ok ? null : it.problem, msgId, user.id, now()).first<{ id: number }>();
    ids.push(row!.id);
  }
  await env.DB.prepare("UPDATE lead_messages SET ran_at = ? WHERE id = ?").bind(now(), msgId).run();
  await logActivity(env, `user:${user.id}`, "lead.assign", `Giao ${ids.length} việc theo phương án của Trưởng nhóm`, null);
  // Việc nhẹ chạy ngay
  for (const id of ids) {
    const j = await env.DB.prepare("SELECT action, status FROM agent_jobs WHERE id = ?").bind(id).first<{ action: Action; status: string }>();
    if (j?.status === "queued" && !ACTIONS[j.action].heavy) await runJob(env, id);
  }
  return json({ ok: true, jobs: ids });
}

const caseOf = async (env: Env, siteId: number) => {
  const c = await env.DB.prepare("SELECT id FROM recovery_cases WHERE site_id = ? AND status != 'archived' ORDER BY id DESC LIMIT 1").bind(siteId).first<{ id: number }>();
  if (!c) throw new HttpError(409, "Site chưa được quét cấu trúc.", "no_case");
  return c.id;
};

// Chạy một việc (cron, Giao việc hoặc nút Chạy ngay)
export async function runJob(env: Env, id: number): Promise<{ ok: boolean; result?: string; error?: string }> {
  const claim = await env.DB.prepare("UPDATE agent_jobs SET status = 'running', started_at = ? WHERE id = ? AND status = 'queued' RETURNING site_id, action, params, agent").bind(now(), id).first<{ site_id: number; action: Action; params: string; agent: string }>();
  if (!claim) return { ok: false, error: "Việc không ở trạng thái chờ." };
  const p = JSON.parse(claim.params) as { idea_id?: number; keyword?: string; format?: string; hub_path?: string | null };
  const actor = `agent:${claim.agent}`;
  try {
    let result = "";
    if (claim.action === "research_keywords") { const r = await researchCore(env, await caseOf(env, claim.site_id), actor); result = `Thêm ${r.added} ý tưởng (bỏ ${r.covered} đã có trang)`; }
    if (claim.action === "create_article") { const ideaId = await createIdeaCore(env, await caseOf(env, claim.site_id), { keyword: p.keyword!, format: p.format, hub_path: p.hub_path ?? null }, actor); await approveIdeaCore(env, ideaId, actor); result = `Tạo và duyệt chủ đề "${p.keyword}" (${formatOf(p.format).label})`; }
    if (claim.action === "write_brief") { await briefCore(env, p.idea_id!, actor); result = "Đã lập dàn ý"; }
    if (claim.action === "write_draft") { const g = await draftCore(env, p.idea_id!, actor); result = g.ok ? "Đã viết nháp, qua Gác cổng" : `Đã viết nháp, Gác cổng còn ${g.problems.filter((x) => x.level === "block").length} lỗi chặn`; }
    if (claim.action === "review_draft") { const g = await reviewCore(env, p.idea_id!, true, actor); result = g.ok ? "Đã sửa và chấm lại, qua Gác cổng" : "Đã sửa và chấm lại"; }
    if (claim.action === "rescan_site") { await resetForRescan(env, await caseOf(env, claim.site_id)); result = "Đã xếp lịch quét lại"; }
    await env.DB.prepare("UPDATE agent_jobs SET status = 'done', result = ?, finished_at = ? WHERE id = ?").bind(result, now(), id).run();
    return { ok: true, result };
  } catch (e) {
    const error = (e as Error).message.slice(0, 300);
    await env.DB.prepare("UPDATE agent_jobs SET status = 'failed', error = ?, finished_at = ? WHERE id = ?").bind(error, now(), id).run();
    return { ok: false, error };
  }
}

// POST /api/lead/jobs/:id/run — chạy ngay một việc đang chờ
export async function apiRunJob(env: Env, user: User, id: number): Promise<Response> {
  if (user.role === "viewer") throw new HttpError(403, "Tài khoản chỉ xem.", "forbidden");
  return json(await runJob(env, id));
}

// Cron: việc treo quá 20 phút coi như lỗi; chạy tối đa n việc đang chờ
export async function processJobs(env: Env, n = 2): Promise<void> {
  await env.DB.prepare("UPDATE agent_jobs SET status = 'failed', error = 'Quá thời gian chạy', finished_at = ? WHERE status = 'running' AND started_at < ?").bind(now(), now() - 20 * 60000).run();
  const q = await env.DB.prepare("SELECT id FROM agent_jobs WHERE status = 'queued' ORDER BY id LIMIT ?").bind(n).all<{ id: number }>();
  for (const j of q.results) await runJob(env, j.id);
}

// ---------------- Sổ tay Trưởng nhóm ----------------

export const PLAYBOOK_MAX = 8000;

export async function readPlaybook(env: Env): Promise<{ id: number | null; body: string; by: string | null; at: number | null }> {
  const r = await env.DB.prepare("SELECT id, body, by, at FROM lead_playbook ORDER BY id DESC LIMIT 1").first<{ id: number; body: string; by: string; at: number }>();
  return r ? r : { id: null, body: "", by: null, at: null };
}

async function playbookView(env: Env) {
  const cur = await readPlaybook(env);
  const versions = (await env.DB.prepare("SELECT id, note, by, at, length(body) AS chars FROM lead_playbook ORDER BY id DESC LIMIT 20").all<{ id: number; note: string | null; by: string; at: number; chars: number }>()).results;
  return { ...cur, versions };
}

async function savePlaybook(env: Env, body: string, note: string, by: string): Promise<void> {
  const clean = body.replace(/\r/g, "").trim();
  if (clean.length > PLAYBOOK_MAX) throw new HttpError(400, `Sổ tay dài quá ${PLAYBOOK_MAX} ký tự: gộp bớt các dòng.`, "too_long");
  if ((await readPlaybook(env)).body === clean) return;
  await env.DB.prepare("INSERT INTO lead_playbook (body, note, by, at) VALUES (?, ?, ?, ?)").bind(clean, note.slice(0, 120), by, now()).run();
  await env.DB.prepare("DELETE FROM lead_playbook WHERE id NOT IN (SELECT id FROM lead_playbook ORDER BY id DESC LIMIT 50)").run();
  await logActivity(env, by, "lead.playbook", `Sổ tay Trưởng nhóm: ${note}`, null);
}

const canWrite = (u: User) => { if (u.role === "viewer") throw new HttpError(403, "Tài khoản chỉ xem.", "forbidden"); };

// GET /api/lead/playbook
export async function apiPlaybook(env: Env): Promise<Response> { return json(await playbookView(env)); }

// PUT /api/lead/playbook { body }
export async function apiSavePlaybook(env: Env, req: Request, user: User): Promise<Response> {
  canWrite(user);
  const { body } = await readJson<{ body?: string }>(req);
  await savePlaybook(env, String(body ?? ""), "anh sửa", `user:${user.id}`);
  return json(await playbookView(env));
}

// POST /api/lead/playbook/append { text } — ghi dòng Trưởng nhóm đề xuất từ chat (anh bấm đồng ý)
export async function apiAppendPlaybook(env: Env, req: Request, user: User): Promise<Response> {
  canWrite(user);
  const { text } = await readJson<{ text?: string }>(req);
  const line = String(text || "").replace(/\s+/g, " ").trim().slice(0, 300);
  if (!line) throw new HttpError(400, "Không có nội dung.", "validation");
  const cur = (await readPlaybook(env)).body;
  if (cur.split("\n").some((l) => l.replace(/^[-*]\s*/, "").trim() === line)) return json(await playbookView(env));
  await savePlaybook(env, `${cur}${cur ? "\n" : ""}- ${line}`, "thêm từ chat", `user:${user.id}`);
  return json(await playbookView(env));
}

// POST /api/lead/playbook/restore/:id
export async function apiRestorePlaybook(env: Env, user: User, id: number): Promise<Response> {
  canWrite(user);
  const v = await env.DB.prepare("SELECT body, at FROM lead_playbook WHERE id = ?").bind(id).first<{ body: string; at: number }>();
  if (!v) throw new HttpError(404, "Không có phiên bản này.", "not_found");
  await savePlaybook(env, v.body, `khôi phục bản #${id}`, `user:${user.id}`);
  return json(await playbookView(env));
}
