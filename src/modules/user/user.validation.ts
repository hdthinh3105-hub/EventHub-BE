// src/modules/user/user.validation.ts
import { z } from 'zod';

export const listUsersQuerySchema = z.object({
  role: z.enum(['ADMIN', 'ORGANIZER', 'STAFF', 'CUSTOMER']).optional(),
});

export const assignRoleSchema = z.object({
  roleName: z.enum(['ADMIN', 'ORGANIZER', 'STAFF', 'CUSTOMER']),
});

export type ListUsersQuery = z.infer<typeof listUsersQuerySchema>;
export type AssignRoleInput = z.infer<typeof assignRoleSchema>;
