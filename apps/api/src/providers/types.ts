export type ProviderHealth = {
  ok: boolean;
  provider: string;
  details?: Record<string, unknown>;
};

export type TtsSynthesizeInput = {
  text: string;
  voiceId?: string;
  speed?: number;
  sampleRate?: number;
  language?: string;
  apiKey?: string | null;
  modelId?: string | null;
};

export type TtsSynthesizeOutput = {
  audio: Buffer;
  contentType: string;
  durationMs: number;
};

export interface TtsProvider {
  synthesize(input: TtsSynthesizeInput): Promise<TtsSynthesizeOutput>;
  validateVoice(voiceId: string): Promise<boolean>;
  healthcheck(): Promise<ProviderHealth>;
}

export type SttTranscribeInput = {
  audioBase64?: string;
  hintedText?: string;
  language?: string;
};

export interface SpeechToTextProvider {
  transcribeTurn(input: SttTranscribeInput): Promise<string>;
  finalize(callId: string): Promise<void>;
  healthcheck(): Promise<ProviderHealth>;
}

export type ConversationMessage = {
  role: "system" | "user" | "assistant" | "tool";
  text: string;
};

export type ConversationRequest = {
  systemPrompt: string;
  messages: ConversationMessage[];
  temperature: number;
  maxTokens: number;
};

export interface ConversationModelProvider {
  generateResponse(input: ConversationRequest): Promise<string>;
  healthcheck(): Promise<ProviderHealth>;
}

export type InboundCallEvent = {
  externalCallId: string;
  callerPhone?: string;
  calleePhone?: string;
  providerPayload: Record<string, unknown>;
};

export interface TelephonyProvider {
  handleInboundWebhook(
    payload: Record<string, unknown>,
  ): Promise<InboundCallEvent>;
  answerCall(callId: string): Promise<void>;
  playAudio(callId: string, audio: Buffer, contentType: string): Promise<void>;
  hangupCall(callId: string): Promise<void>;
  getRecording(callId: string): Promise<string | null>;
  healthcheck(): Promise<ProviderHealth>;
}
