// src/modules/user/user.service.ts
import { userRepository } from './user.repository';
import { eventStaffRepository } from '../event-staff/event-staff.repository';
import { AppError } from '../../utils/apiResponse';
import { AssignRoleInput, ListUsersQuery } from './user.validation';
import { JwtPayload } from '../../utils/jwt';
import { writeAuditLog } from '../../utils/auditLog';

export const userService = {
  list(query?: ListUsersQuery, actor?: JwtPayload) {
    // ORGANIZER chỉ được xem danh sách STAFF (để gán check-in), không được xem toàn bộ user
    if (actor?.roleName === 'ORGANIZER' && query?.role !== 'STAFF') {
      throw new AppError('Organizer chỉ được xem danh sách nhân viên STAFF', 403);
    }
    return userRepository.findAll(query?.role);
  },

  async getById(id: string) {
    const user = await userRepository.findByIdPublic(id);
    if (!user) {
      throw new AppError('Không tìm thấy user', 404);
    }
    return user;
  },

  async assignRole(targetUserId: string, input: AssignRoleInput, actor: JwtPayload) {
    const targetUser = await userRepository.findById(targetUserId);
    if (!targetUser) {
      throw new AppError('Không tìm thấy user', 404);
    }

    // Chặn Admin tự đổi role của chính mình - tránh trường hợp Admin
    // vô tình (hoặc bị lừa qua API) tự hạ quyền bản thân, dẫn tới hệ
    // thống có thể mất người quản trị. Đây là nguyên tắc phòng thủ phổ
    // biến trong các hệ thống quản trị thật.
    if (targetUser.id === actor.userId) {
      throw new AppError('Không thể tự thay đổi role của chính mình', 400);
    }

    const role = await userRepository.findRoleByName(input.roleName);
    if (!role) {
      // Về lý thuyết không xảy ra vì Zod enum đã giới hạn giá trị hợp lệ,
      // nhưng vẫn kiểm tra vì role có thể bị xóa nhầm khỏi DB.
      throw new AppError('Role không tồn tại trong hệ thống', 400);
    }

    // --- Ràng buộc phát hiện được từ thực tế sử dụng ---
    // Nếu user hiện đang là STAFF và Admin muốn đổi họ sang role KHÁC,
    // phải kiểm tra: họ có đang được gán vào Event nào không? Nếu có,
    // CHẶN đổi role - bắt buộc Admin/Organizer phải chủ động gỡ khỏi
    // từng Event trước (qua DELETE /event-staff/event/:eventId/user/:userId)
    // rồi mới đổi role được. Lý do: nếu cho đổi tùy tiện, bản ghi
    // EventStaff cũ vẫn còn tồn tại trong DB nhưng trỏ tới 1 user không
    // còn quyền STAFF nữa - gây dữ liệu "mồ côi" và lỗ hổng logic phân
    // quyền (checkin.service.ts dựa vào EventStaff để cấp quyền quét
    // vé). Không dùng ON DELETE CASCADE ở tầng DB vì ta muốn Admin phải
    // CHỦ ĐỘNG xác nhận qua 1 bước riêng, không âm thầm mất dữ liệu
    // phân công chỉ vì đổi role.
    if (targetUser.role.name === 'STAFF' && input.roleName !== 'STAFF') {
      const assignedEventCount = await eventStaffRepository.countByUserId(targetUserId);
      if (assignedEventCount > 0) {
        throw new AppError(
          `Không thể đổi role: user này đang được gán làm Staff cho ${assignedEventCount} sự kiện. Vui lòng gỡ khỏi tất cả sự kiện trước (DELETE /event-staff/event/:eventId/user/:userId) rồi mới đổi role.`,
          409,
        );
      }
    }

    const oldRoleName = targetUser.role.name;
    const updated = await userRepository.updateRole(targetUserId, role.id);

    // Đây là thao tác NHẠY CẢM NHẤT trong toàn hệ thống (đổi quyền hạn
    // 1 tài khoản) - đáng ghi vết nhất trong mọi loại audit log. Ghi rõ
    // cả role CŨ lẫn MỚI, ai là người thực hiện (actor.userId, không
    // phải targetUserId) - đây chính là câu trả lời cho câu hỏi phỏng
    // vấn "làm sao bạn biết ai đã cấp quyền Admin cho user X".
    void writeAuditLog({
      userId: actor.userId,
      action: 'UPDATE',
      entityType: 'User',
      entityId: targetUserId,
      oldValue: { role: oldRoleName },
      newValue: { role: input.roleName },
    });

    return updated;
  },
};