import cookie from '@fastify/cookie';
import jwt from '@fastify/jwt';
import Fastify from 'fastify';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { registerAuthRoutes } from '@/auth/auth.routes.js';
import { SESSION_COOKIE_NAME } from '@/common/constants.js';

const authService = {
  validateCredentials: vi.fn(),
  getAdminById: vi.fn(),
};

const auditService = {
  log: vi.fn(async () => undefined),
};

describe('Auth routes', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('logs in and returns session cookies', async () => {
    const app = Fastify();
    await app.register(cookie);
    await app.register(jwt, { secret: 'test-secret-test-secret' });

    app.decorate('authenticate', async (request) => {
      request.adminId = 'admin-1';
    });
    app.decorate('verifyCsrf', async () => undefined);

    authService.validateCredentials.mockResolvedValue({ id: 'admin-1', email: 'admin@example.com' });

    await registerAuthRoutes(app, {
      authService: authService as never,
      auditService: auditService as never,
    });

    const response = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: {
        email: 'admin@example.com',
        password: 'admin12345',
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.cookies.some((cookie) => cookie.name === SESSION_COOKIE_NAME)).toBe(true);

    await app.close();
  });

  it('returns me for authenticated user', async () => {
    const app = Fastify();
    await app.register(cookie);
    await app.register(jwt, { secret: 'test-secret-test-secret' });

    app.decorate('authenticate', async (request) => {
      request.adminId = 'admin-1';
    });
    app.decorate('verifyCsrf', async () => undefined);

    authService.getAdminById.mockResolvedValue({ id: 'admin-1', email: 'admin@example.com' });

    await registerAuthRoutes(app, {
      authService: authService as never,
      auditService: auditService as never,
    });

    const response = await app.inject({
      method: 'GET',
      url: '/api/auth/me',
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ id: 'admin-1', email: 'admin@example.com' });

    await app.close();
  });
});
