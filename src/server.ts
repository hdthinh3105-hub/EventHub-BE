// src/server.ts
//
// Đây mới là entry point thật (chạy bằng "tsx watch src/server.ts").
// Trách nhiệm duy nhất của file này: khởi động server + xử lý tắt server
// một cách "graceful" (an toàn) - điều mà rất nhiều Junior bỏ qua.

import dns from 'dns';
// Ép Node.js ưu tiên kết quả IPv4 khi phân giải DNS - sửa lỗi hiệu năng
// NỔI TIẾNG của musl libc (dùng trong node:alpine, image Docker ta
// đang chạy): mặc định Node thử IPv6 (AAAA record) TRƯỚC, chờ timeout
// rồi mới fallback về IPv4 - với 1 app kết nối ra 5+ dịch vụ cloud
// khác nhau (Neon, Upstash, CloudAMQP, Cloudinary, Gmail), độ trễ này
// cộng dồn RẤT rõ rệt, đúng là nguyên nhân chính khiến container "chậm
// hơn hẳn" so với chạy trực tiếp bằng "npm run dev" (không bị ảnh
// hưởng bởi image Docker vì chạy thẳng trên Windows). Phải gọi TRƯỚC
// bất kỳ import nào khác có thể mở kết nối mạng (database.ts, redis.ts...).
dns.setDefaultResultOrder('ipv4first');

import http from 'http';
import app from './app';
import { env } from './config/env';
import { logger } from './utils/logger';
import { prisma } from './config/database';
import { redis } from './config/redis';
import { startExpireHoldsJob } from './jobs/expireHolds.job';
import { connectRabbitMQ, closeRabbitMQ } from './config/rabbitmq';
import { startEmailConsumer } from './queues/email.consumer';
import { initSocket } from './config/socket';

// Bootstrap bất đồng bộ - PHẢI connect RabbitMQ xong TRƯỚC KHI server
// nhận request, nếu không request checkout đầu tiên có thể gọi
// publishTicketEmail() trong lúc channel chưa sẵn sàng, gây lỗi.
async function bootstrap() {
  await connectRabbitMQ();
  startEmailConsumer();

  // Tạo http.Server RIÊNG từ app Express - đây là thay đổi bắt buộc để
  // gắn được Socket.IO. Trước đây "app.listen()" tự tạo http.Server ẩn
  // bên trong, ta không có tham chiếu tới nó để gắn thêm Socket.IO vào.
  // Giờ tạo tường minh bằng http.createServer(app), initSocket() nhận
  // đúng http.Server này, cả Express (HTTP thường) và Socket.IO
  // (WebSocket) cùng chạy chung 1 cổng (port) duy nhất.
  const httpServer = http.createServer(app);
  initSocket(httpServer);

  const port = Number(env.PORT) || 4000;
  const server = httpServer.listen(port, '0.0.0.0', () => {
    logger.info(`Server đang chạy tại http://0.0.0.0:${port}`);
    logger.info(`Môi trường: ${env.NODE_ENV}`);
    startExpireHoldsJob();
  });

  // --- Graceful shutdown ---
  // Tại sao cần đoạn này? Khi bạn deploy lên Docker/VPS và chạy lệnh
  // restart hoặc deploy bản mới, hệ điều hành gửi tín hiệu SIGTERM cho
  // process. Nếu không xử lý, server bị kill NGAY LẬP TỨC - request đang
  // xử lý dở (VD: đang ghi vào DB giữa chừng 1 giao dịch) sẽ bị cắt ngang,
  // có thể gây dữ liệu không nhất quán. Graceful shutdown đảm bảo: ngừng
  // nhận request mới, xử lý nốt request đang dở, đóng kết nối DB sạch sẽ,
  // rồi mới thoát process.
  function gracefulShutdown(signal: string) {
    logger.info(`Nhận tín hiệu ${signal}, đang tắt server...`);

    server.close(async () => {
      logger.info('Đã đóng HTTP server');
      await prisma.$disconnect();
      logger.info('Đã ngắt kết nối database');
      redis.disconnect();
      logger.info('Đã ngắt kết nối Redis');
      await closeRabbitMQ();
      logger.info('Đã ngắt kết nối RabbitMQ');
      process.exit(0);
    });

    // Nếu sau 10s vẫn chưa tắt xong (có request bị treo), buộc thoát
    setTimeout(() => {
      logger.error('Không thể tắt server đúng cách, buộc thoát');
      process.exit(1);
    }, 10_000);
  }

  process.on('SIGTERM', () => gracefulShutdown('SIGTERM')); // tín hiệu Docker gửi khi stop container
  process.on('SIGINT', () => gracefulShutdown('SIGINT')); // Ctrl+C lúc dev
}

bootstrap().catch((err) => {
  logger.error(`Lỗi khởi động server: ${err}`);
  process.exit(1);
});

// Bắt lỗi không được catch ở đâu cả - tránh process chết âm thầm không rõ lý do
process.on('unhandledRejection', (reason) => {
  logger.error(`Unhandled Rejection: ${reason}`);
});