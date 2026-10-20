import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as cheerio from "cheerio";
import type { Cheerio, CheerioAPI } from "cheerio";
import type { Element } from "domhandler";

export interface JurisprudenceNote {
  text: string;
  url: string | null;
}

export interface LegalChunk {
  id: string;
  norm_name: string;
  source_url: string | null;
  last_update: string | null;
  source_file: string;
  book: string | null;
  title: string | null;
  chapter: string | null;
  article_number: string;
  article_title: string | null;
  content: string;
  jurisprudence: JurisprudenceNote[];
  chunk_text: string;
}

export interface ProcessedDocument {
  schema_version: "1.0";
  generated_at: string;
  document: {
    norm_name: string;
    source_url: string | null;
    last_update: string | null;
    source_file: string;
  };
  chunks: LegalChunk[];
}

interface Hierarchy {
  book: string | null;
  title: string | null;
  chapter: string | null;
}

const ARTICLE_HEADING =
  /^Art[ií]culo\s+([IVXLCDM]+|[0-9]+(?:-[A-Z])?|[UÚuú]nico)\b(?:\s*[-.:]+\s*|\s+)?(.*)$/i;
const JURISPRUDENCE_NOTE = /ver\s+jurisprudencia/i;
const SCRIPT_DIRECTORY = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_OUTPUT_DIRECTORY = path.resolve(
  SCRIPT_DIRECTORY,
  "../../data/processed",
);

function normalizeText(value: string): string {
  return value.replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
}

function normalizedHeading($: CheerioAPI, element: Element): string {
  return normalizeText($(element).text());
}

function extractArticleHeading(text: string): {
  number: string;
  title: string | null;
} | null {
  const match = text.match(ARTICLE_HEADING);
  if (!match) {
    return null;
  }

  return {
    number: match[1].toUpperCase(),
    title: normalizeText(match[2]) || null,
  };
}

function updateHierarchy(
  heading: string,
  hierarchy: Hierarchy,
): boolean {
  if (/\bLIBRO\b/i.test(heading)) {
    hierarchy.book = heading;
    hierarchy.title = null;
    hierarchy.chapter = null;
    return true;
  }
  if (/\bT[IÍ]TULO\b/i.test(heading)) {
    hierarchy.title = heading;
    hierarchy.chapter = null;
    return true;
  }
  if (/\bCAP[IÍ]TULO\b/i.test(heading)) {
    hierarchy.chapter = heading;
    return true;
  }
  if (/^DISPOSICIONES\b/i.test(heading)) {
    hierarchy.title = heading;
    hierarchy.chapter = null;
    return true;
  }
  return false;
}

function elementText($: CheerioAPI, element: Element): string {
  const node = $(element).clone();
  node.find("script, style, .mceTemp").remove();

  if (node.is("ul, ol")) {
    const items = node
      .find("li")
      .toArray()
      .map((item, index) => {
        const text = normalizeText($(item).text());
        return text ? `${index + 1}. ${text}` : "";
      })
      .filter(Boolean);
    return items.join(" ");
  }

  return normalizeText(node.text());
}

function getJurisprudenceNote(
  $: CheerioAPI,
  element: Element,
): JurisprudenceNote | null {
  const text = elementText($, element);
  if (!JURISPRUDENCE_NOTE.test(text)) {
    return null;
  }

  const link = $(element).find("a[href]").first();
  return {
    text,
    url: link.length ? link.attr("href") ?? null : null,
  };
}

function documentMetadata(
  $: CheerioAPI,
  sourceFile: string,
): ProcessedDocument["document"] {
  const title =
    normalizeText($("meta[property='og:title']").attr("content") ?? "") ||
    normalizeText($("title").text());
  const canonicalUrl =
    $("link[rel='canonical']").attr("href") ??
    $("meta[property='og:url']").attr("content") ??
    null;
  const modified =
    $("meta[property='article:modified_time']").attr("content") ??
    $("meta[name='last-modified']").attr("content") ??
    null;

  let normName = title
    .replace(/\s*\|\s*LP\s*$/i, "")
    .replace(/\s*\[\s*actualizad[oa][^\]]*\]/i, "")
    .trim();

  if (!normName) {
    normName = path.basename(sourceFile, path.extname(sourceFile));
  }

  return {
    norm_name: normName,
    source_url: canonicalUrl,
    last_update: modified,
    source_file: path.basename(sourceFile),
  };
}

function makeChunkId(
  normName: string,
  articleNumber: string,
  index: number,
): string {
  const slug = normName
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  const articleSlug = articleNumber.toLowerCase().replace(/[^a-z0-9]+/g, "-");
  const digest = createHash("sha1")
    .update(`${normName}:${articleNumber}:${index}`)
    .digest("hex")
    .slice(0, 8);

  return `${slug}-articulo-${articleSlug}-${digest}`;
}

function renderChunkText(
  metadata: ProcessedDocument["document"],
  hierarchy: Hierarchy,
  articleNumber: string,
  articleTitle: string | null,
  content: string,
): string {
  const pathParts = [
    metadata.norm_name,
    hierarchy.book,
    hierarchy.title,
    hierarchy.chapter,
    `Artículo ${articleNumber}${articleTitle ? `: ${articleTitle}` : ""}`,
  ].filter((part): part is string => Boolean(part));

  return `${pathParts.join(" > ")}\n${content}`;
}

