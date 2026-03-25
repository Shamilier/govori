import Fastify from 'fastify';
import { describe, expect, it, vi } from 'vitest';
import { registerAgentRoutes } from '@/agent/agent.routes.js';

const service = {
  get: vi.fn(async () => ({ id: 'agent-1', name: 'Agent' })),
  update: vi.fn(async () => ({ id: 'agent-1', name: 'Updated' })),
  testTts: vi.fn(async () => ({ buffer: Buffer.from('wave'), contentType: 'audio/wav', durationMs: 100 })),
  testPrompt: vi.fn(async () => ({ assistantText: 'ok' })),
};

describe('Agent routes', () => {
  it('returns current agent', async () => {
    const app = Fastify();
    app.decorate('authenticate', async (request) => {
      request.adminId = 'admin-1';
    });
    app.decorate('verifyCsrf', async () => undefined);

    await registerAgentRoutes(app, { agentService: service as never });

    const response = await app.inject({ method: 'GET', url: '/api/agent' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ id: 'agent-1' });

    await app.close();
  });

  it('updates agent', async () => {
    const app = Fastify();
    app.decorate('authenticate', async (request) => {
      request.adminId = 'admin-1';
    });
    app.decorate('verifyCsrf', async () => undefined);

    await registerAgentRoutes(app, { agentService: service as never });

    const response = await app.inject({
      method: 'PUT',
      url: '/api/agent',
      payload: {
        name: 'A',
        systemPrompt: '1234567890',
        greetingText: 'hi',
        fallbackText: 'fallback',
        goodbyeText: 'bye',
        language: 'ru-RU',
        isActive: true,
        interruptionEnabled: true,
        silenceTimeoutMs: 3000,
        maxCallDurationSec: 120,
        maxTurns: 5,
        responseTemperature: 0.3,
        responseMaxTokens: 120,
        ttsProvider: 'cartesia',
        ttsVoiceId: 'voice',
        ttsSpeed: 1,
        ttsSampleRate: 8000,
        sttProvider: 'mock',
        llmProvider: 'openai',
        recordCalls: true,
        ttsTestPhrase: 'test',
      },
    });

    expect(response.statusCode).toBe(200);
    expect(service.update).toHaveBeenCalled();

    await app.close();
  });
});
