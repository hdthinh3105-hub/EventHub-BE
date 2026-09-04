import request from 'supertest';
import app from '../../src/app';

describe('GET /api/docs', () => {
  it('trả về OpenAPI spec', async () => {
    const res = await request(app).get('/api/docs');
    expect(res.status).toBe(200);
    expect(res.body.openapi).toBe('3.0.0');
    expect(res.body.info.title).toBe('EventHub API');
  });
});
