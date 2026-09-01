// src/modules/event/event.validation.ts
import { z } from 'zod';

export const createEventSchema = z
  .object({
    title: z.string().min(5, 'Tiêu đề tối thiểu 5 ký tự').max(200),
    description: z.string().optional(),
    categoryId: z.string().uuid('categoryId không hợp lệ'),
    venueId: z.string().uuid('venueId không hợp lệ'),
    startTime: z.coerce.date(),
    endTime: z.coerce.date(),
  })
  .refine((data) => data.endTime > data.startTime, {
    message: 'Thời gian kết thúc phải sau thời gian bắt đầu',
    path: ['endTime'],
  });

export const updateEventSchema = z.object({
  title: z.string().min(5).max(200).optional(),
  description: z.string().optional(),
  categoryId: z.string().uuid().optional(),
  venueId: z.string().uuid().optional(),
  startTime: z.coerce.date().optional(),
  endTime: z.coerce.date().optional(),
  status: z.enum(['DRAFT', 'PUBLISHED', 'CANCELLED', 'COMPLETED']).optional(),
});

// Query params cho GET /events - pagination + filter, sẽ dùng lại pattern
// này cho hầu hết API list ở các module sau (Ticket, Order...)
export const listEventQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(10),
  categoryId: z.string().uuid().optional(),
  organizerId: z.string().uuid().optional(),
  status: z.enum(['DRAFT', 'PUBLISHED', 'CANCELLED', 'COMPLETED']).optional(),
  search: z.string().optional(), // tìm theo title
});

export type CreateEventInput = z.infer<typeof createEventSchema>;
export type UpdateEventInput = z.infer<typeof updateEventSchema>;
export type ListEventQuery = z.infer<typeof listEventQuerySchema>;
