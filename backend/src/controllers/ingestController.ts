import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import type {
  LegalChunk,
  ProcessedDocument,
} from "@/data_pipeline/etl.js";
import type { OllamaClient } from "@/controllers/ollamaClient.js";
import type { VectorStore, EmbeddedLegalChunk } from "@/models/vectorStore.js";

const EMBEDDING_BATCH_SIZE = 16;

function isJurisprudenceNote(value: unknown): boolean {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const note = value as { text?: unknown; url?: unknown };
  return (
    typeof note.text === "string" &&
    (note.url === null || typeof note.url === "string")
  );
}

function isLegalChunk(value: unknown): value is LegalChunk {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const candidate = value as Partial<LegalChunk>;
  return (
    typeof candidate.id === "string" &&
    typeof candidate.norm_name === "string" &&
    typeof candidate.article_number === "string" &&
    Boolean(candidate.content?.trim()) &&
    Boolean(candidate.chunk_text?.trim()) &&
    (candidate.source_url === null || typeof candidate.source_url === "string") &&
    (candidate.last_update === null || typeof candidate.last_update === "string") &&
    (candidate.book === null || typeof candidate.book === "string") &&
    (candidate.title === null || typeof candidate.title === "string") &&
    (candidate.chapter === null || typeof candidate.chapter === "string") &&
    (candidate.article_title === null ||
      typeof candidate.article_title === "string") &&
    Array.isArray(candidate.jurisprudence) &&
    candidate.jurisprudence.every(isJurisprudenceNote)
  );
}

function parseDocument(value: unknown, filePath: string): ProcessedDocument {
  if (typeof value !== "object" || value === null) {
    throw new Error(`El JSON no contiene un objeto de documento: ${filePath}`);
  }
  const document = value as Partial<ProcessedDocument>;
  if (
    document.schema_version !== "1.0" ||
    typeof document.document?.norm_name !== "string" ||
    !Array.isArray(document.chunks) ||
    document.chunks.length === 0 ||
    !document.chunks.every(isLegalChunk)
  ) {
    throw new Error(`El JSON no cumple el esquema ETL 1.0: ${filePath}`);
  }
  const chunkIds = document.chunks.map((chunk) => chunk.id);
  if (new Set(chunkIds).size !== chunkIds.length) {
    throw new Error(`El documento contiene IDs de chunks duplicados: ${filePath}`);
  }
  return document as ProcessedDocument;
}

export async function readProcessedDocuments(
  directory: string,
): Promise<ProcessedDocument[]> {
  const files = (await readdir(directory))
    .filter((file) => file.toLowerCase().endsWith(".json"))
    .sort();
  if (!files.length) {
    throw new Error(`No hay documentos JSON para indexar en ${directory}`);
  }

  const documents: ProcessedDocument[] = [];
  for (const file of files) {
    const filePath = path.join(directory, file);
    let raw: string;
    try {
      raw = await readFile(filePath, "utf8");
    } catch (error) {
      throw new Error(`No se pudo leer el documento ${filePath}`, {
        cause: error,
      });
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (error) {
      throw new Error(`JSON inválido en ${filePath}`, { cause: error });
    }
    documents.push(parseDocument(parsed, filePath));
  }
  return documents;
}

export async function ingestProcessedDocuments(
  directory: string,
  ollama: Pick<OllamaClient, "embed">,
  vectorStore: Pick<VectorStore, "replaceAll">,
  onProgress: (message: string) => void = () => {},
): Promise<number> {
  const documents = await readProcessedDocuments(directory);
  const chunks = documents.flatMap((document) => document.chunks);
  const embeddedChunks: EmbeddedLegalChunk[] = [];

  for (let offset = 0; offset < chunks.length; offset += EMBEDDING_BATCH_SIZE) {
    const batch = chunks.slice(offset, offset + EMBEDDING_BATCH_SIZE);
    const embeddings = await ollama.embed(batch.map((chunk) => chunk.chunk_text));
    if (embeddings.length !== batch.length) {
      throw new Error(
        `Ollama devolvió ${embeddings.length} embeddings para ${batch.length} chunks`,
      );
    }
    embeddedChunks.push(
      ...batch.map((chunk, index) => ({ ...chunk, vector: embeddings[index] })),
    );
    onProgress(`Embeddings: ${embeddedChunks.length}/${chunks.length}`);
  }

  await vectorStore.replaceAll(embeddedChunks);
  return embeddedChunks.length;
}
