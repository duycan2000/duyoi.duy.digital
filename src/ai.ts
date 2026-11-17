// Gọi model qua OpenRouter. Mọi lần gọi phải qua cấp Quản lý: prompt đã duyệt đúng phiên bản, còn trong trần chi phí.
// Nội dung AI viết luôn đi qua Gác cổng trước khi được duyệt hay ghi lên site.

import { HttpError } from "./http";
import { budgetCheck, logCall, PROMPTS, promptApproved, type CallCtx } from "./manager";
import { getSettingsMap, readSecret } from "./settings";
import type { Env } from "./types";

export interface AiRun {
  template: string;          // id trong danh mục prompt của Quản lý
  task: string;
  siteId: number | null;
  rules: string;             // luật viết chung (writingRules) chèn vào {{RULES}}
  input: unknown;            // dữ liệu gửi kèm (JSON)
}

export async function aiJson<T>(env: Env, run: AiRun): Promise<T> {
  const t = PROMPTS.find((x) => x.id === run.template);
  if (!t) throw new HttpError(500, `Prompt ${run.template} không có trong danh mục.`, "no_prompt");
  const { version, ok } = await promptApproved(env, t);
  const system = t.system.replace("{{RULES}}", run.rules);
  const user = JSON.stringify(run.input);
  const settings = await getSettingsMap(env);
  const model = String(settings[t.tier] || "deepseek/deepseek-v4-pro");
  const ctx: CallCtx = { provider: "openrouter", agent: t.agent, task: run.task, siteId: run.siteId, templateId: t.id, version, model, promptChars: system.length + user.length };
  if (!ok) {
    await logCall(env, ctx, { status: "blocked", reason: "Prompt chưa được Quản lý duyệt" });
    throw new HttpError(403, `Quản lý chưa duyệt prompt "${t.title}" (phiên bản ${version}). Vào Agent HQ › Quản lý để duyệt.`, "prompt_not_approved");
  }
  const key = await readSecret(env, "openrouter_api_key");
  if (!key) throw new HttpError(400, "Chưa nhập OpenRouter API key trong Cài đặt.", "no_ai_key");
  await budgetCheck(env, ctx);
  let res: Response;
  try {
    res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json", "HTTP-Referer": "https://duyoi.duy.digital", "X-Title": "Duy Oi" },
      body: JSON.stringify({
        model, temperature: 0.4, max_tokens: t.maxTokens,
        response_format: { type: "json_object" }, usage: { include: true },
        messages: [{ role: "system", content: system }, { role: "user", content: user }]
      }),
      signal: AbortSignal.timeout(90000)
    });
  } catch (e) {
    await logCall(env, ctx, { status: "error", reason: (e as Error).message });
    throw new HttpError(502, `Không gọi được OpenRouter: ${(e as Error).message}`, "ai_unreachable");
  }
  const data = (await res.json().catch(() => ({}))) as {
    choices?: { message?: { content?: string } }[];
    usage?: { prompt_tokens?: number; completion_tokens?: number; cost?: number };
    error?: { message?: string };
  };
  if (!res.ok) {
    await logCall(env, ctx, { status: "error", reason: data.error?.message || String(res.status) });
    throw new HttpError(502, `OpenRouter báo lỗi: ${data.error?.message || res.status}`, "ai_error");
  }
  await logCall(env, ctx, { status: "ok", tokensIn: data.usage?.prompt_tokens, tokensOut: data.usage?.completion_tokens, cost: data.usage?.cost });
  const text = (data.choices?.[0]?.message?.content || "").replace(/^```(?:json)?\s*|\s*```$/g, "").trim();
  try { return JSON.parse(text) as T; } catch { throw new HttpError(502, "Model trả về không phải JSON hợp lệ. Thử lại.", "ai_bad_json"); }
}

const LANG_NAME: Record<string, string> = { de: "German (Germany, formal 'Sie')", en: "English", vi: "Vietnamese" };

// Luật chung chèn vào mọi prompt
export function writingRules(language: string, allowedNumbers: string[], blocklist: string[]): string {
  return [
    `Write ONLY in ${LANG_NAME[language] || language}. Never mix in another language.`,
    "Do NOT invent facts. Do NOT write any number, price, percentage, duration, project count or statistic"
      + (allowedNumbers.length ? ` except these verified ones, copied exactly: ${allowedNumbers.slice(0, 30).join(" | ")}.` : "."),
    "No superlatives you cannot prove (best, #1, guaranteed). No 'click here'. No placeholders, brackets or editorial notes in the text.",
    blocklist.length ? `Never mention these names or terms in any form: ${blocklist.join(", ")}.` : "",
    "Reply with a single JSON object only."
  ].filter(Boolean).join("\n");
}
