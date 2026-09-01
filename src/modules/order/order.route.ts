// src/modules/order/order.route.ts
import { Router } from 'express';
import { orderController } from './order.controller';
import { authMiddleware, requireRole } from '../../middlewares/auth.middleware';
import { validate } from '../../middlewares/validate.middleware';
import { uploadExcel } from '../../middlewares/uploadExcel.middleware';
import { checkoutSchema } from './order.validation';

const router = Router();

router.get(
  '/event/:eventId/export',
  authMiddleware,
  requireRole('ADMIN', 'ORGANIZER'),
  orderController.exportRevenue,
);

router.get(
  '/:id',
  authMiddleware,
  requireRole('CUSTOMER', 'ADMIN', 'ORGANIZER'),
  orderController.getOrder,
);

router.post(
  '/checkout',
  authMiddleware,
  requireRole('CUSTOMER'),
  validate(checkoutSchema),
  orderController.checkout,
);

router.post(
  '/ticket-type/:ticketTypeId/import',
  authMiddleware,
  requireRole('ADMIN', 'ORGANIZER'),
  uploadExcel.single('file'),
  orderController.importGuestList,
);

export default router;