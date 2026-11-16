// Tiện ích HTTP: JSON, lỗi, đọc body an toàn, cookie.

export class HttpError extends Error {
  constructor(public status: number, message: string, public code = "error") {
    super(message);
  }
}

const SECURITY_HEADERS: Record<string, string> = {
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "same-origin"
};

export function json(data: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", ...SECURITY_HEADERS, ...headers }
  });
}

export function errorResponse(err: unknown): Response {
  if (err instanceof HttpError) return json({ error: err.code, message: err.message }, err.status);
  console.error("Unhandled error", err);
  return json({ error: "internal", message: "Có lỗi phía máy chủ. Xem log của Worker." }, 500);
}

const MAX_BODY = 64 * 1024;

export async function readJson<T = Record<string, unknown>>(req: Request): Promise<T> {
  const type = req.headers.get("Content-Type") || "";
  if (!type.includes("application/json")) throw new HttpError(415, "Cần gửi JSON.", "unsupported_media_type");
  const text = await req.text();
  if (text.length > MAX_BODY) throw new HttpError(413, "Dữ liệu gửi lên quá lớn.", "too_large");
  try {
    const v = JSON.parse(text || "{}");
    if (!v || typeof v !== "object" || Array.isArray(v)) throw new Error("not an object");
    return v as T;
  } catch {
    throw new HttpError(400, "JSON không hợp lệ.", "bad_json");
  }
}

export function getCookie(req: Request, name: string): string | null {
  const raw = req.headers.get("Cookie");
  if (!raw) return null;
  for (const part of raw.split(";")) {
    const i = part.indexOf("=");
    if (i < 0) continue;
    if (part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return null;
}

export function sessionCookie(name: string, value: string, maxAgeSec: number, secure: boolean): string {
  return [
    `${name}=${encodeURIComponent(value)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Strict",
    `Max-Age=${maxAgeSec}`,
    secure ? "Secure" : ""
  ].filter(Boolean).join("; ");
}

export function clientIp(req: Request): string {
  return req.headers.get("CF-Connecting-IP") || req.headers.get("X-Forwarded-For")?.split(",")[0]?.trim() || "unknown";
}

// Chặn CSRF: mọi request thay đổi dữ liệu phải đến từ chính trang của app.
export function assertSameOrigin(req: Request): void {
  if (req.method === "GET" || req.method === "HEAD") return;
  const origin = req.headers.get("Origin");
  const host = new URL(req.url).origin;
  if (!origin || origin !== host) throw new HttpError(403, "Request không đến từ trang của app.", "bad_origin");
}

export function str(v: unknown, field: string, opts: { min?: number; max?: number; optional?: boolean } = {}): string {
  if (v == null || v === "") {
    if (opts.optional) return "";
    throw new HttpError(400, `Thiếu ${field}.`, "validation");
  }
  if (typeof v !== "string") throw new HttpError(400, `${field} không hợp lệ.`, "validation");
  const s = v.trim();
  if (opts.min && s.length < opts.min) throw new HttpError(400, `${field} cần ít nhất ${opts.min} ký tự.`, "validation");
  if (opts.max && s.length > opts.max) throw new HttpError(400, `${field} tối đa ${opts.max} ký tự.`, "validation");
  return s;
}

export const now = (): number => Date.now();
