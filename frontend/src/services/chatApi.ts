import type { BackendHealth, ChatResponse, ChatSource } from "@/types/chat";

const API_BASE_URL = (
  import.meta.env.VITE_API_BASE_URL ?? "http://127.0.0.1:3001/api"
).replace(/\/+$/, "");

export class ChatApiError extends Error {
  readonly sources: ChatSource[];

  constructor(
    message: string,
    sources: ChatSource[] = [],
  ) {
    super(message);
    this.name = "ChatApiError";
    this.sources = sources;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isChatSource(value: unknown): value is ChatSource {
  return (
    isRecord(value) &&
    typeof value.citation_id === "string" &&
    Array.isArray(value.citation_fragments) &&
    value.citation_fragments.every((fragment) => typeof fragment === "string") &&
    typeof value.id === "string" &&
    typeof value.norm_name === "string" &&
    typeof value.article_number === "string" &&
    (value.article_title === null || typeof value.article_title === "string") &&
    (value.book === null || typeof value.book === "string") &&
    (value.title === null || typeof value.title === "string") &&
    (value.chapter === null || typeof value.chapter === "string") &&
    typeof value.content === "string" &&
    typeof value.chunk_text === "string" &&
    (value.source_url === null || typeof value.source_url === "string") &&
    (value.last_update === null || typeof value.last_update === "string") &&
    Array.isArray(value.jurisprudence) &&
    value.jurisprudence.every(
      (note) =>
        isRecord(note) &&
        typeof note.text === "string" &&
        (note.url === null || typeof note.url === "string"),
    ) &&
    typeof value.relevance === "number"
  );
}

function isChatStatus(
  value: unknown,
): value is ChatResponse["status"] {
  return (
    value === "answered" ||
    value === "out_of_scope" ||
    value === "insufficient_evidence"
  );
}

function isBackendHealth(value: unknown): value is BackendHealth {
  if (!isRecord(value) || !isRecord(value.vectorStore) || !isRecord(value.ollama)) {
    return false;
  }
  return (
    (value.status === "ok" || value.status === "degraded") &&
    typeof value.vectorStore.available === "boolean" &&
    typeof value.vectorStore.indexedChunks === "number" &&
    typeof value.ollama.available === "boolean" &&
    typeof value.ollama.chatModelAvailable === "boolean" &&
    typeof value.ollama.embeddingModelAvailable === "boolean" &&
    (value.ollama.error === undefined || typeof value.ollama.error === "string")
  );
}

function parseSources(value: unknown): ChatSource[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter(isChatSource);
}

export async function sendChatMessage(
  message: string,
  sessionId?: string,
): Promise<ChatResponse> {
  const response = await fetch(`${API_BASE_URL}/chat`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ message, ...(sessionId ? { sessionId } : {}) }),
  });
  const payload: unknown = await response.json().catch(() => null);

  if (!response.ok) {
    const errorMessage =
      isRecord(payload) && typeof payload.error === "string"
        ? payload.error
        : `La API respondió con el estado HTTP ${response.status}.`;
    throw new ChatApiError(
      errorMessage,
      isRecord(payload) ? parseSources(payload.sources) : [],
    );
  }

  if (
    !isRecord(payload) ||
    typeof payload.sessionId !== "string" ||
    typeof payload.answer !== "string" ||
    !isChatStatus(payload.status) ||
    !Array.isArray(payload.sources)
  ) {
    throw new ChatApiError("La API devolvió una respuesta con formato inválido.");
  }

  return {
    sessionId: payload.sessionId,
    status: payload.status,
    answer: payload.answer,
    sources: parseSources(payload.sources),
  };
}

export async function getBackendHealth(
  signal?: AbortSignal,
): Promise<BackendHealth> {
  const response = await fetch(`${API_BASE_URL}/health`, { signal });
  const payload: unknown = await response.json().catch(() => null);

  if (!isBackendHealth(payload)) {
    const message =
      isRecord(payload) && typeof payload.error === "string"
        ? payload.error
        : `El backend no está listo (HTTP ${response.status}).`;
    throw new Error(message);
  }

  if (!response.ok && payload.status === "ok") {
    throw new Error(`El backend respondió con el estado HTTP ${response.status}.`);
  }

  return payload;
}
