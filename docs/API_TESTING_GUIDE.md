# EventHub API — Tài liệu luồng nghiệp vụ & Test đầy đủ

Base URL: `http://localhost:4000/api` (hoặc `http://localhost:4000/api` qua Docker — cùng cổng)

**Quy ước chung:**
- Mọi request cần đăng nhập: header `Authorization: Bearer <accessToken>`
- Mọi body JSON: `Content-Type: application/json` (Postman: Body → raw → JSON)
- `401` = chưa đăng nhập/token sai. `403` = đăng nhập rồi nhưng không đủ quyền. `400` = dữ liệu sai định dạng. `404` = không tìm thấy. `409` = xung đột dữ liệu (trùng, hết vé...).

---

## 1. AUTH — `/api/auth`

### 1.1 Đăng ký — `POST /auth/register`
Không cần token. Rate limit: 10 lần/15 phút/IP.
```json
{
  "email": "customer1@example.com",
  "password": "Test1234",
  "fullName": "Nguyễn Văn A",
  "phone": "0901234567"
}
```
**Ràng buộc:**
- `email`: đúng định dạng, chưa tồn tại (409 nếu trùng)
- `password`: tối thiểu 8 ký tự, ≥1 chữ hoa, ≥1 chữ số
- `fullName`: tối thiểu 2 ký tự
- `phone`: optional
- Role mặc định luôn là `CUSTOMER`, không thể tự chọn role khi đăng ký
- Tự động gửi email xác thực (token 24h) qua RabbitMQ, tự động login (trả về token luôn)

### 1.2 Đăng nhập — `POST /auth/login`
```json
{ "email": "customer1@example.com", "password": "Test1234" }
```
Sai email hoặc sai password đều trả **cùng 1 lỗi** `401 "Email hoặc mật khẩu không đúng"` (chống dò email).

### 1.3 Làm mới token — `POST /auth/refresh` (không cần Bearer header, token nằm trong body)
```json
{ "refreshToken": "<refreshToken đã nhận>" }
```
**Ràng buộc:** mỗi refresh token chỉ dùng được **đúng 1 lần** (token rotation) — dùng lại → `401`.

### 1.4 Đăng xuất — `POST /auth/logout`
```json
{ "refreshToken": "<refreshToken hiện tại>" }
```

### 1.5 Thông tin hiện tại — `GET /auth/me` (cần Bearer)

### 1.6 Xác thực email — `POST /auth/verify-email`
```json
{ "token": "<token nhận qua email>" }
```
**Ràng buộc:** hết hạn sau 24h, dùng lại lần 2 → `400`.

### 1.7 Quên mật khẩu — `POST /auth/forgot-password`
```json
{ "email": "customer1@example.com" }
```
Luôn trả `200` dù email có tồn tại hay không (chống dò email).

### 1.8 Đặt lại mật khẩu — `POST /auth/reset-password`
```json
{ "token": "<token nhận qua email>", "newPassword": "NewPass123" }
```
**Ràng buộc:** token hết hạn sau **15 phút**, dùng lại lần 2 → `400`. `newPassword` theo đúng quy tắc như lúc đăng ký.

---

## 2. USER — `/api/users`

### 2.1 Danh sách user — `GET /users?role=` — `ADMIN` xem tất cả, `ORGANIZER` chỉ được `?role=STAFF` (để gán check-in, dropdown `GET /api/users?role=STAFF` cho cả hai)

### 2.2 Chi tiết user — `GET /users/:id` — `ADMIN`, `ORGANIZER`

### 2.3 Gán role — `PATCH /users/:id/role`
```json
{ "roleName": "ORGANIZER" }
```
`roleName` ∈ `ADMIN | ORGANIZER | STAFF | CUSTOMER`.
**Ràng buộc:** Admin không thể tự đổi role chính mình → `400`.

---

## 3. CATEGORY — `/api/categories`

| Method | URL | Quyền |
|---|---|---|
| GET | `/categories` | Public |
| POST | `/categories` | ADMIN |
| PATCH | `/categories/:id` | ADMIN |
| DELETE | `/categories/:id` | ADMIN |

```json
// POST / PATCH
{ "name": "Kịch nói" }
```
**Ràng buộc:** tên tối thiểu 2 ký tự, không trùng (409). Không xóa được nếu còn Event dùng category này (409).

