# Dockerfile
#
# Multi-stage build - 2 giai đoạn tách biệt:
# 1. "builder": cài ĐẦY ĐỦ package (bao gồm devDependencies như
#    typescript, tsc-alias) để biên dịch TypeScript -> JavaScript
# 2. "production": chỉ copy code ĐÃ BUILD (thư mục dist/) + cài LẠI
#    package nhưng chỉ bản PRODUCTION (--omit=dev) - image cuối cùng
#    không hề chứa mã nguồn TypeScript hay devDependencies, nhẹ hơn
#    đáng kể (thường giảm 50-70% dung lượng so với build 1 giai đoạn).
#
# Câu hỏi phỏng vấn hay gặp: "Tại sao dùng multi-stage build?" - Trả
# lời: tách biệt môi trường BUILD (cần nhiều công cụ) khỏi môi trường
# CHẠY THẬT (chỉ cần đúng những gì để execute) - giảm kích thước image,
# giảm bề mặt tấn công bảo mật (ít package hơn = ít lỗ hổng tiềm ẩn hơn).

# ---------- Stage 1: builder ----------
FROM node:20-alpine AS builder

WORKDIR /app

# Copy package.json trước, cài dependency TRƯỚC KHI copy toàn bộ code -
# tận dụng Docker layer caching: nếu package.json không đổi, Docker
# dùng lại layer cài đặt cũ (nhanh hơn nhiều) thay vì cài lại từ đầu
# mỗi lần bạn chỉ sửa 1 dòng code business logic.
COPY package*.json ./
COPY prisma ./prisma/
RUN npm ci

COPY . .

# Prisma Client được sinh ra dựa trên schema.prisma - PHẢI generate
# TRƯỚC khi build, vì code TypeScript có import "@prisma/client" cần
# type đã sinh sẵn để biên dịch qua được bước tsc.
RUN npx prisma generate

RUN npm run build

# ---------- Stage 2: production ----------
FROM node:20-alpine AS production

WORKDIR /app

ENV NODE_ENV=production

COPY package*.json ./
COPY prisma ./prisma/

# --omit=dev: CHỈ cài dependencies thật sự cần lúc chạy (express,
# prisma client, ioredis...) - KHÔNG cài typescript, tsc-alias, jest...
RUN npm ci --omit=dev
# tsx chỉ cần để chạy seed trong Docker (prisma/seed.ts viết bằng TS)
RUN npm install --no-save tsx

# Copy code đã build (JavaScript thuần) + Prisma Client đã generate từ
# stage "builder" - không copy mã nguồn .ts, không copy devDependencies.
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder /app/node_modules/@prisma ./node_modules/@prisma

COPY docker-entrypoint.sh ./
RUN chmod +x docker-entrypoint.sh

EXPOSE 4000

# Health check tích hợp sẵn trong image - Docker/orchestrator (VD:
# docker-compose, Kubernetes) tự động biết container này có "sống"
# hay không dựa vào endpoint /health đã viết từ Phase 3, không cần
# công cụ ngoài nào kiểm tra thủ công.
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "require('http').get('http://localhost:4000/health', (r) => process.exit(r.statusCode === 200 ? 0 : 1)).on('error', () => process.exit(1))"

ENTRYPOINT ["./docker-entrypoint.sh"]
