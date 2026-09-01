# EventHub — Nền tảng Đặt vé & Quản lý Sự kiện

Fullstack Event Ticketing Platform (kiểu Ticketbox/Eventbrite thu nhỏ) — **Backend** Express + Prisma + PostgreSQL/Redis/RabbitMQ/Socket.IO và **Frontend** React + Vite. Tập trung vào các bài toán backend thật: **race condition tranh vé, RBAC + Resource-based Auth, queue bất đồng bộ, cache, realtime, Docker/CI-CD/Monitoring**.

**Demo:** FE https://eventhub-fe.onrender.com — BE https://eventhub-1lf8.onrender.com — Postman https://www.postman.com/hdthinh3105/workspace/eventhub

---

## Mục lục

- [Tài khoản Seed](#tài-khoản-seed)
- [Kiến trúc](#kiến-trúc)
- [Sơ đồ dữ liệu](#sơ-đồ-dữ-liệu-erd)
- [Tech Stack](#tech-stack)
- [Tính năng](#tính-năng)
- [Chạy local (npm)](#chạy-local-npm)
- [Chạy bằng Docker (FE/BE riêng biệt)](#chạy-bằng-docker-febe-riêng-biệt)
- [Biến môi trường](#biến-môi-trường)
- [Gửi email qua Gmail REST API](#gửi-email-qua-gmail-rest-api)
- [Testing](#testing)
- [CI/CD](#cicd)
- [Monitoring](#monitoring)
- [Tài liệu API](#tài-liệu-api)
- [Giới hạn đã biết](#giới-hạn-đã-biết)

---

## Tài khoản Seed

`prisma/seed.ts` tạo sẵn 4 roles, 5 categories, 3 venues và **4 user demo** (chạy `npx prisma db seed`, idempotent bằng `upsert`):

| Email | Mật khẩu | Role | Dùng để |
|---|---|---|---|
| `admin@eventhub.vn` | `Password123!` | ADMIN | Quản lý user/role, category, venue, mọi event |
| `organizer@eventhub.vn` | `Password123!` | ORGANIZER | Tạo/sửa event, quản lý ticket type, gán staff, check-in, export/import |
| `staff@eventhub.vn` | `Password123!` | STAFF | Được Organizer gán vào event mới check-in được |
| `customer@eventhub.vn` | `Password123!` | CUSTOMER | Giữ chỗ (hold) + checkout mua vé |

Tất cả đã `isVerified=true` nên login ngay, không cần verify email. Ngoài ra seed tạo:

- **Categories:** Âm nhạc, Hội thảo, Thể thao, Nghệ thuật, Công nghệ
- **Venues:** Nhà hát Hòa Bình (TP.HCM, 2000), White Palace (TP.HCM, 1500), SVĐ Mỹ Đình (Hà Nội, 40000)

---

## Kiến trúc

```
Browser (React + Vite)
   │  REST / Socket.IO         Express (Node + TS)
   ├──────────────────────────►┌─────────────────────────────┐
   │                           │ Helmet, CORS, Rate Limit    │
   │                           │ JWT access/refresh + rotation│
   │                           │ RBAC + Resource-based Auth  │
   │                           │ Socket.IO (room event/user)  │
   │                           └─┬──────┬──────┬─────────────┘
   │                             │      │      │
   │                        PostgreSQL Redis RabbitMQ
   │                        (Prisma) (cache) (email queue)
   │                             │      │      │
   │                        Cloudinary   └─► Consumer gửi mail + QR
   │                        (ảnh bìa)
   │
   └─► Prometheus :9090 scrapes /metrics ─► Grafana :3001
```

- **Backend** `eventhub-backend`: Clean Architecture theo module (`auth`, `event`, `ticket-type`, `ticket-hold`, `order`, `event-staff`, `checkin`, `notification`...), mỗi module `validation → repository → service → controller → route`, Repository Pattern (Service không import `prisma` trực tiếp, dễ mock test).
- **Frontend** `eventhub-frontend`: React 19 + React Router, Context (`Auth`, `Toast`), `fetch` client tự refresh token (single-flight), `useEventSocket` hook, `ErrorBoundary` + `React.lazy` code splitting.

---

## Sơ đồ dữ liệu (ERD)

```mermaid
erDiagram
    ROLE ||--o{ USER : gán
    USER ||--o{ EVENT : tổ chức
    USER ||--o{ EVENT_STAFF : được gán
    USER ||--o{ ORDER : đặt
    USER ||--o{ TICKET_HOLD : giữ chỗ
    CATEGORY ||--o{ EVENT : phân loại
    VENUE ||--o{ EVENT : tại
    EVENT ||--o{ TICKET_TYPE : có
    EVENT ||--o{ EVENT_STAFF : gán
    TICKET_TYPE ||--o{ TICKET_HOLD : giữ tạm
    TICKET_TYPE ||--o{ ORDER_ITEM : được mua
    ORDER ||--o{ ORDER_ITEM : gồm
    ORDER_ITEM ||--o{ TICKET : phát hành
    TICKET ||--o{ CHECKIN : lịch sử
```

17 bảng: Auth/User, Event, Ticket (giao dịch), Vận hành (Notification/AuditLog). Chi tiết + comment lý do thiết kế xem `eventhub-backend/prisma/schema.prisma`.

---

## Tech Stack

| Nhóm | Công nghệ |
|---|---|
| Runtime | Node 20, TypeScript, Express 5 |
| DB | PostgreSQL (Neon local: Postgres 16) + Prisma 6 |
| Cache | Redis (Upstash local: Redis 7) + ioredis, Cache-Aside |
| Queue | RabbitMQ (CloudAMQP local: RabbitMQ 3) + amqplib, durable `email_notifications` |
| Realtime | Socket.IO 4 (room `event:<id>` public + `user:<id>` private) |
| Storage | Cloudinary (ảnh bìa) |
| Validation | Zod |
| Auth | JWT access 15m + refresh 7d (hash SHA-256, rotation) |
| Email | Gmail REST API (OAuth2, port 443) fallback Nodemailer SMTP + `qrcode` |
| Excel | ExcelJS |
| Test | Jest + Supertest (BE), Vitest + Testing Library + jsdom (FE) |
| Container | Docker multi-stage, Docker Compose |
| CI/CD | GitHub Actions → Render |
| Monitoring | Prometheus + Grafana (`prom-client`) |

---

## Tính năng

**Auth & Phân quyền:** Đăng ký/đăng nhập, refresh rotation, verify email, forgot/reset (đổi pass thu hồi mọi session), 4 role, Organizer chỉ sửa event của mình, Staff chỉ check-in khi được gán (3 tầng: ADMIN bypass / ORGANIZER sở hữu / STAFF được gán).

**Race Condition:** `TicketHold` 10 phút + Optimistic Locking (`ticket_types.version`, CAS retry 5 lần, metric `holdRejectedCounter{reason}`), checkout transaction atomic (`soldQuantity` increment + Order/OrderItem/Ticket + xóa hold).

**Realtime:** `ticket_sold`, `hold_released`, `checkin_processed` (room `event:<id>`, cả anonymous), `notification` (room `user:<id>`). Frontend `useEventSocket` tự join room, `EventDetailPage` cập nhật "Còn lại" realtime, `OrganizerDashboard` toast, `EventManagePage` luồng check-in.

**Vận hành event:** CRUD Event/TicketType/Category/Venue (chặn xóa khi đã bán, chặn sửa khi CANCELLED/COMPLETED), upload ảnh Cloudinary, gán Staff (dropdown `GET /api/users?role=STAFF` cho cả ADMIN và ORGANIZER), check-in QR, export doanh thu / import vé mời Excel.

**Khác:** Full-Text Search Postgres (`to_tsvector` + `ts_rank`, `LIMIT 200`), AuditLog, Rate Limit, Helmet, CORS, ErrorBoundary + lazy loading FE.

---

## Chạy local (npm)

Yêu cầu: Node ≥ 20

```bash
# Backend
cd eventhub-backend
npm ci
cp .env.example .env   # điền đủ (bảng bên dưới)
npx prisma generate
npx prisma migrate dev
npx prisma db seed     # tạo roles/categories/venues + 4 user demo
npm run dev            # http://localhost:4000  GET /health

# Frontend (terminal khác)
cd eventhub-frontend
npm ci
cp .env.example .env   # VITE_API_URL=http://localhost:4000
npm run dev            # http://localhost:5173
```

---

## Chạy bằng Docker (FE/BE riêng biệt)

Mỗi project tự chứa Docker, **không gộp monorepo root**. BE đã kèm Postgres/Redis/RabbitMQ để chạy độc lập, không cần Neon/Upstash/CloudAMQP.

### Backend — 6 services

```bash
cd eventhub-backend
cp .env.example .env   # chỉ cần điền JWT_*, GMAIL_*, CLOUDINARY_* — infra URL đã override trong compose
docker compose up --build -d
# BE:        http://localhost:4000  (health /health)
# Postgres:  localhost:5432  (eventhub / eventhub_password / eventhub)
# Redis:     localhost:6379
# RabbitMQ:  localhost:5672  + Management http://localhost:15672 (guest/guest)
# Prometheus http://localhost:9090
# Grafana    http://localhost:3001  (admin/admin)
docker compose logs -f app   # xem migrate + seed + server
docker compose down          # dừng
docker compose down -v       # dừng + xóa data
```

`Dockerfile` multi-stage: `builder` (npm ci + prisma generate + build) → `production` (npm ci --omit=dev + tsx, copy dist + prisma client, `ENTRYPOINT docker-entrypoint.sh` tự `prisma migrate deploy` + `npx tsx prisma/seed.ts` + chờ RabbitMQ rồi `node dist/server.js`). `.dockerignore` đã fix (tên đúng `.dockerignore`).

### Frontend — 1 service

```bash
cd eventhub-frontend
docker compose up --build -d
# FE: http://localhost:8080  (nginx, SPA fallback try_files, gzip)
docker compose logs -f
```

Build-time env: `VITE_API_URL` bake vào bundle qua `ARG` (mặc định `http://localhost:4000` trong `docker-compose.yml`). Đổi backend URL:

```bash
docker compose build --build-arg VITE_API_URL=https://eventhub-1lf8.onrender.com
```

---

## Biến môi trường

### Backend (`eventhub-backend/.env`)

| Biến | Mô tả |
|---|---|
| `DATABASE_URL` | Postgres connection (Neon local: `postgresql://eventhub:eventhub_password@postgres:5432/eventhub` — compose đã set, không cần điền khi chạy Docker) |
| `REDIS_URL` | Redis (Upstash local: `redis://redis:6379`) |
| `RABBITMQ_URL` | RabbitMQ (CloudAMQP local: `amqp://guest:guest@rabbitmq:5672`) |
| `JWT_ACCESS_SECRET` / `JWT_REFRESH_SECRET` | ≥ 32 ký tự, khác nhau |
| `JWT_ACCESS_EXPIRES_IN` / `JWT_REFRESH_EXPIRES_IN` | Mặc định 15m / 7d |
| `GMAIL_USER` / `GMAIL_APP_PASSWORD` | Gmail SMTP fallback |
| `GMAIL_CLIENT_ID` / `GMAIL_CLIENT_SECRET` / `GMAIL_REFRESH_TOKEN` | Gmail REST API (đủ 3 thì dùng REST port 443, thiếu thì fallback SMTP) |
| `CLOUDINARY_CLOUD_NAME` / `CLOUDINARY_API_KEY` / `CLOUDINARY_API_SECRET` | Upload ảnh bìa (vẫn lưu trên Cloudinary kể cả khi chạy Docker) |
| `FRONTEND_URL` | URL FE để tạo link email verify/reset |
| `ALLOWED_ORIGINS` | CORS, phân cách dấu phẩy |
| `RATE_LIMIT_MAX` | Mặc định 600 / 15 phút |
| `HOLD_CLEANUP_INTERVAL_MS` | Mặc định 43200000 (12h) |
| `PORT` / `NODE_ENV` | Mặc định 4000 / development |

Validate bằng Zod `src/config/env.ts` (fail-fast).

### Frontend (`eventhub-frontend/.env`)

| Biến | Mô tả |
|---|---|
| `VITE_API_URL` | URL backend, VD `http://localhost:4000` hoặc `https://eventhub-1lf8.onrender.com` |

---

## Gửi email qua Gmail REST API

Render free chặn SMTP 465/587, `src/utils/mailer.ts` dùng Gmail REST API (HTTPS 443). Đủ `GMAIL_CLIENT_ID/SECRET/REFRESH_TOKEN` → REST (OAuth2), thiếu → fallback SMTP. Cấu hình: Google Cloud Console → bật Gmail API → OAuth consent (scope `gmail.send`, thêm Test users) → Credentials OAuth client (Web/Desktop) → lấy refresh token qua OAuth Playground/loopback → set 3 biến + `GMAIL_USER` đúng account.

---

## Testing

```bash
# Backend
cd eventhub-backend
npm test              # Jest, 17 tests
npm run test:watch

# Frontend
cd eventhub-frontend
npm test              # Vitest run, 14 tests
npm run test:watch
```

Chiến lược: Unit mock Repository (Optimistic Locking), Integration `supertest(app)` kiểm middleware chain 401/400/404 không cần DB.

---

## CI/CD

`.github/workflows/ci.yml` (riêng BE và FE) chạy khi push/PR vào `main`: `npm ci` → `prisma generate` (BE) → `tsc --noEmit` → `npm test` → `npm run build`. Nếu push thẳng `main` và pass → `curl POST $RENDER_DEPLOY_HOOK_URL` deploy lên Render (secret `RENDER_DEPLOY_HOOK_URL`).

FE build kèm `VITE_API_URL` từ `vars.VITE_API_URL` fallback localhost.

---

## Monitoring

`GET /metrics` (Prometheus format):

- `http_request_duration_seconds` histogram (route/method/status)
- `eventhub_tickets_sold_total` counter
- `eventhub_hold_rejected_total{reason="out_of_stock"|"contention"}`

---

## Tài liệu API

- `eventhub-backend/docs/API_TESTING_GUIDE.md` — toàn bộ endpoint + body mẫu + 12 bước E2E
- `eventhub-backend/docs/INTERVIEW_PREP.md` — câu hỏi phỏng vấn theo chủ đề

---

## Giới hạn đã biết

- Render free cold start 30-60s, queue durable và hold check theo `expiresAt` nên không mất dữ liệu.
- Chưa có Swagger/OpenAPI, Google Login.
- Full-Text Search dùng Postgres native (`LIMIT 200`), chưa Elasticsearch.
- `GET /api/users` ORGANIZER chỉ được `?role=STAFF` (để gán staff), không xem toàn bộ.
