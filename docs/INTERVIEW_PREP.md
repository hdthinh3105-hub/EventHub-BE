# Chuẩn bị phỏng vấn — EventHub

Tài liệu này gom lại các câu hỏi phỏng vấn dễ gặp nhất ứng với từng quyết định kỹ thuật trong dự án, cùng cách trả lời có chiều sâu (không học thuộc — hiểu bản chất để tự diễn đạt lại bằng lời của bạn).

---

## 1. Vì sao chọn domain "đặt vé sự kiện" thay vì CRUD thông thường?

Domain này buộc phải giải quyết **race condition khi nhiều người tranh mua vé cuối**, **xử lý bất đồng bộ** (gửi vé qua email không được chặn request), **RBAC nhiều tầng** (Admin/Organizer/Staff/Customer với quyền sở hữu khác nhau) — đây đều là bài toán thật gặp trong hệ thống doanh nghiệp (ecommerce, banking, ticketing), không phải bài tập giả định.

## 2. Kiến trúc: Clean Architecture theo module (feature-based), vì sao không theo layer (controllers/services riêng)?

Layer-based gọn lúc dự án nhỏ, nhưng khi lên 15-20 module, sửa 1 tính năng phải nhảy qua lại nhiều thư mục xa nhau. Feature-based — mỗi module tự chứa đủ `validation/repository/service/controller/route` — dễ scale, dễ onboard người mới (đọc 1 thư mục hiểu 1 tính năng), dễ tách microservice sau này nếu cần. Đây cũng là cách tổ chức phổ biến ở các công ty product thật.

## 3. Repository Pattern — lợi ích thực tế ngoài lý thuyết?

Khi cần đổi ORM hoặc viết Unit Test cho Service mà không cần DB thật, chỉ cần mock đúng 1 lớp Repository. Đây chính là cách bộ Unit Test của project mock `ticketTypeRepository`/`ticketHoldRepository` để kiểm chứng thuật toán Optimistic Locking mà không cần Postgres thật chạy song song.

## 4. JWT — vì sao 2 loại token (access + refresh) thay vì 1?

Token duy nhất buộc chọn 1 trong 2 điều tệ: sống ngắn (an toàn nhưng phiền vì phải login liên tục) hoặc sống dài (tiện nhưng rủi ro nếu bị đánh cắp thì kẻ tấn công dùng được lâu). 2 token: access ngắn (15p, không lưu DB, không thể thu hồi giữa chừng nhưng rủi ro giới hạn trong 15p), refresh dài (7 ngày, **lưu hash trong DB** để có thể thu hồi khi logout/đổi mật khẩu — token rotation: mỗi lần refresh, token cũ bị thu hồi, phát token mới, chống replay attack).

## 5. Vì sao lưu **hash** refresh token, không lưu token thật?

Nếu DB bị lộ (SQL injection, backup leak), kẻ tấn công có hash cũng không suy ngược ra được token thật để dùng — giống nguyên tắc với password.

## 6. Authentication vs Authorization — phân biệt và áp dụng vào code như thế nào?

AuthN trả lời "bạn là ai" (`authMiddleware`, verify JWT → 401 nếu sai/thiếu). AuthZ trả lời "bạn được làm gì" — chia 2 tầng: **RBAC role-level** (`requireRole`, → 403) và **Resource-based Authorization** (kiểm tra `event.organizerId === user.userId` ngay trong Service, vì middleware không đủ dữ liệu để biết "Event này của ai"). Ví dụ cụ thể: `requireRole('ORGANIZER')` cho qua mọi Organizer, nhưng `assertCanModifyEvent` mới chặn được Organizer B sửa Event của Organizer A.

## 7. Race Condition — giải thích bài toán và thuật toán đã chọn?

