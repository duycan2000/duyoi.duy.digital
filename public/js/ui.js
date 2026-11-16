// Tiện ích giao diện nhỏ. Mọi dữ liệu đưa vào HTML đều qua esc().

export const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export function fmtTime(ms) {
  if (!ms) return "—";
  return new Date(ms).toLocaleString("vi-VN", { dateStyle: "short", timeStyle: "short" });
}

export function ago(ms) {
  if (!ms) return "chưa có";
  const s = Math.round((Date.now() - ms) / 1000);
  if (s < 60) return "vừa xong";
  if (s < 3600) return `${Math.round(s / 60)} phút trước`;
  if (s < 86400) return `${Math.round(s / 3600)} giờ trước`;
  return `${Math.round(s / 86400)} ngày trước`;
}

export function showMsg(el, text, kind = "err") {
  if (!el) return;
  el.textContent = text;
  el.className = `msg ${kind}`;
  el.hidden = !text;
}

// Khoá nút trong lúc gửi, trả lại chữ cũ khi xong.
export async function busy(btn, label, fn) {
  const old = btn.textContent;
  btn.disabled = true;
  btn.textContent = label;
  try { return await fn(); } finally { btn.disabled = false; btn.textContent = old; }
}

export function formData(form) {
  const out = {};
  for (const el of form.elements) {
    if (!el.name) continue;
    if (el.type === "checkbox") out[el.name] = el.checked;
    else if (el.type === "number") out[el.name] = el.value === "" ? null : Number(el.value);
    else out[el.name] = el.value;
  }
  return out;
}
