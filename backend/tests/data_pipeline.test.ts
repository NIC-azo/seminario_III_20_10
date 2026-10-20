import assert from "node:assert/strict";
import test from "node:test";
import { processHtml } from "../src/data_pipeline/etl.js";

const fixture = `<!doctype html>
<html>
  <head>
    <title>Constitución Política del Perú [actualizada 2026] | LP</title>
    <link rel="canonical" href="https://lpderecho.pe/constitucion-politica-peru-actualizada/">
  </head>
  <body>
    <div class="td-post-content">
      <nav>Menú web que no debe aparecer</nav>
      <ul><li>Revise también el Código Procesal Penal</li></ul>
      <h2>TÍTULO I: DE LA PERSONA Y DE LA SOCIEDAD</h2>
      <h3>CAPÍTULO I: DERECHOS FUNDAMENTALES</h3>
      <h4>Artículo 2. [Derechos fundamentales de la persona]</h4>
      <p>Toda persona tiene derecho a la igualdad ante la ley.</p>
      <p><em>Ver jurisprudencia <a href="https://lpd.pe/ejemplo">aquí</a></em></p>
      <p><em>Ver jurisprudencia <a href="https://lpd.pe/ejemplo">aquí</a></em></p>
      <p><em>Ver jurisprudencia <a href="https://lpd.pe/otra">aquí</a></em></p>
      <p>El artículo conserva sus numerales.</p>
      <h3>Aclaración adicional</h3>
      <p>El subtítulo no debe separar ni truncar el artículo.</p>
      <h4>Artículo 3. [Derechos no enumerados]</h4>
      <ol><li>La enumeración no excluye otros derechos.</li><li>Son reconocidos por la Constitución.</li></ol>
      <h2>TÍTULO PRELIMINAR</h2>
      <h4>Artículo I.- Finalidad Preventiva</h4>
      <p>El presente título contiene principios generales.</p>
      <h2>DISPOSICIONES FINALES Y TRANSITORIAS</h2>
      <h4>Artículo único.- Vigencia</h4>
      <p>La norma entra en vigor al día siguiente de su publicación.</p>
      <script>alert("ruido");</script>
      <div class="mceTemp"><h3>Publicidad</h3></div>
    </div>
  </body>
</html>`;

test("extrae chunks por artículo con jerarquía y notas de jurisprudencia", () => {
  const result = processHtml(fixture, "constitucion.html", "2026-10-20T00:00:00.000Z");

  assert.equal(result.schema_version, "1.0");
  assert.equal(result.document.norm_name, "Constitución Política del Perú");
  assert.equal(result.document.source_url, "https://lpderecho.pe/constitucion-politica-peru-actualizada/");
  assert.equal(result.chunks.length, 4);

  const first = result.chunks[0];
  assert.equal(first.article_number, "2");
  assert.equal(first.article_title, "[Derechos fundamentales de la persona]");
  assert.equal(first.title, "TÍTULO I: DE LA PERSONA Y DE LA SOCIEDAD");
  assert.equal(first.chapter, "CAPÍTULO I: DERECHOS FUNDAMENTALES");
  assert.equal(first.jurisprudence.length, 2);
  assert.equal(first.jurisprudence[0].url, "https://lpd.pe/ejemplo");
  assert.equal(first.jurisprudence[1].url, "https://lpd.pe/otra");
  assert.match(first.chunk_text, /Constitución Política del Perú > TÍTULO I/);
  assert.doesNotMatch(first.content, /Ver jurisprudencia|Menú web|Publicidad/);
  assert.match(first.content, /Aclaración adicional/);
  assert.match(first.content, /no debe separar ni truncar/);

  assert.match(result.chunks[1].content, /1\. La enumeración/);
  assert.match(result.chunks[1].content, /2\. Son reconocidos/);
  assert.equal(result.chunks[2].article_number, "I");
  assert.equal(result.chunks[2].title, "TÍTULO PRELIMINAR");
  assert.equal(result.chunks[1].title, "TÍTULO I: DE LA PERSONA Y DE LA SOCIEDAD");
  assert.equal(result.chunks[3].article_number, "ÚNICO");
  assert.equal(result.chunks[3].title, "DISPOSICIONES FINALES Y TRANSITORIAS");
});

test("falla explícitamente si la fuente no tiene el contenedor legal esperado", () => {
  assert.throws(
    () => processHtml("<html><body>sin contenido</body></html>", "invalid.html"),
    /No se encontró el contenido principal/,
  );
});

test("falla si no pudo extraer ningún artículo", () => {
  assert.throws(
    () =>
      processHtml(
        '<div class="td-post-content"><p>Solo texto introductorio</p></div>',
        "empty.html",
      ),
    /No se extrajeron artículos normativos/,
  );
});
