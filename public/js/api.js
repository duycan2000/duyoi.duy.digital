// Gọi API của Worker. Cookie phiên là HttpOnly nên trình duyệt tự gửi kèm.

export class ApiError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export async function api(path, { method = "GET", body } = {}) {
  const res = await fetch(path, {
    method,
    credentials: "same-origin",
    headers: body !== undefined ? { "Content-Type": "application/json" } : {},
    body: body !== undefined ? JSON.stringify(body) : undefined
  });
  let data = null;
  try { data = await res.json(); } catch { /* không phải JSON */ }
  if (!res.ok) {
    const err = new ApiError(res.status, data?.error || "error", data?.message || `Lỗi ${res.status}`);
    if (res.status === 401 && !path.startsWith("/api/auth/") && !path.startsWith("/api/setup")) {
      window.dispatchEvent(new CustomEvent("duyoi:unauthorized"));
    }
    throw err;
  }
  return data;
}
