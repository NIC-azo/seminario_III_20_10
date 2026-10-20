import { Icon } from "@/components/Icons";
import { TransparencyPanel } from "@/components/TransparencyPanel";
import type { ChatMessage as ChatMessageType } from "@/types/chat";

interface ChatMessageProps {
  message: ChatMessageType;
}

function formatAnswer(content: string) {
  return content.split(/(\*\*[^*]+\*\*|\[F\d+\])/g).map((part, index) => {
    if (/^\*\*[^*]+\*\*$/.test(part)) {
      return <strong key={index}>{part.slice(2, -2)}</strong>;
    }
    if (/^\[F\d+\]$/.test(part)) {
      return (
        <strong className="inline-citation" key={index}>
          {part}
        </strong>
      );
    }
    return part;
  });
}

function formatTime(value: string): string {
  return new Intl.DateTimeFormat("es-PE", {
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

export function ChatMessage({ message }: ChatMessageProps) {
  const isAssistant = message.role === "assistant";

  return (
    <article
      aria-label={isAssistant ? "Respuesta del asistente" : "Tu consulta"}
      className={`chat-message ${isAssistant ? "chat-message--assistant" : "chat-message--user"}`}
    >
      {isAssistant && (
        <div aria-hidden="true" className="assistant-avatar">
          <Icon name="scale" />
        </div>
      )}
      <div className="message-content">
        <div className="message-meta">
          <span>{isAssistant ? "Mini-Juztina" : "Tú"}</span>
          <time dateTime={message.createdAt}>{formatTime(message.createdAt)}</time>
          {message.status === "out_of_scope" && (
            <span className="message-status">Fuera de alcance</span>
          )}
          {message.status === "error" && (
            <span className="message-status message-status--error">
              Sin respuesta verificada
            </span>
          )}
        </div>
        <div
          className={`message-bubble ${isAssistant ? "message-bubble--assistant" : "message-bubble--user"}`}
        >
          {message.status === "error" && (
            <div className="error-heading">
              <Icon name="shield" />
              <strong>No pude validar una respuesta</strong>
            </div>
          )}
          <p>{formatAnswer(message.content)}</p>
        </div>
        {isAssistant && <TransparencyPanel sources={message.sources ?? []} />}
      </div>
    </article>
  );
}
