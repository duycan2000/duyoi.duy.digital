// Cài đặt chung và API key (mã hoá). Key không bao giờ trả về trình duyệt, chỉ trả gợi ý vài ký tự cuối.

import { decryptText, encryptText, encryptionProblem, encryptionReady } from "./crypto";
import { HttpError, json, now, readJson } from "./http";
import { logActivity } from "./activity";
import type { Env, User } from "./types";

export const SECRET_KEYS = {
  openrouter_api_key: "OpenRouter API key",
  dataforseo_login: "DataForSEO login",
  dataforseo_password: "DataForSEO password",
  groq_api_key: "Groq API key",
  cloudflare_api_token: "Cloudflare API token",
  google_api_key: "Google Cloud API key",
  google_service_account: "Google service account (JSON)",
  github_token: "GitHub token (đăng bài lên repo site Astro)",
  pinterest_app_id: "Pinterest App ID",
  pinterest_app_secret: "Pinterest App secret",
  meta_app_id: "Meta (Facebook) App ID",
  meta_app_secret: "Meta (Facebook) App secret",
  linkedin_client_id: "LinkedIn Client ID",
  linkedin_client_secret: "LinkedIn Client secret",
  x_client_id: "X (Twitter) Client ID",
  x_client_secret: "X (Twitter) Client secret"
} as const;
export type SecretKey = keyof typeof SECRET_KEYS;

// Giá trị mặc định cho cài đặt thường. Kiểu của từng khoá dùng để kiểm tra dữ liệu gửi lên.
export const DEFAULTS = {
  paused: false,
  free_models_enabled: true,
  free_guard_percent: 90,
  openrouter_monthly_cap_usd: 30,
  dataforseo_monthly_cap_usd: 20,
  ai_site_daily_cap_usd: 2,
  model_free: "openrouter/free",
  model_free_private: "groq/openai/gpt-oss-120b",
  model_t0: "deepseek/deepseek-v4-flash",
  model_t1: "deepseek/deepseek-v4-pro",
  model_t2: "anthropic/claude-haiku-5.5",
  model_t3: "anthropic/claude-sonnet-5.5",
  model_writer: "anthropic/claude-sonnet-5.5",
  model_image: "openai/gpt-image-2",
  timezone: "Asia/Ho_Chi_Minh",
  cloudflare_account_id: "-"
} as const;
type SettingKey = keyof typeof DEFAULTS;

// Khoá chỉ hệ thống ghi (cron), không cho sửa qua API
const SYSTEM_KEYS = ["cron_last_run"] as const;

function validValue(key: SettingKey, v: unknown): unknown {
  const def = DEFAULTS[key];
  if (typeof def === "boolean") {
    if (typeof v !== "boolean") throw new HttpError(400, `${key} phải là true/false.`, "validation");
    return v;
  }
  if (typeof def === "number") {
    const n = Number(v);
    if (!Number.isFinite(n) || n < 0 || n > 100000) throw new HttpError(400, `${key} không hợp lệ.`, "validation");
    if (key === "free_guard_percent" && (n < 50 || n > 100)) throw new HttpError(400, "Ngưỡng chuyển sang trả phí nằm trong 50–100%.", "validation");
    return n;
  }
  if (key === "cloudflare_account_id") {
    const s = String(v ?? "").trim().toLowerCase();
    if (s === "" || s === "-") return "-";
    if (!/^[a-f0-9]{32}$/.test(s)) throw new HttpError(400, "Account ID Cloudflare là chuỗi 32 ký tự (Cloudflare › trang tổng quan tài khoản › Account ID).", "validation");
    return s;
  }
  if (typeof v !== "string" || !v.trim() || v.length > 120 || /\s/.test(v.trim())) throw new HttpError(400, `${key} không hợp lệ.`, "validation");
  return v.trim();
}

export async function getSettingsMap(env: Env): Promise<Record<string, unknown>> {
  const { results } = await env.DB.prepare("SELECT key, value FROM settings").all<{ key: string; value: string }>();
  const out: Record<string, unknown> = { ...DEFAULTS };
  for (const r of results) {
    try { out[r.key] = JSON.parse(r.value); } catch { /* bỏ qua giá trị hỏng */ }
  }
  return out;
}

export async function setSetting(env: Env, key: string, value: unknown): Promise<void> {
  await env.DB.prepare("INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at")
    .bind(key, JSON.stringify(value), now()).run();
}

function hintOf(v: string): string {
  return v.length <= 8 ? "•".repeat(v.length) : `…${v.slice(-4)}`;
}

// GET /api/settings
export async function getSettings(env: Env): Promise<Response> {
  const values = await getSettingsMap(env);
  const { results } = await env.DB.prepare("SELECT key, hint, updated_at FROM secrets").all<{ key: string; hint: string; updated_at: number }>();
  const secrets: Record<string, { label: string; set: boolean; hint: string | null; updatedAt: number | null }> = {};
  for (const [k, label] of Object.entries(SECRET_KEYS)) {
    const r = results.find((x) => x.key === k);
    secrets[k] = { label, set: Boolean(r), hint: r?.hint ?? null, updatedAt: r?.updated_at ?? null };
  }
  return json({ values, secrets, encryptionReady: encryptionReady(env.ENCRYPTION_KEY), encryptionProblem: encryptionProblem(env.ENCRYPTION_KEY) });
}

