// DataForSEO: nghiên cứu từ khoá và SERP. Mỗi lần gọi qua Quản lý (trần tháng) và ghi chi phí thật từ trường "cost".

import { HttpError } from "./http";
import { b64 } from "./crypto";
import { budgetCheck, logCall, type CallCtx } from "./manager";
import { readSecret } from "./settings";
import type { Env } from "./types";

export const LOCATION: Record<string, number> = { DE: 2276, AT: 2040, CH: 2756, US: 2840, GB: 2826, AU: 2036, CA: 2124, VN: 2704, SG: 2702, IN: 2356 };

async function call<T>(env: Env, path: string, task: Record<string, unknown>, ctx: Omit<CallCtx, "provider">): Promise<T> {
  const login = await readSecret(env, "dataforseo_login");
  const pass = await readSecret(env, "dataforseo_password");
  if (!login || !pass) throw new HttpError(400, "Chưa nhập DataForSEO login/password trong Cài đặt.", "no_dataforseo");
  const c: CallCtx = { ...ctx, provider: "dataforseo", promptChars: JSON.stringify(task).length };
  await budgetCheck(env, c);
  let res: Response;
  try {
    res = await fetch(`https://api.dataforseo.com/v3/${path}`, {
      method: "POST",
      headers: { Authorization: `Basic ${b64(new TextEncoder().encode(`${login}:${pass}`))}`, "Content-Type": "application/json" },
      body: JSON.stringify([task]),
      signal: AbortSignal.timeout(60000)
    });
  } catch (e) {
    await logCall(env, c, { status: "error", reason: (e as Error).message });
    throw new HttpError(502, `Không gọi được DataForSEO: ${(e as Error).message}`, "dfs_unreachable");
  }
  const data = (await res.json().catch(() => ({}))) as { status_code?: number; status_message?: string; cost?: number; tasks?: { status_code?: number; status_message?: string; cost?: number; result?: unknown[] }[] };
  const t0 = data.tasks?.[0];
  const cost = Number(data.cost ?? t0?.cost ?? 0);
  if (!res.ok || (data.status_code && data.status_code >= 40000) || (t0?.status_code && t0.status_code >= 40000)) {
    await logCall(env, c, { status: "error", reason: t0?.status_message || data.status_message || String(res.status), cost });
    throw new HttpError(502, `DataForSEO báo lỗi: ${t0?.status_message || data.status_message || res.status}`, "dfs_error");
  }
  await logCall(env, c, { status: "ok", cost });
  return (t0?.result?.[0] ?? {}) as T;
}

export interface KeywordIdea { keyword: string; volume: number; kd: number | null; intent: string | null; cpc: number | null }

// Gợi ý từ khoá từ các từ khoá gốc (Labs keyword ideas)
export async function keywordIdeas(env: Env, siteId: number, seeds: string[], market: string, language: string, limit = 120): Promise<KeywordIdea[]> {
  type Item = { keyword?: string; keyword_info?: { search_volume?: number; cpc?: number }; keyword_properties?: { keyword_difficulty?: number }; search_intent_info?: { main_intent?: string } };
  const r = await call<{ items?: Item[] }>(env, "dataforseo_labs/google/keyword_ideas/live", {
    keywords: seeds.slice(0, 20), location_code: LOCATION[market] || 2840, language_code: language, limit, include_serp_info: false,
    filters: [["keyword_info.search_volume", ">", 0]], order_by: ["keyword_info.search_volume,desc"]
  }, { agent: "research", task: "content.keyword_ideas", siteId });
  return (r.items || []).filter((i) => i.keyword).map((i) => ({
    keyword: i.keyword!.toLowerCase().trim(),
    volume: i.keyword_info?.search_volume ?? 0,
    kd: i.keyword_properties?.keyword_difficulty ?? null,
    intent: i.search_intent_info?.main_intent ?? null,
    cpc: i.keyword_info?.cpc ?? null
  }));
}

export interface SerpInfo { top: { title: string; url: string; description: string }[]; paa: string[] }

// Top kết quả Google và câu hỏi People Also Ask cho một từ khoá
export async function serpInfo(env: Env, siteId: number, keyword: string, market: string, language: string): Promise<SerpInfo> {
  type Item = { type?: string; title?: string; url?: string; description?: string; items?: { title?: string }[] };
  const r = await call<{ items?: Item[] }>(env, "serp/google/organic/live/advanced", {
    keyword, location_code: LOCATION[market] || 2840, language_code: language, depth: 10, people_also_ask_click_depth: 1
  }, { agent: "research", task: "content.serp", siteId });
  const items = r.items || [];
  return {
    top: items.filter((i) => i.type === "organic").slice(0, 8).map((i) => ({ title: i.title || "", url: i.url || "", description: (i.description || "").slice(0, 300) })),
    paa: items.filter((i) => i.type === "people_also_ask").flatMap((i) => (i.items || []).map((q) => q.title || "")).filter(Boolean).slice(0, 10)
  };
}
