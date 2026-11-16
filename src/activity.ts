import { json, now } from "./http";
import type { Env } from "./types";

export async function logActivity(env: Env, actor: string, action: string, detail = "", siteId: number | null = null): Promise<void> {
  try {
    await env.DB.prepare("INSERT INTO activity (actor, action, detail, site_id, at) VALUES (?, ?, ?, ?, ?)")
      .bind(actor, action, detail.slice(0, 500), siteId, now()).run();
  } catch (e) {
    console.error("activity log failed", e);
  }
}

// GET /api/activity?limit=50
export async function listActivity(env: Env, url: URL): Promise<Response> {
  const limit = Math.min(200, Math.max(1, Number(url.searchParams.get("limit")) || 50));
  const { results } = await env.DB.prepare(
    "SELECT a.id, a.actor, a.action, a.detail, a.at, s.name AS site FROM activity a LEFT JOIN sites s ON s.id = a.site_id ORDER BY a.at DESC LIMIT ?"
  ).bind(limit).all();
  return json({ activity: results });
}
