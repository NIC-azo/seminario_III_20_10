import { mkdir } from "node:fs/promises";
import path from "node:path";
import * as lancedb from "@lancedb/lancedb";
import type { LegalChunk, JurisprudenceNote } from "@/data_pipeline/etl.js";

const TABLE_NAME = "legal_chunks";
const SPANISH_STOP_WORDS = new Set([
  "a",
  "al",
  "con",
  "como",
  "de",
  "del",
  "el",
  "en",
  "es",
  "la",
  "las",
  "los",
  "o",
  "para",
  "por",
  "que",
  "se",
  "sin",
  "su",
  "un",
  "una",
  "y",
]);

export interface EmbeddedLegalChunk extends LegalChunk {
  vector: number[];
}

type StoredLegalChunk = Omit<LegalChunk, "jurisprudence"> & {
  jurisprudence_json: string;
  vector: number[];
  _distance?: number;
} & Record<string, unknown>;

export interface RetrievedLegalChunk extends LegalChunk {
  relevance: number;
}

export type LegalSourceType = "constitucion" | "penal";

function toStoredChunk(chunk: EmbeddedLegalChunk): StoredLegalChunk {
  const { jurisprudence, ...metadata } = chunk;
  return {
    ...metadata,
    source_url: metadata.source_url ?? "",
    last_update: metadata.last_update ?? "",
    book: metadata.book ?? "",
    title: metadata.title ?? "",
    chapter: metadata.chapter ?? "",
    article_title: metadata.article_title ?? "",
    jurisprudence_json: JSON.stringify(jurisprudence),
  };
}

function fromStoredChunk(row: StoredLegalChunk): EmbeddedLegalChunk {
  let jurisprudence: JurisprudenceNote[];
  try {
    const parsed: unknown = JSON.parse(row.jurisprudence_json);
    if (!Array.isArray(parsed)) {
      throw new Error("el valor no es una lista");
    }
    jurisprudence = parsed as JurisprudenceNote[];
  } catch (error) {
    throw new Error(
      `Metadatos de jurisprudencia inválidos en el chunk ${row.id}`,
      { cause: error },
    );
  }

  const {
    jurisprudence_json: _ignored,
    _distance: _distance,
    ...metadata
  } = row;
  return {
    ...metadata,
    source_url: metadata.source_url || null,
    last_update: metadata.last_update || null,
    book: metadata.book || null,
    title: metadata.title || null,
    chapter: metadata.chapter || null,
    article_title: metadata.article_title || null,
    jurisprudence,
  };
}

function tokenize(text: string): Set<string> {
  return new Set(
    (text.toLocaleLowerCase("es-PE").match(/[\p{L}\p{N}]+/gu) ?? []).filter(
      (token) =>
        (token.length > 1 || /^\d+$/.test(token)) &&
        !SPANISH_STOP_WORDS.has(token),
    ),
  );
}

export class VectorStore {
  private readonly databasePath: string;
  private database?: lancedb.Connection;
  private table?: lancedb.Table;
  private cachedChunks: EmbeddedLegalChunk[] = [];
  private vectorDimensions = 0;

  constructor(databasePath: string) {
    this.databasePath = path.resolve(databasePath);
  }

  async initialize(): Promise<void> {
    await mkdir(this.databasePath, { recursive: true });
    this.database = await lancedb.connect(this.databasePath);
    const tableNames = await this.database.tableNames();
    if (tableNames.includes(TABLE_NAME)) {
      this.table = await this.database.openTable(TABLE_NAME);
      const rows = await this.table.query().toArray();
      this.cachedChunks = rows.map((row) =>
        fromStoredChunk(row as StoredLegalChunk),
      );
      this.vectorDimensions = this.cachedChunks[0]?.vector.length ?? 0;
    }
  }

  async replaceAll(chunks: EmbeddedLegalChunk[]): Promise<void> {
    if (!this.database) {
      throw new Error("VectorStore no inicializado");
    }
    if (!chunks.length) {
      throw new Error("No se puede crear un índice vectorial vacío");
    }

    const dimensions = chunks[0].vector.length;
    if (!dimensions || chunks.some((chunk) => chunk.vector.length !== dimensions)) {
      throw new Error("Los embeddings deben tener una dimensión uniforme y no vacía");
    }

    const records = chunks.map(toStoredChunk);
    this.table = await this.database.createTable(TABLE_NAME, records, {
      mode: "overwrite",
    });
    this.cachedChunks = chunks;
    this.vectorDimensions = dimensions;
  }

  async search(
    queryVector: number[],
    query: string,
    limit: number,
  ): Promise<RetrievedLegalChunk[]> {
    if (!this.table || !this.cachedChunks.length) {
      throw new Error(
        "El índice vectorial todavía no existe; ejecuta npm run ingest antes de consultar",
      );
    }
    if (!queryVector.length || !Number.isSafeInteger(limit) || limit < 1) {
      throw new Error("Vector de consulta o límite de recuperación inválido");
    }
    if (queryVector.length !== this.vectorDimensions) {
      throw new Error(
        `Dimensión del embedding de consulta (${queryVector.length}) distinta al índice (${this.vectorDimensions})`,
      );
    }

    const semanticRows = await this.table
      .search(queryVector)
      .limit(Math.min(limit * 4, this.cachedChunks.length))
      .toArray();
    const semanticRanks = new Map<string, number>();
    semanticRows.forEach((row, index) => {
      semanticRanks.set(String(row.id), index + 1);
    });

    const queryTokens = tokenize(query);
    const lexicalRanks = this.cachedChunks
      .map((chunk) => {
        const chunkTokens = tokenize(chunk.chunk_text);
        let overlap = 0;
        for (const token of queryTokens) {
          if (chunkTokens.has(token)) {
            overlap += 1;
          }
        }
        return { id: chunk.id, overlap };
      })
      .filter((item) => item.overlap > 0)
      .sort((left, right) => right.overlap - left.overlap)
      .slice(0, limit * 4)
      .map((item, index) => [item.id, index + 1] as const);
    const lexicalRankMap = new Map(lexicalRanks);
    const candidates = new Map<string, EmbeddedLegalChunk>();

    for (const chunk of this.cachedChunks) {
      if (semanticRanks.has(chunk.id) || lexicalRankMap.has(chunk.id)) {
        candidates.set(chunk.id, chunk);
      }
    }

    return [...candidates.values()]
      .map((chunk) => {
        const semanticRank = semanticRanks.get(chunk.id);
        const lexicalRank = lexicalRankMap.get(chunk.id);
        const relevance =
          (semanticRank ? 1 / (60 + semanticRank) : 0) +
          (lexicalRank ? 1 / (60 + lexicalRank) : 0);
        const { vector: _vector, ...legalChunk } = chunk;
        return { ...legalChunk, relevance };
      })
      .sort((left, right) => right.relevance - left.relevance)
      .slice(0, limit);
  }

  findArticle(
    articleNumber: string,
    sourceType: LegalSourceType,
  ): RetrievedLegalChunk | null {
    const source = this.cachedChunks.find((chunk) => {
      const normalizedName = chunk.norm_name
        .normalize("NFD")
        .replace(/\p{Diacritic}/gu, "")
        .toLocaleLowerCase("es-PE");
      return (
        normalizedName.includes(sourceType) &&
        chunk.article_number.toLocaleLowerCase("es-PE") === articleNumber
      );
    });
    if (!source) {
      return null;
    }

    const { vector: _vector, ...legalChunk } = source;
    return { ...legalChunk, relevance: 1 };
  }

  get indexedChunkCount(): number {
    return this.cachedChunks.length;
  }
}
