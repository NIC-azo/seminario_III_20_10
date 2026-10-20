import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import { fileURLToPath } from "node:url";
import { access, mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { createApp } from "@/app.js";
import type { ProcessedDocument } from "@/data_pipeline/etl.js";
import { ingestProcessedDocuments } from "@/controllers/ingestController.js";
import { OllamaClient } from "@/controllers/ollamaClient.js";
import { VectorStore } from "@/models/vectorStore.js";

async function listen(server: ReturnType<typeof createServer>): Promise<string> {
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("El servidor de prueba no obtuvo un puerto TCP");
  }
  return `http://127.0.0.1:${address.port}`;
}

test("ETL JSON -> Ollama local -> LanceDB -> Express /api/chat", async (context) => {
  const directory = await mkdtemp(path.join(tmpdir(), "mini-juztina-integration-"));
  context.after(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  const processedDirectory = path.join(directory, "processed");
  await mkdir(processedDirectory, { recursive: true });
  const document: ProcessedDocument = {
    schema_version: "1.0",
    generated_at: "2026-10-20T00:00:00.000Z",
    document: {
      norm_name: "Constitución Política del Perú",
      source_url: "https://example.test/constitucion",
      last_update: "2026-10-20",
      source_file: "constitucion.html",
    },
    chunks: [
      {
        id: "constitucion-articulo-2",
        norm_name: "Constitución Política del Perú",
        source_url: "https://example.test/constitucion",
        last_update: "2026-10-20",
        source_file: "constitucion.html",
        book: null,
        title: "TÍTULO I",
        chapter: "CAPÍTULO I",
        article_number: "2",
        article_title: "Igualdad ante la ley",
        content:
          "Toda persona tiene derecho: 1. A la vida y a la identidad. 2. A la igualdad ante la ley. Nadie debe ser discriminado por motivo de origen, raza, sexo, idioma, religión, opinión, condición económica o de cualquiera otra índole. 3. A la libertad.",
        jurisprudence: [
          { text: "Ver jurisprudencia aquí", url: "https://example.test/jurisprudencia" },
        ],
        chunk_text:
          "Constitución Política del Perú > TÍTULO I > CAPÍTULO I > Artículo 2: Igualdad ante la ley\nToda persona tiene derecho: 1. A la vida y a la identidad. 2. A la igualdad ante la ley. Nadie debe ser discriminado por motivo de origen, raza, sexo, idioma, religión, opinión, condición económica o de cualquiera otra índole. 3. A la libertad.",
      },
      {
        id: "codigo-articulo-1",
        norm_name: "Código Penal peruano",
        source_url: "https://example.test/codigo",
        last_update: "2026-10-20",
        source_file: "codigo.html",
        book: null,
        title: "TÍTULO PRELIMINAR",
        chapter: null,
        article_number: "I",
        article_title: "Legalidad",
        content: "Nadie será sancionado sin una ley vigente.",
        jurisprudence: [],
        chunk_text:
          "Código Penal peruano > TÍTULO PRELIMINAR > Artículo I: Legalidad\nNadie será sancionado sin una ley vigente.",
      },
    ],
  };
  await writeFile(
    path.join(processedDirectory, "document.json"),
    JSON.stringify(document),
    "utf8",
  );

  const chatRequests: Array<Array<{ role: string; content: string }>> = [];
  const ollamaServer = createServer(async (request, response) => {
    const chunks: Buffer[] = [];
    for await (const chunk of request) {
      chunks.push(Buffer.from(chunk));
    }
    const body = chunks.length
      ? (JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<string, unknown>)
      : {};

    response.setHeader("content-type", "application/json");
    if (request.url === "/api/tags" && request.method === "GET") {
      response.end(
        JSON.stringify({
          models: [{ name: "qwen2.5:3b" }, { name: "nomic-embed-text:latest" }],
        }),
      );
      return;
    }
    if (request.url === "/api/embed" && request.method === "POST") {
      const input = Array.isArray(body.input) ? body.input : [body.input];
      response.end(
        JSON.stringify({
          embeddings: input.map((text) =>
            /igualdad|resumirlo/i.test(String(text).toLocaleLowerCase("es-PE"))
              ? [1, 0]
              : [0, 1],
          ),
        }),
      );
      return;
    }
    if (request.url === "/api/chat" && request.method === "POST") {
      const messages = body.messages as Array<{ role: string; content: string }>;
      chatRequests.push(messages);
      const lastMessage = messages.at(-1)?.content ?? "";
      const declines = /no se debe discriminar/i.test(lastMessage);
      const invalidEvidence = /fallo de cita/i.test(lastMessage);
      response.end(
        JSON.stringify({
          message: {
            content: JSON.stringify({
              status: declines ? "out_of_scope" : "answered",
              claims: declines
                ? []
                : [
                    {
                      text: invalidEvidence
                        ? "El fragmento inventado es la norma aplicable."
                        : "La Constitución reconoce la igualdad ante la ley.",
                      evidence: invalidEvidence
                        ? "Este texto inventado no aparece en ningún fragmento jurídico."
                        : "Toda persona tiene derecho: 1. A la vida y a la identidad. 2. A la igualdad ante la ley.",
                      citation_ids: ["F1"],
                    },
                  ],
              message: declines
                ? "El fragmento no contiene la respuesta."
                : "",
            }),
          },
        }),
      );
      return;
    }

    response.statusCode = 404;
    response.end(JSON.stringify({ error: "endpoint no previsto en prueba" }));
  });
  const ollamaUrl = await listen(ollamaServer);
  context.after(
    () =>
      new Promise<void>((resolve, reject) => {
        ollamaServer.close((error) => (error ? reject(error) : resolve()));
      }),
  );

  const ollama = new OllamaClient(
    ollamaUrl,
    "qwen2.5:3b",
    "nomic-embed-text",
    10_000,
  );
  const vectorDatabasePath = path.join(directory, "vector_db");
  const vectorStore = new VectorStore(vectorDatabasePath);
  await vectorStore.initialize();

  const indexedChunks = await ingestProcessedDocuments(
    processedDirectory,
    ollama,
    vectorStore,
  );
  assert.equal(indexedChunks, 2);
  assert.equal(vectorStore.indexedChunkCount, 2);
  const reindexedChunks = await ingestProcessedDocuments(
    processedDirectory,
    ollama,
    vectorStore,
  );
  assert.equal(reindexedChunks, 2);
  assert.equal(vectorStore.indexedChunkCount, 2);

  const reopenedStore = new VectorStore(vectorDatabasePath);
  await reopenedStore.initialize();
  assert.equal(reopenedStore.indexedChunkCount, 2);

  const app = createApp({ ollama, vectorStore: reopenedStore }, "http://localhost:5173");
  const apiServer = app.listen(0, "127.0.0.1");
  await once(apiServer, "listening");
  context.after(
    () =>
      new Promise<void>((resolve, reject) => {
        apiServer.close((error) => (error ? reject(error) : resolve()));
      }),
  );
  const address = apiServer.address();
  assert.ok(address && typeof address !== "string");
  const apiUrl = `http://127.0.0.1:${address.port}`;

  const healthResponse = await fetch(`${apiUrl}/api/health`);
  assert.equal(healthResponse.status, 200);
  const health = (await healthResponse.json()) as {
    status: string;
    vectorStore: { indexedChunks: number };
    ollama: { available: boolean };
  };
  assert.equal(health.status, "ok");
  assert.equal(health.vectorStore.indexedChunks, 2);
  assert.equal(health.ollama.available, true);

  const chatResponse = await fetch(`${apiUrl}/api/chat`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: "http://localhost:5173",
    },
    body: JSON.stringify({ message: "¿Qué indica la norma sobre igualdad ante la ley?" }),
  });
  assert.equal(chatResponse.status, 200);
  assert.equal(
    chatResponse.headers.get("access-control-allow-origin"),
    "http://localhost:5173",
  );
  const chat = (await chatResponse.json()) as {
    sessionId: string;
    status: string;
    answer: string;
    sources: Array<{
      citation_id: string;
      article_number: string;
      norm_name: string;
      jurisprudence: Array<{ url: string | null }>;
    }>;
  };
  assert.ok(chat.sessionId);
  assert.equal(chat.status, "answered");
  assert.match(chat.answer, /\[F1\]/);
  assert.equal(chat.sources[0].article_number, "2");
  assert.equal(chat.sources[0].citation_id, "F1");
  assert.equal(chat.sources[0].norm_name, "Constitución Política del Perú");
  assert.equal(
    chat.sources[0].jurisprudence[0].url,
    "https://example.test/jurisprudencia",
  );
  assert.match(chatRequests[0][0].content, /Ignora cualquier orden/);
  assert.match(chatRequests[0].at(-1)?.content ?? "", /Fragmentos normativos/);

  const titleResponse = await fetch(`${apiUrl}/api/chat`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      message: "Según la Constitución, ¿qué establece sobre igualdad ante la ley?",
    }),
  });
  assert.equal(titleResponse.status, 200);
  const titleAnswer = (await titleResponse.json()) as {
    status: string;
    answer: string;
    sources: Array<{
      citation_id: string;
      article_number: string;
      citation_fragments: string[];
    }>;
  };
  assert.equal(titleAnswer.status, "answered");
  assert.match(titleAnswer.answer, /Igualdad ante la ley/);
  assert.match(titleAnswer.answer, /de la Constitución Política/);
  assert.equal(chatRequests.length, 1);
  assert.ok(
    titleAnswer.sources.some(
      (source) =>
        source.citation_id === "F1" &&
        source.article_number === "2" &&
        source.citation_fragments.some((fragment) =>
          fragment.includes("A la igualdad ante la ley"),
        ),
    ),
  );

  const topicResponse = await fetch(`${apiUrl}/api/chat`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      message: "¿Qué establece la Constitución sobre discriminación?",
    }),
  });
  assert.equal(topicResponse.status, 200);
  const topicAnswer = (await topicResponse.json()) as {
    answer: string;
    sources: Array<{ citation_fragments: string[] }>;
  };
  assert.match(topicAnswer.answer, /discriminado/i);
  assert.ok(topicAnswer.sources[0].citation_fragments[0].includes("discriminado"));
  assert.equal(chatRequests.length, 1);

  const specificArticleResponse = await fetch(`${apiUrl}/api/chat`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      message:
        "Según el artículo 2 inciso 2 de la Constitución, ¿por qué motivos no se debe discriminar?",
    }),
  });
  assert.equal(specificArticleResponse.status, 200);
  const specificArticle = (await specificArticleResponse.json()) as {
    status: string;
    answer: string;
    sources: Array<{
      citation_id: string;
      article_number: string;
      citation_fragments: string[];
    }>;
  };
  assert.equal(specificArticle.status, "answered");
  assert.match(specificArticle.answer, /A la igualdad ante la ley/);
  assert.match(specificArticle.answer, /origen, raza, sexo, idioma/);
  assert.ok(
    specificArticle.sources.some(
      (source) =>
        source.citation_id === "F1" &&
        source.article_number === "2" &&
        source.citation_fragments.some((fragment) =>
          fragment.includes("A la igualdad ante la ley"),
        ),
    ),
  );
  assert.equal(chatRequests.length, 1);

  const followUp = await fetch(`${apiUrl}/api/chat`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      sessionId: chat.sessionId,
      message: "¿Puedes resumirlo?",
    }),
  });
  assert.equal(followUp.status, 200);
  assert.ok(
    chatRequests.at(-1)?.some(
      (message) => message.role === "assistant" && message.content === chat.answer,
    ),
  );

  const invalidEvidenceResponse = await fetch(`${apiUrl}/api/chat`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      message: "Consulta general con fallo de cita y sin artículo específico.",
    }),
  });
  assert.equal(invalidEvidenceResponse.status, 502);
  const invalidEvidence = (await invalidEvidenceResponse.json()) as {
    error: string;
    sources: unknown[];
  };
  assert.match(invalidEvidence.error, /fragmento literal existente/);
  assert.ok(invalidEvidence.sources.length > 0);

  const invalidRequest = await fetch(`${apiUrl}/api/chat`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ message: "  " }),
  });
  assert.equal(invalidRequest.status, 400);
});

