import assert from "node:assert/strict";
import test from "node:test";
import { LegalChatService } from "../src/controllers/chatController.js";
import type { RetrievedLegalChunk } from "../src/models/vectorStore.js";

const longArticle =
  "Toda persona tiene derecho a la igualdad ante la ley. " +
  "La Constitución reconoce derechos fundamentales y establece garantías. ".repeat(
    80,
  );

function createChunk(
  content: string,
  articleNumber = "2",
  articleTitle = "[Derechos fundamentales de la persona]",
  normName = "Constitución Política del Perú",
): RetrievedLegalChunk {
  return {
    id: `${normName.toLocaleLowerCase("es-PE").replace(/\s+/g, "-")}-articulo-${articleNumber}`,
    norm_name: normName,
    source_url: "https://example.test/constitucion",
    last_update: null,
    source_file: "constitucion.html",
    book: null,
    title: "TÍTULO I",
    chapter: "CAPÍTULO I",
    article_number: articleNumber,
    article_title: articleTitle,
    content,
    jurisprudence: [],
    chunk_text: `${normName} > Artículo ${articleNumber}\n${content}`,
    relevance: 1,
  };
}

function createService(
  chunks: RetrievedLegalChunk[],
  generate = async (): Promise<string> => "",
) {
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
        return generate();
      },
    },
    {
      search: async () => chunks,
      findArticle: (articleNumber, sourceType) =>
        sourceType === "constitucion"
          ? (chunks.find((chunk) => chunk.article_number === articleNumber) ?? null)
          : null,
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
  const { service, embeddingCalls, generationCalls } = createService([chunk]);
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
  const client = createService([chunk]);
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

test("responde de forma determinista con el artículo solicitado aunque el modelo varíe", async () => {
  const article = createChunk(
    "La comunidad y el Estado protegen especialmente al niño, al adolescente, a la madre y al anciano en situación de abandono.",
    "4",
    "[Protección a la familia]",
  );
  const client = createService([article]);
  const query = "¿Qué derechos reconoce el artículo 4 de la Constitución?";
  const first = await client.service.answer({
    message: query,
    sessionId: "repeated-article-question",
  });
  const second = await client.service.answer({
    message: query,
    sessionId: "repeated-article-question",
  });

  assert.equal(first.status, "answered");
  assert.equal(second.answer, first.answer);
  assert.match(first.answer, /artículo 4/);
  assert.doesNotMatch(first.answer, /artículo 2|Código Penal/);
  assert.equal(client.embeddingCalls, 0);
  assert.equal(client.generationCalls, 0);
});

test("resuelve de forma extractiva las tres consultas sugeridas en la pantalla inicial", async () => {
  const articleTwo = createChunk(
    "Toda persona tiene derecho: 1. A la vida. 2. A la igualdad ante la ley. Nadie debe ser discriminado por motivo de origen.",
  );
  const penalPrinciple = createChunk(
    "Nadie será sancionado por un acto no previsto como delito o falta por la ley vigente al momento de su comisión.",
    "II",
    "Principio de Legalidad",
    "Código Penal peruano",
  );
  const equalityArticle = createChunk(
    "Todos los hijos tienen iguales derechos y deberes.",
    "6",
    "[Igualdad de los hijos]",
  );
  const client = createService([articleTwo, penalPrinciple, equalityArticle]);
  const suggestions = [
    {
      message: "¿Qué derechos reconoce el artículo 2 de la Constitución?",
      expectedArticle: "2",
    },
    {
      message: "¿Qué establece el principio de legalidad penal?",
      expectedArticle: "II",
    },
    {
      message: "¿Qué dice la Constitución sobre la igualdad?",
      expectedArticle: "2",
    },
  ];

  for (const suggestion of suggestions) {
    const result = await client.service.answer({
      message: suggestion.message,
      sessionId: "homepage-suggestions",
    });
    assert.equal(result.status, "answered", suggestion.message);
    const citedSource = result.sources.find(
      (source) => source.citation_fragments.length > 0,
    );
    assert.ok(citedSource, suggestion.message);
    assert.equal(citedSource.article_number, suggestion.expectedArticle);
  }

  assert.equal(client.generationCalls, 0);
  assert.equal(client.embeddingCalls, 2);
});

test("reutiliza la respuesta en la misma sesión aunque cambien mayúsculas o puntuación", async () => {
  const chunk = createChunk(
    "Toda persona tiene derecho a la igualdad ante la ley.",
  );
  const client = createService([chunk], async () =>
    JSON.stringify({
      status: "answered",
      claims: [
        {
          text: "La norma reconoce igualdad ante la ley.",
          evidence: "Toda persona tiene derecho a la igualdad ante la ley.",
          citation_ids: ["F1"],
        },
      ],
      message: "",
    }),
  );
  const sessionId = "cached-question";
  const first = await client.service.answer({
    message: "¿Qué señala esta regla?",
    sessionId,
  });
  const second = await client.service.answer({
    message: "que señala esta regla",
    sessionId,
  });

  assert.equal(second.answer, first.answer);
  assert.deepEqual(second.sources, first.sources);
  assert.equal(client.embeddingCalls, 1);
  assert.equal(client.generationCalls, 1);
});

test("responde la edad y condiciones para votar con los artículos 30 y 31", async () => {
  const citizenship = createChunk(
    "Son ciudadanos los peruanos mayores de dieciocho años. Para el ejercicio de la ciudadanía se requiere la inscripción electoral.",
    "30",
    "[Requisitos para la ciudadanía]",
  );
  const voting = createChunk(
    "Tienen derecho al voto los ciudadanos en goce de su capacidad civil. Para el ejercicio de este derecho se requiere estar inscrito en el registro correspondiente. El voto es personal, igual, libre y secreto.",
    "31",
    "[Participación ciudadana en asuntos públicos]",
  );
  const client = createService([citizenship, voting]);
  const result = await client.service.answer({
    message: "¿A qué edad puedo votar?",
  });

  assert.equal(result.status, "answered");
  assert.match(result.answer, /mayores de dieciocho años/);
  assert.match(result.answer, /capacidad civil/);
  assert.match(result.answer, /registro correspondiente/);
  assert.deepEqual(
    result.sources.map((source) => source.article_number),
    ["30", "31"],
  );
  assert.ok(result.sources.every((source) => source.citation_fragments.length > 0));
  assert.equal(client.embeddingCalls, 0);
  assert.equal(client.generationCalls, 0);
});

test("declara evidencia insuficiente si faltan artículos constitucionales del voto", async () => {
  const unrelatedArticle = createChunk("La libertad personal es inviolable.");
  const client = createService([unrelatedArticle]);
  const result = await client.service.answer({
    message: "¿A qué edad puedo votar?",
  });

  assert.equal(result.status, "insufficient_evidence");
  assert.match(result.answer, /no se encontraron completos/i);
  assert.equal(client.embeddingCalls, 0);
  assert.equal(client.generationCalls, 0);
});
