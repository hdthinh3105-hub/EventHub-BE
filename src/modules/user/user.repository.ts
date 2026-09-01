// src/modules/user/user.repository.ts
import { prisma } from '../../config/database';

export const userRepository = {
  findAll(roleName?: string) {
    return prisma.user.findMany({
      where: {
        deletedAt: null,
        ...(roleName && { role: { name: roleName } }),
      },
      select: {
        id: true,
        email: true,
        fullName: true,
        phone: true,
        isActive: true,
        isVerified: true,
        createdAt: true,
        role: { select: { name: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  },

  findById(id: string) {
    return prisma.user.findFirst({
      where: { id, deletedAt: null },
      include: { role: true },
    });
  },

  findByIdPublic(id: string) {
    return prisma.user.findFirst({
      where: { id, deletedAt: null },
      select: {
        id: true,
        email: true,
        fullName: true,
        phone: true,
        isActive: true,
        isVerified: true,
        createdAt: true,
        role: { select: { name: true } },
      },
    });
  },

  findRoleByName(name: string) {
    return prisma.role.findUnique({ where: { name } });
  },

  updateRole(userId: string, roleId: string) {
    return prisma.user.update({
      where: { id: userId },
      data: { roleId },
      select: {
        id: true,
        email: true,
        fullName: true,
        role: { select: { name: true } },
      },
    });
  },
};