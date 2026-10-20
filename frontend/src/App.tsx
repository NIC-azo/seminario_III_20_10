import { useEffect, useRef, useState } from "react";
import { ChatComposer } from "@/components/ChatComposer";
import { ChatMessage } from "@/components/ChatMessage";
import { Icon } from "@/components/Icons";
import { Sidebar } from "@/components/Sidebar";
import { ChatApiError, getBackendHealth, sendChatMessage } from "@/services/chatApi";
import type {
  BackendHealth,
  ChatMessage as ChatMessageType,
  Conversation,
} from "@/types/chat";

const suggestedQuestions = [
  "¿Qué derechos reconoce el artículo 2 de la Constitución?",
  "¿Qué establece el principio de legalidad penal?",
  "¿Qué dice la Constitución sobre la igualdad?",
];

function currentTimestamp(): string {
  return new Date().toISOString();
}

function createMessage(
  role: ChatMessageType["role"],
  content: string,
  extra: Partial<ChatMessageType> = {},
): ChatMessageType {
  return {
    id: crypto.randomUUID(),
    role,
    content,
    createdAt: currentTimestamp(),
    ...extra,
  };
}

function conversationTitle(message: string): string {
  const compact = message.replace(/\s+/g, " ").trim();
  return compact.length > 36 ? `${compact.slice(0, 36)}…` : compact;
}

function isBackendReady(value: BackendHealth | null): boolean {
  return Boolean(
    value?.status === "ok" &&
      value.vectorStore.available &&
      value.ollama.available &&
      value.ollama.chatModelAvailable &&
      value.ollama.embeddingModelAvailable,
  );
}

