// Thành viên: admin thêm người, đổi quyền, khoá, đặt lại mật khẩu, xoá.
// Người mới nhận mật khẩu tạm và phải đổi ở lần đăng nhập đầu.

import { hashPassword } from "./crypto";
import { HttpError, json, now, readJson, str } from "./http";
import { logActivity } from "./activity";
import { requireAdmin, validateEmail, validatePassword } from "./auth";
import type { Env, User } from "./types";

const ROLES = ["admin", "editor", "viewer"] as const;
type Role = (typeof ROLES)[number];

interface Row {
  id: number;
  email: string;
  name: string;
  role: Role;
  disabled: number;
  must_change_password: number;
  created_at: number;
  last_login_at: number | null;
}

const COLS = "id, email, name, role, disabled, must_change_password, created_at, last_login_at";

function toMember(r: Row) {
  return {
    id: r.id,
    email: r.email,
    name: r.name,
    role: r.role,
    disabled: Boolean(r.disabled),
    mustChangePassword: Boolean(r.must_change_password),
    createdAt: r.created_at,
    lastLoginAt: r.last_login_at
  };
}

function parseRole(v: unknown): Role {
  if (typeof v !== "string" || !(ROLES as readonly string[]).includes(v)) throw new HttpError(400, "Quyền không hợp lệ.", "validation");
  return v as Role;
}

async function getRow(env: Env, id: number): Promise<Row> {
  const row = await env.DB.prepare(`SELECT ${COLS} FROM users WHERE id = ?`).bind(id).first<Row>();
  if (!row) throw new HttpError(404, "Không tìm thấy thành viên.", "not_found");
  return row;
}

async function activeAdmins(env: Env): Promise<number> {
  const r = await env.DB.prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'admin' AND disabled = 0").first<{ n: number }>();
  return r?.n ?? 0;
}

// Không để app rơi vào cảnh không còn admin nào dùng được.
async function guardLastAdmin(env: Env, target: Row, losesAdmin: boolean): Promise<void> {
  if (losesAdmin && target.role === "admin" && !target.disabled && (await activeAdmins(env)) <= 1) {
    throw new HttpError(409, "Đây là admin cuối cùng. Anh thêm admin khác trước.", "last_admin");
  }
}

// GET /api/users
export async function listUsers(env: Env, user: User): Promise<Response> {
  requireAdmin(user);
  const { results } = await env.DB.prepare(`SELECT ${COLS} FROM users ORDER BY disabled, created_at`).all<Row>();
  return json({ users: results.map(toMember) });
}

// POST /api/users { name, email, role, password }
export async function createUser(env: Env, req: Request, user: User): Promise<Response> {
  requireAdmin(user);
  const body = await readJson(req);
  const name = str(body.name, "Tên", { min: 2, max: 80 });
  const email = validateEmail(body.email);
  const role = parseRole(body.role);
  const password = validatePassword(body.password, "Mật khẩu tạm");
  const exists = await env.DB.prepare("SELECT 1 FROM users WHERE email = ?").bind(email).first();
  if (exists) throw new HttpError(409, "Email này đã có trong danh sách thành viên.", "duplicate");
  const res = await env.DB.prepare(
    "INSERT INTO users (email, name, role, password_hash, created_at, must_change_password, created_by) VALUES (?, ?, ?, ?, ?, 1, ?)"
  ).bind(email, name, role, await hashPassword(password), now(), user.id).run();
  const id = Number(res.meta.last_row_id);
  await logActivity(env, `user:${user.id}`, "user.created", `Thêm thành viên ${email} (${role})`);
  return json({ user: toMember(await getRow(env, id)) }, 201);
}

// PUT /api/users/:id { name?, role?, disabled? }
export async function updateUser(env: Env, req: Request, user: User, id: number): Promise<Response> {
  requireAdmin(user);
  const body = await readJson(req);
  const target = await getRow(env, id);
  const self = target.id === user.id;
  const name = body.name === undefined ? target.name : str(body.name, "Tên", { min: 2, max: 80 });
  const role = body.role === undefined ? target.role : parseRole(body.role);
  const disabled = body.disabled === undefined ? Boolean(target.disabled) : body.disabled === true;
  if (self && role !== target.role) throw new HttpError(400, "Anh không tự đổi quyền của mình được.", "self");
  if (self && disabled) throw new HttpError(400, "Anh không tự khoá tài khoản của mình được.", "self");
  await guardLastAdmin(env, target, role !== "admin" || disabled);

  const stmts = [env.DB.prepare("UPDATE users SET name = ?, role = ?, disabled = ? WHERE id = ?").bind(name, role, disabled ? 1 : 0, id)];
  // Đổi quyền hoặc khoá: đăng xuất người đó ngay để quyền mới có hiệu lực.
  if (role !== target.role || (disabled && !target.disabled)) stmts.push(env.DB.prepare("DELETE FROM sessions WHERE user_id = ?").bind(id));
  await env.DB.batch(stmts);

  const changes: string[] = [];
  if (name !== target.name) changes.push("đổi tên");
  if (role !== target.role) changes.push(`quyền ${target.role} → ${role}`);
  if (disabled !== Boolean(target.disabled)) changes.push(disabled ? "khoá" : "mở khoá");
  if (changes.length) await logActivity(env, `user:${user.id}`, "user.updated", `${target.email}: ${changes.join(", ")}`);
  return json({ user: toMember(await getRow(env, id)) });
}

// POST /api/users/:id/password { password } — đặt mật khẩu tạm mới, bắt đổi khi đăng nhập
export async function resetUserPassword(env: Env, req: Request, user: User, id: number): Promise<Response> {
  requireAdmin(user);
  const body = await readJson(req);
  const target = await getRow(env, id);
  if (target.id === user.id) throw new HttpError(400, "Mật khẩu của anh thì đổi ở màn Tài khoản.", "self");
  const password = validatePassword(body.password, "Mật khẩu tạm");
  await env.DB.batch([
    env.DB.prepare("UPDATE users SET password_hash = ?, must_change_password = 1 WHERE id = ?").bind(await hashPassword(password), id),
    env.DB.prepare("DELETE FROM sessions WHERE user_id = ?").bind(id)
  ]);
  await logActivity(env, `user:${user.id}`, "user.password_reset", `Đặt lại mật khẩu cho ${target.email}`);
  return json({ ok: true });
}

// DELETE /api/users/:id
export async function deleteUser(env: Env, user: User, id: number): Promise<Response> {
  requireAdmin(user);
  const target = await getRow(env, id);
  if (target.id === user.id) throw new HttpError(400, "Anh không tự xoá tài khoản của mình được.", "self");
  await guardLastAdmin(env, target, true);
  await env.DB.batch([
    env.DB.prepare("DELETE FROM sessions WHERE user_id = ?").bind(id),
    env.DB.prepare("DELETE FROM users WHERE id = ?").bind(id)
  ]);
  await logActivity(env, `user:${user.id}`, "user.deleted", `Xoá thành viên ${target.email}`);
  return json({ ok: true });
}
