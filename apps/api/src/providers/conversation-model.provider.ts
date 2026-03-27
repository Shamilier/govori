export type PromptMessage = {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
};

export type ConversationModelRequest = {
  model?: string;
  apiKey?: string | null;
  temperature: number;
  maxTokens: number;
  messages: PromptMessage[];
};

export interface ConversationModelProvider {
  generate(request: ConversationModelRequest): Promise<string>;
  healthcheck(): Promise<{
    ok: boolean;
    provider: string;
    details?: Record<string, unknown>;
  }>;
}
