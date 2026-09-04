import { ticketHoldService } from '../../src/modules/ticket-hold/ticket-hold.service';
import { orderService } from '../../src/modules/order/order.service';
import { checkinService } from '../../src/modules/checkin/checkin.service';
import { ticketTypeRepository } from '../../src/modules/ticket-type/ticket-type.repository';
import { ticketHoldRepository } from '../../src/modules/ticket-hold/ticket-hold.repository';
import { eventRepository } from '../../src/modules/event/event.repository';
import { orderRepository } from '../../src/modules/order/order.repository';
import { checkinRepository } from '../../src/modules/checkin/checkin.repository';
import { JwtPayload } from '../../src/utils/jwt';

jest.mock('../../src/modules/ticket-type/ticket-type.repository');
jest.mock('../../src/modules/ticket-hold/ticket-hold.repository');
jest.mock('../../src/modules/event/event.repository');
jest.mock('../../src/modules/order/order.repository');
jest.mock('../../src/modules/checkin/checkin.repository');
jest.mock('../../src/modules/event-staff/event-staff.repository');
jest.mock('../../src/modules/notification/notification.repository', () => ({
  notificationRepository: { create: jest.fn().mockResolvedValue({}) },
}));
jest.mock('../../src/modules/user/user.repository', () => ({
  userRepository: { findById: jest.fn().mockResolvedValue({ id: 'user-1', email: 'customer@test.vn', fullName: 'Customer' }) },
}));
jest.mock('../../src/queues/email.queue', () => ({
  publishTicketEmail: jest.fn(),
}));
jest.mock('../../src/config/socket', () => ({
  getIO: () => ({ to: () => ({ emit: jest.fn() }) }),
  emitToUser: jest.fn(),
  emitToEvent: jest.fn(),
}));
jest.mock('../../src/config/metrics', () => ({
  ticketsSoldCounter: { inc: jest.fn() },
  holdRejectedCounter: { inc: jest.fn() },
}));

const mockedTicketTypeRepo = ticketTypeRepository as jest.Mocked<typeof ticketTypeRepository>;
const mockedHoldRepo = ticketHoldRepository as jest.Mocked<typeof ticketHoldRepository>;
const mockedEventRepo = eventRepository as jest.Mocked<typeof eventRepository>;
const mockedOrderRepo = orderRepository as jest.Mocked<typeof orderRepository>;
const mockedCheckinRepo = checkinRepository as jest.Mocked<typeof checkinRepository>;
// eslint-disable-next-line @typescript-eslint/no-var-requires
const mockedEventStaffRepo = require('../../src/modules/event-staff/event-staff.repository').eventStaffRepository as jest.Mocked<any>;

const customer: JwtPayload = { userId: 'user-1', roleId: 'role-cus', roleName: 'CUSTOMER' };
const staff: JwtPayload = { userId: 'staff-1', roleId: 'role-staff', roleName: 'STAFF' };

function futureDate() {
  const d = new Date();
  d.setDate(d.getDate() + 10);
  return d;
}

describe('E2E: hold -> checkout -> checkin', () => {
  it('full flow thành công', async () => {
    // 1. Hold
    const ticketType = {
      id: 'tt-1',
      eventId: 'ev-1',
      name: 'VIP',
      price: 100000 as never,
      totalQuantity: 10,
      soldQuantity: 0,
      version: 0,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    mockedTicketTypeRepo.findById.mockResolvedValue(ticketType as never);
    mockedEventRepo.findById.mockResolvedValue({ id: 'ev-1', organizerId: 'org-1', status: 'PUBLISHED', startTime: futureDate() } as never);
    mockedHoldRepo.sumActiveHolds.mockResolvedValue(0);
    mockedHoldRepo.tryBumpVersion.mockResolvedValue({ count: 1 });
    mockedHoldRepo.createHold.mockResolvedValue({ id: 'hold-1', ticketTypeId: 'tt-1', userId: 'user-1', quantity: 2, expiresAt: new Date(Date.now() + 600000), createdAt: new Date() } as never);

    const hold = await ticketHoldService.createHold({ ticketTypeId: 'tt-1', quantity: 2 }, customer);
    expect(hold.id).toBe('hold-1');

    // 2. Checkout
    mockedOrderRepo.findHoldById.mockResolvedValue({
      id: 'hold-1',
      ticketTypeId: 'tt-1',
      userId: 'user-1',
      quantity: 2,
      expiresAt: new Date(Date.now() + 600000),
      ticketType: { ...ticketType, totalQuantity: 10, soldQuantity: 0 },
    } as never);
    mockedOrderRepo.checkout.mockResolvedValue({
      order: { id: 'order-1', userId: 'user-1', totalAmount: 200000 as never, status: 'PAID', createdAt: new Date(), updatedAt: new Date() },
      tickets: [
        { id: 't1', orderItemId: 'oi-1', qrCode: 'qr1', isCheckedIn: false, createdAt: new Date() },
        { id: 't2', orderItemId: 'oi-1', qrCode: 'qr2', isCheckedIn: false, createdAt: new Date() },
      ],
    } as never);

    const checkout = await orderService.checkout({ holdId: 'hold-1' }, customer);
    expect(checkout.order.id).toBe('order-1');
    expect(checkout.tickets).toHaveLength(2);

    // 3. Checkin
    mockedCheckinRepo.findTicketByQrCode.mockResolvedValue({
      id: 't1',
      orderItemId: 'oi-1',
      qrCode: 'qr1',
      isCheckedIn: false,
      createdAt: new Date(),
      orderItem: {
        id: 'oi-1',
        ticketType: { event: { id: 'ev-1', organizerId: 'org-1', title: 'Test Event' }, name: 'VIP' },
        order: { user: { fullName: 'Customer', email: 'customer@test.vn' } },
      },
    } as never);
    mockedEventStaffRepo.isStaffAssignedToEvent.mockResolvedValue(true);
    mockedCheckinRepo.markCheckedIn.mockResolvedValue({ id: 'c1', ticketId: 't1', staffId: 'staff-1', checkedInAt: new Date() } as never);

    const result = await checkinService.checkin('qr1', staff);
    expect(result.ticketId).toBe('t1');
  });
});
