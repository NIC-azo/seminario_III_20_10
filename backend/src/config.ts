import path from "node:path";
import { fileURLToPath } from "node:url";

const backendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function positiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

export const config = {
  host: process.env.HOST ?? "127.0.0.1",
  port: positiveInteger(process.env.PORT, 3001),
  ollamaBaseUrl: (process.env.OLLAMA_BASE_URL ?? "http://127.0.0.1:11434").replace(
    /\/+$/,
    "",
  ),
  ollamaChatModel: process.env.OLLAMA_CHAT_MODEL ?? "qwen2.5:3b",
  ollamaEmbeddingModel: process.env.OLLAMA_EMBEDDING_MODEL ?? "nomic-embed-text",
  ollamaTimeoutMs: positiveInteger(process.env.OLLAMA_TIMEOUT_MS, 120_000),
  vectorDatabasePath: path.resolve(
    process.env.VECTOR_DATABASE_PATH ?? path.join(backendRoot, "data", "vector_db"),
  ),
  processedDataPath: path.resolve(
    process.env.PROCESSED_DATA_PATH ??
      path.join(backendRoot, "data", "processed"),
  ),
  corsOrigin: process.env.CORS_ORIGIN ?? "http://localhost:5173",
  retrievalLimit: positiveInteger(process.env.RETRIEVAL_LIMIT, 5),
};
