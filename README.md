# Duy Ơi

Nền tảng AI agent làm SEO, AEO và GEO cho nhiều site. Chạy hoàn toàn trên Cloudflare: Workers, D1, và từ các giai đoạn sau thêm Queues, Workflows, R2, Email Routing.

App **không dựng site**. Anh dựng site bằng Claude, rồi khai báo site ở đây để các agent nghiên cứu, viết bài, theo dõi thứ hạng, làm off-page.

> Bản này là **giai đoạn 1 (nền tảng)**: màn tạo admin, đăng nhập, quản lý site, cài đặt API key được mã hoá, tạm dừng hệ thống, nhật ký, cron.
> Menu đã có đủ các mục như bản demo. Mục nào chưa làm thì hiện nội dung sẽ có và thuộc giai đoạn nào. Xem [docs/ROADMAP.md](docs/ROADMAP.md).

## Deploy lần đầu

Cần: Node 22 trở lên, tài khoản Cloudflare. Giai đoạn 1 chạy được trên gói Workers Free. Từ giai đoạn 2 (Queues, Workflows) nên dùng gói Workers Paid $5/tháng.

```bash
git clone https://github.com/duycan2000/duyoi.duy.digital
cd duyoi.duy.digital
npm install
npx wrangler login
```

### 1. Tạo database D1

```bash
npx wrangler d1 create duyoi
```

Lệnh in ra `database_id`. Mở `wrangler.jsonc`, thay `REPLACE_WITH_YOUR_D1_DATABASE_ID` bằng giá trị đó. Sau đó tạo bảng:

```bash
npm run db:migrate:remote
```

### 2. Đặt secrets

Hai giá trị này **không** ghi vào file, chỉ lưu trong Cloudflare.

```bash
# Mã dùng một lần để tạo admin đầu tiên (ít nhất 12 ký tự). Tạo ngẫu nhiên:
node -e "console.log(require('crypto').randomBytes(18).toString('base64url'))"
npx wrangler secret put SETUP_TOKEN

# Khoá mã hoá API key (32 byte, base64). Tạo ngẫu nhiên:
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
npx wrangler secret put ENCRYPTION_KEY
```

Cất `ENCRYPTION_KEY` vào trình quản lý mật khẩu. Nếu mất hoặc đổi khoá này, các API key đã lưu không giải mã được nữa và anh phải nhập lại.

### 3. Deploy

```bash
npm run deploy
```

`wrangler.jsonc` đã khai báo tên miền `duyoi.duy.digital`. Zone `duy.digital` phải nằm trong cùng tài khoản Cloudflare. Nếu chưa có, xoá khối `routes` và dùng địa chỉ `*.workers.dev` mà wrangler in ra.

### 4. Tạo admin

Mở `https://duyoi.duy.digital`. Lần đầu app hiện màn **Tạo tài khoản admin**:

- nhập `SETUP_TOKEN` ở bước 2
- nhập tên, email, mật khẩu (ít nhất 10 ký tự)

Sau khi có admin, màn này không còn nữa. Lần sau vào là màn đăng nhập.

Khi đã tạo admin, `SETUP_TOKEN` hết tác dụng. Muốn chắc chắn, đổi nó sang một giá trị ngẫu nhiên khác.

### 5. Việc nên làm ngay sau deploy

- **Cài đặt:** nhập OpenRouter key và DataForSEO login/password. Key được mã hoá AES-GCM trước khi lưu vào D1 và không bao giờ trả ngược về trình duyệt.
- **Site:** thêm site đầu tiên.
- **Thành viên** (chỉ admin): thêm người với quyền Admin, Biên tập hoặc Chỉ xem. App tạo mật khẩu tạm, hiện một lần để anh gửi riêng; người đó phải đặt mật khẩu mới ở lần đăng nhập đầu. Admin khoá, đổi quyền, đặt lại mật khẩu hoặc xoá được; đổi quyền hay khoá thì người đó bị đăng xuất ngay. App luôn giữ ít nhất một admin. Nếu dùng Cloudflare Access, nhớ thêm email của thành viên vào policy.
- **Cloudflare → Billing → Billable Usage:** tạo budget alert $10 / $25 / $50.
- **Thêm một lớp bảo vệ (khuyên dùng):** đặt Cloudflare Access (Zero Trust, miễn phí tới 50 người) trước `duyoi.duy.digital`, chỉ cho email của anh vào.

## Phục hồi thứ hạng

