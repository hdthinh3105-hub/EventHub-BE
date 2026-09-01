// src/modules/order/order.service.ts
import crypto from 'crypto';
import bcrypt from 'bcrypt';
import ExcelJS from 'exceljs';
import { orderRepository } from './order.repository';
import { eventRepository } from '../event/event.repository';
import { userRepository } from '../user/user.repository';
import { authRepository } from '../auth/auth.repository';
import { ticketTypeRepository } from '../ticket-type/ticket-type.repository';
import { assertCanModifyEvent } from '../event/event.service';
import { AppError } from '../../utils/apiResponse';
import { CheckoutInput } from './order.validation';
import { JwtPayload } from '../../utils/jwt';
import { publishTicketEmail } from '../../queues/email.queue';
import { getIO, emitToUser } from '../../config/socket';
import { notificationRepository } from '../notification/notification.repository';
import { logger } from '../../utils/logger';
import { ticketsSoldCounter } from '../../config/metrics';

function cellToString(value: ExcelJS.CellValue): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number') return String(value);
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'object') {
    if ('richText' in value && Array.isArray(value.richText)) {
      return value.richText.map((rt) => rt.text).join('').trim();
    }
    if ('text' in value) {
      return String(value.text).trim();
    }
    if ('result' in value) {
      return String(value.result).trim();
    }
  }
  return String(value).trim();
}

