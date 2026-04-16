import { OpenRouter } from "@openrouter/sdk";

export type ModelSpec = { provider: "openrouter" | "ollama"; model: string };

export function parseModelSpec(raw: string): ModelSpec {
  const colonIdx = raw.indexOf(":");
  if (colonIdx === -1) {
    return { provider: "openrouter", model: raw };
  }
  const prefix = raw.slice(0, colonIdx);
  const model = raw.slice(colonIdx + 1);
  if (prefix !== "openrouter" && prefix !== "ollama") {
    throw new Error(`Unknown provider "${prefix}". Expected "openrouter" or "ollama".`);
  }
  return { provider: prefix, model };
}

export interface EmbeddingClient {
  embed(inputs: string[]): Promise<number[][]>;
}

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface ChatClient {
  chatStream(messages: ChatMessage[], onChunk: (text: string) => void): Promise<string>;
}

// --- OpenRouter implementations ---

export class OpenRouterEmbeddingClient implements EmbeddingClient {
  constructor(private client: OpenRouter, private model: string) {}

  async embed(inputs: string[]): Promise<number[][]> {
    const response = await this.client.embeddings.generate({
      requestBody: { model: this.model, input: inputs },
    });
    if (typeof response === "string") {
      throw new Error(`Embeddings API returned unexpected string: ${response}`);
    }
    return response.data.map((item: any) => {
      if (typeof item.embedding === "string") {
        throw new Error("Embeddings API returned base64 encoding; expected float array");
      }
      return item.embedding;
    });
  }
}

export class OpenRouterChatClient implements ChatClient {
  constructor(private client: OpenRouter, private model: string) {}

  async chatStream(messages: ChatMessage[], onChunk: (text: string) => void): Promise<string> {
    const stream = await this.client.chat.send({
      chatGenerationParams: { model: this.model, messages, stream: true },
    });
    let fullAnswer = "";
    for await (const chunk of stream) {
      const text = chunk.choices?.[0]?.delta?.content ?? "";
      if (text) {
        fullAnswer += text;
        onChunk(text);
      }
    }
    return fullAnswer;
  }
}

// --- Ollama implementations ---

const OLLAMA_BASE = "http://localhost:11434";

export class OllamaEmbeddingClient implements EmbeddingClient {
  constructor(private model: string) {}

  async embed(inputs: string[]): Promise<number[][]> {
    const res = await fetch(`${OLLAMA_BASE}/api/embed`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: this.model, input: inputs }),
    });
    if (!res.ok) {
      throw new Error(`Ollama embed failed: ${res.status} ${await res.text()}`);
    }
    const json = (await res.json()) as { embeddings: number[][] };
    return json.embeddings;
  }
}

export class OllamaChatClient implements ChatClient {
  constructor(private model: string) {}

  async chatStream(messages: ChatMessage[], onChunk: (text: string) => void): Promise<string> {
    const res = await fetch(`${OLLAMA_BASE}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: this.model, messages, stream: true }),
    });
    if (!res.ok) {
      throw new Error(`Ollama chat failed: ${res.status} ${await res.text()}`);
    }
    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    let fullAnswer = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const lines = buf.split("\n");
      buf = lines.pop()!;
      for (const line of lines) {
        if (!line.trim()) continue;
        const parsed = JSON.parse(line) as { message: { content: string }; done: boolean };
        const text = parsed.message?.content ?? "";
        if (text) {
          fullAnswer += text;
          onChunk(text);
        }
      }
    }
    return fullAnswer;
  }
}

// --- Factories ---

export function makeEmbeddingClient(spec: ModelSpec, apiKey?: string): EmbeddingClient {
  if (spec.provider === "ollama") return new OllamaEmbeddingClient(spec.model);
  if (!apiKey) throw new Error('OPENROUTER_API_KEY is required for provider "openrouter"');
  return new OpenRouterEmbeddingClient(new OpenRouter({ apiKey }), spec.model);
}

export function makeChatClient(spec: ModelSpec, apiKey?: string): ChatClient {
  if (spec.provider === "ollama") return new OllamaChatClient(spec.model);
  if (!apiKey) throw new Error('OPENROUTER_API_KEY is required for provider "openrouter"');
  return new OpenRouterChatClient(new OpenRouter({ apiKey }), spec.model);
}