2 request cùng đọc "còn 1 vé" tại cùng thời điểm, cùng ghi thành công → bán dư 1 vé (oversell). Chọn **Optimistic Locking** (không phải Pessimistic) vì hệ thống đọc nhiều/ghi ít — đa số user chỉ xem, chỉ số ít thực sự tranh chấp đúng lúc "vé cuối". Thuật toán: đọc `version` hiện tại → tính available → thử CAS (`UPDATE ... WHERE version = X`) → thắng thì tạo hold, thua thì đọc lại và retry (tối đa N lần). Đã kiểm chứng bằng `autocannon` bắn N request đồng thời tranh ít vé hơn N — xác nhận **tổng số thành công không bao giờ vượt quá vé thật có**, dù có tỷ lệ nhỏ bị từ chối oan do hết lượt retry dưới tải cực cao (đánh đổi chấp nhận được, có thể giảm bằng tăng retry hoặc chuyển Pessimistic nếu ưu tiên "không từ chối oan" hơn "tốc độ").

## 8. Optimistic vs Pessimistic Locking — trade-off?

| | Optimistic | Pessimistic |
|---|---|---|
| Cơ chế | Không khóa, kiểm tra version khi ghi | Khóa dòng, request khác phải chờ |
| Hiệu năng ít tranh chấp | Nhanh hơn | Chậm hơn (luôn tốn chi phí khóa) |
| Tranh chấp cao | Nhiều request phải retry | Ổn định, tuần tự, không bị từ chối oan |
| Deadlock | Không có | Có nếu khóa nhiều bảng sai thứ tự |

## 9. Vì sao tách `TicketHold` khỏi `Order`?

`Order` là dữ liệu lâu dài (đối soát, báo cáo). `TicketHold` là dữ liệu tạm (TTL 10 phút, ghi/xóa tần suất cực cao). Gộp chung sẽ làm `Order` đầy rác các đơn "pending" hết hạn, ảnh hưởng hiệu năng truy vấn báo cáo doanh thu.

## 10. Cache-Aside Pattern — thiết kế cache key và invalidation ra sao?

Đọc Redis trước (hit → trả ngay), miss thì query DB rồi ghi lại cache kèm TTL. Cache key phản ánh đúng độ đa dạng input: Event có filter/pagination nên key động (`events:list:<JSON query>`), Category/Venue không filter nên chỉ cần 1 key cố định. Khi có ghi (create/update/delete) → **xóa** cache liên quan (không tự cập nhật) — đơn giản và an toàn hơn, chấp nhận đổi lấy 1 lần cache-miss ngay sau đó. Redis lỗi không được làm sập API — luôn có try-catch fallback về query DB trực tiếp (cache là tối ưu, không phải phụ thuộc bắt buộc).

## 11. Vì sao dùng Message Queue (RabbitMQ) cho gửi email, không gọi trực tiếp?

Gửi email qua SMTP mất 1-3 giây, có thể lỗi tạm thời. Gọi trực tiếp trong request sẽ: (1) làm user chờ thêm vài giây dù giao dịch chính đã xong, (2) nếu email lỗi, cả request bị coi là thất bại dù vé đã tạo thành công thật. Đẩy vào queue → trả response ngay → Consumer riêng xử lý nền, độc lập với luồng HTTP chính. Dùng `durable: true` (queue) + `persistent: true` (message) để không mất dữ liệu nếu RabbitMQ restart; `prefetch(1)` tránh Consumer quá tải; ack/nack đảm bảo message chỉ bị xóa sau khi xử lý thành công thật.

## 12. Socket.IO — kiến trúc room và bảo mật?

Mỗi sự kiện realtime được định tuyến theo **2 loại room khác nhau về mức độ nhạy cảm**:
- Room `event:<eventId>` — dữ liệu **công khai** (số vé còn lại, luồng check-in, số vé hoàn trả khi hold hết hạn). Client tự join room này khi muốn theo dõi 1 sự kiện.
- Room `user:<userId>` — dữ liệu **riêng tư** (thông báo cá nhân: "vé mới được bán cho sự kiện của bạn"). Socket **được tự động join room này khi đã xác thực bằng accessToken lúc handshake** — anonymous không bao giờ nhận được thông báo riêng tư.