export const orderService = {
  async getOrderById(orderId: string, user: JwtPayload) {
    const order = await orderRepository.findOrderByIdWithTickets(orderId, user.userId);
    if (!order) {
      throw new AppError('Không tìm thấy đơn hàng', 404);
    }

    const event = order.orderItems[0]?.ticketType
      ? await eventRepository.findById(
          (await ticketTypeRepository.findById(order.orderItems[0].ticketTypeId))?.eventId ?? '',
        )
      : null;

    return {
      order: {
        id: order.id,
        userId: order.userId,
        totalAmount: order.totalAmount.toString(),
        status: order.status,
        createdAt: order.createdAt.toISOString(),
        updatedAt: order.updatedAt.toISOString(),
      },
      eventTitle: event?.title ?? '',
      eventId: event?.id ?? '',
      tickets: order.orderItems.flatMap((oi) =>
        oi.tickets.map((t) => ({
          id: t.id,
          orderItemId: t.orderItemId,
          qrCode: t.qrCode,
          isCheckedIn: t.isCheckedIn,
          createdAt: t.createdAt.toISOString(),
        })),
      ),
      ticketTypeName: order.orderItems[0]?.ticketType?.name ?? '',
      quantity: order.orderItems.reduce((sum, oi) => sum + oi.quantity, 0),
    };
  },

  async checkout(input: CheckoutInput, user: JwtPayload) {
    const hold = await orderRepository.findHoldById(input.holdId);
    if (!hold) {
      throw new AppError('Không tìm thấy phiên giữ chỗ', 404);
    }

    if (hold.userId !== user.userId) {
      throw new AppError('Bạn không có quyền thanh toán phiên giữ chỗ này', 403);
    }

    if (hold.expiresAt < new Date()) {
      throw new AppError('Phiên giữ chỗ đã hết hạn, vui lòng giữ chỗ lại', 410);
    }

    const event = await eventRepository.findById(hold.ticketType.eventId);
    if (!event) {
      throw new AppError('Không tìm thấy sự kiện', 404);
    }
    if (event.status === 'CANCELLED' || event.status === 'COMPLETED') {
      throw new AppError('Sự kiện đã bị hủy hoặc đã kết thúc, không thể thanh toán', 409);
    }

    const { order, tickets } = await orderRepository.checkout({
      holdId: hold.id,
      ticketTypeId: hold.ticketTypeId,
      userId: user.userId,
      quantity: hold.quantity,
      unitPrice: Number(hold.ticketType.price),
    });

    // --- Metric: đếm tổng số vé bán thành công qua checkout thật.
    // Đặt NGAY SAU transaction thành công - nếu transaction throw lỗi
    // giữa chừng, dòng này không bao giờ chạy tới, đảm bảo con số này
    // luôn khớp đúng với số vé THẬT SỰ tồn tại trong DB, không bị đếm
    // "hụt hơi" hay đếm khống.
    ticketsSoldCounter.inc(hold.quantity);

    const fullUser = await userRepository.findById(user.userId);

    if (fullUser) {
      publishTicketEmail({
        to: fullUser.email,
        eventTitle: event.title,
        ticketTypeName: hold.ticketType.name,
        quantity: hold.quantity,
        totalAmount: Number(order.totalAmount),
        tickets: tickets.map((t) => ({ id: t.id, qrCode: t.qrCode })),
      });

      const newSoldQuantity = hold.ticketType.soldQuantity + hold.quantity;

      try {
        getIO().to(`event:${event.id}`).emit('ticket_sold', {
          ticketTypeId: hold.ticketTypeId,
          ticketTypeName: hold.ticketType.name,
          quantitySold: hold.quantity,
          newSoldQuantity,
          totalQuantity: hold.ticketType.totalQuantity,
        });
      } catch (err) {
        logger.error(`[Socket.IO] Lỗi emit ticket_sold: ${err}`);
      }

      await notificationRepository.create({
        userId: event.organizerId,
        title: 'Có vé mới được bán',
        message: `${hold.quantity} vé loại "${hold.ticketType.name}" vừa được bán cho sự kiện "${event.title}"`,
      });

      try {
        // Đẩy thông báo REALTIME cho Organizer - nhờ socket đã tự join
        // room user:<id> lúc connect, Organizer đang mở trang quản lý
        // sự kiện sẽ thấy thông báo xuất hiện ngay không cần F5.
        emitToUser(event.organizerId, 'notification', {
          userId: event.organizerId,
          title: 'Có vé mới được bán',
          message: `${hold.quantity} vé loại "${hold.ticketType.name}" vừa được bán cho sự kiện "${event.title}"`,
          isRead: false,
          createdAt: new Date().toISOString(),
        });
      } catch (err) {
        logger.error(`[Socket.IO] Lỗi emit notification: ${err}`);
      }
    }

    return { order, tickets };
  },

  async exportEventRevenue(eventId: string, user: JwtPayload): Promise<Buffer> {
    const event = await eventRepository.findById(eventId);
    if (!event) {
      throw new AppError('Không tìm thấy sự kiện', 404);
    }
    assertCanModifyEvent(event, user);

    const orderItems = await orderRepository.findOrderItemsByEventId(eventId);

    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Doanh thu');

    sheet.columns = [
      { header: 'Mã đơn hàng', key: 'orderId', width: 38 },
      { header: 'Khách hàng', key: 'customerName', width: 24 },
      { header: 'Email', key: 'email', width: 28 },
      { header: 'Loại vé', key: 'ticketType', width: 20 },
      { header: 'Số lượng', key: 'quantity', width: 10 },
      { header: 'Đơn giá', key: 'unitPrice', width: 14 },
      { header: 'Thành tiền', key: 'total', width: 14 },
      { header: 'Ngày mua', key: 'createdAt', width: 20 },
    ];
    sheet.getRow(1).font = { bold: true };

    let totalRevenue = 0;
    for (const item of orderItems) {
      const lineTotal = Number(item.unitPrice) * item.quantity;
      totalRevenue += lineTotal;
      sheet.addRow({
        orderId: item.order.id,
        customerName: item.order.user.fullName,
        email: item.order.user.email,
        ticketType: item.ticketType.name,
        quantity: item.quantity,
        unitPrice: Number(item.unitPrice),
        total: lineTotal,
        createdAt: item.order.createdAt.toLocaleString('vi-VN'),
      });
    }

    sheet.addRow({});
    const summaryRow = sheet.addRow({ ticketType: 'TỔNG DOANH THU', total: totalRevenue });
    summaryRow.font = { bold: true };

    const arrayBuffer = await workbook.xlsx.writeBuffer();
    return Buffer.from(arrayBuffer);
  },

  async importGuestList(
    ticketTypeId: string,
    fileBuffer: Buffer,
    user: JwtPayload,
  ): Promise<{ importedGuests: number; totalTickets: number }> {
    const ticketType = await ticketTypeRepository.findById(ticketTypeId);
    if (!ticketType) {
      throw new AppError('Không tìm thấy loại vé', 404);
    }

    const event = await eventRepository.findById(ticketType.eventId);
    if (!event) {
      throw new AppError('Không tìm thấy sự kiện', 404);
    }
    assertCanModifyEvent(event, user);

    if (event.status === 'CANCELLED' || event.status === 'COMPLETED') {
      throw new AppError('Không thể nhập vé mời cho sự kiện đã hủy hoặc đã kết thúc', 409);
    }

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(fileBuffer as unknown as ExcelJS.Buffer);
    const sheet = workbook.worksheets[0];
    if (!sheet) {
      throw new AppError('File Excel không có sheet nào', 400);
    }

    const rows: { fullName: string; email: string; quantity: number }[] = [];
    sheet.eachRow((row, rowNumber) => {
      if (rowNumber === 1) return;
      const fullName = cellToString(row.getCell(1).value);
      const email = cellToString(row.getCell(2).value);
      const quantity = Number(row.getCell(3).value ?? 1);

      if (!fullName || !email) return;
      rows.push({ fullName, email, quantity: quantity > 0 ? quantity : 1 });
    });

    if (rows.length === 0) {
      throw new AppError('Không tìm thấy dữ liệu hợp lệ trong file Excel', 400);
    }

    const totalRequested = rows.reduce((sum, r) => sum + r.quantity, 0);
    const available = ticketType.totalQuantity - ticketType.soldQuantity;
    if (totalRequested > available) {
      throw new AppError(
        `Chỉ còn ${available} vé, không đủ để nhập ${totalRequested} vé mời`,
        409,
      );
    }

    const guestRole = await authRepository.findRoleByName('CUSTOMER');
    if (!guestRole) {
      throw new AppError('Hệ thống chưa sẵn sàng (thiếu role CUSTOMER)', 500);
    }

    const guests: { userId: string; quantity: number }[] = [];
    for (const row of rows) {
      let existingUser = await authRepository.findUserByEmail(row.email);
      if (!existingUser) {
        const randomPassword = crypto.randomBytes(16).toString('hex');
        const passwordHash = await bcrypt.hash(randomPassword, 10);
        existingUser = await authRepository.createUser({
          email: row.email,
          fullName: row.fullName,
          passwordHash,
          roleId: guestRole.id,
        });
      }
      guests.push({ userId: existingUser.id, quantity: row.quantity });
    }

    const results = await orderRepository.bulkImportGuestTickets(ticketTypeId, guests);

    // Vé mời cũng là vé PHÁT HÀNH THẬT - tính vào cùng metric tổng số
    // vé đã bán để Grafana phản ánh đúng tổng lượng vé đang lưu hành,
    // dù không thu tiền (khác totalAmount trong Order, vẫn = 0 như thiết kế).
    ticketsSoldCounter.inc(totalRequested);

    results.forEach((result, index) => {
      const row = rows[index];
      if (!row) return;
      publishTicketEmail({
        to: row.email,
        eventTitle: event.title,
        ticketTypeName: ticketType.name,
        quantity: row.quantity,
        totalAmount: 0,
        tickets: result.tickets.map((t) => ({ id: t.id, qrCode: t.qrCode })),
      });
    });

    return { importedGuests: guests.length, totalTickets: totalRequested };
  },
};