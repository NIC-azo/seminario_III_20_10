import type { BackendHealth, Conversation } from "@/types/chat";
import { Icon } from "@/components/Icons";

interface SidebarProps {
  conversations: Conversation[];
  currentId: string | null;
  health: BackendHealth | null;
  healthError: string | null;
  mobileOpen: boolean;
  onNewChat: () => void;
  onSelect: (conversationId: string) => void;
  onClose: () => void;
}

function formatConversationDate(value: string): string {
  return new Intl.DateTimeFormat("es-PE", {
    day: "numeric",
    month: "short",
  }).format(new Date(value));
}

export function Sidebar({
  conversations,
  currentId,
  health,
  healthError,
  mobileOpen,
  onNewChat,
  onSelect,
  onClose,
}: SidebarProps) {
  return (
    <>
      {mobileOpen && (
        <button
          aria-label="Cerrar menú"
          className="sidebar-scrim"
          onClick={onClose}
          type="button"
        />
      )}
      <aside className={`sidebar ${mobileOpen ? "sidebar--open" : ""}`}>
        <div className="sidebar-brand">
          <div aria-hidden="true" className="brand-mark">
            <Icon name="scale" />
          </div>
          <div>
            <p className="brand-name">mini-juztina</p>
            <p className="brand-caption">ASISTENTE JURÍDICO LOCAL</p>
          </div>
          <button
            aria-label="Cerrar menú"
            className="icon-button sidebar-close"
            onClick={onClose}
            type="button"
          >
            <Icon name="x" />
          </button>
        </div>

        <button className="new-chat-button" onClick={onNewChat} type="button">
          <Icon name="plus" />
          <span>Nueva consulta</span>
          <span aria-hidden="true" className="shortcut">
            +
          </span>
        </button>

        <div className="sidebar-section">
          <div className="sidebar-section-heading">
            <span>CONSULTAS RECIENTES</span>
            <Icon name="clock" />
          </div>
          {conversations.length === 0 ? (
            <p className="history-empty">Tus consultas aparecerán aquí.</p>
          ) : (
            <nav aria-label="Historial de consultas" className="history-list">
              {conversations.map((conversation) => (
                <button
                  aria-current={
                    conversation.id === currentId ? "page" : undefined
                  }
                  className={`history-item ${conversation.id === currentId ? "history-item--active" : ""}`}
                  key={conversation.id}
                  onClick={() => onSelect(conversation.id)}
                  type="button"
                >
                  <Icon name="message" />
                  <span className="history-title">{conversation.title}</span>
                  <time dateTime={conversation.updatedAt}>
                    {formatConversationDate(conversation.updatedAt)}
                  </time>
                </button>
              ))}
            </nav>
          )}
        </div>

        <div className="sidebar-spacer" />

        <div className="sidebar-data-card">
          <div className="data-card-icon">
            <Icon name="shield" />
          </div>
          <p className="data-card-title">Privado por diseño</p>
          <p className="data-card-copy">
            Tus consultas se procesan localmente y no salen de este equipo.
          </p>
          <div
            className={`connection-state ${health?.status === "ok" ? "connection-state--online" : "connection-state--offline"}`}
            role="status"
          >
            <span className="status-dot" />
            {health?.status === "ok"
              ? `Sistema conectado · ${health.vectorStore.indexedChunks} artículos`
              : healthError ?? "Conectando con el backend…"}
          </div>
        </div>

        <div className="sidebar-footer">
          <span>Constitución del Perú</span>
          <span className="footer-divider">·</span>
          <span>Código Penal</span>
        </div>
      </aside>
    </>
  );
}