---

## 4. VENUE — `/api/venues`

| Method | URL | Quyền |
|---|---|---|
| GET | `/venues` | Public |
| POST | `/venues` | ADMIN |
| PATCH | `/venues/:id` | ADMIN |
| DELETE | `/venues/:id` | ADMIN |

```json
// POST
{
  "name": "Nhà hát Hòa Bình",
  "address": "240 Đ. 3/2, P.12",
  "city": "TP.HCM",
  "capacity": 2000
}
```
`capacity` optional. Không xóa được nếu còn Event tổ chức tại venue này (409).

---

## 5. EVENT — `/api/events`

| Method | URL | Quyền |
|---|---|---|
| GET | `/events?page=1&limit=10&categoryId=&organizerId=&status=&search=` | Public |
| GET | `/events/:id` | Public |
| POST | `/events` | ADMIN, ORGANIZER |
| PATCH | `/events/:id` | ADMIN, chủ Event (ORGANIZER) |
| DELETE | `/events/:id` | ADMIN, chủ Event |
| POST | `/events/:id/image` | ADMIN, chủ Event — **form-data**, không phải JSON |

```json
// POST /events
{
  "title": "Đêm nhạc Acoustic Sài Gòn",
  "description": "Chương trình âm nhạc acoustic ngoài trời",
  "categoryId": "<uuid category có sẵn>",
  "venueId": "<uuid venue có sẵn>",
  "startTime": "2026-12-20T19:00:00Z",
  "endTime": "2026-12-20T22:00:00Z"
}
```
**Ràng buộc:** `title` ≥5 ký tự, `endTime` > `startTime` (400 nếu sai), `categoryId`/`venueId` phải tồn tại thật (404 nếu không). `status` mặc định `DRAFT`.

```json
// PATCH /events/:id (mọi field đều optional)
{ "title": "Tên mới", "status": "PUBLISHED" }
```
`status` ∈ `DRAFT | PUBLISHED | CANCELLED | COMPLETED`.

**Ràng buộc quan trọng — Resource-based Authorization:** Organizer B (không phải chủ) sửa Event của Organizer A → `403`, dù cùng role ORGANIZER. Chỉ Admin bypass được.

### Upload ảnh bìa — `POST /events/:id/image`
Không phải JSON — Body chọn **form-data**, key `image` kiểu **File**, chọn file `.jpg/.png/.webp` (giới hạn 5MB).

---

## 6. TICKET TYPE — `/api/ticket-types`

| Method | URL | Quyền |
|---|---|---|
| GET | `/ticket-types/event/:eventId` | Public |
| POST | `/ticket-types/event/:eventId` | ADMIN, chủ Event |
| PATCH | `/ticket-types/:id` | ADMIN, chủ Event |
| DELETE | `/ticket-types/:id` | ADMIN, chủ Event |

```json
// POST
{ "name": "Vé VIP", "price": 500000, "totalQuantity": 50 }
```
**Ràng buộc:**
- `price` ≥ 0, `totalQuantity` > 0
- **KHÔNG** có field `soldQuantity` trong schema — server tự quản lý, không nhận từ client dù cố tình gửi lên
- PATCH giảm `totalQuantity` xuống dưới `soldQuantity` hiện tại → `400`
- DELETE khi đã có người mua (`soldQuantity > 0`) → `409`
- Quyền kế thừa từ Event chứa nó — Organizer không sở hữu Event → `403` dù gọi đúng route

---

## 7. TICKET HOLD (Giữ chỗ) — `/api/ticket-holds`

### Tạo hold — `POST /ticket-holds` — chỉ role `CUSTOMER`
```json
{ "ticketTypeId": "<uuid ticketType>", "quantity": 2 }
```
**Ràng buộc:**
- `quantity`: 1–10 (chặn scalping)
- Hết vé (available = total - sold - đang giữ) → `409` kèm số vé còn lại chính xác
- Hold tự hết hạn sau **10 phút** (`expiresAt`), job dọn dẹp chạy mỗi 60s
- Cơ chế Optimistic Locking chống oversell khi nhiều người tranh mua đồng thời — đã load-test bằng autocannon xác nhận không bao giờ vượt `totalQuantity`

---

