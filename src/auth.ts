// Tạo admin đầu tiên, đăng nhập, đăng xuất, phiên, đổi mật khẩu.

import { burnPasswordCheck, hashPassword, randomToken, sha256Hex, timingSafeEqual, verifyPassword } from "./crypto";
import { HttpError, clientIp, getCookie, json, now, readJson, sessionCookie, str } from "./http";
import { logActivity } from "./activity";
import type { Env, User } from "./types";

export const COOKIE = "duyoi_session";
const SESSION_DAYS = 30;
const SESSION_MS = SESSION_DAYS * 24 * 3600 * 1000;
const LOCK_WINDOW_MS = 15 * 60 * 1000;
const MAX_FAILS = 5;
const MIN_PASSWORD = 10;

const isSecure = (req: Request): boolean => new URL(req.url).protocol === "https:";

export function validateEmail(v: unknown): string {
  const email = str(v, "Email", { max: 200 }).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new HttpError(400, "Email không hợp lệ.", "validation");
  return email;
}

export function validatePassword(v: unknown, field = "Mật khẩu"): string {
  if (typeof v !== "string") throw new HttpError(400, `Thiếu ${field.toLowerCase()}.`, "validation");
  if (v.length < MIN_PASSWORD) throw new HttpError(400, `${field} cần ít nhất ${MIN_PASSWORD} ký tự.`, "validation");
  if (v.length > 200) throw new HttpError(400, `${field} quá dài.`, "validation");
  return v;
}

async function userCount(env: Env): Promise<number> {
  const row = await env.DB.prepare("SELECT COUNT(*) AS n FROM users").first<{ n: number }>();
  return row?.n ?? 0;
}

async function createSession(env: Env, req: Request, userId: number): Promise<string> {
  const token = randomToken(32);
  const id = await sha256Hex(token);
  const t = now();
  await env.DB.prepare("INSERT INTO sessions (id, user_id, created_at, expires_at, ip, user_agent) VALUES (?, ?, ?, ?, ?, ?)")
    .bind(id, userId, t, t + SESSION_MS, clientIp(req), (req.headers.get("User-Agent") || "").slice(0, 200))
    .run();
  // Dọn phiên hết hạn (rẻ, có index)
  await env.DB.prepare("DELETE FROM sessions WHERE expires_at < ?").bind(t).run();
  return token;
}

export async function currentUser(env: Env, req: Request): Promise<User | null> {
  const token = getCookie(req, COOKIE);
  if (!token || token.length > 100) return null;
  const id = await sha256Hex(token);
  const row = await env.DB.prepare(
    "SELECT u.id, u.email, u.name, u.role, u.must_change_password AS mcp FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.id = ? AND s.expires_at > ? AND u.disabled = 0"
  ).bind(id, now()).first<User & { mcp: number }>();
  if (!row) return null;
  return { id: row.id, email: row.email, name: row.name, role: row.role, mustChangePassword: Boolean(row.mcp) };
}

export async function requireUser(env: Env, req: Request): Promise<User> {
  const user = await currentUser(env, req);
  if (!user) throw new HttpError(401, "Anh cần đăng nhập.", "unauthorized");
  return user;
}

export function requireAdmin(user: User): void {
  if (user.role !== "admin") throw new HttpError(403, "Chỉ admin được làm việc này.", "forbidden");
}

// GET /api/setup/status
export async function setupStatus(env: Env): Promise<Response> {
  const n = await userCount(env);
  return json({
    appName: env.APP_NAME || "Duy Ơi",
    needsSetup: n === 0,
    setupTokenConfigured: Boolean(env.SETUP_TOKEN && env.SETUP_TOKEN.length >= 12)
  });
}

// POST /api/setup — chỉ chạy được khi chưa có người dùng nào, và phải có SETUP_TOKEN đúng.
export async function setup(env: Env, req: Request): Promise<Response> {
  if (!env.SETUP_TOKEN || env.SETUP_TOKEN.length < 12) {
    throw new HttpError(503, "Chưa đặt SETUP_TOKEN (tối thiểu 12 ký tự) cho Worker. Xem README.", "setup_token_missing");
  }
  if ((await userCount(env)) > 0) throw new HttpError(409, "Đã có admin. Hãy đăng nhập.", "already_setup");
  const body = await readJson(req);
  if ((await recentFails(env, clientIp(req), "__setup__")) >= MAX_FAILS) {
    throw new HttpError(429, "Nhập sai mã cài đặt quá nhiều lần. Thử lại sau 15 phút.", "too_many_attempts");
  }
  const token = typeof body.setupToken === "string" ? body.setupToken : "";
  if (!timingSafeEqual(token, env.SETUP_TOKEN)) {
    await env.DB.prepare("INSERT INTO login_attempts (ip, email, at) VALUES (?, '__setup__', ?)").bind(clientIp(req), now()).run();
    throw new HttpError(403, "Mã cài đặt không đúng.", "bad_setup_token");
  }
  const name = str(body.name, "Tên", { min: 2, max: 80 });
  const email = validateEmail(body.email);
  const password = validatePassword(body.password);
  const hash = await hashPassword(password);
  const t = now();
  // Chèn có điều kiện để hai người bấm cùng lúc không tạo được hai admin.
  const res = await env.DB.prepare(
    "INSERT INTO users (email, name, role, password_hash, created_at, last_login_at) SELECT ?, ?, 'admin', ?, ?, ? WHERE NOT EXISTS (SELECT 1 FROM users)"
  ).bind(email, name, hash, t, t).run();
  if (!res.meta.changes) throw new HttpError(409, "Đã có admin. Hãy đăng nhập.", "already_setup");
  const user = await env.DB.prepare("SELECT id, email, name, role FROM users WHERE email = ?").bind(email).first<User>();
  if (!user) throw new HttpError(500, "Không tạo được admin.", "internal");
  const session = await createSession(env, req, user.id);
  await logActivity(env, `user:${user.id}`, "setup.admin_created", `Tạo admin ${email}`);
  return json({ user }, 201, { "Set-Cookie": sessionCookie(COOKIE, session, SESSION_MS / 1000, isSecure(req)) });
}