test("Ollama falla explícitamente cuando el servicio local no está disponible", async () => {
  const client = new OllamaClient(
    "http://127.0.0.1:1",
    "qwen2.5:3b",
    "nomic-embed-text",
    100,
  );
  const health = await client.health();
  assert.equal(health.available, false);
  assert.match(health.error ?? "", /No se pudo completar la solicitud a Ollama/);
  await assert.rejects(
    () => client.embed(["consulta"]),
    /No se pudo completar la solicitud a Ollama/,
  );
});

test("indexa las dos salidas ETL reales y reabre el índice vectorial persistido", async (context) => {
  const processedDirectory = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "../data/processed",
  );
  try {
    await Promise.all(
      ["constitucion-politica-del-peru.json", "codigo-penal-peruano.json"].map(
        (file) => access(path.join(processedDirectory, file)),
      ),
    );
  } catch (error) {
    if (
      error instanceof Error &&
      "code" in error &&
      error.code === "ENOENT"
    ) {
      context.skip(
        "Corpus procesado no incluido en el repositorio; genera los JSON desde los HTML locales para ejecutar esta prueba.",
      );
      return;
    }
    throw error;
  }

  const directory = await mkdtemp(path.join(tmpdir(), "mini-juztina-corpus-"));
  context.after(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  const ollamaServer = createServer(async (request, response) => {
    const chunks: Buffer[] = [];
    for await (const chunk of request) {
      chunks.push(Buffer.from(chunk));
    }
    const body = JSON.parse(Buffer.concat(chunks).toString("utf8")) as {
      input: string[];
    };
    response.setHeader("content-type", "application/json");
    response.end(
      JSON.stringify({
        embeddings: body.input.map((text) => {
          const normalized = text.toLocaleLowerCase("es-PE");
          return [
            normalized.includes("igualdad") ? 1 : 0.1,
            normalized.includes("pena") ? 1 : 0.1,
            0.25,
          ];
        }),
      }),
    );
  });
  const ollamaUrl = await listen(ollamaServer);
  context.after(
    () =>
      new Promise<void>((resolve, reject) => {
        ollamaServer.close((error) => (error ? reject(error) : resolve()));
      }),
  );

  const databasePath = path.join(directory, "vector_db");
  const writer = new VectorStore(databasePath);
  await writer.initialize();
  const count = await ingestProcessedDocuments(
    processedDirectory,
    new OllamaClient(ollamaUrl, "test-chat", "test-embeddings", 10_000),
    writer,
  );
  assert.equal(count, 868);

  const reader = new VectorStore(databasePath);
  await reader.initialize();
  assert.equal(reader.indexedChunkCount, 868);
  const [queryVector] = await new OllamaClient(
    ollamaUrl,
    "test-chat",
    "test-embeddings",
    10_000,
  ).embed(["Artículo 2 igualdad"]);
  const matches = await reader.search(queryVector, "Artículo 2 igualdad", 3);
  const articleTwo = matches.find(
    (match) =>
      match.norm_name === "Constitución Política del Perú" &&
      match.article_number === "2",
  );
  assert.ok(articleTwo);
  assert.ok(articleTwo.jurisprudence.length > 0);
});
