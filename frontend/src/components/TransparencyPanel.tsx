import { Icon } from "@/components/Icons";
import type { ChatSource } from "@/types/chat";

interface TransparencyPanelProps {
  sources: ChatSource[];
}

function safeExternalUrl(value: string | null): string | null {
  if (!value) {
    return null;
  }
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:" ? url.href : null;
  } catch {
    return null;
  }
}

function sourceHierarchy(source: ChatSource): string {
  return [
    source.book,
    source.title,
    source.chapter,
    `Artículo ${source.article_number}${source.article_title ? ` · ${source.article_title}` : ""}`,
  ]
    .filter(Boolean)
    .join(" / ");
}

function uniqueJurisprudence(
  notes: ChatSource["jurisprudence"],
): ChatSource["jurisprudence"] {
  const unique = new Map<string, ChatSource["jurisprudence"][number]>();
  for (const note of notes) {
    const key = note.url ? `url:${note.url}` : `text:${note.text}`;
    if (!unique.has(key)) {
      unique.set(key, note);
    }
  }
  return [...unique.values()];
}

function groupJurisprudence(
  notes: ChatSource["jurisprudence"],
): Array<{ label: string; notes: ChatSource["jurisprudence"] }> {
  const groups = new Map<string, ChatSource["jurisprudence"]>();
  for (const note of notes) {
    const group = groups.get(note.text) ?? [];
    group.push(note);
    groups.set(note.text, group);
  }
  return [...groups].map(([label, groupedNotes]) => ({
    label,
    notes: groupedNotes,
  }));
}

export function TransparencyPanel({ sources }: TransparencyPanelProps) {
  if (sources.length === 0) {
    return null;
  }

  return (
    <details className="transparency-panel">
      <summary className="transparency-summary">
        <span className="transparency-icon">
          <Icon name="file" />
        </span>
        <span>
          <strong>Fuentes consultadas</strong>
          <small>
            {sources.length} {sources.length === 1 ? "fragmento" : "fragmentos"}{" "}
            {sources.length === 1 ? "recuperado" : "recuperados"}
          </small>
        </span>
        <Icon className="transparency-chevron" name="chevron-down" />
      </summary>
      <div className="source-list">
        {sources.map((source) => {
          const sourceUrl = safeExternalUrl(source.source_url);
          const jurisprudence = groupJurisprudence(
            uniqueJurisprudence(source.jurisprudence),
          );
          return (
            <article
              className="source-card"
              key={`${source.citation_id}-${source.id}`}
            >
              <div className="source-heading">
                <span className="citation-label">[{source.citation_id}]</span>
                <div>
                  <p className="source-norm">{source.norm_name}</p>
                  <p className="source-hierarchy">{sourceHierarchy(source)}</p>
                </div>
              </div>
              {source.citation_fragments.length > 0 && (
                <div className="source-evidence">
                  <span>BASE DE LA RESPUESTA</span>
                  {source.citation_fragments.map((fragment, index) => (
                    <blockquote key={`${source.id}-evidence-${index}`}>
                      “{fragment}”
                    </blockquote>
                  ))}
                </div>
              )}
              <details className="source-full-text">
                <summary>Ver texto completo del artículo</summary>
                <p>{source.content}</p>
              </details>
              {jurisprudence.length > 0 && (
                <div className="jurisprudence-list">
                  <span>JURISPRUDENCIA ASOCIADA</span>
                  {jurisprudence.map((group, groupIndex) =>
                    group.notes.length > 1 ? (
                      <details
                        className="jurisprudence-group"
                        key={`${source.id}-jurisprudence-group-${groupIndex}`}
                      >
                        <summary>
                          {group.label} · {group.notes.length} referencias
                        </summary>
                        <ul>
                          {group.notes.map((note, noteIndex) => {
                            const noteUrl = safeExternalUrl(note.url);
                            return (
                              <li
                                key={`${source.id}-jurisprudence-${noteIndex}`}
                              >
                                {noteUrl ? (
                                  <a
                                    href={noteUrl}
                                    rel="noreferrer"
                                    target="_blank"
                                  >
                                    Abrir referencia {noteIndex + 1}
                                    <Icon name="arrow-up-right" />
                                  </a>
                                ) : (
                                  note.text
                                )}
                              </li>
                            );
                          })}
                        </ul>
                      </details>
                    ) : (
                      group.notes.map((note, noteIndex) => {
                        const noteUrl = safeExternalUrl(note.url);
                        return noteUrl ? (
                          <a
                            href={noteUrl}
                            key={`${source.id}-jurisprudence-${groupIndex}-${noteIndex}`}
                            rel="noreferrer"
                            target="_blank"
                          >
                            {note.text} <Icon name="arrow-up-right" />
                          </a>
                        ) : (
                          <p
                            key={`${source.id}-jurisprudence-${groupIndex}-${noteIndex}`}
                          >
                            {note.text}
                          </p>
                        );
                      })
                    ),
                  )}
                </div>
              )}
              {sourceUrl && (
                <a
                  className="source-link"
                  href={sourceUrl}
                  rel="noreferrer"
                  target="_blank"
                >
                  Abrir fuente original <Icon name="arrow-up-right" />
                </a>
              )}
            </article>
          );
        })}
      </div>
    </details>
  );
}
