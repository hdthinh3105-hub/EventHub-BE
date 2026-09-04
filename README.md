# EventHub — Đặt vé & Quản lý Sự kiện

Nền tảng đặt vé như Ticketbox thu nhỏ. **Backend** Express + Prisma + Postgres/Redis/RabbitMQ/Socket.IO, **Frontend** React + Vite. Demo: BE https://eventhub-1lf8.onrender.com — FE https://eventhub-rosy.vercel.app — Postman https://www.postman.com/hdthinh3105/workspace/eventhub

---

## 1. Tài khoản đăng nhập ngay (sau khi seed)

Mật khẩu chung: `Password123!` — tất cả đã `isVerified=true`

| Email | Role | Làm gì |
|---|---|---|
| `admin@eventhub.vn` | ADMIN | Quản lý user/role, category, venue |
| `organizer@eventhub.vn` | ORGANIZER | Tạo event, vé, gán staff, check-in, xuất Excel |
| `staff@eventhub.vn` | STAFF | Được gán vào event mới quét QR được |
| `customer@eventhub.vn` | CUSTOMER | Giữ chỗ 10p → checkout → nhận vé QR |

Seed còn tạo 5 categories (Âm nhạc, Hội thảo...) và 3 venues (Nhà hát Hòa Bình...).

---

## 2. Chạy nhanh 30 giây bằng Docker (không cần cài Postgres/Redis)

### Yêu cầu: Docker Desktop đang chạy

```bash
# 1. Clone (bỏ qua nếu đã tải folder EventHub này thì dùng luôn EventHub/eventhub-backend và EventHub/eventhub-frontend)
git clone https://github.com/hdthinh3105-hub/EventHub.git          # BE
git clone https://github.com/hdthinh3105-hub/EventHub-FE.git       # FE

# 2. Backend — tự có Postgres/Redis/RabbitMQ riêng
cd EventHub
cp .env.example .env
# Mở .env điền 6 dòng sau (lấy free, không cần thẻ):
# JWT_ACCESS_SECRET, JWT_REFRESH_SECRET (gõ bừa 32+ ký tự khác nhau)
# GMAIL_USER, GMAIL_APP_PASSWORD, CLOUDINARY_CLOUD_NAME/API_KEY/API_SECRET
# Để trống thì app vẫn chạy nhưng upload ảnh/gửi mail sẽ lỗi
docker compose up --build -d
docker compose logs -f app   # đợi "Server đang chạy tại http://0.0.0.0:4000" + "Seed hoàn tất"
# Kiểm tra: http://localhost:4000/health → {"status":"ok"}
# Nếu dùng folder có sẵn: cd EventHub/eventhub-backend thay vì cd EventHub

# 3. Frontend — 1 service nginx riêng
cd ../EventHub-FE
docker compose up --build -d
# Mở: http://localhost:8080
# Nếu dùng folder có sẵn: cd EventHub/eventhub-frontend
```

Dừng: `docker compose down` — Xóa data: `docker compose down -v`

**Ports khi chạy Docker:**
- BE: 4000, Postgres: 5432, Redis: 6379, RabbitMQ: 5672 + 15672 (guest/guest), Prometheus: 9090, Grafana: 3001 (admin/admin)
- FE: 8080

---

## 3. Chạy thủ công (npm) — dành cho dev

### Backend
```bash
cd eventhub-backend
npm ci
cp .env.example .env   # điền đủ: DATABASE_URL (Neon), REDIS_URL (Upstash),
                       # RABBITMQ_URL (CloudAMQP), JWT_*, GMAIL_*, CLOUDINARY_*
npx prisma generate
npx prisma migrate dev   # tạo bảng
npx prisma db seed       # tạo 4 user + categories + venues
npm run dev              # http://localhost:4000
```

### Frontend (terminal khác)
```bash
cd eventhub-frontend
npm ci
cp .env.example .env   # VITE_API_URL=http://localhost:4000 (local) hoặc BE Render URL
npm run dev            # http://localhost:5173
```

---

## 4. Kiểm tra đã chạy

```bash
curl http://localhost:4000/health
curl http://localhost:4000/api/categories
curl http://localhost:4000/api/docs | head -c 200  # OpenAPI 3.0

# Login thử (PowerShell)
$body = @{ email="admin@eventhub.vn"; password="Password123!" } | ConvertTo-Json
Invoke-WebRequest -Uri http://localhost:4000/api/auth/login -Method POST -Body $body -ContentType "application/json"
```

Hoặc mở Postman collection ở link trên, set `{{baseUrl}} = http://localhost:4000`.

