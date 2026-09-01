// src/modules/user/user.route.ts
import { Router } from 'express';
import { userController } from './user.controller';
import { authMiddleware, requireRole } from '../../middlewares/auth.middleware';
import { validate } from '../../middlewares/validate.middleware';
import { validateQuery } from '../../middlewares/validateQuery.middleware';
import { assignRoleSchema, listUsersQuerySchema } from './user.validation';

const router = Router();

router.get('/', authMiddleware, requireRole('ADMIN', 'ORGANIZER'), validateQuery(listUsersQuerySchema), userController.listUsers);

router.get('/:id', authMiddleware, requireRole('ADMIN', 'ORGANIZER'), userController.getUser);

router.patch(
  '/:id/role',
  authMiddleware,
  requireRole('ADMIN'),
  validate(assignRoleSchema),
  userController.assignRole,
);

export default router;