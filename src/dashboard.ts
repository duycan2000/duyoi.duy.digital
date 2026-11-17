// Tổng quan, công tắc tạm dừng, cron.

import { encryptionReady } from "./crypto";
import { HttpError, json, now, readJson } from "./http";
import { logActivity } from "./activity";
import { getSettingsMap, setSetting } from "./settings";
import type { Env, User } from "./types";

// GET /api/dashboard
export async function dashboard(env: Env): Promise<Response> {
  const monthStart = new Date();
  monthStart.setUTCDate(1);
  monthStart.setUTCHours(0, 0, 0, 0);
  const [sites, jobs, usage, secrets, settings, agentJobs, prompts] = await Promise.all([
    env.DB.prepare("SELECT status, platform, COUNT(*) AS n FROM sites WHERE status != 'archived' GROUP BY status, platform").all<{ status: string; platform: string; n: number }>(),
    env.DB.prepare("SELECT status, COUNT(*) AS n FROM jobs WHERE status IN ('queued', 'running', 'waiting') GROUP BY status").all<{ status: string; n: number }>(),
    env.DB.prepare("SELECT provider, ROUND(SUM(cost_usd), 4) AS cost FROM usage_events WHERE at >= ? GROUP BY provider").bind(monthStart.getTime()).all<{ provider: string; cost: number }>(),
    env.DB.prepare("SELECT key FROM secrets").all<{ key: string }>(),
    getSettingsMap(env),
    env.DB.prepare("SELECT status, COUNT(*) AS n FROM agent_jobs WHERE status IN ('queued', 'running') GROUP BY status").all<{ status: string; n: number }>(),
    env.DB.prepare("SELECT COUNT(*) AS n FROM prompt_reviews WHERE status = 'approved'").first<{ n: number }>()
  ]);
  const has = (k: string) => secrets.results.some((r) => r.key === k);
  const siteCount = sites.results.reduce((s, r) => s + r.n, 0);
  const checklist = [
    { id: "encryption", label: "Đặt ENCRYPTION_KEY cho Worker (để lưu API key)", done: encryptionReady(env.ENCRYPTION_KEY) },
    { id: "openrouter", label: "Nhập OpenRouter API key", done: has("openrouter_api_key") },
    { id: "dataforseo", label: "Nhập DataForSEO login và password", done: has("dataforseo_login") && has("dataforseo_password") },
    { id: "site", label: "Thêm site đầu tiên", done: siteCount > 0 },
    { id: "prompts", label: "Duyệt prompt cho agent (Agent HQ › Quản lý prompt)", done: (prompts?.n || 0) > 0 },
    { id: "cron", label: "Cron đã chạy ít nhất một lần (sau khi deploy)", done: Boolean(settings.cron_last_run) }
  ];
  return json({
    paused: Boolean(settings.paused),
    sites: { total: siteCount, byPlatform: sites.results },
    jobs: (() => { const o: Record<string, number> = {}; for (const r of [...jobs.results, ...agentJobs.results]) o[r.status] = (o[r.status] || 0) + r.n; return o; })(),
    spendThisMonth: Object.fromEntries(usage.results.map((r) => [r.provider, r.cost])),
    caps: { openrouter: settings.openrouter_monthly_cap_usd, dataforseo: settings.dataforseo_monthly_cap_usd },
    cronLastRun: settings.cron_last_run ?? null,
    checklist
  });
}

// POST /api/system/pause  { paused: boolean }
export async function setPaused(env: Env, req: Request, user: User): Promise<Response> {
  if (user.role !== "admin") throw new HttpError(403, "Chỉ admin được tạm dừng hệ thống.", "forbidden");
  const body = await readJson(req);
  if (typeof body.paused !== "boolean") throw new HttpError(400, "paused phải là true/false.", "validation");
  await setSetting(env, "paused", body.paused);
  await logActivity(env, `user:${user.id}`, body.paused ? "system.paused" : "system.resumed", body.paused ? "Tạm dừng toàn bộ agent" : "Chạy lại agent");
  return json({ paused: body.paused });
}

// Cron 15 phút. Giai đoạn 1: ghi nhịp và đánh dấu việc đến hạn. Giai đoạn 2: đẩy việc sang Queues/Workflows.
export async function runCron(env: Env): Promise<void> {
  const t = now();
  await setSetting(env, "cron_last_run", t);
  const settings = await getSettingsMap(env);
  if (settings.paused) return;
  const { results } = await env.DB.prepare("SELECT id, kind FROM jobs WHERE status = 'queued' AND run_at <= ? ORDER BY run_at LIMIT 50")
    .bind(t).all<{ id: number; kind: string }>();
  if (!results.length) return;
  // Chưa có bộ xử lý ở giai đoạn 1: giữ việc ở hàng đợi, chỉ ghi nhận để thấy cron hoạt động.
  await logActivity(env, "system", "cron.due_jobs", `${results.length} việc đến hạn, chờ bộ xử lý của giai đoạn 2`);
}