---

## 5. Biến môi trường

**Backend `eventhub-backend/.env`:**

| Biến | Bắt buộc | Ghi chú |
|---|---|---|
| `DATABASE_URL` | Có | Neon. Khi chạy Docker thì compose tự set `postgresql://eventhub:eventhub_password@postgres:5432/eventhub`, không cần điền |
| `REDIS_URL` | Có | Upstash. Docker tự set `redis://redis:6379` |
| `RABBITMQ_URL` | Có | CloudAMQP. Docker tự set `amqp://guest:guest@rabbitmq:5672` |
| `JWT_ACCESS_SECRET` / `JWT_REFRESH_SECRET` | Có | ≥32 ký tự, khác nhau |
| `GMAIL_USER` / `GMAIL_APP_PASSWORD` | Có | Gmail App Password (fallback SMTP) |
| `GMAIL_CLIENT_ID/SECRET/REFRESH_TOKEN` | Không | Đủ 3 thì gửi qua Gmail REST API (port 443, không bị Render chặn), thiếu thì fallback SMTP |
| `CLOUDINARY_CLOUD_NAME/API_KEY/API_SECRET` | Có | Ảnh bìa vẫn lưu trên Cloudinary kể cả khi chạy Docker |
| `FRONTEND_URL` / `ALLOWED_ORIGINS` | Có | URL FE, VD `http://localhost:8080` (Docker) hoặc `https://eventhub-rosy.vercel.app` (prod) |
| `PORT` / `NODE_ENV` | Không | Mặc định 4000 / development, Render tự set PORT=10000 |

**Frontend `eventhub-frontend/.env`:**

| Biến | Mô tả |
|---|---|
| `VITE_API_URL` | URL BE, VD `http://localhost:4000` hoặc `https://eventhub-1lf8.onrender.com` — là **build-time**, đổi phải build lại |

---

## 6. Tính năng chính

- Auth JWT access 15m + refresh 7d (hash + rotation), RBAC 4 role, Organizer chỉ sửa event của mình
- Giữ chỗ vé 10p + Optimistic Locking (`version` + retry), checkout atomic, không oversell
- Realtime Socket.IO: `ticket_sold`, `hold_released`, `checkin_processed`, `notification`
- CRUD Event/Ticket/Category/Venue, gán Staff, check-in QR (3 tầng quyền), export/import Excel
- Upload ảnh Cloudinary, Full-Text Search Postgres, AuditLog, Rate Limit, Cache-Aside Redis
- OpenAPI 3.0 tại `GET /api/docs`, RabbitMQ auto-retry (5 lần, backoff 2s) + reconnect khi close

---

## 7. Testing & CI/CD

```bash
cd eventhub-backend && npm test        # Jest 21 tests (middleware + optimistic locking + docs + e2e hold→checkout→checkin + rabbitmq retry)
cd eventhub-frontend && npm test       # Vitest 14 tests (api-client single-flight refresh, protected route, home)
```

Mỗi push/PR vào `main` → GitHub Actions 4 jobs song song `lint` / `typecheck` / `test` / `build` → `deploy` (BE, `needs: [lint, typecheck, test, build]`). FE chỉ `CI` (Vercel tự deploy).

---

## 8. Triển khai lên Render

- **BE:** Web Service (Docker hoặc Node), Root Directory `eventhub-backend`, Build `npm ci && npx prisma generate && npm run build`, Start `node dist/server.js`, Health Check `/health`. Env y như bảng trên, `FRONTEND_URL` + `ALLOWED_ORIGINS` = URL FE thật.
- **FE:** Static Site, Root Directory `eventhub-frontend`, Build `npm ci && npm run build`, Publish `dist`, Env `VITE_API_URL` = URL BE thật. Hoặc Docker Web Service (đã fix `listen $PORT`).

---

## 9. Gặp lỗi?

- `PORT` đã dùng → đổi port trong `docker-compose.yml` hoặc `lsof -i :4000`
- `ECONNREFUSED` Postgres/Redis/RabbitMQ → đợi healthcheck `docker ps` → `healthy` rồi BE mới start (entrypoint đã chờ RabbitMQ)
- `tsx ENOENT` khi seed → đã fix bằng `npm install tsx` trong Dockerfile, nếu vẫn lỗi chạy `docker exec eventhub-backend npx tsx prisma/seed.ts`
- CORS → kiểm tra `ALLOWED_ORIGINS` = URL FE
- Ảnh không upload → kiểm tra `CLOUDINARY_*`
