import Fastify from 'fastify';
import { describe, expect, it, vi } from 'vitest';
import { registerCallsRoutes } from '@/calls/calls.routes.js';

const callsService = {
  list: vi.fn(async () => ({ items: [{ id: 'call-1', status: 'COMPLETED' }] })),
  getById: vi.fn(async () => ({ id: 'call-1', status: 'COMPLETED' })),
  getTranscript: vi.fn(async () => ({ id: 'call-1', transcript: [] })),
};

describe('Calls routes', () => {
  it('returns calls list', async () => {
    const app = Fastify();
    app.decorate('authenticate', async (request) => {
      request.adminId = 'admin-1';
    });
    app.decorate('verifyCsrf', async () => undefined);

    await registerCallsRoutes(app, { callsService: callsService as never });

    const response = await app.inject({ method: 'GET', url: '/api/calls?limit=5' });
    expect(response.statusCode).toBe(200);
    expect(response.json().items).toHaveLength(1);

    await app.close();
  });
});
