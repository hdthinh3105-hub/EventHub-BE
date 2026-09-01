// src/modules/user/user.controller.ts
import { Request, Response } from 'express';
import { userService } from './user.service';
import { ApiResponse } from '../../utils/apiResponse';
import { asyncHandler } from '../../utils/asyncHandler';

export const userController = {
  listUsers: asyncHandler(async (req: Request, res: Response) => {
    const query = req.validatedQuery as { role?: 'ADMIN' | 'ORGANIZER' | 'STAFF' | 'CUSTOMER' } | undefined;
    const users = await userService.list(query ? { role: query.role } : undefined, req.user!);
    res.status(200).json(ApiResponse.success(users, 'Lấy danh sách user thành công'));
  }),

  getUser: asyncHandler(async (req: Request, res: Response) => {
    const user = await userService.getById(req.params.id as string);
    res.status(200).json(ApiResponse.success(user, 'Lấy thông tin user thành công'));
  }),

  assignRole: asyncHandler(async (req: Request, res: Response) => {
    const user = await userService.assignRole(req.params.id as string, req.body, req.user!);
    res.status(200).json(ApiResponse.success(user, 'Cập nhật role thành công'));
  }),
};