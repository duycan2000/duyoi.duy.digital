// Gọi model qua OpenRouter: có trần chi phí theo tháng, ghi usage_events, chỉ trả JSON.
// Nội dung AI viết luôn đi qua Gác cổng trước khi được duyệt hay ghi lên site.

import { HttpError } from "./http";
import { getSettingsMap, readSecret } from "./settings";
import type { Env } from "./types";

export interface AiCall {
  task: string;
  siteId: number | null;
  system: string;
  user: string;
  tier?: "model_t0" | "model_t1" | "model_t2" | "model_t3";
  maxTokens?: number;
}

async function spentThisMonth(env: Env): Promise<number> {
  const d = new Date();
  const start = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1);
  const r = await env.DB.prepare("SELECT COALESCE(SUM(cost_usd), 0) AS s FROM usage_events WHERE provider = 'openrouter' AND at >= ?").bind(start).first<{ s: number }>();
  return r?.s ?? 0;
}

export async function aiJson<T>(env: Env, call: AiCall): Promise<T> {
  const key = await readSecret(env, "openrouter_api_key");
  if (!key) throw new HttpError(400, "Chưa nhập OpenRouter API key trong Cài đặt.", "no_ai_key");
  const settings = await getSettingsMap(env);
  const cap = Number(settings.openrouter_monthly_cap_usd ?? 30);
  if ((await spentThisMonth(env)) >= cap) throw new HttpError(429, `Đã chạm trần OpenRouter tháng này ($${cap}). Tăng trần trong Cài đặt nếu cần.`, "ai_cap");
  const model = String(settings[call.tier || "model_t1"] || "deepseek/deepseek-v4-pro");
  let res: Response;
  try {
    res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json", "HTTP-Referer": "https://duyoi.duy.digital", "X-Title": "Duy Oi" },
      body: JSON.stringify({
        model,
        temperature: 0.4,
        max_tokens: call.maxTokens || 900,
        response_format: { type: "json_object" },
        usage: { include: true },
        messages: [{ role: "system", content: call.system }, { role: "user", content: call.user }]
      }),
      signal: AbortSignal.timeout(60000)
    });
  } catch (e) {
    throw new HttpError(502, `Không gọi được OpenRouter: ${(e as Error).message}`, "ai_unreachable");
  }
  const data = (await res.json().catch(() => ({}))) as {
    choices?: { message?: { content?: string } }[];
    usage?: { prompt_tokens?: number; completion_tokens?: number; cost?: number };
    error?: { message?: string };
  };
  if (!res.ok) throw new HttpError(502, `OpenRouter báo lỗi: ${data.error?.message || res.status}`, "ai_error");
  await env.DB.prepare("INSERT INTO usage_events (site_id, provider, task, tokens_in, tokens_out, cost_usd, at) VALUES (?, 'openrouter', ?, ?, ?, ?, ?)")
    .bind(call.siteId, call.task, data.usage?.prompt_tokens || 0, data.usage?.completion_tokens || 0, data.usage?.cost || 0, Date.now()).run();
  const text = (data.choices?.[0]?.message?.content || "").replace(/^```(?:json)?\s*|\s*```$/g, "").trim();
  try { return JSON.parse(text) as T; } catch { throw new HttpError(502, "Model trả về không phải JSON hợp lệ. Thử lại.", "ai_bad_json"); }
}

const LANG_NAME: Record<string, string> = { de: "German (Germany, formal 'Sie')", en: "English", vi: "Vietnamese" };

// Luật chung gửi kèm mọi lệnh viết
export function writingRules(language: string, allowedNumbers: string[], blocklist: string[]): string {
  return [
    `Write ONLY in ${LANG_NAME[language] || language}. Never mix in another language.`,
    "Do NOT invent facts. Do NOT write any number, price, percentage, duration, project count or statistic"
      + (allowedNumbers.length ? ` except these verified ones, copied exactly: ${allowedNumbers.slice(0, 30).join(" | ")}.` : "."),
    "No superlatives you cannot prove (best, #1, guaranteed). No 'click here'. No placeholders or brackets.",
    blocklist.length ? `Never mention these names or terms in any form: ${blocklist.join(", ")}.` : "",
    "Reply with a single JSON object only."
  ].filter(Boolean).join("\n");
}
