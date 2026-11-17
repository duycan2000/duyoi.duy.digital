// Cấp Quản lý: mọi prompt agent dùng phải có trong danh mục, qua kiểm tra tự động và được admin duyệt đúng phiên bản.
// Mọi lần gọi AI / DataForSEO đều qua kiểm trần chi phí và được ghi vào ai_calls (không lưu nội dung prompt, chỉ độ dài).

import { HttpError, json, now, readJson, str } from "./http";
import { logActivity } from "./activity";
import { sha256Hex } from "./crypto";
import { getSettingsMap } from "./settings";
import type { Env, User } from "./types";
import { ALL_SPECS, FORMATS } from "./formats";

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
    id: "doc_profile", agent: "docs", title: "Đọc tài liệu site (PDF) và rút Hồ sơ site", tier: "model_t1", maxTokens: 4000,
    system: "You read ONE document supplied by the website owner (catalog, price list, company profile, SEO handover, process guide or expert notes) and extract what writers of this website need. Extract ONLY what the document states; never add facts, numbers or products that are not in it. Copy numbers, model names and specifications exactly. Skip personal data of private individuals (private names, private emails or phone numbers). Then suggest up to 8 articles this document makes possible, each with the best format: roundup (best X / top N, needs several products), review (one product the owner knows first-hand), comparison (X vs Y), how_to (a procedure), guide (broad knowledge or buying guide), article (answers one question for a service page). Return JSON {doc_type: catalog|price_list|company_profile|seo_handover|process_guide|knowledge|other, title, summary_vi (3-5 sentences in Vietnamese for the owner), audience, tone, services[], products[{name, specs, notes}], facts[{text, page}], banned[] (terms, claims or brands the document says must not be used), ideas[{title, keyword, format, why_vi}]}. All fields except summary_vi and why_vi stay in the document's language.\n{{RULES}}",
    input: "File PDF anh tải lên (OpenRouter đọc chữ trong PDF; PDF scan thì dùng OCR), ngôn ngữ site, danh sách trang có sẵn để không gợi ý trùng."
  },
  {
    id: "article_review", agent: "editor", title: "Biên tập viên chấm bài nháp", tier: "model_t2", maxTokens: 2000,
    system: "You are a strict senior editor reviewing ONE draft before the owner sees it. Score it 0-100 on each criterion: intent (answers the search query early and fully), format (follows every part of the FORMAT below, in order), usefulness (specific, practical, no filler, no repetition, no generic statements), experience (first-hand experience and honest drawbacks where the format needs them, taken from owner notes; no fake experience), accuracy (every claim is supported by the input: outline, products, site_profile facts; flag anything that is not), readability (short paragraphs, clear headings, scannable lists and tables). The overall score is the weighted judgement of an editor who would only publish work that beats the current top results. List up to 8 concrete issues, most important first, each {where: heading or short quote of at most 12 words, problem, fix}. Notes, problems and fixes in Vietnamese; quotes in the draft's language. Return JSON {score, criteria[{name, score, note}], issues[], verdict}.\n{{FORMAT}}\n{{RULES}}",
    input: "Bài nháp (HTML kèm các token [[...]]), định dạng, từ khoá, dàn ý, sản phẩm, Hồ sơ site, câu hỏi People Also Ask."
  },
  {
    id: "article_revise", agent: "writer", title: "Sửa bài theo nhận xét của Biên tập viên", tier: "model_t1", maxTokens: 6000,
    system: "You revise ONE article draft to fix the editor's issues listed in the input. Change only what the issues require; keep everything else as it is. Keep the FORMAT structure, keep every [[...]] token exactly as written and in the same section, keep the internal link. Use only facts from the input. Output clean HTML using only <h2>, <h3>, <p>, <ul>, <ol>, <li>, <strong>, <em>, <a>, <table>, <thead>, <tbody>, <tr>, <th>, <td> plus the tokens. Return JSON {html}.\n{{FORMAT}}\n{{RULES}}",
    input: "Bài nháp hiện tại, danh sách lỗi Biên tập viên nêu, dàn ý, sản phẩm, Hồ sơ site."
  },
  {
    id: "lead_plan", agent: "lead", title: "Trưởng nhóm trả lời và lên phương án giao việc", tier: "model_t3", maxTokens: 2500,
    system: "You are the team lead of an SEO agent team working for the owner. Speak Vietnamese, call the owner 'anh' and yourself 'em'; be brief and concrete. The input holds the REAL state of the owner's sites, the agents, pending owner inputs, limits and the recent conversation. Answer the owner's message from that state; if the state does not contain the answer, say so. When work would help, propose a plan using ONLY these actions: research_keywords{site_id}, create_article{site_id, keyword, format, hub_path?}, write_brief{idea_id}, write_draft{idea_id}, review_draft{idea_id}, rescan_site{site_id}. Formats: roundup, review, comparison, how_to, guide, article. Never use sites or idea ids that are not in the input. Quality over quantity: stay within each site's monthly article limit, never propose a topic an existing page already covers, prefer ideas suggested by the site's documents and keyword research. If something is blocked by a missing owner input (products, affiliate links, real photos, documents, keys), do not propose the blocked action; list what the owner must provide. Return JSON {reply, plan[{action, site_id, idea_id?, keyword?, format?, hub_path?, why}], needs_from_owner[]}.\n{{RULES}}",
    input: "Tin nhắn của anh, 8 tin gần nhất, tình trạng từng site (bài đang làm, ý tưởng, giới hạn tháng, trang dịch vụ, Hồ sơ site và gợi ý từ tài liệu, việc chờ anh, điểm chẩn đoán), hàng việc đang chạy, chi phí tháng."
  },
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
    system: "You are a senior SEO editor planning ONE genuinely useful article for the website described in the input (site_type). The article must answer the searcher's real question better than the current top results, fit the site, follow the FORMAT below, and avoid overlapping existing pages listed in the input. Plan the H2/H3 sections in the format's order, the angle, what first-hand experience the owner should add, and where to link to the service/money page. For how-to and guide formats, list photo_requests: real photos the owner should take (keys s1, s2... for steps, g1, g2... for guide sections; at most 6). No fluff sections.\n{{FORMAT}}\n{{RULES}}",
    input: "Định dạng bài, loại site, từ khoá, lượng tìm kiếm, ý định, trang dịch vụ đích, sản phẩm anh nhập (tên, dùng cho ai, đã dùng thật chưa), tiêu đề top kết quả Google, câu hỏi People Also Ask, các trang có sẵn của site (để tránh trùng). Trả về JSON {title, slug, angle, outline[{h2, points[], h3[]}], faq[], expert_input[], photo_requests[{key, what}], meta_description, internal_link_anchor}."
  },
  {
    id: "article_draft", agent: "writer", title: "Viết bài nháp từ dàn ý", tier: "model_t1", maxTokens: 6000,
    system: "You write ONE article draft from an approved outline, following the FORMAT below exactly. Plain, specific, helpful; short paragraphs; no filler intros, no 'in today's world', no conclusions that repeat everything. Use only facts given in the input (outline, products, specs, owner notes) or general well-known knowledge stated without numbers. If a service page is given, include exactly one natural internal link to it using the given anchor; no other links. Output clean HTML using only <h2>, <h3>, <p>, <ul>, <ol>, <li>, <strong>, <em>, <a>, <table>, <thead>, <tbody>, <tr>, <th>, <td>, plus the tokens the format asks for.\n{{FORMAT}}\n{{RULES}}",
    input: "Định dạng, dàn ý đã duyệt, sản phẩm (tên, nơi bán, dùng cho ai, đã dùng thật chưa, ghi chú trải nghiệm, thông số, ưu/nhược anh nhập), các chỗ ảnh thật, trang dịch vụ đích + anchor, câu hỏi FAQ. Link affiliate và ảnh do hệ thống chèn, model không thấy URL. Trả về JSON {title, html, meta_description}."
  }
];

