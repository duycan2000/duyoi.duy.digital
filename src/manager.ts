// Cấp Quản lý: mọi prompt agent dùng phải có trong danh mục, qua kiểm tra tự động và được admin duyệt đúng phiên bản.
// Mọi lần gọi AI / DataForSEO đều qua kiểm trần chi phí và được ghi vào ai_calls (không lưu nội dung prompt, chỉ độ dài).

import { HttpError, json, now, readJson, str } from "./http";
import { logActivity } from "./activity";
import { sha256Hex } from "./crypto";
import { getSettingsMap } from "./settings";
import type { Env, User } from "./types";

export interface PromptTemplate {
  id: string;
  agent: string;
  title: string;
  tier: "model_t0" | "model_t1" | "model_t2" | "model_t3";
  maxTokens: number;
  system: string;       // có {{RULES}}: luật viết chung (ngôn ngữ, cấm bịa số, blocklist) được chèn lúc chạy
  input: string;        // mô tả dữ liệu gửi kèm (để người duyệt biết model nhận gì)
}

export const PROMPTS: PromptTemplate[] = [
  {
    id: "link_sentence", agent: "linker", title: "Câu chèn link nội bộ", tier: "model_t1", maxTokens: 300,
    system: "You are a careful B2B copy editor adding ONE short sentence after an existing sentence on a live web page. The new sentence must read naturally after the existing one and contain an anchor phrase that describes the target page (its main keyword or a close natural variant, 2–6 words, never generic like 'click here').\n{{RULES}}",
    input: "Tiêu đề trang, tên mục, câu gốc, trang đích (đường dẫn + tiêu đề), các anchor đã dùng để tránh lặp. Trả về JSON {sentence, anchor}."
  },
  {
    id: "cta_sentence", agent: "funnel", title: "Câu kêu gọi liên hệ (CTA)", tier: "model_t1", maxTokens: 250,
    system: "You are a careful B2B copy editor adding ONE short, friendly call-to-action sentence after an existing sentence, inviting the reader to contact the team. No promises, no prices, no guarantees.\n{{RULES}}",
    input: "Tiêu đề trang, tên mục, câu gốc, trang liên hệ. Trả về JSON {sentence, anchor}."
  },
  {
    id: "geo_answers", agent: "geo", title: "Đoạn trả lời trực tiếp + FAQ (GEO)", tier: "model_t1", maxTokens: 1400,
    system: "You improve pages so AI answer engines can cite them. You only ADD text, never change existing text. Write direct answers (2–4 sentences) based ONLY on the section text provided, and 3–5 FAQ items a B2B buyer would ask before hiring, answered only with what the page supports.\n{{RULES}}",
    input: "Tiêu đề, H1, tối đa 8 mục H2 kèm đoạn đầu. Trả về JSON {answers[{heading, answer}], faq_title, faq[{q, a}]}."
  },
  {
    id: "content_brief", agent: "planner", title: "Dàn ý bài viết mới", tier: "model_t1", maxTokens: 1500,
    system: "You are a senior SEO editor planning ONE genuinely useful article for a B2B service website. The article must answer the searcher's real question better than the current top results, fit the site's services, and avoid overlapping existing pages listed in the input. Plan H2/H3 sections, the angle, what first-hand expertise the owner should add, and where to link to the service page. No fluff sections.\n{{RULES}}",
    input: "Từ khoá, lượng tìm kiếm, ý định, trang dịch vụ đích, tiêu đề top kết quả Google, câu hỏi People Also Ask, các trang có sẵn của site (để tránh trùng). Trả về JSON {title, slug, angle, outline[{h2, points[], h3[]}], faq[], expert_input[], meta_description, internal_link_anchor}."
  },
  {
    id: "article_draft", agent: "writer", title: "Viết bài nháp từ dàn ý", tier: "model_t1", maxTokens: 4000,
    system: "You write ONE article draft from an approved outline for a B2B service website. Plain, specific, helpful; short paragraphs; no filler intros, no 'in today's world', no conclusions that repeat everything. Use only facts given in the input or general well-known industry knowledge stated without numbers. Include exactly one natural link to the service page using the given anchor. Output clean HTML using only <h2>, <h3>, <p>, <ul>, <ol>, <li>, <strong>, <a>, <table>, <tr>, <th>, <td>.\n{{RULES}}",
    input: "Dàn ý đã duyệt, trang dịch vụ đích + anchor, câu hỏi FAQ. Trả về JSON {title, html, meta_description}."
  }
];

export const promptVersion = async (t: PromptTemplate): Promise<string> => (await sha256Hex(`${t.system}\n${t.tier}\n${t.maxTokens}`)).slice(0, 12);

