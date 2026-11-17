// Duy Ơi · Worker chính. Giao diện là static assets (thư mục public/); Worker chỉ xử lý /api/* và cron.

import { changePassword, listSessions, login, logout, requireUser, setup, setupStatus, currentUser } from "./auth";
import { listActivity } from "./activity";
import { dashboard, runCron, setPaused } from "./dashboard";
import { HttpError, assertSameOrigin, errorResponse, json } from "./http";
import { getSettings, updateSettings } from "./settings";
import { createSite, getSite, listSites, updateSite } from "./sites";
import { createUser, deleteUser, listUsers, resetUserPassword, updateUser } from "./users";
import type { CronEvent, Env, ExecCtx } from "./types";

async function handleApi(req: Request, env: Env, url: URL): Promise<Response> {
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
  const siteMatch = path.match(/^\/api\/sites\/(\d+)$/);
  if (siteMatch) {
    const id = Number(siteMatch[1]);
    if (m === "GET") return getSite(env, id);
    if (m === "PUT") return updateSite(env, req, user, id);
  }

  throw new HttpError(404, "Không có API này.", "not_found");
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    if (url.pathname.startsWith("/api/")) {
      try {
        return await handleApi(req, env, url);
      } catch (err) {
        return errorResponse(err);
      }
    }
    // Mọi đường dẫn khác: giao diện (static assets)
    return env.ASSETS.fetch(req);
  },

  async scheduled(_event: CronEvent, env: Env, ctx: ExecCtx): Promise<void> {
    ctx.waitUntil(runCron(env).catch((e) => console.error("cron failed", e)));
  }
};
