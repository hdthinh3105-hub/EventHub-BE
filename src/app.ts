// src/app.ts
//
// File này CHỈ định nghĩa Express app - không gọi app.listen().
// Lý do tách khỏi server.ts: để có thể import app trong Jest + supertest
// mà không cần mở port thật (xem Phase 14 - Testing).

import express, { Application } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { errorMiddleware, notFoundMiddleware } from './middlewares/error.middleware';
import { globalRateLimiter } from './middlewares/rateLimit.middleware';
import { metricsMiddleware } from './middlewares/metrics.middleware';
import { register } from './config/metrics';
import { logger } from './utils/logger';
import { env } from './config/env';
import authRoutes from './modules/auth/auth.route';
import userRoutes from './modules/user/user.route';
import categoryRoutes from './modules/category/category.route';
import venueRoutes from './modules/venue/venue.route';
import eventRoutes from './modules/event/event.route';
import ticketTypeRoutes from './modules/ticket-type/ticket-type.route';
import ticketHoldRoutes from './modules/ticket-hold/ticket-hold.route';
import orderRoutes from './modules/order/order.route';
import eventStaffRoutes from './modules/event-staff/event-staff.route';
import checkinRoutes from './modules/checkin/checkin.route';
import notificationRoutes from './modules/notification/notification.route';

const app: Application = express();

// Render (và hầu hết cloud host) đặt app sau 1 reverse proxy -> mọi request
// đi qua đều có header X-Forwarded-For. Nếu không bật trust proxy, biến này
// bị express-rate-limit coi là misconfig và THROW lỗi ERR_ERL_UNEXPECTED_
// X_FORWARDED_FOR trên TỪNG request /api (mọi API call đều 500). Bật với hop
// đếm = 1 (chỉ tin proxy đầu tiên, vẫn chặn được spoof X-Forwarded-For) ->
// rate limiter lấy đúng IP thật của client.
app.set('trust proxy', 1);

// --- Security middleware (bật ngay từ đầu, không đợi tới Phase Security) ---
app.use(helmet()); // set các HTTP header an toàn (chống XSS, clickjacking cơ bản...)

// CORS: đọc danh sách domain cho phép từ ALLOWED_ORIGINS (phân cách dấu
// phẩy). Nếu KHÔNG set (rỗng) - mở toàn bộ '*', chỉ chấp nhận được ở môi
// trường DEV. Production PHẢI set đúng domain FE thật, không dùng '*'.
const allowedOrigins = env.ALLOWED_ORIGINS
  ? env.ALLOWED_ORIGINS.split(',').map((o) => o.trim())
  : [];

app.use(
  cors({
    origin: allowedOrigins.length > 0 ? allowedOrigins : '*',
    credentials: true,
  }),
);

// --- Metrics middleware - đo TRƯỚC mọi route khác, đảm bảo mọi request
// (kể cả những request bị chặn sau đó bởi rate limit/auth) đều được đếm ---
app.use(metricsMiddleware);

// --- Rate Limiting - áp dụng cho toàn bộ /api (chống DoS thô sơ) ---
app.use('/api', globalRateLimiter);

// --- Body parser ---
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// --- Request logging đơn giản ---
app.use((req, _res, next) => {
  logger.debug(`${req.method} ${req.path}`);
  next();
});

// --- Health check endpoint ---
app.get('/health', (_req, res) => {
  res.status(200).json({ status: 'ok', timestamp: new Date().toISOString() });
});

// --- Metrics endpoint - Prometheus server "kéo" (scrape) dữ liệu tại đây ---
// KHÔNG đặt sau authMiddleware - Prometheus tự động scrape định kỳ, không
// mang theo Bearer token. Bảo mật endpoint này (nếu cần) nên làm ở tầng
// mạng (VD chỉ cho phép IP nội bộ gọi qua Nginx/firewall), không phải
// bằng JWT như API nghiệp vụ thông thường.
app.get('/metrics', async (_req, res) => {
  res.setHeader('Content-Type', register.contentType);
  res.send(await register.metrics());
});

// --- OpenAPI docs ---
import openapi from '../docs/openapi.json';
app.get('/api/docs', (_req, res) => {
  res.json(openapi);
});

// --- Routes ---
app.get('/api', (_req, res) => {
  res.json({ message: 'EventHub API đang chạy' });
});
app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/categories', categoryRoutes);
app.use('/api/venues', venueRoutes);
app.use('/api/events', eventRoutes);
app.use('/api/ticket-types', ticketTypeRoutes);
app.use('/api/ticket-holds', ticketHoldRoutes);
app.use('/api/orders', orderRoutes);
app.use('/api/event-staff', eventStaffRoutes);
app.use('/api/checkins', checkinRoutes);
app.use('/api/notifications', notificationRoutes);

// --- 404 handler ---
app.use(notFoundMiddleware);

// --- Error handler ---
app.use(errorMiddleware);

export default app;