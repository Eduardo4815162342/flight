import axios from "axios";

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
const DEFAULT_MODEL = "openrouter/elephant-alpha";
const TIMEOUT_MS = 15_000;

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface ChatCompletionOptions {
  model?: string;
  maxTokens?: number;
  temperature?: number;
}

export async function completeChat(
  messages: ChatMessage[],
  options: ChatCompletionOptions = {}
): Promise<string | null> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) return null;

  const response = await axios.post(
    OPENROUTER_URL,
    {
      model: options.model ?? DEFAULT_MODEL,
      max_tokens: options.maxTokens ?? 350,
      temperature: options.temperature ?? 0.3,
      messages,
    },
    {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      timeout: TIMEOUT_MS,
    }
  );

  return response.data?.choices?.[0]?.message?.content?.trim() ?? null;
}