**Bảo mật:** xác thực JWT ngay lúc **handshake** (không cho kết nối "chui" rồi mới kiểm tra sau). Nhưng khác thiết kế cũ — giờ có **chế độ anonymous**: trang công khai (chi tiết sự kiện) kết nối không cần token, chỉ nhận dữ liệu thuộc event room công khai. Đây là lý do dữ liệu nhạy cảm thật (doanh thu, danh sách khách hàng) vẫn **bắt buộc** phải qua REST API có đầy đủ Resource-based Authorization — WebSocket chỉ là kênh đẩy, không phải kênh đọc dữ liệu theo yêu cầu.

**Các sự kiện đang phát:** `ticket_sold` (vé mới bán → event room), `hold_released` (hold hết hạn hoàn vé về quỹ → event room), `checkin_processed` (vé vừa quét tại cổng → event room), `notification` (thông báo cá nhân → user room). Emit tập trung qua helper `emitToEvent`/`emitToUser` — nếu socket chưa init (môi trường test) thì bỏ qua an toàn, không làm lỗi luồng nghiệp vụ.

**Khi điều tra lỗi realtime** (câu hỏi phỏng vấn hay hỏi thêm): chia 3 tầng — (1) Client đã join đúng room chưa (log `tham gia room event:<id>`), (2) BE có emit đúng sự kiện và đúng room không (log bên cạnh mỗi emit), (3) trường hợp đáng sợ nhất: emit đúng nhưng client reconnect mất room — vì join room chỉ xảy ra **sau** sự kiện `connect`, nên nếu kết nối rớt giữa chừng phải đảm bảo client emit `join_event` lại sau khi reconnect (Socket.IO mặc định không tự động join lại room cũ).

## 13. Xử lý N+1 query khi dùng ORM?

Prisma trừu tượng hóa SQL khá nhiều nên dễ vô tình gây N+1 nếu query trong vòng lặp thay vì dùng `include`/`select` đúng cách để JOIN 1 lần. Nguyên tắc áp dụng xuyên suốt project: xác định trước dữ liệu cần (`include` quan hệ ngay từ query đầu), tránh query lồng trong `.map()`/vòng lặp.

## 14. Vì sao dùng Decimal cho tiền, không phải Float?

Float gây sai số làm tròn (`0.1 + 0.2 !== 0.3` ở hầu hết ngôn ngữ) — với tiền bạc luôn cần kiểu số thập phân chính xác (`Decimal` trong Postgres/Prisma).

## 15. Xử lý transaction — khi nào cần, ví dụ cụ thể trong project?

Bất kỳ thao tác nào có **nhiều bước ghi phải cùng thành công hoặc cùng thất bại**. Ví dụ checkout: tăng `soldQuantity` + tạo `Order` + `OrderItem` + từng `Ticket` + xóa `Hold` — nếu 1 bước lỗi giữa chừng mà không có transaction, sẽ có "vé đã bán" nhưng không có vé thật tồn tại. Dùng `prisma.$transaction`. Tương tự cho reset password: đổi mật khẩu + đánh dấu token đã dùng + thu hồi toàn bộ refresh token cũ phải atomic — tránh tình trạng đổi mật khẩu xong nhưng session cũ vẫn còn hiệu lực nếu có lỗi giữa chừng.

## 16. Referential Integrity ở tầng nghiệp vụ (không chỉ Foreign Key DB)?

Nhiều ràng buộc không thể (hoặc không nên) diễn tả bằng Foreign Key/CASCADE ở DB, vì cần người quản trị **chủ động xác nhận** thay vì mất dữ liệu âm thầm. Ví dụ: không cho đổi role của 1 user đang được gán làm Staff cho Event nào đó — nếu cho phép tùy tiện, bản ghi `EventStaff` sẽ trỏ tới user không còn quyền Staff, gây lỗ hổng logic phân quyền check-in. Bắt Admin phải gỡ khỏi mọi Event trước, rồi mới đổi role được.

## 17. Testing — chiến lược chọn cái gì để test, bỏ qua cái gì?

Không chạy theo % coverage. Ưu tiên: (1) Unit test cho logic **khó và dễ sai nhất** (Optimistic Locking + RabbitMQ retry) — mock Repository để ép đúng kịch bản race condition; (2) Integration test cho **hành vi middleware chain** (401/400/404) và `GET /api/docs` qua `supertest`; (3) E2E `hold → checkout → checkin` (21 tests BE, 4 suites). Không test mọi CRUD đơn giản — công sức lớn nhưng giá trị tăng thêm thấp.