function App() {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [health, setHealth] = useState<BackendHealth | null>(null);
  const [healthError, setHealthError] = useState<string | null>(null);
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const chatScrollRef = useRef<HTMLDivElement>(null);
  const messageEndRef = useRef<HTMLDivElement>(null);
  const currentConversation = conversations.find(
    (conversation) => conversation.id === currentId,
  );
  const messages = currentConversation?.messages ?? [];

  useEffect(() => {
    const controller = new AbortController();
    const refreshHealth = async () => {
      try {
        const result = await getBackendHealth(controller.signal);
        setHealth(result);
        setHealthError(
          result.status === "ok"
            ? null
            : result.ollama.error ?? "El backend necesita atención.",
        );
      } catch (error) {
        if (controller.signal.aborted) {
          return;
        }
        setHealth(null);
        setHealthError(
          error instanceof Error ? "Backend sin conexión" : "No se pudo comprobar el estado del backend.",
        );
      }
    };

    void refreshHealth();
    const timer = window.setInterval(() => void refreshHealth(), 30_000);
    return () => {
      controller.abort();
      window.clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    const scrollArea = chatScrollRef.current;
    if (scrollArea) {
      scrollArea.scrollTo({
        top: scrollArea.scrollHeight,
        behavior: "smooth",
      });
    }
  }, [messages.length, sending, currentId]);

  function startNewConversation() {
    setCurrentId(null);
    setDraft("");
    setMobileSidebarOpen(false);
  }

  function updateConversation(
    conversationId: string,
    update: (conversation: Conversation) => Conversation,
  ) {
    setConversations((previous) =>
      previous
        .map((conversation) =>
          conversation.id === conversationId ? update(conversation) : conversation,
        )
        .sort(
          (left, right) =>
            right.updatedAt.localeCompare(left.updatedAt),
        ),
    );
  }

  async function sendMessage(content = draft) {
    const query = content.trim();
    if (!query || sending) {
      return;
    }

    const conversationId = currentConversation?.id ?? crypto.randomUUID();
    const conversation: Conversation = currentConversation ?? {
      id: conversationId,
      title: conversationTitle(query),
      updatedAt: currentTimestamp(),
      messages: [],
    };
    const userMessage = createMessage("user", query);
    const updatedConversation: Conversation = {
      ...conversation,
      title:
        conversation.messages.length === 0
          ? conversationTitle(query)
          : conversation.title,
      updatedAt: userMessage.createdAt,
      messages: [...conversation.messages, userMessage],
    };

    setConversations((previous) => [
      updatedConversation,
      ...previous.filter((item) => item.id !== conversationId),
    ]);
    setCurrentId(conversationId);
    setDraft("");
    setSending(true);
    setMobileSidebarOpen(false);

    try {
      const response = await sendChatMessage(query, conversation.sessionId);
      const assistantMessage = createMessage("assistant", response.answer, {
        status: response.status,
        sources: response.sources,
      });
      updateConversation(conversationId, (current) => ({
        ...current,
        sessionId: response.sessionId,
        updatedAt: assistantMessage.createdAt,
        messages: [...current.messages, assistantMessage],
      }));
    } catch (error) {
      const assistantMessage = createMessage(
        "assistant",
        error instanceof ChatApiError
          ? error.message
          : error instanceof TypeError
            ? "No se pudo conectar con la API local. Comprueba que el backend esté iniciado."
            : "Ocurrió un error inesperado al consultar el backend.",
        {
          status: "error",
          sources: error instanceof ChatApiError ? error.sources : [],
        },
      );
      updateConversation(conversationId, (current) => ({
        ...current,
        updatedAt: assistantMessage.createdAt,
        messages: [...current.messages, assistantMessage],
      }));
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="app-shell min-h-screen w-full">
      <Sidebar
        conversations={conversations}
        currentId={currentId}
        health={health}
        healthError={healthError}
        mobileOpen={mobileSidebarOpen}
        onClose={() => setMobileSidebarOpen(false)}
        onNewChat={startNewConversation}
        onSelect={(id) => {
          setCurrentId(id);
          setMobileSidebarOpen(false);
        }}
      />

      <main className="workspace">
        <header className="topbar">
          <button
            aria-label="Abrir menú de conversaciones"
            className="icon-button menu-toggle"
            onClick={() => setMobileSidebarOpen(true)}
            type="button"
          >
            <Icon name="menu" />
          </button>
          <div className="topbar-context">
            <span className="context-label">ESPACIO DE CONSULTA</span>
            <span className="context-divider">/</span>
            <span className="context-current">
              {currentConversation?.title ?? "Nueva consulta"}
            </span>
          </div>
          <div
            className={`topbar-status ${isBackendReady(health) ? "topbar-status--online" : "topbar-status--offline"}`}
            role="status"
          >
            <span className="status-dot" />
            {isBackendReady(health) ? "Local y privado" : "Backend desconectado"}
          </div>
        </header>

        <section aria-label="Chat jurídico" className="chat-layout">
          <div className="chat-scroll-area" ref={chatScrollRef}>
            <div className="chat-column">
              {messages.length === 0 ? (
                <div className="welcome">
                  <div aria-hidden="true" className="welcome-emblem">
                    <Icon name="scale" />
                    <span />
                  </div>
                  <p className="welcome-eyebrow">
                    <Icon name="sparkle" />
                    CONOCIMIENTO JURÍDICO DEL PERÚ
                  </p>
                  <h1>Tu consulta merece una respuesta con fundamento.</h1>
                  <p className="welcome-copy">
                    Consulta artículos, derechos y principios constitucionales,
                    además de delitos, penas y responsabilidad penal. Las
                    respuestas se limitan al contenido indexado de la
                    Constitución y el Código Penal, con sus fuentes visibles.
                  </p>
                  <div className="suggestion-grid">
                    {suggestedQuestions.map((question, index) => (
                      <button
                        className="suggestion-card"
                        key={question}
                        onClick={() => void sendMessage(question)}
                        type="button"
                      >
                        <span>{question}</span>
                        <Icon name="arrow-up-right" />
                        <small>0{index + 1}</small>
                      </button>
                    ))}
                  </div>
                  {!isBackendReady(health) && (
                    <div className="welcome-notice" role="status">
                      <span className="status-dot" />
                      {healthError ??
                        "Comprueba que la API, Ollama y el índice estén disponibles."}
                    </div>
                  )}
                </div>
              ) : (
                <div className="message-list">
                  <div className="conversation-date">
                    <span>CONSULTA EN CURSO</span>
                  </div>
                  {messages.map((message) => (
                    <ChatMessage key={message.id} message={message} />
                  ))}
                  {sending && (
                    <div aria-live="polite" className="typing-indicator">
                      <div aria-hidden="true" className="assistant-avatar">
                        <Icon name="scale" />
                      </div>
                      <div>
                        <span className="typing-dots">
                          <i />
                          <i />
                          <i />
                        </span>
                        <span>Consultando las fuentes locales…</span>
                      </div>
                    </div>
                  )}
                  <div ref={messageEndRef} />
                </div>
              )}
            </div>
          </div>

          <div className="composer-dock">
            <div className="composer-column">
              <ChatComposer
                onChange={setDraft}
                onSubmit={() => void sendMessage()}
                sending={sending}
                value={draft}
              />
              <p className="disclaimer">
                Mini-Juztina ofrece información documental y no reemplaza el
                asesoramiento legal profesional.
              </p>
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}

export default App;