function cleanContent($: CheerioAPI, content: Cheerio<Element>): void {
  content
    .find(
      [
        "script",
        "style",
        "noscript",
        "nav",
        "header",
        "footer",
        "aside",
        "iframe",
        "svg",
        "form",
        "button",
        "img",
        ".td-a-rec",
        "[class*='advert']",
        "[id*='advert']",
      ].join(","),
    )
    .remove();

  content.find("ul").each((_, list) => {
    if (/revise tambi[eé]n/i.test(normalizeText($(list).text()))) {
      $(list).remove();
    }
  });

  content.find("a[href*='curso-'], a[href*='lpodoo.pe'], a[href*='whatsapp']").each(
    (_, link) => {
      const parent = $(link).closest("h2, h3, h4, p");
      if (parent.length) {
        parent.remove();
      } else {
        $(link).remove();
      }
    },
  );
}

export function processHtml(
  html: string,
  sourceFile: string,
  generatedAt = new Date().toISOString(),
): ProcessedDocument {
  const $ = cheerio.load(html);
  const metadata = documentMetadata($, sourceFile);
  const content = $(".td-post-content").first();

  if (!content.length) {
    throw new Error(
      `No se encontró el contenido principal (.td-post-content) en ${sourceFile}`,
    );
  }

  cleanContent($, content);

  const chunks: LegalChunk[] = [];
  const hierarchy: Hierarchy = { book: null, title: null, chapter: null };
  let currentArticle:
    | {
        number: string;
        title: string | null;
        body: string[];
        jurisprudence: JurisprudenceNote[];
      }
    | undefined;

  const saveCurrentArticle = (): void => {
    if (!currentArticle) {
      return;
    }

    const articleContent = normalizeText(currentArticle.body.join(" "));
    if (articleContent) {
      chunks.push({
        id: makeChunkId(
          metadata.norm_name,
          currentArticle.number,
          chunks.length + 1,
        ),
        ...metadata,
        book: hierarchy.book,
        title: hierarchy.title,
        chapter: hierarchy.chapter,
        article_number: currentArticle.number,
        article_title: currentArticle.title,
        content: articleContent,
        jurisprudence: currentArticle.jurisprudence,
        chunk_text: renderChunkText(
          metadata,
          hierarchy,
          currentArticle.number,
          currentArticle.title,
          articleContent,
        ),
      });
    }
    currentArticle = undefined;
  };

  content
    .find("h1, h2, h3, h4, p, ul, ol, blockquote, table")
    .each((_, element) => {
      const tagName = element.tagName?.toLowerCase();
      if (!tagName) {
        return;
      }

      if (/^h[1-3]$/.test(tagName)) {
        const heading = normalizedHeading($, element);
        const nextHierarchy = { ...hierarchy };
        if (updateHierarchy(heading, nextHierarchy)) {
          saveCurrentArticle();
          Object.assign(hierarchy, nextHierarchy);
        } else if (currentArticle && heading) {
          currentArticle.body.push(heading);
        }
        return;
      }

      if (tagName === "h4") {
        const headingText = normalizedHeading($, element);
        const articleHeading = extractArticleHeading(headingText);
        if (articleHeading) {
          saveCurrentArticle();
          currentArticle = {
            ...articleHeading,
            body: [],
            jurisprudence: [],
          };
        } else if (currentArticle && headingText) {
          currentArticle.body.push(headingText);
        }
        return;
      }

      if (!currentArticle) {
        return;
      }

      const note = getJurisprudenceNote($, element);
      if (note) {
        const isDuplicate = currentArticle.jurisprudence.some(
          (existing) => existing.text === note.text && existing.url === note.url,
        );
        if (!isDuplicate) {
          currentArticle.jurisprudence.push(note);
        }
        return;
      }

      const text = elementText($, element);
      if (text) {
        currentArticle.body.push(text);
      }
    });

  saveCurrentArticle();

  if (!chunks.length) {
    throw new Error(`No se extrajeron artículos normativos de ${sourceFile}`);
  }

  return {
    schema_version: "1.0",
    generated_at: generatedAt,
    document: metadata,
    chunks,
  };
}

function parseArguments(args: string[]): {
  inputs: string[];
  outputDirectory: string;
} {
  const inputs: string[] = [];
  let outputDirectory = DEFAULT_OUTPUT_DIRECTORY;

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--input") {
      const input = args[index + 1];
      if (!input || input.startsWith("--")) {
        throw new Error("Falta la ruta después de --input");
      }
      inputs.push(input);
      index += 1;
    } else if (argument === "--output-dir") {
      const output = args[index + 1];
      if (!output || output.startsWith("--")) {
        throw new Error("Falta la ruta después de --output-dir");
      }
      outputDirectory = path.resolve(output);
      index += 1;
    } else if (argument === "--help") {
      console.log(
        'Uso: npm run etl -- --input "<archivo.html>" [--input "<otro.html>"] [--output-dir "<directorio>"]',
      );
      process.exit(0);
    } else {
      throw new Error(`Argumento desconocido: ${argument}`);
    }
  }

  if (!inputs.length) {
    throw new Error("Debe indicar al menos un archivo con --input");
  }

  return { inputs, outputDirectory };
}

function outputFileName(document: ProcessedDocument): string {
  const slug = document.document.norm_name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  return `${slug}.json`;
}

async function main(): Promise<void> {
  const { inputs, outputDirectory } = parseArguments(process.argv.slice(2));
  await mkdir(outputDirectory, { recursive: true });

  for (const input of inputs) {
    const inputPath = path.resolve(input);
    const html = await readFile(inputPath, "utf8");
    const document = processHtml(html, inputPath);
    const outputPath = path.join(outputDirectory, outputFileName(document));
    await writeFile(outputPath, `${JSON.stringify(document, null, 2)}\n`, "utf8");
    console.log(
      `Procesado: ${document.document.norm_name} — ${document.chunks.length} artículos -> ${outputPath}`,
    );
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error: unknown) => {
    console.error(
      `Error en el pipeline: ${error instanceof Error ? error.message : String(error)}`,
    );
    process.exitCode = 1;
  });
}