// PUT /api/settings  { values?: {...}, secrets?: { key: "giá trị" | null } }
export async function updateSettings(env: Env, req: Request, user: User): Promise<Response> {
  if (user.role !== "admin") throw new HttpError(403, "Chỉ admin được đổi cài đặt.", "forbidden");
  const body = await readJson<{ values?: Record<string, unknown>; secrets?: Record<string, unknown> }>(req);
  const changed: string[] = [];

  if (body.values && typeof body.values === "object") {
    for (const [k, v] of Object.entries(body.values)) {
      if ((SYSTEM_KEYS as readonly string[]).includes(k) || !(k in DEFAULTS)) throw new HttpError(400, `Không có cài đặt ${k}.`, "validation");
      await setSetting(env, k, validValue(k as SettingKey, v));
      changed.push(k);
    }
  }

  if (body.secrets && typeof body.secrets === "object") {
    const entries = Object.entries(body.secrets);
    if (entries.some(([, v]) => v !== null) && !encryptionReady(env.ENCRYPTION_KEY)) {
      throw new HttpError(503, encryptionProblem(env.ENCRYPTION_KEY) === "invalid" ? "ENCRYPTION_KEY sai định dạng: cần đúng 32 byte mã hoá base64 (44 ký tự, kết thúc bằng =)." : "Worker chưa có secret ENCRYPTION_KEY nên chưa lưu được API key.", "encryption_missing");
    }
    for (const [k, v] of entries) {
      if (!(k in SECRET_KEYS)) throw new HttpError(400, `Không có key ${k}.`, "validation");
      if (v === null) {
        await env.DB.prepare("DELETE FROM secrets WHERE key = ?").bind(k).run();
      } else {
        const max = k === "google_service_account" ? 6000 : 500;
        if (typeof v !== "string" || !v.trim() || v.length > max) throw new HttpError(400, `${SECRET_KEYS[k as SecretKey]} không hợp lệ.`, "validation");
        const plain = v.trim();
        let hint = hintOf(plain);
        if (k === "google_service_account") {
          // Chỉ nhận file JSON của service account; gợi ý là email service account (không phải bí mật, cần để cấp quyền trong GSC/GA4)
          let sa: { client_email?: string; private_key?: string } = {};
          try { sa = JSON.parse(plain); } catch { /* báo lỗi bên dưới */ }
          if (!sa.client_email || !sa.private_key || !String(sa.private_key).includes("PRIVATE KEY")) throw new HttpError(400, "Cần dán nguyên file JSON của service account (có client_email và private_key).", "validation");
          hint = sa.client_email;
        }
        const { iv, ciphertext } = await encryptText(env.ENCRYPTION_KEY, plain, k);
        await env.DB.prepare("INSERT INTO secrets (key, iv, ciphertext, hint, updated_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(key) DO UPDATE SET iv = excluded.iv, ciphertext = excluded.ciphertext, hint = excluded.hint, updated_at = excluded.updated_at")
          .bind(k, iv, ciphertext, hint, now()).run();
      }
      changed.push(k);
    }
  }

  if (!changed.length) throw new HttpError(400, "Không có gì để lưu.", "validation");
  // Ghi tên khoá đã đổi, không ghi giá trị
  await logActivity(env, `user:${user.id}`, "settings.updated", changed.join(", "));
  return getSettings(env);
}

// Dùng nội bộ ở các giai đoạn sau (gọi OpenRouter, DataForSEO…). Không bao giờ trả ra API.
export async function readSecret(env: Env, key: SecretKey): Promise<string | null> {
  const r = await env.DB.prepare("SELECT iv, ciphertext FROM secrets WHERE key = ?").bind(key).first<{ iv: string; ciphertext: string }>();
  if (!r) return null;
  return decryptText(env.ENCRYPTION_KEY, r.iv, r.ciphertext, key);
}

// ---- Bí mật theo site (Application Password WordPress). Khoá lưu dạng "wp:<siteId>". ----

const siteKey = (siteId: number) => `wp:${siteId}`;

export async function setSiteSecret(env: Env, siteId: number, value: string | null): Promise<void> {
  const key = siteKey(siteId);
  if (value === null) { await env.DB.prepare("DELETE FROM secrets WHERE key = ?").bind(key).run(); return; }
  if (!encryptionReady(env.ENCRYPTION_KEY)) throw new HttpError(503, "Worker chưa có ENCRYPTION_KEY hợp lệ nên chưa lưu được mật khẩu.", "encryption_missing");
  const plain = value.trim();
  if (!plain || plain.length > 200) throw new HttpError(400, "Application Password không hợp lệ.", "validation");
  const { iv, ciphertext } = await encryptText(env.ENCRYPTION_KEY, plain, key);
  await env.DB.prepare("INSERT INTO secrets (key, iv, ciphertext, hint, updated_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(key) DO UPDATE SET iv = excluded.iv, ciphertext = excluded.ciphertext, hint = excluded.hint, updated_at = excluded.updated_at")
    .bind(key, iv, ciphertext, hintOf(plain.replace(/\s/g, "")), now()).run();
}

export async function siteSecretInfo(env: Env, siteId: number): Promise<{ set: boolean; hint: string | null; updatedAt: number | null }> {
  const r = await env.DB.prepare("SELECT hint, updated_at FROM secrets WHERE key = ?").bind(siteKey(siteId)).first<{ hint: string; updated_at: number }>();
  return { set: Boolean(r), hint: r?.hint ?? null, updatedAt: r?.updated_at ?? null };
}

// Dùng nội bộ để gọi WordPress. Không bao giờ trả ra API.
export async function readSiteSecret(env: Env, siteId: number): Promise<string | null> {
  const key = siteKey(siteId);
  const r = await env.DB.prepare("SELECT iv, ciphertext FROM secrets WHERE key = ?").bind(key).first<{ iv: string; ciphertext: string }>();
  if (!r) return null;
  return decryptText(env.ENCRYPTION_KEY, r.iv, r.ciphertext, key);
}
