#!/bin/sh
set -e

echo "Đang chạy Prisma migrations..."
npx prisma migrate deploy

echo "Kiểm tra seed..."
if node -e "
const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();
p.role.count().then(c => {
  if (c > 0) console.log('Đã có ' + c + ' roles, bỏ qua seed');
  process.exit(c > 0 ? 0 : 1);
}).catch(() => process.exit(1))
  .finally(() => p.\$disconnect());
" 2>/dev/null; then
  echo "Đã có data, bỏ qua seed"
else
  echo "Chưa có data, chạy seed..."
  npx tsx prisma/seed.ts || echo "Seed lỗi, bỏ qua..."
fi

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
