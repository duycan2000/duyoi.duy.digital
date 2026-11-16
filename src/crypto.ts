// Mật khẩu (PBKDF2-SHA256), token phiên, và mã hoá API key (AES-GCM). Chỉ dùng WebCrypto có sẵn trong Workers.

const enc = new TextEncoder();
const dec = new TextDecoder();

// Workers giới hạn PBKDF2 tối đa 100.000 vòng.
const PBKDF2_ITERATIONS = 100_000;

export function b64(bytes: ArrayBuffer | Uint8Array): string {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let s = "";
  for (let i = 0; i < u8.length; i++) s += String.fromCharCode(u8[i]!);
  return btoa(s);
}

type Bytes = Uint8Array<ArrayBuffer>;

export function unb64(s: string): Bytes {
  const bin = atob(s);
  const out = new Uint8Array(new ArrayBuffer(bin.length));
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function randomBytes(n: number): Bytes {
  const u8 = new Uint8Array(new ArrayBuffer(n));
  crypto.getRandomValues(u8);
  return u8;
}

export function randomToken(bytes = 32): string {
  return b64(randomBytes(bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", enc.encode(input));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// So sánh không lộ thời gian (dùng cho hash và SETUP_TOKEN).
export function timingSafeEqual(a: string, b: string): boolean {
  const ab = enc.encode(a);
  const bb = enc.encode(b);
  let diff = ab.length ^ bb.length;
  const len = Math.max(ab.length, bb.length);
  for (let i = 0; i < len; i++) diff |= (ab[i] ?? 0) ^ (bb[i] ?? 0);
  return diff === 0;
}

async function pbkdf2(password: string, salt: Bytes, iterations: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations }, key, 256);
  return new Uint8Array(bits);
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const hash = await pbkdf2(password, salt, PBKDF2_ITERATIONS);
  return `pbkdf2$sha256$${PBKDF2_ITERATIONS}$${b64(salt)}$${b64(hash)}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split("$");
  if (parts.length !== 5 || parts[0] !== "pbkdf2" || parts[1] !== "sha256") return false;
  const iterations = Number(parts[2]);
  if (!Number.isInteger(iterations) || iterations < 1 || iterations > PBKDF2_ITERATIONS) return false;
  const hash = await pbkdf2(password, unb64(parts[3]!), iterations);
  return timingSafeEqual(b64(hash), parts[4]!);
}

// Dùng khi email không tồn tại: vẫn tốn thời gian như kiểm tra thật, tránh lộ email nào có tài khoản.
export async function burnPasswordCheck(password: string): Promise<void> {
  await pbkdf2(password, randomBytes(16), PBKDF2_ITERATIONS);
}

// ---------- AES-GCM cho API key ----------

async function aesKey(secretB64: string | undefined): Promise<CryptoKey> {
  if (!secretB64) throw new Error("ENCRYPTION_KEY chưa được đặt");
  const raw = unb64(secretB64);
  if (raw.length !== 32) throw new Error("ENCRYPTION_KEY phải là 32 byte, mã hoá base64");
  return crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt", "decrypt"]);
}

export function encryptionReady(secretB64: string | undefined): boolean {
  if (!secretB64) return false;
  try { return unb64(secretB64).length === 32; } catch { return false; }
}

export async function encryptText(secretB64: string | undefined, plain: string, aad: string): Promise<{ iv: string; ciphertext: string }> {
  const key = await aesKey(secretB64);
  const iv = randomBytes(12);
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: enc.encode(aad) }, key, enc.encode(plain));
  return { iv: b64(iv), ciphertext: b64(ct) };
}

export async function decryptText(secretB64: string | undefined, iv: string, ciphertext: string, aad: string): Promise<string> {
  const key = await aesKey(secretB64);
  const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: unb64(iv), additionalData: enc.encode(aad) }, key, unb64(ciphertext));
  return dec.decode(pt);
}
