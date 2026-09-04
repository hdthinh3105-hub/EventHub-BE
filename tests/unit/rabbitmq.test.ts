import amqp from 'amqplib';
import { connectRabbitMQ } from '../../src/config/rabbitmq';

jest.mock('amqplib');
jest.mock('../../src/config/env', () => ({
  env: { RABBITMQ_URL: 'amqp://test' },
}));

const mockedAmqp = amqp as jest.Mocked<typeof amqp>;

describe('connectRabbitMQ retry', () => {
  it('thử lại khi lần đầu thất bại và thành công lần 2', async () => {
    const mockChannel = { assertQueue: jest.fn().mockResolvedValue(undefined) } as never;
    const mockConn = {
      createChannel: jest.fn().mockResolvedValue(mockChannel),
      on: jest.fn(),
    } as never;

    mockedAmqp.connect
      .mockRejectedValueOnce(new Error('ECONNREFUSED'))
      .mockResolvedValueOnce(mockConn as never);

    await expect(connectRabbitMQ(3, 10)).resolves.toBeUndefined();
    expect(mockedAmqp.connect).toHaveBeenCalledTimes(2);
  });

  it('ném lỗi sau khi hết số lần retry', async () => {
    mockedAmqp.connect.mockRejectedValue(new Error('fail'));

    await expect(connectRabbitMQ(2, 10)).rejects.toThrow('fail');
    expect(mockedAmqp.connect).toHaveBeenCalledTimes(2);
  });
});
