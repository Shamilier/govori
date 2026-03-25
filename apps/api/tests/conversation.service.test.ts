import { describe, expect, it } from 'vitest';
import type { Agent } from '@prisma/client';
import { ConversationService } from '@/calls/conversation.service.js';
import type { ConversationModelProvider } from '@/providers/conversation-model.provider.js';

class StubModelProvider implements ConversationModelProvider {
  constructor(private readonly reply: string) {}

  async generate(): Promise<string> {
    return this.reply;
  }

  async healthcheck(): Promise<{ ok: boolean; provider: string }> {
    return { ok: true, provider: 'stub' };
  }
}

const agent = {
  id: 'agent-1',
  name: 'Agent',
  systemPrompt: 'prompt',
  greetingText: 'hello',
  fallbackText: 'fallback',
  goodbyeText: 'goodbye',
  language: 'ru-RU',
  isActive: true,
  interruptionEnabled: true,
  silenceTimeoutMs: 5000,
  maxCallDurationSec: 300,
  maxTurns: 3,
  responseTemperature: 0.3,
  responseMaxTokens: 120,
  ttsProvider: 'cartesia',
  ttsVoiceId: 'voice',
  ttsSpeed: 1,
  ttsSampleRate: 8000,
  sttProvider: 'mock',
  llmProvider: 'gpt-4.1-mini',
  recordCalls: true,
  ttsTestPhrase: 'test',
  createdAt: new Date(),
  updatedAt: new Date(),
} as unknown as Agent;

describe('ConversationService', () => {
  it('returns model response', async () => {
    const service = new ConversationService(new StubModelProvider('Готово'));
    const result = await service.generateTurn({
      agent,
      history: [],
      userText: 'Расскажи про услугу',
    });

    expect(result.assistantText).toBe('Готово');
    expect(result.shouldHangup).toBe(false);
  });

  it('hangs up on goodbye intent', async () => {
    const service = new ConversationService(new StubModelProvider('До свидания!'));
    const result = await service.generateTurn({
      agent,
      history: [],
      userText: 'Пока',
    });

    expect(result.shouldHangup).toBe(true);
  });

  it('builds structured outcome', () => {
    const service = new ConversationService(new StubModelProvider('ok'));
    const outcome = service.buildOutcome({
      callerPhone: '+10000000000',
      messages: [
        { role: 'USER', text: 'Меня зовут Иван, перезвоните мне' },
        { role: 'ASSISTANT', text: 'Хорошо, зафиксировал' },
      ],
    });

    expect(outcome.callback_requested).toBe(true);
    expect(outcome.caller_name).toBe('Иван');
  });
});