// Phiên bản = băm nội dung prompt + tầng model + giới hạn token (+ toàn bộ khung định dạng nếu prompt dùng {{FORMAT}})
export const promptVersion = async (t: PromptTemplate): Promise<string> => (await sha256Hex(`${t.system}\n${t.tier}\n${t.maxTokens}${t.system.includes("{{FORMAT}}") ? `\n${ALL_SPECS()}` : ""}`)).slice(0, 12);

// Kiểm tra tự động của Quản lý trước khi admin duyệt
export function lintPrompt(t: PromptTemplate): { ok: boolean; issues: string[] } {
  const issues: string[] = [];
  if (!t.system.includes("{{RULES}}")) issues.push("Thiếu chỗ chèn luật viết chung {{RULES}} (ngôn ngữ, cấm bịa số, blocklist).");
  if (t.system.length > 3500) issues.push("Prompt quá dài (> 3500 ký tự): tốn token mỗi lần gọi.");
  if (t.maxTokens > 6000) issues.push("Giới hạn đầu ra > 6000 token.");
  if (t.tier === "model_t3" && t.agent !== "lead") issues.push("Dùng tầng đắt nhất (T3): chỉ nên dùng cho kế hoạch/kiểm định.");
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
    out.push({ ...t, version, lint: lintPrompt(t), review: r || null, usesMonth: uses?.n || 0, costMonth: uses?.c || 0, formats: t.system.includes("{{FORMAT}}") ? FORMATS.map((f) => ({ id: f.id, label: f.label, spec: f.spec })) : null });
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
