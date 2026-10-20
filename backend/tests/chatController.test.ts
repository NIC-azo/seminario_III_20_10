import assert from "node:assert/strict";
import test from "node:test";
import { LegalChatService } from "../src/controllers/chatController.js";
import type { RetrievedLegalChunk } from "../src/models/vectorStore.js";

const longArticle =
  "Toda persona tiene derecho a la igualdad ante la ley. " +
  "La Constitución reconoce derechos fundamentales y establece garantías. ".repeat(
    80,
  );

function createChunk(content: string): RetrievedLegalChunk {
  return {
    id: "constitucion-articulo-2",
    norm_name: "Constitución Política del Perú",
    source_url: "https://example.test/constitucion",
    last_update: null,
    source_file: "constitucion.html",
    book: null,
    title: "TÍTULO I",
    chapter: "CAPÍTULO I",
    article_number: "2",
    article_title: "[Derechos fundamentales de la persona]",
    content,
    jurisprudence: [],
    chunk_text: `Constitución > Artículo 2\n${content}`,
    relevance: 1,
  };
}

function createService(chunk: RetrievedLegalChunk) {
  let embeddingCalls = 0;
  let generationCalls = 0;
  const service = new LegalChatService(
    {
      embed: async () => {
        embeddingCalls += 1;
        return [[1]];
      },
      chat: async () => {
        generationCalls += 1;
        return "";
      },
    },
    {
      search: async () => [chunk],
      findArticle: () => chunk,
    },
    { retrievalLimit: 5 },
  );
  return {
    service,
    get embeddingCalls() {
      return embeddingCalls;
    },
    get generationCalls() {
      return generationCalls;
    },
  };
}

test("limita la respuesta directa por artículo y conserva evidencia literal", async () => {
  const chunk = createChunk(longArticle);
  const { service, embeddingCalls, generationCalls } = createService(chunk);
  const result = await service.answer({
    message: "¿Qué dice el artículo 2 de la Constitución?",
  });

  assert.equal(result.status, "answered");
  assert.ok(result.answer.length < 650);
  assert.ok(result.sources[0].citation_fragments[0].length <= 500);
  assert.ok(
    chunk.content.includes(result.sources[0].citation_fragments[0]),
  );
  assert.ok(
    result.sources[0].citation_fragments[0].startsWith("Toda persona tiene derecho"),
  );
  assert.match(result.answer, /…/);
  assert.equal(embeddingCalls, 0);
  assert.equal(generationCalls, 0);
});

test("limita la respuesta por título antes de devolver el artículo íntegro", async () => {
  const chunk = createChunk(longArticle);
  const client = createService(chunk);
  const result = await client.service.answer({
    message: "Según la Constitución, ¿qué derechos fundamentales reconoce?",
  });

  assert.equal(result.status, "answered");
  assert.ok(result.answer.length < 650);
  assert.ok(result.sources[0].citation_fragments[0].length <= 500);
  assert.ok(
    chunk.content.includes(result.sources[0].citation_fragments[0]),
  );
  assert.equal(client.embeddingCalls, 1);
  assert.equal(client.generationCalls, 0);
});
