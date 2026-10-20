import { Router } from "express";
import type { ChatService } from "@/controllers/chatController.js";
import { postChat } from "@/controllers/chatController.js";
import type { OllamaClient } from "@/controllers/ollamaClient.js";
import type { VectorStore } from "@/models/vectorStore.js";

export function createApiRouter(
  chatService: ChatService,
  ollama: Pick<OllamaClient, "health">,
  vectorStore: Pick<VectorStore, "indexedChunkCount">,
): Router {
  const router = Router();

  router.get("/health", async (_request, response) => {
    const ollamaHealth = await ollama.health();
    const vectorStoreAvailable = vectorStore.indexedChunkCount > 0;
    const ready =
      ollamaHealth.available &&
      ollamaHealth.chatModelAvailable &&
      ollamaHealth.embeddingModelAvailable &&
      vectorStoreAvailable;

    response.status(ready ? 200 : 503).json({
      status: ready ? "ok" : "degraded",
      vectorStore: {
        available: vectorStoreAvailable,
        indexedChunks: vectorStore.indexedChunkCount,
      },
      ollama: ollamaHealth,
    });
  });

  router.post("/chat", postChat(chatService));

  return router;
}