// Kiểm tra tự động của Quản lý trước khi admin duyệt
export function lintPrompt(t: PromptTemplate): { ok: boolean; issues: string[] } {
  const issues: string[] = [];
  if (!t.system.includes("{{RULES}}")) issues.push("Thiếu chỗ chèn luật viết chung {{RULES}} (ngôn ngữ, cấm bịa số, blocklist).");
  if (t.system.length > 3500) issues.push("Prompt quá dài (> 3500 ký tự): tốn token mỗi lần gọi.");
  if (t.maxTokens > 4000) issues.push("Giới hạn đầu ra > 4000 token.");
  if (t.tier === "model_t3") issues.push("Dùng tầng đắt nhất (T3): chỉ nên dùng cho kế hoạch/kiểm định.");
  if (/\b(guarantee|best in|#1|number one)\b/i.test(t.system)) issues.push("Prompt khuyến khích lời hứa hoặc so sánh tuyệt đối.");
  return { ok: issues.length === 0, issues };
}

export async function promptApproved(env: Env, t: PromptTemplate): Promise<{ version: string; ok: boolean }> {
  const version = await promptVersion(t);
  const r = await env.DB.prepare("SELECT status FROM prompt_reviews WHERE template_id = ? AND version = ?").bind(t.id, version).first<{ status: string }>();
  return { version, ok: r?.status === "approved" };
}

// ---------------- Chi tiêu ----------------

const monthStart = () => { const d = new Date(); return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1); };

export async function spent(env: Env, provider: string, since: number, siteId?: number): Promise<number> {
  const r = siteId
    ? await env.DB.prepare("SELECT COALESCE(SUM(cost_usd), 0) AS s FROM ai_calls WHERE provider = ? AND at >= ? AND site_id = ? AND status = 'ok'").bind(provider, since, siteId).first<{ s: number }>()
    : await env.DB.prepare("SELECT COALESCE(SUM(cost_usd), 0) AS s FROM ai_calls WHERE provider = ? AND at >= ? AND status = 'ok'").bind(provider, since).first<{ s: number }>();
  return r?.s ?? 0;
}

export interface CallCtx { provider: "openrouter" | "dataforseo"; agent: string; task: string; siteId: number | null; templateId?: string; version?: string; model?: string; promptChars?: number }

export async function logCall(env: Env, c: CallCtx, r: { status: "ok" | "blocked" | "error"; reason?: string; tokensIn?: number; tokensOut?: number; cost?: number }): Promise<void> {
  await env.DB.prepare("INSERT INTO ai_calls (provider, agent, task, site_id, template_id, version, model, prompt_chars, tokens_in, tokens_out, cost_usd, status, reason, at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
    .bind(c.provider, c.agent, c.task, c.siteId, c.templateId || null, c.version || null, c.model || null, c.promptChars || 0, r.tokensIn || 0, r.tokensOut || 0, r.cost || 0, r.status, r.reason?.slice(0, 300) || null, now()).run();
  if (r.status === "ok" && c.provider === "openrouter") {
    await env.DB.prepare("INSERT INTO usage_events (site_id, provider, task, tokens_in, tokens_out, cost_usd, at) VALUES (?, 'openrouter', ?, ?, ?, ?, ?)").bind(c.siteId, c.task, r.tokensIn || 0, r.tokensOut || 0, r.cost || 0, now()).run();
  }
  if (r.status === "ok" && c.provider === "dataforseo") {
    await env.DB.prepare("INSERT INTO usage_events (site_id, provider, task, cost_usd, at) VALUES (?, 'dataforseo', ?, ?, ?)").bind(c.siteId, c.task, r.cost || 0, now()).run();
  }
}

// Quản lý kiểm trước mỗi lần gọi: trần tháng của nhà cung cấp, trần mỗi site mỗi ngày (AI). Bị chặn thì ghi lại lý do.
export async function budgetCheck(env: Env, c: CallCtx): Promise<void> {
  const s = await getSettingsMap(env);
  const capMonth = Number(c.provider === "openrouter" ? s.openrouter_monthly_cap_usd ?? 30 : s.dataforseo_monthly_cap_usd ?? 20);
  let reason = "";
  if ((await spent(env, c.provider, monthStart())) >= capMonth) reason = `Đã chạm trần ${c.provider} tháng này ($${capMonth}).`;
  else if (c.provider === "openrouter" && c.siteId) {
    const capDay = Number(s.ai_site_daily_cap_usd ?? 2);
    if ((await spent(env, "openrouter", Date.now() - 86400000, c.siteId)) >= capDay) reason = `Site này đã dùng hết trần AI trong 24 giờ ($${capDay}).`;
  }
  if (reason) {
    await logCall(env, c, { status: "blocked", reason });
    throw new HttpError(429, `Quản lý chặn: ${reason} Chỉnh trần trong Cài đặt nếu cần.`, "budget");
  }
}

// ---------------- API cho màn Agent HQ / Quản lý ----------------

// GET /api/manager/prompts
export async function listPrompts(env: Env): Promise<Response> {
  const out = [];
  for (const t of PROMPTS) {
    const version = await promptVersion(t);
    const r = await env.DB.prepare("SELECT status, notes, reviewed_at, reviewed_by FROM prompt_reviews WHERE template_id = ? AND version = ?").bind(t.id, version).first<{ status: string; notes: string | null; reviewed_at: number; reviewed_by: number }>();
    const uses = await env.DB.prepare("SELECT COUNT(*) AS n, COALESCE(SUM(cost_usd), 0) AS c FROM ai_calls WHERE template_id = ? AND status = 'ok' AND at >= ?").bind(t.id, monthStart()).first<{ n: number; c: number }>();
    out.push({ ...t, version, lint: lintPrompt(t), review: r || null, usesMonth: uses?.n || 0, costMonth: uses?.c || 0 });
  }
  return json({ prompts: out });
}

// PUT /api/manager/prompts/:id { status, notes? } — admin duyệt đúng phiên bản hiện tại
export async function reviewPrompt(env: Env, req: Request, user: User, id: string): Promise<Response> {
  if (user.role !== "admin") throw new HttpError(403, "Chỉ admin (cấp quản lý) được duyệt prompt.", "forbidden");
  const t = PROMPTS.find((x) => x.id === id);
  if (!t) throw new HttpError(404, "Không có prompt này.", "not_found");
  const body = await readJson(req);
  const status = String(body.status);
  if (!["approved", "rejected"].includes(status)) throw new HttpError(400, "Trạng thái không hợp lệ.", "validation");
  const lint = lintPrompt(t);
  if (status === "approved" && !lint.ok && body.override !== true) throw new HttpError(409, `Prompt chưa qua kiểm tra tự động: ${lint.issues.join(" ")}`, "lint");
  const version = await promptVersion(t);
  const notes = str(body.notes, "Ghi chú", { optional: true, max: 500 }) || null;
  await env.DB.prepare("INSERT INTO prompt_reviews (template_id, version, status, notes, reviewed_by, reviewed_at) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(template_id, version) DO UPDATE SET status = excluded.status, notes = excluded.notes, reviewed_by = excluded.reviewed_by, reviewed_at = excluded.reviewed_at")
    .bind(id, version, status, notes, user.id, now()).run();
  await logActivity(env, `user:${user.id}`, "manager.prompt", `${status === "approved" ? "Duyệt" : "Từ chối"} prompt "${t.title}" (${version})`);
  return listPrompts(env);
}

// GET /api/manager/spend
export async function spendReport(env: Env): Promise<Response> {
  const s = await getSettingsMap(env);
  const since = monthStart();
  const [byAgent, bySite, recent, blocked] = await Promise.all([
    env.DB.prepare("SELECT provider, agent, COUNT(*) AS calls, SUM(tokens_in) AS tin, SUM(tokens_out) AS tout, SUM(cost_usd) AS cost FROM ai_calls WHERE at >= ? AND status = 'ok' GROUP BY provider, agent ORDER BY cost DESC").bind(since).all(),
    env.DB.prepare("SELECT a.site_id, s.domain, SUM(a.cost_usd) AS cost, COUNT(*) AS calls FROM ai_calls a LEFT JOIN sites s ON s.id = a.site_id WHERE a.at >= ? AND a.status = 'ok' GROUP BY a.site_id ORDER BY cost DESC").bind(since).all(),
    env.DB.prepare("SELECT a.*, s.domain FROM ai_calls a LEFT JOIN sites s ON s.id = a.site_id ORDER BY a.id DESC LIMIT 60").all(),
    env.DB.prepare("SELECT COUNT(*) AS n FROM ai_calls WHERE at >= ? AND status = 'blocked'").bind(since).first<{ n: number }>()
  ]);
  return json({
    caps: { openrouter: Number(s.openrouter_monthly_cap_usd ?? 30), dataforseo: Number(s.dataforseo_monthly_cap_usd ?? 20), siteDaily: Number(s.ai_site_daily_cap_usd ?? 2) },
    spent: { openrouter: await spent(env, "openrouter", since), dataforseo: await spent(env, "dataforseo", since) },
    blockedMonth: blocked?.n || 0,
    byAgent: byAgent.results, bySite: bySite.results, recent: recent.results
  });
}
