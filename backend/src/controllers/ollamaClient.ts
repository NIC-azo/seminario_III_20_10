export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface OllamaHealth {
  available: boolean;
  chatModelAvailable: boolean;
  embeddingModelAvailable: boolean;
  error?: string;
}

interface EmbeddingResponse {
  embeddings: number[][];
}

interface ChatResponse {
  message: { content: string };
}

interface TagsResponse {
  models: Array<{ name: string }>;
}

const CHAT_RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    status: {
      type: "string",
      enum: ["answered", "out_of_scope", "insufficient_evidence"],
    },
    claims: {
      type: "array",
      items: {
        type: "object",
        properties: {
          text: { type: "string" },
          evidence: { type: "string" },
          citation_ids: { type: "array", items: { type: "string" } },
        },
        required: ["text", "evidence", "citation_ids"],
        additionalProperties: false,
      },
    },
    message: { type: "string" },
  },
  required: ["status", "claims", "message"],
  additionalProperties: false,
};

export class OllamaError extends Error {
  readonly statusCode = 503;

  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "OllamaError";
  }
}

export class OllamaClient {
  constructor(
    private readonly baseUrl: string,
    private readonly chatModel: string,
    private readonly embeddingModel: string,
    private readonly timeoutMs = 120_000,
    private readonly fetcher: typeof fetch = fetch,
  ) {}

  async embed(texts: string[]): Promise<number[][]> {
    if (!texts.length) {
      return [];
    }

    const response = await this.request<EmbeddingResponse>("/api/embed", {
      model: this.embeddingModel,
      input: texts,
      truncate: true,
      keep_alive: "5m",
    });
    if (
      !Array.isArray(response.embeddings) ||
      response.embeddings.length !== texts.length ||
      response.embeddings.some(
        (vector) =>
          !Array.isArray(vector) ||
          vector.length === 0 ||
          vector.some((value) => !Number.isFinite(value)),
      )
    ) {
      throw new OllamaError(
        `Ollama devolvió embeddings inválidos para el modelo ${this.embeddingModel}`,
      );
    }

    return response.embeddings;
  }

  async chat(messages: ChatMessage[]): Promise<string> {
    const response = await this.request<ChatResponse>("/api/chat", {
      model: this.chatModel,
      messages,
      stream: false,
      format: CHAT_RESPONSE_SCHEMA,
      options: { temperature: 0.1, num_predict: 256, repeat_penalty: 1.1 },
      keep_alive: "5m",
    });

    if (typeof response.message?.content !== "string" || !response.message.content.trim()) {
      throw new OllamaError(
        `Ollama devolvió una respuesta vacía para el modelo ${this.chatModel}`,
      );
    }
    return response.message.content.trim();
  }

  async health(): Promise<OllamaHealth> {
    try {
      const response = await this.request<TagsResponse>("/api/tags", undefined, 5_000);
      const modelNames = response.models.map((model) => model.name);
      const hasModel = (expected: string): boolean =>
        modelNames.some(
          (available) =>
            available === expected || available.startsWith(`${expected}:`),
        );
      const chatModelAvailable = hasModel(this.chatModel);
      const embeddingModelAvailable = hasModel(this.embeddingModel);
      return {
        available: true,
        chatModelAvailable,
        embeddingModelAvailable,
        ...(!chatModelAvailable || !embeddingModelAvailable
          ? {
              error: `Faltan modelos locales: ${[
                ...(!chatModelAvailable ? [this.chatModel] : []),
                ...(!embeddingModelAvailable ? [this.embeddingModel] : []),
              ].join(", ")}`,
            }
          : {}),
      };
    } catch (error) {
      return {
        available: false,
        chatModelAvailable: false,
        embeddingModelAvailable: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  private async request<T>(
    endpoint: string,
    body?: unknown,
    timeoutMs = this.timeoutMs,
  ): Promise<T> {
    let response: Response;
    try {
      response = await this.fetcher(`${this.baseUrl}${endpoint}`, {
        method: body === undefined ? "GET" : "POST",
        headers: body === undefined ? undefined : { "content-type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (error) {
      const causeMessage =
        error instanceof Error ? ` (${error.name}: ${error.message})` : "";
      throw new OllamaError(
        `No se pudo completar la solicitud a Ollama en ${this.baseUrl}; verifica que Ollama esté activo${causeMessage}`,
        { cause: error },
      );
    }

    if (!response.ok) {
      const details = await response.text();
      throw new OllamaError(
        `Ollama respondió HTTP ${response.status} en ${endpoint}: ${details.slice(0, 500)}`,
      );
    }

    try {
      return (await response.json()) as T;
    } catch (error) {
      throw new OllamaError(
        `Ollama devolvió JSON inválido en ${endpoint}`,
        { cause: error },
      );
    }
  }
}
