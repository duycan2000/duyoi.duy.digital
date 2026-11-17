// Duy Ơi · Worker chính. Giao diện là static assets (thư mục public/); Worker chỉ xử lý /api/* và cron.

import { changePassword, listSessions, login, logout, requireUser, setup, setupStatus, currentUser } from "./auth";
import { listActivity } from "./activity";
import { dashboard, runCron, setPaused } from "./dashboard";
import { HttpError, assertSameOrigin, errorResponse, json } from "./http";
import { getSettings, updateSettings } from "./settings";
import { createSite, getSite, listSites, updateSite } from "./sites";
import { createUser, deleteUser, listUsers, resetUserPassword, updateUser } from "./users";
import { aiRewriteTask, applyTask, archiveCase, createCase, decideTask, disavow, geoDraft, getCase, listCases, processRecoveryQueue, rescanCase, rollbackTask, updateRules } from "./recovery";
import { wpSave, wpStatus, wpTest } from "./wordpress";
import type { CronEvent, Env, ExecCtx } from "./types";

async function handleApi(req: Request, env: Env, url: URL, ctx?: ExecCtx): Promise<Response> {
  const path = url.pathname.replace(/\/+$/, "") || "/";
  const m = req.method;
  assertSameOrigin(req);

  // Không cần đăng nhập
  if (path === "/api/health" && m === "GET") return json({ ok: true, app: env.APP_NAME || "Duy Ơi" });
  if (path === "/api/setup/status" && m === "GET") return setupStatus(env);
  if (path === "/api/setup" && m === "POST") return setup(env, req);
  if (path === "/api/auth/login" && m === "POST") return login(env, req);
  if (path === "/api/auth/logout" && m === "POST") return logout(env, req);
  if (path === "/api/auth/me" && m === "GET") {
    const user = await currentUser(env, req);
    if (!user) throw new HttpError(401, "Anh cần đăng nhập.", "unauthorized");
    return json({ user });
  }

  // Từ đây trở đi cần đăng nhập
  const user = await requireUser(env, req);

  if (path === "/api/auth/password" && m === "POST") return changePassword(env, req, user);
  if (path === "/api/auth/sessions" && m === "GET") return listSessions(env, req, user);

  // Mật khẩu tạm: phải đổi trước khi dùng phần còn lại của app
  if (user.mustChangePassword) throw new HttpError(403, "Anh cần đổi mật khẩu tạm trước.", "must_change_password");

  if (path === "/api/users" && m === "GET") return listUsers(env, user);
  if (path === "/api/users" && m === "POST") return createUser(env, req, user);
  const userMatch = path.match(/^\/api\/users\/(\d+)(\/password)?$/);
  if (userMatch) {
    const id = Number(userMatch[1]);
    if (userMatch[2] && m === "POST") return resetUserPassword(env, req, user, id);
    if (!userMatch[2] && m === "PUT") return updateUser(env, req, user, id);
    if (!userMatch[2] && m === "DELETE") return deleteUser(env, user, id);
  }

  if (path === "/api/dashboard" && m === "GET") return dashboard(env);
  if (path === "/api/system/pause" && m === "POST") return setPaused(env, req, user);
  if (path === "/api/activity" && m === "GET") return listActivity(env, url);

  if (path === "/api/settings" && m === "GET") return getSettings(env);
  if (path === "/api/settings" && m === "PUT") return updateSettings(env, req, user);

  if (path === "/api/sites" && m === "GET") return listSites(env, url);
  if (path === "/api/sites" && m === "POST") return createSite(env, req, user);
  const wpMatch = path.match(/^\/api\/sites\/(\d+)\/wp(\/test)?$/);
  if (wpMatch) {
    const sid = Number(wpMatch[1]);
    if (!wpMatch[2] && m === "GET") return wpStatus(env, sid);
    if (!wpMatch[2] && m === "PUT") return wpSave(env, req, user, sid);
    if (wpMatch[2] && m === "POST") return wpTest(env, sid);
  }
  const siteMatch = path.match(/^\/api\/sites\/(\d+)$/);
  if (siteMatch) {
    const id = Number(siteMatch[1]);
    if (m === "GET") return getSite(env, id);
    if (m === "PUT") return updateSite(env, req, user, id);
  }

  // Phục hồi thứ hạng
  if (path === "/api/recovery" && m === "GET") return listCases(env);
  if (path === "/api/recovery" && m === "POST") return createCase(env, req, user, ctx);
  const taskMatch = path.match(/^\/api\/recovery\/tasks\/(\d+)(?:\/(apply|rollback|ai))?$/);
  if (taskMatch) {
    const tid = Number(taskMatch[1]);
    if (!taskMatch[2] && m === "PUT") return decideTask(env, req, user, tid);
    if (taskMatch[2] === "apply" && m === "POST") return applyTask(env, user, tid);
    if (taskMatch[2] === "rollback" && m === "POST") return rollbackTask(env, user, tid);
    if (taskMatch[2] === "ai" && m === "POST") return aiRewriteTask(env, user, tid);
  }
  const recMatch = path.match(/^\/api\/recovery\/(\d+)(?:\/(rescan|rules|disavow|archive|geo))?$/);
  if (recMatch) {
    const id = Number(recMatch[1]);
    const action = recMatch[2];
    if (!action && m === "GET") return getCase(env, id);
    if (action === "rescan" && m === "POST") return rescanCase(env, user, id, ctx);
    if (action === "rules" && m === "PUT") return updateRules(env, req, user, id, ctx);
    if (action === "disavow" && m === "GET") return disavow(env, id);
    if (action === "archive" && m === "POST") return archiveCase(env, user, id);
    if (action === "geo" && m === "POST") return geoDraft(env, req, user, id);
  }

  throw new HttpError(404, "Không có API này.", "not_found");
}

export default {
  async fetch(req: Request, env: Env, ctx?: ExecCtx): Promise<Response> {
    const url = new URL(req.url);
    if (url.pathname.startsWith("/api/")) {
      try {
        return await handleApi(req, env, url, ctx);
      } catch (err) {
        return errorResponse(err);
      }
    }
    // Mọi đường dẫn khác: giao diện (static assets)
    return env.ASSETS.fetch(req);
  },

  async scheduled(_event: CronEvent, env: Env, ctx: ExecCtx): Promise<void> {
    ctx.waitUntil(runCron(env).catch((e) => console.error("cron failed", e)));
    ctx.waitUntil(processRecoveryQueue(env).catch((e) => console.error("recovery cron failed", e)));
  }
};
