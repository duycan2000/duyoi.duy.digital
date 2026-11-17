// Máy chủ thử trong Node (không cần wrangler): node tests/serve.mjs [port]
// Dữ liệu nằm trong bộ nhớ, mất khi tắt. Dùng để xem giao diện và chạy test trình duyệt.

import { createServer } from "node:http";
import { loadWorker, makeEnv } from "./harness.mjs";
import { fakeSite } from "./fake-site.mjs";

// FAKE_SITE=1: mọi lệnh tải trang ra ngoài trả về site giả caddemo.de (để thử chức năng Phục hồi khi không có mạng)
if (process.env.FAKE_SITE) globalThis.fetch = fakeSite({ wp: { user: "duyoi-bot", pass: "abcd efgh ijkl mnop" } });

const port = Number(process.argv[2]) || 8788;
const worker = await loadWorker();
const env = makeEnv({ SETUP_TOKEN: process.env.SETUP_TOKEN || "local-setup-token" });

createServer(async (req, res) => {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const url = `http://${req.headers.host}${req.url}`;
  const headers = new Headers();
  for (const [k, v] of Object.entries(req.headers)) if (typeof v === "string") headers.set(k, v);
  headers.set("CF-Connecting-IP", "127.0.0.1");
  const body = chunks.length && req.method !== "GET" && req.method !== "HEAD" ? Buffer.concat(chunks) : undefined;
  const waits = [];
  const r = await worker.fetch(new Request(url, { method: req.method, headers, body }), env, { waitUntil: (p) => waits.push(p) });
  res.writeHead(r.status, Object.fromEntries(r.headers));
  res.end(Buffer.from(await r.arrayBuffer()));
}).listen(port, () => console.log(`Duy Ơi chạy thử tại http://localhost:${port} (SETUP_TOKEN=${env.SETUP_TOKEN})`));
