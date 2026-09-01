#!/bin/sh
set -e

echo "Đang chạy Prisma migrations..."
npx prisma migrate deploy

echo "Đang seed dữ liệu tham chiếu..."
npx tsx prisma/seed.ts || echo "Seed đã tồn tại hoặc lỗi nhẹ, bỏ qua..."

echo "Chờ RabbitMQ sẵn sàng..."
for i in 1 2 3 4 5 6 7 8 9 10; do
  if node -e "require('amqplib').connect(process.env.RABBITMQ_URL).then(c=>c.close().then(()=>process.exit(0))).catch(()=>process.exit(1))" 2>/dev/null; then
    echo "RabbitMQ đã sẵn sàng"
    break
  fi
  echo "Chờ RabbitMQ... lần $i"
  sleep 2
done

echo "Khởi động server..."
exec node dist/server.js