## 8. ORDER — `/api/orders`

### 8.0 Lấy đơn hàng — `GET /orders/:id` — `CUSTOMER` (chỉ đơn của mình), `ADMIN`/`ORGANIZER` — dùng cho `CheckoutSuccessPage` fallback `?orderId=` khi F5

### 8.1 Checkout — `POST /orders/checkout` — chỉ role `CUSTOMER`
```json
{ "holdId": "<uuid hold vừa tạo>" }
```
**Ràng buộc:**
- Chỉ chính chủ hold mới checkout được (403 nếu không phải)
- Hold hết hạn → `410 Gone` (không phải 404)
- Checkout thành công → hold bị **xóa vĩnh viễn**, gọi lại cùng `holdId` → `404` (chống double-checkout)
- Tự động: tăng `soldQuantity`, tạo `Order` (status `PAID`), tạo từng `Ticket` riêng kèm QR ảnh thật, gửi email qua RabbitMQ, emit Socket.IO `ticket_sold` tới room `event:<eventId>`, ghi + emit realtime `Notification` cho Organizer (xem mục 12)

### 8.2 Xuất báo cáo doanh thu — `GET /orders/event/:eventId/export` — ADMIN, chủ Event
Không có body — trả về **file `.xlsx`** (Postman: Save Response → Save to a file), không phải JSON.

### 8.3 Nhập vé mời hàng loạt — `POST /orders/ticket-type/:ticketTypeId/import` — ADMIN, chủ Event
Body **form-data**, key `file` kiểu **File**, chọn `.xlsx` có cấu trúc:

| A (Họ tên) | B (Email) | C (Số lượng) |
|---|---|---|
| *(dòng 1 là header — luôn bị bỏ qua, đặt tên gì cũng được)* | | |
| Nguyễn Văn A | guest1@example.com | 2 |
| Trần Thị B | guest2@example.com | 1 |

**Ràng buộc:**
- Kiểm tra đủ sức chứa **trước khi** ghi bất kỳ gì (409 nếu vượt quá available)
- Vé mời `unitPrice = 0`, `totalAmount = 0` — không tính vào doanh thu thật khi export
- Tự tạo tài khoản cho email chưa tồn tại (mật khẩu ngẫu nhiên — khách không cần biết, vé gửi thẳng qua email)
- Gửi email riêng cho từng khách mời (kèm QR ảnh thật)

---

## 9. EVENT STAFF — `/api/event-staff` (mọi route ADMIN, chủ Event)

### Gán Staff — `POST /event-staff/event/:eventId`
```json
{ "userId": "<uuid user có role STAFF>" }
```
**Ràng buộc:** `userId` phải có sẵn role `STAFF` (400 nếu không), không gán trùng (409).

### Danh sách Staff — `GET /event-staff/event/:eventId`

### Bỏ gán — `DELETE /event-staff/event/:eventId/user/:userId`

---

## 10. CHECK-IN — `POST /api/checkins` — role `ADMIN`, `ORGANIZER`, `STAFF`
```json
{ "qrCode": "<qrCode lấy từ vé đã mua>" }
```
**Ràng buộc — 3 tầng phân quyền khác nhau theo role:**
- **Admin**: check-in được mọi vé, mọi Event
- **Organizer**: chỉ check-in được vé thuộc Event **mình sở hữu**
- **Staff**: chỉ check-in được vé thuộc Event **mình được gán** (qua mục 9), dù có role STAFF vẫn không quét được Event khác nếu chưa được gán → `403`
- Vé đã check-in rồi, quét lại lần 2 → `409`

---

## 11. NOTIFICATION — `/api/notifications` (cần đăng nhập, không cần role cụ thể)

### Danh sách thông báo của tôi — `GET /notifications`
### Đánh dấu đã đọc — `PATCH /notifications/:id/read`
**Ràng buộc:** chỉ đọc được thông báo của chính mình (403 nếu cố đánh dấu thông báo người khác).

**Realtime:** thông báo mới (VD "có vé mới được bán") cũng được đẩy qua Socket.IO tới room `user:<id>` — FE đang mở trang nhận được ngay, không cần gọi lại `GET /notifications` (nội dung đồng bộ với REST).

---

## 12. DOCS — `GET /api/docs` (Public) — OpenAPI 3.0 JSON (34 paths)

