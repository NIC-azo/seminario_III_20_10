import type { FormEvent, KeyboardEvent } from "react";
import { Icon } from "@/components/Icons";

interface ChatComposerProps {
  value: string;
  sending: boolean;
  onChange: (value: string) => void;
  onSubmit: () => void;
}

export function ChatComposer({
  value,
  sending,
  onChange,
  onSubmit,
}: ChatComposerProps) {
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    onSubmit();
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      onSubmit();
    }
  }

  return (
    <form className="composer" onSubmit={submit}>
      <textarea
        aria-label="Escribe tu consulta jurídica"
        maxLength={4000}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={onKeyDown}
        placeholder="Escribe tu consulta sobre la Constitución o el Código Penal…"
        rows={1}
        value={value}
      />
      <div className="composer-footer">
        <span className="composer-hint">
          <Icon name="shield" />
          Respuestas basadas en fuentes legales peruanas
        </span>
        <div className="composer-actions">
          <span className="character-count">{value.length}/4000</span>
          <button
            aria-label={sending ? "Enviando consulta" : "Enviar consulta"}
            className="send-button"
            disabled={sending || !value.trim()}
            type="submit"
          >
            <Icon name={sending ? "sparkle" : "send"} />
            <span>{sending ? "Consultando" : "Consultar"}</span>
          </button>
        </div>
      </div>
    </form>
  );
}
