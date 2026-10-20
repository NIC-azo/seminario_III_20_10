export type ChatStatus =
  | "answered"
  | "out_of_scope"
  | "insufficient_evidence"
  | "error";

export interface ChatSource {
  citation_id: string;
  citation_fragments: string[];
  id: string;
  norm_name: string;
  article_number: string;
  article_title: string | null;
  book: string | null;
  title: string | null;
  chapter: string | null;
  content: string;
  chunk_text: string;
  source_url: string | null;
  last_update: string | null;
  jurisprudence: Array<{ text: string; url: string | null }>;
  relevance: number;
}

export interface ChatResponse {
  sessionId: string;
  status: Exclude<ChatStatus, "error">;
  answer: string;
  sources: ChatSource[];
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt: string;
  status?: ChatStatus;
  sources?: ChatSource[];
}

export interface Conversation {
  id: string;
  sessionId?: string;
  title: string;
  updatedAt: string;
  messages: ChatMessage[];
}

export interface BackendHealth {
  status: "ok" | "degraded";
  vectorStore: {
    available: boolean;
    indexedChunks: number;
  };
  ollama: {
    available: boolean;
    chatModelAvailable: boolean;
    embeddingModelAvailable: boolean;
    error?: string;
  };
}