async function recentFails(env: Env, ip: string, email: string): Promise<number> {
  const since = now() - LOCK_WINDOW_MS;
  const row = await env.DB.prepare(
    "SELECT (SELECT COUNT(*) FROM login_attempts WHERE ip = ? AND at > ?) AS by_ip, (SELECT COUNT(*) FROM login_attempts WHERE email = ? AND at > ?) AS by_email"
  ).bind(ip, since, email, since).first<{ by_ip: number; by_email: number }>();
  return Math.max(row?.by_ip ?? 0, row?.by_email ?? 0);
}

// POST /api/auth/login
export async function login(env: Env, req: Request): Promise<Response> {
  const body = await readJson(req);
  const email = validateEmail(body.email);
  const password = typeof body.password === "string" ? body.password.slice(0, 200) : "";
  const ip = clientIp(req);
  if ((await recentFails(env, ip, email)) >= MAX_FAILS) {
    throw new HttpError(429, "Sai quá nhiều lần. Thử lại sau 15 phút.", "too_many_attempts");
  }
  const row = await env.DB.prepare("SELECT id, email, name, role, password_hash, disabled, must_change_password FROM users WHERE email = ?")
    .bind(email).first<User & { password_hash: string; disabled: number; must_change_password: number }>();
  let ok = false;
  if (row) ok = await verifyPassword(password, row.password_hash);
  else await burnPasswordCheck(password);
  if (!row || !ok) {
    await env.DB.prepare("INSERT INTO login_attempts (ip, email, at) VALUES (?, ?, ?)").bind(ip, email, now()).run();
    throw new HttpError(401, "Email hoặc mật khẩu không đúng.", "bad_credentials");
  }
  if (row.disabled) throw new HttpError(403, "Tài khoản này đã bị khoá. Anh liên hệ admin.", "disabled");
  await env.DB.batch([
    env.DB.prepare("DELETE FROM login_attempts WHERE email = ? OR at < ?").bind(email, now() - LOCK_WINDOW_MS),
    env.DB.prepare("UPDATE users SET last_login_at = ? WHERE id = ?").bind(now(), row.id)
  ]);
  const session = await createSession(env, req, row.id);
  await logActivity(env, `user:${row.id}`, "auth.login", `Đăng nhập từ ${ip}`);
  const user: User = { id: row.id, email: row.email, name: row.name, role: row.role, mustChangePassword: Boolean(row.must_change_password) };
  return json({ user }, 200, { "Set-Cookie": sessionCookie(COOKIE, session, SESSION_MS / 1000, isSecure(req)) });
}

// POST /api/auth/logout
export async function logout(env: Env, req: Request): Promise<Response> {
  const token = getCookie(req, COOKIE);
  if (token) await env.DB.prepare("DELETE FROM sessions WHERE id = ?").bind(await sha256Hex(token)).run();
  return json({ ok: true }, 200, { "Set-Cookie": sessionCookie(COOKIE, "", 0, isSecure(req)) });
}

// POST /api/auth/password — đổi mật khẩu và đăng xuất các phiên khác
export async function changePassword(env: Env, req: Request, user: User): Promise<Response> {
  const body = await readJson(req);
  const current = typeof body.current === "string" ? body.current : "";
  const next = validatePassword(body.next, "Mật khẩu mới");
  const row = await env.DB.prepare("SELECT password_hash FROM users WHERE id = ?").bind(user.id).first<{ password_hash: string }>();
  if (!row || !(await verifyPassword(current, row.password_hash))) throw new HttpError(400, "Mật khẩu hiện tại không đúng.", "bad_credentials");
  if (current === next) throw new HttpError(400, "Mật khẩu mới phải khác mật khẩu hiện tại.", "validation");
  const token = getCookie(req, COOKIE) || "";
  const keep = await sha256Hex(token);
  await env.DB.batch([
    env.DB.prepare("UPDATE users SET password_hash = ?, must_change_password = 0 WHERE id = ?").bind(await hashPassword(next), user.id),
    env.DB.prepare("DELETE FROM sessions WHERE user_id = ? AND id != ?").bind(user.id, keep)
  ]);
  await logActivity(env, `user:${user.id}`, "auth.password_changed", "Đổi mật khẩu, đăng xuất các phiên khác");
  return json({ ok: true });
}

// GET /api/auth/sessions — các phiên đang mở của chính mình
export async function listSessions(env: Env, req: Request, user: User): Promise<Response> {
  const token = getCookie(req, COOKIE) || "";
  const cur = await sha256Hex(token);
  const { results } = await env.DB.prepare(
    "SELECT id, created_at, expires_at, ip, user_agent FROM sessions WHERE user_id = ? AND expires_at > ? ORDER BY created_at DESC LIMIT 20"
  ).bind(user.id, now()).all<{ id: string; created_at: number; expires_at: number; ip: string; user_agent: string }>();
  return json({ sessions: results.map((s) => ({ current: s.id === cur, createdAt: s.created_at, expiresAt: s.expires_at, ip: s.ip, userAgent: s.user_agent })) });
}