## 18. Docker — vì sao multi-stage build?

Tách môi trường BUILD (cần TypeScript, devDependencies) khỏi môi trường CHẠY THẬT (chỉ cần code đã build + production dependencies) — giảm kích thước image 50-70%, giảm bề mặt tấn công bảo mật (ít package hơn = ít lỗ hổng tiềm ẩn).

## 19. CI/CD — pipeline hoạt động ra sao?

Push/PR vào `main` → GitHub Actions 4 jobs song song `lint` / `typecheck` / `test` / `build` (BE cần `prisma generate` trước typecheck/test/build, FE build kèm `VITE_API_URL`). Chỉ BE có thêm job `deploy` (`needs: [lint, typecheck, test, build]`) gọi Deploy Hook khi push thẳng `main` — FE bỏ CD vì Vercel tự deploy, chỉ giữ CI.

## 20. Monitoring — đo gì và tại sao?

Ngoài metrics hạ tầng mặc định (CPU, memory, event loop lag), có 2 **business metric** riêng: tổng vé đã bán (Counter, phản ánh sức khỏe kinh doanh) và số lần giữ chỗ bị từ chối, tách nhãn theo lý do (`out_of_stock` vs `contention`) — 2 con số này cần 2 hướng xử lý khác nhau nếu tăng bất thường (1 cái là dấu hiệu sự kiện đang hot, 1 cái là dấu hiệu hệ thống bị nghẽn kỹ thuật thật).

## 21. OpenAPI — vì sao thêm `GET /api/docs`?

Thay vì Postman collection rời rạc, OpenAPI 3.0 (`docs/openapi.json:1`, 34 paths) là **hợp đồng sống** giữa BE và FE — FE generate types, BE validate, interviewer curl `/api/docs` thấy ngay 35 endpoints, không cần đọc code. Dùng Zod → OpenAPI thủ công, đủ để demo, không cần `swagger-ui` nặng.

## 22. E2E — vì sao thêm `tests/e2e/flow.test.ts`?

Unit test mock từng service riêng lẻ không phát hiện lỗi **tích hợp** (ví dụ `orderService.checkout` quên mock `notificationRepository` → `Foreign key violated` trong test E2E đã bắt được). E2E mock 6 repos nhưng chạy flow `hold → checkout → checkin` end-to-end, đảm bảo 3 modules phối hợp đúng.

## 23. RabbitMQ retry — vì sao không để Docker restart?

Ban đầu `connectRabbitMQ` fail → `process.exit(1)` → Docker `restart: unless-stopped` mới retry sau 10s, làm BE downtime 10s mỗi khi RabbitMQ chậm hơn BE. Thêm retry 5×2s + `connection.on('close')` auto-reconnect trong `src/config/rabbitmq.ts:18` giúp BE tự hồi phục trong 10s mà không cần container restart, log rõ `thử lại lần X`.

## 24. Kể 1 lần bạn tự phát hiện và sửa 1 lỗi nghiệp vụ thật (câu hỏi hành vi rất hay gặp)

Sau khi hoàn thành các phase, tôi tự rà lại toàn bộ luồng bằng cách tưởng tượng từng actor (Admin, Organizer, Staff, Customer) thao tác **độc lập, không đồng bộ với nhau** — phát hiện: Admin có thể đổi role của 1 Staff đang được gán vào Event, để lại liên kết "mồ côi". Cũng phát hiện thêm: Event ở trạng thái `DRAFT` vẫn bị lộ công khai và mua được vé; Event đã hủy vẫn cho checkout nếu khách giữ chỗ trước đó; reset password không thu hồi session cũ. Sửa bằng cách thêm kiểm tra ràng buộc ở tầng Service (không phải chỉ dựa Foreign Key DB), và bổ sung kiểm tra `event.status`/`startTime` ở đúng các điểm race có thể xảy ra (trước vòng lặp CAS, và lại một lần nữa ngay trước khi checkout — vì trạng thái Event có thể đổi ngay trong 10 phút giữ chỗ).
