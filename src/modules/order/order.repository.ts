// src/modules/order/order.repository.ts
import crypto from 'crypto';
import { prisma } from '../../config/database';

export const orderRepository = {
  findHoldById(id: string) {
    return prisma.ticketHold.findUnique({
      where: { id },
      include: { ticketType: true },
    });
  },

  findOrderByIdWithTickets(orderId: string, userId: string) {
    return prisma.order.findFirst({
      where: { id: orderId, userId },
      include: {
        orderItems: {
          include: {
            ticketType: { select: { name: true } },
            tickets: true,
          },
        },
      },
    });
  },

  // Toàn bộ thao tác này PHẢI atomic - hoặc tất cả cùng thành công,
  // hoặc không gì xảy ra cả. Nếu chỉ tăng soldQuantity mà tạo Ticket
  // thất bại giữa chừng, ta sẽ có "vé đã bán" nhưng KHÔNG CÓ vé thật
  // nào tồn tại - dữ liệu hỏng nghiêm trọng. $transaction của Prisma
  // đảm bảo tất cả các câu lệnh bên trong cùng chung 1 database
  // transaction thật (COMMIT hoặc ROLLBACK toàn bộ).
  async checkout(params: {
    holdId: string;
    ticketTypeId: string;
    userId: string;
    quantity: number;
    unitPrice: number;
  }) {
    const { holdId, ticketTypeId, userId, quantity, unitPrice } = params;
    const totalAmount = unitPrice * quantity;

    return prisma.$transaction(async (tx) => {
      // 1. Tăng soldQuantity - dùng increment (không phải đọc-rồi-cộng
      // trong code) để chính DB tự đảm bảo tính atomic cho phép cộng này,
      // tránh cần thêm 1 vòng optimistic locking nữa ở đây.
      await tx.ticketType.update({
        where: { id: ticketTypeId },
        data: { soldQuantity: { increment: quantity } },
      });

      // 2. Tạo Order với trạng thái PAID - đây là nơi "giả lập" thanh
      // toán thành công ngay lập tức. Hệ thống thật sẽ có trạng thái
      // PENDING chờ webhook cổng thanh toán xác nhận, nhưng project này
      // không tích hợp cổng thanh toán thật nên bỏ qua bước chờ đó.
      const order = await tx.order.create({
        data: { userId, totalAmount, status: 'PAID' },
      });

      const orderItem = await tx.orderItem.create({
        data: { orderId: order.id, ticketTypeId, quantity, unitPrice },
      });

      // 3. Tạo TỪNG vé riêng biệt (không phải 1 dòng cho cả quantity) -
      // vì mỗi vé cần QR code RIÊNG để check-in độc lập (đã giải thích
      // lý do tách Ticket khỏi OrderItem từ khi thiết kế ERD ở Phase 2).
      const ticketsData = Array.from({ length: quantity }, () => ({
        orderItemId: orderItem.id,
        qrCode: crypto.randomBytes(16).toString('hex'),
      }));
      await tx.ticket.createMany({ data: ticketsData });

      // 4. Xóa hold - đã "tiêu thụ" xong, không cần giữ chỗ tạm nữa
      await tx.ticketHold.delete({ where: { id: holdId } });

      const tickets = await tx.ticket.findMany({ where: { orderItemId: orderItem.id } });

      return { order, tickets };
    });
  },

  // --- Dùng cho Export báo cáo doanh thu ---
  // Lấy toàn bộ OrderItem (kèm Order, User, Ticket) thuộc các TicketType
  // của 1 Event cụ thể - đây là dữ liệu thô để tổng hợp thành file Excel.
  findOrderItemsByEventId(eventId: string) {
    return prisma.orderItem.findMany({
      where: {
        ticketType: { eventId },
        order: { status: 'PAID' }, // chỉ tính đơn đã thanh toán thật vào doanh thu
      },
      include: {
        order: { include: { user: { select: { email: true, fullName: true } } } },
        ticketType: { select: { name: true } },
        tickets: { select: { qrCode: true, isCheckedIn: true } },
      },
      orderBy: { order: { createdAt: 'asc' } },
    });
  },

  // --- Dùng cho Import vé mời hàng loạt ---
  // Nhận danh sách khách mời đã validate, tạo TOÀN BỘ Order/OrderItem/
  // Ticket cho từng người trong CÙNG 1 transaction - hoặc tất cả thành
  // công, hoặc không ai được tạo cả (tránh tình trạng import nửa chừng
  // rồi lỗi giữa danh sách, để lại dữ liệu rác khó dọn).
  async bulkImportGuestTickets(
    ticketTypeId: string,
    guests: { userId: string; quantity: number }[],
  ) {
    const totalQuantity = guests.reduce((sum, g) => sum + g.quantity, 0);

    return prisma.$transaction(async (tx) => {
      await tx.ticketType.update({
        where: { id: ticketTypeId },
        data: { soldQuantity: { increment: totalQuantity } },
      });

      const results: { userId: string; order: { id: string }; tickets: { id: string; qrCode: string }[] }[] = [];

      for (const guest of guests) {
        const order = await tx.order.create({
          data: { userId: guest.userId, totalAmount: 0, status: 'PAID' }, // vé mời - miễn phí
        });

        const orderItem = await tx.orderItem.create({
          data: { orderId: order.id, ticketTypeId, quantity: guest.quantity, unitPrice: 0 },
        });

        const ticketsData = Array.from({ length: guest.quantity }, () => ({
          orderItemId: orderItem.id,
          qrCode: crypto.randomBytes(16).toString('hex'),
        }));
        await tx.ticket.createMany({ data: ticketsData });

        const tickets = await tx.ticket.findMany({ where: { orderItemId: orderItem.id } });

        results.push({ userId: guest.userId, order, tickets });
      }

      return results;
    });
  },
};