// src/modules/order/order.controller.ts
import { Request, Response } from 'express';
import { orderService } from './order.service';
import { ApiResponse } from '../../utils/apiResponse';
import { asyncHandler } from '../../utils/asyncHandler';

export const orderController = {
  getOrder: asyncHandler(async (req: Request, res: Response) => {
    const result = await orderService.getOrderById(req.params.id as string, req.user!);
    res.status(200).json(ApiResponse.success(result, 'Lấy thông tin đơn hàng thành công'));
  }),

  checkout: asyncHandler(async (req: Request, res: Response) => {
    const result = await orderService.checkout(req.body, req.user!);
    res.status(201).json(ApiResponse.success(result, 'Thanh toán thành công, vé đã được phát hành'));
  }),

  exportRevenue: asyncHandler(async (req: Request, res: Response) => {
    const buffer = await orderService.exportEventRevenue(req.params.eventId as string, req.user!);

    // Set header để trình duyệt/Postman hiểu đây là file để TẢI VỀ,
    // không phải hiển thị JSON như mọi API khác.
    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    res.setHeader('Content-Disposition', 'attachment; filename="bao-cao-doanh-thu.xlsx"');
    res.send(buffer);
  }),

  importGuestList: asyncHandler(async (req: Request, res: Response) => {
    if (!req.file) {
      res.status(400).json({ success: false, message: 'Vui lòng chọn file Excel' });
      return;
    }
    const result = await orderService.importGuestList(
      req.params.ticketTypeId as string,
      req.file.buffer,
      req.user!,
    );
    res.status(201).json(ApiResponse.success(result, 'Nhập danh sách vé mời thành công'));
  }),
};