Menu **Phục hồi › Phục hồi thứ hạng**: nhập địa chỉ site (và tháng bắt đầu tụt). App đọc robots.txt và sitemap, quét tối đa 400 trang như Googlebot (không cần mật khẩu, không sửa gì), rồi:

- chấm điểm sức khoẻ và xếp nguyên nhân: nội dung mỏng/hàng loạt, ăn thịt từ khoá, bài thông tin cụt (không dẫn tới trang dịch vụ), trang dịch vụ ít link nội bộ, lỗi kỹ thuật (noindex, canonical, URL lỗi), blocklist pháp lý, dấu biên tập còn sót, link chéo giữa các site của anh;
- đối chiếu tháng tụt với các bản cập nhật Google đã xác nhận (`src/google-updates.ts`, thêm bản mới vào cuối danh sách);
- lập việc cho đội 9 agent. Việc sửa nội dung là danh sách find/replace "phẫu thuật" (giữ nguyên câu gốc, thêm link/CTA), đã qua **Gác cổng**: blocklist, dấu biên tập, ngôn ngữ, số liệu không nguồn, đoạn gốc phải khớp đúng 1 lần, tối đa 3 link mỗi trang.

Không việc nào tự đăng lên site. Redirect, xoá trang, đổi canonical, disavow là việc "khó đảo ngược": chỉ admin duyệt và người làm tay. Áp dụng việc đã duyệt vào WordPress (bản nháp, sao lưu, hoàn tác, sửa `_elementor_data`, xoá cache) là giai đoạn kế tiếp.

Luật riêng của từng site (blocklist, ngôn ngữ, trang dịch vụ, số liệu đã kiểm chứng…) nhập ở tab **Luật an toàn**, lưu trong D1. Không ghi luật của khách vào code vì repo công khai.

Thử trên máy không cần mạng: `FAKE_SITE=1 node tests/serve.mjs` rồi nhập `caddemo.de`.

## Chạy trên máy

```bash
cp .dev.vars.example .dev.vars   # rồi điền SETUP_TOKEN và ENCRYPTION_KEY
npm run db:migrate:local
npm run dev
```

Muốn chạy thử không cần wrangler (dữ liệu nằm trong bộ nhớ):

```bash
node tests/serve.mjs   # http://localhost:8788, SETUP_TOKEN=local-setup-token
```

## Kiểm thử

```bash
npm run typecheck
npm test               # 20 test cho tạo admin, đăng nhập, khoá khi sai nhiều lần, site, key mã hoá, tạm dừng, cron
```

Test chạy Worker ngay trong Node, dùng `node:sqlite` thay cho D1, nên cần Node 22.5 trở lên.

## Cấu trúc

```
src/
  index.ts       định tuyến /api/* và cron
  auth.ts        tạo admin, đăng nhập, phiên, đổi mật khẩu
  crypto.ts      PBKDF2 cho mật khẩu, AES-GCM cho API key
  sites.ts       quản lý site
  settings.ts    cài đặt và API key
  dashboard.ts   tổng quan, tạm dừng, cron
  activity.ts    nhật ký
  http.ts        JSON, cookie, chặn CSRF, kiểm tra dữ liệu
migrations/      schema D1
public/          giao diện (static assets, không tính request Worker)
tests/           test API và máy chủ chạy thử
docs/            lộ trình, bản demo tham khảo
```

## Bảo mật

- Mật khẩu: PBKDF2-SHA256, 100.000 vòng, salt riêng từng tài khoản.
- Phiên: cookie `HttpOnly`, `Secure`, `SameSite=Strict`, hết hạn sau 30 ngày. D1 chỉ lưu SHA-256 của token, không lưu token gốc.
- Sai mật khẩu 5 lần trong 15 phút (theo IP hoặc email) thì bị khoá 15 phút. Mã cài đặt cũng áp dụng luật này.
- Mọi request thay đổi dữ liệu phải có `Origin` trùng với app (chặn CSRF).
- API key mã hoá AES-GCM bằng `ENCRYPTION_KEY`. Nhật ký chỉ ghi tên key đã đổi, không ghi giá trị.
- Giao diện có Content-Security-Policy chặt (không inline script), `noindex`.

## Chi phí Cloudflare

- Giao diện là static assets, không tính request Worker.
- Worker chỉ chạy cho `/api/*` và cron 15 phút.
- Log lấy mẫu 20% để không đẩy chi phí Observability lên.
- Với vài chục site, giai đoạn 1 nằm trong phần miễn phí của Workers và D1.