## 13. REALTIME — Socket.IO (kênh đẩy, không phải REST)

Kết nối WebSocket tới chung port HTTP của server (`http://localhost:4000`, endpoint `/socket.io`). Có thể test bằng **Frontend EventHub** (`../eventhub-frontend`, chạy `npm run dev`) hoặc bất kỳ client Socket.IO nào.

```
// Ví dụ connect (client):
const socket = io('http://localhost:4000', {
  auth: token ? { token } : {},   // có token = đã xác thực (nhận thêm thông báo cá nhân)
  transports: ['websocket'],
});
```

**2 loại room:**
- `event:<eventId>` — công khai, client tự join bằng `socket.emit('join_event', eventId)`
- `user:<userId>` — riêng tư, BE tự động join khi socket có `accessToken` hợp lệ (không cần emit)

**Bảng sự kiện:**

| Sự kiện | Kích hoạt bởi API | Room | Payload demo |
|---|---|---|---|
| `ticket_sold` | `POST /orders/checkout` | `event:<id>` | `{ ticketTypeId, ticketTypeName, quantitySold, newSoldQuantity, totalQuantity }` |
| `hold_released` | Job dọn hold hết hạn (chạy định kỳ) | `event:<id>` | `{ eventId, releases: [{ ticketTypeId, quantityReleased }] }` — số vé bị giữ hết hạn hoàn về quỹ |
| `checkin_processed` | `POST /checkins` | `event:<id>` | `{ ticketId, eventId, customerName, customerEmail, checkedInAt }` |
| `notification` | `POST /orders/checkout` (tạo thông báo cho Organizer) | `user:<id>` | `{ userId, title, message, isRead, createdAt }` |

**Kiểm chứng realtime end-to-end:**
1. Mở **2 browser tab**: tab A đăng nhập Organizer + mở trang quản lý sự kiện, tab B đăng nhập Customer.
2. Tab B: `POST /ticket-holds` → `POST /orders/checkout`.
3. Tab A **không F5** vẫn nhận toast/vé mới bán (`ticket_sold`) và thông báo mới (`notification`); khách xem trang chi tiết sự kiện (kể cả chưa đăng nhập) thấy số vé còn lại tự giảm.
4. Staff quét vé tại cổng (`POST /checkins`) → tab A thấy luồng check-in realtime (`checkin_processed`), quét lại lần 2 → `409` và **không** emit thêm.
5. Khi đủ 10 phút hold hết hạn → job dọn dẹp emit `hold_released` → số vé còn lại tự tăng trở lại.

---

## Luồng test đầy đủ (End-to-End) — chạy theo đúng thứ tự

```
1. POST /auth/register (Customer mới, email thật để nhận mail)
2. GET  /categories, GET /venues (lấy id có sẵn, hoặc tạo mới bằng Admin)
3. Login Admin (admin@eventhub.vn / Password123!)
4. POST /events (dùng token Organizer — login organizer@eventhub.vn / Password123!)
5. POST /ticket-types/event/:eventId (Organizer, chủ Event)
6. POST /ticket-holds (Customer, ticketTypeId từ bước 5)
7. POST /orders/checkout (Customer, holdId từ bước 6)
   -> kiểm tra email thật có vé + QR ảnh; mở trang quản lý sự kiện trên FE:
      nhận "ticket_sold" và "notification" realtime, số vé còn lại tự giảm
8. PATCH /users/:id/role (Admin, đổi 1 user thành STAFF)
9. POST /event-staff/event/:eventId (Organizer, gán Staff vừa tạo)
10. POST /checkins (Staff, qrCode lấy từ vé đã mua ở bước 7)
    -> FE nhận "checkin_processed" (luồng check-in realtime); gọi lại lần 2 -> phải 409
11. GET /orders/event/:eventId/export (Organizer) -> tải file Excel, xác nhận đúng số liệu
12. POST /orders/ticket-type/:ticketTypeId/import (Organizer, file Excel mẫu)
```

Tài khoản seed sẵn (từ `prisma/seed.ts`, mật khẩu chung `Password123!`):
- `admin@eventhub.vn`
- `organizer@eventhub.vn`
- `staff@eventhub.vn`
- `customer@eventhub.vn`
